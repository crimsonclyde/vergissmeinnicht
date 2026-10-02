import { foldSearchText, parseSearchTerms } from './document-search.ts';
import { DomainValidationError } from './errors.ts';
import { BIDI_CONTROLS, CONTROL_CHARS, INVISIBLE_OR_INVALID_CHARS, normalizeSingleLineName } from './text.ts';
import { UUID_V4, normalizeEmail } from './user.ts';

/**
 * Contacts (steps.md 16.6): the people and organisations a Workspace deals with — the plumber, the
 * utility provider, an office. A Contact is **not a User**: it cannot sign in and grants no access to
 * anything. Only the name is required. Contacts are personal data of third parties, visible to every
 * member of the Workspace.
 */
export type ContactId = string & { readonly __brand: 'ContactId' };

export const MAX_CONTACT_NAME_LENGTH = 200;
export const MAX_CONTACT_ORGANISATION_LENGTH = 200;
export const MAX_CONTACT_CATEGORY_LENGTH = 60;
export const MAX_CONTACT_LABEL_LENGTH = 40;
export const MAX_CONTACT_EMAILS = 10;
export const MAX_CONTACT_PHONES = 10;
export const MAX_CONTACT_PHONE_LENGTH = 40;
export const MAX_CONTACT_ADDRESS_LENGTH = 500;
export const MAX_CONTACT_WEBSITE_LENGTH = 500;
export const MAX_CONTACT_NOTES_LENGTH = 4000;
export const MAX_CONTACTS_PER_WORKSPACE = 10_000;
export const CONTACTS_PAGE_SIZE = 50;
/** Contacts in Trash deleted for good in one request ("Empty Trash" has no such limit). */
export const MAX_CONTACTS_PER_PURGE = 200;
export const MAX_LINKS_PER_CONTACT = 50;
/** One import: at most this many contacts, from a file of at most this many bytes. */
export const MAX_CONTACTS_PER_IMPORT = 1000;
export const MAX_CONTACT_IMPORT_BYTES = 1024 * 1024;

export function parseContactId(value: string): ContactId {
  if (!UUID_V4.test(value)) throw new DomainValidationError('contact', 'invalid_contact_id', 'Id must be a lower-case UUIDv4');
  return value as ContactId;
}

/** An email address or a phone number with what it is for ("Office", "Mobile"); the label may be empty. */
export interface ContactPoint {
  readonly value: string;
  readonly label: string;
}

export interface ContactContent {
  /** A person or an organisation: the only required field. */
  readonly name: string;
  readonly organisation: string;
  /** What they are to the Workspace: "Plumber", "Insurer". Free text. */
  readonly category: string;
  readonly emails: readonly ContactPoint[];
  readonly phones: readonly ContactPoint[];
  /** A postal address as free text, line by line. */
  readonly address: string;
  /** An `http` or `https` address, or empty. */
  readonly website: string;
  readonly notes: string;
}

export interface ContactInput {
  readonly name: string;
  readonly organisation?: string | undefined;
  readonly category?: string | undefined;
  readonly emails?: readonly { readonly value: string; readonly label?: string | undefined }[] | undefined;
  readonly phones?: readonly { readonly value: string; readonly label?: string | undefined }[] | undefined;
  readonly address?: string | undefined;
  readonly website?: string | undefined;
  readonly notes?: string | undefined;
}

/** An optional single line: empty stays empty, anything else follows the rules of a name. */
function optionalLine(input: string | undefined, rule: { readonly field: string; readonly codePrefix: string; readonly label: string; readonly maxLength: number }): string {
  return input === undefined || input.trim() === '' ? '' : normalizeSingleLineName(input, rule);
}

// Line feed and tab are the only control characters free text may contain.
const DISALLOWED_IN_TEXT = new RegExp(`(?![\\n\\t])${CONTROL_CHARS.source}`, 'u');

function freeText(input: string | undefined, rule: { readonly field: string; readonly codePrefix: string; readonly label: string; readonly maxLength: number }): string {
  const text = (input ?? '').replace(/\r\n?/g, '\n').normalize('NFC').trim();
  if ([...text].length > rule.maxLength) throw new DomainValidationError(rule.field, `${rule.codePrefix}_too_long`, `${rule.label} is too long`);
  if (DISALLOWED_IN_TEXT.test(text) || BIDI_CONTROLS.test(text)) throw new DomainValidationError(rule.field, `${rule.codePrefix}_invalid_characters`, `${rule.label} contains control characters`);
  return text;
}

const PHONE_SHAPE = /^\+?[0-9 ()\-./]+$/;

