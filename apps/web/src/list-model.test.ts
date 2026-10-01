import { describe, expect, it } from 'vitest';
import type { ListDetail, ListItem } from './api.ts';
import { amountLabel, isCurrent, splitItems, withChecked } from './list-model.ts';

const item = (id: string, title: string, extra: Partial<ListItem> = {}): ListItem => ({ id, title, quantity: null, unit: null, revision: 1, addedBy: 'Uma', checked: null, ...extra });
const LIST: ListDetail = {
  id: 'list-1',
  kind: 'GROCERY',
  title: 'Groceries',
  revision: 7,
  createdBy: 'Uma',
  updatedAt: '2026-10-01T10:00:00.000Z',
  deleted: false,
  items: [
    item('milk', 'Milk', { quantity: '2', unit: 'l' }),
    item('bread', 'Bread', { checked: { at: '2026-10-01T10:05:00.000Z', by: 'Eddie' } }),
    item('flour', 'Flour', { quantity: '1.5', unit: 'kg' }),
    item('eggs', 'Eggs', { checked: { at: '2026-10-01T10:09:00.000Z', by: 'Uma' } }),
  ],
};

describe('grocery list view', () => {
  it('keeps what is to buy in the list order and collects the purchased, newest first', () => {
    const { toBuy, purchased } = splitItems(LIST.items);
    expect(toBuy.map((entry) => entry.title)).toEqual(['Milk', 'Flour']);
    expect(purchased.map((entry) => entry.title)).toEqual(['Eggs', 'Bread']);
    expect(splitItems([])).toEqual({ toBuy: [], purchased: [] });
  });

  it('labels quantity and unit only when there is one', () => {
    expect(amountLabel({ quantity: '2', unit: 'l' })).toBe('2 l');
    expect(amountLabel({ quantity: '3', unit: null })).toBe('3');
    expect(amountLabel({ quantity: null, unit: 'packs' })).toBe('packs');
    expect(amountLabel({ quantity: null, unit: null })).toBe('');
  });

  it('shows a check at once without touching other items', () => {
    const checked = withChecked(LIST, 'milk', true, 'you', '2026-10-01T10:10:00.000Z');
    expect(checked.items[0]?.checked).toEqual({ at: '2026-10-01T10:10:00.000Z', by: 'you' });
    expect(checked.items.slice(1)).toEqual(LIST.items.slice(1));
    expect(LIST.items[0]?.checked).toBeNull();
    // Already purchased by someone else: their name stays.
    expect(withChecked(LIST, 'bread', true, 'you', '2026-10-01T10:10:00.000Z').items[1]?.checked?.by).toBe('Eddie');
    expect(withChecked(LIST, 'bread', false, 'you', '2026-10-01T10:10:00.000Z').items[1]?.checked).toBeNull();
  });

  it('never lets an older answer replace a newer List', () => {
    expect(isCurrent(null, LIST)).toBe(true);
    expect(isCurrent(LIST, { id: 'list-1', revision: 8 })).toBe(true);
    expect(isCurrent(LIST, { id: 'list-1', revision: 7 })).toBe(true);
    // A slow refresh that started before someone's change arrived after it.
    expect(isCurrent(LIST, { id: 'list-1', revision: 6 })).toBe(false);
    expect(isCurrent(LIST, { id: 'list-2', revision: 1 })).toBe(true);
  });
});
