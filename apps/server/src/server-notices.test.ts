import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { serverNotices } from '../../../deploy/server-notices.ts';

describe('server licence notices (14.3, T5)', () => {
  it('lists the image processing libraries with their licences', () => {
    const notices = serverNotices(resolve(import.meta.dirname, '../../../node_modules/.pnpm'));
    expect(notices).toContain('sharp@0.35.5 (Apache-2.0)');
    expect(notices).toMatch(/@img\/sharp-libvips-linux-(x64|arm64)@[\d.]+ \(LGPL-3.0-or-later\)/);
    expect(notices).toContain('/usr/share/common-licenses');
    expect(notices).toContain('yauzl@3.4.0 (MIT)');
    // Document files (16.1): the PDF renderer, shipped as WebAssembly.
    expect(notices).toContain('mupdf@1.28.1 (AGPL-3.0-or-later)');
    // No HEVC decoder is shipped (HEIC previews are deferred pending a licensing and patent review, HT1).
    expect(notices).not.toMatch(/libheif-js|libde265|heic-decode/);
    expect(notices).not.toContain('@vergissmeinnicht/');
  });
});
