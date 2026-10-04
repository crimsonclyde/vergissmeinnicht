import { DomainValidationError, EQUIPMENT_PAGE_SIZE, MAX_EQUIPMENT_RECORDS_PER_PURGE, normalizeEquipmentContent, parseLinkId, parseEquipmentCursor, parseEquipmentLinkTarget, parseEquipmentQuery, parseEquipmentId, type EquipmentCursor, type EquipmentInput, type User, type WorkspaceId, } from '@vergissmeinnicht/domain';
import { roleHasCapability, type WorkspaceCapability } from '@vergissmeinnicht/permissions';
import { ToolNotEnabledError } from '../documents/errors.ts';
import { authorizeTool } from '../documents/tools.ts';
import { NotAuthorizedError } from '../invitations/errors.ts';
import { AlreadyLinkedError, LinkNotFoundError, LinkTargetNotFoundError } from '../links/use-cases.ts';
import type { ActorGuard } from '../ports/actor-guard.ts';
import type { Clock } from '../ports/clock.ts';
import type { WorkspaceToolRepository } from '../ports/document-repository.ts';
import type { EquipmentFilterValues, EquipmentLink, EquipmentListing, EquipmentRecord, EquipmentRefusal, EquipmentRepository, EquipmentWrite, TrashedEquipmentRecord, } from '../ports/equipment-repository.ts';
import { InvalidCursorError } from '../ports/paging.ts';
import type { WorkspaceRepository } from '../ports/workspace-repository.ts';
import { userActor } from '../user-actor.ts';
import { authorizeWorkspace } from '../workspaces/use-cases.ts';
/** Unknown EquipmentRecord, one of another Workspace, or one in Trash. */
export class EquipmentRecordNotFoundError extends Error {
    constructor() {
        super('Equipment record not found');
        this.name = 'EquipmentRecordNotFoundError';
    }
}
/** The record was changed by someone else meanwhile: the current state must be looked at first. */
export class EquipmentConflictError extends Error {
    constructor() {
        super('The equipment record was changed meanwhile');
        this.name = 'EquipmentConflictError';
    }
}
export class EquipmentLimitReachedError extends Error {
    constructor() {
        super('Equipment limit reached');
        this.name = 'EquipmentLimitReachedError';
    }
}
export interface EquipmentDeps {
    readonly workspaces: WorkspaceRepository;
    readonly tools: WorkspaceToolRepository;
    readonly equipment: EquipmentRepository;
    readonly clock: Clock;
}
interface Ref {
    readonly actor: User;
    readonly workspaceId: WorkspaceId;
}
/** Re-checked inside every write transaction (concurrent demotion, removal or disabling). */
const manage: ActorGuard = { actorMay: (role) => roleHasCapability(role, 'equipment.manage') };
const purger: ActorGuard = { actorMay: (role) => roleHasCapability(role, 'equipment.purge') };
function refuse(status: EquipmentRefusal): never {
    switch (status) {
        case 'forbidden':
            throw new NotAuthorizedError();
        case 'tool_disabled':
            throw new ToolNotEnabledError();
        case 'record_not_found':
            throw new EquipmentRecordNotFoundError();
        case 'conflict':
            throw new EquipmentConflictError();
        case 'limit_reached':
            throw new EquipmentLimitReachedError();
        case 'target_not_found':
            throw new LinkTargetNotFoundError();
        case 'link_not_found':
            throw new LinkNotFoundError();
        case 'already_linked':
            throw new AlreadyLinkedError();
    }
}
function ok<T>(result: EquipmentWrite<T>): {
    readonly status: 'ok';
} & T {
    if (result.status !== 'ok')
        refuse(result.status);
    return result;
}
/**
 * The gate of every Equipment route, and what of the other optional tools the viewer gets to see
 * with it. Equipment has its own capabilities: being able to read Documents or Contacts grants
 * nothing here, and the other way round — a Contact's name or a linked Document appears only where
 * that tool is switched on **and** the viewer has its view capability.
 */
