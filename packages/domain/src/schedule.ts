import { DomainValidationError } from './errors.ts';
import type { ProcedureIcon, ProcedureId } from './procedure.ts';
import { normalizeProcedureDescription } from './procedure.ts';
import type { RunId } from './run.ts';
import type { RunState } from './states.ts';
import { normalizeSingleLineName } from './text.ts';
import { UUID_V4, type UserId } from './user.ts';
import type { WorkspaceId } from './workspace.ts';

/**
 * Schedules and Occurrences (steps.md 14.1). A **Schedule** is a series of a standalone **Reminder**
 * (e.g. "pay the annual tax") or of a **Procedure**; each dated instance is an **Occurrence** with its
 * own state and history — completing one never completes another. Nothing is executed or recorded as
 * done by the passage of time: a Procedure Occurrence only becomes a Run when someone presses Start.
 *
 * Dates are calendar dates in the Schedule's explicit IANA time zone (never the server's). Fixed
 * recurrence computes every date from the series' anchor (no drift); dates that do not exist in a
 * month (the 31st, 29 February) fall on that month's last day.
 */
export type ScheduleId = string & { readonly __brand: 'ScheduleId' };
export type OccurrenceId = string & { readonly __brand: 'OccurrenceId' };

export const SCHEDULE_KINDS = ['REMINDER', 'PROCEDURE'] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];
export const SCHEDULE_STATES = ['ACTIVE', 'PAUSED', 'ENDED'] as const;
export type ScheduleState = (typeof SCHEDULE_STATES)[number];
export const OCCURRENCE_STATES = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED', 'CANCELLED'] as const;
export type OccurrenceState = (typeof OCCURRENCE_STATES)[number];

/** `DAYS`/`WEEKS`/`MONTHS` before the due date, at the recipient's reminder time (`DAYS:0` = on the due date); `HOURS` before the due moment. */
export const REMINDER_UNITS = ['DAYS', 'WEEKS', 'MONTHS', 'HOURS'] as const;
export type ReminderUnit = (typeof REMINDER_UNITS)[number];

export interface ReminderOffset {
  readonly unit: ReminderUnit;
  readonly amount: number;
}

export const REMINDER_LIMITS = Object.freeze({
  DAYS: { min: 0, max: 366 },
  WEEKS: { min: 1, max: 52 },
  MONTHS: { min: 1, max: 12 },
  HOURS: { min: 1, max: 48 },
});
export const MAX_REMINDERS = 5;
/** How far ahead the first date of a one-time Schedule may be (recurring series have no end). */
export const MAX_SCHEDULE_DAYS_AHEAD = 731;
/** A Workspace keeps at most this many active or paused Schedules. */
export const MAX_OPEN_SCHEDULES_PER_WORKSPACE = 1000;
export const DEFAULT_REMINDER_TIME = '09:00';
export const MAX_REMINDER_TITLE_LENGTH = 120;
export const MAX_SKIP_REASON_LENGTH = 500;

/** Calendar date `YYYY-MM-DD` and wall-clock time `HH:MM` in the Schedule's time zone. */
export type LocalDate = string & { readonly __brand: 'LocalDate' };
export type LocalTime = string & { readonly __brand: 'LocalTime' };
export type TimeZoneName = string & { readonly __brand: 'TimeZoneName' };

// ---- Recurrence

export const RECURRENCE_KINDS = ['ONCE', 'FIXED', 'AFTER_COMPLETION'] as const;
export const RECURRENCE_UNITS = ['DAY', 'WEEK', 'MONTH', 'YEAR'] as const;
export type RecurrenceUnit = (typeof RECURRENCE_UNITS)[number];
export const MAX_RECURRENCE_INTERVAL = 99;

/**
 * - `ONCE`: one Occurrence.
 * - `FIXED`: every `interval` days / weeks (optionally on `weekdays`, 1 = Monday … 7 = Sunday) /
 *   months (on the anchor's day, or the last day with `lastDayOfMonth`) / years, from the anchor.
 * - `AFTER_COMPLETION`: the next Occurrence is due `interval` units after the previous one was
 *   completed or skipped.
 */
