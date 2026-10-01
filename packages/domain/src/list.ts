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
