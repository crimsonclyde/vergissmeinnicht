// Run by deploy/memory-check.sh against a container that has the deployment's memory limit: uploads
// large and hostile PDFs and photos while ordinary requests keep coming, and reports how much memory
// the container used. The test files are made here (nothing is downloaded): PDFs are written by hand
// around JPEG pages from sharp and around deflated bitmaps that expand to hundreds of megabytes.
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';

const [origin, inviteToken, container] = process.argv.slice(2);
if (origin === undefined || inviteToken === undefined || container === undefined) throw new Error('usage: memory-check.ts <origin> <invite token> <container>');
/** The part of sharp used here (it is a dependency of `packages/media`, loaded from there). */
interface Encoder {
  jpeg(options: { quality: number; progressive?: boolean }): { toBuffer(): Promise<Buffer> };
}
type Sharp = (input: Buffer | { create: { width: number; height: number; channels: 3; background: string }; limitInputPixels: boolean }, options?: { raw: { width: number; height: number; channels: 3 } }) => Encoder;
const sharp = createRequire(new URL('../packages/media/package.json', import.meta.url))('sharp') as Sharp;
const PASSWORD = 'a memory check passphrase that is long';
const MB = 1_000_000;

// ---- Test files

/** Photo-like noise does not compress: file sizes like real scans and phone photos. */
async function noiseJpeg(width: number, height: number, quality: number): Promise<Buffer> {
  return sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } }).jpeg({ quality }).toBuffer();
}

interface PdfImage {
  readonly width: number;
  readonly height: number;
  readonly data: Buffer;
  readonly filter: 'DCTDecode' | 'FlateDecode';
  readonly colorSpace: 'DeviceRGB' | 'DeviceGray';
}

