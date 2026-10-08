import {
  DomainValidationError,
  MAINTENANCE_BOARD_COLUMN_SIZE,
  MAINTENANCE_PAGE_SIZE,
  MAX_MAINTENANCE_RECORDS_PER_PURGE,
  normalizeMaintenanceContent,
  parseDocumentDate,
  parseLinkId,
  parseMaintenanceCursor,
  parseMaintenanceLinkTarget,
  parseMaintenanceQuery,
  parseMaintenanceRecordId,
  parseMaintenanceStatus,
  type MaintenanceCursor,
  type MaintenanceInput,
  type User,
  type WorkspaceId,
} from '@vergissmeinnicht/domain';
import { roleHasCapability, type WorkspaceCapability } from '@vergissmeinnicht/permissions';
import { ContactNotFoundError } from '../contacts/errors.ts';
import { ToolNotEnabledError } from '../documents/errors.ts';
import { authorizeTool } from '../documents/tools.ts';
import { NotAuthorizedError } from '../invitations/errors.ts';
import { AlreadyLinkedError, LinkNotFoundError, LinkTargetNotFoundError } from '../links/use-cases.ts';
import type { ActorGuard } from '../ports/actor-guard.ts';
import type { Clock } from '../ports/clock.ts';
import type { WorkspaceToolRepository } from '../ports/document-repository.ts';
import type {
  MaintenanceColumn,
  MaintenanceDueSoonItem,
  MaintenanceFilterValues,
  MaintenanceLink,
  MaintenanceListing,
  MaintenanceRecord,
  MaintenanceRefusal,
  MaintenanceRepository,
  MaintenanceScope,
  MaintenanceWrite,
  TrashedMaintenanceRecord,
} from '../ports/maintenance-repository.ts';
import { InvalidCursorError } from '../ports/paging.ts';
import type { WorkspaceRepository } from '../ports/workspace-repository.ts';
import { userActor } from '../user-actor.ts';
import { authorizeWorkspace } from '../workspaces/use-cases.ts';

/** Unknown MaintenanceRecord, one of another Workspace, or one in Trash. */
export class MaintenanceRecordNotFoundError extends Error {
  constructor() {
    super('Maintenance record not found');
    this.name = 'MaintenanceRecordNotFoundError';
  }
}

/** The record was changed by someone else meanwhile: the current state must be looked at first. */
export class MaintenanceConflictError extends Error {
  constructor() {
    super('The maintenance record was changed meanwhile');
    this.name = 'MaintenanceConflictError';
  }
}

export class MaintenanceLimitReachedError extends Error {
  constructor() {
    super('Maintenance limit reached');
    this.name = 'MaintenanceLimitReachedError';
  }
}

/** The record already has the status asked for. */
export class MaintenanceStatusUnchangedError extends Error {
  constructor() {
    super('The record already has this status');
    this.name = 'MaintenanceStatusUnchangedError';
  }
}

export interface MaintenanceDeps {
  readonly workspaces: WorkspaceRepository;
  readonly tools: WorkspaceToolRepository;
  readonly maintenance: MaintenanceRepository;
  readonly clock: Clock;
}

interface Ref {
  readonly actor: User;
  readonly workspaceId: WorkspaceId;
}

/** Re-checked inside every write transaction (concurrent demotion, removal or disabling). */
const manage: ActorGuard = { actorMay: (role) => roleHasCapability(role, 'maintenance.manage') };
const purger: ActorGuard = { actorMay: (role) => roleHasCapability(role, 'maintenance.purge') };

function refuse(status: MaintenanceRefusal): never {
  switch (status) {
    case 'forbidden':
      throw new NotAuthorizedError();
    case 'tool_disabled':
      throw new ToolNotEnabledError();
    case 'record_not_found':
      throw new MaintenanceRecordNotFoundError();
    case 'conflict':
      throw new MaintenanceConflictError();
    case 'limit_reached':
      throw new MaintenanceLimitReachedError();
    case 'contact_not_found':
      throw new ContactNotFoundError();
    case 'target_not_found':
      throw new LinkTargetNotFoundError();
    case 'link_not_found':
      throw new LinkNotFoundError();
    case 'already_linked':
      throw new AlreadyLinkedError();
    case 'status_unchanged':
      throw new MaintenanceStatusUnchangedError();
  }
}

