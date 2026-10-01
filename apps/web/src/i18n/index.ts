import { en } from './en.ts';

/**
 * i18n seam (Step 8.4). V1 ships English only, but user-facing text is looked up by key, and dates
 * are formatted here, so a translation is a new catalog — not a change to components.
 *
 * Adding a language: create `xx.ts` exporting `const xx: Messages = { … }` (TypeScript then requires
 * every key), register it in CATALOGS, and choose the locale (e.g. from a user setting).
 */

/** A message is a template with `{name}` placeholders, or plural forms selected by `{count}`. */
export type Message = string | ({ readonly other: string } & Partial<Record<Intl.LDMLPluralRule, string>>);
export type MessageKey = keyof typeof en;
/** Every catalog must translate every key. */
export type Messages = Record<MessageKey, Message>;
export type Params = Readonly<Record<string, string | number>>;

const CATALOGS = { en } as const satisfies Record<string, Messages>;
export type Locale = keyof typeof CATALOGS;

let locale: Locale = 'en';

export function currentLocale(): Locale {
  return locale;
}

/** Switches the language for subsequently rendered text (not exposed in the UI in V1). */
export function setLocale(next: Locale): void {
  locale = next;
  document.documentElement.lang = next;
}

/** Plain text for `key`. Never HTML: callers render it as text. Unknown placeholders stay visible. */
export function t(key: MessageKey, params: Params = {}): string {
  const message: Message = CATALOGS[locale][key];
  let template: string;
  if (typeof message === 'string') {
    template = message;
  } else {
    const count = Number(params.count);
    const rule = new Intl.PluralRules(locale).select(Number.isFinite(count) ? count : 0);
    template = message[rule] ?? message.other;
  }
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = params[name];
    return value === undefined ? placeholder : String(value);
  });
}

/** Whether a catalog has a message for this key (e.g. server error codes). */
export function hasMessage(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(CATALOGS[locale], key);
}

/**
 * Locale for numbers and dates: the browser's regional variant of the UI language if it has one
 * (e.g. en-GB dates for a British English browser), otherwise the UI language itself.
 */
function formatLocale(): string {
  const preferred = typeof navigator === 'undefined' ? [] : navigator.languages;
  return preferred.find((tag) => tag.split('-')[0] === locale) ?? locale;
}

const toDate = (value: string | Date) => (typeof value === 'string' ? new Date(value) : value);

/** Date and time, e.g. "Sep 27, 2026, 5:40 PM". The only place components get formatted dates from. */
export function formatDateTime(value: string | Date): string {
  return new Intl.DateTimeFormat(formatLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(toDate(value));
}

/** A number in the app locale, with at most `maximumFractionDigits` decimals. */
export function formatNumber(value: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat(formatLocale(), { maximumFractionDigits }).format(value);
}

/** Time of day only, e.g. "5:40:12 PM" (for "just now" notices). */
export function formatTime(value: string | Date): string {
  return new Intl.DateTimeFormat(formatLocale(), { timeStyle: 'medium' }).format(toDate(value));
}

/** Compact "when": time only for today, date and time otherwise (e.g. "17:40" / "Sep 26, 17:40"). */
export function formatWhen(value: string | Date, now: Date = new Date()): string {
  const date = toDate(value);
  const sameDay = date.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat(
    formatLocale(),
    sameDay ? { timeStyle: 'short' } : { dateStyle: 'medium', timeStyle: 'short' },
  ).format(date);
}

/** "Thu, Oct 15, 2026" for a calendar date `YYYY-MM-DD` (a date as such, independent of time zones). */
export function formatCalendarDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(formatLocale(), { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, day, 12)),
  );
}

/** "18 minutes ago", "in 2 days" — rounded to the largest sensible unit. */
export function formatRelative(value: string | Date, now: Date = new Date()): string {
  const seconds = (toDate(value).getTime() - now.getTime()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  const format = new Intl.RelativeTimeFormat(formatLocale(), { numeric: 'auto' });
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, 'minute');
}
