import { describe, expect, it } from 'vitest';
import {
  DomainValidationError,
  daysBetween,
  dueAfterCompletion,
  firstDueDate,
  fixedDateAt,
  nextFixedDate,
  parseLocalDate,
  parseRecurrence,
  reminderRecipientId,
  weekdayOf,
  zonedInstant,
  type LocalDate,
  type LocalTime,
  type Recurrence,
  type TimeZoneName,
} from './index.ts';

const d = (value: string) => parseLocalDate(value);
type Fixed = Extract<Recurrence, { kind: 'FIXED' }>;
const fixed = (unit: Fixed['unit'], interval = 1, extra: Partial<Fixed> = {}): Fixed => ({ kind: 'FIXED', unit, interval, weekdays: null, lastDayOfMonth: false, ...extra });
const series = (rule: Fixed, anchor: LocalDate, n: number) => Array.from({ length: n }, (_, k) => fixedDateAt(rule, anchor, k));
const codeOf = (action: () => unknown) => {
  try {
    action();
    return undefined;
  } catch (error) {
    expect(error).toBeInstanceOf(DomainValidationError);
    return (error as DomainValidationError).code;
  }
};

describe('recurrence rules (14.1)', () => {
  it('accepts the three kinds and refuses anything else', () => {
    expect(parseRecurrence({ kind: 'ONCE' })).toEqual({ kind: 'ONCE' });
    expect(parseRecurrence({ kind: 'FIXED', unit: 'WEEK', interval: 2, weekdays: [3, 1, 1] })).toEqual({ kind: 'FIXED', unit: 'WEEK', interval: 2, weekdays: [1, 3], lastDayOfMonth: false });
    expect(parseRecurrence({ kind: 'AFTER_COMPLETION', unit: 'MONTH', interval: 6 })).toEqual({ kind: 'AFTER_COMPLETION', unit: 'MONTH', interval: 6 });
    for (const bad of [
      { kind: 'CRON' },
      { kind: 'FIXED' },
      { kind: 'FIXED', unit: 'HOUR' },
      { kind: 'FIXED', unit: 'DAY', interval: 0 },
      { kind: 'FIXED', unit: 'DAY', interval: 100 },
      { kind: 'FIXED', unit: 'DAY', interval: 1.5 },
      { kind: 'FIXED', unit: 'MONTH', weekdays: [1] },
      { kind: 'FIXED', unit: 'WEEK', weekdays: [] },
      { kind: 'FIXED', unit: 'WEEK', weekdays: [0] },
      { kind: 'FIXED', unit: 'WEEK', weekdays: [8] },
      { kind: 'FIXED', unit: 'YEAR', lastDayOfMonth: true },
      { kind: 'AFTER_COMPLETION', unit: 'WEEK', weekdays: [1] },
    ]) {
      expect(codeOf(() => parseRecurrence(bad)), JSON.stringify(bad)).toBe('invalid_recurrence');
    }
  });

  it('keeps a yearly date fixed, whenever the previous one was completed (no drift)', () => {
    const rule = fixed('YEAR');
    expect(series(rule, d('2027-06-15'), 3)).toEqual(['2027-06-15', '2028-06-15', '2029-06-15']);
    // Completed late on 20 June 2027: the next date is still 15 June 2028.
    expect(nextFixedDate(rule, d('2027-06-15'), d('2027-06-15'))).toBe('2028-06-15');
  });

  it('clamps the 31st to the month’s last day and returns to the 31st (D15)', () => {
    expect(series(fixed('MONTH'), d('2027-01-31'), 5)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31']);
    expect(series(fixed('MONTH', 1, { lastDayOfMonth: true }), d('2028-01-15'), 3)).toEqual(['2028-01-31', '2028-02-29', '2028-03-31']);
  });

  it('keeps 29 February on 28 February in common years and returns to it in leap years (D15)', () => {
    expect(series(fixed('YEAR'), d('2028-02-29'), 5)).toEqual(['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
  });

  it('never drifts over 50+ years for every rule kind', () => {
    const anchors = ['2027-01-31', '2028-02-29', '2027-03-30', '2027-08-31', '2027-12-31', '2027-06-15'].map(d);
    for (const anchor of anchors) {
      const [, , anchorDay] = anchor.split('-').map(Number) as [number, number, number];
      for (const interval of [1, 2, 3, 6]) {
        const monthly = series(fixed('MONTH', interval), anchor, 12 * 50);
        for (const date of monthly) {
          const [year, month, day] = date.split('-').map(Number) as [number, number, number];
          const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
          // Always the anchor's day, or the month's last day when that day does not exist.
          expect(day).toBe(Math.min(anchorDay, last));
        }
        // Strictly increasing, one per period.
        for (let i = 1; i < monthly.length; i++) expect((monthly[i] ?? '') > (monthly[i - 1] ?? '')).toBe(true);
      }
      const yearly = series(fixed('YEAR'), anchor, 60);
      expect(yearly.every((date, k) => date.startsWith(String(Number(anchor.slice(0, 4)) + k)))).toBe(true);
      const daily = series(fixed('DAY', 3), anchor, 20 * 122);
      expect(daily.every((date, k) => daysBetween(anchor, date) === 3 * k)).toBe(true);
    }
  });

  it('finds the next date after any day, also far from the anchor', () => {
    const rule = fixed('MONTH', 1);
    const anchor = d('2027-01-31');
    for (const k of [0, 1, 5, 37, 400]) {
      const date = fixedDateAt(rule, anchor, k);
      expect(nextFixedDate(rule, anchor, date)).toBe(fixedDateAt(rule, anchor, k + 1));
    }
    expect(nextFixedDate(rule, anchor, d('2026-12-01'))).toBe('2027-01-31');
  });

  it('repeats every 2 weeks on chosen weekdays, from the anchor’s week', () => {
    const rule = fixed('WEEK', 2, { weekdays: [1, 4] }); // Monday and Thursday
    // Anchor Wednesday 2026-10-21: Monday 19th is before the anchor and not part of the series.
    expect(series(rule, d('2026-10-21'), 5)).toEqual(['2026-10-22', '2026-11-02', '2026-11-05', '2026-11-16', '2026-11-19']);
    expect(firstDueDate(rule, d('2026-10-21'))).toBe('2026-10-22');
    // Every date is a chosen weekday — also across the DST changes of 25 October and 29 March.
    const many = series(fixed('WEEK', 2, { weekdays: [1] }), d('2026-10-19'), 60);
    expect(many.every((date) => weekdayOf(date) === 1)).toBe(true);
    const berlin = 'Europe/Berlin' as TimeZoneName;
    const newYork = 'America/New_York' as TimeZoneName;
    for (const date of many) {
      // 09:00 local on each Monday, whatever the UTC offset is.
      expect(new Intl.DateTimeFormat('en-GB', { timeZone: berlin, hour: '2-digit', minute: '2-digit', weekday: 'short' }).format(zonedInstant(date, '09:00' as LocalTime, berlin))).toBe('Mon 09:00');
      expect(new Intl.DateTimeFormat('en-GB', { timeZone: newYork, hour: '2-digit', minute: '2-digit', weekday: 'short' }).format(zonedInstant(date, '09:00' as LocalTime, newYork))).toBe('Mon 09:00');
    }
  });

  it('counts completion-based dates from the completion or skip date (D2)', () => {
    const rule = { kind: 'AFTER_COMPLETION' as const, unit: 'MONTH' as const, interval: 6 };
    expect(dueAfterCompletion(rule, d('2027-03-03'))).toBe('2027-09-03');
    // Skipped on 10 September → due 10 March 2028.
    expect(dueAfterCompletion(rule, d('2027-09-10'))).toBe('2028-03-10');
    expect(dueAfterCompletion({ kind: 'AFTER_COMPLETION', unit: 'MONTH', interval: 1 }, d('2027-01-31'))).toBe('2027-02-28');
    expect(dueAfterCompletion({ kind: 'AFTER_COMPLETION', unit: 'WEEK', interval: 2 }, d('2027-12-25'))).toBe('2028-01-08');
  });

  it('sends reminders to the Occurrence’s assignee, else the Schedule’s, else the creator (D8)', () => {
    const schedule = { assigneeUserId: 'ana', createdByUserId: 'creator' };
    expect(reminderRecipientId(schedule, { assigneeUserId: null })).toBe('ana');
    expect(reminderRecipientId(schedule, { assigneeUserId: 'cleo' })).toBe('cleo');
    expect(reminderRecipientId({ assigneeUserId: null, createdByUserId: 'creator' }, { assigneeUserId: null })).toBe('creator');
  });
});