export type Recurrence =
  | { readonly kind: 'ONCE' }
  | {
      readonly kind: 'FIXED';
      readonly unit: RecurrenceUnit;
      readonly interval: number;
      readonly weekdays: readonly number[] | null;
      readonly lastDayOfMonth: boolean;
    }
  | { readonly kind: 'AFTER_COMPLETION'; readonly unit: RecurrenceUnit; readonly interval: number };

export interface PersonRef {
  readonly userId: UserId;
  readonly displayName: string;
}

export interface Schedule {
  readonly id: ScheduleId;
  readonly workspaceId: WorkspaceId;
  readonly kind: ScheduleKind;
  /** PROCEDURE only. */
  readonly procedureId: ProcedureId | null;
  /** The source Procedure as it is now; `deleted` if it was deleted since (PROCEDURE only). */
  readonly procedure: { readonly title: string; readonly icon: ProcedureIcon; readonly deleted: boolean } | null;
  /** The Reminder's title, or the Procedure's current title. */
  readonly title: string;
  /** REMINDER only (plain text, may be empty). */
  readonly description: string;
  readonly recurrence: Recurrence;
  /** First due date; fixed recurrence counts from it. */
  readonly anchorDate: LocalDate;
  readonly time: LocalTime | null;
  readonly timeZone: TimeZoneName;
  readonly reminders: readonly ReminderOffset[];
  readonly assignee: PersonRef | null;
  readonly state: ScheduleState;
  readonly pausedAt: Date | null;
  readonly ended: { readonly at: Date; readonly by: PersonRef } | null;
  readonly revision: number;
  readonly createdAt: Date;
  readonly createdBy: PersonRef;
}

export interface Occurrence {
  readonly id: OccurrenceId;
  readonly scheduleId: ScheduleId;
  readonly workspaceId: WorkspaceId;
  readonly dueDate: LocalDate;
  readonly time: LocalTime | null;
  readonly state: OccurrenceState;
  /** Overrides the Schedule's Assignee for this Occurrence only. */
  readonly assignee: PersonRef | null;
  /** Who completed, skipped or cancelled it, and when (null while OPEN/IN_PROGRESS). */
  readonly closed: { readonly at: Date; readonly by: PersonRef } | null;
  readonly skipReason: string | null;
  /** The Run currently linked (IN_PROGRESS: active; COMPLETED: completed). */
  readonly run: { readonly id: RunId; readonly state: RunState; readonly startedAt: Date; readonly startedBy: string } | null;
  readonly revision: number;
  readonly createdAt: Date;
}

export function parseScheduleId(value: string): ScheduleId {
  if (!UUID_V4.test(value)) throw new DomainValidationError('scheduleId', 'invalid_schedule_id', 'Schedule id must be a lower-case UUIDv4');
  return value as ScheduleId;
}

export function parseOccurrenceId(value: string): OccurrenceId {
  if (!UUID_V4.test(value)) throw new DomainValidationError('occurrenceId', 'invalid_occurrence_id', 'Occurrence id must be a lower-case UUIDv4');
  return value as OccurrenceId;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseLocalDate(value: string): LocalDate {
  const match = DATE.exec(value);
  if (match !== null) {
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const check = new Date(Date.UTC(year, month - 1, day));
    if (year >= 2000 && year <= 2200 && check.getUTCMonth() === month - 1 && check.getUTCDate() === day) return value as LocalDate;
  }
  throw new DomainValidationError('date', 'invalid_date', 'Date must be a calendar date YYYY-MM-DD');
}

export function parseLocalTime(value: string, field = 'time'): LocalTime {
  if (!TIME.test(value)) throw new DomainValidationError(field, 'invalid_time', 'Time must be HH:MM (24 h)');
  return value as LocalTime;
}

const ZONE_NAME = /^(?:UTC|[A-Za-z]+(?:\/[A-Za-z0-9_+-]+){1,2})$/;

/** An IANA time-zone name the runtime knows (e.g. `Europe/Berlin`, `UTC`) — never an offset. */
export function parseTimeZone(value: string): TimeZoneName {
  if (value.length <= 64 && ZONE_NAME.test(value)) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return value as TimeZoneName;
    } catch {
      // unknown zone
    }
  }
  throw new DomainValidationError('timeZone', 'invalid_time_zone', 'Time zone must be a known IANA name');
}

