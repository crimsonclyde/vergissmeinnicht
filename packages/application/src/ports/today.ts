import type { UserId, WorkspaceId } from '@vergissmeinnicht/domain';
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
  readonly recentlyCompleted: readonly { readonly type: 'run' | 'occurrence'; readonly id: string; readonly scheduleId: string | null; readonly title: string; readonly completedAt: Date }[];
}
export interface TodayRepository {
  read(input: { readonly workspaceId: WorkspaceId; readonly userId: UserId; readonly filter: TodayFilter; readonly now: Date }): Promise<TodayProgress>;
}