/** A PDF with one A4 page per image, the image filling the page. */
function pdf(images: readonly PdfImage[]): Buffer {
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets: number[] = [];
  let length = parts[0]?.length ?? 0;
  const add = (id: number, head: string, stream?: Buffer) => {
    offsets[id] = length;
    const chunks = stream === undefined ? [Buffer.from(`${id} 0 obj\n${head}\nendobj\n`, 'latin1')] : [Buffer.from(`${id} 0 obj\n${head}\nstream\n`, 'latin1'), stream, Buffer.from('\nendstream\nendobj\n', 'latin1')];
    for (const chunk of chunks) {
      parts.push(chunk);
      length += chunk.length;
    }
  };
  const pageIds = images.map((_, index) => 3 + index * 3);
  add(1, '<< /Type /Catalog /Pages 2 0 R >>');
  add(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${images.length} >>`);
  images.forEach((image, index) => {
    const page = 3 + index * 3;
    const content = Buffer.from('q 595 0 0 842 0 0 cm /Im0 Do Q', 'latin1');
    add(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${page + 1} 0 R /Resources << /XObject << /Im0 ${page + 2} 0 R >> >> >>`);
    add(page + 1, `<< /Length ${content.length} >>`, content);
    add(page + 2, `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /${image.colorSpace} /BitsPerComponent 8 /Filter /${image.filter} /Length ${image.data.length} >>`, image.data);
  });
  const count = 3 + images.length * 3;
  const xref = [`xref\n0 ${count}\n0000000000 65535 f \n`];
  for (let id = 1; id < count; id++) xref.push(`${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`);
  parts.push(Buffer.from(`${xref.join('')}trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(parts);
}

/** A bitmap of zeros: a few hundred kilobytes in the file, `width × height × channels` bytes once a renderer decodes it. */
function bomb(width: number, height: number, channels: 1 | 3): PdfImage {
  return { width, height, filter: 'FlateDecode', colorSpace: channels === 1 ? 'DeviceGray' : 'DeviceRGB', data: deflateSync(Buffer.alloc(width * height * channels), { level: 6 }) };
}

// ---- The server

let cookie = '';
async function call(method: 'GET' | 'POST', path: string, body?: object): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${origin}/api${path}`, {
    method,
    headers: { origin: origin ?? '', ...(cookie === '' ? {} : { cookie }), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (path === '/auth/sign-in') cookie = response.headers.getSetCookie().map((value) => value.split(';')[0] ?? '').find((value) => value.includes('session_token')) ?? '';
  return { status: response.status, json: text === '' ? {} : (JSON.parse(text) as unknown) };
}

let workspace = '';
async function upload(name: string, bytes: Buffer): Promise<{ status: number; reason: string; id: string | undefined; ms: number }> {
  const started = performance.now();
  const response = await fetch(`${origin}/api/workspaces/${workspace}/document-files`, {
    method: 'POST',
    headers: { origin: origin ?? '', cookie, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name) },
    body: bytes,
  });
  const json = (await response.json().catch(() => ({}))) as { file?: { id: string }; error?: string; reason?: string };
  return { status: response.status, reason: json.reason ?? json.error ?? 'stored', id: json.file?.id, ms: Math.round(performance.now() - started) };
}

/** Bytes the container's cgroup holds right now, and what the kernel recorded for it. */
const cgroup = (file: string) => execFileSync('docker', ['exec', container, 'cat', `/sys/fs/cgroup/${file}`], { encoding: 'utf8' }).trim();
const oomKills = () => Number(/oom_kill (\d+)/.exec(cgroup('memory.events'))?.[1] ?? '0');

// ---- Ordinary activity, all the time: what people do while someone uploads

const activity = { requests: 0, failures: 0, latencies: [] as number[], running: true, peak: 0, phasePeak: 0 };
async function ordinaryRequests(): Promise<void> {
  const paths = ['/home', '/procedures', '/lists', '/document-folders', '/documents', '/document-files/usage'];
  for (let turn = 0; activity.running; turn++) {
    const started = performance.now();
    try {
      const response = await fetch(`${origin}/api/workspaces/${workspace}${paths[turn % paths.length] ?? ''}`, { headers: { cookie } });
      await response.arrayBuffer();
      if (response.status !== 200) activity.failures++;
    } catch {
      activity.failures++;
    }
    activity.requests++;
    activity.latencies.push(performance.now() - started);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
async function sampleMemory(): Promise<void> {
  while (activity.running) {
    try {
      const current = Number(cgroup('memory.current'));
      activity.peak = Math.max(activity.peak, current);
      activity.phasePeak = Math.max(activity.phasePeak, current);
    } catch {
      // the container is gone: the final checks report it
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

const results: string[] = [];
let failed = false;
async function phase(title: string, run: () => Promise<string[]>): Promise<void> {
  activity.phasePeak = 0;
  const lines = await run();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  results.push(`${title}\n    peak memory during this phase: ${(activity.phasePeak / MB).toFixed(0)} MB\n${lines.map((line) => `    ${line}`).join('\n')}`);
}
function expectOutcome(label: string, outcome: { status: number; reason: string; ms: number }, allowed: readonly string[]): string {
  const ok = allowed.includes(outcome.reason);
  if (!ok) failed = true;
  return `${ok ? 'ok  ' : 'FAIL'} ${label}: ${outcome.status} ${outcome.reason} in ${(outcome.ms / 1000).toFixed(1)} s`;
}
/** Waits until the previews of a file are finished (or given up), and says how it ended. */
async function previews(id: string | undefined, label: string): Promise<string> {
  if (id === undefined) return `     ${label}: not stored`;
  const started = performance.now();
  for (;;) {
    const file = (await call('GET', `/workspaces/${workspace}/document-files/${id}`)).json as { file?: { pageCount: number | null; preview: { state: string; pages: number } } };
    const preview = file.file?.preview;
    if (preview !== undefined && preview.state !== 'PENDING') return `     ${label}: previews ${preview.state}, ${preview.pages} of ${file.file?.pageCount ?? '?'} pages after ${((performance.now() - started) / 1000).toFixed(0)} s`;
    if (performance.now() - started > 900_000) {
      failed = true;
      return `FAIL ${label}: previews not finished after 15 minutes`;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

// ---- The run

await call('POST', '/invitations/accept', { token: inviteToken, displayName: 'Memory Check', password: PASSWORD });
if ((await call('POST', '/auth/sign-in', { email: 'admin@example.org', password: PASSWORD })).status !== 200 || cookie === '') throw new Error('sign-in failed');
workspace = ((await call('POST', '/workspaces', { name: 'Memory check' })).json as { workspace: { id: string } }).workspace.id;
await call('POST', `/workspaces/${workspace}/tools`, { tool: 'DOCUMENTS', enabled: true });
await call('POST', `/workspaces/${workspace}/lists`, { title: 'Groceries' });
await call('POST', `/workspaces/${workspace}/document-folders`, { name: 'Water', parentId: null });

console.log('Preparing test files (a minute or two) …');
const scanPage = async () => ({ width: 2480, height: 3508, filter: 'DCTDecode', colorSpace: 'DeviceRGB', data: await noiseJpeg(2480, 3508, 30) }) as const;
const smallPage = async () => ({ width: 900, height: 1273, filter: 'DCTDecode', colorSpace: 'DeviceRGB', data: await noiseJpeg(900, 1273, 8) }) as const;
/** A progressive JPEG must be held as coefficients before it can be drawn: far more memory than its pixels, from a small file. */
const progressive = async (edge: number): Promise<PdfImage> => ({
  width: edge,
  height: edge,
  filter: 'DCTDecode',
  colorSpace: 'DeviceRGB',
  data: await sharp({ create: { width: edge, height: edge, channels: 3, background: '#7a1f2b' }, limitInputPixels: false })
    .jpeg({ progressive: true, quality: 50 })
    .toBuffer(),
});
const scanPages: PdfImage[] = [];
for (let size = 0; size < 46 * MB; ) {
  const page = await scanPage();
  scanPages.push(page);
  size += page.data.length;
}
const manyPages: PdfImage[] = [];
for (let index = 0; index < 500; index++) manyPages.push(await smallPage());
const files = {
  scan: pdf(scanPages),
  many: pdf(manyPages),
  poster: pdf([{ width: 7000, height: 7000, filter: 'DCTDecode', colorSpace: 'DeviceRGB', data: await noiseJpeg(7000, 7000, 35) }]),
  photo: await noiseJpeg(8000, 6000, 60),
  bomb400: pdf([bomb(20_000, 20_000, 1)]),
  bomb1200: pdf([bomb(20_000, 20_000, 3)]),
  bomb2100: pdf([bomb(46_000, 46_000, 1)]),
  bombPages: pdf(Array.from({ length: 30 }, () => bomb(12_000, 12_000, 3))),
  progressive600: pdf([await progressive(14_000)]),
  progressive1200: pdf([await progressive(20_000)]),
  progressivePages: pdf([await progressive(14_000), await progressive(14_000), await progressive(14_000)]),
};
for (const [name, bytes] of Object.entries(files)) console.log(`  ${name}: ${(bytes.length / MB).toFixed(1)} MB`);

const background = [ordinaryRequests(), ordinaryRequests(), sampleMemory()];
const idle = Number(cgroup('memory.current'));

await phase(`Large ordinary files, three uploads at a time: a ${scanPages.length}-page scan of ${(files.scan.length / MB).toFixed(0)} MB, a 500-page PDF of ${(files.many.length / MB).toFixed(0)} MB, a 49-megapixel page`, async () => {
  const [scan, many, poster] = await Promise.all([upload('scan.pdf', files.scan), upload('many.pdf', files.many), upload('poster.pdf', files.poster)]);
  const lines = [expectOutcome('scan.pdf', scan, ['stored']), expectOutcome('many.pdf', many, ['stored']), expectOutcome('poster.pdf', poster, ['stored'])];
  const photos = await Promise.all([upload('photo-1.jpg', files.photo), upload('photo-2.jpg', files.photo.subarray(0)), upload('photo-3.jpg', files.photo)]);
  lines.push(...photos.map((photo, index) => expectOutcome(`photo-${index + 1}.jpg (48 MP)`, photo, ['stored'])));
  lines.push(await previews(scan.id, 'scan.pdf'), await previews(many.id, 'many.pdf'), await previews(poster.id, 'poster.pdf'));
  // The original comes back as it went in.
  const original = await fetch(`${origin}/api/workspaces/${workspace}/document-files/${scan.id}/original`, { headers: { cookie } });
  const same = createHash('sha256').update(Buffer.from(await original.arrayBuffer())).digest('hex') === createHash('sha256').update(files.scan).digest('hex');
  if (!same) failed = true;
  lines.push(`${same ? 'ok  ' : 'FAIL'} scan.pdf downloads byte-identical`);
  return lines;
});

// A file that needs more memory than the parser may take is refused (or ends by the time limit); what matters is that the server stays up.
const hostile = ['stored', 'unreadable', 'too_complex'];
await phase('Hostile PDFs, one after the other: bitmaps that expand to 400 MB, 1.2 GB and 2.1 GB; progressive JPEGs of 196 and 400 megapixels', async () => [
  expectOutcome('400 MB bitmap', await upload('bomb-400.pdf', files.bomb400), hostile),
  expectOutcome('1.2 GB bitmap', await upload('bomb-1200.pdf', files.bomb1200), hostile),
  expectOutcome('2.1 GB bitmap', await upload('bomb-2100.pdf', files.bomb2100), hostile),
  expectOutcome('progressive JPEG, 196 MP', await upload('progressive-600.pdf', files.progressive600), hostile),
  expectOutcome('progressive JPEG, 400 MP', await upload('progressive-1200.pdf', files.progressive1200), hostile),
]);

await phase('Hostile PDFs together with large uploads: 30 pages of 430 MB bitmaps, three progressive JPEGs, the scan again and two photos', async () => {
  const [pagesBomb, big, scan] = await Promise.all([upload('bomb-pages.pdf', files.bombPages), upload('progressive-pages.pdf', files.progressivePages), upload('scan-again.pdf', Buffer.concat([files.scan, Buffer.from('\n')]))]);
  const photos = await Promise.all([upload('photo-4.jpg', Buffer.concat([files.photo, Buffer.from([0])])), upload('photo-5.jpg', Buffer.concat([files.photo, Buffer.from([0, 0])]))]);
  return [
    expectOutcome('30 × 430 MB bitmaps', pagesBomb, hostile),
    expectOutcome('3 × progressive JPEG, 196 MP', big, hostile),
    expectOutcome('scan again', scan, ['stored']),
    ...photos.map((photo, index) => expectOutcome(`photo-${index + 4}.jpg (48 MP)`, photo, ['stored'])),
    await previews(pagesBomb.id, 'bomb-pages.pdf'),
    await previews(big.id, 'progressive-pages.pdf'),
    await previews(scan.id, 'scan-again.pdf'),
  ];
});

activity.running = false;
await Promise.all(background);

const inspect = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8' })) as { State: { OOMKilled: boolean; Status: string }; RestartCount: number; HostConfig: { Memory: number } }[];
const state = inspect[0];
const sorted = [...activity.latencies].sort((a, b) => a - b);
const percentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
const kills = oomKills();
const kernelPeak = Number(cgroup('memory.peak'));
const healthy = (await fetch(`${origin}/api/health/ready`)).ok;
if (kills > 0 || state?.State.OOMKilled === true || state?.State.Status !== 'running' || (state?.RestartCount ?? 0) > 0 || activity.failures > 0 || !healthy) failed = true;

console.log(`\nMemory limit of the container: ${((state?.HostConfig.Memory ?? 0) / 2 ** 30).toFixed(1)} GiB`);
console.log(`Idle before the test: ${(idle / MB).toFixed(0)} MB`);
for (const result of results) console.log(`\n${result}`);
console.log(`\nPeak memory of the container (kernel): ${(kernelPeak / MB).toFixed(0)} MB = ${((kernelPeak / (state?.HostConfig.Memory ?? 1)) * 100).toFixed(0)} % of the limit`);
console.log(`Processes killed for memory: ${kills}; container restarted: ${state?.RestartCount ?? '?'}; container ${state?.State.Status}; server ready: ${healthy}`);
console.log(`Ordinary requests meanwhile: ${activity.requests}, failed: ${activity.failures}; latency median ${percentile(0.5).toFixed(0)} ms, 95 % ${percentile(0.95).toFixed(0)} ms, 99 % ${percentile(0.99).toFixed(0)} ms, slowest ${percentile(1).toFixed(0)} ms`);
console.log(failed ? '\nMEMORY CHECK FAILED' : '\nmemory check passed');
process.exit(failed ? 1 : 0);
