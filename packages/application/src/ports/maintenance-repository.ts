import type { Actor, LinkId, MaintenanceContent, MaintenanceCost, MaintenanceCursor, MaintenanceLinkType, MaintenanceQuery, MaintenanceRecordId, MaintenanceStatus, WorkspaceId } from '@vergissmeinnicht/domain';
import type { ActorGuard } from './actor-guard.ts';
import type { LinkedRecord } from './link-repository.ts';

type UserActor = Actor & { readonly kind: 'user' };

/** The responsible Contact of a record. `name` is `null` for a Contact in Trash or deleted for good: "a deleted contact". */
export interface MaintenanceContactRef {
  readonly id: string;
  readonly name: string | null;
}

/** A MaintenanceRecord as a card of the board or a row of the List shows it. */
export interface MaintenanceSummary {
  readonly id: MaintenanceRecordId;
  readonly title: string;
  readonly category: string;
  readonly date: string | null;
  readonly status: MaintenanceStatus;
  /** Set exactly while the status is COMPLETED. */
  readonly completedOn: string | null;
  /** `null`: none set — or the Contacts tool is off, in which case nothing of Contacts is shown. */
  readonly contact: MaintenanceContactRef | null;
  readonly cost: MaintenanceCost | null;
  readonly revision: number;
}

export interface MaintenanceRecord extends MaintenanceSummary {
  readonly description: string;
  readonly createdAt: Date;
  readonly createdByName: string;
  readonly updatedAt: Date;
  readonly updatedByName: string;
}

/** One column of the board: the newest cards of a status and how many records have it in all. */
export interface MaintenanceColumn {
  readonly status: MaintenanceStatus;
  readonly total: number;
  readonly records: MaintenanceSummary[];
}

/** One row of Today's Maintenance due soon card (19.1): read-only, nothing of costs, Contacts or notes. */
export interface MaintenanceDueSoonItem {
  readonly id: MaintenanceRecordId;
  readonly title: string;
  readonly date: string;
  readonly status: 'PLANNED' | 'IN_PROGRESS';
  /** A linked Equipment's name — only with `equipment` in the request (tool on, `equipment.view`). */
  readonly equipment: string | null;
}

export interface MaintenanceListing {
  readonly records: MaintenanceSummary[];
  readonly next: MaintenanceCursor | null;
  /** Counted for the first page only. */
  readonly total: number | null;
}

/** What the List can be filtered by: only values that records of this Workspace have. */
export interface MaintenanceFilterValues {
  readonly categories: string[];
  readonly years: number[];
  readonly contacts: { readonly id: string; readonly name: string }[];
}

export interface TrashedMaintenanceRecord {
  readonly id: MaintenanceRecordId;
  readonly title: string;
  readonly status: MaintenanceStatus;
  readonly deletedAt: Date;
  readonly deletedByName: string;
}

export interface MaintenanceLink {
  readonly sourceType?: string;
  readonly id: LinkId;
  readonly record: LinkedRecord;
  readonly createdAt: Date;
  readonly createdByName: string;
}

/** What of other optional tools may appear with Maintenance: nothing of a tool that is switched off. */
export interface MaintenanceScope {
  readonly contacts: boolean;
  readonly documents: boolean;
}

export type MaintenanceRefusal = 'forbidden' | 'tool_disabled' | 'record_not_found' | 'conflict' | 'limit_reached' | 'contact_not_found' | 'target_not_found' | 'link_not_found' | 'already_linked' | 'status_unchanged';
export type MaintenanceWrite<T = unknown> = ({ readonly status: 'ok' } & T) | { readonly status: MaintenanceRefusal };

/**
 * MaintenanceRecords of a Workspace (16.7). Every method is scoped by the Workspace. Writes run in one
 * IMMEDIATE transaction that re-checks the actor and the tool switch and records the audit event.
 * Nothing here reads or writes a Run, an Occurrence or a Schedule beyond naming one as the other end
 * of a Link.
 */
