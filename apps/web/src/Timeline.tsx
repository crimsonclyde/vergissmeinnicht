import { formatCalendarDate, formatMonthShort } from './i18n/index.ts';
import './area.css';

/** The local calendar date `YYYY-MM-DD` of an instant, as this device shows it. */
export function localDate(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * A timeline's day stamp (41): the day number in a circle over the short month, like the Journal's.
 * Decoration only — the card beside it says the date in words — so it is hidden from assistive tech.
 * `null` keeps the column empty for a further entry of the same day.
 */
export function DayStamp({ date, today = false, tone }: { date: string | null; today?: boolean; tone?: 'overdue' | 'done' | undefined }) {
  if (date === null) return null;
  return (
    <span className="area-day" aria-hidden="true" title={formatCalendarDate(date)} {...(today ? { 'data-today': '' } : {})} {...(tone === undefined ? {} : { 'data-tone': tone })}>
      <b>{Number(date.slice(8))}</b>
      <small>{formatMonthShort(date)}</small>
    </span>
  );
}

/** For entries in date order: each entry's date, or null when the entry before it had the same date. */
export function firstOfDay<T>(items: readonly T[], dateOf: (item: T) => string): (string | null)[] {
  return items.map((item, index) => {
    const date = dateOf(item);
    return index > 0 && dateOf(items[index - 1] as T) === date ? null : date;
  });
}
