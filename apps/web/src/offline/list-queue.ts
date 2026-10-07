import { ApiError, messageFor, type ListChangeInput, type ListDetail, type ListReplayAnswer, type ListSummary } from '../api.ts';
import { formatDateTime, t } from '../i18n/index.ts';

/**
 * A List change made on this device (17.5) and kept until the server has answered it. It is sent
 * once per `clientChangeId` — sending it again after a lost answer gets the same answer — and the
 * server decides under today's permissions what it does. `deviceTime` is when it was made on this
 * device: it decides "the later change wins" (capped by the server).
 */
export interface QueuedListChange {
  readonly clientChangeId: string;
  /** Only ever sent with this account's session. */
  readonly userId: string;
  readonly workspaceId: string;
  readonly change: ListChangeInput;
  readonly deviceTime: string;
  /** The item's or List's name when the change was made, for notices. */
  readonly label: string;
  /** Order of creation; sent strictly in this order. */
  readonly seq: number;
  /**
   * The server refused it because access or the tool is gone (not because of the List's content): it
   * stays on this device with the reason, is never applied and never sent again, until discarded.
   */
  readonly refused?: RefusedReason | undefined;
}

export type RefusedReason = 'forbidden' | 'tool_disabled' | 'not_member';

/** Changes that still count: not refused, of this Workspace, in order. */
export const activeChanges = (queued: readonly QueuedListChange[], workspaceId: string): QueuedListChange[] =>
  queued.filter((entry) => entry.workspaceId === workspaceId && entry.refused === undefined).sort((a, b) => a.seq - b.seq);

const itemOf = (change: Extract<ListChangeInput, { itemId: string }>, me: string) => ({
  id: change.itemId,
  title: change.kind === 'addItem' || change.kind === 'editItem' ? change.title : '',
  quantity: change.kind === 'addItem' || change.kind === 'editItem' ? change.quantity : null,
  unit: change.kind === 'addItem' || change.kind === 'editItem' ? change.unit : null,
  revision: 0,
  addedBy: me,
  checked: null,
});

/**
 * What this device shows: the Lists as last received, with the changes not yet sent applied in
 * order. `me` is how this device names its own changes ("you").
 */
export function withQueuedListChanges(lists: readonly ListDetail[], queued: readonly QueuedListChange[], me: string): ListDetail[] {
  let result = [...lists];
  for (const { change, deviceTime } of queued) {
    if (change.kind === 'createList') {
      if (!result.some((list) => list.id === change.listId)) {
        result.push({ id: change.listId, kind: 'GROCERY', title: change.title, revision: 0, createdBy: me, updatedAt: deviceTime, deleted: false, items: [] });
      }
      continue;
    }
    if (change.kind === 'deleteList') {
      result = result.filter((list) => list.id !== change.listId);
      continue;
    }
    result = result.map((list) => {
      if (list.id !== change.listId) return list;
      switch (change.kind) {
        case 'renameList':
          return { ...list, title: change.title };
        case 'addItem':
          return list.items.some((item) => item.id === change.itemId) ? list : { ...list, items: [...list.items, itemOf(change, me)] };
        case 'editItem':
          return { ...list, items: list.items.map((item) => (item.id === change.itemId ? { ...item, title: change.title, quantity: change.quantity, unit: change.unit } : item)) };
        case 'checkItem':
          return { ...list, items: list.items.map((item) => (item.id === change.itemId ? { ...item, checked: change.checked ? { at: deviceTime, by: me } : null } : item)) };
        case 'removeItem':
          return { ...list, items: list.items.filter((item) => item.id !== change.itemId) };
      }
    });
  }
  return result;
}

/** The overview line of a List: how much is still to buy and how much is checked off. */
export function summaryOf(list: ListDetail): ListSummary {
  const checked = list.items.filter((item) => item.checked !== null).length;
  return { id: list.id, kind: list.kind, title: list.title, revision: list.revision, createdBy: list.createdBy, updatedAt: list.updatedAt, deleted: list.deleted, open: list.items.length - checked, checked };
}

