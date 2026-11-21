import { describe, expect, it } from 'vitest';
import { OutboundError, outboundAllowed, outboundFetch, readBounded, type Fetch } from './index.ts';

const ok = (body: string | Uint8Array, headers: Record<string, string> = {}) => new Response(body, { status: 200, headers });

describe('outbound client (45.10)', () => {
  it('allows only HTTPS on the default port to listed hosts, without credentials or fragment', () => {
    const allow = ['api.example.org'];
    expect(outboundAllowed(new URL('https://api.example.org/x?y=1'), allow)).toBe(true);
    for (const url of ['http://api.example.org/', 'https://api.example.org:8443/', 'https://u:p@api.example.org/', 'https://api.example.org/#x',
      'https://evil.example.org/', 'https://api.example.org.evil.test/']) expect(outboundAllowed(new URL(url), allow), url).toBe(false);
    expect(outboundAllowed(new URL('https://h.test/fixed'), (url) => url.pathname === '/fixed')).toBe(true);
    expect(outboundAllowed(new URL('https://h.test/other'), (url) => url.pathname === '/fixed')).toBe(false);
  });

  it('refuses a blocked URL without calling fetch, and sends no redirects or credentials', async () => {
    const calls: RequestInit[] = [];
    const fetch: Fetch = async (_url, init) => { calls.push(init ?? {}); return ok('{}'); };
    await expect(outboundFetch('https://other.test/', { allow: ['api.test'], fetch })).rejects.toMatchObject({ reason: 'blocked' });
    expect(calls).toHaveLength(0);
    await outboundFetch('https://api.test/', { allow: ['api.test'], fetch, method: 'POST', body: '{}' });
    expect(calls[0]).toMatchObject({ redirect: 'error', credentials: 'omit', method: 'POST', body: '{}' });
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('turns network errors into a reason that never carries the URL', async () => {
    const fetch: Fetch = async () => { throw new Error('connect ECONNREFUSED https://api.test/?key=secret'); };
    const error = await outboundFetch('https://api.test/?key=secret', { allow: ['api.test'], fetch }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OutboundError);
    expect(String((error as Error).message)).not.toContain('secret');
  });

  it('times out', async () => {
    const fetch: Fetch = (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    await expect(outboundFetch('https://api.test/', { allow: ['api.test'], fetch, timeoutMs: 20 })).rejects.toMatchObject({ reason: 'unreachable' });
  });

  it('reads at most maxBytes, checking a declared length first', async () => {
    expect((await readBounded(ok('hello'), 5)).toString()).toBe('hello');
    await expect(readBounded(ok('hello', { 'content-length': '5' }), 4)).rejects.toMatchObject({ reason: 'too_large' });
    await expect(readBounded(ok(new Uint8Array(10)), 4)).rejects.toMatchObject({ reason: 'too_large' });
    await expect(readBounded(ok('x', { 'content-length': '1e3' }), 4)).rejects.toMatchObject({ reason: 'bad_response' });
  });
});
