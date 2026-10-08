import type { UserId } from '@vergissmeinnicht/domain';

/** The stored Today layout of one person (19.2), as saved — possibly by an earlier version. */
export interface StoredTodayLayout {
  readonly layout: unknown;
  readonly version: number;
  readonly updatedAt: Date;
}

export interface TodayLayoutRepository {
  find(userId: UserId): Promise<StoredTodayLayout | undefined>;
  /** `layout` is already validated; it is stored as JSON. */
  save(userId: UserId, layout: object, version: number, at: Date): Promise<void>;
  /** Back to the defaults. */
  remove(userId: UserId): Promise<void>;
}
