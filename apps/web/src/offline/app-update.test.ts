import { describe, expect, it } from 'vitest';
import { isNewerShell, shellScript, updateAction } from './app-update.ts';

const page = (script: string) => `<!doctype html><html><head><script type="module" crossorigin src="${script}"></script><link rel="stylesheet" crossorigin href="/assets/index-X4QHJp8V.css"></head><body><div id="root"></div></body></html>`;

describe('a new version of the app (17.5)', () => {
  it('is noticed when the server’s page loads another main script', () => {
    expect(shellScript(page('/assets/index-Cck915-r.js'))).toBe('/assets/index-Cck915-r.js');
    expect(isNewerShell('/assets/index-Cck915-r.js', page('/assets/index-NEW00000.js'))).toBe(true);
    expect(isNewerShell('/assets/index-Cck915-r.js', page('/assets/index-Cck915-r.js'))).toBe(false);
    // Not this app's page (a proxy error, a login page), or no running build to compare (development): nothing to say.
    expect(isNewerShell('/assets/index-Cck915-r.js', '<html><body>502 Bad Gateway</body></html>')).toBe(false);
    expect(isNewerShell(null, page('/assets/index-NEW00000.js'))).toBe(false);
  });

  it('never offers to reload while changes wait on this device, or without a connection', () => {
    expect(updateAction(2, true)).toEqual({ kind: 'send-first', count: 2 });
    expect(updateAction(1, false)).toEqual({ kind: 'send-first', count: 1 });
    expect(updateAction(0, false)).toEqual({ kind: 'offline' });
    expect(updateAction(0, true)).toEqual({ kind: 'reload' });
  });
});
