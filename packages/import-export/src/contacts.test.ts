import { normalizeContactContent, type ContactContent } from '@vergissmeinnicht/domain';
import { describe, expect, it } from 'vitest';
import { contactsToCsv, neutraliseCsvValue, parseContactsCsv, parseCsvRows } from './contacts-csv.ts';
import { ContactFileError, decodeContactFile } from './contacts-file.ts';
import { contactsToVcard, escapeVcardText, parseContactsVcard } from './contacts-vcard.ts';

const codeOf = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof ContactFileError ? error.code : `unexpected ${String(error)}`;
  }
  return undefined;
};
const utf8 = (text: string) => new TextEncoder().encode(text);
const inputs = (parsed: { drafts: { input: unknown }[] }) => parsed.drafts.map((draft) => draft.input);

/** Contacts that exercise everything the two formats must carry — and everything that could break them. */
const CONTACTS: ContactContent[] = [
  { name: 'Idraulico Rossi' },
  {
    name: 'Müller, Hans "der Elektriker"',
    organisation: 'Stadtwerke; Abteilung Strom, Süd',
    category: 'Elektriker',
    emails: [{ value: 'hans@example.org', label: 'Büro' }, { value: 'h.mueller@example.org' }],
    phones: [{ value: '+39 0471 123456', label: 'Mobile' }, { value: '(0471) 99-88/77' }, { value: '-0471 5' , label: 'Odd; one'}],
    address: 'Via Roma 1, int. 3\n39100 Bolzano\nItalia',
    website: 'https://example.org/a,b;c?x=1',
    notes: 'First line\nSecond line with a \\ backslash, a comma; a semicolon and "quotes"\n\n=SUM(A1) is text',
  },
  { name: '=HYPERLINK("http://evil.example","click")', organisation: '+cmd', category: '@role', notes: "-2+3\n'quoted" },
  { name: "'Apostrophe first", notes: '\tTabbed start' },
  { name: `${'Sehr langer Name mit Umlauten äöü '.repeat(5)}Ende`, notes: `${'長い'.repeat(120)} end` },
  { name: 'BEGIN:VCARD', notes: 'END:VCARD\nBEGIN:VCARD\nFN:Injected' },
].map((input) => normalizeContactContent(input));

