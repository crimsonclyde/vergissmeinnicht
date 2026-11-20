import { WeatherProviderError, type WeatherFailure } from '@vergissmeinnicht/application';
import { discard, OutboundError, outboundFetch, readBounded, type Fetch } from '@vergissmeinnicht/outbound';

export type { Fetch };

/** Every provider answer is read through this bound: a few hundred KiB at most, then refused. */
export const MAX_RESPONSE_BYTES = 512 * 1024;
export const TIMEOUT_MS = 8_000;

/** Every host a weather adapter or Daily Planet source may call (19.4, 43.7); paths are fixed in each adapter. */
export const WEATHER_HOSTS = [
  'api.open-meteo.com', 'geocoding-api.open-meteo.com', 'api.met.no', 'api.openweathermap.org', 'api.meteomatics.com',
  'api.brightsky.dev', 'feeds.meteoalarm.org', 'allertaliguria.regione.liguria.it',
] as const;

export interface ProviderResponse {
  readonly status: number;
  readonly headers: Headers;
  /** Parsed JSON, or `undefined` for 304. */
  readonly body: unknown;
}

/**
 * One GET to a fixed provider URL (19.4) through the outbound client (45.10): an allow-listed host,
 * HTTPS only, redirects refused, a timeout, a streamed size cap, JSON only. The URL is never logged or put
 * into an error — with credentials (19.4b) it may hold a key. Every failure becomes a
 * `WeatherProviderError` with a stable reason.
 */
export async function getJson(doFetch: Fetch | undefined, url: URL, headers: Record<string, string>, options: { readonly timeoutMs?: number; readonly classify?: (status: number) => WeatherFailure | undefined; readonly maxBytes?: number; readonly text?: boolean } = {}): Promise<ProviderResponse> {
  let response: Response;
  try {
    response = await outboundFetch(url, { allow: WEATHER_HOSTS, fetch: doFetch, timeoutMs: options.timeoutMs ?? TIMEOUT_MS, headers: { accept: options.text ? 'text/html' : 'application/json', ...headers } });
  } catch {
    throw new WeatherProviderError('unavailable');
  }
  if (response.status === 304) {
    await discard(response);
    return { status: 304, headers: response.headers, body: undefined };
  }
  // A provider's own meaning of a status (e.g. 401 = bad credentials) first; credentials never appear in the error.
  const special = response.ok ? undefined : options.classify?.(response.status);
  if (special !== undefined) {
    await discard(response);
    throw new WeatherProviderError(special);
  }
  if (response.status === 429) {
    await discard(response);
    throw new WeatherProviderError('rate_limited');
  }
  if (!response.ok) {
    await discard(response);
    throw new WeatherProviderError(response.status === 400 ? 'not_covered' : 'unavailable');
  }
  if (response.body === null) throw new WeatherProviderError('bad_response');
  let bytes: Buffer;
  try {
    bytes = await readBounded(response, options.maxBytes ?? MAX_RESPONSE_BYTES);
  } catch (error) {
    throw new WeatherProviderError(error instanceof OutboundError && error.reason === 'unreachable' ? 'unavailable' : 'bad_response');
  }
  try {
    const text = bytes.toString('utf8');
    return { status: response.status, headers: response.headers, body: options.text ? text : JSON.parse(text) as unknown };
  } catch {
    throw new WeatherProviderError('bad_response');
  }
}

/** A finite number from untrusted JSON, else `undefined` — a missing value stays missing. */
export const finite = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** One decimal, as shown. */
export const round1 = (value: number | undefined): number | undefined => (value === undefined ? undefined : Math.round(value * 10) / 10);
