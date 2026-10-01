import { describe, expect, it } from 'vitest';
import { DomainValidationError } from './errors.ts';
import { normalizeListItemQuantity, normalizeListItemTitle, normalizeListItemUnit, normalizeListTitle, parseListId, parseListItemId } from './list.ts';

const code = (run: () => unknown): string | undefined => {
  try {
    run();
  } catch (caught) {
    return caught instanceof DomainValidationError ? caught.code : 'other';
  }
  return undefined;
};

describe('List names and items', () => {
  it('trims and bounds the List name', () => {
    expect(normalizeListTitle('  Groceries ')).toBe('Groceries');
    expect(code(() => normalizeListTitle('   '))).toBe('list_title_empty');
    expect(code(() => normalizeListTitle('x'.repeat(81)))).toBe('list_title_too_long');
    expect(code(() => normalizeListTitle('Gro‮ceries'))).toBe('list_title_invalid_characters');
  });

  it('trims and bounds the item title', () => {
    expect(normalizeListItemTitle(' Milk ')).toBe('Milk');
    expect(normalizeListItemTitle('x'.repeat(120))).toHaveLength(120);
    expect(code(() => normalizeListItemTitle(''))).toBe('list_item_title_empty');
    expect(code(() => normalizeListItemTitle('x'.repeat(121)))).toBe('list_item_title_too_long');
    expect(code(() => normalizeListItemTitle('Mi\nlk'))).toBe('list_item_title_invalid_characters');
  });

  it('accepts positive decimals as quantity and stores one spelling', () => {
    expect(normalizeListItemQuantity('2')).toBe('2');
    expect(normalizeListItemQuantity(' 1,50 ')).toBe('1.5');
    expect(normalizeListItemQuantity('0.25')).toBe('0.25');
    expect(normalizeListItemQuantity('007')).toBe('7');
    expect(normalizeListItemQuantity('3.000')).toBe('3');
    expect(normalizeListItemQuantity('')).toBeNull();
    expect(normalizeListItemQuantity(null)).toBeNull();
    expect(normalizeListItemQuantity(undefined)).toBeNull();
  });

  it('rejects anything that is not a positive bounded number', () => {
    for (const bad of ['0', '0.000', '-1', '1e3', 'two', '1.2345', '123456', '1.', '.5', '1 2', '１']) {
      expect({ bad, code: code(() => normalizeListItemQuantity(bad)) }).toEqual({ bad, code: 'invalid_list_item_quantity' });
    }
  });

  it('keeps the unit optional, short and single-line', () => {
    expect(normalizeListItemUnit(' kg ')).toBe('kg');
    expect(normalizeListItemUnit('  ')).toBeNull();
    expect(normalizeListItemUnit(null)).toBeNull();
    expect(code(() => normalizeListItemUnit('x'.repeat(17)))).toBe('list_item_unit_too_long');
    expect(code(() => normalizeListItemUnit('k\tg'))).toBe('list_item_unit_invalid_characters');
  });

  it('accepts only lower-case UUIDv4 ids', () => {
    const id = '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f';
    expect(parseListId(id)).toBe(id);
    expect(parseListItemId(id)).toBe(id);
    expect(code(() => parseListId(id.toUpperCase()))).toBe('invalid_list_id');
    expect(code(() => parseListItemId('not-a-uuid'))).toBe('invalid_list_item_id');
  });
});
