import { describe, expect, it } from 'vitest';
import type { Occurrence, RunSummary, Schedule } from './api.ts';
import { remindersView } from './Reminders.tsx';
import { firstName, greetingKey, todayHero, todayRing, todayView } from './Today.tsx';


function occurrence(id: string, kind: Schedule['kind'], extra: Partial<Occurrence> = {}): Occurrence {
  const schedule = { id: `schedule-${id}`, kind, title: id, recurrence: { kind: 'ONCE' }, reminders: [], state: 'ACTIVE' } as unknown as Schedule;
  return { id, schedule, dueDate: '2026-10-01', time: null, state: 'OPEN', assignee: null, responsible: null, closed: null, skipReason: null, run: null, revision: 1, ...extra };
}
const inProgress = (id: string) => occurrence(id, 'PROCEDURE', { state: 'IN_PROGRESS', run: { id: `run-${id}`, state: 'ACTIVE', startedAt: '2026-10-01T08:00:00.000Z', startedBy: 'Uma' } });
const run = { id: 'run-loose', title: 'Weekly clean' } as unknown as RunSummary;

describe('Dashboard', () => {
  const home = {
    overdue: [occurrence('tax', 'REMINDER'), inProgress('boiler')],
    today: [occurrence('bins', 'REMINDER', { responsible: { id: 'ana', name: 'Ana' } }), inProgress('leave'), occurrence('water', 'PROCEDURE')],
    upcoming: [occurrence('insurance', 'REMINDER'), inProgress('early'), occurrence('service', 'PROCEDURE')],
    later: 4,
    active: [run],
  };

  it('puts unfinished Runs first, then what is overdue, then what is due today', () => {
    const view = todayView(home);
    // Also a Run that was started early: unfinished work comes first, whenever it is due.
    expect(view.continueOccurrences.map((item) => item.id)).toEqual(['boiler', 'leave', 'early']);
    expect(view.continueRuns).toEqual([run]);
    expect(view.overdue.map((item) => item.id)).toEqual(['tax']);
    expect(view.today.map((item) => item.id)).toEqual(['bins', 'water']);
  });

  it('keeps upcoming items out of the attention area and only counts them', () => {
    const view = todayView(home);
    const shown = [...view.continueOccurrences, ...view.overdue, ...view.today].map((item) => item.id);
    expect(shown).not.toContain('insurance');
    expect(shown).not.toContain('service');
    // Two open upcoming ones plus the four beyond 90 days; the one in progress is under Continue.
    expect(view.upcomingCount).toBe(6);
  });

  it('applies the responsibility filter to every section', () => {
    const mine = todayView(home, (item) => item.responsible?.id === 'ana');
    expect(mine.today.map((item) => item.id)).toEqual(['bins']);
    expect(mine.overdue).toEqual([]);
    expect(mine.continueOccurrences).toEqual([]);
  });

  it('is calm when nothing is due', () => {
    const view = todayView({ overdue: [], today: [], upcoming: [], later: 0, active: [] });
    expect(view).toEqual({ continueOccurrences: [], continueRuns: [], overdue: [], today: [], upcomingCount: 0 });
  });
});

describe('Reminders', () => {
  it('lists standalone Reminders only — scheduled Procedures stay with Today and the Calendar', () => {
    const view = remindersView({
      overdue: [occurrence('tax', 'REMINDER'), occurrence('boiler', 'PROCEDURE')],
      today: [occurrence('bins', 'REMINDER')],
      upcoming: [occurrence('service', 'PROCEDURE'), occurrence('insurance', 'REMINDER')],
      recentlyDone: [occurrence('passport', 'REMINDER', { state: 'COMPLETED' }), occurrence('clean', 'PROCEDURE', { state: 'COMPLETED' })],
    });
    expect(view.overdue.map((item) => item.id)).toEqual(['tax']);
    expect(view.today.map((item) => item.id)).toEqual(['bins']);
    expect(view.upcoming.map((item) => item.id)).toEqual(['insurance']);
    expect(view.done.map((item) => item.id)).toEqual(['passport']);
  });
});

describe('a livelier Today (22.3)', () => {
  it('puts a loose unfinished Run in the prominent card first, else a started Occurrence', () => {
    const view = todayView({ overdue: [inProgress('boiler')], today: [], upcoming: [], later: 0, active: [run] });
    expect(todayHero(view)).toEqual({ kind: 'run', run });
    expect(todayHero({ ...view, continueRuns: [] })).toMatchObject({ kind: 'occurrence', runId: 'run-boiler' });
    expect(todayHero({ continueRuns: [], continueOccurrences: [] })).toBeNull();
  });

  it('counts the ring as done today out of done plus still due, and hides it when there is nothing', () => {
    expect(todayRing(2, 3)).toEqual({ done: 2, total: 5 });
    expect(todayRing(null, 1)).toEqual({ done: 0, total: 1 });
    expect(todayRing(0, 0)).toBeNull();
  });

  it('greets by the time of day and the first name', () => {
    expect([5, 11, 12, 17, 18, 23].map(greetingKey)).toEqual([
      'today.greeting.morning',
      'today.greeting.morning',
      'today.greeting.afternoon',
      'today.greeting.afternoon',
      'today.greeting.evening',
      'today.greeting.evening',
    ]);
    expect(firstName('  Ada Admin ')).toBe('Ada');
    expect(firstName('Uma 🌸')).toBe('Uma');
    expect(firstName('Cher')).toBe('Cher');
  });
});
