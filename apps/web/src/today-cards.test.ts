import { describe, expect, it } from 'vitest';
import type { Occurrence, Schedule } from './api.ts';
import { NEXT_UP_ROWS, TODAY_CARDS, nextUp, recentSince, todayCards } from './today-cards.ts';

function occurrence(id: string, dueDate: string, extra: Partial<Occurrence> = {}, timeZone = 'UTC'): Occurrence {
  const schedule = { id: `schedule-${id}`, kind: 'REMINDER', title: id, timeZone } as unknown as Schedule;
  return { id, schedule, dueDate, time: null, state: 'OPEN', assignee: null, responsible: null, closed: null, skipReason: null, run: null, revision: 1, ...extra };
}

describe('Today cards (19.1)', () => {
  it('has each card once, in the calm default order, with Progress off', () => {
    const ids = TODAY_CARDS.map((card) => card.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(todayCards(['PROCEDURES', 'REMINDERS', 'LISTS', 'CALENDAR', 'MAINTENANCE']).map((card) => card.id)).toEqual(['attention', 'continue', 'next', 'toBuy', 'maintenance', 'recent']);
  });

  it('never offers a card whose tool is off, whatever the person chose', () => {
    const everything = () => true;
    expect(todayCards([], everything)).toEqual([]);
    expect(todayCards(['LISTS'], everything).map((card) => card.id)).toEqual(['toBuy']);
    expect(todayCards(['REMINDERS'], everything).map((card) => card.id)).toEqual(['attention', 'next', 'recent', 'progress']);
    // Maintenance due soon is the one house-management card (T5); Documents, Contacts and Equipment add none.
    expect(todayCards(['DOCUMENTS', 'CONTACTS', 'EQUIPMENT'], everything)).toEqual([]);
    expect(todayCards(['MAINTENANCE'], everything).map((card) => card.id)).toEqual(['maintenance']);
  });

  it('lets the person switch a card off for themselves only', () => {
    expect(todayCards(['LISTS', 'REMINDERS'], (card) => card.defaultVisible && card.id !== 'toBuy').map((card) => card.id)).toEqual(['attention', 'next', 'recent']);
  });

  it('puts what to act on in the main column and the rest beside it', () => {
    expect(TODAY_CARDS.filter((card) => card.column === 'main').map((card) => card.id)).toEqual(['attention', 'continue', 'next']);
  });
});

describe('Next up', () => {
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
  });

  it('counts the week in each Schedule’s own time zone and stops at three', () => {
    // In Auckland it is already 9 October: the 16th is within its week.
    expect(nextUp([occurrence('nz', '2026-10-16', {}, 'Pacific/Auckland')], new Date('2026-10-08T12:00:00Z')).map((item) => item.id)).toEqual(['nz']);
    const many = ['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12'].map((date) => occurrence(date, date));
    expect(nextUp(many, now)).toHaveLength(NEXT_UP_ROWS);
  });
});

it('asks for the last 3 days of completions by default', () => {
  expect(recentSince(new Date('2026-10-08T10:00:00Z')).toISOString()).toBe('2026-10-05T10:00:00.000Z');
});
