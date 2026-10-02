import { createHash } from 'node:crypto';
import yauzl, { type Entry } from 'yauzl';
import { describe, expect, it } from 'vitest';
import { documentsIndexHtml, documentsMetadata, escapeHtml, writeDocumentsArchive, type ArchiveDocument, type DocumentsArchiveInput } from './documents-archive.ts';

const bytes = (text: string, size = 2000) => {
  const data = Buffer.alloc(size, 7);
  data.write(text);
  return data;
};
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const opened: string[] = [];
const file = (page: number, path: string[], originalName: string, data: Buffer) => ({
  page,
  path,
  originalName,
  format: 'JPEG',
  bytes: data.byteLength,
  sha256: sha(data),
  pageCount: 1,
  open: async () => {
    opened.push(path.join('/'));
    return (async function* () {
      yield data.subarray(0, 700);
      yield data.subarray(700);
    })();
  },
});
const photos = [bytes('photo one'), bytes('photo two', 3000), bytes('photo three', 10)];
const bill: ArchiveDocument = {
  id: '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f',
  title: 'Water bill March',
  folderNames: ['Water'],
  directory: ['Water', 'Water bill March'],
  type: { kind: 'builtin', key: 'bill' },
  documentDate: '2026-03-12',
  year: 2026,
  notes: 'Paid on 30 March\nsecond line',
  tags: ['Water', 'Paid'],
  uploadedAt: new Date('2026-04-03T09:30:00Z'),
  uploadedByName: 'Uma',
  modifiedAt: new Date('2026-05-01T08:00:00Z'),
  modifiedByName: 'Ada',
  files: photos.map((data, index) => file(index + 1, ['Water', 'Water bill March', `0${index + 1} - IMG_000${index + 1}.jpg`], `IMG_000${index + 1}.jpg`, data)),
};
const hostile: ArchiveDocument = {
  ...bill,
  id: '4f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f',
  title: '../../x<script>alert(1)</script>',
  folderNames: ['<img src=x onerror=alert(2)>'],
  directory: ['_img src=x onerror=alert(2)_', '_.._x_script_alert(1)__script_'],
  type: { kind: 'custom', name: '"><svg onload=alert(3)>' },
  notes: '</dd><script>alert(4)</script> & "quotes" \'single\'',
  tags: ['<b>bold</b>'],
  uploadedByName: 'Mallory <mallory@example.org>',
  files: [file(1, ['_img src=x onerror=alert(2)_', '_.._x_script_alert(1)__script_', '01 - java script_alert(5) #?&.jpg'], 'javascript:alert(5)', bytes('evil'))],
};
const input = (documents: ArchiveDocument[] = [bill, hostile]): DocumentsArchiveInput => ({
  workspaceName: 'Home & <Garden>',
  folderName: null,
  scope: 'all',
  exportedAt: new Date('2026-10-02T08:00:00Z'),
  exportedByName: 'Gus',
  documents,
});

async function collect(stream: AsyncIterable<unknown>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** Every entry of a ZIP with its content, read with the strict reader the imports use. */
function unzip(buffer: Buffer): Promise<Map<string, { data: Buffer; method: number }>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, zip) => {
      if (error !== null || zip === undefined) return reject(error ?? new Error('no zip'));
      const entries = new Map<string, { data: Buffer; method: number }>();
      zip.on('end', () => resolve(entries));
      zip.on('error', reject);
      zip.on('entry', (entry: Entry) => {
        zip.openReadStream(entry, (failed, stream) => {
          if (failed !== null || stream === undefined) return reject(failed ?? new Error('no stream'));
          collect(stream).then((data) => {
            entries.set(entry.fileName, { data, method: entry.compressionMethod });
            zip.readEntry();
          }, reject);
        });
      });
      zip.readEntry();
    });
  });
}