export interface MaintenanceRepository {
  board(workspaceId: WorkspaceId, scope: MaintenanceScope, perColumn: number): Promise<MaintenanceColumn[]>;
  find(workspaceId: WorkspaceId, query: MaintenanceQuery, after: MaintenanceCursor | null, limit: number, scope: MaintenanceScope): Promise<MaintenanceListing>;
  filterValues(workspaceId: WorkspaceId, scope: MaintenanceScope): Promise<MaintenanceFilterValues>;
  /**
   * What Today's Maintenance due soon card shows: Planned or In progress with a date from `today` up to `until`,
   * and Planned ones whose date has passed; soonest first, at most `limit`, with the total.
   */
  dueSoon(workspaceId: WorkspaceId, window: { readonly today: string; readonly until: string; readonly limit: number; readonly equipment: boolean }): Promise<{ readonly items: MaintenanceDueSoonItem[]; readonly total: number }>;
  /** A record that is not in Trash. */
  get(workspaceId: WorkspaceId, recordId: MaintenanceRecordId, scope: MaintenanceScope): Promise<MaintenanceRecord | undefined>;
  create(input: { readonly workspaceId: WorkspaceId; readonly content: MaintenanceContent; readonly at: Date; readonly scope: MaintenanceScope }, actor: UserActor, guard: ActorGuard): Promise<MaintenanceWrite<{ record: MaintenanceRecord }>>;
  /** With the Contacts tool off (`scope.contacts` false) the responsible Contact stays as it is, whatever the input says. */
  update(
    input: { readonly workspaceId: WorkspaceId; readonly recordId: MaintenanceRecordId; readonly content: MaintenanceContent; readonly expectedRevision: number; readonly at: Date; readonly scope: MaintenanceScope },
    actor: UserActor,
    guard: ActorGuard,
  ): Promise<MaintenanceWrite<{ record: MaintenanceRecord }>>;
  /** Sets the status. Refused when the record changed meanwhile (`conflict`) or already has that status. */
  setStatus(
    input: { readonly workspaceId: WorkspaceId; readonly recordId: MaintenanceRecordId; readonly to: MaintenanceStatus; readonly expectedRevision: number; readonly completedOn: string | null; readonly today: string; readonly at: Date; readonly scope: MaintenanceScope },
    actor: UserActor,
    guard: ActorGuard,
  ): Promise<MaintenanceWrite<{ record: MaintenanceRecord }>>;
  delete(input: { readonly workspaceId: WorkspaceId; readonly recordId: MaintenanceRecordId; readonly at: Date }, actor: UserActor, guard: ActorGuard): Promise<MaintenanceWrite>;
  restore(input: { readonly workspaceId: WorkspaceId; readonly recordId: MaintenanceRecordId; readonly at: Date; readonly scope: MaintenanceScope }, actor: UserActor, guard: ActorGuard): Promise<MaintenanceWrite<{ record: MaintenanceRecord }>>;
  listTrash(workspaceId: WorkspaceId): Promise<TrashedMaintenanceRecord[]>;
  purge(input: { readonly workspaceId: WorkspaceId; readonly recordIds: readonly MaintenanceRecordId[] | 'all'; readonly at: Date }, actor: UserActor, guard: ActorGuard): Promise<MaintenanceWrite<{ purged: number }>>;

  /** What a record is linked to. `undefined` = no such record. Links to Documents only with `scope.documents`. */
  links(workspaceId: WorkspaceId, recordId: MaintenanceRecordId, scope: MaintenanceScope): Promise<MaintenanceLink[] | undefined>;
  addLink(input: { readonly workspaceId: WorkspaceId; readonly recordId: MaintenanceRecordId; readonly target: { readonly type: MaintenanceLinkType; readonly id: string }; readonly at: Date; readonly scope: MaintenanceScope }, actor: UserActor, guard: ActorGuard): Promise<MaintenanceWrite<{ link: MaintenanceLink }>>;
  /** Removes a Link of a MaintenanceRecord (never either record). */
  removeLink(input: { readonly workspaceId: WorkspaceId; readonly linkId: LinkId; readonly at: Date }, actor: UserActor, guard: ActorGuard): Promise<MaintenanceWrite>;
}
