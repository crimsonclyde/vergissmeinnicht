import type { ContactInput } from '@vergissmeinnicht/domain';
import type { ExportableContact } from './contacts-csv.ts';
import { ContactFileError, MAX_CONTACT_FIELD_LENGTH, MAX_CONTACT_FILE_ENTRIES, type ContactDraft, type ParsedContacts } from './contacts-file.ts';

/**
 * vCard (`.vcf`) for Contacts: versions 2.1, 3.0 and 4.0 are read, 3.0 is written. Only text is taken:
 * names, organisation, role, email addresses, phone numbers, the first postal address, the first web
 * address and notes. **Photos, logos, sounds, keys and every other embedded binary are skipped
 * without being decoded** — they are reported as ignored, like any property that is not used.
 */

interface Property {
  readonly group: string;
  readonly name: string;
  readonly params: Map<string, string[]>;
  readonly value: string;
}

/** Properties that only describe the card itself: not data of the person, so not reported as ignored. */
const STRUCTURAL = new Set(['VERSION', 'PRODID', 'REV', 'UID', 'KIND', 'X-ABUID', 'X-ABSHOWAS', 'SORT-STRING', 'CLASS', 'N']);
const USED = new Set(['FN', 'N', 'ORG', 'ROLE', 'TITLE', 'CATEGORIES', 'EMAIL', 'TEL', 'ADR', 'URL', 'NOTE', 'X-ABLABEL']);

/** `[group.]NAME;PARAM=a,b;BARE:value` — split at the first colon that is not inside a quoted parameter. */
function parseLine(line: string, lineNumber: number): Property {
  let colon = -1;
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '"') quoted = !quoted;
    else if (character === ':' && !quoted) {
      colon = index;
      break;
    }
  }
  if (colon <= 0) throw new ContactFileError('contact_import_malformed', lineNumber);
  const [head = '', ...rest] = line.slice(0, colon).split(';');
  const dot = head.lastIndexOf('.');
  const name = (dot === -1 ? head : head.slice(dot + 1)).toUpperCase();
  if (!/^[A-Z0-9-]+$/.test(name)) throw new ContactFileError('contact_import_malformed', lineNumber);
  const params = new Map<string, string[]>();
  for (const part of rest) {
    const equals = part.indexOf('=');
    // vCard 2.1 writes types bare: `TEL;WORK;VOICE:`.
    const key = equals === -1 ? 'TYPE' : part.slice(0, equals).toUpperCase();
    const values = (equals === -1 ? part : part.slice(equals + 1)).split(',').map((value) => value.replace(/^"|"$/g, ''));
    params.set(key, [...(params.get(key) ?? []), ...values]);
  }
  return { group: dot === -1 ? '' : head.slice(0, dot).toLowerCase(), name, params, value: line.slice(colon + 1) };
}

const isQuotedPrintable = (property: Property): boolean => (property.params.get('ENCODING') ?? []).some((value) => value.toUpperCase() === 'QUOTED-PRINTABLE');

/** Quoted-printable (vCard 2.1) to text: `=C3=BC` → "ü". The charset is UTF-8 unless the property names Latin-1 or Windows-1252. */
function decodeQuotedPrintable(value: string, charset: string | undefined): string {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index++) {
    const hex = value[index] === '=' ? value.slice(index + 1, index + 3) : '';
    if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(Number.parseInt(hex, 16));
      index += 2;
    } else {
      bytes.push(...new TextEncoder().encode(value[index]));
    }
  }
  const latin = charset !== undefined && /^(iso-8859-1|latin1|windows-1252|cp1252)$/i.test(charset);
  return new TextDecoder(latin ? 'windows-1252' : 'utf-8').decode(new Uint8Array(bytes));
}

/** Splits at unescaped separators and takes the escaping away: `\n` is a line break, `\,` `\;` `\\` are the characters. */
function splitValue(value: string, separator: ';' | ',' | null): string[] {
  const parts: string[] = [];
  let current = '';
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === '\\' && index + 1 < value.length) {
      const next = value[index + 1];
      current += next === 'n' || next === 'N' ? '\n' : next;
      index++;
    } else if (separator !== null && character === separator) {
      parts.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  parts.push(current);
  return parts.map((part) => part.trim());
}

const text = (value: string): string => splitValue(value, null)[0] ?? '';

