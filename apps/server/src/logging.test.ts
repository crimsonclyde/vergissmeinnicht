import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import { loggerOptions, redactUrl } from './logging.ts';

describe('redactUrl', () => {
  it.each([
    ['/knot/abcDEF123', '/knot/[REDACTED]'],
    ['/knot/abcDEF123/details', '/knot/[REDACTED]/details'],
    ['/api/knot/abcDEF123', '/api/knot/[REDACTED]'],
    ['/invite/abcDEF123', '/invite/[REDACTED]'],
    ['/api/invitations/abcDEF123', '/api/invitations/[REDACTED]'],
    ['/api/health?token=abc', '/api/health?[REDACTED]'],
    ['/runs/123#frag', '/runs/123?[REDACTED]'],
    ['/api/health', '/api/health'],
  ])('%s -> %s', (input, expected) => {
    expect(redactUrl(input)).toBe(expected);
  });
});

describe('request logging', () => {
  it('redacts credentials headers and path tokens', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    });
    const app = await buildApp({ logger: { ...loggerOptions('debug'), stream } });
    await app.inject({
      method: 'GET',
      url: '/knot/super-secret-knot-token?invite=secret-query-token',
      headers: { cookie: 'session=secret-session-id', authorization: 'Bearer secret-bearer' },
    });
    await app.close();

    const output = lines.join('');
    expect(output).toContain('/knot/[REDACTED]');
    for (const secret of ['super-secret-knot-token', 'secret-query-token', 'secret-session-id', 'secret-bearer']) {
      expect(output).not.toContain(secret);
    }
  });
});
