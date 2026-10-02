import { describe, expect, it } from 'vitest';
import type { ContactImportEntry } from './api.ts';
import { contactContext, contactListingParams, defaultImportSelection, duplicateText, emptyContactForm, importFormatOf, importRefusalText, importSummary, inputOf, safeHref } from './contact-model.ts';

const entry = (over: Partial<ContactImportEntry>): ContactImportEntry => ({ line: 1, name: 'x', contact: { name: 'x' }, problem: null, duplicates: [], sameAs: [], ...over });

describe('Contacts in the browser (16.6)', () => {
  it('uses a link only when it has the scheme it is meant to have', () => {
    expect(safeHref('tel:+390471123456', 'tel')).toBe('tel:+390471123456');
    expect(safeHref('mailto:mario%2Bbills@example.org', 'mailto')).toBe('mailto:mario%2Bbills@example.org');
    expect(safeHref('https://example.org/x?y=1', 'web')).toBe('https://example.org/x?y=1');
    for (const [href, kind] of [
      ['javascript:alert(1)', 'web'],
      ['JAVASCRIPT:alert(1)', 'web'],
      ['data:text/html,x', 'web'],
      ['//example.org', 'web'],
      ['https://example.org/a b', 'web'],
      ['javascript:alert(1)', 'tel'],
      ['tel:112;ext=1', 'tel'],
      ['tel:', 'tel'],
      ['https://example.org', 'tel'],
      ['mailto:a@example.org?bcc=evil@example.org', 'mailto'],
      ['mailto:a@example.org&subject=x', 'mailto'],
      ['javascript:alert(1)', 'mailto'],
      ['mailto:', 'mailto'],
    ] as const) {
      expect({ href, kind, used: safeHref(href, kind) }).toEqual({ href, kind, used: null });
    }
  });

  it('sends only rows that hold something, and asks for a listing by its parameters', () => {
    const form = { ...emptyContactForm('Idraulico Rossi'), phones: [{ value: ' ', label: 'Mobile' }, { value: '0471 1', label: '' }], emails: [{ value: '', label: '' }] };
    expect(inputOf(form)).toMatchObject({ name: 'Idraulico Rossi', phones: [{ value: '0471 1', label: '' }], emails: [] });
    expect(contactListingParams({ q: ' rossi ', category: 'Plumber' }, 'abc')).toBe('q=rossi&category=Plumber&cursor=abc');
    expect(contactListingParams({ q: '', category: '' })).toBe('');
    expect(contactContext({ category: 'Plumber', organisation: 'Rossi Impianti' })).toBe('Plumber · Rossi Impianti');
    expect(contactContext({ category: '', organisation: '' })).toBe('');
  });

  it('says what a possible duplicate shares', () => {
    expect(duplicateText({ name: 'Mario Rossi', reasons: ['email'] })).toBe('Mario Rossi — same email address');
    expect(duplicateText({ name: 'Mario Rossi', reasons: ['email', 'phone', 'name'] })).toBe('Mario Rossi — same email address, phone number, name');
  });

  it('knows an import file by its name and leaves possible duplicates unticked', () => {
    expect([importFormatOf('Contacts.CSV'), importFormatOf('all.vcf'), importFormatOf('one.vcard'), importFormatOf('contacts.xlsx'), importFormatOf('csv')]).toEqual(['csv', 'vcard', 'vcard', null, null]);
    const entries = [
      entry({}),
      entry({ duplicates: [{ id: 'a', name: 'A', organisation: '', reasons: ['email'] }] }),
      entry({ sameAs: [{ entry: 0, reasons: ['name'] }] }),
      entry({ contact: null, problem: { code: 'invalid_phone', field: 'phone' } }),
      entry({}),
    ];
    expect(defaultImportSelection(entries)).toEqual([0, 4]);
    expect(importSummary(entries)).toEqual({ total: 5, importable: 4, duplicates: 2, problems: 1 });
    expect(importRefusalText('contact_import_malformed', 7)).toBe('The file is not a well-formed CSV or vCard file. (Line 7.)');
    expect(importRefusalText('something_new', null)).toBe('The file could not be read.');
  });
});
