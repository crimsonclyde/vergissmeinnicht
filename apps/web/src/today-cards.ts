import type { Occurrence } from './api.ts';
import { addDays, todayIn } from './schedule-dates.ts';

/**
 * Today's cards (19.1). The registry is the one place that knows which cards exist, which Workspace tool
 * each needs, whether it is on without a personal choice, and where it goes. A card is shown only when
 * the person has it on, its tool is on in the Workspace and it has something to show — the last part is
 * decided by the card itself when it renders.
 */
export type TodayCardId = 'attention' | 'continue' | 'next' | 'toBuy' | 'maintenance' | 'recent' | 'progress';

export interface TodayCardDefinition {
  readonly id: TodayCardId;
  /** Shown only while at least one of these tools is on. */
  readonly anyOf: readonly string[];
  readonly defaultVisible: boolean;
  /** Desktop: the main column for what to act on, the narrower side column for the rest. */
  readonly column: 'main' | 'side';
}

/** In default order. Later versions add cards here; a saved layout (19.2) only overrides choices. */
export const TODAY_CARDS: readonly TodayCardDefinition[] = [
  { id: 'attention', anyOf: ['REMINDERS', 'PROCEDURES'], defaultVisible: true, column: 'main' },
  { id: 'continue', anyOf: ['PROCEDURES'], defaultVisible: true, column: 'main' },
  { id: 'next', anyOf: ['REMINDERS', 'PROCEDURES'], defaultVisible: true, column: 'main' },
  { id: 'toBuy', anyOf: ['LISTS'], defaultVisible: true, column: 'side' },
  { id: 'maintenance', anyOf: ['MAINTENANCE'], defaultVisible: true, column: 'side' },
  { id: 'recent', anyOf: ['REMINDERS', 'PROCEDURES'], defaultVisible: true, column: 'side' },
  { id: 'progress', anyOf: ['REMINDERS', 'PROCEDURES'], defaultVisible: false, column: 'side' },
];

/** The cards that may appear, in order: switched on for the person and needing a tool that is on. */
export function todayCards(tools: readonly string[], visible: (card: TodayCardDefinition) => boolean = (card) => card.defaultVisible): TodayCardDefinition[] {
  return TODAY_CARDS.filter((card) => visible(card) && card.anyOf.some((tool) => tools.includes(tool)));
}

/** Rows a card lists before "+N more". */
export const ATTENTION_ROWS = 5;
export const NEXT_UP_ROWS = 3;
export const NEXT_UP_DAYS = 7;
export const TO_BUY_LISTS = 3;

/** Next up: open Occurrences due after today and within a week of their Schedule's today, soonest first. */
export function nextUp(upcoming: readonly Occurrence[], now: Date = new Date()): Occurrence[] {
  return upcoming
    .filter((item) => item.state === 'OPEN' && item.dueDate <= addDays(todayIn(item.schedule.timeZone, now), NEXT_UP_DAYS))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || (a.time ?? '').localeCompare(b.time ?? ''))
    .slice(0, NEXT_UP_ROWS);
}

/** Where the Recently completed window starts: 3 days back unless the person chose otherwise (19.2). */
export function recentSince(now: Date = new Date()): Date {
  return new Date(now.getTime() - 3 * 24 * 60 * 60_000);
}
