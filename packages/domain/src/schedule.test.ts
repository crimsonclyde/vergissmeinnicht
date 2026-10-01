import { describe, expect, it } from 'vitest';
import {
  DomainValidationError,
  addDays,
  dueInstant,
  fixedDatesInRange,
  localDateAt,
  normalizeReminders,
  parseLocalDate,
  parseLocalTime,
  parseTimeZone,
  reminderInstant,
  timelinessAt,
  validateScheduleDate,
  zonedInstant,
  type LocalDate,
  type LocalTime,
  type ReminderOffset,
  type TimeZoneName,
} from './index.ts';

const d = (value: string) => parseLocalDate(value);
const t = (value: string) => parseLocalTime(value);
const z = (value: string) => parseTimeZone(value);
const codeOf = (action: () => unknown) => {
  try {
    action();
    return undefined;
  } catch (error) {
    expect(error).toBeInstanceOf(DomainValidationError);
    return (error as DomainValidationError).code;
  }
};

describe('schedule values (13.4, 14.1)', () => {
  it('accepts real calendar dates and 24 h times only', () => {
    expect(d('2026-10-03')).toBe('2026-10-03');
    expect(d('2028-02-29')).toBe('2028-02-29');
    for (const bad of ['2026-02-29', '2026-13-01', '2026-1-3', '03.10.2026', '1999-12-31', '2026-10-03T00:00']) expect(codeOf(() => d(bad))).toBe('invalid_date');
    expect(t('00:00')).toBe('00:00');
    expect(t('23:59')).toBe('23:59');
    for (const bad of ['24:00', '9:00', '09:60', '09:00:00', 'noon']) expect(codeOf(() => t(bad))).toBe('invalid_time');
  });

  it('accepts IANA zone names, never offsets or garbage', () => {
    expect(z('Europe/Berlin')).toBe('Europe/Berlin');
    expect(z('America/Argentina/Buenos_Aires')).toBe('America/Argentina/Buenos_Aires');
    expect(z('UTC')).toBe('UTC');
    for (const bad of ['+02:00', 'GMT+2', 'Mars/Olympus', 'Europe/Berlin; DROP', '', 'x'.repeat(80)]) expect(codeOf(() => z(bad))).toBe('invalid_time_zone');
  });

  it('bounds, de-duplicates and orders reminders (days, weeks, calendar months, hours; D4)', () => {
    const list = normalizeReminders([
      { unit: 'DAYS', amount: 0 },
      { unit: 'DAYS', amount: 7 },
      { unit: 'HOURS', amount: 3 },
      { unit: 'MONTHS', amount: 1 },
      { unit: 'WEEKS', amount: 1 },
      { unit: 'DAYS', amount: 7 },
    ]);
    expect(list).toEqual([
      { unit: 'MONTHS', amount: 1 },
      { unit: 'DAYS', amount: 7 },
      { unit: 'WEEKS', amount: 1 },
      { unit: 'HOURS', amount: 3 },
      { unit: 'DAYS', amount: 0 },
    ]);
    const bad: ReminderOffset[][] = [
      [{ unit: 'DAYS', amount: 367 }],
      [{ unit: 'DAYS', amount: -1 }],
      [{ unit: 'WEEKS', amount: 0 }],
      [{ unit: 'WEEKS', amount: 53 }],
      [{ unit: 'MONTHS', amount: 13 }],
      [{ unit: 'HOURS', amount: 0 }],
      [{ unit: 'HOURS', amount: 49 }],
      [{ unit: 'DAYS', amount: 1.5 }],
      [{ unit: 'YEARS' as 'DAYS', amount: 1 }],
    ];
    for (const offsets of bad) expect(codeOf(() => normalizeReminders(offsets))).toBe('invalid_reminder');
    const six = [0, 1, 2, 3, 4, 5].map((amount) => ({ unit: 'DAYS' as const, amount }));
    expect(codeOf(() => normalizeReminders(six))).toBe('too_many_reminders');
  });

  it('computes local days across month and year ends', () => {
    expect(addDays('2026-10-03' as LocalDate, -7)).toBe('2026-09-26');
    expect(addDays('2027-01-01' as LocalDate, -1)).toBe('2026-12-31');
    expect(addDays('2028-02-28' as LocalDate, 1)).toBe('2028-02-29');
  });
});

