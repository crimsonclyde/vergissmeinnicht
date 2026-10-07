import { DomainValidationError } from './errors.ts';
import { normalizeSingleLineName } from './text.ts';
import { UUID_V4, type UserId } from './user.ts';
import type { WorkspaceId } from './workspace.ts';

/**
 * A List is lightweight shared content of a Workspace (15.3): named, with items that are checked off.
 * It is neither a Procedure nor a Run — no Sections, no Required/Critical rules, no Skip/N/A, nothing
 * to start. The first (and so far only) kind is the grocery list; `kind` is the seam for others.
 */
export type ListId = string & { readonly __brand: 'ListId' };
export type ListItemId = string & { readonly __brand: 'ListItemId' };

export const LIST_KINDS = ['GROCERY'] as const;
export type ListKind = (typeof LIST_KINDS)[number];

export const MAX_LIST_TITLE_LENGTH = 80;
export const MAX_LIST_ITEM_TITLE_LENGTH = 120;
export const MAX_LIST_ITEM_UNIT_LENGTH = 16;
/** Resource bounds: Lists per Workspace and items per List (deleted ones do not count). */
export const MAX_LISTS_PER_WORKSPACE = 100;
export const MAX_ITEMS_PER_LIST = 300;

/**
 * Offline changes (17.5). A device that lost its connection keeps List changes and sends each one
 * later, once, with a stable client id. The server applies it under today's permissions and these
 * rules: changes to different items always merge; for the same part of an item (name/quantity/unit,
 * or checked) or a List's name the **later change wins**, judged by when it was made — for an offline
 * change the device's clock (owner, 2026-10-07), capped by `offlineChangeTime`; a removal wins over an
 * edit or a check, and deleting a List wins over offline changes to it.
 */
export type ListChange =
  | { readonly kind: 'createList'; readonly listId: ListId; readonly title: string }
  | { readonly kind: 'renameList'; readonly listId: ListId; readonly title: string }
  | { readonly kind: 'deleteList'; readonly listId: ListId }
  | { readonly kind: 'addItem'; readonly listId: ListId; readonly itemId: ListItemId; readonly title: string; readonly quantity: string | null; readonly unit: string | null }
  | { readonly kind: 'editItem'; readonly listId: ListId; readonly itemId: ListItemId; readonly title: string; readonly quantity: string | null; readonly unit: string | null }
  | { readonly kind: 'checkItem'; readonly listId: ListId; readonly itemId: ListItemId; readonly checked: boolean }
  | { readonly kind: 'removeItem'; readonly listId: ListId; readonly itemId: ListItemId };

/**
 * What became of a replayed change: applied; `OVERRIDDEN` — a later change of the same thing was
 * kept; `ITEM_REMOVED` / `LIST_DELETED` — the removal or deletion won; `NOT_FOUND` — the List or item
 * does not exist (e.g. its creation was refused); `LIMIT_REACHED` — the List or Workspace is full.
 */
export const LIST_REPLAY_OUTCOMES = ['APPLIED', 'OVERRIDDEN', 'ITEM_REMOVED', 'LIST_DELETED', 'NOT_FOUND', 'LIMIT_REACHED'] as const;
export type ListReplayOutcome = (typeof LIST_REPLAY_OUTCOMES)[number];

/** An offline change counts as made no earlier than this before it reached the server. */
export const OFFLINE_CHANGE_MAX_AGE_MS = 30 * 24 * 60 * 60_000;
/** How long the server remembers a replayed change, so that sending it again changes nothing. */
export const LIST_CHANGE_KEEP_MS = 90 * 24 * 60 * 60_000;

/**
 * When an offline change counts as made: the device's clock, but never later than the server's time
 * (a clock running ahead cannot win the future) and never earlier than `OFFLINE_CHANGE_MAX_AGE_MS`.
 */
export function offlineChangeTime(deviceTime: Date, now: Date): Date {
  const at = deviceTime.getTime();
  if (!Number.isFinite(at)) return now;
  return new Date(Math.min(now.getTime(), Math.max(now.getTime() - OFFLINE_CHANGE_MAX_AGE_MS, at)));
}

/** Who did something and when: internal id plus the display name at that time. */
export interface ListActorStamp {
  readonly at: Date;
  readonly by: { readonly userId: UserId; readonly displayName: string };
}

export interface List {
  readonly id: ListId;
  readonly workspaceId: WorkspaceId;
  readonly kind: ListKind;
  readonly title: string;
  /** Increases with every change to the List or its items; lets clients notice missed changes. */
  readonly revision: number;
  readonly created: ListActorStamp;
  readonly updatedAt: Date;
  readonly deleted: ListActorStamp | null;
}

export interface ListItem {
  readonly id: ListItemId;
  readonly listId: ListId;
  readonly title: string;
  /** A positive decimal as text (`"2"`, `"1.5"`), or null. Text keeps what was typed exact. */
  readonly quantity: string | null;
  /** Free text such as `kg` or `packs`, or null. */
  readonly unit: string | null;
  readonly position: number;
  /** Increases with every edit of title, quantity or unit (not with checking). */
  readonly revision: number;
  readonly created: ListActorStamp;
  /** Purchased: who checked it and when; null = still to buy. */
  readonly checked: ListActorStamp | null;
}

export function normalizeListTitle(input: string): string {
  return normalizeSingleLineName(input, { field: 'title', codePrefix: 'list_title', label: 'List name', maxLength: MAX_LIST_TITLE_LENGTH });
}

export function normalizeListItemTitle(input: string): string {
  return normalizeSingleLineName(input, { field: 'title', codePrefix: 'list_item_title', label: 'Item', maxLength: MAX_LIST_ITEM_TITLE_LENGTH });
}

const QUANTITY = /^(\d{1,5})(?:[.,](\d{1,3}))?$/;

/**
 * An optional quantity: up to five digits and three decimals, greater than zero. A decimal comma is
 * accepted and stored as a point; trailing zeros of the fraction are dropped (`1,50` → `1.5`).
 */
export function normalizeListItemQuantity(input: string | null | undefined): string | null {
  const value = (input ?? '').trim();
  if (value === '') return null;
  const match = QUANTITY.exec(value);
  if (match === null) throw new DomainValidationError('quantity', 'invalid_list_item_quantity', 'Quantity must be a positive number');
  const whole = String(Number(match[1]));
  const fraction = (match[2] ?? '').replace(/0+$/, '');
  if (Number(whole) === 0 && fraction === '') throw new DomainValidationError('quantity', 'invalid_list_item_quantity', 'Quantity must be a positive number');
  return fraction === '' ? whole : `${whole}.${fraction}`;
}

export function normalizeListItemUnit(input: string | null | undefined): string | null {
  if ((input ?? '').trim() === '') return null;
  return normalizeSingleLineName(input ?? '', { field: 'unit', codePrefix: 'list_item_unit', label: 'Unit', maxLength: MAX_LIST_ITEM_UNIT_LENGTH });
}

export function parseListId(value: string): ListId {
  if (!UUID_V4.test(value)) throw new DomainValidationError('listId', 'invalid_list_id', 'List id must be a lower-case UUIDv4');
  return value as ListId;
}

export function parseListItemId(value: string): ListItemId {
  if (!UUID_V4.test(value)) throw new DomainValidationError('itemId', 'invalid_list_item_id', 'Item id must be a lower-case UUIDv4');
  return value as ListItemId;
}
