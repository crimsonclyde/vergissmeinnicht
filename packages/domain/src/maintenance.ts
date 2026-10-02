import { foldSearchText, parseSearchTerms } from './document-search.ts';
import { parseDocumentDate } from './document.ts';
import { DomainValidationError } from './errors.ts';
import { BIDI_CONTROLS, CONTROL_CHARS, normalizeSingleLineName } from './text.ts';
import { UUID_V4 } from './user.ts';

/**
 * Maintenance (steps.md 16.7): work on the house that is planned, under way, done or called off — a
 * boiler service, a repair, an inspection. A **MaintenanceRecord** has one of four statuses, and the
 * status is only ever set by a person: linking or completing a Run, an Occurrence or a Reminder never
 * changes a record, and changing a record never touches any of them. A record notifies nobody by
 * itself — reminders are ordinary Schedules.
 */
export type MaintenanceRecordId = string & { readonly __brand: 'MaintenanceRecordId' };

/** The four statuses (decided): the columns of the board, in this order. There are no others. */
export const MAINTENANCE_STATUSES = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

export const MAX_MAINTENANCE_TITLE_LENGTH = 200;
export const MAX_MAINTENANCE_CATEGORY_LENGTH = 60;
export const MAX_MAINTENANCE_DESCRIPTION_LENGTH = 4000;
export const MAX_MAINTENANCE_RECORDS_PER_WORKSPACE = 20_000;
export const MAINTENANCE_PAGE_SIZE = 50;
/** Cards shown per column of the board; the rest of a column is in the List. */
export const MAINTENANCE_BOARD_COLUMN_SIZE = 50;
export const MAX_LINKS_PER_MAINTENANCE_RECORD = 50;
export const MAX_MAINTENANCE_RECORDS_PER_PURGE = 200;

/** What a MaintenanceRecord can be linked to: evidence (a Document), how it is done (a Procedure), an execution (a Run), a Reminder or scheduled Procedure (a Schedule). */
export const MAINTENANCE_LINK_TYPES = ['document', 'procedure', 'run', 'schedule'] as const;
export type MaintenanceLinkType = (typeof MAINTENANCE_LINK_TYPES)[number];

export function parseMaintenanceRecordId(value: string): MaintenanceRecordId {
  if (!UUID_V4.test(value)) throw new DomainValidationError('record', 'invalid_maintenance_id', 'Id must be a lower-case UUIDv4');
  return value as MaintenanceRecordId;
}

export function parseMaintenanceStatus(value: string): MaintenanceStatus {
  if (!(MAINTENANCE_STATUSES as readonly string[]).includes(value)) throw new DomainValidationError('status', 'invalid_maintenance_status', 'Unknown status');
  return value as MaintenanceStatus;
}

export function parseMaintenanceLinkTarget(input: { readonly type: string; readonly id: string }): { readonly type: MaintenanceLinkType; readonly id: string } {
  if (!(MAINTENANCE_LINK_TYPES as readonly string[]).includes(input.type) || !UUID_V4.test(input.id)) throw new DomainValidationError('target', 'invalid_link_target', 'Unknown kind of record');
  return { type: input.type as MaintenanceLinkType, id: input.id };
}

/**
 * ISO 4217 codes in use. A cost is recorded with its currency and never converted, added up or
 * compared across currencies.
 */
export const CURRENCY_CODES: readonly string[] = (
  'AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XOF XPF YER ZAR ZMW ZWG'
).split(' ');

/** What some work cost: an amount as it was written on the invoice, and its currency. A recorded fact — nothing is calculated from it. */
export interface MaintenanceCost {
  /** A plain decimal number: digits, optionally a point and up to three decimals. Never negative. */
  readonly amount: string;
  readonly currency: string;
}

const AMOUNT = /^(\d{1,12})(?:[.,](\d{1,3}))?$/;

/**
 * An amount as text — never a floating-point number, so "120.10" stays "120.10". A comma is accepted
 * as the decimal sign and written as a point; leading zeros are dropped. No thousands separators, no
 * sign, no exponent.
 */
export function normalizeCost(input: { readonly amount: string; readonly currency: string } | null | undefined): MaintenanceCost | null {
  if (input === null || input === undefined || (input.amount.trim() === '' && input.currency.trim() === '')) return null;
  const match = AMOUNT.exec(input.amount.trim());
  if (match === null) throw new DomainValidationError('cost', 'invalid_cost_amount', 'The amount must be a number like 120 or 120.50');
  const currency = input.currency.trim().toUpperCase();
  if (!CURRENCY_CODES.includes(currency)) throw new DomainValidationError('cost', 'invalid_cost_currency', 'Unknown currency');
  const whole = (match[1] ?? '0').replace(/^0+(?=\d)/, '');
  return { amount: match[2] === undefined ? whole : `${whole}.${match[2]}`, currency };
}

// Line feed and tab are the only control characters a description may contain.
const DISALLOWED_IN_TEXT = new RegExp(`(?![\\n\\t])${CONTROL_CHARS.source}`, 'u');

