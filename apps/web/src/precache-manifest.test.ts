import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRECACHE_STATIC, precacheManifestFor } from '../precache-manifest.ts';

describe('precache manifest (48.2)', () => {
  it('lists every build file, lazily loaded chunks included, and the public icons', () => {
    const manifest = precacheManifestFor(['index.html', 'precache.json', 'assets/index-a.js', 'assets/JournalPage-b.js', 'assets/MarkdownEditor-c.js', 'assets/landscape-d.webp', 'assets/index-a.js.map']);
    expect(manifest.files).toEqual(['/assets/JournalPage-b.js', '/assets/MarkdownEditor-c.js', '/assets/index-a.js', '/assets/landscape-d.webp', ...PRECACHE_STATIC]);
    expect(manifest.files).not.toContain('/assets/index-a.js.map');
    expect(manifest.files).not.toContain('/index.html');
  });

  it('changes its version only when the files change', () => {
    const a = precacheManifestFor(['assets/a.js', 'assets/b.js']);
    expect(precacheManifestFor(['assets/b.js', 'assets/a.js']).version).toBe(a.version);
    expect(precacheManifestFor(['assets/a.js', 'assets/c.js']).version).not.toBe(a.version);
  });

  it('every listed public file exists, and the page names the Home Screen icon and name (48.1)', () => {
    const root = resolve(import.meta.dirname, '..');
    for (const path of PRECACHE_STATIC) expect(existsSync(resolve(root, 'public', path.slice(1)))).toBe(true);
    const html = readFileSync(resolve(root, 'index.html'), 'utf8');
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="VMN" />');
    const manifest = JSON.parse(readFileSync(resolve(root, 'public/manifest.webmanifest'), 'utf8')) as { icons: { src: string; type: string; purpose: string }[] };
    expect(manifest.icons.filter((icon) => icon.type === 'image/png').map((icon) => icon.src)).toEqual(['/icon-192.png', '/icon-512.png', '/icon-maskable-512.png']);
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });
});