function ok<T>(result: MaintenanceWrite<T>): { readonly status: 'ok' } & T {
  if (result.status !== 'ok') refuse(result.status);
  return result;
}

/**
 * The gate of every Maintenance route, and what of the other optional tools the viewer gets to see
 * with it. Maintenance has its own capabilities: being able to read Documents or Contacts grants
 * nothing here, and the other way round — a Contact's name or a linked Document appears only where
 * that tool is switched on **and** the viewer has its view capability.
 */
async function enter(deps: MaintenanceDeps, input: Ref, capability: WorkspaceCapability): Promise<MaintenanceScope> {
  await authorizeTool(deps, input.actor, input.workspaceId, 'MAINTENANCE', capability);
  const membership = await authorizeWorkspace(deps, input.actor, input.workspaceId, 'workspace.view');
  const on = await deps.tools.enabled(input.workspaceId);
  return {
    contacts: on.includes('CONTACTS') && roleHasCapability(membership.role, 'contact.view'),
    documents: on.includes('DOCUMENTS') && roleHasCapability(membership.role, 'document.view'),
  };
}

/** The board: one column per status with its newest cards and its total (`maintenance.view`: every role, guests included — P3). */
export async function maintenanceBoard(deps: MaintenanceDeps, input: Ref): Promise<MaintenanceColumn[]> {
  const scope = await enter(deps, input, 'maintenance.view');
  return deps.maintenance.board(input.workspaceId, scope, MAINTENANCE_BOARD_COLUMN_SIZE);
}

/** One page of the List, newest first, searched and filtered by status, category, responsible Contact and year. Never anything in Trash. */
export async function findMaintenance(
  deps: MaintenanceDeps,
  input: Ref & { readonly query: { readonly q?: string | undefined; readonly status?: string | undefined; readonly category?: string | undefined; readonly contact?: string | undefined; readonly year?: number | undefined; readonly equipment?: string | undefined }; readonly cursor?: unknown },
): Promise<MaintenanceListing> {
  const scope = await enter(deps, input, 'maintenance.view');
  const query = parseMaintenanceQuery(input.query);
  if (query.equipmentId !== null) await authorizeTool(deps,input.actor,input.workspaceId,'EQUIPMENT','equipment.view');
  // A filter by Contact exists only where Contacts are shown.
  if (query.contactId !== null && !scope.contacts) throw new ToolNotEnabledError();
  let after: MaintenanceCursor | null = null;
  if (input.cursor !== undefined && input.cursor !== null) {
    const parsed = parseMaintenanceCursor(input.cursor);
    if (parsed === undefined) throw new InvalidCursorError();
    after = parsed;
  }
  return deps.maintenance.find(input.workspaceId, query, after, MAINTENANCE_PAGE_SIZE, scope);
}

/** How far ahead Today's Maintenance due soon card looks, and how many rows it shows (19.1, T5). */
export const MAINTENANCE_DUE_SOON_DAYS = 14;
export const MAINTENANCE_DUE_SOON_LIMIT = 3;

/**
 * Today's Maintenance due soon card (`maintenance.view`: every role, P3). `today` is the viewer's local
 * date; it must lie within a day of the server's UTC date (every time zone does).
 */
export async function maintenanceDueSoon(deps: MaintenanceDeps, input: Ref & { readonly today: string }): Promise<{ readonly items: MaintenanceDueSoonItem[]; readonly total: number }> {
  await enter(deps, input, 'maintenance.view');
  const today = parseDocumentDate(input.today);
  const serverToday = deps.clock.now().toISOString().slice(0, 10);
  if (Math.abs(Date.parse(`${today}T00:00:00Z`) - Date.parse(`${serverToday}T00:00:00Z`)) > 86_400_000) throw new DomainValidationError('today', 'out_of_range', 'The date must be within a day of the server date');
  const until = new Date(Date.parse(`${today}T00:00:00Z`) + MAINTENANCE_DUE_SOON_DAYS * 86_400_000).toISOString().slice(0, 10);
  const on = await deps.tools.enabled(input.workspaceId);
  const membership = await authorizeWorkspace(deps, input.actor, input.workspaceId, 'workspace.view');
  const equipment = on.includes('EQUIPMENT') && roleHasCapability(membership.role, 'equipment.view');
  return deps.maintenance.dueSoon(input.workspaceId, { today, until, limit: MAINTENANCE_DUE_SOON_LIMIT, equipment });
}

