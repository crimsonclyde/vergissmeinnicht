import type { Actor, CalendarFeed, CalendarFeedScope, WorkspaceId } from '@vergissmeinnicht/domain';
import type { ActorGuard } from './actor-guard.ts';

/**
 * Calendar subscription links (39): one per person and Workspace, addressed by both for management and by the
 * token's SHA-256 only when a calendar app fetches it. Writes re-check the guard in their transaction and record
 * CALENDAR_FEED_CHANGED (never the token or its hash).
 */
export interface CalendarFeedRepository {
  find(userId: string, workspaceId: WorkspaceId): Promise<CalendarFeed | undefined>;
  /** Creates the link or replaces its token (the old one stops working at once). `forbidden` when the guard refuses. */
  save(
    input: { readonly workspaceId: WorkspaceId; readonly tokenHash: string; readonly scope: CalendarFeedScope; readonly at: Date },
    actor: Actor & { readonly kind: 'user' },
    guard: ActorGuard,
  ): Promise<{ readonly status: 'ok'; readonly feed: CalendarFeed } | { readonly status: 'forbidden' }>;
  setScope(
    input: { readonly workspaceId: WorkspaceId; readonly scope: CalendarFeedScope; readonly at: Date },
    actor: Actor & { readonly kind: 'user' },
    guard: ActorGuard,
  ): Promise<{ readonly status: 'ok'; readonly feed: CalendarFeed } | { readonly status: 'forbidden' | 'not_found' }>;
  remove(input: { readonly workspaceId: WorkspaceId; readonly at: Date }, actor: Actor & { readonly kind: 'user' }): Promise<'ok' | 'not_found'>;
  findByTokenHash(tokenHash: string): Promise<CalendarFeed | undefined>;
  /** Records a fetch, at most once per `minIntervalMs`. */
  touch(tokenHash: string, at: Date, minIntervalMs: number): Promise<void>;
}
