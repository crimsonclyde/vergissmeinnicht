/**
 * Calendar helpers for scheduling (13.4). The server validates dates and zones; these only prepare
 * form defaults and group items in the UI. Wall-clock values are kept as `YYYY-MM-DD` / `HH:MM`.
 */

/** The browser's IANA time zone (sent with a new scheduled item), `UTC` if unknown. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Today's calendar date in `timeZone`, `YYYY-MM-DD`. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both `YYYY-MM-DD`). */
export function daysBetween(from: string, to: string): number {
  const ms = (date: string) => {
    const [year, month, day] = date.split('-').map(Number) as [number, number, number];
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}
