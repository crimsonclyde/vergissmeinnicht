import { describe, expect, it, vi } from 'vitest';
import { cleanUpDevice, deleteIndexedDb, type CleanupIo, type DeleteOutcome } from './cleanup.ts';
import { parseSessionMessage, reactionTo } from './session-channel.ts';

const io = (emptied: boolean | 'throws', deletion: DeleteOutcome | 'throws'): CleanupIo & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    announce: () => void calls.push('announce'),
    emptyStores: async () => {
      calls.push('empty');
      if (emptied === 'throws') throw new Error('no');
      return emptied;
    },
    deleteDatabase: async () => {
      calls.push('delete');
      if (deletion === 'throws') throw new Error('no');
      return deletion;
    },
  };
};

describe('sign-out device cleanup (13.1)', () => {
  it('tells other tabs first, then empties the stores, then deletes the database', async () => {
    const steps = io(true, 'deleted');
    expect(await cleanUpDevice(steps)).toBe('deleted');
    expect(steps.calls).toEqual(['announce', 'empty', 'delete']);
  });

  it('never reports a blocked deletion as deleted', async () => {
    expect(await cleanUpDevice(io(true, 'blocked'))).toBe('emptied');
    expect(await cleanUpDevice(io(false, 'blocked'))).toBe('failed');
    expect(await cleanUpDevice(io('throws', 'blocked'))).toBe('failed');
    expect(await cleanUpDevice(io('throws', 'throws'))).toBe('failed');
    expect(await cleanUpDevice(io(true, 'failed'))).toBe('emptied');
  });

  it('a deletion that succeeds is enough even if emptying failed', async () => {
    expect(await cleanUpDevice(io('throws', 'deleted'))).toBe('deleted');
  });
});

/** A fake IDBFactory whose delete request is controlled by the test. */
function fakeFactory() {
  const request = {} as { onsuccess?: () => void; onerror?: () => void; onblocked?: () => void };
  const factory = { deleteDatabase: vi.fn(() => request) } as unknown as IDBFactory;
  return { factory, request };
}

describe('deleteIndexedDb', () => {
  it('resolves deleted only on success, not when blocked', async () => {
    vi.useFakeTimers();
    try {
      const { factory, request } = fakeFactory();
      const result = deleteIndexedDb(factory, 'vmn-offline', 3000);
      request.onblocked?.();
      await vi.advanceTimersByTimeAsync(1000);
      request.onsuccess?.();
      expect(await result).toBe('deleted');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports blocked when other connections do not let go in time', async () => {
    vi.useFakeTimers();
    try {
      const { factory, request } = fakeFactory();
      const result = deleteIndexedDb(factory, 'vmn-offline', 3000);
      request.onblocked?.();
      await vi.advanceTimersByTimeAsync(3000);
      expect(await result).toBe('blocked');
      request.onsuccess?.(); // later success does not change the reported result
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports failed on error or when deletion cannot start', async () => {
    const { factory, request } = fakeFactory();
    const result = deleteIndexedDb(factory, 'vmn-offline', 3000);
    request.onerror?.();
    expect(await result).toBe('failed');
    const throwing = {
      deleteDatabase: () => {
        throw new Error('SecurityError');
      },
    } as unknown as IDBFactory;
    expect(await deleteIndexedDb(throwing, 'vmn-offline', 3000)).toBe('failed');
  });
});

describe('session messages between tabs (13.1)', () => {
  it('ignores what this tab announced itself', () => {
    expect(parseSessionMessage({ type: 'signed-out', tab: 'me' }, 'me')).toBeUndefined();
    expect(parseSessionMessage({ type: 'signed-out', tab: 'other' }, 'me')).toEqual({ type: 'signed-out' });
  });

  it('accepts only the two known shapes', () => {
    expect(parseSessionMessage({ type: 'signed-out' })).toEqual({ type: 'signed-out' });
    expect(parseSessionMessage({ type: 'signed-in', userId: 'u1' })).toEqual({ type: 'signed-in', userId: 'u1' });
    for (const bad of [null, 'signed-out', { type: 'signed-in' }, { type: 'signed-in', userId: 7 }, { type: 'other' }]) {
      expect(parseSessionMessage(bad)).toBeUndefined();
    }
  });

  it('leaves the account on sign-out and re-checks when another account signs in', () => {
    expect(reactionTo({ type: 'signed-out' }, 'u1')).toBe('leave');
    expect(reactionTo({ type: 'signed-out' }, undefined)).toBe('none');
    expect(reactionTo({ type: 'signed-in', userId: 'u2' }, 'u1')).toBe('recheck');
    expect(reactionTo({ type: 'signed-in', userId: 'u2' }, undefined)).toBe('recheck');
    expect(reactionTo({ type: 'signed-in', userId: 'u1' }, 'u1')).toBe('none');
  });
});
