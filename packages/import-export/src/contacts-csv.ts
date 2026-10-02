import type { ContactInput, ContactPoint } from '@vergissmeinnicht/domain';
import { ContactFileError, MAX_CONTACT_FIELD_LENGTH, MAX_CONTACT_FILE_ENTRIES, type ContactDraft, type ParsedContacts } from './contacts-file.ts';

const MAX_COLUMNS = 300;

/** A header as it is compared: lower case, without accents, punctuation as single spaces ("E-mail 1 - Value" → "e mail 1 value"). */
const fold = (header: string): string =>
  header
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** The separator of the file, read off its first line: comma, semicolon (spreadsheets in many locales) or tab. */
function separatorOf(text: string): string {
  const counts = new Map([[',', 0], [';', 0], ['\t', 0]]);
  let quoted = false;
  for (const character of text) {
    if (character === '"') quoted = !quoted;
    else if (!quoted && (character === '\n' || character === '\r')) break;
    else if (!quoted && counts.has(character)) counts.set(character, (counts.get(character) ?? 0) + 1);
  }
  return [...counts].reduce((best, each) => (each[1] > best[1] ? each : best))[0];
}

interface Row {
  readonly line: number;
  readonly cells: string[];
}

/**
 * RFC 4180 with any of three separators: fields may be quoted, a quote inside a quoted field is
 * doubled, a quoted field may contain separators and line breaks. Strict where it matters: a quoted
 * field must end before the next separator, and a quote that is never closed refuses the file.
 */
export function parseCsvRows(text: string): Row[] {
  const separator = separatorOf(text);
  const rows: Row[] = [];
  let cells: string[] = [];
  let field = '';
  let line = 1;
  let startLine = 1;
  let index = 0;
  const endField = () => {
    if (field.length > MAX_CONTACT_FIELD_LENGTH) throw new ContactFileError('contact_import_field_too_long', startLine);
    cells.push(field);
    field = '';
    if (cells.length > MAX_COLUMNS) throw new ContactFileError('contact_import_malformed', startLine);
  };
  const endRow = () => {
    endField();
    if (cells.some((cell) => cell !== '')) rows.push({ line: startLine, cells });
    if (rows.length > MAX_CONTACT_FILE_ENTRIES + 1) throw new ContactFileError('contact_import_too_many');
    cells = [];
    startLine = line + 1;
  };
  while (index < text.length) {
    const character = text[index];
    if (character === '"' && field === '') {
      // A quoted field: up to the closing quote, `""` being one quote.
      const opened = line;
      index++;
      for (;;) {
        if (index >= text.length) throw new ContactFileError('contact_import_malformed', opened);
        const inside = text[index];
        if (inside === '"') {
          if (text[index + 1] === '"') {
            field += '"';
            index += 2;
            continue;
          }
          index++;
          break;
        }
        if (inside === '\n') line++;
        field += inside;
        index++;
        if (field.length > MAX_CONTACT_FIELD_LENGTH) throw new ContactFileError('contact_import_field_too_long', opened);
      }
      const next = text[index];
      if (next !== undefined && next !== separator && next !== '\n' && next !== '\r') throw new ContactFileError('contact_import_malformed', line);
      // An empty quoted field must not be mistaken for the start of another quoted field.
      if (next === separator) {
        endField();
        index++;
        if (index >= text.length) endRow();
      }
      continue;
    }
    if (character === separator) {
      endField();
      index++;
      continue;
    }
    if (character === '\r' || character === '\n') {
      if (character === '\r' && text[index + 1] === '\n') index++;
      endRow();
      line++;
      index++;
      continue;
    }
    field += character;
    index++;
  }
  if (field !== '' || cells.length > 0) endRow();
  return rows;
}

type Column =
  | { readonly kind: 'name' | 'first' | 'middle' | 'last' | 'organisation' | 'category' | 'address' | 'website' | 'notes' }
  | { readonly kind: 'email' | 'phone'; readonly slot: string; readonly label: string }
  | { readonly kind: 'emailLabel' | 'phoneLabel'; readonly slot: string };