export function normalizeReminderTitle(value: string): string {
  return normalizeSingleLineName(value, { field: 'title', codePrefix: 'reminder_title', label: 'Title', maxLength: MAX_REMINDER_TITLE_LENGTH });
}

export function normalizeReminderDescription(value: string): string {
  return normalizeProcedureDescription(value);
}

/** Optional reason when skipping an Occurrence: plain single-line text, may be empty. */
export function normalizeSkipReason(value: string | undefined): string | null {
  if (value === undefined || value.trim() === '') return null;
  return normalizeSingleLineName(value, { field: 'reason', codePrefix: 'skip_reason', label: 'Reason', maxLength: MAX_SKIP_REASON_LENGTH });
}

/** Validates a recurrence rule from the client. */
export function parseRecurrence(input: {
  readonly kind: string;
  readonly unit?: string | undefined;
  readonly interval?: number | undefined;
  readonly weekdays?: readonly number[] | null | undefined;
  readonly lastDayOfMonth?: boolean | undefined;
}): Recurrence {
  const invalid = () => new DomainValidationError('recurrence', 'invalid_recurrence', 'This is not a valid repetition');
  if (input.kind === 'ONCE') return { kind: 'ONCE' };
  if (input.kind !== 'FIXED' && input.kind !== 'AFTER_COMPLETION') throw invalid();
  const unit = input.unit;
  if (unit === undefined || !(RECURRENCE_UNITS as readonly string[]).includes(unit)) throw invalid();
  const interval = input.interval ?? 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > MAX_RECURRENCE_INTERVAL) throw invalid();
  if (input.kind === 'AFTER_COMPLETION') {
    if ((input.weekdays ?? null) !== null || input.lastDayOfMonth === true) throw invalid();
    return { kind: 'AFTER_COMPLETION', unit: unit as RecurrenceUnit, interval };
  }
  let weekdays: number[] | null = null;
  if (input.weekdays !== undefined && input.weekdays !== null) {
    if (unit !== 'WEEK' || input.weekdays.length === 0 || input.weekdays.length > 7) throw invalid();
    if (input.weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) throw invalid();
    weekdays = [...new Set(input.weekdays)].sort((a, b) => a - b);
  }
  if (input.lastDayOfMonth === true && unit !== 'MONTH') throw invalid();
  return { kind: 'FIXED', unit: unit as RecurrenceUnit, interval, weekdays, lastDayOfMonth: input.lastDayOfMonth === true };
}

/** Validates, de-duplicates and sorts reminder offsets (earliest reminder first). */
export function normalizeReminders(offsets: readonly ReminderOffset[]): ReminderOffset[] {
  const seen = new Map<string, ReminderOffset>();
  for (const offset of offsets) {
    const limits = (REMINDER_LIMITS as Record<string, { min: number; max: number } | undefined>)[offset.unit];
    if (limits === undefined || !Number.isInteger(offset.amount) || offset.amount < limits.min || offset.amount > limits.max) {
      throw new DomainValidationError('reminders', 'invalid_reminder', 'Reminders are on the due date, 1–366 days, 1–52 weeks, 1–12 months or 1–48 hours before');
    }
    seen.set(reminderKey(offset), { unit: offset.unit, amount: offset.amount });
  }
  if (seen.size > MAX_REMINDERS) {
    throw new DomainValidationError('reminders', 'too_many_reminders', `At most ${MAX_REMINDERS} reminders`);
  }
  return [...seen.values()].sort((a, b) => approximateHours(b) - approximateHours(a) || REMINDER_UNITS.indexOf(a.unit) - REMINDER_UNITS.indexOf(b.unit));
}

