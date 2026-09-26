import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';

describe('server app', () => {
  let webDistDir: string;

  beforeAll(() => {
    webDistDir = mkdtempSync(join(tmpdir(), 'vmn-web-'));
    writeFileSync(join(webDistDir, 'index.html'), '<!doctype html><title>Vergissmeinnicht</title>');
  });
  afterAll(() => rmSync(webDistDir, { recursive: true, force: true }));

  it('reports health without caching', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(response.headers['cache-control']).toBe('no-store');
    await app.close();
  });

  it('sets baseline security headers', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    await app.close();
  });

  it('serves the SPA shell for client routes in production mode', async () => {
    const app = await buildApp({ webDistDir });
    const response = await app.inject({ method: 'GET', url: '/runs/some-client-route' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Vergissmeinnicht');
    await app.close();
  });

  it('never answers unknown API routes with the SPA shell', async () => {
    const app = await buildApp({ webDistDir });
    const response = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'Not Found' });
    await app.close();
  });
});