export interface MaintenanceContent {
  readonly title: string;
  /** Free text ("Heating", "Garden"); may be empty. */
  readonly category: string;
  /** When the work is planned for, or was done if no completion date says otherwise: `YYYY-MM-DD`, or none. */
  readonly date: string | null;
  readonly description: string;
  /** The Contact responsible for the work (the technician), by id; checked against the Workspace when saved. */
  readonly contactId: string | null;
  readonly cost: MaintenanceCost | null;
}

export interface MaintenanceInput {
  readonly title: string;
  readonly category?: string | undefined;
  readonly date?: string | null | undefined;
  readonly description?: string | undefined;
  readonly contactId?: string | null | undefined;
  readonly cost?: { readonly amount: string; readonly currency: string } | null | undefined;
}

/** Only the title is required. */
export function normalizeMaintenanceContent(input: MaintenanceInput): MaintenanceContent {
  const description = (input.description ?? '').replace(/\r\n?/g, '\n').normalize('NFC').trim();
  if ([...description].length > MAX_MAINTENANCE_DESCRIPTION_LENGTH) throw new DomainValidationError('description', 'maintenance_description_too_long', 'The description is too long');
  if (DISALLOWED_IN_TEXT.test(description) || BIDI_CONTROLS.test(description)) throw new DomainValidationError('description', 'maintenance_description_invalid_characters', 'The description contains control characters');
  if (input.contactId !== null && input.contactId !== undefined && !UUID_V4.test(input.contactId)) throw new DomainValidationError('contact', 'invalid_contact_id', 'Id must be a lower-case UUIDv4');
  return {
    title: normalizeSingleLineName(input.title, { field: 'title', codePrefix: 'maintenance_title', label: 'Title', maxLength: MAX_MAINTENANCE_TITLE_LENGTH }),
    category: input.category === undefined || input.category.trim() === '' ? '' : normalizeSingleLineName(input.category, { field: 'category', codePrefix: 'maintenance_category', label: 'Category', maxLength: MAX_MAINTENANCE_CATEGORY_LENGTH }),
    date: input.date === null || input.date === undefined || input.date === '' ? null : parseDocumentDate(input.date),
    description,
    contactId: input.contactId ?? null,
    cost: normalizeCost(input.cost),
  };
}

/**
 * Every change between the four statuses is allowed — reopening a Completed or Cancelled record is an
 * ordinary, audited change — except "to the status it already has". A record that becomes Completed
 * gets its completion date; a record that leaves Completed loses it.
 */
export function statusChange(from: MaintenanceStatus, to: MaintenanceStatus, completedOn: string | null, today: string): { readonly status: MaintenanceStatus; readonly completedOn: string | null } | undefined {
  if (from === to) return undefined;
  return { status: to, completedOn: to === 'COMPLETED' ? (completedOn ?? today) : null };
}

/** The day a record is filed under in the List: when it was completed, else its date, else the day it was created. Always a date. */
export const maintenanceSortDate = (record: { readonly completedOn: string | null; readonly date: string | null; readonly createdOn: string }): string => record.completedOn ?? record.date ?? record.createdOn;

export const maintenanceCategoryKey = (category: string): string => foldSearchText(category);

/** What a search looks at: title, category and description, folded. */
export const maintenanceSearchText = (content: Pick<MaintenanceContent, 'title' | 'category' | 'description'>): string => foldSearchText([content.title, content.category, content.description].filter((part) => part !== '').join('\n'));

export interface MaintenanceQuery {
  readonly terms: readonly string[];
  readonly status: MaintenanceStatus | null;
  /** Folded. */
  readonly category: string | null;
  readonly contactId: string | null;
  /** The year of the day a record is filed under. */
  readonly year: number | null;
}

export function parseMaintenanceQuery(input: { readonly q?: string | undefined; readonly status?: string | undefined; readonly category?: string | undefined; readonly contact?: string | undefined; readonly year?: number | undefined }): MaintenanceQuery {
  if (input.contact !== undefined && !UUID_V4.test(input.contact)) throw new DomainValidationError('contact', 'invalid_contact_id', 'Id must be a lower-case UUIDv4');
  if (input.year !== undefined && (!Number.isInteger(input.year) || input.year < 1900 || input.year > 2200)) throw new DomainValidationError('year', 'invalid_document_year', 'The year must be between 1900 and 2200');
  return {
    terms: parseSearchTerms(input.q ?? ''),
    status: input.status === undefined ? null : parseMaintenanceStatus(input.status),
    category: input.category === undefined ? null : maintenanceCategoryKey(normalizeSingleLineName(input.category, { field: 'category', codePrefix: 'maintenance_category', label: 'Category', maxLength: MAX_MAINTENANCE_CATEGORY_LENGTH })),
    contactId: input.contact ?? null,
    year: input.year ?? null,
  };
}

/** Where a page of the List ended: the last record's day and id (newest first). */
export interface MaintenanceCursor {
  readonly value: string;
  readonly id: string;
}

export function parseMaintenanceCursor(input: unknown): MaintenanceCursor | undefined {
  if (!Array.isArray(input) || input.length !== 2) return undefined;
  const [value, id] = input as [unknown, unknown];
  if (typeof id !== 'string' || !UUID_V4.test(id) || typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return { value, id };
}