describe('time zones and daylight saving time (13.4)', () => {
  const berlin = 'Europe/Berlin' as TimeZoneName;
  const newYork = 'America/New_York' as TimeZoneName;

  it('uses the item’s zone, not the server’s', () => {
    expect(zonedInstant(d('2026-10-03'), t('09:00'), berlin).toISOString()).toBe('2026-10-03T07:00:00.000Z'); // CEST
    expect(zonedInstant(d('2026-12-03'), t('09:00'), berlin).toISOString()).toBe('2026-12-03T08:00:00.000Z'); // CET
    expect(zonedInstant(d('2026-10-03'), t('09:00'), newYork).toISOString()).toBe('2026-10-03T13:00:00.000Z');
    expect(zonedInstant(d('2026-10-03'), t('09:00'), 'UTC' as TimeZoneName).toISOString()).toBe('2026-10-03T09:00:00.000Z');
  });

  it('moves a wall time skipped by spring-forward past the gap', () => {
    // Berlin 2026-03-29: 02:00 → 03:00. 02:30 does not exist → 03:30 CEST (01:30 UTC).
    expect(zonedInstant(d('2026-03-29'), t('02:30'), berlin).toISOString()).toBe('2026-03-29T01:30:00.000Z');
    expect(zonedInstant(d('2026-03-29'), t('03:00'), berlin).toISOString()).toBe('2026-03-29T01:00:00.000Z');
    // New York 2026-03-08: 02:00 → 03:00.
    expect(zonedInstant(d('2026-03-08'), t('02:15'), newYork).toISOString()).toBe('2026-03-08T07:15:00.000Z');
  });

  it('takes the earlier of a wall time repeated by fall-back', () => {
    // Berlin 2026-10-25: 03:00 → 02:00. 02:30 happens twice; the first is CEST (00:30 UTC).
    expect(zonedInstant(d('2026-10-25'), t('02:30'), berlin).toISOString()).toBe('2026-10-25T00:30:00.000Z');
    expect(zonedInstant(d('2026-11-01'), t('01:30'), newYork).toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });

  it('keeps day-based reminders at the reminder time on both sides of a DST change', () => {
    const item = { dueDate: d('2026-10-27'), time: null, timeZone: berlin };
    const nine = t('09:00') as LocalTime;
    // On the day (after fall-back: CET) and 7 days / 1 week before (before it: CEST) — all 09:00 local.
    expect(reminderInstant(item, { unit: 'DAYS', amount: 0 }, nine).toISOString()).toBe('2026-10-27T08:00:00.000Z');
    expect(reminderInstant(item, { unit: 'DAYS', amount: 7 }, nine).toISOString()).toBe('2026-10-20T07:00:00.000Z');
    expect(reminderInstant(item, { unit: 'WEEKS', amount: 1 }, nine).toISOString()).toBe('2026-10-20T07:00:00.000Z');
    expect(dueInstant(item, nine).toISOString()).toBe('2026-10-27T08:00:00.000Z');
  });

  it('counts month offsets in calendar months, clamped (1 month before 31 March is 28/29 February)', () => {
    const nine = t('09:00');
    expect(reminderInstant({ dueDate: d('2027-03-31'), time: null, timeZone: berlin }, { unit: 'MONTHS', amount: 1 }, nine).toISOString()).toBe('2027-02-28T08:00:00.000Z');
    expect(reminderInstant({ dueDate: d('2028-03-31'), time: null, timeZone: berlin }, { unit: 'MONTHS', amount: 1 }, nine).toISOString()).toBe('2028-02-29T08:00:00.000Z');
    expect(reminderInstant({ dueDate: d('2027-06-15'), time: null, timeZone: berlin }, { unit: 'MONTHS', amount: 1 }, nine).toISOString()).toBe('2027-05-15T07:00:00.000Z');
  });

  it('counts hour-based reminders in real hours across a DST change', () => {
    // Due 2026-03-29 09:00 CEST (07:00 UTC); 12 h before is 19:00 UTC the day before (20:00 CET).
    const item = { dueDate: d('2026-03-29'), time: t('09:00'), timeZone: berlin };
    expect(reminderInstant(item, { unit: 'HOURS', amount: 12 }, t('08:00')).toISOString()).toBe('2026-03-28T19:00:00.000Z');
    // A time of its own wins over the reminder time for the due moment.
    expect(dueInstant(item, t('08:00')).toISOString()).toBe('2026-03-29T07:00:00.000Z');
  });

  it('judges due/overdue by the calendar date in the item’s zone', () => {
    const now = new Date('2026-10-02T23:30:00Z'); // Oct 3, 01:30 in Berlin; Oct 2, 19:30 in New York
    expect(localDateAt(now, berlin)).toBe('2026-10-03');
    expect(localDateAt(now, newYork)).toBe('2026-10-02');
    expect(timelinessAt({ dueDate: d('2026-10-03'), timeZone: berlin }, now)).toBe('TODAY');
    expect(timelinessAt({ dueDate: d('2026-10-03'), timeZone: newYork }, now)).toBe('UPCOMING');
    expect(timelinessAt({ dueDate: d('2026-10-02'), timeZone: berlin }, now)).toBe('OVERDUE');
  });

  it('refuses dates in the past (in the item’s zone) and too far ahead', () => {
    const now = new Date('2026-10-02T23:30:00Z');
    expect(codeOf(() => validateScheduleDate(d('2026-10-02'), berlin, now))).toBe('date_in_past');
    expect(codeOf(() => validateScheduleDate(d('2026-10-02'), newYork, now))).toBeUndefined();
    expect(codeOf(() => validateScheduleDate(d('2028-10-10'), berlin, now))).toBe('date_too_far');
  });
});

describe('projected dates of a fixed series (14.4)', () => {
  const rule = (unit: 'DAY' | 'WEEK' | 'MONTH' | 'YEAR', interval = 1, weekdays: number[] | null = null) => ({ kind: 'FIXED', unit, interval, weekdays, lastDayOfMonth: false }) as const;
  const range = (r: ReturnType<typeof rule>, anchor: string, latest: string | undefined, from: string, to: string) =>
    fixedDatesInRange(r, d(anchor), latest === undefined ? undefined : d(latest), d(from), d(to));

  it('lists only dates after the latest existing Occurrence, inside the range (both ends included)', () => {
    expect(range(rule('WEEK'), '2026-10-01', '2026-10-08', '2026-10-01', '2026-10-29')).toEqual(['2026-10-15', '2026-10-22', '2026-10-29']);
    expect(range(rule('WEEK'), '2026-10-01', undefined, '2026-10-01', '2026-10-08')).toEqual(['2026-10-01', '2026-10-08']);
    expect(range(rule('WEEK'), '2026-10-01', '2026-12-31', '2026-10-01', '2026-10-31')).toEqual([]);
    // A series that starts after the range has no date in it.
    expect(range(rule('MONTH'), '2027-01-15', undefined, '2026-10-01', '2026-10-31')).toEqual([]);
  });

  it('crosses month and year ends without drift (the 31st, 29 February)', () => {
    expect(range(rule('MONTH'), '2026-10-31', '2026-10-31', '2026-11-01', '2027-01-31')).toEqual(['2026-11-30', '2026-12-31', '2027-01-31']);
    expect(range(rule('MONTH'), '2026-10-31', '2026-10-31', '2027-02-01', '2027-03-31')).toEqual(['2027-02-28', '2027-03-31']);
    expect(range(rule('YEAR'), '2028-02-29', '2028-02-29', '2029-02-01', '2029-03-31')).toEqual(['2029-02-28']);
    expect(range(rule('YEAR'), '2028-02-29', '2028-02-29', '2032-02-01', '2032-03-31')).toEqual(['2032-02-29']);
  });

  it('reaches years ahead, on chosen weekdays too', () => {
    expect(range(rule('MONTH', 3), '2026-10-15', '2026-10-15', '2031-01-01', '2031-01-31')).toEqual(['2031-01-15']);
    // Mondays and Thursdays, every second week from Thursday 1 October 2026.
    expect(range(rule('WEEK', 2, [1, 4]), '2026-10-01', '2026-10-01', '2026-10-02', '2026-10-31')).toEqual(['2026-10-12', '2026-10-15', '2026-10-26', '2026-10-29']);
  });
});
