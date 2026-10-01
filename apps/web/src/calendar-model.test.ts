import { describe, expect, it } from 'vitest';
import type { Occurrence, ProjectedOccurrence, Schedule } from './api.ts';
import { DEFAULT_FILTERS, addMonths, dayAfterKey, entriesOf, lastDayOf, matches, monthGrid, parseFilters, responsiblePeople, statusOf, type CalendarFilters } from './calendar-model.ts';

const UMA = { id: '11111111-1111-4111-8111-111111111111', name: 'Uma' };
const COLE = { id: '22222222-2222-4222-8222-222222222222', name: 'Cole' };
const NOW = new Date('2026-10-15T10:00:00Z');

const schedule = (title: string, kind: Schedule['kind'] = 'REMINDER', timeZone = 'Europe/Berlin'): Schedule => ({
  id: `s-${title}`,
  kind,
  procedureId: null,
  procedure: null,
  title,
  description: '',
  recurrence: { kind: 'ONCE' },
  date: '2026-10-01',
  time: null,
  timeZone,
  reminders: [],
  assignee: null,
  state: 'ACTIVE',
  pausedAt: null,
  ended: null,
  revision: 1,
  createdAt: '2026-09-01T00:00:00.000Z',
  createdBy: 'Uma',
});
const occurrence = (title: string, dueDate: string, state: Occurrence['state'], extra: Partial<Occurrence> = {}): Occurrence => ({
  id: `o-${title}-${dueDate}`,
  schedule: schedule(title),
  dueDate,
  time: null,
  state,
  assignee: null,
  responsible: null,
  closed: null,
  skipReason: null,
  run: null,
  revision: 1,
  ...extra,
});
const projected = (title: string, dueDate: string, extra: Partial<ProjectedOccurrence> = {}): ProjectedOccurrence => ({ schedule: schedule(title), dueDate, time: null, responsible: null, ...extra });

describe('calendar entries (14.4)', () => {
  it('judges overdue by the date in the Schedule’s own zone and leaves cancelled Occurrences out', () => {
    expect(statusOf(occurrence('a', '2026-10-14', 'OPEN'), NOW)).toBe('OVERDUE');
    expect(statusOf(occurrence('a', '2026-10-15', 'OPEN'), NOW)).toBe('OPEN');
    expect(statusOf(occurrence('a', '2026-10-14', 'IN_PROGRESS'), NOW)).toBe('OVERDUE');
    expect(statusOf(occurrence('a', '2026-10-14', 'COMPLETED'), NOW)).toBe('COMPLETED');
    expect(statusOf(occurrence('a', '2026-10-14', 'CANCELLED'), NOW)).toBeNull();
    // 10:00 UTC on 15 October is already the 16th in Kiritimati (UTC+14).
    expect(statusOf({ ...occurrence('a', '2026-10-15', 'OPEN'), schedule: schedule('a', 'REMINDER', 'Pacific/Kiritimati') }, NOW)).toBe('OVERDUE');
  });

  it('orders by date, time (untimed first) and title, stored and projected together', () => {
    const entries = entriesOf(
      {
        occurrences: [occurrence('b', '2026-10-20', 'OPEN', { time: '18:00' }), occurrence('c', '2026-10-20', 'OPEN'), occurrence('gone', '2026-10-01', 'CANCELLED')],
        projected: [projected('a', '2026-10-20'), projected('z', '2026-10-19')],
      },
      NOW,
    );
    expect(entries.map((entry) => [entry.date, entry.status, entry.key])).toEqual([
      ['2026-10-19', 'PROJECTED', 's-z@2026-10-19'],
      ['2026-10-20', 'PROJECTED', 's-a@2026-10-20'],
      ['2026-10-20', 'OPEN', 'o-c-2026-10-20'],
      ['2026-10-20', 'OPEN', 'o-b-2026-10-20'],
    ]);
  });
});