const SIMPLE: Readonly<Record<string, Column['kind']>> = {
  name: 'name',
  'full name': 'name',
  'display name': 'name',
  'file as': 'name',
  'first name': 'first',
  'given name': 'first',
  vorname: 'first',
  nome: 'first',
  'middle name': 'middle',
  'additional name': 'middle',
  'last name': 'last',
  'family name': 'last',
  surname: 'last',
  nachname: 'last',
  cognome: 'last',
  organisation: 'organisation',
  organization: 'organisation',
  company: 'organisation',
  'company name': 'organisation',
  'organization name': 'organisation',
  'organization 1 name': 'organisation',
  firma: 'organisation',
  azienda: 'organisation',
  category: 'category',
  role: 'category',
  'job title': 'category',
  'organization title': 'category',
  'organization 1 title': 'category',
  kategorie: 'category',
  categoria: 'category',
  address: 'address',
  'postal address': 'address',
  'address 1 formatted': 'address',
  adresse: 'address',
  indirizzo: 'address',
  website: 'website',
  'web page': 'website',
  url: 'website',
  'website 1 value': 'website',
  webseite: 'website',
  'sito web': 'website',
  notes: 'notes',
  note: 'notes',
  notizen: 'notes',
};

const EMAIL = /^e ?mail(?: address)?(?: (\d+))?(?: (?:value|address))?$/;
const EMAIL_LABEL = /^e ?mail(?: address)? (\d+) (?:label|type)$/;
const PHONE = /^(?:phone|telephone|tel|telefon|telefono)(?: number)?(?: (\d+))?(?: (?:value|number))?$/;
const PHONE_LABEL = /^(?:phone|telephone|tel|telefon|telefono) (\d+) (?:label|type)$/;
/** "Mobile Phone", "Business Phone 2", "Home Fax": the words before say what the number is for. */
const NAMED_PHONE = /^([a-z ]+?) (phone|fax)(?: (\d+))?$/;
const MOBILE = new Set(['mobile', 'handy', 'cellulare', 'cell', 'mobil']);

const capitalised = (words: string): string => words.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());

function columnOf(header: string): Column | undefined {
  const key = fold(header);
  const simple = SIMPLE[key];
  if (simple !== undefined) return { kind: simple } as Column;
  let match: RegExpExecArray | null;
  if ((match = EMAIL_LABEL.exec(key))) return { kind: 'emailLabel', slot: match[1] ?? '1' };
  if ((match = EMAIL.exec(key))) return { kind: 'email', slot: match[1] ?? '1', label: '' };
  if ((match = PHONE_LABEL.exec(key))) return { kind: 'phoneLabel', slot: match[1] ?? '1' };
  if ((match = PHONE.exec(key))) return { kind: 'phone', slot: match[1] ?? '1', label: '' };
  if (MOBILE.has(key)) return { kind: 'phone', slot: 'mobile', label: 'Mobile' };
  if ((match = NAMED_PHONE.exec(key))) {
    const what = capitalised(`${match[1] ?? ''}${match[2] === 'fax' ? ' fax' : ''}`);
    return { kind: 'phone', slot: `${key}`, label: what };
  }
  return undefined;
}

/** What `neutralise` added on export is taken away again: one leading `'` in front of a character a spreadsheet would act on. */
const withoutGuard = (value: string): string => (/^'[=+\-@\t\r']/.test(value) ? value.slice(1) : value);

/** One cell can hold several values (" ::: " in some exports). */
const valuesOf = (cell: string): string[] => cell.split(' ::: ').map((value) => withoutGuard(value.trim())).filter((value) => value !== '');

/**
 * Reads Contacts from CSV text. The first row names the columns; those recognised are used (this
 * app's own export, and the usual names of address-book exports), the others are reported as ignored
 * when they hold anything. A file without any column for a name or an organisation is refused.
 */