function approximateHours(offset: ReminderOffset): number {
  switch (offset.unit) {
    case 'MONTHS':
      return offset.amount * 30.4 * 24;
    case 'WEEKS':
      return offset.amount * 7 * 24;
    case 'DAYS':
      return offset.amount * 24;
    case 'HOURS':
      return offset.amount;
  }
}

/** Stable key of one reminder offset (used to deliver each reminder once per channel). */
export function reminderKey(offset: ReminderOffset): string {
  return `${offset.unit}:${offset.amount}`;
}

// ---- Time-zone arithmetic (no library: Intl only). Wall-clock values are handled as "UTC-like" milliseconds.

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(zone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(zone, formatter);
  }
  return formatter;
}

/** The wall-clock time in `zone` at `instantMs`, as UTC-like milliseconds. */
function wallClockMs(zone: string, instantMs: number): number {
  const parts = Object.fromEntries(
    formatterFor(zone)
      .formatToParts(new Date(instantMs))
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
}

function offsetMs(zone: string, instantMs: number): number {
  const whole = Math.floor(instantMs / 1000) * 1000;
  return wallClockMs(zone, whole) - whole;
}

const DAY_MS = 86_400_000;

/**
 * The instant at which the wall clock in `zone` shows `wallMs`. Like Temporal's "compatible"
 * disambiguation: a time skipped by a DST change (spring forward) moves forward by the gap; a time
 * that occurs twice (fall back) is the earlier one.
 */
function instantOfWallClock(zone: string, wallMs: number): number {
  const before = offsetMs(zone, wallMs - DAY_MS);
  const after = offsetMs(zone, wallMs + DAY_MS);
  const valid = [...new Set([before, after])].map((offset) => wallMs - offset).filter((instant) => wallClockMs(zone, instant) === wallMs);
  if (valid.length > 0) return Math.min(...valid);
  return wallMs - before;
}

function wallMsOf(date: LocalDate, time: LocalTime): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  return Date.UTC(year, month - 1, day, hour, minute);
}

/** The instant of `date` at `time` in `zone`. */
export function zonedInstant(date: LocalDate, time: LocalTime, zone: TimeZoneName): Date {
  return new Date(instantOfWallClock(zone, wallMsOf(date, time)));
}

/** The calendar date in `zone` at `instant`. */
export function localDateAt(instant: Date, zone: TimeZoneName): LocalDate {
  return new Date(wallClockMs(zone, instant.getTime())).toISOString().slice(0, 10) as LocalDate;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10) as LocalDate;
}

const partsOf = (date: LocalDate): [number, number, number] => date.split('-').map(Number) as [number, number, number];
const toLocalDate = (utcMs: number): LocalDate => new Date(utcMs).toISOString().slice(0, 10) as LocalDate;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `year`-`month` (1–12, may overflow) on `day`, clamped to the month's last day. */
function clampedDate(year: number, month: number, day: number): LocalDate {
  const normalized = new Date(Date.UTC(year, month - 1, 1));
  const y = normalized.getUTCFullYear();
  const m = normalized.getUTCMonth() + 1;
  return toLocalDate(Date.UTC(y, m - 1, Math.min(day, daysInMonth(y, m))));
}

/** Calendar months later (negative: earlier), keeping the day or the month's last day when it does not exist. */
export function addMonthsClamped(date: LocalDate, months: number): LocalDate {
  const [year, month, day] = partsOf(date);
  return clampedDate(year, month + months, day);
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  const [ya, ma, da] = partsOf(a);
  const [yb, mb, db] = partsOf(b);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / DAY_MS);
}