describe('Documents export archive (16.4)', () => {
  it('holds the originals byte-identical under their paths, with metadata.json and index.html', async () => {
    opened.length = 0;
    const stream = writeDocumentsArchive(input([bill]));
    expect(opened).toEqual([]); // nothing is opened before its turn
    const entries = await unzip(await collect(stream));
    expect([...entries.keys()]).toEqual(['index.html', 'metadata.json', 'Water/Water bill March/01 - IMG_0001.jpg', 'Water/Water bill March/02 - IMG_0002.jpg', 'Water/Water bill March/03 - IMG_0003.jpg']);
    for (const [index, data] of photos.entries()) {
      const entry = entries.get(`Water/Water bill March/0${index + 1} - IMG_000${index + 1}.jpg`);
      expect(entry?.data.equals(data)).toBe(true);
      expect(entry?.method).toBe(0); // stored, not compressed
    }
    expect(opened).toEqual(['Water/Water bill March/01 - IMG_0001.jpg', 'Water/Water bill March/02 - IMG_0002.jpg', 'Water/Water bill March/03 - IMG_0003.jpg']);
    const metadata = JSON.parse(entries.get('metadata.json')?.data.toString('utf8') ?? '') as Record<string, unknown>;
    expect(metadata).toMatchObject({ format: 'vergissmeinnicht.documents-export', version: 1, workspace: 'Home & <Garden>', scope: 'all', folder: null, exportedBy: 'Gus', exportedAt: '2026-10-02T08:00:00.000Z' });
    expect((metadata.documents as unknown[])[0]).toEqual({
      id: bill.id,
      title: 'Water bill March',
      folder: ['Water'],
      path: 'Water/Water bill March',
      type: { builtIn: 'bill' },
      documentDate: '2026-03-12',
      year: 2026,
      notes: 'Paid on 30 March\nsecond line',
      tags: ['Water', 'Paid'],
      uploadedAt: '2026-04-03T09:30:00.000Z',
      uploadedBy: 'Uma',
      lastModifiedAt: '2026-05-01T08:00:00.000Z',
      lastModifiedBy: 'Ada',
      files: photos.map((data, index) => ({ page: index + 1, path: `Water/Water bill March/0${index + 1} - IMG_000${index + 1}.jpg`, originalName: `IMG_000${index + 1}.jpg`, format: 'JPEG', bytes: data.byteLength, sha256: sha(data), pdfPages: null })),
      links: [],
    });
    const html = entries.get('index.html')?.data.toString('utf8') ?? '';
    expect(html).toContain('<a href="./Water/Water%20bill%20March/02%20-%20IMG_0002.jpg">Page 2: IMG_0002.jpg</a>');
    expect(html).toContain('<h3>Water bill March</h3>');
    expect(html).toContain('<dd>Bill</dd>');
  });

  it('writes an index that is inert whatever titles, names and notes contain', () => {
    const html = documentsIndexHtml(input());
    // No element or attribute that could run or load anything; the only markup is the fixed skeleton.
    // (Escaped text holds no raw `<` or `>`, so every tag found here is one the generator wrote.)
    const tags = [...html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s[^<>]*)?)>/g)];
    expect([...new Set(tags.map((tag) => tag[1]?.toLowerCase()))].sort()).toEqual(['a', 'article', 'body', 'dd', 'dl', 'dt', 'h1', 'h2', 'h3', 'head', 'html', 'li', 'meta', 'p', 'section', 'small', 'style', 'title', 'ul']);
    const attributes = new Set(tags.flatMap((tag) => [...(tag[2] ?? '').matchAll(/\s([a-zA-Z-]+)="/g)].map((attribute) => attribute[1])));
    expect([...attributes].sort()).toEqual(['charset', 'class', 'content', 'href', 'http-equiv', 'lang', 'name']); // no src, no on…, no style attribute
    expect(html.split('<').length - 1).toBe(tags.length + 1); // every `<` opens one of those tags, or the doctype
    expect(html.match(/<a /g)).toHaveLength(1 + 3 + 1); // metadata.json and one per file
    for (const link of html.matchAll(/href="([^"]*)"/g)) expect(link[1]).toMatch(/^\.\/[A-Za-z0-9%._~()!*'-]+(\/[A-Za-z0-9%._~()!*'-]+)*$/); // relative, into the archive, nothing else
    expect(html).not.toMatch(/https?:/);
    expect(html).toContain("default-src 'none'");
    // The hostile values are there — as text.
    expect(html).toContain('<h3>../../x&lt;script&gt;alert(1)&lt;/script&gt;</h3>');
    expect(html).toContain('&lt;/dd&gt;&lt;script&gt;alert(4)&lt;/script&gt; &amp; &quot;quotes&quot; &#39;single&#39;');
    expect(html).toContain('<h2>&lt;img src=x onerror=alert(2)&gt;</h2>');
    expect(html).toContain('&quot;&gt;&lt;svg onload=alert(3)&gt;');
    expect(html).toContain('Page 1: javascript:alert(5)</a>');
    expect(html).toContain('href="./_img%20src%3Dx%20onerror%3Dalert(2)_/_.._x_script_alert(1)__script_/01%20-%20java%20script_alert(5)%20%23%3F%26.jpg"');
    expect(html).toContain('<title>Documents of Home &amp; &lt;Garden&gt;</title>');
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
    // The metadata keeps the stored values exactly (it is data, not markup).
    const metadata = JSON.parse(documentsMetadata(input())) as { documents: { title: string; type: unknown; files: { originalName: string }[] }[] };
    expect(metadata.documents[1]).toMatchObject({ title: '../../x<script>alert(1)</script>', type: { custom: '"><svg onload=alert(3)>' }, files: [{ originalName: 'javascript:alert(5)' }] });
    // An empty export still is a page.
    expect(documentsIndexHtml(input([]))).toContain('<p>No documents.</p>');
  });

  it('refuses an unsafe path outright and ends with an error when a file cannot be opened', async () => {
    const traversal = { ...bill, files: [file(1, ['..', 'outside.jpg'], 'x.jpg', bytes('x'))] };
    expect(() => writeDocumentsArchive(input([traversal]))).toThrow();
    const absolute = { ...bill, files: [file(1, ['', 'etc', 'passwd'], 'x.jpg', bytes('x'))] };
    expect(() => writeDocumentsArchive(input([absolute]))).toThrow();
    const missing = { ...bill, files: [{ ...file(1, ['a.jpg'], 'a.jpg', bytes('a')), open: async () => Promise.reject(new Error('file is gone')) }] };
    await expect(collect(writeDocumentsArchive(input([missing])))).rejects.toThrow('file is gone');
  });
});
