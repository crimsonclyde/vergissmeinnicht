import type { Actor, EquipmentContent, EquipmentCursor, EquipmentId, EquipmentLinkType, EquipmentQuery, LinkId, WorkspaceId } from '@vergissmeinnicht/domain';
import type { ActorGuard } from './actor-guard.ts';
import type { LinkView } from './link-repository.ts';
type UserActor = Actor & {
    readonly kind: 'user';
};
export interface EquipmentRecord extends EquipmentContent {
    readonly id: EquipmentId;
    readonly revision: number;
    readonly createdAt: Date;
    readonly createdByName: string;
    readonly updatedAt: Date;
    readonly updatedByName: string;
}
export type EquipmentSummary = EquipmentRecord;
export interface EquipmentListing {
    readonly records: EquipmentRecord[];
    readonly next: EquipmentCursor | null;
    readonly total: number | null;
}
export interface EquipmentFilterValues {
    readonly categories: string[];
    readonly locations: string[];
    readonly manufacturers: string[];
}
export interface TrashedEquipmentRecord {
    readonly id: EquipmentId;
    readonly name: string;
    readonly deletedAt: Date;
    readonly deletedByName: string;
}
export type EquipmentLink = LinkView;
export type EquipmentRefusal = 'forbidden' | 'tool_disabled' | 'record_not_found' | 'conflict' | 'limit_reached' | 'target_not_found' | 'link_not_found' | 'already_linked';
export type EquipmentWrite<T = unknown> = ({
    readonly status: 'ok';
} & T) | {
    readonly status: EquipmentRefusal;
};
export interface EquipmentRepository {
    find(workspaceId: WorkspaceId, query: EquipmentQuery, after: EquipmentCursor | null, limit: number): Promise<EquipmentListing>;
    filterValues(workspaceId: WorkspaceId): Promise<EquipmentFilterValues>;
    get(workspaceId: WorkspaceId, recordId: EquipmentId): Promise<EquipmentRecord | undefined>;
    create(input: {
        workspaceId: WorkspaceId;
        content: EquipmentContent;
        at: Date;
    }, actor: UserActor, guard: ActorGuard): Promise<EquipmentWrite<{
        record: EquipmentRecord;
    }>>;
    update(input: {
        workspaceId: WorkspaceId;
        recordId: EquipmentId;
        content: EquipmentContent;
        expectedRevision: number;
        at: Date;
    }, actor: UserActor, guard: ActorGuard): Promise<EquipmentWrite<{
        record: EquipmentRecord;
    }>>;
    delete(input: {
        workspaceId: WorkspaceId;
        recordId: EquipmentId;
        at: Date;
    }, actor: UserActor, guard: ActorGuard): Promise<EquipmentWrite>;
    restore(input: {
        workspaceId: WorkspaceId;
        recordId: EquipmentId;
        at: Date;
    }, actor: UserActor, guard: ActorGuard): Promise<EquipmentWrite<{
        record: EquipmentRecord;
    }>>;
    listTrash(workspaceId: WorkspaceId): Promise<TrashedEquipmentRecord[]>;
    purge(input: {
        workspaceId: WorkspaceId;
        recordIds: readonly EquipmentId[] | 'all';
        at: Date;
    }, actor: UserActor, guard: ActorGuard): Promise<EquipmentWrite<{
        purged: number;
    }>>;
    links(workspaceId: WorkspaceId, recordId: EquipmentId): Promise<EquipmentLink[] | undefined>;
    addLink(input: {
        workspaceId: WorkspaceId;
        recordId: EquipmentId;
        target: {
            type: EquipmentLinkType;
            id: string;
        };
        at: Date;
    }, actor: UserActor, guard: ActorGuard): Promise<EquipmentWrite<{
        link: EquipmentLink;
    }>>;
    removeLink(input: {
        workspaceId: WorkspaceId;
        linkId: LinkId;
        at: Date;
    }, actor: UserActor, guard: ActorGuard): Promise<EquipmentWrite>;
}
