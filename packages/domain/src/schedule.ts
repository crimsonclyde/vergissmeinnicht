import { DomainValidationError } from './errors.ts';
import type { ProcedureIcon, ProcedureId } from './procedure.ts';
import type { RunId } from './run.ts';
import { UUID_V4, type UserId } from './user.ts';
import type { WorkspaceId } from './workspace.ts';

/**
 * A ScheduledProcedure is the intention to perform a Procedure on a future date (13.4). It is *not*
 * a Run: nothing is executed or recorded as executed when the date arrives. Only pressing Start
 * creates a normal Run from the Procedure's definition at that moment; the scheduled item then
 * points at that Run. Reminders go to the person who scheduled it.
 *
 * Dates and times are wall-clock values in an explicit IANA time zone stored with the item — never
 * the server's zone. Reminder instants are computed from them (DST-aware).
 */
export type ScheduledProcedureId = string & { readonly __brand: 'ScheduledProcedureId' };

export const SCHEDULE_STATES = ['SCHEDULED', 'STARTED', 'CANCELLED'] as const;
export type ScheduleState = (typeof SCHEDULE_STATES)[number];

/** `DAYS`: n days before the date, at the item's reminder time (0 = on the day). `HOURS`: n hours before the due moment. */
export const REMINDER_UNITS = ['DAYS', 'HOURS'] as const;
export type ReminderUnit = (typeof REMINDER_UNITS)[number];

export interface ReminderOffset {
  readonly unit: ReminderUnit;
  readonly amount: number;
}

export const REMINDER_LIMITS = Object.freeze({ DAYS: { min: 0, max: 30 }, HOURS: { min: 1, max: 48 } });
export const MAX_REMINDERS = 5;
/** How far ahead a Procedure may be scheduled. */
export const MAX_SCHEDULE_DAYS_AHEAD = 731;
/** A Workspace keeps at most this many open (SCHEDULED) items. */
export const MAX_OPEN_SCHEDULES_PER_WORKSPACE = 1000;
export const DEFAULT_REMINDER_TIME = '09:00';

/** Calendar date `YYYY-MM-DD` and wall-clock time `HH:MM` in the item's time zone. */
export type LocalDate = string & { readonly __brand: 'LocalDate' };
export type LocalTime = string & { readonly __brand: 'LocalTime' };
export type TimeZoneName = string & { readonly __brand: 'TimeZoneName' };

export interface ScheduledProcedure {
  readonly id: ScheduledProcedureId;
  readonly workspaceId: WorkspaceId;
  readonly procedureId: ProcedureId;
  /** The source Procedure as it is now (title/icon may have changed); `deleted` if it was deleted since. */
  readonly procedure: { readonly title: string; readonly icon: ProcedureIcon; readonly deleted: boolean };
  readonly date: LocalDate;
  /** Optional time of day; without it the item is due for the whole day. */
  readonly time: LocalTime | null;
  readonly timeZone: TimeZoneName;
  /** When day-based reminders are sent (the creator's default reminder time unless changed). */
  readonly reminderTime: LocalTime;
  readonly reminders: readonly ReminderOffset[];
  readonly state: ScheduleState;
  readonly revision: number;
  readonly createdAt: Date;
  readonly createdBy: { readonly userId: UserId; readonly displayName: string };
  /** The Run started from this item (state STARTED). */
  readonly runId: RunId | null;
  /** Who started or cancelled it, and when (null while SCHEDULED). */
  readonly closed: { readonly at: Date; readonly by: { readonly userId: UserId; readonly displayName: string } } | null;
}

export function parseScheduledProcedureId(value: string): ScheduledProcedureId {
  if (!UUID_V4.test(value)) throw new DomainValidationError('scheduleId', 'invalid_schedule_id', 'Schedule id must be a lower-case UUIDv4');
  return value as ScheduledProcedureId;
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

/** Validates, de-duplicates and sorts reminder offsets (earliest reminder first). */
export function normalizeReminders(offsets: readonly ReminderOffset[]): ReminderOffset[] {
  const seen = new Map<string, ReminderOffset>();
  for (const offset of offsets) {
    const limits = (REMINDER_LIMITS as Record<string, { min: number; max: number } | undefined>)[offset.unit];
    if (limits === undefined || !Number.isInteger(offset.amount) || offset.amount < limits.min || offset.amount > limits.max) {
      throw new DomainValidationError('reminders', 'invalid_reminder', 'Reminders are 0–30 days or 1–48 hours before');
    }
    seen.set(`${offset.unit}:${offset.amount}`, { unit: offset.unit, amount: offset.amount });
  }
  if (seen.size > MAX_REMINDERS) {
    throw new DomainValidationError('reminders', 'too_many_reminders', `At most ${MAX_REMINDERS} reminders`);
  }
  const hours = (offset: ReminderOffset) => (offset.unit === 'DAYS' ? offset.amount * 24 : offset.amount);
  return [...seen.values()].sort((a, b) => hours(b) - hours(a) || (a.unit === 'DAYS' ? -1 : 1));
}

/** Stable key of one reminder of an item (used to deliver each reminder once per channel). */
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

type ScheduleTiming = Pick<ScheduledProcedure, 'date' | 'time' | 'timeZone' | 'reminderTime'>;

/** The moment the item is due: its time, or the reminder time when it has none. */
export function dueInstant(schedule: ScheduleTiming): Date {
  return zonedInstant(schedule.date, schedule.time ?? schedule.reminderTime, schedule.timeZone);
}

/** When a reminder is sent. */
export function reminderInstant(schedule: ScheduleTiming, offset: ReminderOffset): Date {
  if (offset.unit === 'DAYS') return zonedInstant(addDays(schedule.date, -offset.amount), schedule.reminderTime, schedule.timeZone);
  // Hours before the due moment, counted in real time (a DST change in between is respected).
  return new Date(dueInstant(schedule).getTime() - offset.amount * 3_600_000);
}

/** Where an open item stands at `now`, judged by the calendar date in its own time zone. */
export type ScheduleTimeliness = 'OVERDUE' | 'TODAY' | 'UPCOMING';

export function timelinessAt(schedule: Pick<ScheduledProcedure, 'date' | 'timeZone'>, now: Date): ScheduleTimeliness {
  const today = localDateAt(now, schedule.timeZone);
  if (schedule.date < today) return 'OVERDUE';
  return schedule.date === today ? 'TODAY' : 'UPCOMING';
}

/** A new or moved item must be on today's date or later (in its zone), and not too far ahead. */
export function validateScheduleDate(date: LocalDate, zone: TimeZoneName, now: Date): void {
  const today = localDateAt(now, zone);
  if (date < today) throw new DomainValidationError('date', 'date_in_past', 'The date is in the past');
  if (date > addDays(today, MAX_SCHEDULE_DAYS_AHEAD)) throw new DomainValidationError('date', 'date_too_far', 'The date is too far ahead');
}

/**
 * The reminder instants of an item still ahead of `now`, earliest first. Offsets that fall on the same
 * instant (e.g. "1 day before" and "24 hours before" at the same time) are sent once.
 */
export function upcomingReminders(schedule: ScheduleTiming & Pick<ScheduledProcedure, 'reminders'>, now: Date): { key: string; at: Date }[] {
  const byInstant = new Map<number, { key: string; at: Date }>();
  for (const offset of schedule.reminders) {
    const at = reminderInstant(schedule, offset);
    if (at.getTime() > now.getTime() && !byInstant.has(at.getTime())) byInstant.set(at.getTime(), { key: reminderKey(offset), at });
  }
  return [...byInstant.values()].sort((a, b) => a.at.getTime() - b.at.getTime());
}
