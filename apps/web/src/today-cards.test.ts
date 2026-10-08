import { parseTodayLayout } from '@vergissmeinnicht/domain';
import { formatClock } from './i18n/index.ts';
import { describe, expect, it } from 'vitest';
import type { Occurrence, Schedule } from './api.ts';
import { NEXT_UP_ROWS, TODAY_CARDS, agenda, changeCard, layoutOf, moveCard, nextUp, recentSince, resolveTodayLayout, todayCards } from './today-cards.ts';

function occurrence(id: string, dueDate: string, extra: Partial<Occurrence> = {}, timeZone = 'UTC'): Occurrence {
  const schedule = { id: `schedule-${id}`, kind: 'REMINDER', title: id, timeZone } as unknown as Schedule;
  return { id, schedule, dueDate, time: null, state: 'OPEN', assignee: null, responsible: null, closed: null, skipReason: null, run: null, revision: 1, ...extra };
}
const ids = (cards: readonly { card: { id: string } }[]) => cards.map((setting) => setting.card.id);
const ALL_TOOLS = ['PROCEDURES', 'REMINDERS', 'LISTS', 'CALENDAR', 'MAINTENANCE'];
const defaults = resolveTodayLayout(null);
const everything = { ...defaults, cards: defaults.cards.map((setting) => ({ ...setting, visible: true })) };

describe('Today cards (19.1)', () => {
  it('has each card once, in the calm default order, with Progress and Calendar off', () => {
    const all = TODAY_CARDS.map((card) => card.id);
    expect(new Set(all).size).toBe(all.length);
    expect(ids(todayCards(ALL_TOOLS))).toEqual(['attention', 'continue', 'next', 'toBuy', 'maintenance', 'recent']);
    expect(defaults.density).toBe('COMPACT');
  });

  it('never offers a card whose tool is off, whatever the person chose', () => {
    // Clock & date (19.3) and Weather (19.4, W1) need no Workspace tool; every other card needs one of its tools.
    expect(ids(todayCards([], everything))).toEqual(['clock', 'weather']);
    expect(ids(todayCards(['LISTS'], everything))).toEqual(['clock', 'weather', 'toBuy']);
    expect(ids(todayCards(['REMINDERS'], everything))).toEqual(['clock', 'weather', 'attention', 'next', 'recent', 'progress']);
    // Maintenance due soon is the one house-management card (T5); Documents, Contacts and Equipment add none.
    expect(ids(todayCards(['DOCUMENTS', 'CONTACTS', 'EQUIPMENT'], everything))).toEqual(['clock', 'weather']);
    expect(ids(todayCards(['MAINTENANCE', 'CALENDAR'], everything))).toEqual(['clock', 'weather', 'maintenance', 'calendar']);
  });

  it('lets the person switch a card off for themselves only', () => {
    expect(ids(todayCards(['LISTS', 'REMINDERS'], changeCard(defaults, 'toBuy', { visible: false })))).toEqual(['attention', 'next', 'recent']);
  });

  it('puts what to act on in the main column and the rest beside it', () => {
    expect(TODAY_CARDS.filter((card) => card.column === 'main').map((card) => card.id)).toEqual(['attention', 'continue', 'next']);
  });
});

describe('Today layout in the Profile (19.2)', () => {
  it('saves exactly what the server accepts, and reads it back unchanged', () => {
    let settings = moveCard(changeCard(defaults, 'recent', { retention: 'DAYS_7', size: 'WIDE' }), 'recent', -1);
    settings = changeCard(changeCard({ ...settings, density: 'COMFORTABLE' }, 'toBuy', { lists: 7 }), 'clock', { visible: true, hour24: true });
    const layout = layoutOf(settings);
    expect(parseTodayLayout(JSON.parse(JSON.stringify(layout)))).toEqual(layout);
    expect(resolveTodayLayout(layout)).toEqual(settings);
    expect(ids(settings.cards).indexOf('recent')).toBe(ids(settings.cards).indexOf('maintenance') - 1);
  });

  it('keeps a layout saved by an earlier version working when cards are added or retired', () => {
    // Saved before Calendar existed, with a card this version no longer knows and a bad option.
    const old = {
      version: 1,
      density: 'COMFORTABLE',
      cards: [
        { id: 'recent', visible: false },
        { id: 'retired-card', visible: true },
        { id: 'attention', visible: true, size: 'WIDE' },
        { id: 'toBuy', visible: true, options: { lists: 99 } },
        { id: 'progress', visible: true, size: 'WIDE' },
        { id: 'attention', visible: false },
      ],
    };
    const read = resolveTodayLayout(old);
    expect(read.density).toBe('COMFORTABLE');
    // Saved cards keep their order; missing ones go right after the registry card before them.
    // Clock & date did not exist then either: it comes first, as in the registry, and stays off.
    expect(ids(read.cards)).toEqual(['clock', 'weather', 'recent', 'attention', 'continue', 'next', 'toBuy', 'maintenance', 'progress', 'calendar']);
    expect(read.cards[0]).toMatchObject({ visible: false, hour24: false });
    expect(read.cards[1]).toMatchObject({ visible: false });
    const setting = (id: string) => read.cards.find((each) => each.card.id === id);
    expect(setting('recent')?.visible).toBe(false);
    expect(setting('attention')).toMatchObject({ visible: true, size: 'WIDE' });
    expect(setting('toBuy')?.lists).toBe(3);
    expect(setting('progress')?.size).toBe('NORMAL'); // Progress is never wide
    expect(setting('calendar')?.visible).toBe(false); // a new card comes with its default
    expect(parseTodayLayout(layoutOf(read))).toEqual(layoutOf(read));
  });

  it('treats anything unreadable as the default layout, without errors', () => {
    for (const saved of [null, undefined, 'x', 42, [], { cards: 'no' }, { cards: [null, 7, { id: 3 }] }, { density: 'TINY' }]) {
      expect(resolveTodayLayout(saved)).toEqual(defaults);
    }
  });

  it('moves cards one place at a time and stops at the ends', () => {
    expect(ids(moveCard(defaults, 'continue', -1).cards).slice(2, 4)).toEqual(['continue', 'attention']);
    expect(moveCard(defaults, 'clock', -1)).toBe(defaults);
    expect(moveCard(defaults, 'calendar', 1)).toBe(defaults);
  });
});

