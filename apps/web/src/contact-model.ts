import type { Contact, ContactDuplicate, ContactFileFormat, ContactImportEntry, ContactInput, ContactSummary } from './api.ts';
import { hasMessage, t } from './i18n/index.ts';

/** Bounds shown in the forms; the server enforces them. */
export const CONTACT_LIMITS = { name: 200, organisation: 200, category: 60, label: 40, phone: 40, email: 254, address: 500, website: 500, notes: 4000, points: 10, importBytes: 1024 * 1024 } as const;

export interface PointForm {
  readonly value: string;
  readonly label: string;
}

/** What the Contact form holds while it is edited: plain text, as typed. */
export interface ContactForm {
  readonly name: string;
  readonly organisation: string;
  readonly category: string;
  readonly emails: readonly PointForm[];
  readonly phones: readonly PointForm[];
  readonly address: string;
  readonly website: string;
  readonly notes: string;
}

export const emptyContactForm = (name = ''): ContactForm => ({ name, organisation: '', category: '', emails: [], phones: [], address: '', website: '', notes: '' });

export const formOf = (contact: Contact): ContactForm => ({
  name: contact.name,
  organisation: contact.organisation,
  category: contact.category,
  emails: contact.emails.map((email) => ({ value: email.value, label: email.label })),
  phones: contact.phones.map((phone) => ({ value: phone.value, label: phone.label })),
  address: contact.address,
  website: contact.website,
  notes: contact.notes,
});

/** The form as it is sent: rows left empty are no entries. */
export const inputOf = (form: ContactForm): ContactInput => ({
  name: form.name,
  organisation: form.organisation,
  category: form.category,
  emails: form.emails.filter((email) => email.value.trim() !== ''),
  phones: form.phones.filter((phone) => phone.value.trim() !== ''),
  address: form.address,
  website: form.website,
  notes: form.notes,
});

/** Whether the form holds anything that could match another Contact — otherwise there is nothing to ask the server. */
export const worthChecking = (form: ContactForm): boolean => form.name.trim() !== '';

/** The parameters of a listing. */
export function contactListingParams(find: { readonly q: string; readonly category: string }, cursor: string | null = null): string {
  const params = new URLSearchParams();
  if (find.q.trim() !== '') params.set('q', find.q.trim());
  if (find.category !== '') params.set('category', find.category);
  if (cursor !== null) params.set('cursor', cursor);
  return params.toString();
}

/** One line under a Contact's name: what they are and where they belong. */
export const contactContext = (contact: Pick<ContactSummary, 'category' | 'organisation'>): string => [contact.category, contact.organisation].filter((part) => part !== '').join(' · ');

/**
 * A link is used only when it starts with the scheme it is meant to have: `tel:` for a number,
 * `mailto:` for an address, `http(s)` for a website. The server builds and checks them; this is the
 * second look before text becomes something that can be clicked.
 */
export function safeHref(href: string, kind: 'tel' | 'mailto' | 'web'): string | null {
  const ok = kind === 'tel' ? /^tel:\+?[0-9]+$/.test(href) : kind === 'mailto' ? /^mailto:[^\s?&]+$/.test(href) : /^https?:\/\/[^\s]+$/i.test(href);
  return ok ? href : null;
}

/** "Mario Rossi — same email address and phone number". */
export function duplicateText(duplicate: Pick<ContactDuplicate, 'name' | 'reasons'>): string {
  const reasons = duplicate.reasons.map((reason) => t(reason === 'email' ? 'contacts.duplicate.email' : reason === 'phone' ? 'contacts.duplicate.phone' : 'contacts.duplicate.name'));
  return t('contacts.duplicate.line', { name: duplicate.name, reasons: reasons.join(t('contacts.duplicate.and')) });
}

/** The format of an import file by its name: `.csv`, or `.vcf` / `.vcard`. Anything else is not offered for import. */
export function importFormatOf(fileName: string): ContactFileFormat | null {
  const name = fileName.toLowerCase();
  if (name.endsWith('.csv')) return 'csv';
  return name.endsWith('.vcf') || name.endsWith('.vcard') ? 'vcard' : null;
}

/** Whether an entry of an import may be the same as something — an existing Contact or an earlier entry of the file. */
export const isPossibleDuplicate = (entry: ContactImportEntry): boolean => entry.duplicates.length > 0 || entry.sameAs.length > 0;

/**
 * What is ticked when the preview opens: every entry that can be imported and is no possible
 * duplicate. Possible duplicates start unticked — the person decides for each whether to import it
 * anyway; nothing is left out without being shown.
 */
export const defaultImportSelection = (entries: readonly ContactImportEntry[]): number[] => entries.flatMap((entry, index) => (entry.contact !== null && !isPossibleDuplicate(entry) ? [index] : []));

export function importSummary(entries: readonly ContactImportEntry[]): { readonly total: number; readonly importable: number; readonly duplicates: number; readonly problems: number } {
  return {
    total: entries.length,
    importable: entries.filter((entry) => entry.contact !== null).length,
    duplicates: entries.filter((entry) => entry.contact !== null && isPossibleDuplicate(entry)).length,
    problems: entries.filter((entry) => entry.contact === null).length,
  };
}

/** Why an entry cannot be imported, in words; an unknown code still says which field. */
export function importProblemText(problem: { readonly code: string; readonly field: string }): string {
  const key = `error.${problem.code}`;
  return hasMessage(key) ? t(key) : t('contacts.import.problemField', { field: problem.field });
}

/** Why a whole file was refused. */
export function importRefusalText(reason: unknown, line: unknown): string {
  const key = `contacts.importRefused.${String(reason)}`;
  const text = hasMessage(key) ? t(key) : t('contacts.importRefused.other');
  return typeof line === 'number' ? `${text} ${t('contacts.importRefused.line', { line })}` : text;
}
