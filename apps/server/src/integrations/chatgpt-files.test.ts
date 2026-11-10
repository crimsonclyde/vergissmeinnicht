import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { chatGptFileUrl, createChatGptFileSource } from './chatgpt-files.ts';

const url = chatGptFileUrl('https://files.oaiusercontent.com/file-fixture?sig=short-lived');

function response(statusCode: number, chunks: readonly string[], headers: IncomingMessage['headers'] = {}, complete = true) {
  return Object.assign(Readable.from(chunks.map(chunk => Buffer.from(chunk))), { statusCode, headers, complete }) as unknown as IncomingMessage;
}

async function collect(source: AsyncIterable<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  for await (const chunk of source) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}

describe('ChatGPT file download policy', () => {
  it.each([
    '/mnt/data/file-fixture.png', 'sandbox:/mnt/data/file-fixture.png',
    'http://files.oaiusercontent.com/file-fixture', 'https://files.oaiusercontent.com@evil.example/file-fixture',
    'https://user@files.oaiusercontent.com/file-fixture', 'https://files.oaiusercontent.com/file-fixture#fragment',
    'blob:https://files.oaiusercontent.com/file-fixture', 'https://files.oaiusercontent.com\\@evil.example/file-fixture',
  ])('refuses malformed or unsafe file URLs', input => {
    expect(() => chatGptFileUrl(input)).toThrow('file_source_invalid');
  });

  it.each([
    'https://files.oaiusercontent.com:444/file-fixture', 'https://files.oaiusercontent.com.evil.example/file-fixture',
    'https://127.0.0.1/file-fixture', 'https://[::1]/file-fixture',
    'https://chatgpt.com/backend-api/estuary/content?id=file-one&sig=example',
    'https://oaisdmntprnortheu.blob.core.windows.net:444/container/file?sig=example',
    'https://oaisdmntprnortheu.blob.core.windows.net.evil.example/container/file?sig=example',
    'https://anotheraccount.blob.core.windows.net/container/file?sig=example',
    'https://oaisdmntprnortheu.blob.core.windows.net/container?sig=example',
    'https://oaisdmntprnortheu.blob.core.windows.net/container/file?sp=r',
    'https://oaisdmntprnortheu.blob.core.windows.net/container/file?sig=example&sig=other',
    'https://oaisdmntprnortheu.blob.core.windows.net/container/file?sig=example&versionid=other',
  ])('refuses unsupported file endpoints before any lookup', async input => {
    const resolve = vi.fn();
    const get = vi.fn();
    const source = createChatGptFileSource(resolve, get);
    await expect(collect(source(new URL(input), 4))).rejects.toThrow('file_origin_unsupported');
    expect(resolve).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it.each(['127.0.0.1', '10.0.0.5', '100.64.0.1', '169.254.169.254', '192.168.1.1',
    '::1', 'fe80::1', 'fc00::1', '::ffff:10.0.0.5', '2002:0a00:0001::1'])('refuses a mixed DNS answer containing %s', async address => {
    const get = vi.fn();
    const source = createChatGptFileSource(async () => ['8.8.8.8', address], get);
    await expect(collect(source(url, 5))).rejects.toThrow('file_download_failed');
    expect(get).not.toHaveBeenCalled();
  });

  it.each([
    [url, 'files.oaiusercontent.com', '/file-fixture?sig=short-lived'],
    [new URL('https://oaisdmntprnortheu.blob.core.windows.net/container/file?sp=r&sig=short-lived'),
      'oaisdmntprnortheu.blob.core.windows.net', '/container/file?sp=r&sig=short-lived'],
  ])('pins the validated address and TLS identity for %s and leaves bytes intact', async (file, host, path) => {
    const get = vi.fn(async () => response(200, ['ab', 'cd'], { 'content-length': '4' }));
    const resolve = vi.fn(async () => ['8.8.8.8', '2606:4700::1111']);
    const source = createChatGptFileSource(resolve, get);
    await expect(collect(source(file, 4))).resolves.toBe('abcd');
    expect(resolve).toHaveBeenCalledExactlyOnceWith(host);
    expect(get).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      hostname: '8.8.8.8', port: 443, method: 'GET', path,
      servername: host, rejectUnauthorized: true, minVersion: 'TLSv1.2', agent: false,
      headers: { host, 'accept-encoding': 'identity' },
    }));
  });

  it('never follows a redirect, reports an expired file, and sanitizes networking failures', async () => {
    const get = vi.fn()
      .mockResolvedValueOnce(response(302, [], { location: 'http://127.0.0.1/' }))
      .mockResolvedValueOnce(response(403, []))
      .mockRejectedValueOnce(new Error(url.href));
    const source = createChatGptFileSource(async () => ['8.8.8.8'], get);
    await expect(collect(source(url, 4))).rejects.toThrow(/^file_download_failed$/);
    expect(get).toHaveBeenCalledOnce();
    await expect(collect(source(url, 4))).rejects.toThrow(/^file_unavailable$/);
    await expect(collect(source(url, 4))).rejects.toThrow(/^file_download_failed$/);
  });

  it('allows only two file transfers while DNS or the response is pending', async () => {
    let unblock = () => {};
    const waiting = new Promise<void>(resolve => { unblock = resolve; });
    const source = createChatGptFileSource(async () => { await waiting; return ['8.8.8.8']; },
      async () => response(200, ['ok']));
    const first = collect(source(url, 4));
    const second = collect(source(url, 4));
    await expect(collect(source(url, 4))).rejects.toThrow('attachment_busy');
    unblock();
    await expect(Promise.all([first, second])).resolves.toEqual(['ok', 'ok']);
    await expect(collect(source(url, 4))).resolves.toBe('ok');
  });

  it('bounds announced and chunked bodies, and refuses truncated or encoded data', async () => {
    const get = vi.fn()
      .mockResolvedValueOnce(response(200, [], { 'content-length': '5' }))
      .mockResolvedValueOnce(response(200, ['abc', 'de']))
      .mockResolvedValueOnce(response(200, ['ab'], { 'content-length': '4' }, false))
      .mockResolvedValueOnce(response(200, ['ab'], { 'content-encoding': 'gzip' }));
    const source = createChatGptFileSource(async () => ['8.8.8.8'], get);
    await expect(collect(source(url, 4))).rejects.toThrow('attachment_too_large');
    await expect(collect(source(url, 4))).rejects.toThrow('attachment_too_large');
    await expect(collect(source(url, 4))).rejects.toThrow('file_download_failed');
    await expect(collect(source(url, 4))).rejects.toThrow('file_download_failed');
  });
});