describe('calendar filters (14.4)', () => {
  const entries = entriesOf(
    {
      occurrences: [
        occurrence('overdue-uma', '2026-10-01', 'OPEN', { responsible: UMA }),
        occurrence('open-shared', '2026-10-20', 'OPEN'),
        occurrence('running-cole', '2026-10-21', 'IN_PROGRESS', { responsible: COLE }),
        occurrence('done-uma', '2026-10-02', 'COMPLETED', { responsible: UMA }),
        occurrence('skipped-shared', '2026-10-03', 'SKIPPED'),
        { ...occurrence('procedure-uma', '2026-10-22', 'OPEN', { responsible: UMA }), schedule: schedule('procedure-uma', 'PROCEDURE') },
      ],
      projected: [projected('planned-cole', '2026-10-30', { responsible: COLE })],
    },
    NOW,
  );
  const shown = (filters: Partial<CalendarFilters>, viewer = UMA.id) =>
    entries.filter((entry) => matches(entry, { ...DEFAULT_FILTERS, ...filters }, viewer)).map((entry) => (entry.status === 'PROJECTED' ? entry.projected : entry.occurrence).schedule.title);

  it('shows everything by default', () => {
    expect(shown({})).toHaveLength(7);
  });

  it('filters by status; in progress and planned count as open', () => {
    expect(shown({ statuses: ['OVERDUE'] })).toEqual(['overdue-uma']);
    expect(shown({ statuses: ['OPEN'] })).toEqual(['open-shared', 'running-cole', 'procedure-uma', 'planned-cole']);
    expect(shown({ statuses: ['COMPLETED', 'SKIPPED'] })).toEqual(['done-uma', 'skipped-shared']);
    expect(shown({ statuses: [] })).toEqual([]);
  });

  it('filters by responsible person: me, shared, or one member', () => {
    expect(shown({ responsible: 'MINE' })).toEqual(['overdue-uma', 'done-uma', 'procedure-uma']);
    expect(shown({ responsible: 'MINE' }, COLE.id)).toEqual(['running-cole', 'planned-cole']);
    expect(shown({ responsible: 'SHARED' })).toEqual(['skipped-shared', 'open-shared']);
    expect(shown({ responsible: COLE.id })).toEqual(['running-cole', 'planned-cole']);
    expect(responsiblePeople(entries)).toEqual([COLE, UMA]);
  });

  it('combines status, responsible person and type', () => {
    expect(shown({ type: 'PROCEDURE' })).toEqual(['procedure-uma']);
    expect(shown({ type: 'REMINDER', responsible: 'MINE', statuses: ['OPEN', 'OVERDUE'] })).toEqual(['overdue-uma']);
    expect(shown({ type: 'PROCEDURE', responsible: 'SHARED' })).toEqual([]);
    expect(shown({ type: 'REMINDER', responsible: COLE.id, statuses: ['OPEN'] })).toEqual(['running-cole', 'planned-cole']);
  });

  it('reads remembered filters defensively', () => {
    expect(parseFilters(null)).toEqual(DEFAULT_FILTERS);
    expect(parseFilters('not json')).toEqual(DEFAULT_FILTERS);
    expect(parseFilters('{"statuses":["OVERDUE","nonsense"],"responsible":"<script>","type":"PROCEDURE"}')).toEqual({ statuses: ['OVERDUE'], responsible: 'ALL', type: 'PROCEDURE' });
    expect(parseFilters(JSON.stringify({ statuses: [], responsible: COLE.id, type: 'ALL' }))).toEqual({ statuses: [], responsible: COLE.id, type: 'ALL' });
  });
});

describe('calendar months (14.4)', () => {
  it('builds whole weeks, Monday first', () => {
    const october = monthGrid('2026-10');
    expect(october).toHaveLength(5);
    expect(october[0]).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(october[4]?.[6]).toBe('2026-11-01');
    // February 2027 starts on a Monday and has exactly four weeks; August 2026 needs six.
    expect(monthGrid('2027-02')).toHaveLength(4);
    expect(monthGrid('2026-08')).toHaveLength(6);
    expect(monthGrid('2026-08')[5]?.[0]).toBe('2026-08-31');
  });

  it('moves across year ends and leap years', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2027-01', -1)).toBe('2026-12');
    expect(addMonths('2026-10', 60)).toBe('2031-10');
    expect(lastDayOf('2028-02')).toBe('2028-02-29');
    expect(lastDayOf('2027-02')).toBe('2027-02-28');
  });

  it('moves between days with the arrow keys, also into the next month', () => {
    expect(dayAfterKey('2026-10-31', 'ArrowRight')).toBe('2026-11-01');
    expect(dayAfterKey('2026-10-01', 'ArrowLeft')).toBe('2026-09-30');
    expect(dayAfterKey('2026-12-28', 'ArrowDown')).toBe('2027-01-04');
    expect(dayAfterKey('2026-10-05', 'ArrowUp')).toBe('2026-09-28');
    expect(dayAfterKey('2026-10-05', 'Enter')).toBeNull();
  });
});