/** ISO weekday of a date: 1 = Monday … 7 = Sunday. */
export function weekdayOf(date: LocalDate): number {
  const [year, month, day] = partsOf(date);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** `interval` units after `date` (months and years clamped). */
export function addInterval(date: LocalDate, unit: RecurrenceUnit, amount: number): LocalDate {
  switch (unit) {
    case 'DAY':
      return addDays(date, amount);
    case 'WEEK':
      return addDays(date, 7 * amount);
    case 'MONTH':
      return addMonthsClamped(date, amount);
    case 'YEAR':
      return addMonthsClamped(date, 12 * amount);
  }
}

type FixedRecurrence = Extract<Recurrence, { kind: 'FIXED' }>;

/**
 * The `k`-th date (k = 0, 1, …) of a fixed series, always computed from the anchor — so a clamped
 * date (30 April for "the 31st") never shifts the following ones, and completing late changes nothing.
 */
export function fixedDateAt(rule: FixedRecurrence, anchor: LocalDate, k: number): LocalDate {
  const [year, month, day] = partsOf(anchor);
  switch (rule.unit) {
    case 'DAY':
      return addDays(anchor, k * rule.interval);
    case 'WEEK': {
      if (rule.weekdays === null) return addDays(anchor, 7 * k * rule.interval);
      const days = rule.weekdays;
      const monday = addDays(anchor, 1 - weekdayOf(anchor));
      // Weekdays of the anchor's week before the anchor are not part of the series.
      const skipped = days.filter((weekday) => weekday < weekdayOf(anchor)).length;
      const index = k + skipped;
      const week = Math.floor(index / days.length);
      return addDays(monday, week * 7 * rule.interval + ((days[index % days.length] ?? 1) - 1));
    }
    case 'MONTH':
      return clampedDate(year, month + k * rule.interval, rule.lastDayOfMonth ? 31 : day);
    case 'YEAR':
      return clampedDate(year + k * rule.interval, month, day);
  }
}

function approximateDays(rule: FixedRecurrence): number {
  const perDate = { DAY: 1, WEEK: 7, MONTH: 28, YEAR: 365 }[rule.unit] * rule.interval;
  return rule.unit === 'WEEK' && rule.weekdays !== null ? perDate / rule.weekdays.length : perDate;
}

/** The first date of a fixed series strictly after `after` (the anchor itself if it is later). */
export function nextFixedDate(rule: FixedRecurrence, anchor: LocalDate, after: LocalDate): LocalDate {
  let k = Math.max(0, Math.floor(daysBetween(anchor, after) / approximateDays(rule)) - 2);
  // Step back while the estimate is already past `after`, then forward to the first later date.
  while (k > 0 && fixedDateAt(rule, anchor, k - 1) > after) k--;
  for (;;) {
    const date = fixedDateAt(rule, anchor, k);
    if (date > after) return date;
    k++;
  }
}

/**
 * The dates of a fixed series within `from`…`to` that come after `latest` (the due date of the
 * series' latest existing Occurrence; undefined = none yet). This is exactly how the generator
 * continues a series, so a projected date (calendar, 14.4) is the date an Occurrence will get.
 */
export function fixedDatesInRange(rule: FixedRecurrence, anchor: LocalDate, latest: LocalDate | undefined, from: LocalDate, to: LocalDate): LocalDate[] {
  const before = addDays(from, -1);
  const dates: LocalDate[] = [];
  let date = nextFixedDate(rule, anchor, latest !== undefined && latest > before ? latest : before);
  while (date <= to) {
    dates.push(date);
    date = nextFixedDate(rule, anchor, date);
  }
  return dates;
}

/** The first due date of a new series: the anchor, or for weekday rules the first chosen weekday on or after it. */
export function firstDueDate(recurrence: Recurrence, anchor: LocalDate): LocalDate {
  return recurrence.kind === 'FIXED' ? fixedDateAt(recurrence, anchor, 0) : anchor;
}

/** Completion-based: the next due date counted from the completion (or skip) date. */
export function dueAfterCompletion(rule: Extract<Recurrence, { kind: 'AFTER_COMPLETION' }>, completedOn: LocalDate): LocalDate {
  return addInterval(completedOn, rule.unit, rule.interval);
}

// ---- Reminders

interface OccurrenceTiming {
  readonly dueDate: LocalDate;
  readonly time: LocalTime | null;
  readonly timeZone: TimeZoneName;
}

/** The moment an Occurrence is due: its time, or the recipient's reminder time when it has none. */
export function dueInstant(occurrence: OccurrenceTiming, reminderTime: LocalTime): Date {
  return zonedInstant(occurrence.dueDate, occurrence.time ?? reminderTime, occurrence.timeZone);
}

/**
 * When a reminder is sent. Day, week and month offsets land on a calendar date (months clamped: one
 * month before 31 March is 28/29 February) at the recipient's reminder time in the Schedule's zone;
 * hour offsets count real hours back from the due moment (a DST change in between is respected).
 */
export function reminderInstant(occurrence: OccurrenceTiming, offset: ReminderOffset, reminderTime: LocalTime): Date {
  switch (offset.unit) {
    case 'DAYS':
      return zonedInstant(addDays(occurrence.dueDate, -offset.amount), reminderTime, occurrence.timeZone);
    case 'WEEKS':
      return zonedInstant(addDays(occurrence.dueDate, -7 * offset.amount), reminderTime, occurrence.timeZone);
    case 'MONTHS':
      return zonedInstant(addMonthsClamped(occurrence.dueDate, -offset.amount), reminderTime, occurrence.timeZone);
    case 'HOURS':
      return new Date(dueInstant(occurrence, reminderTime).getTime() - offset.amount * 3_600_000);
  }
}

/**
 * The reminder instants of an Occurrence still ahead of `now`, earliest first. Offsets that fall on
 * the same instant are sent once. Instants already past when the Occurrence is created are not "missed".
 */
export function upcomingReminders(
  occurrence: OccurrenceTiming,
  reminders: readonly ReminderOffset[],
  reminderTime: LocalTime,
  now: Date,
): { key: string; at: Date }[] {
  const byInstant = new Map<number, { key: string; at: Date }>();
  for (const offset of reminders) {
    const at = reminderInstant(occurrence, offset, reminderTime);
    if (at.getTime() > now.getTime() && !byInstant.has(at.getTime())) byInstant.set(at.getTime(), { key: reminderKey(offset), at });
  }
  return [...byInstant.values()].sort((a, b) => a.at.getTime() - b.at.getTime());
}

// ---- Where an Occurrence stands

/** Judged by the calendar date in the Schedule's own time zone. */
export type ScheduleTimeliness = 'OVERDUE' | 'TODAY' | 'UPCOMING';

export function timelinessAt(occurrence: { readonly dueDate: LocalDate; readonly timeZone: TimeZoneName }, now: Date): ScheduleTimeliness {
  const today = localDateAt(now, occurrence.timeZone);
  if (occurrence.dueDate < today) return 'OVERDUE';
  return occurrence.dueDate === today ? 'TODAY' : 'UPCOMING';
}

/** A new or moved date must be today or later (in the zone), and not too far ahead. */
export function validateScheduleDate(date: LocalDate, zone: TimeZoneName, now: Date): void {
  const today = localDateAt(now, zone);
  if (date < today) throw new DomainValidationError('date', 'date_in_past', 'The date is in the past');
  if (date > addDays(today, MAX_SCHEDULE_DAYS_AHEAD)) throw new DomainValidationError('date', 'date_too_far', 'The date is too far ahead');
}

/** Who is responsible for an Occurrence: its own Assignee, else the Schedule's (null = shared). */
export function responsibleFor(schedule: Pick<Schedule, 'assignee'>, occurrence: Pick<Occurrence, 'assignee'>): PersonRef | null {
  return occurrence.assignee ?? schedule.assignee;
}

/** Who receives reminders: the responsible person, otherwise the Schedule's creator — never the whole Workspace. */
export function reminderRecipientId(
  schedule: { readonly assigneeUserId: string | null; readonly createdByUserId: string },
  occurrence: { readonly assigneeUserId: string | null },
): string {
  return occurrence.assigneeUserId ?? schedule.assigneeUserId ?? schedule.createdByUserId;
}
