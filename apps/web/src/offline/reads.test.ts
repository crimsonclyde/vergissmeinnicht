import { describe, expect, it, vi } from 'vitest';
import { ApiError, isNetworkError } from '../api.ts';
import { isSavedRead, readWithCopy, workspaceOfRead, type ReadStore } from './reads.ts';

const W = '/workspaces/aaaaaaaa-0000-4000-8000-000000000001';

describe('which reads are saved for offline use (48.3)', () => {
  it('keeps the apps of a Workspace and the person’s own views', () => {
    for (const path of [
      `${W}/journal?q=&archived=false&offset=0`,
      `${W}/journal/overview`,
      `${W}/recipes/abc`,
      `${W}/calendar?from=2026-11-01&to=2026-11-30`,
      `${W}/contacts`,
      `${W}/home?filter=ALL`,
      `${W}/gazette/today`,
      `${W}/members`,
      '/account/today',
      '/account/places/abc',
    ])
      expect(isSavedRead(path), path).toBe(true);
  });

  it('never keeps the session, administration, security, credentials, links with tokens or exports', () => {
    for (const path of [
      '/auth/session',
      '/workspaces',
      W,
      '/admin/accounts',
      '/admin/weather/credentials',
      '/account/mfa',
      '/account/mcp/',
      '/account/notifications',
      '/account/weather?workspaceId=x',
      `${W}/backups`,
      `${W}/knots`,
      `${W}/calendar-feed`,
      `${W}/ai-assistants`,
      `${W}/text-recognition`,
      `${W}/storage`,
      `${W}/tools`,
      `${W}/documents/export/check`,
      `${W}/images/usage`,
      `${W}/journal/attachments/usage`,
      `${W}/journal/draft`,
      '/account/journal/draft',
      '/account/journal?q=&archived=false&offset=0',
      '/account/journal/abc',
    ])
      expect(isSavedRead(path), path).toBe(false);
  });

  it('leaves Lists and Runs to their own offline copies, and searches unsaved', () => {
    expect(isSavedRead(`${W}/lists`)).toBe(false);
    expect(isSavedRead(`${W}/lists/abc`)).toBe(false);
    expect(isSavedRead(`${W}/runs?state=ACTIVE`)).toBe(false);
    expect(isSavedRead(`${W}/runs/abc`)).toBe(false);
    expect(isSavedRead(`${W}/journal?q=boiler&archived=false&offset=0`)).toBe(false);
    expect(isSavedRead(`${W}/recipes?q=soup`)).toBe(false);
    expect(workspaceOfRead(`${W}/contacts`)).toBe('aaaaaaaa-0000-4000-8000-000000000001');
    expect(workspaceOfRead('/account/today')).toBeNull();
  });
});

function memory(): ReadStore & { entries: Map<string, { body: unknown; savedAt: string }> } {
  const entries = new Map<string, { body: unknown; savedAt: string }>();
  return {
    entries,
    save: async (userId, path, body) => {
      entries.set(`${userId}:${path}`, { body, savedAt: '2026-11-21T08:00:00.000Z' });
    },
    load: async (userId, path) => entries.get(`${userId}:${path}`),
  };
}

describe('reading with a saved copy (48.3)', () => {
  const events = () => ({ copyShown: vi.fn(), answered: vi.fn() });

  it('saves every answer for the signed-in account only', async () => {
    const store = memory();
    const seen = events();
    expect(await readWithCopy('ada', '/p', async () => ({ a: 1 }), store, seen, isNetworkError)).toEqual({ a: 1 });
    await Promise.resolve();
    expect(store.entries.get('ada:/p')?.body).toEqual({ a: 1 });
    expect(await store.load('bob', '/p')).toBeUndefined();
    expect(seen.answered).toHaveBeenCalled();
    expect(seen.copyShown).not.toHaveBeenCalled();
  });

  it('shows the saved copy when no answer comes, and says when it was saved', async () => {
    const store = memory();
    await store.save('ada', '/p', { a: 1 });
    const seen = events();
    expect(await readWithCopy('ada', '/p', () => Promise.reject(new TypeError('Failed to fetch')), store, seen, isNetworkError)).toEqual({ a: 1 });
    expect(seen.copyShown).toHaveBeenCalledWith('2026-11-21T08:00:00.000Z');
  });

  it('never replaces an answer of the server — a refusal stays a refusal', async () => {
    const store = memory();
    await store.save('ada', '/p', { a: 1 });
    for (const error of [new ApiError(403, 'forbidden'), new ApiError(404, 'tool_not_enabled'), new ApiError(401, 'unauthenticated')]) {
      await expect(readWithCopy('ada', '/p', () => Promise.reject(error), store, events(), isNetworkError)).rejects.toBe(error);
    }
  });

  it('without a saved copy, offline stays an error', async () => {
    const error = new TypeError('Failed to fetch');
    await expect(readWithCopy('ada', '/p', () => Promise.reject(error), memory(), events(), isNetworkError)).rejects.toBe(error);
  });

  it('with weak signal, shows the saved copy after a while; the late answer still updates it', async () => {
    const store = memory();
    await store.save('ada', '/p', { a: 1 });
    let answer: (value: unknown) => void = () => undefined;
    const late = new Promise((resolve) => {
      answer = resolve;
    });
    const seen = events();
    expect(await readWithCopy('ada', '/p', () => late, store, seen, isNetworkError, 10)).toEqual({ a: 1 });
    answer({ a: 2 });
    await late;
    await Promise.resolve();
    expect(store.entries.get('ada:/p')?.body).toEqual({ a: 2 });
  });
});
