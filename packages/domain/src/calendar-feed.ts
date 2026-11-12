import type { WorkspaceId } from './workspace.ts';

/**
 * A person's calendar subscription (39): a private link that Apple Calendar, Google Calendar and other
 * calendar apps poll for the person's view of one Workspace's calendar. `MINE`: only what the person is
 * responsible for (and shared entries without anyone responsible are left out); `ALL`: everything the
 * person may see in the calendar.
 */
export const CALENDAR_FEED_SCOPES = ['MINE', 'ALL'] as const;
export type CalendarFeedScope = (typeof CALENDAR_FEED_SCOPES)[number];

export interface CalendarFeed {
  readonly userId: string;
  readonly workspaceId: WorkspaceId;
  readonly scope: CalendarFeedScope;
  readonly createdAt: Date;
  /** When a calendar app last fetched the link (updated at most every few minutes); `null` if never. */
  readonly lastUsedAt: Date | null;
}

/** Days before today that a feed includes (recent history, so completed entries stay visible for a while). */
export const CALENDAR_FEED_PAST_DAYS = 31;
/** Days after today that a feed includes. */
export const CALENDAR_FEED_FUTURE_DAYS = 183;
/** `last_used_at` is written at most this often per feed, so polling does not turn every fetch into a write. */
export const CALENDAR_FEED_TOUCH_MS = 5 * 60_000;