describe('Next up and Calendar', () => {
  const now = new Date('2026-10-08T10:00:00Z');

  it('shows the next few open items within a week, soonest first', () => {
    const items = [
      occurrence('week', '2026-10-15'),
      occurrence('too-far', '2026-10-16'),
      occurrence('tomorrow-late', '2026-10-09', { time: '18:00' }),
      occurrence('tomorrow-early', '2026-10-09', { time: '07:00' }),
      occurrence('started', '2026-10-10', { state: 'IN_PROGRESS' }),
    ];
    expect(nextUp(items, now).map((item) => item.id)).toEqual(['tomorrow-early', 'tomorrow-late', 'week']);
    expect(agenda(items).map((item) => item.id)).toEqual(['tomorrow-early', 'tomorrow-late', 'week', 'too-far']);
  });

  it('counts the week in each Schedule’s own time zone and stops at three', () => {
    // In Auckland it is already 9 October: the 16th is within its week.
    expect(nextUp([occurrence('nz', '2026-10-16', {}, 'Pacific/Auckland')], new Date('2026-10-08T12:00:00Z')).map((item) => item.id)).toEqual(['nz']);
    const many = ['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12'].map((date) => occurrence(date, date));
    expect(nextUp(many, now)).toHaveLength(NEXT_UP_ROWS);
  });
});

describe('Recently completed window', () => {
  const now = new Date('2026-10-08T10:00:00Z');

  it('asks for the last 3 days by default, and for nothing when switched off', () => {
    expect(recentSince(undefined, now)?.toISOString()).toBe('2026-10-05T10:00:00.000Z');
    expect(recentSince('HOURS_24', now)?.toISOString()).toBe('2026-10-07T10:00:00.000Z');
    expect(recentSince('DAYS_7', now)?.toISOString()).toBe('2026-10-01T10:00:00.000Z');
    expect(recentSince('OFF', now)).toBeNull();
  });

  it('starts "Today" at local midnight, also on the day clocks change', () => {
    for (const instant of [now, new Date('2026-10-25T12:00:00Z'), new Date('2026-03-29T12:00:00Z')]) {
      const since = recentSince('TODAY', instant);
      expect(since?.getHours()).toBe(0);
      expect(since?.getMinutes()).toBe(0);
      expect(since?.toDateString()).toBe(instant.toDateString());
    }
  });
});

describe('Clock & date (19.3)', () => {
  const afternoon = new Date(2026, 9, 8, 15, 5, 42);

  it('shows hours and minutes without seconds, 24-hour when the person wants it', () => {
    expect(formatClock(afternoon, true).time).toBe('15:05');
    // Otherwise the locale decides (12- or 24-hour); never seconds.
    expect(formatClock(afternoon, false).time).toMatch(/^(15:05|3:05\s?PM)$/);
    const { date, full } = formatClock(afternoon, true);
    for (const part of ['Thursday', 'October', '8']) expect(date).toContain(part);
    // One sentence for assistive technology: weekday, full date with the year, and time.
    for (const part of ['Thursday', 'October', '8', '2026', '15:05']) expect(full).toContain(part);
  });

  it('is off by default and keeps its option through a save', () => {
    const clock = defaults.cards.find((setting) => setting.card.id === 'clock');
    expect(clock).toMatchObject({ visible: false, hour24: false });
    expect(layoutOf(changeCard(defaults, 'clock', { hour24: true })).cards[0]).toEqual({ id: 'clock', visible: false, size: 'NORMAL', options: { hour24: true } });
  });
});
