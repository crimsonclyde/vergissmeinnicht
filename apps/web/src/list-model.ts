/** Pure helpers of the grocery list page (15.3): grouping, labels, and what to show while a change is on its way. */
import type { ListDetail, ListItem } from './api.ts';

/** To buy (in the List's order) and purchased (most recently checked first). */
export function splitItems(items: readonly ListItem[]): { toBuy: ListItem[]; purchased: ListItem[] } {
  const toBuy = items.filter((item) => item.checked === null);
  const purchased = items.filter((item) => item.checked !== null).sort((a, b) => (b.checked?.at ?? '').localeCompare(a.checked?.at ?? ''));
  return { toBuy, purchased };
}

/** "2 kg", "3", "packs" — or nothing. */
export function amountLabel(item: Pick<ListItem, 'quantity' | 'unit'>): string {
  return [item.quantity, item.unit].filter((part): part is string => part !== null && part !== '').join(' ');
}

/**
 * The List as it will look once a check or uncheck is saved: shown at once, replaced by the server's
 * answer (which stays the truth — e.g. when someone else was first).
 */
export function withChecked(list: ListDetail, itemId: string, checked: boolean, by: string, at: string): ListDetail {
  return {
    ...list,
    items: list.items.map((item) => (item.id !== itemId || (item.checked !== null) === checked ? item : { ...item, checked: checked ? { at, by } : null })),
  };
}

/**
 * Whether a fetched List may replace the one on screen: never an older one (a slow answer of the
 * periodic refresh must not undo what a newer answer already showed).
 */
export const isCurrent = (shown: Pick<ListDetail, 'id' | 'revision'> | null, fetched: Pick<ListDetail, 'id' | 'revision'>): boolean =>
  shown === null || shown.id !== fetched.id || fetched.revision >= shown.revision;