export async function maintenanceFilterValues(deps: MaintenanceDeps, input: Ref): Promise<MaintenanceFilterValues> {
  const scope = await enter(deps, input, 'maintenance.view');
  return deps.maintenance.filterValues(input.workspaceId, scope);
}

export async function getMaintenanceRecord(deps: MaintenanceDeps, input: Ref & { readonly recordId: string }): Promise<MaintenanceRecord> {
  const scope = await enter(deps, input, 'maintenance.view');
  const record = await deps.maintenance.get(input.workspaceId, parseMaintenanceRecordId(input.recordId), scope);
  if (record === undefined) throw new MaintenanceRecordNotFoundError();
  return record;
}

/** A new record, Planned (`maintenance.manage`: USER and above). Only a title is required. */
export async function createMaintenanceRecord(deps: MaintenanceDeps, input: Ref & { readonly content: MaintenanceInput }): Promise<MaintenanceRecord> {
  const scope = await enter(deps, input, 'maintenance.manage');
  const content = normalizeMaintenanceContent(input.content);
  return ok(await deps.maintenance.create({ workspaceId: input.workspaceId, content, at: deps.clock.now(), scope }, userActor(input.actor), manage)).record;
}

/** Changes what a record says — never its status (that is `setMaintenanceStatus`). */
export async function updateMaintenanceRecord(deps: MaintenanceDeps, input: Ref & { readonly recordId: string; readonly content: MaintenanceInput; readonly expectedRevision: number }): Promise<MaintenanceRecord> {
  const scope = await enter(deps, input, 'maintenance.manage');
  const values = { workspaceId: input.workspaceId, recordId: parseMaintenanceRecordId(input.recordId), content: normalizeMaintenanceContent(input.content), expectedRevision: input.expectedRevision, at: deps.clock.now(), scope };
  return ok(await deps.maintenance.update(values, userActor(input.actor), manage)).record;
}

/**
 * Sets the status — the one way a record becomes Completed, Cancelled, In progress or Planned again.
 * Always a person's decision: no Run, Occurrence or Reminder calls this. Every change between the four
 * is allowed and audited; a stale request (the record changed meanwhile) is refused, so of two people
 * moving the same card one succeeds and the other sees the current state. `completedOn`: the day the
 * work was completed (the person's "today" unless they say otherwise); only used for COMPLETED.
 */
export async function setMaintenanceStatus(deps: MaintenanceDeps, input: Ref & { readonly recordId: string; readonly status: string; readonly expectedRevision: number; readonly completedOn?: string | undefined }): Promise<MaintenanceRecord> {
  const scope = await enter(deps, input, 'maintenance.manage');
  const now = deps.clock.now();
  const values = {
    workspaceId: input.workspaceId,
    recordId: parseMaintenanceRecordId(input.recordId),
    to: parseMaintenanceStatus(input.status),
    expectedRevision: input.expectedRevision,
    completedOn: input.completedOn === undefined ? null : parseDocumentDate(input.completedOn),
    today: now.toISOString().slice(0, 10),
    at: now,
    scope,
  };
  return ok(await deps.maintenance.setStatus(values, userActor(input.actor), manage)).record;
}

/** Moves a record to Trash. */
export async function deleteMaintenanceRecord(deps: MaintenanceDeps, input: Ref & { readonly recordId: string }): Promise<void> {
  await enter(deps, input, 'maintenance.manage');
  ok(await deps.maintenance.delete({ workspaceId: input.workspaceId, recordId: parseMaintenanceRecordId(input.recordId), at: deps.clock.now() }, userActor(input.actor), manage));
}

export async function restoreMaintenanceRecord(deps: MaintenanceDeps, input: Ref & { readonly recordId: string }): Promise<MaintenanceRecord> {
  const scope = await enter(deps, input, 'maintenance.manage');
  return ok(await deps.maintenance.restore({ workspaceId: input.workspaceId, recordId: parseMaintenanceRecordId(input.recordId), at: deps.clock.now(), scope }, userActor(input.actor), manage)).record;
}