const NOT_A_LABEL = new Set(['internet', 'pref', 'voice', 'x400', 'text', 'msg']);
const LABEL_NAMES: Readonly<Record<string, string>> = { cell: 'Mobile', work: 'Work', home: 'Home', fax: 'Fax', other: 'Other', main: 'Main', pager: 'Pager' };

/** What an address or number is for: the label written beside it (`itemN.X-ABLabel`), else its types in words ("Work Fax"). */
function labelOf(property: Property, groupLabels: ReadonlyMap<string, string>): string {
  const own = property.group === '' ? undefined : groupLabels.get(property.group);
  if (own !== undefined) return own;
  const types = (property.params.get('TYPE') ?? []).map((type) => type.toLowerCase()).filter((type) => type !== '' && !NOT_A_LABEL.has(type));
  return [...new Set(types)].map((type) => LABEL_NAMES[type] ?? `${type.charAt(0).toUpperCase()}${type.slice(1)}`).join(' ');
}

function contactOf(properties: readonly Property[], ignored: Set<string>): ContactInput {
  // Address books that keep their own labels write them as a second property of the same group; the
  // `_$!<Work>!$_` wrapper marks one of their built-in labels.
  const groupLabels = new Map(properties.filter((property) => property.name === 'X-ABLABEL' && property.group !== '').map((property) => [property.group, text(property.value).replace(/^_\$!<(.*)>!\$_$/, '$1')]));
  const all = (name: string) => properties.filter((property) => property.name === name);
  const first = (name: string) => all(name)[0];
  const structuredName = splitValue(first('N')?.value ?? '', ';');
  const fromParts = [structuredName[3], structuredName[1], structuredName[2], structuredName[0], structuredName[4]].filter((part) => part !== undefined && part !== '').join(' ');
  const organisation = splitValue(first('ORG')?.value ?? '', ';').filter((part) => part !== '').join(', ');
  const address = first('ADR');
  if (all('ADR').length > 1) ignored.add('ADR (further addresses)');
  if (all('URL').length > 1) ignored.add('URL (further addresses)');
  const [box = '', extended = '', street = '', locality = '', region = '', code = '', country = ''] = splitValue(address?.value ?? '', ';');
  return {
    name: text(first('FN')?.value ?? '') || fromParts || organisation,
    organisation,
    category: text(first('ROLE')?.value ?? '') || text(first('TITLE')?.value ?? '') || (splitValue(first('CATEGORIES')?.value ?? '', ',')[0] ?? ''),
    emails: all('EMAIL').map((property) => ({ value: text(property.value).replace(/^mailto:/i, ''), label: labelOf(property, groupLabels) })),
    // A number may come as a `tel:` address with parameters after a semicolon.
    phones: all('TEL').map((property) => ({ value: (splitValue(property.value, ';')[0] ?? '').replace(/^tel:/i, ''), label: labelOf(property, groupLabels) })),
    address: [box, extended, street, `${code} ${locality}`.trim(), region, country].filter((part) => part !== '').join('\n'),
    website: text(first('URL')?.value ?? ''),
    notes: all('NOTE').map((property) => text(property.value)).filter((note) => note !== '').join('\n'),
  };
}

/**
 * Reads Contacts from vCard text. Strict about structure — every card opens with `BEGIN:VCARD` and
 * closes with `END:VCARD`, and nothing but blank lines stands between cards — and tolerant about
 * content: long lines folded over several, quoted-printable text of old address books, types written
 * bare. Values are plain strings afterwards; the domain rules decide what a Contact may hold.
 */