async function enter(deps: EquipmentDeps, input: Ref, capability: WorkspaceCapability): Promise<void> {
    await authorizeTool(deps, input.actor, input.workspaceId, 'EQUIPMENT', capability);
}
/** One page of the List, by name, searched and filtered by category, location and manufacturer. Never anything in Trash. */
export async function findEquipment(deps: EquipmentDeps, input: Ref & {
    readonly query: {
        readonly q?: string | undefined;
        readonly category?: string | undefined;
        readonly location?: string | undefined;
        readonly manufacturer?: string | undefined;
    };
    readonly cursor?: unknown;
}): Promise<EquipmentListing> {
    await enter(deps, input, 'equipment.view');
    const query = parseEquipmentQuery(input.query);
    let after: EquipmentCursor | null = null;
    if (input.cursor !== undefined && input.cursor !== null) {
        const parsed = parseEquipmentCursor(input.cursor);
        if (parsed === undefined)
            throw new InvalidCursorError();
        after = parsed;
    }
    return deps.equipment.find(input.workspaceId, query, after, EQUIPMENT_PAGE_SIZE);
}
export async function equipmentFilterValues(deps: EquipmentDeps, input: Ref): Promise<EquipmentFilterValues> {
    await enter(deps, input, 'equipment.view');
    return deps.equipment.filterValues(input.workspaceId);
}
export async function getEquipmentRecord(deps: EquipmentDeps, input: Ref & {
    readonly recordId: string;
}): Promise<EquipmentRecord> {
    await enter(deps, input, 'equipment.view');
    const record = await deps.equipment.get(input.workspaceId, parseEquipmentId(input.recordId));
    if (record === undefined)
        throw new EquipmentRecordNotFoundError();
    return record;
}
/** A new Equipment record (`equipment.manage`: USER and above). Only a name is required. */
export async function createEquipmentRecord(deps: EquipmentDeps, input: Ref & {
    readonly content: EquipmentInput;
}): Promise<EquipmentRecord> {
    await enter(deps, input, 'equipment.manage');
    const content = normalizeEquipmentContent(input.content);
    return ok(await deps.equipment.create({ workspaceId: input.workspaceId, content, at: deps.clock.now() }, userActor(input.actor), manage)).record;
}
/** Changes Equipment metadata; linked Reminders stay unchanged. */
export async function updateEquipmentRecord(deps: EquipmentDeps, input: Ref & {
    readonly recordId: string;
    readonly content: EquipmentInput;
    readonly expectedRevision: number;
}): Promise<EquipmentRecord> {
    await enter(deps, input, 'equipment.manage');
    const values = { workspaceId: input.workspaceId, recordId: parseEquipmentId(input.recordId), content: normalizeEquipmentContent(input.content), expectedRevision: input.expectedRevision, at: deps.clock.now() };
    return ok(await deps.equipment.update(values, userActor(input.actor), manage)).record;
}
/** Moves a record to Trash. */
export async function deleteEquipmentRecord(deps: EquipmentDeps, input: Ref & {
    readonly recordId: string;
}): Promise<void> {
    await enter(deps, input, 'equipment.manage');
    ok(await deps.equipment.delete({ workspaceId: input.workspaceId, recordId: parseEquipmentId(input.recordId), at: deps.clock.now() }, userActor(input.actor), manage));
}
export async function restoreEquipmentRecord(deps: EquipmentDeps, input: Ref & {
    readonly recordId: string;
}): Promise<EquipmentRecord> {
    await enter(deps, input, 'equipment.manage');
    return ok(await deps.equipment.restore({ workspaceId: input.workspaceId, recordId: parseEquipmentId(input.recordId), at: deps.clock.now() }, userActor(input.actor), manage)).record;
}
/** What is in Trash (`equipment.manage`: those who can restore). */
export async function listEquipmentTrash(deps: EquipmentDeps, input: Ref): Promise<TrashedEquipmentRecord[]> {
    await enter(deps, input, 'equipment.manage');
    return deps.equipment.listTrash(input.workspaceId);
}
/** **Permanent deletion** from Trash — the records named, or all of Trash. Only a Workspace admin (`equipment.purge`); never by itself. */
export async function purgeEquipmentTrash(deps: EquipmentDeps, input: Ref & {
    readonly recordIds: readonly string[] | 'all';
}): Promise<number> {
    await enter(deps, input, 'equipment.purge');
    if (input.recordIds !== 'all' && (input.recordIds.length === 0 || input.recordIds.length > MAX_EQUIPMENT_RECORDS_PER_PURGE || new Set(input.recordIds).size !== input.recordIds.length)) {
        throw new DomainValidationError('records', 'invalid_trash_selection', 'Choose between 1 and 200 records of Trash');
    }
    const recordIds = input.recordIds === 'all' ? 'all' : input.recordIds.map(parseEquipmentId);
    return ok(await deps.equipment.purge({ workspaceId: input.workspaceId, recordIds, at: deps.clock.now() }, userActor(input.actor), purger)).purged;
}
// Links to Documents, Contacts, MaintenanceRecords, Procedures and ordinary Schedules.
/** What each kind of linked record needs to be read by its own rules. */
const VIEW_OF = { document: 'document.view', contact: 'contact.view', maintenance: 'maintenance.view', procedure: 'procedure.view', schedule: 'procedure.view' } as const;
export async function listEquipmentLinks(deps: EquipmentDeps, input: Ref & {
    readonly recordId: string;
}): Promise<EquipmentLink[]> {
    await enter(deps, input, 'equipment.view');
    const membership = await authorizeWorkspace(deps, input.actor, input.workspaceId, 'workspace.view');
    const found = await deps.equipment.links(input.workspaceId, parseEquipmentId(input.recordId));
    if (found === undefined)
        throw new EquipmentRecordNotFoundError();
    // A Link never reveals a record its viewer may not read.
    return found
        .filter((link) => link.record.type in VIEW_OF && roleHasCapability(membership.role, VIEW_OF[link.record.type as keyof typeof VIEW_OF]))
        .map((link) => link.record.type === 'document' && link.record.state === 'trash' && !roleHasCapability(membership.role, 'document.manage')
        ? { ...link, record: { ...link.record, title: null, goneByName: null } }
        : link);
}
/** Link only readable, enabled records of this Workspace. A Link grants no access and changes
 * neither the linked record nor any reminder. Contact names are excluded from audit metadata.
 */
