import { describe, expect, it } from 'vitest';
import { contactKeys, contactNameKey, contactSearchText, mailtoHref, normalizeContactContent, normalizePhone, normalizeWebsite, parseContactCursor, parseContactQuery, phoneKey, phoneTailKey, telHref } from './contact.ts';
import { DomainValidationError } from './errors.ts';

const codeOf = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof DomainValidationError ? error.code : String(error);
  }
  return undefined;
};

describe('Contacts (16.6)', () => {
  it('needs nothing but a name', () => {
    expect(normalizeContactContent({ name: '  Idraulico Rossi ' })).toEqual({ name: 'Idraulico Rossi', organisation: '', category: '', emails: [], phones: [], address: '', website: '', notes: '' });
    expect(codeOf(() => normalizeContactContent({ name: '   ' }))).toBe('contact_name_empty');
    expect(codeOf(() => normalizeContactContent({ name: 'x'.repeat(201) }))).toBe('contact_name_too_long');
    expect(codeOf(() => normalizeContactContent({ name: 'Ada\u202Eevil' }))).toBe('contact_name_invalid_characters');
    expect(codeOf(() => normalizeContactContent({ name: 'Ada\nLovelace' }))).toBe('contact_name_invalid_characters');
  });

  it('normalises and bounds every other field', () => {
    const contact = normalizeContactContent({
      name: 'Mario Rossi',
      organisation: ' Rossi Impianti ',
      category: 'Plumber',
      emails: [{ value: ' Mario@Example.ORG ', label: ' Office ' }, { value: 'mario@example.org' }, { value: '' }],
      phones: [{ value: '+39 0471 123456', label: 'Mobile' }, { value: '0039 0471-123456' }, { value: '  ' }],
      address: 'Via Roma 1\r\n39100 Bolzano',
      website: 'example.org/contatti',
      notes: ' Comes on Fridays ',
    });
    // The same address or number twice is one entry; empty rows of a form are no entries.
    expect(contact.emails).toEqual([{ value: 'mario@example.org', label: 'Office' }]);
    expect(contact.phones).toEqual([{ value: '+39 0471 123456', label: 'Mobile' }]);
    expect(contact.address).toBe('Via Roma 1\n39100 Bolzano');
    expect(contact.website).toBe('https://example.org/contatti');
    expect(contact.notes).toBe('Comes on Fridays');
    expect(codeOf(() => normalizeContactContent({ name: 'A', emails: [{ value: 'not an address' }] }))).toBe('invalid_email');
    expect(codeOf(() => normalizeContactContent({ name: 'A', emails: Array.from({ length: 11 }, (_, n) => ({ value: `a${n}@example.org` })) }))).toBe('too_many_contact_emails');
    expect(codeOf(() => normalizeContactContent({ name: 'A', phones: Array.from({ length: 11 }, (_, n) => ({ value: `0471 ${1000 + n}` })) }))).toBe('too_many_contact_phones');
    expect(codeOf(() => normalizeContactContent({ name: 'A', phones: [{ value: '112', label: 'x'.repeat(41) }] }))).toBe('contact_label_too_long');
    expect(codeOf(() => normalizeContactContent({ name: 'A', category: 'x'.repeat(61) }))).toBe('contact_category_too_long');
    expect(codeOf(() => normalizeContactContent({ name: 'A', address: 'x'.repeat(501) }))).toBe('contact_address_too_long');
    expect(codeOf(() => normalizeContactContent({ name: 'A', notes: 'x'.repeat(4001) }))).toBe('contact_notes_too_long');
    expect(codeOf(() => normalizeContactContent({ name: 'A', notes: 'bell\u0007' }))).toBe('contact_notes_invalid_characters');
    expect(codeOf(() => normalizeContactContent({ name: 'A', organisation: 'Acme\u2066x' }))).toBe('contact_organisation_invalid_characters');
  });

  it('accepts phone numbers as people write them and nothing that is not a number', () => {
    for (const phone of ['112', '+39 0471 123456', '(0471) 12-34-56', '0471/123456', '0049.30.1234567', '＋３９ ０４７１']) expect({ phone, ok: codeOf(() => normalizePhone(phone)) }).toEqual({ phone, ok: undefined });
    for (const phone of ['12', 'call me', '0471 123456 ext 4', '+39+0471', '0471;123', 'tel:0471123', '1'.repeat(21), '0471\u202E123', '0471,123456', '<b>0471</b>', '0471 123456\n112']) {
      expect({ phone, code: codeOf(() => normalizePhone(phone)) }).toEqual({ phone, code: 'invalid_phone' });
    }
    // What a number is compared and dialled by: digits, `+` for international, `00` as `+`.
    expect(phoneKey('+39 (0471) 12-34.56')).toBe('+390471123456');
    expect(phoneKey('0039 0471 123456')).toBe('+390471123456');
    expect(phoneKey('0471/123456')).toBe('0471123456');
    expect(phoneKey('0012')).toBe('0012');
    expect(telHref('+39 (0471) 12-34.56')).toBe('tel:+390471123456');
    expect(mailtoHref('mario+bills@example.org')).toBe('mailto:mario%2Bbills@example.org');
    expect(mailtoHref("o'neil?subject=x&bcc=y@example.org")).not.toMatch(/[?&]/);
  });

  it('accepts only http and https websites', () => {
    expect(normalizeWebsite(undefined)).toBe('');
    expect(normalizeWebsite('  ')).toBe('');
    expect(normalizeWebsite('example.org')).toBe('https://example.org/');
    expect(normalizeWebsite('HTTP://Example.org/a b'.replace(' ', '%20'))).toBe('http://example.org/a%20b');
    expect(normalizeWebsite('example.org:8443/x?y=1')).toBe('https://example.org:8443/x?y=1');
    for (const website of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      ' javascript:alert(1)',
      'java\tscript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'ftp://example.org',
      'https://user:secret@example.org',
      'https://user@example.org',
      'javascript:1',
      'localhost',
      'https://',
      'example.org/a b',
      'https://example.org/\u202Egpj.exe',
      `https://example.org/${'x'.repeat(500)}`,
    ]) {
      expect({ website, code: codeOf(() => normalizeWebsite(website)) }).toEqual({ website, code: 'invalid_website' });
    }
  });

  it('compares Contacts by email address, phone number and name', () => {
    expect(contactNameKey('Rossi, Mario')).toBe('mario rossi');
    expect(contactNameKey('MARIO  ROSSI')).toBe('mario rossi');
    expect(contactNameKey('Hans Müller')).toBe(contactNameKey('MULLER Hans'));
    expect(contactNameKey('Mario Rossi')).not.toBe(contactNameKey('Maria Rossi'));
    expect(contactNameKey('???')).toBe('');
    const content = normalizeContactContent({ name: '???', emails: [{ value: 'A@example.org' }], phones: [{ value: '+39 0471 1234' }, { value: '0471 99' }] });
    expect(contactKeys(content)).toEqual([
      { kind: 'email', key: 'a@example.org' },
      { kind: 'phone', key: '+3904711234' },
      { kind: 'phone', key: 'tail:04711234' },
      { kind: 'phone', key: '047199' }, // too short for a tail: compared as a whole only
    ]);
    // A national and an international spelling of one line share their last eight digits.
    expect(phoneTailKey('0471 123456')).toBe('tail:71123456');
    expect(phoneTailKey('+39 0471 12-34-56')).toBe('tail:71123456');
    expect(phoneTailKey('030 1234567')).toBe(phoneTailKey('+49 (30) 1234567'));
    expect(phoneTailKey('0471 123457')).not.toBe(phoneTailKey('0471 123456'));
    expect([phoneTailKey('112'), phoneTailKey('1234567')]).toEqual([null, null]);
    expect(contactKeys(normalizeContactContent({ name: 'Comune di Bolzano' }))).toEqual([{ kind: 'name', key: 'bolzano comune di' }]);
  });

  it('searches name, organisation, category, addresses and numbers — also by digits alone', () => {
    const text = contactSearchText(normalizeContactContent({ name: 'Hans Müller', organisation: 'Stadtwerke', category: 'Elektriker', emails: [{ value: 'hans@example.org' }], phones: [{ value: '+39 0471 12-34' }], notes: 'secret note', address: 'Hidden street' }));
    for (const part of ['hans muller', 'stadtwerke', 'elektriker', 'hans@example.org', '+39 0471 12-34', '+3904711234', '3904711234']) expect(text).toContain(part);
    // Notes and the postal address are not searched.
    expect(text).not.toMatch(/secret|hidden/);
    expect(parseContactQuery({ q: ' MÜLLER  0471 ', category: ' Elektriker ' })).toEqual({ terms: ['muller', '0471'], category: 'elektriker' });
    expect(parseContactQuery({})).toEqual({ terms: [], category: null });
    expect(codeOf(() => parseContactQuery({ q: 'x'.repeat(101) }))).toBe('search_too_long');
  });

  it('checks only the shape of a cursor', () => {
    const id = '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f';
    expect(parseContactCursor(['mario rossi', id])).toEqual({ value: 'mario rossi', id });
    for (const bad of [null, 'x', [], ['a'], ['a', 'not-an-id'], [1, id], ['a', id, 'more'], ['x'.repeat(4001), id], { value: 'a', id }]) expect(parseContactCursor(bad)).toBeUndefined();
  });
});
