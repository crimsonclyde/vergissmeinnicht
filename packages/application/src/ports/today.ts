import type { UserId, WorkspaceId } from '@vergissmeinnicht/domain';
/** Recently completed entries Today shows at most (19.1). */
export const RECENTLY_COMPLETED_LIMIT = 5;
/** The longest Recently completed window a person may choose (7 days), plus a day for local midnight. */
export const RECENTLY_COMPLETED_MAX_MS = 8 * 24 * 60 * 60_000;
/** Without a choice: the last 3 days (owner, T2). */
export const RECENTLY_COMPLETED_DEFAULT_MS = 3 * 24 * 60 * 60_000;
export type TodayFilter = 'ALL' | 'MINE' | 'SHARED';
export interface TodayProgress {
  readonly filter: TodayFilter;
  readonly weekFrom: string;
  readonly weekTo: string;
  /** Occurrences use their Schedule's zone; Runs use Monday–Sunday UTC. Null means unavailable. */
  readonly completedOccurrencesToday: number | null;
  readonly completedRunsThisWeek: number | null;
  readonly activeRuns: number | null;
  readonly dueToday: number | null;
  /** Completed since the viewer's chosen window start (19.2; default 3 days), newest first, at most `RECENTLY_COMPLETED_LIMIT`. */
  readonly recentlyCompleted: readonly { readonly type: 'run' | 'occurrence'; readonly id: string; readonly scheduleId: string | null; readonly title: string; readonly completedAt: Date }[];
}
export interface TodayRepository {
  read(input: { readonly workspaceId: WorkspaceId; readonly userId: UserId; readonly filter: TodayFilter; readonly now: Date; readonly recentSince: Date }): Promise<TodayProgress>;
}
