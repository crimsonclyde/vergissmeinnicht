import { Resolver } from 'node:dns/promises';
import type { IncomingMessage } from 'node:http';
import { request, type RequestOptions } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { checkServerIdentity } from 'node:tls';
import { AttachmentError } from '@vergissmeinnicht/application';
import { CHATGPT_EXTRA_FILE_HOST } from '@vergissmeinnicht/domain';

export const CHATGPT_LEGACY_FILE_ORIGIN = 'https://files.oaiusercontent.com';
// Azure storage account names are first come, first served, so a name pattern is not proof of
// ownership. Only exact accounts observed in live ChatGPT transfers are built in; an operator can
// add another exact host with MCP_CHATGPT_FILE_HOSTS, or a server admin allows a reported one in
// Server admin → AI connections (36.25), without a release or restart.
// oaisdmntprdenmarkeast: seen 2026-11-13 for an image ChatGPT cropped out of an uploaded PDF; it is the
// Azure account behind the regional sdmntprdenmarkeast.oaiusercontent.com label, named like northeu.
const CHATGPT_BLOB_HOSTS = new Set(['oaisdmntprnortheu.blob.core.windows.net', 'oaisdmntprdenmarkeast.blob.core.windows.net']);
// OpenAI's own domain serves its signed file storage under one regional label (for example
// sdmntprdenmarkeast or sdmntswcentralus). Other labels and deeper subdomains stay refused.
const CHATGPT_REGIONAL_FILE_HOST = /^sdmnt[a-z]{2}[a-z0-9]{1,54}\.oaiusercontent\.com$/;
export { CHATGPT_EXTRA_FILE_HOST };
/** Exact extra hosts: a fixed list (tests) or a function read on every transfer (env + Server admin). */
export type ChatGptExtraHosts = readonly string[] | (() => readonly string[]);
const hostsOf = (extra: ChatGptExtraHosts) => typeof extra === 'function' ? extra() : extra;

export class ChatGptFileError extends Error {
  readonly code: 'file_source_invalid' | 'file_origin_unsupported' | 'file_download_failed' | 'file_unavailable';
  /** Only for file_origin_unsupported: the refused host name, never the signed path or query. */
  readonly host: string | undefined;

  constructor(code: ChatGptFileError['code'], host?: string) {
    super(code);
    this.code = code;
    this.host = host;
  }
}

export function chatGptFileUrl(input: string, extraHosts: ChatGptExtraHosts = []): URL {
  if (!input.startsWith('https://') || input.length > 8192 || /[\p{Cc}\s\\]/u.test(input)) throw new ChatGptFileError('file_source_invalid');
  let url: URL;
  try { url = new URL(input); } catch { throw new ChatGptFileError('file_source_invalid'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.pathname === '/') {
    throw new ChatGptFileError('file_source_invalid');
  }
  if (url.origin === CHATGPT_LEGACY_FILE_ORIGIN) return url;
  const signedBlobOrigin = url.port === '' && (CHATGPT_BLOB_HOSTS.has(url.hostname) ||
    CHATGPT_REGIONAL_FILE_HOST.test(url.hostname) || hostsOf(extraHosts).includes(url.hostname));
  if (signedBlobOrigin && /^\/[^/]+\/.+/.test(url.pathname) &&
      ![...url.searchParams.keys()].some(key => ['snapshot', 'versionid'].includes(key.toLowerCase())) &&
      url.searchParams.getAll('sig').length === 1 && url.searchParams.get('sig')) return url;
  // Report a refused DNS name so an operator can review it. Never an address literal or the signed path.
  const host = isIP(url.hostname.replace(/^\[|\]$/g, '')) === 0 && /^[a-z0-9.-]{1,253}$/.test(url.hostname) ? url.hostname : undefined;
  throw new ChatGptFileError('file_origin_unsupported', host);
}

const nonPublicV4 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3],
] as const) nonPublicV4.addSubnet(network, prefix);
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const specialV6 = new BlockList();
for (const [network, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) {
  specialV6.addSubnet(network, prefix, 'ipv6');
}

function isPublic(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !nonPublicV4.check(address) :
    family === 6 && globalV6.check(address, 'ipv6') && !specialV6.check(address, 'ipv6');
}

type FileHostResolver = Pick<Resolver, 'resolve4' | 'resolve6'>;

export async function resolveFileHost(host: string, resolver: FileHostResolver = new Resolver({ timeout: 3000, tries: 1 })): Promise<string[]> {
  // One address family is enough. Some home routers and Docker DNS setups fail AAAA lookups
  // with SERVFAIL or a timeout instead of an empty answer; that must not block an IPv4 download.
  const [v4, v6] = await Promise.allSettled([resolver.resolve4(host), resolver.resolve6(host)]);
  const addresses = [v4, v6].flatMap(result => result.status === 'fulfilled' ? result.value : []);
  if (!addresses.length && v4.status === 'rejected') throw v4.reason;
  return addresses;
}

function getFile(options: RequestOptions): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = request(options, resolve);
    req.once('error', reject);
    req.end();
  });
}

export type ChatGptFileSource = (url: URL, maxBytes: number) => AsyncIterable<Uint8Array>;

/** Resolve only a reviewed file endpoint and connect to one of its verified public addresses. */
export function createChatGptFileSource(resolve: (host: string) => Promise<string[]> = host => resolveFileHost(host), get = getFile, extraHosts: ChatGptExtraHosts = []): ChatGptFileSource {
  let active = 0;
  return async function* (input, maxBytes) {
    const url = chatGptFileUrl(input.href, extraHosts);
    const host = url.hostname;
    if (active >= 2) throw new AttachmentError('attachment_busy');
    active++;
    let response: IncomingMessage | undefined;
    try {
      const addresses = await resolve(host);
      const address = addresses[0];
      if (!address || !addresses.every(isPublic)) throw new ChatGptFileError('file_download_failed');
      response = await get({
        hostname: address, port: 443, path: url.pathname + url.search, method: 'GET',
        servername: host, checkServerIdentity: (_name, cert) => checkServerIdentity(host, cert),
        minVersion: 'TLSv1.2', rejectUnauthorized: true, agent: false,
        signal: AbortSignal.timeout(20_000), headers: { host, 'accept-encoding': 'identity' },
      });
      if ([401, 403, 404, 410].includes(response.statusCode ?? 0)) throw new ChatGptFileError('file_unavailable');
      if (response.statusCode !== 200 || (response.headers['content-encoding'] ?? 'identity') !== 'identity') {
        throw new ChatGptFileError('file_download_failed');
      }
      const declared = response.headers['content-length'];
      if (declared !== undefined && !/^\d+$/.test(declared)) throw new ChatGptFileError('file_download_failed');
      if (declared !== undefined && Number(declared) > maxBytes) throw new AttachmentError('attachment_too_large');
      let received = 0;
      for await (const chunk of response as AsyncIterable<Buffer>) {
        received += chunk.byteLength;
        if (received > maxBytes) throw new AttachmentError('attachment_too_large');
        yield chunk;
      }
      if (!response.complete || (declared !== undefined && received !== Number(declared))) {
        throw new ChatGptFileError('file_download_failed');
      }
    } catch (error) {
      if (error instanceof ChatGptFileError || error instanceof AttachmentError) throw error;
      // Node networking errors can contain the signed URL or the selected IP.
      throw new ChatGptFileError('file_download_failed');
    } finally {
      response?.destroy();
      active--;
    }
  };
}
