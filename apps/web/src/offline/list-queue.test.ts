import { describe, expect, it } from 'vitest';
import { ApiError, isNetworkError, type ListChangeInput, type ListDetail } from '../api.ts';
import { activeChanges, followers, listSendOutcome, noticeFor, refusedReason, summaryOf, waitingIds, withQueuedListChanges, type QueuedListChange } from './list-queue.ts';

const LIST = 'aaaaaaaa-0000-4000-8000-000000000001';
const MILK = 'bbbbbbbb-0000-4000-8000-000000000001';
const BREAD = 'bbbbbbbb-0000-4000-8000-000000000002';
const groceries: ListDetail = {
  id: LIST,
  kind: 'GROCERY',
  title: 'Groceries',
  revision: 3,
  createdBy: 'Ada',
  updatedAt: '2026-10-07T08:00:00.000Z',
  deleted: false,
  items: [
    { id: MILK, title: 'Milk', quantity: '1', unit: 'l', revision: 1, addedBy: 'Ada', checked: null },
    { id: BREAD, title: 'Bread', quantity: null, unit: null, revision: 1, addedBy: 'Ada', checked: null },
  ],
};
let seq = 0;
const queued = (change: ListChangeInput, extra: Partial<QueuedListChange> = {}): QueuedListChange => ({
  clientChangeId: `cccccccc-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
  userId: 'u',
  workspaceId: 'w',
  change,
  deviceTime: '2026-10-07T09:50:00.000Z',
  label: 'x',
  seq,
  ...extra,
});

describe('Lists on this device (17.5)', () => {
  it('shows the saved Lists with the changes not sent yet, in order', () => {
    const eggs = 'bbbbbbbb-0000-4000-8000-000000000003';
    const camping = 'aaaaaaaa-0000-4000-8000-000000000002';
    const shown = withQueuedListChanges(
      [groceries],
      [
        queued({ kind: 'checkItem', listId: LIST, itemId: MILK, checked: true }),
        queued({ kind: 'addItem', listId: LIST, itemId: eggs, title: 'Eggs', quantity: '6', unit: null }),
        queued({ kind: 'editItem', listId: LIST, itemId: eggs, title: 'Eggs', quantity: '10', unit: null }),
        queued({ kind: 'removeItem', listId: LIST, itemId: BREAD }),
        queued({ kind: 'renameList', listId: LIST, title: 'Weekly' }),
        queued({ kind: 'createList', listId: camping, title: 'Camping' }),
      ],
      'you',
    );
    expect(shown.map((list) => list.title)).toEqual(['Weekly', 'Camping']);
    expect(shown[0]?.items.map((item) => [item.title, item.quantity, item.checked?.by ?? null])).toEqual([
      ['Milk', '1', 'you'],
      ['Eggs', '10', null],
    ]);
    expect(summaryOf(shown[0] as ListDetail)).toMatchObject({ open: 1, checked: 1 });
    // A List deleted on this device is gone from it; the saved copy itself is never changed.
    expect(withQueuedListChanges([groceries], [queued({ kind: 'deleteList', listId: LIST })], 'you')).toEqual([]);
    expect(groceries.items[0]?.checked).toBeNull();
  });

  it('leaves out refused changes and those of other Workspaces, and marks what is waiting', () => {
    const mine = queued({ kind: 'checkItem', listId: LIST, itemId: MILK, checked: true });
    const refused = queued({ kind: 'removeItem', listId: LIST, itemId: BREAD }, { refused: 'tool_disabled' });
    const elsewhere = queued({ kind: 'removeItem', listId: LIST, itemId: MILK }, { workspaceId: 'other' });
    expect(activeChanges([elsewhere, refused, mine], 'w')).toEqual([mine]);
    expect([...waitingIds([mine])]).toEqual([MILK]);
  });

  it('keeps changes for a later try when unreachable or signed out, keeps refused ones, drops invalid ones', () => {
    expect(listSendOutcome(undefined)).toBe('sent');
    expect(listSendOutcome(new TypeError('Failed to fetch'))).toBe('retry');
    // No answer in time (weak signal): kept for a later try — a repeat is harmless (same change id).
    expect(listSendOutcome(new DOMException('signal timed out', 'TimeoutError'))).toBe('retry');
    expect(isNetworkError(new DOMException('signal timed out', 'TimeoutError'))).toBe(true);
    expect(isNetworkError(new ApiError(504, 'timeout'))).toBe(false);
    expect(listSendOutcome(new ApiError(503, 'unavailable'))).toBe('retry');
    expect(listSendOutcome(new ApiError(429, 'rate_limited'))).toBe('retry');
    expect(listSendOutcome(new ApiError(401, 'unauthenticated'))).toBe('sign-in');
    expect(listSendOutcome(new ApiError(409, 'offline_account_mismatch'))).toBe('sign-in');
    expect(listSendOutcome(new ApiError(404, 'tool_not_enabled'))).toBe('refused');
    expect(refusedReason(new ApiError(404, 'tool_not_enabled'))).toBe('tool_disabled');
    expect(refusedReason(new ApiError(404, 'workspace_not_found'))).toBe('not_member');
    expect(refusedReason(new ApiError(403, 'forbidden'))).toBe('forbidden');
    expect(listSendOutcome(new ApiError(400, 'invalid_request'))).toBe('drop');
    expect(listSendOutcome(new ApiError(409, 'list_conflict'))).toBe('drop');
  });

  it('says what happened and by whom when a change did not apply', () => {
    const entry = queued({ kind: 'editItem', listId: LIST, itemId: MILK, title: 'Milk', quantity: '3', unit: null }, { label: 'Milk' });
    const answer = { duplicate: false, list: null, by: 'Ada', byAt: '2026-10-07T10:00:00.000Z' };
    expect(noticeFor(entry, { ...answer, outcome: 'APPLIED' })).toBeNull();
    expect(noticeFor(entry, { ...answer, outcome: 'OVERRIDDEN' })).toMatch(/^“Milk”: Ada changed it at .+, after your change — that change was kept\.$/);
    expect(noticeFor(entry, { ...answer, outcome: 'ITEM_REMOVED' })).toBe('“Milk” was removed by Ada — your change to it was not applied.');
    expect(noticeFor(entry, { ...answer, outcome: 'LIST_DELETED' })).toBe('The list was deleted by Ada — your change “Milk” was not applied.');
    expect(noticeFor(entry, { ...answer, outcome: 'ITEM_REMOVED', by: null })).toBe('“Milk” was removed by someone — your change to it was not applied.');
  });

  it('drops the later changes that cannot apply once a List or item is gone, under one notice', () => {
    const camping = 'aaaaaaaa-0000-4000-8000-000000000002';
    const create = queued({ kind: 'createList', listId: camping, title: 'Camping' });
    const addTent = queued({ kind: 'addItem', listId: camping, itemId: MILK, title: 'Tent', quantity: null, unit: null });
    const check = queued({ kind: 'checkItem', listId: LIST, itemId: MILK, checked: true });
    const edit = queued({ kind: 'editItem', listId: LIST, itemId: MILK, title: 'Milk', quantity: '2', unit: null });
    const other = queued({ kind: 'checkItem', listId: LIST, itemId: BREAD, checked: true });
    const all = [create, addTent, check, edit, other];
    expect(followers(all, create, 'LIMIT_REACHED')).toEqual([addTent]);
    expect(followers(all, check, 'ITEM_REMOVED')).toEqual([edit]);
    expect(followers(all, check, 'LIST_DELETED')).toEqual([edit, other]);
    expect(followers(all, check, 'OVERRIDDEN')).toEqual([]);
    expect(followers(all, check, 'APPLIED')).toEqual([]);
  });
});