export async function addEquipmentLink(deps: EquipmentDeps, input: Ref & {
    readonly recordId: string;
    readonly target: {
        readonly type: string;
        readonly id: string;
    };
}): Promise<EquipmentLink> {
    await enter(deps, input, 'equipment.manage');
    const target = parseEquipmentLinkTarget(input.target);
    if (target.type === 'document')
        await authorizeTool(deps, input.actor, input.workspaceId, 'DOCUMENTS', 'document.view');
    else
        await authorizeWorkspace(deps, input.actor, input.workspaceId, VIEW_OF[target.type], target.type === 'schedule' ? null : undefined);
    const linker: ActorGuard = { actorMay: (role) => roleHasCapability(role, 'equipment.manage') && roleHasCapability(role, VIEW_OF[target.type]) };
    return ok(await deps.equipment.addLink({ workspaceId: input.workspaceId, recordId: parseEquipmentId(input.recordId), target, at: deps.clock.now() }, userActor(input.actor), linker)).link;
}
export async function removeEquipmentLink(deps: EquipmentDeps, input: Ref & {
    readonly linkId: string;
}): Promise<void> {
    await enter(deps, input, 'equipment.manage');
    ok(await deps.equipment.removeLink({ workspaceId: input.workspaceId, linkId: parseLinkId(input.linkId), at: deps.clock.now() }, userActor(input.actor), manage));
}