export function parseContactsVcard(input: string): ParsedContacts {
  const raw = input.split(/\r\n|\n|\r/);
  // Unfold: a line that starts with a space or a tab continues the one before.
  const lines: { text: string; line: number }[] = [];
  for (const [index, each] of raw.entries()) {
    const last = lines.at(-1);
    if ((each.startsWith(' ') || each.startsWith('\t')) && last !== undefined) last.text += each.slice(1);
    else lines.push({ text: each, line: index + 1 });
  }
  const drafts: ContactDraft[] = [];
  const ignored = new Set<string>();
  let card: { line: number; properties: Property[] } | null = null;
  for (let index = 0; index < lines.length; index++) {
    const current = lines[index];
    if (current === undefined || current.text.trim() === '') continue;
    const upper = current.text.trim().toUpperCase();
    if (upper === 'BEGIN:VCARD') {
      if (card !== null) throw new ContactFileError('contact_import_malformed', current.line);
      card = { line: current.line, properties: [] };
      continue;
    }
    if (card === null) throw new ContactFileError('contact_import_malformed', current.line);
    if (upper === 'END:VCARD') {
      drafts.push({ line: card.line, input: contactOf(card.properties, ignored) });
      if (drafts.length > MAX_CONTACT_FILE_ENTRIES) throw new ContactFileError('contact_import_too_many');
      card = null;
      continue;
    }
    let property = parseLine(current.text, current.line);
    let value = property.value;
    // Quoted-printable: `=` at the end of a line continues on the next one (also for a property that is not used).
    while (isQuotedPrintable(property) && value.endsWith('=') && index + 1 < lines.length) {
      index++;
      value = value.slice(0, -1) + (lines[index]?.text ?? '');
    }
    if (!USED.has(property.name)) {
      // Not used — whatever it holds (a photo, a key, a sound) is neither decoded nor kept.
      if (!STRUCTURAL.has(property.name)) ignored.add(property.name);
      continue;
    }
    if (isQuotedPrintable(property)) {
      if (value.length > MAX_CONTACT_FIELD_LENGTH) throw new ContactFileError('contact_import_field_too_long', current.line);
      property = { ...property, value: decodeQuotedPrintable(value, property.params.get('CHARSET')?.[0]) };
    } else if ((property.params.get('ENCODING') ?? []).length > 0) {
      // Base64 where text belongs: not read.
      ignored.add(`${property.name} (encoded)`);
      continue;
    }
    if (property.value.length > MAX_CONTACT_FIELD_LENGTH) throw new ContactFileError('contact_import_field_too_long', current.line);
    card.properties.push(property);
  }
  if (card !== null) throw new ContactFileError('contact_import_malformed', card.line);
  return { drafts, ignored: [...ignored].sort() };
}

// ---- Export

/** A value as vCard text: backslash, comma and semicolon escaped, a line break written as `\n`. Nothing can start a new property. */
export const escapeVcardText = (value: string): string => value.replace(/\\/g, '\\\\').replace(/\r\n?|\n/g, '\\n').replace(/[,;]/g, (character) => `\\${character}`);

/** At most 75 bytes a line; longer ones continue on the next line after a space — never inside a character. */
function fold(line: string): string {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let current = '';
  let bytes = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (bytes + size > 75) {
      lines.push(current);
      current = ' ';
      bytes = 1;
    }
    current += character;
    bytes += size;
  }
  lines.push(current);
  return lines.join('\r\n');
}

/** Contacts as vCard 3.0 (the version address books read most widely), UTF-8, CRLF line ends. */
export function contactsToVcard(contacts: readonly ExportableContact[]): string {
  const cards = contacts.map((contact) => {
    const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${escapeVcardText(contact.name)}`, `N:${escapeVcardText(contact.name)};;;;`];
    if (contact.organisation !== '') lines.push(`ORG:${escapeVcardText(contact.organisation)}`);
    if (contact.category !== '') lines.push(`ROLE:${escapeVcardText(contact.category)}`);
    let item = 0;
    const point = (property: 'TEL' | 'EMAIL', value: string, label: string) => {
      const standard = ({mobile:'CELL',cell:'CELL',home:'HOME',work:'WORK',fax:'FAX',pager:'PAGER'} as Readonly<Record<string,string>>)[label.toLowerCase()];
      const types = property === 'EMAIL' ? ['INTERNET',...(standard === 'HOME' || standard === 'WORK' ? [standard]:[])] : standard === undefined ? ['VOICE'] : [standard];
      const header = `${property};TYPE=${types.join(',')}`;
      if (label === '') {lines.push(`${header}:${escapeVcardText(value)}`);return;}
      item++;
      lines.push(`item${item}.${header}:${escapeVcardText(value)}`,`item${item}.X-ABLabel:${escapeVcardText(label)}`);
    };
    for (const email of contact.emails) point('EMAIL',email.value,email.label);
    for (const phone of contact.phones) point('TEL',phone.value,phone.label);
    if (contact.address !== '') lines.push(`ADR:;;${escapeVcardText(contact.address)};;;;`);
    if (contact.website !== '') lines.push(`URL:${escapeVcardText(contact.website)}`);
    if (contact.notes !== '') lines.push(`NOTE:${escapeVcardText(contact.notes)}`);
    lines.push('END:VCARD');
    return lines.map(fold).join('\r\n');
  });
  return cards.length === 0 ? '' : `${cards.join('\r\n')}\r\n`;
}
