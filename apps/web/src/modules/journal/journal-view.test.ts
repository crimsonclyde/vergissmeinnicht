import { describe, expect, it } from 'vitest';
import { localDate, monthGrid, notebookTone, onThisDay, weatherStamp, writingStreak } from './journal-view.ts';

describe('journal view helpers', () => {
  it('gives a notebook one theme token, whatever the case', () => {
    expect(notebookTone('Garden')).toBe(notebookTone('garden'));
    expect(notebookTone('Garden')).toMatch(/^var\(--[a-z-]+\)$/);
    expect(notebookTone('')).toBe('var(--border-strong)');
  });
  it('builds Monday-first weeks', () => {
    const weeks = monthGrid('2026-11');
    expect(weeks.every(week => week.length === 7)).toBe(true);
    expect(weeks[0]?.slice(0, 7)).toEqual([null, null, null, null, null, null, '2026-11-01']);
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
    expect(monthGrid('2024-02').flat().filter(Boolean)).toHaveLength(29);
  });
  it('formats the local date', () => { expect(localDate(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05'); });
  it('counts a streak up to today or yesterday', () => {
    expect(writingStreak(['2026-11-12', '2026-11-11', '2026-11-10', '2026-11-08'], '2026-11-12')).toBe(3);
    expect(writingStreak(['2026-11-11', '2026-11-10'], '2026-11-12')).toBe(2);
    expect(writingStreak(['2026-11-09'], '2026-11-12')).toBe(0);
    expect(writingStreak(['2026-03-01', '2026-02-28'], '2026-03-01')).toBe(2);
  });
  it('finds earlier years on this day, newest first', () => {
    const dated = [{ date: '2024-11-12' }, { date: '2025-11-12' }, { date: '2026-11-12' }, { date: '2025-11-13' }];
    expect(onThisDay(dated, '2026-11-12').map(entry => entry.date)).toEqual(['2025-11-12', '2024-11-12']);
  });
  it('writes the stamp as escaped plain italic Markdown', () => {
    expect(weatherStamp(['Rain', '7°', null, ' ', 'Waning crescent'])).toBe('*Rain · 7° · Waning crescent*\n\n');
    expect(weatherStamp(['*bold* <b> [x]'])).toBe('*\\*bold\\* \\<b\\> \\[x\\]*\n\n');
    expect(weatherStamp([null, ''])).toBe('');
  });
});
