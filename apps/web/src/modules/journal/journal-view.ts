import { journalSummary, type JournalSummary } from '@vergissmeinnicht/domain';
import type { JournalView } from '../../api.ts';

/** Presentation helpers for Notes and the Journal (steps.md 40). Pure, so they are unit tested. */

/** Theme tokens a notebook can wear. Its name picks one, so a notebook keeps its colour everywhere. */
const TONES = ['--accent', '--brand', '--state-done', '--state-skipped', '--state-na', '--state-pending'] as const;
export function notebookTone(name: string): string {
  if (name === '') return 'var(--border-strong)';
  let hash = 0;
  for (const char of name.normalize('NFC').toLowerCase()) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return `var(${TONES[hash % TONES.length]})`;
}

/** The person's civil date on this device, `YYYY-MM-DD`. */
export function localDate(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Monday-first weeks of a month, `null` for the days of the neighbouring months. */
export function monthGrid(month: string): (string | null)[][] {
  const [year, index] = month.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(year, index - 1, 1));
  const days = new Date(Date.UTC(year, index, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const cells: (string | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, day) => `${month}-${String(day + 1).padStart(2, '0')}`)];
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));
}

/** Entries written on today's day and month in earlier years, newest first. */
export function onThisDay<T extends { date: string }>(dated: readonly T[], today: string): T[] {
  return dated.filter(entry => entry.date.slice(5) === today.slice(5) && entry.date < today.slice(0, 4)).sort((a, b) => b.date.localeCompare(a.date));
}

/** Consecutive days up to today (or yesterday) with at least one entry. */
export function writingStreak(dates: readonly string[], today: string): number {
  const days = new Set(dates);
  const step = (date: string) => { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() - 1); return value.toISOString().slice(0, 10); };
  let day = days.has(today) ? today : step(today);
  let count = 0;
  while (days.has(day)) { count++; day = step(day); }
  return count;
}

const summaries = new WeakMap<object, JournalSummary>();
/** Parsed once per loaded entry; the list re-renders often while filtering. */
export function summaryOf(entry: Pick<JournalView, 'body' | 'version'>): JournalSummary {
  let summary = summaries.get(entry);
  if (summary === undefined) { summary = journalSummary(entry.body, entry.version); summaries.set(entry, summary); }
  return summary;
}

/** A one-line Markdown stamp for a Journal page: plain italic text, so it exports and imports as written. */
export function weatherStamp(parts: readonly (string | null | undefined)[]): string {
  const text = parts.filter((part): part is string => typeof part === 'string' && part.trim() !== '').join(' · ').replace(/([\\`*_[\]<>#|~])/g, '\\$1');
  return text === '' ? '' : `*${text}*\n\n`;
}

