import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import type { Plugin } from 'vite';

/** Package directory of a bundled module (`…/node_modules/<name>` or `…/node_modules/@scope/<name>`). */
export function packageRootOf(moduleId: string): string | null {
  const path = moduleId.split('?')[0] ?? '';
  const marker = `${sep}node_modules${sep}`;
  const index = path.lastIndexOf(marker);
  if (index === -1) return null;
  const rest = path.slice(index + marker.length).split(sep);
  const depth = rest[0]?.startsWith('@') === true ? 2 : 1;
  if (rest.length <= depth) return null;
  return path.slice(0, index + marker.length) + rest.slice(0, depth).join(sep);
}

function licenseText(root: string): string {
  const file = readdirSync(root).find((name) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(name));
  return file === undefined ? '(no license file in the package)' : readFileSync(join(root, file), 'utf8').trim();
}

/** Text of the notices for the given package directories, sorted by name. */
export function noticesFor(roots: Iterable<string>): string {
  const entries = [...new Set(roots)]
    .filter((root) => existsSync(join(root, 'package.json')))
    .map((root) => {
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string; version: string; license?: string };
      return { name: pkg.name, version: pkg.version, license: pkg.license ?? 'UNKNOWN', text: licenseText(root) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const header = [
    'VergissMeinNicht (VMN) — third-party software in the web app',
    'VergissMeinNicht itself is licensed under AGPL-3.0-only (see LICENSE in the source code).',
    'The web app bundles the following packages:',
    '',
  ];
  return [...header, ...entries.map((entry) => `${'='.repeat(72)}\n${entry.name}@${entry.version} (${entry.license})\n\n${entry.text}\n`)].join('\n');
}

/**
 * Emits `third-party-notices.txt` with the license of every npm package that ends up in the web
 * bundle (not the dev tooling). Built from the bundle itself, so it never drifts from what ships.
 */
export function thirdPartyNotices(): Plugin {
  return {
    name: 'vmn-third-party-notices',
    apply: 'build',
    generateBundle(_options, bundle) {
      const roots = new Set<string>();
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        for (const id of output.moduleIds) {
          const root = packageRootOf(id);
          // Our own workspace packages are linked into node_modules too; they are part of this project.
          if (root !== null && !root.includes(`${sep}@vergissmeinnicht${sep}`) && !dirname(root).endsWith(`${sep}@vergissmeinnicht`)) roots.add(root);
        }
      }
      this.emitFile({ type: 'asset', fileName: 'third-party-notices.txt', source: noticesFor(roots) });
    },
  };
}