export function parseContactsCsv(text: string): ParsedContacts {
  const [header, ...rows] = parseCsvRows(text);
  if (header === undefined) return { drafts: [], ignored: [] };
  const columns = header.cells.map((cell) => columnOf(withoutGuard(cell)));
  if (!columns.some((column) => column !== undefined && ['name', 'first', 'last', 'organisation'].includes(column.kind))) throw new ContactFileError('contact_import_no_name_column', header.line);
  const unused = new Set<number>();
  const drafts: ContactDraft[] = [];
  for (const row of rows) {
    const text: Partial<Record<'name' | 'first' | 'middle' | 'last' | 'organisation' | 'category' | 'address' | 'website' | 'notes', string>> = {};
    const points = { email: new Map<string, { values: string[]; label: string }>(), phone: new Map<string, { values: string[]; label: string }>() };
    const labels = { email: new Map<string, string>(), phone: new Map<string, string>() };
    row.cells.forEach((cell, position) => {
      const column = columns[position];
      const value = withoutGuard(cell.trim());
      if (value === '') return;
      if (column === undefined) {
        unused.add(position);
        return;
      }
      if (column.kind === 'email' || column.kind === 'phone') {
        const slot = points[column.kind].get(column.slot) ?? { values: [], label: column.label };
        slot.values.push(...valuesOf(cell));
        points[column.kind].set(column.slot, slot);
      } else if (column.kind === 'emailLabel') labels.email.set(column.slot, value);
      else if (column.kind === 'phoneLabel') labels.phone.set(column.slot, value);
      // Two columns of the same meaning: the first one that holds something.
      else text[column.kind] ??= value;
    });
    const collect = (kind: 'email' | 'phone'): ContactPoint[] =>
      [...points[kind]].flatMap(([slot, each]) => each.values.map((value) => ({ value, label: (labels[kind].get(slot) ?? each.label).replace(/^\*\s*/, '') })));
    const composed = [text.first, text.middle, text.last].filter((part) => part !== undefined).join(' ');
    const input: ContactInput = {
      // A person's name if there is one, else the organisation is the Contact.
      name: text.name ?? (composed !== '' ? composed : (text.organisation ?? '')),
      organisation: text.organisation,
      category: text.category,
      emails: collect('email'),
      phones: collect('phone'),
      address: text.address,
      website: text.website,
      notes: text.notes,
    };
    drafts.push({ line: row.line, input });
  }
  return { drafts, ignored: [...new Set([...unused].sort((a, b) => a - b).map((position) => (header.cells[position] ?? '').trim() || `#${position + 1}`))] };
}

// ---- Export

/**
 * A value a spreadsheet would run as a formula — one that starts with `=`, `+`, `-`, `@`, a tab or a
 * carriage return — gets a leading apostrophe and is then text. A value that starts with an apostrophe
 * gets one as well, so that reading the file back takes away exactly what was added.
 */
export const neutraliseCsvValue = (value: string): string => (/^[=+\-@\t\r']/.test(value) ? `'${value}` : value);

const quoted = (value: string): string => {
  const safe = neutraliseCsvValue(value);
  return /[",;\t\r\n]/.test(safe) || safe !== safe.trim() ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export interface ExportableContact {
  readonly name: string;
  readonly organisation: string;
  readonly category: string;
  readonly emails: readonly ContactPoint[];
  readonly phones: readonly ContactPoint[];
  readonly address: string;
  readonly website: string;
  readonly notes: string;
}

/** Contacts as CSV: UTF-8 with a byte-order mark (so spreadsheets read the accents), comma-separated, CRLF line ends. */
export function contactsToCsv(contacts: readonly ExportableContact[]): string {
  const emails = Math.max(1, ...contacts.map((contact) => contact.emails.length));
  const phones = Math.max(1, ...contacts.map((contact) => contact.phones.length));
  const numbered = (name: string, count: number) => Array.from({ length: count }, (_, index) => [`${name} ${index + 1}`, `${name} ${index + 1} label`]).flat();
  const header = ['Name', 'Organisation', 'Category', ...numbered('Email', emails), ...numbered('Phone', phones), 'Address', 'Website', 'Notes'];
  const pointCells = (points: readonly ContactPoint[], count: number) => Array.from({ length: count }, (_, index) => [points[index]?.value ?? '', points[index]?.label ?? '']).flat();
  const lines = contacts.map((contact) =>
    [contact.name, contact.organisation, contact.category, ...pointCells(contact.emails, emails), ...pointCells(contact.phones, phones), contact.address, contact.website, contact.notes].map(quoted).join(','),
  );
  return `\uFEFF${[header.join(','), ...lines].join('\r\n')}\r\n`;
}
