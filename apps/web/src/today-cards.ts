import {
  RECENT_RETENTIONS,
  TODAY_CARD_SIZES,
  TODAY_DENSITIES,
  TODAY_LAYOUT_VERSION,
  TO_BUY_LISTS_MAX,
  TO_BUY_LISTS_MIN,
  type RecentRetention,
  type TodayCardId,
  type TodayCardSize,
  type TodayDensity,
  type TodayLayout,
} from '@vergissmeinnicht/domain';
import type { Occurrence } from './api.ts';
import { addDays, todayIn } from './schedule-dates.ts';

export type { TodayCardId } from '@vergissmeinnicht/domain';

/**
 * Today's cards (19.1). The registry is the one place that knows which cards exist, which Workspace tool
 * each needs, whether it is on without a personal choice, and where it goes. A card is shown only when
 * the person has it on (19.2), its tool is on in the Workspace and it has something to show — the last
 * part is decided by the card itself when it renders.
 */
export interface TodayCardDefinition {
  readonly id: TodayCardId;
  /** Shown only while at least one of these tools is on. */
  readonly anyOf: readonly string[];
  readonly defaultVisible: boolean;
  /** Desktop: the main column for what to act on, the narrower side column for the rest. */
  readonly column: 'main' | 'side';
  /** Whether "Wide" (spanning both columns on a wide screen) is offered. */
  readonly canBeWide: boolean;
}

/** In default order. Later versions add cards here; a saved layout only overrides the person's choices. */
export const TODAY_CARDS: readonly TodayCardDefinition[] = [
  { id: 'attention', anyOf: ['REMINDERS', 'PROCEDURES'], defaultVisible: true, column: 'main', canBeWide: true },
  { id: 'continue', anyOf: ['PROCEDURES'], defaultVisible: true, column: 'main', canBeWide: true },
  { id: 'next', anyOf: ['REMINDERS', 'PROCEDURES'], defaultVisible: true, column: 'main', canBeWide: true },
  { id: 'toBuy', anyOf: ['LISTS'], defaultVisible: true, column: 'side', canBeWide: true },
  { id: 'maintenance', anyOf: ['MAINTENANCE'], defaultVisible: true, column: 'side', canBeWide: true },
  { id: 'recent', anyOf: ['REMINDERS', 'PROCEDURES'], defaultVisible: true, column: 'side', canBeWide: true },
  { id: 'progress', anyOf: ['REMINDERS', 'PROCEDURES'], defaultVisible: false, column: 'side', canBeWide: false },
  { id: 'calendar', anyOf: ['CALENDAR'], defaultVisible: false, column: 'side', canBeWide: true },
];

export const DEFAULT_TO_BUY_LISTS = 3;
export const DEFAULT_RETENTION: RecentRetention = 'DAYS_3';

/** One card as the person has it: their choices where they made one, the registry's otherwise. */
export interface TodayCardSetting {
  readonly card: TodayCardDefinition;
  readonly visible: boolean;
  readonly size: TodayCardSize;
  readonly lists: number;
  readonly retention: RecentRetention;
}