describe('Contact files (16.6)', () => {
  describe('decoding', () => {
    it('reads UTF-8 with and without a byte-order mark, UTF-16 with one, and Windows-1252 otherwise', () => {
      expect(decodeContactFile(utf8('Müller'))).toBe('Müller');
      expect(decodeContactFile(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('Müller')]))).toBe('Müller');
      expect(decodeContactFile(new Uint8Array([0xff, 0xfe, 0x4d, 0x00, 0xfc, 0x00]))).toBe('Mü');
      expect(decodeContactFile(new Uint8Array([0xfe, 0xff, 0x00, 0x4d, 0x00, 0xfc]))).toBe('Mü');
      expect(decodeContactFile(new Uint8Array([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72]))).toBe('Müller');
    });

    it('refuses what is too large or not text', () => {
      expect(codeOf(() => decodeContactFile(new Uint8Array(1024 * 1024 + 1)))).toBe('contact_import_too_large');
      expect(codeOf(() => decodeContactFile(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])))).toBe('contact_import_not_text');
      expect(codeOf(() => decodeContactFile(new Uint8Array([0xff, 0xfe, 0x00, 0xd8])))).toBe('contact_import_not_text'); // a lone surrogate
      expect(decodeContactFile(new Uint8Array(0))).toBe('');
    });
  });

  describe('CSV', () => {
    it('reads quoted fields, doubled quotes, line breaks inside quotes and three separators', () => {
      expect(parseCsvRows('a,b\r\n"x, y","say ""hi"""\n"two\nlines",z\n')).toEqual([
        { line: 1, cells: ['a', 'b'] },
        { line: 2, cells: ['x, y', 'say "hi"'] },
        { line: 3, cells: ['two\nlines', 'z'] },
      ]);
      expect(parseCsvRows('a;b\n1;"2;3"').map((row) => row.cells)).toEqual([['a', 'b'], ['1', '2;3']]);
      expect(parseCsvRows('a\tb\n1\t2,3').map((row) => row.cells)).toEqual([['a', 'b'], ['1', '2,3']]);
      // Empty lines are no rows; the line of a row counts line breaks inside quotes before it.
      expect(parseCsvRows('a\n\n"b\nc"\n\nd').map((row) => row.line)).toEqual([1, 3, 6]);
      expect(parseCsvRows('a,"",b\n"",\n').map((row) => row.cells)).toEqual([['a', '', 'b']]);
      expect(parseCsvRows('')).toEqual([]);
    });

    it('refuses a quote that never closes, text after a closing quote, and fields or rows beyond the bounds', () => {
      expect(codeOf(() => parseCsvRows('Name\n"never closed'))).toBe('contact_import_malformed');
      expect(codeOf(() => parseCsvRows('Name\n"closed" then more'))).toBe('contact_import_malformed');
      expect(codeOf(() => parseCsvRows(`Name\n${'x'.repeat(10_001)}`))).toBe('contact_import_field_too_long');
      expect(codeOf(() => parseCsvRows(`Name\n"${'x'.repeat(10_001)}"`))).toBe('contact_import_field_too_long');
      expect(codeOf(() => parseCsvRows(`Name\n${'a,'.repeat(301)}`))).toBe('contact_import_malformed');
      expect(codeOf(() => parseCsvRows(`Name\n${'x\n'.repeat(5002)}`))).toBe('contact_import_too_many');
      expect(codeOf(() => parseContactsCsv('Colour,Size\nred,3'))).toBe('contact_import_no_name_column');
    });

    it('reads the usual columns of address-book exports and says which columns it did not use', () => {
      const parsed = parseContactsCsv(
        ['First Name;Last Name;Company;Job Title;E-mail Address;E-mail 2 Address;Mobile Phone;Business Phone 2;Home Fax;Web Page;Notes;Birthday;Empty', 'Mario;Rossi;Rossi Impianti;Idraulico;mario@example.org;info@example.org;+39 333 1234567;0471 123456;0471 9;example.org;Friday;1970-01-01;', ';;Comune di Bolzano;;;;;;;;;;'].join('\n'),
      );
      expect(inputs(parsed)).toEqual([
        {
          name: 'Mario Rossi',
          organisation: 'Rossi Impianti',
          category: 'Idraulico',
          emails: [{ value: 'mario@example.org', label: '' }, { value: 'info@example.org', label: '' }],
          phones: [{ value: '+39 333 1234567', label: 'Mobile' }, { value: '0471 123456', label: 'Business' }, { value: '0471 9', label: 'Home Fax' }],
          address: undefined,
          website: 'example.org',
          notes: 'Friday',
        },
        // No person's name: the organisation is the Contact.
        { name: 'Comune di Bolzano', organisation: 'Comune di Bolzano', category: undefined, emails: [], phones: [], address: undefined, website: undefined, notes: undefined },
      ]);
      expect(parsed.drafts.map((draft) => draft.line)).toEqual([2, 3]);
      // "Birthday" holds data and is not used: said. "Empty" holds nothing: not worth saying.
      expect(parsed.ignored).toEqual(['Birthday']);
      // Labels in their own columns, several values in one cell.
      expect(inputs(parseContactsCsv('Name,E-mail 1 - Label,E-mail 1 - Value,Phone 1 - Type,Phone 1 - Value\nAda,* Work,a@example.org ::: b@example.org,Mobile,112'))).toMatchObject([
        { name: 'Ada', emails: [{ value: 'a@example.org', label: 'Work' }, { value: 'b@example.org', label: 'Work' }], phones: [{ value: '112', label: 'Mobile' }] },
      ]);
      // A row without anything that could be a name is still an entry — shown as one that cannot be imported.
      expect(inputs(parseContactsCsv('Name,Phone\n,112'))).toMatchObject([{ name: '', phones: [{ value: '112' }] }]);
    });

    it('writes values that a spreadsheet cannot run as formulas', () => {
      for (const value of ['=1+1', '+39 0471', '-2', '@SUM(A1)', '\tx', '\rx', "'x"]) expect(neutraliseCsvValue(value)).toBe(`'${value}`);
      for (const value of ['Mario', '39 0471', 'a=b', '']) expect(neutraliseCsvValue(value)).toBe(value);
      const csv = contactsToCsv(CONTACTS);
      expect(csv.startsWith('\uFEFFName,Organisation,Category,Email 1,Email 1 label,Email 2,Email 2 label,Phone 1,')).toBe(true);
      // No cell of the file starts with a character a spreadsheet acts on.
      for (const row of parseCsvRows(csv.slice(1))) for (const cell of row.cells) expect(cell).not.toMatch(/^[=+\-@\t\r]/);
      expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"",""click"")",'+cmd,'@role`);
    });
  });

  describe('vCard', () => {
    it('reads versions 2.1, 3.0 and 4.0: folded lines, escapes, labels, quoted-printable, structured names and addresses', () => {
      const parsed = parseContactsVcard(
        [
          'BEGIN:VCARD',
          'VERSION:3.0',
          'N:Rossi;Mario;;Dott.;',
          'FN:Mario Rossi',
          'ORG:Rossi Impianti;Assistenza',
          'TITLE:Idraulico',
          'EMAIL;TYPE=INTERNET,WORK:Mario@example.org',
          'item1.TEL:+39 0471 123456',
          'item1.X-ABLabel:_$!<Mobile>!$_',
          'item2.TEL;type=pref:0471 99',
          'item2.X-ABLabel:Notfall\\, nachts',
          'TEL;TYPE=WORK,FAX:0471 5',
          'ADR;TYPE=WORK:;;Via Roma 1\\nint. 3;Bolzano;BZ;39100;Italia',
          'ADR;TYPE=HOME:;;Elsewhere;;;;',
          'URL:https://example.org/a\\,b',
          'NOTE:Comes on Fridays\\, never on',
          '  Mondays; brings \\\\ tools',
          'NOTE:Second note',
          'BDAY:1970-01-01',
          'END:VCARD',
          '',
          'begin:vcard',
          'VERSION:2.1',
          'N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:M=C3=BCller;Hans',
          'TEL;CELL;VOICE:0171 1234567',
          'NOTE;ENCODING=QUOTED-PRINTABLE:Erste Zeile=0D=0AZweite =',
          'Zeile',
          'LABEL;WORK;ENCODING=QUOTED-PRINTABLE:Hauptstra=C3=9Fe 1=0D=0A=',
          '12345 Ort',
          'end:vcard',
          'BEGIN:VCARD',
          'VERSION:4.0',
          'KIND:org',
          'ORG:Comune di Bolzano',
          'TEL;VALUE=uri;TYPE="voice,work":tel:+39-0471-997111;ext=12',
          'EMAIL:mailto:info@comune.example',
          'CATEGORIES:Ufficio,Altro',
          'END:VCARD',
        ].join('\r\n'),
      );
      expect(inputs(parsed)).toEqual([
        {
          name: 'Mario Rossi',
          organisation: 'Rossi Impianti, Assistenza',
          category: 'Idraulico',
          emails: [{ value: 'Mario@example.org', label: 'Work' }],
          phones: [{ value: '+39 0471 123456', label: 'Mobile' }, { value: '0471 99', label: 'Notfall, nachts' }, { value: '0471 5', label: 'Work Fax' }],
          address: 'Via Roma 1\nint. 3\n39100 Bolzano\nBZ\nItalia',
          website: 'https://example.org/a,b',
          notes: 'Comes on Fridays, never on Mondays; brings \\ tools\nSecond note',
        },
        { name: 'Hans Müller', organisation: '', category: '', emails: [], phones: [{ value: '0171 1234567', label: 'Mobile' }], address: '', website: '', notes: 'Erste Zeile\r\nZweite Zeile' },
        { name: 'Comune di Bolzano', organisation: 'Comune di Bolzano', category: 'Ufficio', emails: [{ value: 'info@comune.example', label: '' }], phones: [{ value: '+39-0471-997111', label: 'Work' }], address: '', website: '', notes: '' },
      ]);
      expect(parsed.drafts.map((draft) => draft.line)).toEqual([1, 22, 31]);
      expect(parsed.ignored).toEqual(['ADR (further addresses)', 'BDAY', 'LABEL']);
    });

    it('never decodes or keeps an embedded photo, logo, sound or key', () => {
      const photo = Buffer.from('not really a jpeg but long enough to be folded over several lines '.repeat(400)).toString('base64');
      const folded = photo.match(/.{1,70}/g)?.join('\r\n ') ?? '';
      const parsed = parseContactsVcard(['BEGIN:VCARD', 'VERSION:3.0', 'FN:Ada', `PHOTO;ENCODING=b;TYPE=JPEG:${folded}`, 'LOGO;VALUE=uri:data:image/png;base64,AAAA', 'SOUND;ENCODING=b:AAAA', 'KEY;ENCODING=b:AAAA', 'NOTE;ENCODING=b:c2VjcmV0', 'END:VCARD'].join('\r\n'));
      expect(inputs(parsed)).toEqual([{ name: 'Ada', organisation: '', category: '', emails: [], phones: [], address: '', website: '', notes: '' }]);
      expect(parsed.ignored).toEqual(['KEY', 'LOGO', 'NOTE (encoded)', 'PHOTO', 'SOUND']);
      expect(JSON.stringify(parsed)).not.toContain(photo.slice(0, 40));
    });

    it('refuses files that are not well-formed cards', () => {
      const card = (...lines: string[]) => ['BEGIN:VCARD', ...lines, 'END:VCARD'].join('\n');
      expect(codeOf(() => parseContactsVcard('FN:Ada'))).toBe('contact_import_malformed'); // outside a card
      expect(codeOf(() => parseContactsVcard('BEGIN:VCARD\nFN:Ada'))).toBe('contact_import_malformed'); // never closed
      expect(codeOf(() => parseContactsVcard('BEGIN:VCARD\nBEGIN:VCARD\nEND:VCARD\nEND:VCARD'))).toBe('contact_import_malformed'); // nested
      expect(codeOf(() => parseContactsVcard(card('FN:Ada') + '\nEND:VCARD'))).toBe('contact_import_malformed');
      expect(codeOf(() => parseContactsVcard(card('a line without a colon')))).toBe('contact_import_malformed');
      expect(codeOf(() => parseContactsVcard(card('F N:Ada')))).toBe('contact_import_malformed');
      expect(codeOf(() => parseContactsVcard(card(`NOTE:${'x'.repeat(10_001)}`)))).toBe('contact_import_field_too_long');
      expect(codeOf(() => parseContactsVcard(`${card('FN:Ada')}\n`.repeat(5001)))).toBe('contact_import_too_many');
      expect(parseContactsVcard('\n\n')).toEqual({ drafts: [], ignored: [] });
      // A card without any name is an entry — shown later as one that cannot be imported.
      expect(inputs(parseContactsVcard(card('TEL:112')))).toMatchObject([{ name: '', phones: [{ value: '112', label: '' }] }]);
    });

    it('writes values that cannot start a property of their own, in lines of at most 75 bytes', () => {
      expect(escapeVcardText('a,b;c\\d\r\ne\nf')).toBe(String.raw`a\,b\;c\\d\ne\nf`);
      const vcard = contactsToVcard(CONTACTS);
      const lines = vcard.split('\r\n');
      for (const line of lines) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
      // As many cards as Contacts: text that looks like a card boundary stays text.
      expect(lines.filter((line) => line === 'BEGIN:VCARD')).toHaveLength(CONTACTS.length);
      expect(lines.filter((line) => line === 'END:VCARD')).toHaveLength(CONTACTS.length);
      expect(vcard).toContain('NOTE:END:VCARD\\nBEGIN:VCARD\\nFN:Injected');
      expect(contactsToVcard([])).toBe('');
    });
  });

  it('exports and re-imports to the same data, in both formats', () => {
    for (const [format, roundTrip] of [
      ['csv', (contacts: ContactContent[]) => parseContactsCsv(decodeContactFile(utf8(contactsToCsv(contacts))))],
      ['vcard', (contacts: ContactContent[]) => parseContactsVcard(decodeContactFile(utf8(contactsToVcard(contacts))))],
    ] as const) {
      const parsed = roundTrip(CONTACTS);
      expect({ format, ignored: parsed.ignored }).toEqual({ format, ignored: [] });
      expect({ format, contacts: parsed.drafts.map((draft) => normalizeContactContent(draft.input)) }).toEqual({ format, contacts: CONTACTS });
    }
  });

  it('survives arbitrary input: every outcome is a list of drafts or a refusal with a code', () => {
    // A small deterministic generator: the same inputs on every run.
    let seed = 20261002;
    const random = (below: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % below;
    };
    const pieces = ['BEGIN:VCARD', 'END:VCARD', 'FN:', 'N:;', 'TEL;', 'ENCODING=QUOTED-PRINTABLE:', '=', '=C3', '"', '""', ',', ';', ':', '\\', '\\n', '\r\n', '\n', '\r', ' ', '\t', 'Name', 'E-mail 1 - Value', 'ä', '\uFFFD', '\u202E', '長', '=1+1', "'", 'item1.', 'X-ABLabel:', 'x'.repeat(80)];
    for (let round = 0; round < 3000; round++) {
      const text = Array.from({ length: 1 + random(40) }, () => pieces[random(pieces.length)]).join('');
      for (const parser of [parseContactsCsv, parseContactsVcard]) {
        let outcome: unknown;
        try {
          outcome = parser(text);
        } catch (error) {
          expect({ text, error: error instanceof ContactFileError ? 'refused' : String(error) }).toEqual({ text, error: 'refused' });
          continue;
        }
        expect(Array.isArray((outcome as { drafts: unknown[] }).drafts)).toBe(true);
      }
    }
    // Random bytes decode to text or are refused — never anything else.
    for (let round = 0; round < 500; round++) {
      const bytes = Uint8Array.from({ length: random(200) }, () => random(256));
      try {
        expect(typeof decodeContactFile(bytes)).toBe('string');
      } catch (error) {
        expect(error).toBeInstanceOf(ContactFileError);
      }
    }
  });
});
