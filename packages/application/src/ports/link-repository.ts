import type { Actor, DocumentId, LinkId, LinkTarget, LinkTargetType, RunDocumentId, RunDocumentRemovalId, WorkspaceId } from '@vergissmeinnicht/domain';
import type { ActorGuard } from './actor-guard.ts';
import type { DocumentFileRecord } from './document-files.ts';
import type { DocumentTypeView } from './document-repository.ts';

type UserActor = Actor & { readonly kind: 'user' };

/** Where a linked record stands today. `gone`: deleted for good — only that, when and by whom is still known. */
export type LinkedState = 'ok' | 'deleted' | 'trash' | 'paused' | 'ended' | 'gone';

/** The other end of a Link, as far as it may be shown: a title and a state — never content. */
export interface LinkedRecord {
  /** A Run and a MaintenanceRecord can be the other end of a Link as well (16.7); a Document links to neither by itself. */
  readonly type: LinkTargetType | 'run' | 'maintenance';
  readonly id: string;
  /** `null` when the record is gone. */
  readonly title: string | null;
  readonly state: LinkedState;
  /** A Schedule: a Reminder or a scheduled Procedure. */
  readonly scheduleKind?: 'REMINDER' | 'PROCEDURE' | undefined;
  /** A Run: whether it is still going — shown as a fact, never used to change anything. */
  readonly runState?: 'ACTIVE' | 'COMPLETED' | 'ABORTED' | undefined;
  /** A Schedule: the next open due date, if any. */
  readonly nextDue?: string | null | undefined;
  /** When and by whom the record was moved to Trash or deleted for good. */
  readonly goneAt?: Date | null | undefined;
  readonly goneByName?: string | null | undefined;
}

export interface LinkView {
  readonly id: LinkId;
  readonly record: LinkedRecord;
  readonly createdAt: Date;
  readonly createdByName: string;
}

/** A Run that retains a version of the Document. */
export interface RunLinkView {
  readonly id: RunDocumentId;
  readonly runId: string;
  readonly runTitle: string;
  readonly runState: 'ACTIVE' | 'COMPLETED' | 'ABORTED';
  readonly linkedAt: Date;
  readonly linkedByName: string;
  /** The Document was edited since: the Run shows the version of then. */
  readonly changedSince: boolean;
}

/** How the Document a retained version came from stands today. */
export type RunDocumentSource = 'same' | 'changed' | 'trash' | 'gone';

/** A Document version retained for a Run: what the Document was when it was linked, with its files of then. */
export interface RunDocumentView {
  readonly id: RunDocumentId;
  readonly sourceDocumentId: DocumentId;
  readonly source: RunDocumentSource;
  readonly title: string;
  readonly type: DocumentTypeView | null;
  readonly documentDate: string | null;
  readonly year: number | null;
  readonly notes: string;
  readonly tags: readonly string[];
  readonly files: readonly DocumentFileRecord[];
  readonly linkedAt: Date;
  readonly linkedByName: string;
}

/**
 * The permanent note of a Document version removed from a finished Run (P4): who removed it, when and
 * why, and when it had been linked — nothing of the document itself.
 */
export interface RunDocumentRemoval {
  readonly id: RunDocumentRemovalId;
  readonly reason: string;
  readonly files: number;
  readonly linkedAt: Date;
  readonly linkedByName: string;
  readonly removedAt: Date;
  readonly removedByName: string;
}

export type LinkRefusal = 'forbidden' | 'tool_disabled' | 'document_not_found' | 'target_not_found' | 'run_not_found' | 'link_not_found' | 'already_linked' | 'limit_reached' | 'run_finished' | 'run_active';
export type LinkWrite<T> = ({ readonly status: 'ok' } & T) | { readonly status: LinkRefusal };

/**
 * Links between records of one Workspace (16.5). Every method is scoped by the Workspace id — an id
 * of another Workspace is "not found" — and every write re-checks the actor and the Documents tool in
 * its IMMEDIATE transaction and records an audit event. A Link is a reference: nothing is copied, and
 * nothing here grants access to either end.
 */
export interface LinkRepository {
  linkToolsEnabled(workspaceId: WorkspaceId, linkId: LinkId): Promise<boolean>;
  targetToolEnabled(workspaceId: WorkspaceId, target: LinkTarget): Promise<boolean>;
  /** What a Document (not in Trash) is linked to, and the Runs that retain a version of it. `undefined` = no such Document. */
  listForDocument(workspaceId: WorkspaceId, documentId: DocumentId): Promise<{ readonly links: LinkView[]; readonly runs: RunLinkView[] } | undefined>;
  /** The Documents linked to a Procedure or a Schedule — as `LinkView`s whose record is the Document. */
  listForTarget(workspaceId: WorkspaceId, target: LinkTarget): Promise<LinkView[]>;
  add(input: { readonly workspaceId: WorkspaceId; readonly documentId: DocumentId; readonly target: LinkTarget; readonly at: Date }, actor: UserActor, guard: ActorGuard): Promise<LinkWrite<{ link: LinkView }>>;
  remove(input: { readonly workspaceId: WorkspaceId; readonly linkId: LinkId; readonly at: Date }, actor: UserActor, guard: ActorGuard): Promise<LinkWrite<object>>;

  /** The Document versions a Run retains, and the notes of versions removed from it. `undefined` = no such Run. */
  listForRun(workspaceId: WorkspaceId, runId: string): Promise<{ readonly documents: RunDocumentView[]; readonly removals: RunDocumentRemoval[] } | undefined>;
  /** Retains the Document as it is now — details and files — for the Run (ACTIVE or finished). */
  linkRun(input: { readonly workspaceId: WorkspaceId; readonly runId: string; readonly documentId: DocumentId; readonly at: Date }, actor: UserActor, guard: ActorGuard): Promise<LinkWrite<{ document: RunDocumentView }>>;
  /**
   * Removes a retained version from a **finished** Run (P4), in one transaction: writes the permanent
   * note and the audit event, removes the version, and removes the rows of its files that nothing else
   * references (no Document page, no other Run) — those files are then unreachable at once and no
   * longer counted; the bytes are deleted by housekeeping. Files still referenced elsewhere stay.
   * Refused (`run_active`) while the Run is ACTIVE: then the ordinary removal applies.
   */
  removeFromFinishedRun(
    input: { readonly workspaceId: WorkspaceId; readonly runId: string; readonly runDocumentId: RunDocumentId; readonly reason: string; readonly at: Date },
    actor: UserActor,
    guard: ActorGuard,
  ): Promise<LinkWrite<{ removal: RunDocumentRemoval; releasedFiles: number }>>;
  /** Removes a retained version — only while the Run is ACTIVE. */
  unlinkRun(input: { readonly workspaceId: WorkspaceId; readonly runId: string; readonly runDocumentId: RunDocumentId; readonly at: Date }, actor: UserActor, guard: ActorGuard): Promise<LinkWrite<object>>;
}
