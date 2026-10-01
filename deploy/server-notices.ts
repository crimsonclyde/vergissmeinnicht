// Licence notices of the server's runtime dependencies (14.3, T5), generated while building the image
// from the pruned production tree (`node_modules/.pnpm`), so the notices match what ships:
//   node deploy/server-notices.ts node_modules/.pnpm > third-party-notices-server.txt
// The prebuilt libvips binaries used by sharp ship no licence file; their README lists the bundled
// libraries and licences, and the LGPL/MPL texts are in the image under /usr/share/common-licenses.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

interface Notice {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly text: string;
}

function licenseText(root: string): string | undefined {
  const file = readdirSync(root).find((name) => /^(licen[cs]e|copying|notice)(\.(md|txt))?$/i.test(name));
  return file === undefined ? undefined : readFileSync(join(root, file), 'utf8').trim();
}

/** The licensing section of a README (sharp-libvips lists its bundled libraries there). */
function licensingSection(root: string): string | undefined {
  const readme = join(root, 'README.md');
  if (!existsSync(readme)) return undefined;
  const match = /## Licensing\n([\s\S]*?)(\n## |$)/.exec(readFileSync(readme, 'utf8'));
  return match?.[1]?.trim();
}

/** Every package directory in a pnpm virtual store (`<store>/<id>/node_modules/<name>`). */
export function packageRoots(store: string): string[] {
  const roots = new Set<string>();
  for (const id of readdirSync(store)) {
    const modules = join(store, id, 'node_modules');
    if (!existsSync(modules)) continue;
    for (const entry of readdirSync(modules)) {
      const names = entry.startsWith('@') ? readdirSync(join(modules, entry)).map((name) => join(entry, name)) : [entry];
      for (const name of names) {
        const root = join(modules, name);
        if (existsSync(join(root, 'package.json'))) roots.add(root);
      }
    }
  }
  return [...roots];
}

export function serverNotices(store: string): string {
  const notices = new Map<string, Notice>();
  for (const root of packageRoots(store)) {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name?: string; version?: string; license?: string };
    // Our own workspace packages are part of this project (AGPL-3.0-only).
    if (pkg.name === undefined || pkg.name.startsWith('@vergissmeinnicht/')) continue;
    const key = `${pkg.name}@${pkg.version ?? '?'}`;
    if (notices.has(key)) continue;
    const license = pkg.license ?? 'UNKNOWN';
    const section = licensingSection(root);
    let text = licenseText(root);
    if (text === undefined && section !== undefined) {
      text = `${section}\n\nThe full texts of the LGPL-3.0 (with the GPL-3.0 it refers to) and MPL-1.1 are in this image under /usr/share/common-licenses (LGPL-3, GPL-3, MPL-1.1).`;
    }
    notices.set(key, { name: pkg.name, version: pkg.version ?? '?', license, text: text ?? '(no licence file in the package)' });
  }
  const entries = [...notices.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  const header = [
    'VergissMeinNicht (VMN) — third-party software in the server',
    'VergissMeinNicht itself is licensed under AGPL-3.0-only (see LICENSE). The web app has its own',
    'notices (third-party-notices.txt, served with the app). The server uses the following packages:',
    '',
  ];
  return [...header, ...entries.map((entry) => `${'='.repeat(72)}\n${entry.name}@${entry.version} (${entry.license})\n\n${entry.text}\n`)].join('\n');
}

if (import.meta.main) {
  const store = process.argv[2];
  if (store === undefined) {
    console.error('Usage: node deploy/server-notices.ts <node_modules/.pnpm>');
    process.exit(2);
  }
  process.stdout.write(serverNotices(store));
}