/** What is in Trash (`maintenance.manage`: those who can restore). */
export async function listMaintenanceTrash(deps: MaintenanceDeps, input: Ref): Promise<TrashedMaintenanceRecord[]> {
  await enter(deps, input, 'maintenance.manage');
  return deps.maintenance.listTrash(input.workspaceId);
}

/** **Permanent deletion** from Trash — the records named, or all of Trash. Only a Workspace admin (`maintenance.purge`); never by itself. */
export async function purgeMaintenanceTrash(deps: MaintenanceDeps, input: Ref & { readonly recordIds: readonly string[] | 'all' }): Promise<number> {
  await enter(deps, input, 'maintenance.purge');
  if (input.recordIds !== 'all' && (input.recordIds.length === 0 || input.recordIds.length > MAX_MAINTENANCE_RECORDS_PER_PURGE || new Set(input.recordIds).size !== input.recordIds.length)) {
    throw new DomainValidationError('records', 'invalid_trash_selection', 'Choose between 1 and 200 records of Trash');
  }
  const recordIds = input.recordIds === 'all' ? 'all' : input.recordIds.map(parseMaintenanceRecordId);
  return ok(await deps.maintenance.purge({ workspaceId: input.workspaceId, recordIds, at: deps.clock.now() }, userActor(input.actor), purger)).purged;
}

// ---- Links: evidence (Documents), Procedures, Runs, Reminders. References — nothing is copied, nobody gains access.

/** What each kind of linked record needs to be read by its own rules. */
const VIEW_OF = { equipment:'equipment.view', document: 'document.view', procedure: 'procedure.view', run: 'run.view', schedule: 'procedure.view' } as const;

export async function listMaintenanceLinks(deps: MaintenanceDeps, input: Ref & { readonly recordId: string }): Promise<MaintenanceLink[]> {
  const scope = await enter(deps, input, 'maintenance.view');
  const membership = await authorizeWorkspace(deps, input.actor, input.workspaceId, 'workspace.view');
  const found = await deps.maintenance.links(input.workspaceId, parseMaintenanceRecordId(input.recordId), scope);
  if (found === undefined) throw new MaintenanceRecordNotFoundError();
  // A Link never reveals a record its viewer may not read.
  return found
    .filter((link) => link.record.type in VIEW_OF && roleHasCapability(membership.role, VIEW_OF[link.record.type as keyof typeof VIEW_OF]))
    .map((link) => link.record.type === 'document' && link.record.state === 'trash' && !roleHasCapability(membership.role, 'document.manage')
      ? { ...link, record: { ...link.record, title: null, goneByName: null } }
      : link);
}

/**
 * Links a record to a Document (evidence: an invoice, a photo, a report), a Procedure, a Run or a
 * Schedule of the same Workspace. Needs `maintenance.manage` **and** the right to read the other end
 * (for a Document also the Documents tool). **Linking a Run changes nothing about the record's
 * status**, now or when the Run is completed.
 */
export async function addMaintenanceLink(deps: MaintenanceDeps, input: Ref & { readonly recordId: string; readonly target: { readonly type: string; readonly id: string } }): Promise<MaintenanceLink> {
  const scope = await enter(deps, input, 'maintenance.manage');
  const target = parseMaintenanceLinkTarget(input.target);
  if (target.type === 'document') await authorizeTool(deps, input.actor, input.workspaceId, 'DOCUMENTS', 'document.view');
  else await authorizeWorkspace(deps, input.actor, input.workspaceId, VIEW_OF[target.type], target.type === 'schedule' ? null : undefined);
  const linker: ActorGuard = { actorMay: (role) => roleHasCapability(role, 'maintenance.manage') && roleHasCapability(role, VIEW_OF[target.type]) };
  return ok(await deps.maintenance.addLink({ workspaceId: input.workspaceId, recordId: parseMaintenanceRecordId(input.recordId), target, at: deps.clock.now(), scope }, userActor(input.actor), linker)).link;
}

export async function removeMaintenanceLink(deps: MaintenanceDeps, input: Ref & { readonly linkId: string }): Promise<void> {
  await enter(deps, input, 'maintenance.manage');
  ok(await deps.maintenance.removeLink({ workspaceId: input.workspaceId, linkId: parseLinkId(input.linkId), at: deps.clock.now() }, userActor(input.actor), manage));
}
