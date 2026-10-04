import type { MaintenanceColumn, MaintenanceInput, MaintenanceRecord, MaintenanceStatus, MaintenanceSummary } from './api.ts';
import { formatCalendarDate, t } from './i18n/index.ts';

/** The four statuses in the order of the board. */
export const STATUSES: readonly MaintenanceStatus[] = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

/** A glyph for every status, always beside its word: colour is never the only sign. */
export const STATUS_GLYPHS: Readonly<Record<MaintenanceStatus, string>> = { PLANNED: '○', IN_PROGRESS: '▶', COMPLETED: '✔', CANCELLED: '✕' };

/** The colour family of each status (existing tokens, contrast-checked in both themes). */
export const STATUS_TONES: Readonly<Record<MaintenanceStatus, string>> = { PLANNED: 'NOT_APPLICABLE', IN_PROGRESS: 'SKIPPED', COMPLETED: 'DONE', CANCELLED: 'NOT_APPLICABLE' };

export const statusLabel = (status: MaintenanceStatus): string =>
  t(status === 'PLANNED' ? 'maintenance.status.PLANNED' : status === 'IN_PROGRESS' ? 'maintenance.status.IN_PROGRESS' : status === 'COMPLETED' ? 'maintenance.status.COMPLETED' : 'maintenance.status.CANCELLED');

/** Bounds shown in the forms; the server enforces them. */
export const MAINTENANCE_LIMITS = { title: 200, category: 60, description: 4000 } as const;

/** Today in the person's own time zone, as `YYYY-MM-DD`: the day work is completed when they say so now. */
export function localToday(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** A cost exactly as recorded: the amount as text and its currency. Never rounded, converted or added up. */
export const costText = (cost: { readonly amount: string; readonly currency: string }): string => `${cost.amount} ${cost.currency}`;

/** The date line of a record: when it was completed, or when it is planned for — always saying which. */
export function dateText(record: Pick<MaintenanceSummary, 'status' | 'completedOn' | 'date'>): string | null {
  if (record.completedOn !== null) return t('maintenance.completedOn', { date: formatCalendarDate(record.completedOn) });
  if (record.date === null) return null;
  return t(record.status === 'CANCELLED' ? 'maintenance.wasPlannedFor' : 'maintenance.plannedFor', { date: formatCalendarDate(record.date) });
}

/** One line under a card's title: category, date, who is responsible. */
export function cardContext(record: Pick<MaintenanceSummary, 'status' | 'completedOn' | 'date' | 'category' | 'contact'>): string {
  const contact = record.contact === null ? null : (record.contact.name ?? t('contacts.deletedContact'));
  return [record.category === '' ? null : record.category, dateText(record), contact].filter((part) => part !== null).join(' · ');
}

export interface MaintenanceForm {
  readonly title: string;
  readonly category: string;
  readonly date: string;
  readonly description: string;
  readonly contactId: string;
  readonly amount: string;
  readonly currency: string;
}

export const emptyMaintenanceForm = (title = '', currency = 'EUR'): MaintenanceForm => ({ title, category: '', date: '', description: '', contactId: '', amount: '', currency });

export const formOfRecord = (record: MaintenanceRecord, currency = 'EUR'): MaintenanceForm => ({
  title: record.title,
  category: record.category,
  date: record.date ?? '',
  description: record.description,
  contactId: record.contact?.id ?? '',
  amount: record.cost?.amount ?? '',
  currency: record.cost?.currency ?? currency,
});

/** The form as it is sent. No amount typed means no cost — the currency alone records nothing. */
export const inputOfForm = (form: MaintenanceForm): MaintenanceInput => ({
  title: form.title,
  category: form.category,
  date: form.date === '' ? null : form.date,
  description: form.description,
  contactId: form.contactId === '' ? null : form.contactId,
  cost: form.amount.trim() === '' ? null : { amount: form.amount.trim(), currency: form.currency },
});

export function maintenanceListingParams(find: { readonly q: string; readonly status: string; readonly category: string; readonly contact: string; readonly year: string;readonly equipment?:string }, cursor: string | null = null): string {
  const params = new URLSearchParams();
  if (find.q.trim() !== '') params.set('q', find.q.trim());
  for (const key of ['status', 'category', 'contact', 'year'] as const) if (find[key] !== '') params.set(key, find[key]);
  if (find.equipment) params.set('equipment',find.equipment);
  if (cursor !== null) params.set('cursor', cursor);
  return params.toString();
}

/** The record a card stands for, wherever it is on the board. */
export const findCard = (columns: readonly MaintenanceColumn[], recordId: string): MaintenanceSummary | undefined => columns.flatMap((column) => column.records).find((record) => record.id === recordId);

/** Whether dropping a card on a column asks for anything: not on the column it is already in. */
export const isMove = (record: MaintenanceSummary | undefined, to: MaintenanceStatus): record is MaintenanceSummary => record !== undefined && record.status !== to;
