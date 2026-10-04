import { describe, expect, it } from 'vitest';
import type { Occurrence, RunSummary, Schedule } from './api.ts';
import { destinations } from './AppShell.tsx';
import { remindersView } from './Reminders.tsx';
import { todayView } from './Today.tsx';

const W = '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f';

function occurrence(id: string, kind: Schedule['kind'], extra: Partial<Occurrence> = {}): Occurrence {
  const schedule = { id: `schedule-${id}`, kind, title: id, recurrence: { kind: 'ONCE' }, reminders: [], state: 'ACTIVE' } as unknown as Schedule;
  return { id, schedule, dueDate: '2026-10-01', time: null, state: 'OPEN', assignee: null, responsible: null, closed: null, skipReason: null, run: null, revision: 1, ...extra };
}
const inProgress = (id: string) => occurrence(id, 'PROCEDURE', { state: 'IN_PROGRESS', run: { id: `run-${id}`, state: 'ACTIVE', startedAt: '2026-10-01T08:00:00.000Z', startedBy: 'Uma' } });
const run = { id: 'run-loose', title: 'Weekly clean' } as unknown as RunSummary;

describe('Today', () => {
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

describe('tool navigation', () => {
  const nav = destinations(W, ['PROCEDURES', 'REMINDERS', 'LISTS', 'CALENDAR']);

  it('keeps Today and More with all tools off and never offers a disabled destination', () => {
    expect(destinations(W, []).side.map((item) => item.label)).toEqual(['Today']);
    expect(destinations(W, []).bar.map((item) => item.label)).toEqual(['Today', 'More']);
    expect(destinations(W, ['LISTS']).bar.map((item) => item.label)).toEqual(['Today', 'Lists', 'More']);
  });

  it('has the five tools in the desktop sidebar', () => {
    expect(nav.side.map((item) => item.label)).toEqual(['Today', 'Procedures', 'Reminders', 'Lists', 'Calendar']);
    expect(nav.side.map((item) => item.href)).toEqual([`/w/${W}`, `/w/${W}/procedures`, `/w/${W}/reminders`, `/w/${W}/lists`, `/w/${W}/calendar`]);
  });

  it('has four labelled destinations in the phone bar; More covers Reminders, Calendar and history', () => {
    expect(nav.bar.map((item) => item.label)).toEqual(['Today', 'Procedures', 'Lists', 'More']);
    const more = nav.bar[3];
    expect(more?.href).toBe(`/w/${W}/more`);
    expect(more?.pages).toEqual(expect.arrayContaining(['more', 'reminders', 'calendar', 'history']));
  });

  it('adds an enabled optional tool to the sidebar and to More — never to the phone bar (16.2)', () => {
    const withDocuments = destinations(W, ['PROCEDURES', 'REMINDERS', 'LISTS', 'CALENDAR', 'DOCUMENTS']);
    expect(withDocuments.side.map((item) => item.label)).toEqual(['Today', 'Procedures', 'Reminders', 'Lists', 'Calendar', 'Documents']);
    expect(withDocuments.side.at(-1)?.href).toBe(`/w/${W}/documents`);
    expect(withDocuments.bar.map((item) => item.label)).toEqual(['Today', 'Procedures', 'Lists', 'More']); // still exactly four
    expect(withDocuments.bar[3]?.pages).toContain('documents');
    // Not switched on: it appears nowhere.
    expect(nav.side.some((item) => item.pages.includes('documents'))).toBe(false);
    expect(nav.bar.some((item) => item.pages.includes('documents'))).toBe(false);
    expect(destinations(W, ['UNKNOWN']).side).toHaveLength(1);
  });

  it('marks exactly one destination for every tool page', () => {
    for (const page of ['workspace', 'procedures', 'procedure-edit', 'reminders', 'lists', 'calendar'] as const) {
      expect({ page, current: nav.side.filter((item) => item.pages.includes(page)).length }).toEqual({ page, current: 1 });
    }
    for (const page of ['workspace', 'procedures', 'lists', 'more', 'reminders', 'calendar', 'history'] as const) {
      expect({ page, current: nav.bar.filter((item) => item.pages.includes(page)).length }).toEqual({ page, current: 1 });
    }
    // Settings pages belong to no tool.
    for (const page of ['settings', 'members', 'knots', 'account', 'admin'] as const) {
      expect(nav.side.some((item) => item.pages.includes(page))).toBe(false);
    }
  });
});
