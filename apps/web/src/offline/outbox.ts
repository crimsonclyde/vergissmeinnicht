import type { JournalContent } from '@vergissmeinnicht/domain';
import { ApiError, type JournalView } from '../api.ts';
import type { RefusedReason } from './list-queue.ts';

/**
 * Notes and Reminder changes made without a connection (48.5), kept on this device until the server
 * has answered them. They are sent strictly in order, under the session of the account that made them,
 * and the server decides with today's permissions. Nothing is ever forced over someone else's work:
 *
 * - a new Note carries the id this device chose for it, so sending it twice creates it once;
 * - a changed Note carries the revision it was changed from; if someone saved a newer version
 *   meanwhile, this device's text is saved as a new Note ("offline copy") instead — nothing is lost;
 * - "Done" on a Reminder applies only while it is still open; otherwise it is dropped and explained.
 */
export type OutboxChange =
  | {
      readonly kind: 'note';
      /** The Workspace of shared Notes; null for the personal Journal. */
      readonly workspaceId: string | null;
      readonly entryId: string;
      /** True while the Note exists only on this device. */
      readonly isNew: boolean;
      /** The revision this device changed it from (0 for a new Note). */
      readonly expectedRevision: number;
      readonly content: JournalContent;
      readonly archived: boolean;
    }
  | { readonly kind: 'completeOccurrence'; readonly workspaceId: string; readonly occurrenceId: string };

export interface QueuedOutboxChange {
  readonly clientChangeId: string;
  /** Only ever sent with this account's session. */
  readonly userId: string;
  readonly change: OutboxChange;
  /** The Note's or Reminder's title, for notices. */
  readonly label: string;
  readonly deviceTime: string;
  /** Order of creation; sent strictly in this order. */
  readonly seq: number;
  /** Refused because access or the tool is gone: kept with the reason, never sent again, until discarded. */
  readonly refused?: RefusedReason | undefined;
}

export const pendingOutbox = (queued: readonly QueuedOutboxChange[]) => queued.filter((entry) => entry.refused === undefined);

/**
 * The entries to store for a new change. A Note changed again before it was sent keeps one entry: the
 * newest text, the first revision (it was changed from that one) and its place in the order.
 */
export function withChange(queued: readonly QueuedOutboxChange[], next: QueuedOutboxChange): QueuedOutboxChange {
  if (next.change.kind !== 'note') return next;
  const entryId = next.change.entryId;
  const earlier = pendingOutbox(queued).find((entry) => entry.change.kind === 'note' && entry.change.entryId === entryId);
  if (earlier === undefined || earlier.change.kind !== 'note') return next;
  return { ...earlier, label: next.label, change: { ...next.change, isNew: earlier.change.isNew, expectedRevision: earlier.change.expectedRevision } };
}

/** The Note as this device shows it while its change is not sent yet. */
export function noteView(change: Extract<OutboxChange, { kind: 'note' }>, base: JournalView | null, deviceTime: string, me: string): JournalView {
  const content = change.content;
  return {
    ...(base ?? { createdAt: deviceTime, createdBy: me, revision: 0 }),
    ...content,
    id: change.entryId,
    revision: base?.revision ?? change.expectedRevision,
    archived: change.archived,
    updatedAt: deviceTime,
    updatedBy: me,
  } as JournalView;
}

/**
 * The Notes list as this device shows it: saved Notes with this device's unsent changes applied, and
 * new Notes first. Only changes of the same place (Workspace Notes or personal Journal) count.
 */
export function withQueuedNotes(entries: readonly JournalView[], queued: readonly QueuedOutboxChange[], workspaceId: string | null, archived: boolean, me: string): JournalView[] {
  const mine = pendingOutbox(queued).filter((entry): entry is QueuedOutboxChange & { change: Extract<OutboxChange, { kind: 'note' }> } => entry.change.kind === 'note' && entry.change.workspaceId === workspaceId);
  const byId = new Map(mine.map((entry) => [entry.change.entryId, entry]));
  const shown = entries.map((entry) => {
    const waiting = byId.get(entry.id);
    return waiting === undefined ? entry : noteView(waiting.change, entry, waiting.deviceTime, me);
  });
  const known = new Set(entries.map((entry) => entry.id));
  const added = mine.filter((entry) => entry.change.isNew && !known.has(entry.change.entryId)).map((entry) => noteView(entry.change, null, entry.deviceTime, me));
  return [...added, ...shown].filter((entry) => entry.archived === archived);
}

/** Ids of Notes and Reminders with a change on this device that is not sent yet. */
export function waitingOutboxIds(queued: readonly QueuedOutboxChange[]): Set<string> {
  return new Set(pendingOutbox(queued).map((entry) => (entry.change.kind === 'note' ? entry.change.entryId : entry.change.occurrenceId)));
}

/**
 * What to do after sending one change:
 * - `sent`: answered and applied — remove it;
 * - `conflict`: someone else changed it meanwhile — a Note is saved as a copy, a Reminder is explained;
 * - `drop`: refused for good because of the change itself — remove it and say why;
 * - `refused`: access or the tool is gone — keep it with the reason, never send it again;
 * - `sign-in`: the session is gone or belongs to someone else — keep everything;
 * - `retry`: unreachable, rate-limited or a server error — keep everything and try later.
 */
export type OutboxOutcome = 'sent' | 'conflict' | 'drop' | 'refused' | 'sign-in' | 'retry';

export function outboxOutcome(error: unknown): OutboxOutcome {
  if (error === undefined) return 'sent';
  if (!(error instanceof ApiError)) return 'retry';
  if (error.status === 401) return 'sign-in';
  if (error.status === 429 || error.status >= 500) return 'retry';
  if (outboxRefusal(error) !== undefined) return 'refused';
  if (error.code === 'journal_conflict' || error.code === 'journal_not_found' || error.code === 'schedule_closed') return 'conflict';
  return 'drop';
}

export function outboxRefusal(error: unknown): RefusedReason | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (error.code === 'tool_not_enabled') return 'tool_disabled';
  if (error.code === 'workspace_not_found') return 'not_member';
  if (error.status === 403) return 'forbidden';
  return undefined;
}

/** True when the saved Note already holds exactly this device's text (an earlier answer was lost). */
export function sameNote(saved: JournalView, change: Extract<OutboxChange, { kind: 'note' }>): boolean {
  const a = change.content;
  return saved.title === a.title && saved.body === a.body && (saved.date ?? null) === (a.date ?? null) && (saved.collection ?? '') === (a.collection ?? '') && JSON.stringify(saved.tags ?? []) === JSON.stringify(a.tags ?? []) && (saved.pinned ?? false) === (a.pinned ?? false) && saved.archived === change.archived;
}
