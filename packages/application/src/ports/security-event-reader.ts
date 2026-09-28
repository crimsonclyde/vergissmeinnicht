import type { SecurityEventType, UserId } from '@vergissmeinnicht/domain';
import type { Page } from './paging.ts';

/** One security event as shown to server admins. */
export interface SecurityEventEntry {
  readonly id: string;
  readonly type: SecurityEventType;
  readonly occurredAt: Date;
  /** Display-name snapshot of the acting user, or the system channel (e.g. `cli:admin-recover`, `anonymous`). */
  readonly actorLabel: string;
  readonly subjectType: string;
  readonly subjectId: string;
  /** Current email of the subject when the subject is a user account that still exists. */
  readonly subjectEmail: string | null;
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
}

/** Read-only access to the append-only `security_events` table. */
export interface SecurityEventReader {
  /**
   * Newest first. `before` is the id of the last event of the previous page (else
   * `InvalidCursorError`); `subjectUserId` limits the list to events about one account.
   */
  list(filter: { readonly limit: number; readonly before?: string | undefined; readonly subjectUserId?: UserId | undefined }): Promise<
    Page<SecurityEventEntry>
  >;
}
