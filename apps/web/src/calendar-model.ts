import type { Occurrence, PersonRef, ProjectedOccurrence } from './api.ts';
import { addDays, todayIn } from './schedule-dates.ts';

/**
 * The calendar's view model (14.4): pure functions over what the server returned. Filters are a
 * per-viewer convenience — every entry here was already authorised and sent by the server.
 */

/** What an entry is, as shown (glyph + text): an open Occurrence past its date is OVERDUE; PROJECTED has no Occurrence yet. */
export type EntryStatus = 'OVERDUE' | 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED' | 'PROJECTED';

export type CalendarEntry =
  | { readonly key: string; readonly date: string; readonly time: string | null; readonly status: Exclude<EntryStatus, 'PROJECTED'>; readonly occurrence: Occurrence }
  | { readonly key: string; readonly date: string; readonly time: string | null; readonly status: 'PROJECTED'; readonly projected: ProjectedOccurrence };

export const STATUS_GLYPH: Readonly<Record<EntryStatus, string>> = { OVERDUE: '!', OPEN: '○', IN_PROGRESS: '▶', COMPLETED: '✓', SKIPPED: '↷', PROJECTED: '◌' };

export const scheduleOf = (entry: CalendarEntry) => (entry.status === 'PROJECTED' ? entry.projected.schedule : entry.occurrence.schedule);
export const responsibleOf = (entry: CalendarEntry): PersonRef | null => (entry.status === 'PROJECTED' ? entry.projected.responsible : entry.occurrence.responsible);

/** Overdue is judged like on Home: by the calendar date in the Schedule's own zone. */
export function statusOf(occurrence: Occurrence, now: Date = new Date()): Exclude<EntryStatus, 'PROJECTED'> | null {
  switch (occurrence.state) {
    case 'COMPLETED':
    case 'SKIPPED':
      return occurrence.state;
    case 'CANCELLED':
      return null;
    default:
      if (occurrence.dueDate < todayIn(occurrence.schedule.timeZone, now)) return 'OVERDUE';
      return occurrence.state;
  }
}

/** All entries of a range, by date, then time (untimed first), then title. */
export function entriesOf(range: { readonly occurrences: readonly Occurrence[]; readonly projected: readonly ProjectedOccurrence[] }, now: Date = new Date()): CalendarEntry[] {
  const entries: CalendarEntry[] = [];
  for (const occurrence of range.occurrences) {
    const status = statusOf(occurrence, now);
    if (status !== null) entries.push({ key: occurrence.id, date: occurrence.dueDate, time: occurrence.time, status, occurrence });
  }
  for (const projected of range.projected) {
    entries.push({ key: `${projected.schedule.id}@${projected.dueDate}`, date: projected.dueDate, time: projected.time, status: 'PROJECTED', projected });
  }
  return entries.sort(
    (a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '') || scheduleOf(a).title.localeCompare(scheduleOf(b).title) || a.key.localeCompare(b.key),
  );
}

// ---- Filters

export const STATUS_FILTERS = ['OPEN', 'OVERDUE', 'COMPLETED', 'SKIPPED'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export interface CalendarFilters {
  /** Shown groups; "open" includes in-progress and planned (projected) entries. */
  readonly statuses: readonly StatusFilter[];
  /** `ALL`, `MINE`, `SHARED` (nobody responsible), or a member's user id. */
  readonly responsible: string;
  readonly type: 'ALL' | 'REMINDER' | 'PROCEDURE';
}

export const DEFAULT_FILTERS: CalendarFilters = { statuses: STATUS_FILTERS, responsible: 'ALL', type: 'ALL' };

const groupOf = (status: EntryStatus): StatusFilter => (status === 'IN_PROGRESS' || status === 'PROJECTED' ? 'OPEN' : status);

/** Filters combine: an entry is shown only if its status, its responsible person and its type all match. */
export function matches(entry: CalendarEntry, filters: CalendarFilters, viewerId: string): boolean {
  if (!filters.statuses.includes(groupOf(entry.status))) return false;
  if (filters.type !== 'ALL' && scheduleOf(entry).kind !== filters.type) return false;
  const responsible = responsibleOf(entry);
  switch (filters.responsible) {
    case 'ALL':
      return true;
    case 'SHARED':
      return responsible === null;
    case 'MINE':
      return responsible?.id === viewerId;
    default:
      return responsible?.id === filters.responsible;
  }
}

/** The people responsible for something in the entries (for the filter), by name. */
export function responsiblePeople(entries: readonly CalendarEntry[]): PersonRef[] {
  const people = new Map<string, PersonRef>();
  for (const entry of entries) {
    const person = responsibleOf(entry);
    if (person !== null) people.set(person.id, person);
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Reads remembered filters; anything unexpected falls back to the defaults. */
export function parseFilters(raw: string | null): CalendarFilters {
  if (raw === null) return DEFAULT_FILTERS;
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof CalendarFilters, unknown>>;
    const statuses = Array.isArray(value.statuses) ? STATUS_FILTERS.filter((status) => (value.statuses as unknown[]).includes(status)) : STATUS_FILTERS;
    const responsible = typeof value.responsible === 'string' && /^(ALL|MINE|SHARED|[0-9a-f-]{36})$/.test(value.responsible) ? value.responsible : 'ALL';
    const type = value.type === 'REMINDER' || value.type === 'PROCEDURE' ? value.type : 'ALL';
    return { statuses, responsible, type };
  } catch {
    return DEFAULT_FILTERS;
  }
}

// ---- Months and days (`YYYY-MM`, `YYYY-MM-DD`)

export const monthOf = (date: string) => date.slice(0, 7);

export function addMonths(month: string, count: number): string {
  const [year, index] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, index - 1 + count, 1)).toISOString().slice(0, 7);
}

export function lastDayOf(month: string): string {
  return addDays(`${addMonths(month, 1)}-01`, -1);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
function weekdayOf(date: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() || 7;
}

/** The month as whole weeks, Monday first: the days before the 1st and after the last belong to the neighbours. */
export function monthGrid(month: string): string[][] {
  const first = `${month}-01`;
  const last = lastDayOf(month);
  const weeks: string[][] = [];
  for (let day = addDays(first, 1 - weekdayOf(first)); day <= last; day = addDays(day, 7)) {
    weeks.push(Array.from({ length: 7 }, (_unused, index) => addDays(day, index)));
  }
  return weeks;
}

/** Where an arrow key leads from a day (keyboard navigation between days), or null for other keys. */
export function dayAfterKey(date: string, key: string): string | null {
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[key];
  return step === undefined ? null : addDays(date, step);
}
