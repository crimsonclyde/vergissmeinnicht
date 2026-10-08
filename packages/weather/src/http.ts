import { WeatherProviderError, type WeatherFailure } from '@vergissmeinnicht/application';

export type Fetch = typeof fetch;

/** Every provider answer is read through this bound: a few hundred KiB at most, then refused. */
export const MAX_RESPONSE_BYTES = 512 * 1024;
export const TIMEOUT_MS = 8_000;

export interface ProviderResponse {
  readonly status: number;
  readonly headers: Headers;
  /** Parsed JSON, or `undefined` for 304. */
  readonly body: unknown;
}

/**
 * One GET to a fixed provider URL (19.4): HTTPS only, redirects refused, a timeout, a streamed size cap,
 * JSON only. The URL is never logged or put into an error — with credentials (19.4b) it may hold a key.
 * Every failure becomes a `WeatherProviderError` with a stable reason.
 */
export async function getJson(doFetch: Fetch, url: URL, headers: Record<string, string>, options: { readonly timeoutMs?: number; readonly classify?: (status: number) => WeatherFailure | undefined } = {}): Promise<ProviderResponse> {
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  if (url.protocol !== 'https:') throw new WeatherProviderError('unavailable');
  let response: Response;
  try {
    response = await doFetch(url, { method: 'GET', headers: { accept: 'application/json', ...headers }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new WeatherProviderError('unavailable');
  }
  if (response.status === 304) {
    await response.body?.cancel();
    return { status: 304, headers: response.headers, body: undefined };
  }
  // A provider's own meaning of a status (e.g. 401 = bad credentials) first; credentials never appear in the error.
  const special = response.ok ? undefined : options.classify?.(response.status);
  if (special !== undefined) {
    await response.body?.cancel();
    throw new WeatherProviderError(special);
  }
  if (response.status === 429) {
    await response.body?.cancel();
    throw new WeatherProviderError('rate_limited');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new WeatherProviderError(response.status === 400 ? 'not_covered' : 'unavailable');
  }
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new WeatherProviderError('bad_response');
  }
  const reader = response.body?.getReader();
  if (reader === undefined) throw new WeatherProviderError('bad_response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new WeatherProviderError('bad_response');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof WeatherProviderError) throw error;
    throw new WeatherProviderError('unavailable');
  }
  try {
    return { status: response.status, headers: response.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown };
  } catch {
    throw new WeatherProviderError('bad_response');
  }
}

/** A finite number from untrusted JSON, else `undefined` — a missing value stays missing. */
export const finite = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** One decimal, as shown. */
export const round1 = (value: number | undefined): number | undefined => (value === undefined ? undefined : Math.round(value * 10) / 10);
