/** Pure helpers for the Clock page: no clock reads, so they are easy to test. */

/** ISO 8601 week number (weeks start on Monday; week 1 holds the year's first Thursday) of a local date. */
export function isoWeek(now: Date): number {
  const day = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  return Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

/** "+1", "-5", "+5:30" or "±0" from a JavaScript time zone offset (minutes behind UTC). */
export function utcOffset(timezoneOffset: number): string {
  const minutes = -timezoneOffset;
  if (minutes === 0) return '±0';
  const sign = minutes > 0 ? '+' : '-';
  const hours = Math.floor(Math.abs(minutes) / 60);
  const rest = Math.abs(minutes) % 60;
  return `${sign}${hours}${rest === 0 ? '' : `:${String(rest).padStart(2, '0')}`}`;
}

/** The city part of an IANA zone, for a short label: "Europe/Berlin" → "Berlin", "America/New_York" → "New York". */
export function zoneCity(timeZone: string): string {
  return (timeZone.split('/').at(-1) ?? timeZone).replaceAll('_', ' ');
}

/** Hours since local midnight, with minutes as a fraction. */
export const hourOfDay = (now: Date): number => now.getHours() + now.getMinutes() / 60;

/** Hours of a wall time `YYYY-MM-DDTHH:MM`. */
export const wallHour = (time: string): number => Number(time.slice(11, 13)) + Number(time.slice(14, 16)) / 60;

/** Minutes as "9 h 08 min" parts. */
export const hoursMinutes = (minutes: number): { hours: number; minutes: string } => ({ hours: Math.floor(minutes / 60), minutes: String(Math.round(minutes % 60)).padStart(2, '0') });
