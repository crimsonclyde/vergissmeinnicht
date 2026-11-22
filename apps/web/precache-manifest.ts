import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';

/** Public files (not hashed) the Home Screen app needs offline as well. */
export const PRECACHE_STATIC = ['/manifest.webmanifest', '/icon.svg', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png'] as const;

export interface PrecacheManifest {
  /** Changes whenever the set of files changes. */
  readonly version: string;
  /** Every same-origin file of this build the app may load: code, styles, fonts and artwork. */
  readonly files: readonly string[];
}

/** The manifest for a build's output file names (step 49.2). Source maps are never kept on devices. */
export function precacheManifestFor(fileNames: Iterable<string>): PrecacheManifest {
  const files = [...new Set([...fileNames].filter((name) => name.startsWith('assets/') && !name.endsWith('.map')).map((name) => `/${name}`))].sort();
  const all = [...files, ...PRECACHE_STATIC];
  const version = createHash('sha256').update(all.join('\n')).digest('hex').slice(0, 16);
  return { version, files: all };
}

/**
 * Writes `precache.json` next to `index.html` (49.2): the list of *all* files of this build, so the
 * service worker keeps every page's code — also the lazily loaded ones such as Notes, the Recipe editor
 * or the map — and not only the files `index.html` names.
 */
export function precacheManifest(): Plugin {
  return {
    name: 'vmn-precache-manifest',
    apply: 'build',
    generateBundle(_options, bundle) {
      this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify(precacheManifestFor(Object.keys(bundle))) });
    },
  };
}
