import { Resolver } from 'node:dns/promises';
import type { IncomingMessage } from 'node:http';
import { request, type RequestOptions } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { checkServerIdentity } from 'node:tls';
import { AttachmentError } from '@vergissmeinnicht/application';

export const CHATGPT_LEGACY_FILE_ORIGIN = 'https://files.oaiusercontent.com';
const CHATGPT_BLOB_ORIGIN = 'https://oaisdmntprnortheu.blob.core.windows.net';
// ChatGPT-generated files use regional hosts in OpenAI's own storage namespace.
// Do not generalize this to arbitrary oaiusercontent subdomains or Azure accounts.
const CHATGPT_REGIONAL_FILE_HOST = /^sdmntpr[a-z0-9]{1,56}\.oaiusercontent\.com$/;

export class ChatGptFileError extends Error {
  readonly code: 'file_source_invalid' | 'file_origin_unsupported' | 'file_download_failed' | 'file_unavailable';

  constructor(code: ChatGptFileError['code']) {
    super(code);
    this.code = code;
  }
}

export function chatGptFileUrl(input: string): URL {
  if (!input.startsWith('https://') || input.length > 8192 || /[\p{Cc}\s\\]/u.test(input)) throw new ChatGptFileError('file_source_invalid');
  let url: URL;
  try { url = new URL(input); } catch { throw new ChatGptFileError('file_source_invalid'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.pathname === '/') {
    throw new ChatGptFileError('file_source_invalid');
  }
  if (url.origin === CHATGPT_LEGACY_FILE_ORIGIN) return url;
  const signedBlobOrigin = url.origin === CHATGPT_BLOB_ORIGIN ||
    (url.port === '' && CHATGPT_REGIONAL_FILE_HOST.test(url.hostname));
  if (signedBlobOrigin && /^\/[^/]+\/.+/.test(url.pathname) &&
      ![...url.searchParams.keys()].some(key => ['snapshot', 'versionid'].includes(key.toLowerCase())) &&
      url.searchParams.getAll('sig').length === 1 && url.searchParams.get('sig')) return url;
  throw new ChatGptFileError('file_origin_unsupported');
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

async function resolveFileHost(host: string): Promise<string[]> {
  const resolver = new Resolver({ timeout: 3000, tries: 1 });
  const optional = (query: Promise<string[]>) => query.catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENODATA') return [];
    throw error;
  });
  return (await Promise.all([optional(resolver.resolve4(host)), optional(resolver.resolve6(host))])).flat();
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
export function createChatGptFileSource(resolve = resolveFileHost, get = getFile): ChatGptFileSource {
  let active = 0;
  return async function* (input, maxBytes) {
    const url = chatGptFileUrl(input.href);
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
