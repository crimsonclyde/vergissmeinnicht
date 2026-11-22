/**
 * The one outbound HTTP client of the server (45.10). Every request to another host goes through
 * `outboundFetch` and its body through `readBounded`, so the rules live in one place:
 *
 * - HTTPS only, default port, no credentials or fragment in the URL;
 * - the URL must pass the caller's allowlist (exact host names, or a function for fixed paths);
 * - redirects are refused (`redirect: 'error'`), cookies and credentials are never sent;
 * - every request has a timeout (combined with the caller's abort signal);
 * - a body is read streamed up to a byte limit, after checking a declared `content-length`;
 * - errors never carry the URL, headers or the underlying network error (a URL may hold a key or a
 *   signature): only a stable `reason`.
 *
 * The only exception is the ChatGPT file download (36.x), which connects to a DNS-pinned public address
 * with `node:https` and applies the same rules itself (`apps/server/src/integrations/chatgpt-files.ts`).
 */

export type Fetch = typeof globalThis.fetch;

export type OutboundFailure = 'blocked' | 'unreachable' | 'too_large' | 'bad_response';

export class OutboundError extends Error {
  readonly reason: OutboundFailure;
  constructor(reason: OutboundFailure) {
    super(`outbound_${reason}`);
    this.name = 'OutboundError';
    this.reason = reason;
  }
}

/** Exact host names, or a predicate over the parsed URL (for fixed paths and query rules). */
export type OutboundAllowlist = readonly string[] | ((url: URL) => boolean);

export const DEFAULT_TIMEOUT_MS = 10_000;

export interface OutboundRequest {
  readonly allow: OutboundAllowlist;
  readonly method?: 'GET' | 'POST';
  readonly headers?: Record<string, string>;
  readonly body?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  /** Injected in tests; the global fetch otherwise. */
  readonly fetch?: Fetch | undefined;
}

/** Whether `url` passes the general rules and the allowlist. */
export function outboundAllowed(url: URL, allow: OutboundAllowlist): boolean {
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '' || url.hash !== '') return false;
  return typeof allow === 'function' ? allow(url) : allow.includes(url.hostname);
}

/**
 * Sends one request under the rules above and returns the response with its body unread. The caller
 * reads it with `readBounded` / `readBoundedChunks` or cancels it with `discard`.
 */
export async function outboundFetch(input: URL | string, request: OutboundRequest): Promise<Response> {
  let url: URL;
  try {
    url = typeof input === 'string' ? new URL(input) : input;
  } catch {
    throw new OutboundError('blocked');
  }
  if (!outboundAllowed(url, request.allow)) throw new OutboundError('blocked');
  const timeout = AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = request.signal ? AbortSignal.any([timeout, request.signal]) : timeout;
  try {
    return await (request.fetch ?? globalThis.fetch)(url, {
      method: request.method ?? 'GET',
      headers: request.headers ?? {},
      ...(request.body === undefined ? {} : { body: request.body }),
      redirect: 'error',
      credentials: 'omit',
      signal,
    });
  } catch {
    throw new OutboundError('unreachable');
  }
}

/** Cancels an unread body (a refused status, a 304). */
export async function discard(response: Response): Promise<void> {
  if (!response.body?.locked) await response.body?.cancel().catch(() => undefined);
}

/**
 * Yields bounded chunks for streaming consumers, refusing more than `maxBytes`: a declared `content-length` above it (or not a
 * plain number) is refused before reading; otherwise the stream is cut as soon as it passes the limit.
 */
export async function* readBoundedChunks(response: Response, maxBytes: number): AsyncGenerator<Uint8Array> {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    await discard(response);
    throw new OutboundError(declared !== null && /^\d+$/.test(declared) ? 'too_large' : 'bad_response');
  }
  if (response.body === null) return;
  let size = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new OutboundError('too_large');
      }
      yield value;
    }
  } catch (error) {
    if (error instanceof OutboundError) throw error;
    throw new OutboundError('unreachable');
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export async function readBounded(response: Response, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of readBoundedChunks(response, maxBytes)) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