/**
 * A phone number as people write it: digits with spaces, brackets, hyphens, dots or slashes, and an
 * optional leading `+`. Between 3 and 20 digits ("112" is a number). Kept as written (trimmed, with
 * single spaces); `phoneKey` is what it is compared and dialled by.
 */
export function normalizePhone(input: string): string {
  const trimmed = input.normalize('NFKC').trim();
  // A line break or tab inside is not formatting: refused, not turned into a space.
  if (CONTROL_CHARS.test(trimmed)) throw new DomainValidationError('phone', 'invalid_phone', 'Phone number is not valid');
  const phone = trimmed.replace(/\s+/gu, ' ');
  const digits = phone.replace(/\D/g, '').length;
  if (phone.length > MAX_CONTACT_PHONE_LENGTH || !PHONE_SHAPE.test(phone) || digits < 3 || digits > 20) {
    throw new DomainValidationError('phone', 'invalid_phone', 'Phone number is not valid');
  }
  return phone;
}

/**
 * The number without its formatting: digits, with a leading `+` for an international number (`00…` is
 * the same as `+…`). What a `tel:` link is built from, and one of the two things a number is compared
 * by (the other is `phoneTailKey`).
 */
export function phoneKey(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (phone.trimStart().startsWith('+')) return `+${digits}`;
  return digits.startsWith('00') && digits.length > 4 ? `+${digits.slice(2)}` : digits;
}

/** How many trailing digits two numbers must share to be pointed out as possibly the same line. */
export const PHONE_TAIL_DIGITS = 8;

/**
 * The last eight digits of a number, for numbers that have at least that many: what a national and an
 * international spelling of one line have in common ("0471 123456" and "+39 0471 123456";
 * "030 1234567" and "+49 30 1234567"). Shorter numbers ("112", a six-digit local number) have no tail
 * and are compared as a whole only. Two different lines can share a tail — this is a hint for a
 * person to look at, never a reason to merge or refuse.
 */
export function phoneTailKey(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= PHONE_TAIL_DIGITS ? `tail:${digits.slice(-PHONE_TAIL_DIGITS)}` : null;
}

/** `tel:` followed by the digits (and `+`) only — never anything else of what was entered. */
export const telHref = (phone: string): string => `tel:${phoneKey(phone)}`;

/** `mailto:` for an address that passed `normalizeEmail`; encoded so that nothing in it can add headers. */
export const mailtoHref = (email: string): string => `mailto:${encodeURIComponent(email).replace(/%40/g, '@')}`;

// The WHATWG URL parser of the platform (browser and Node alike); the domain package compiles without
// either's type library, so its shape is stated here.
declare const URL: new (input: string) => { readonly protocol: string; readonly username: string; readonly password: string; readonly hostname: string; readonly href: string };

const SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d)/i;

/**
 * A website: an absolute `http` or `https` address without user name or password. "example.org" is
 * taken as `https://example.org`. Anything with another scheme (`javascript:`, `data:`, `file:` …)
 * is refused. Returns the address as the URL parser writes it, or empty for no website.
 */
export function normalizeWebsite(input: string | undefined): string {
  const text = (input ?? '').normalize('NFC').trim();
  if (text === '') return '';
  const invalid = () => new DomainValidationError('website', 'invalid_website', 'The website must be an http or https address');
  if ([...text].length > MAX_CONTACT_WEBSITE_LENGTH || INVISIBLE_OR_INVALID_CHARS.test(text) || /\s/u.test(text)) throw invalid();
  let url: InstanceType<typeof URL>;
  try {
    url = new URL(SCHEME.test(text) ? text : `https://${text}`);
  } catch {
    throw invalid();
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username !== '' || url.password !== '' || !url.hostname.includes('.') || url.href.length > MAX_CONTACT_WEBSITE_LENGTH) throw invalid();
  return url.href;
}

function points(
  input: readonly { readonly value: string; readonly label?: string | undefined }[] | undefined,
  rule: { readonly field: string; readonly max: number; readonly code: string; readonly normalize: (value: string) => string; readonly key: (value: string) => string },
): ContactPoint[] {
  const result: ContactPoint[] = [];
  const seen = new Set<string>();
  for (const each of input ?? []) {
    if (each.value.trim() === '') continue;
    const value = rule.normalize(each.value);
    // The same address or number twice on one Contact is one entry.
    if (seen.has(rule.key(value))) continue;
    seen.add(rule.key(value));
    result.push({ value, label: optionalLine(each.label, { field: rule.field, codePrefix: 'contact_label', label: 'Label', maxLength: MAX_CONTACT_LABEL_LENGTH }) });
  }
  if (result.length > rule.max) throw new DomainValidationError(rule.field, rule.code, `At most ${rule.max} entries`);
  return result;
}