export interface TodaySettings {
  readonly density: TodayDensity;
  /** Every card of the registry, in the person's order. */
  readonly cards: readonly TodayCardSetting[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const pick = <T extends string>(values: readonly T[], value: unknown, fallback: T): T => (typeof value === 'string' && (values as readonly string[]).includes(value) ? (value as T) : fallback);

const defaultSetting = (card: TodayCardDefinition): TodayCardSetting => ({ card, visible: card.defaultVisible, size: 'NORMAL', lists: DEFAULT_TO_BUY_LISTS, retention: DEFAULT_RETENTION });

/**
 * Reads a saved layout tolerantly (19.2): saved cards keep their position and choices; cards the registry
 * gained since are inserted at their registry position with their defaults; ids it no longer knows and
 * options that do not fit are ignored. Never throws — anything unreadable is the default layout.
 */
export function resolveTodayLayout(saved: unknown): TodaySettings {
  const byId = new Map(TODAY_CARDS.map((card) => [card.id, card]));
  const record = isRecord(saved) ? saved : {};
  const chosen: TodayCardSetting[] = [];
  for (const entry of Array.isArray(record.cards) ? record.cards : []) {
    if (!isRecord(entry) || typeof entry.id !== 'string') continue;
    const card = byId.get(entry.id as TodayCardId);
    if (card === undefined || chosen.some((each) => each.card.id === card.id)) continue;
    const options = isRecord(entry.options) ? entry.options : {};
    const lists = typeof options.lists === 'number' && Number.isInteger(options.lists) && options.lists >= TO_BUY_LISTS_MIN && options.lists <= TO_BUY_LISTS_MAX ? options.lists : DEFAULT_TO_BUY_LISTS;
    chosen.push({
      card,
      visible: typeof entry.visible === 'boolean' ? entry.visible : card.defaultVisible,
      size: card.canBeWide ? pick(TODAY_CARD_SIZES, entry.size, 'NORMAL') : 'NORMAL',
      lists,
      retention: pick(RECENT_RETENTIONS, options.retention, DEFAULT_RETENTION),
    });
  }
  // New cards go right after the registry card before them (or first), so a saved order is never shuffled.
  TODAY_CARDS.forEach((card, index) => {
    if (chosen.some((each) => each.card.id === card.id)) return;
    const before = TODAY_CARDS.slice(0, index).reverse().find((each) => chosen.some((setting) => setting.card.id === each.id));
    const at = before === undefined ? 0 : chosen.findIndex((setting) => setting.card.id === before.id) + 1;
    chosen.splice(at, 0, defaultSetting(card));
  });
  return { density: pick(TODAY_DENSITIES, record.density, 'COMPACT'), cards: chosen };
}

/** What is sent to the server: every card with the person's choices (options only where a card has some). */
export function layoutOf(settings: TodaySettings): TodayLayout {
  return {
    version: TODAY_LAYOUT_VERSION,
    density: settings.density,
    cards: settings.cards.map(({ card, visible, size, lists, retention }) => ({
      id: card.id,
      visible,
      size,
      options: card.id === 'toBuy' ? { lists } : card.id === 'recent' ? { retention } : {},
    })),
  };
}

/** Moves a card one place up (-1) or down (+1). */
export function moveCard(settings: TodaySettings, id: TodayCardId, by: -1 | 1): TodaySettings {
  const cards = [...settings.cards];
  const from = cards.findIndex((setting) => setting.card.id === id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= cards.length) return settings;
  [cards[from], cards[to]] = [cards[to] as TodayCardSetting, cards[from] as TodayCardSetting];
  return { ...settings, cards };
}

export function changeCard(settings: TodaySettings, id: TodayCardId, change: Partial<Omit<TodayCardSetting, 'card'>>): TodaySettings {
  return { ...settings, cards: settings.cards.map((setting) => (setting.card.id === id ? { ...setting, ...change } : setting)) };
}

/** The cards that may appear, in the person's order: switched on by them and needing a tool that is on. */
export function todayCards(tools: readonly string[], settings: TodaySettings = resolveTodayLayout(null)): TodayCardSetting[] {
  return settings.cards.filter((setting) => setting.visible && setting.card.anyOf.some((tool) => tools.includes(tool)));
}

/** Rows a card lists before "+N more". */
export const ATTENTION_ROWS = 5;
export const NEXT_UP_ROWS = 3;
export const NEXT_UP_DAYS = 7;
export const CALENDAR_ROWS = 5;

/** Next up: open Occurrences due after today and within a week of their Schedule's today, soonest first. */
export function nextUp(upcoming: readonly Occurrence[], now: Date = new Date()): Occurrence[] {
  return upcoming
    .filter((item) => item.state === 'OPEN' && item.dueDate <= addDays(todayIn(item.schedule.timeZone, now), NEXT_UP_DAYS))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || (a.time ?? '').localeCompare(b.time ?? ''))
    .slice(0, NEXT_UP_ROWS);
}

/** Calendar: the next open dates of the coming 90 days as a short agenda. */
export function agenda(upcoming: readonly Occurrence[]): Occurrence[] {
  return upcoming
    .filter((item) => item.state === 'OPEN')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || (a.time ?? '').localeCompare(b.time ?? ''))
    .slice(0, CALENDAR_ROWS);
}

/** Where the Recently completed window starts (T2), or `null` when the person switched it off. */
export function recentSince(retention: RecentRetention = DEFAULT_RETENTION, now: Date = new Date()): Date | null {
  const hours = (n: number) => new Date(now.getTime() - n * 60 * 60_000);
  switch (retention) {
    case 'TODAY':
      // Local midnight in the viewer's time zone (also on a day with a DST change).
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case 'HOURS_24':
      return hours(24);
    case 'DAYS_3':
      return hours(72);
    case 'DAYS_7':
      return hours(168);
    case 'OFF':
      return null;
  }
}