/** Ids of Lists and items with a change on this device that is not sent yet ("Saved on this device"). */
export function waitingIds(queued: readonly QueuedListChange[]): Set<string> {
  const ids = new Set<string>();
  for (const { change } of queued) ids.add('itemId' in change ? change.itemId : change.listId);
  return ids;
}

/**
 * What to do after sending one change:
 * - `sent`: answered — remove it (and say what happened if it did not apply);
 * - `drop`: refused for good because of the change itself (invalid, an id taken) — remove it and say why;
 * - `refused`: access or the tool is gone — keep it, with the reason, never send it again;
 * - `sign-in`: the session is gone or belongs to someone else — keep everything;
 * - `retry`: unreachable, rate-limited or a server error — keep everything and try later.
 */
export type ListSendOutcome = 'sent' | 'drop' | 'refused' | 'sign-in' | 'retry';

export function listSendOutcome(error: unknown): ListSendOutcome {
  if (error === undefined) return 'sent';
  if (!(error instanceof ApiError)) return 'retry';
  if (error.status === 401 || error.code === 'offline_account_mismatch') return 'sign-in';
  if (error.status === 429 || error.status >= 500) return 'retry';
  if (refusedReason(error) !== undefined) return 'refused';
  return 'drop';
}

export function refusedReason(error: unknown): RefusedReason | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (error.code === 'tool_not_enabled') return 'tool_disabled';
  if (error.code === 'workspace_not_found') return 'not_member';
  if (error.status === 403) return 'forbidden';
  return undefined;
}

/** The short notice when a sent change did not apply as made: what happened and by whom. */
export function noticeFor(entry: QueuedListChange, answer: ListReplayAnswer): string | null {
  const values = { title: entry.label, name: answer.by ?? t('lists.offlineSomeone'), when: answer.byAt === null ? '' : formatDateTime(answer.byAt) };
  switch (answer.outcome) {
    case 'APPLIED':
      return null;
    case 'OVERRIDDEN':
      return t('lists.offlineOverridden', values);
    case 'ITEM_REMOVED':
      return t('lists.offlineItemRemoved', values);
    case 'LIST_DELETED':
      return t('lists.offlineListDeleted', values);
    case 'NOT_FOUND':
      return t('lists.offlineNotFound', values);
    case 'LIMIT_REACHED':
      return t('lists.offlineLimit', values);
  }
}

/** The notice for a change the server refused because of the change itself. */
export const droppedNotice = (entry: QueuedListChange, error: unknown): string => t('lists.offlineDropped', { title: entry.label, reason: messageFor(error) });

/**
 * Later changes that cannot apply once this one did not: everything after it for a List that is
 * deleted or does not exist, or for an item that was removed or does not exist. They go with it,
 * under the one notice already given.
 */
export function followers(queued: readonly QueuedListChange[], entry: QueuedListChange, outcome: ListReplayAnswer['outcome'] | 'dropped'): QueuedListChange[] {
  const later = queued.filter((other) => other.workspaceId === entry.workspaceId && other.seq > entry.seq && other.refused === undefined);
  const listGone = outcome === 'LIST_DELETED' || ((outcome === 'NOT_FOUND' || outcome === 'LIMIT_REACHED' || outcome === 'dropped') && entry.change.kind === 'createList');
  if (listGone || (outcome === 'NOT_FOUND' && !('itemId' in entry.change))) return later.filter((other) => other.change.listId === entry.change.listId);
  const itemGone = outcome === 'ITEM_REMOVED' || ((outcome === 'NOT_FOUND' || outcome === 'LIMIT_REACHED' || outcome === 'dropped') && entry.change.kind === 'addItem') || (outcome === 'NOT_FOUND' && 'itemId' in entry.change);
  if (itemGone && 'itemId' in entry.change) {
    const itemId = entry.change.itemId;
    return later.filter((other) => 'itemId' in other.change && other.change.itemId === itemId);
  }
  return [];
}

/** Why changes kept on this device cannot be sent. */
export const refusedText = (reason: RefusedReason): string =>
  reason === 'tool_disabled' ? t('lists.offlineRefusedTool') : reason === 'not_member' ? t('lists.offlineRefusedMember') : t('lists.offlineRefusedRole');