/** Only the name is required; everything else may stay empty. */
export function normalizeContactContent(input: ContactInput): ContactContent {
  return {
    name: normalizeSingleLineName(input.name, { field: 'name', codePrefix: 'contact_name', label: 'Name', maxLength: MAX_CONTACT_NAME_LENGTH }),
    organisation: optionalLine(input.organisation, { field: 'organisation', codePrefix: 'contact_organisation', label: 'Organisation', maxLength: MAX_CONTACT_ORGANISATION_LENGTH }),
    category: optionalLine(input.category, { field: 'category', codePrefix: 'contact_category', label: 'Category', maxLength: MAX_CONTACT_CATEGORY_LENGTH }),
    emails: points(input.emails, { field: 'emails', max: MAX_CONTACT_EMAILS, code: 'too_many_contact_emails', normalize: normalizeEmail, key: (value) => value }),
    phones: points(input.phones, { field: 'phones', max: MAX_CONTACT_PHONES, code: 'too_many_contact_phones', normalize: normalizePhone, key: phoneKey }),
    address: freeText(input.address, { field: 'address', codePrefix: 'contact_address', label: 'Address', maxLength: MAX_CONTACT_ADDRESS_LENGTH }),
    website: normalizeWebsite(input.website),
    notes: freeText(input.notes, { field: 'notes', codePrefix: 'contact_notes', label: 'Notes', maxLength: MAX_CONTACT_NOTES_LENGTH }),
  };
}

// ---- Finding and comparing

/** What Contacts are sorted by: the folded name. */
export const contactSortKey = (name: string): string => foldSearchText(name);

/** A category as the filter compares it. */
export const contactCategoryKey = (category: string): string => foldSearchText(category);

/**
 * A name as it is compared for possible duplicates: without case, accents or punctuation, its words in
 * alphabetical order — "Rossi, Mario", "MARIO ROSSI" and "Mario Rossi" are one name. Misspellings are
 * not recognised. Empty when the name has no letter or digit.
 */
export function contactNameKey(name: string): string {
  return foldSearchText(name)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '')
    .sort()
    .join(' ');
}

export const CONTACT_KEY_KINDS = ['email', 'phone', 'name'] as const;
export type ContactKeyKind = (typeof CONTACT_KEY_KINDS)[number];

export interface ContactKey {
  readonly kind: ContactKeyKind;
  readonly key: string;
}

/** What a Contact is compared by: each email address, each phone number without formatting and by its last digits, and its name. */
export function contactKeys(content: Pick<ContactContent, 'name' | 'emails' | 'phones'>): ContactKey[] {
  const name = contactNameKey(content.name);
  return [
    ...content.emails.map((email): ContactKey => ({ kind: 'email', key: email.value })),
    ...[...new Set(content.phones.flatMap((phone) => [phoneKey(phone.value), phoneTailKey(phone.value)]).filter((key) => key !== null))].map((key): ContactKey => ({ kind: 'phone', key })),
    ...(name === '' ? [] : [{ kind: 'name' as const, key: name }]),
  ];
}

/** Everything a search looks at, folded, one per line: name, organisation, category, email addresses, phone numbers (as written and as digits). */
export function contactSearchText(content: Pick<ContactContent, 'name' | 'organisation' | 'category' | 'emails' | 'phones'>): string {
  return foldSearchText(
    [content.name, content.organisation, content.category, ...content.emails.map((email) => email.value), ...content.phones.flatMap((phone) => [phone.value, phoneKey(phone.value), phone.value.replace(/\D/g, '')])].filter((part) => part !== '').join('\n'),
  );
}

export interface ContactQuery {
  readonly terms: readonly string[];
  /** Folded; `null` = every category. */
  readonly category: string | null;
}

export function parseContactQuery(input: { readonly q?: string | undefined; readonly category?: string | undefined }): ContactQuery {
  const category = input.category === undefined ? null : contactCategoryKey(normalizeSingleLineName(input.category, { field: 'category', codePrefix: 'contact_category', label: 'Category', maxLength: MAX_CONTACT_CATEGORY_LENGTH }));
  return { terms: parseSearchTerms(input.q ?? ''), category };
}

/** Where a page ended: the last Contact's folded name and its id. */
export interface ContactCursor {
  readonly value: string;
  readonly id: string;
}

export function parseContactCursor(input: unknown): ContactCursor | undefined {
  if (!Array.isArray(input) || input.length !== 2) return undefined;
  const [value, id] = input as [unknown, unknown];
  if (typeof id !== 'string' || !UUID_V4.test(id) || typeof value !== 'string' || value.length > 4000) return undefined;
  return { value, id };
}
