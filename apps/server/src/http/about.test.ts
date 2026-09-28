import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp } from './test-harness.ts';

describe('GET /api/about', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  beforeEach(async () => {
    t = await startTestApp();
  });
  afterEach(async () => t.close());

  it('offers the license and source link to everyone, signed in or not (AGPL-3.0 §13)', async () => {
    const response = await t.get('/api/about');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      license: 'AGPL-3.0-only',
      sourceCodeUrl: 'https://github.com/crimsonclyde/vergissmeinnicht',
      footerHidden: false,
    });
    expect(response.headers['cache-control']).toBe('no-store');
  });
});
