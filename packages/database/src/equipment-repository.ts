import { randomUUID } from 'node:crypto';
import type { ActorGuard, EquipmentLink, EquipmentRecord, EquipmentRefusal, EquipmentRepository, EquipmentWrite, } from '@vergissmeinnicht/application';
import { MAX_LINKS_PER_EQUIPMENT_RECORD, MAX_EQUIPMENT_RECORDS_PER_WORKSPACE, containsPattern, equipmentCategoryKey, equipmentSearchText, type LinkId, type EquipmentContent, type EquipmentId, type WorkspaceId, } from '@vergissmeinnicht/domain';
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, gt, ne, or, sql, type SQL } from 'drizzle-orm';
import { IMMEDIATE, actorAllowed, type Transaction, type UserActor } from './actor-guard.ts';
import { recordAuditEvent } from './audit-events.ts';
import type { AppDatabase } from './connection.ts';
import { recordToolEnabled } from './tool-policy.ts';
import { linkedRecord, markLinksOfPurged } from './link-repository.ts';
import { links, equipmentRecords, maintenanceRecords, workspaceTools } from './schema.ts';
type Reader = Pick<Transaction, 'select'>;
type Row = typeof equipmentRecords.$inferSelect;
/** Rolls the transaction back with a refusal: nothing of a refused write is kept. */
class Refusal extends Error {
    readonly status: EquipmentRefusal;
    constructor(status: EquipmentRefusal) {
        super(status);
        this.status = status;
    }
}
function toolEnabled(tx: Reader, workspaceId: string): boolean {
    return (tx
        .select({ enabled: workspaceTools.enabled })
        .from(workspaceTools)
        .where(and(eq(workspaceTools.workspaceId, workspaceId), eq(workspaceTools.tool, 'EQUIPMENT')))
        .get()?.enabled === true);
}
function recordOf(row: Row): EquipmentRecord {
    const { id, name, category, location, manufacturer, model, serialNumber, purchaseDate, warrantyExpiry, notes, revision, createdAt, updatedAt } = row;
    return { id: id as EquipmentId, name, category, location, manufacturer, model, serialNumber, purchaseDate, warrantyExpiry, notes, revision, createdAt, updatedAt, createdByName: row.createdByDisplayName, updatedByName: row.updatedByDisplayName };
}
function liveRecord(tx: Reader, workspaceId: string, recordId: string): Row | undefined {
    return tx
        .select()
        .from(equipmentRecords)
        .where(and(eq(equipmentRecords.workspaceId, workspaceId), eq(equipmentRecords.id, recordId), isNull(equipmentRecords.deletedAt)))
        .get();
}
const liveCount = (tx: Reader, workspaceId: string): number => tx
    .select({ n: count() })
    .from(equipmentRecords)
    .where(and(eq(equipmentRecords.workspaceId, workspaceId), isNull(equipmentRecords.deletedAt)))
    .get()?.n ?? 0;
/** The stored columns of the content that do not depend on anything else. */
const stored = (content: EquipmentContent) => ({ ...content,
    categoryKey: equipmentCategoryKey(content.category), locationKey: equipmentCategoryKey(content.location), manufacturerKey: equipmentCategoryKey(content.manufacturer),
    sortKey: equipmentCategoryKey(content.name), searchText: equipmentSearchText(content) });
const linkOf = (tx: Reader, row: typeof links.$inferSelect): EquipmentLink => ({
    sourceType: row.fromType,
    id: row.id as LinkId,
    record: row.fromType === 'equipment' ? linkedRecord(tx, row.workspaceId, row.toType, row.toId, { at: row.toGoneAt, by: row.toGoneByDisplayName }) : linkedRecord(tx, row.workspaceId, row.fromType, row.fromId, { at: row.fromGoneAt, by: row.fromGoneByDisplayName }),
    createdAt: row.createdAt,
    createdByName: row.createdByDisplayName,
});
/** Equipment (16.8). See `EquipmentRepository`. */
export function createEquipmentRepository({ db }: Pick<AppDatabase, 'db'>): EquipmentRepository {
    /** One write: IMMEDIATE transaction, actor and tool re-checked first; a `Refusal` rolls everything back. */
    function write<T>(workspaceId: WorkspaceId, actor: UserActor, guard: ActorGuard, change: (tx: Transaction) => T): EquipmentWrite<T> {
        try {
            return db.transaction((tx) => {
                if (!actorAllowed(tx, workspaceId, actor, guard))
                    throw new Refusal('forbidden');
                if (!toolEnabled(tx, workspaceId))
                    throw new Refusal('tool_disabled');
                return { status: 'ok' as const, ...change(tx) };
            }, IMMEDIATE);
        }
        catch (error) {
            if (error instanceof Refusal)
                return { status: error.status };
            throw error;
        }
    }
    return {
        async find(workspaceId, query, after, limit) {
            const where: SQL[] = [];
            for (const [key, column] of [[query.category, equipmentRecords.categoryKey], [query.location, equipmentRecords.locationKey], [query.manufacturer, equipmentRecords.manufacturerKey]] as const)
                if (key !== null)
                    where.push(eq(column, key));
            for (const term of query.terms)
                where.push(sql `${equipmentRecords.searchText} like ${containsPattern(term)} escape '\\'`);
            const scoped = and(eq(equipmentRecords.workspaceId, workspaceId), isNull(equipmentRecords.deletedAt), ...where);
            const rows = db.select().from(equipmentRecords).where(after === null ? scoped : and(scoped, or(gt(equipmentRecords.sortKey, after.value), and(eq(equipmentRecords.sortKey, after.value), gt(equipmentRecords.id, after.id))))).orderBy(asc(equipmentRecords.sortKey), asc(equipmentRecords.id)).limit(limit + 1).all();
            const shown = rows.slice(0, limit);
            const last = shown.at(-1);
            return { records: shown.map(recordOf), next: rows.length > limit && last !== undefined ? { value: last.sortKey, id: last.id } : null, total: after === null ? (db.select({ n: count() }).from(equipmentRecords).where(scoped).get()?.n ?? 0) : null };
        },
        async filterValues(workspaceId) {
            const values = (column: typeof equipmentRecords.category | typeof equipmentRecords.location | typeof equipmentRecords.manufacturer) => db.selectDistinct({ value: column }).from(equipmentRecords).where(and(eq(equipmentRecords.workspaceId, workspaceId), isNull(equipmentRecords.deletedAt), ne(column, ''))).orderBy(asc(column)).all().map(row => row.value);
            return { categories: values(equipmentRecords.category), locations: values(equipmentRecords.location), manufacturers: values(equipmentRecords.manufacturer) };
        },
        async get(workspaceId, recordId) {
            const row = liveRecord(db, workspaceId, recordId);
            return row === undefined ? undefined : recordOf(row);
        },
        async create(input, actor, guard) {
            return write(input.workspaceId, actor, guard, (tx) => {
                if (liveCount(tx, input.workspaceId) >= MAX_EQUIPMENT_RECORDS_PER_WORKSPACE)
                    throw new Refusal('limit_reached');
                const who = { createdByUserId: actor.userId, createdByDisplayName: actor.displayName, createdAt: input.at, updatedByUserId: actor.userId, updatedByDisplayName: actor.displayName, updatedAt: input.at };
                const row = tx
                    .insert(equipmentRecords)
                    .values({ id: randomUUID(), workspaceId: input.workspaceId, ...stored(input.content), ...who })
                    .returning()
                    .get();
                recordAuditEvent(tx, { workspaceId: input.workspaceId, type: 'EQUIPMENT_CREATED', actor, subjectType: 'equipment', subjectId: row.id, occurredAt: input.at, metadata: { title: row.name } });
                return { record: recordOf(row) };
            });
        },
        async update(input, actor, guard) {
            return write(input.workspaceId, actor, guard, (tx) => {
                const current = liveRecord(tx, input.workspaceId, input.recordId);
                if (current === undefined)
                    throw new Refusal('record_not_found');
                if (current.revision !== input.expectedRevision)
                    throw new Refusal('conflict');
                const row = tx
                    .update(equipmentRecords)
                    .set({ ...stored(input.content), revision: current.revision + 1, updatedByUserId: actor.userId, updatedByDisplayName: actor.displayName, updatedAt: input.at })
                    .where(eq(equipmentRecords.id, current.id))
                    .returning()
                    .get();
                recordAuditEvent(tx, { workspaceId: input.workspaceId, type: 'EQUIPMENT_UPDATED', actor, subjectType: 'equipment', subjectId: current.id, occurredAt: input.at, metadata: { title: row.name } });
                return { record: recordOf(row) };
            });
        },
        async delete(input, actor, guard) {
            return write(input.workspaceId, actor, guard, (tx) => {
                const current = liveRecord(tx, input.workspaceId, input.recordId);
                if (current === undefined)
                    throw new Refusal('record_not_found');
                tx.update(equipmentRecords)
                    .set({ deletedAt: input.at, deletedByUserId: actor.userId, deletedByDisplayName: actor.displayName, revision: current.revision + 1 })
                    .where(eq(equipmentRecords.id, current.id))
                    .run();
                recordAuditEvent(tx, { workspaceId: input.workspaceId, type: 'EQUIPMENT_DELETED', actor, subjectType: 'equipment', subjectId: current.id, occurredAt: input.at, metadata: { title: current.name } });
                return {};
            });
        },
        async restore(input, actor, guard) {
            return write(input.workspaceId, actor, guard, (tx) => {
                const current = tx
                    .select()
                    .from(equipmentRecords)
                    .where(and(eq(equipmentRecords.workspaceId, input.workspaceId), eq(equipmentRecords.id, input.recordId), isNotNull(equipmentRecords.deletedAt)))
                    .get();
                if (current === undefined)
                    throw new Refusal('record_not_found');
                if (liveCount(tx, input.workspaceId) >= MAX_EQUIPMENT_RECORDS_PER_WORKSPACE)
                    throw new Refusal('limit_reached');
                const row = tx
                    .update(equipmentRecords)
                    .set({ deletedAt: null, deletedByUserId: null, deletedByDisplayName: null, revision: current.revision + 1 })
                    .where(eq(equipmentRecords.id, current.id))
                    .returning()
                    .get();
                recordAuditEvent(tx, { workspaceId: input.workspaceId, type: 'EQUIPMENT_RESTORED', actor, subjectType: 'equipment', subjectId: current.id, occurredAt: input.at, metadata: { title: current.name } });
                return { record: recordOf(row) };
            });
        },
        async listTrash(workspaceId) {
            return db
                .select()
                .from(equipmentRecords)
                .where(and(eq(equipmentRecords.workspaceId, workspaceId), isNotNull(equipmentRecords.deletedAt)))
                .orderBy(desc(equipmentRecords.deletedAt), asc(equipmentRecords.id))
                .all()
                .flatMap((row) => (row.deletedAt === null || row.deletedByDisplayName === null ? [] : [{ id: row.id as EquipmentId, name: row.name, deletedAt: row.deletedAt, deletedByName: row.deletedByDisplayName }]));
        },
        async purge(input, actor, guard) {
            return write(input.workspaceId, actor, guard, (tx) => {
                const trashed = tx
                    .select({ id: equipmentRecords.id, name: equipmentRecords.name })
                    .from(equipmentRecords)
                    .where(and(eq(equipmentRecords.workspaceId, input.workspaceId), isNotNull(equipmentRecords.deletedAt)))
                    .all();
                const ids = input.recordIds === 'all' ? trashed.map((row) => row.id) : [...input.recordIds];
                // Every one named must be in Trash of this Workspace: otherwise nothing is deleted.
                if (ids.some((id) => !trashed.some((row) => row.id === id)))
                    throw new Refusal('record_not_found');
                for (let start = 0; start < ids.length; start += 500) {
                    const chunk = ids.slice(start, start + 500);
                    markLinksOfPurged(tx, input.workspaceId, 'equipment', chunk, input.at, actor.displayName);
                    tx.delete(equipmentRecords).where(and(eq(equipmentRecords.workspaceId, input.workspaceId), inArray(equipmentRecords.id, chunk), isNotNull(equipmentRecords.deletedAt))).run();
                }
                for (const id of ids) {
                    recordAuditEvent(tx, { workspaceId: input.workspaceId, type: 'EQUIPMENT_PURGED', actor, subjectType: 'equipment', subjectId: id, occurredAt: input.at, metadata: { title: trashed.find((row) => row.id === id)?.name ?? '' } });
                }
                return { purged: ids.length };
            });
        },
        async links(workspaceId, recordId) {
            if (liveRecord(db, workspaceId, recordId) === undefined)
                return undefined;
            return db
                .select()
                .from(links)
                .where(and(eq(links.workspaceId, workspaceId), or(and(eq(links.fromType, 'equipment'), eq(links.fromId, recordId)), and(eq(links.toType, 'equipment'), eq(links.toId, recordId)))))
                .orderBy(asc(links.createdAt), asc(links.id))
                .all()
                .filter((row) => recordToolEnabled(db, workspaceId, row.fromType === 'equipment' ? row.toType : row.fromType, row.fromType === 'equipment' ? row.toId : row.fromId))
                .map((row) => linkOf(db, row))
                .sort((a, b) => {
                if (a.record.type !== b.record.type)
                    return a.record.type.localeCompare(b.record.type);
                if (a.record.type !== 'maintenance')
                    return 0;
                const day = (id: string) => db.select({ day: maintenanceRecords.sortDate }).from(maintenanceRecords).where(and(eq(maintenanceRecords.workspaceId, workspaceId), eq(maintenanceRecords.id, id))).get()?.day ?? '';
                return day(b.record.id).localeCompare(day(a.record.id)) || a.record.id.localeCompare(b.record.id);
            });
        },
        async addLink(input, actor, guard) {
            return write(input.workspaceId, actor, guard, (tx) => {
                const current = liveRecord(tx, input.workspaceId, input.recordId);
                if (current === undefined)
                    throw new Refusal('record_not_found');
                // A Document only where the Documents tool is on: a tool that is off does not exist.
                if (!recordToolEnabled(tx, input.workspaceId, input.target.type, input.target.id))
                    throw new Refusal('target_not_found');
                // The other end must be a record of this Workspace that is there. (The database checks the Workspace once more.)
                const target = linkedRecord(tx, input.workspaceId, input.target.type, input.target.id, { at: null, by: null });
                if (target.state === 'gone' || target.state === 'deleted' || target.state === 'trash')
                    throw new Refusal('target_not_found');
                if (tx.select({ id: links.id }).from(links).where(and(eq(links.workspaceId, input.workspaceId), eq(links.fromType, input.target.type), eq(links.fromId, input.target.id), eq(links.toType, 'equipment'), eq(links.toId, current.id))).get() !== undefined)
                    throw new Refusal('already_linked');
                const mine = and(eq(links.workspaceId, input.workspaceId), eq(links.fromType, 'equipment'), eq(links.fromId, current.id));
                if (tx.select({ id: links.id }).from(links).where(and(mine, eq(links.toType, input.target.type), eq(links.toId, input.target.id))).get() !== undefined)
                    throw new Refusal('already_linked');
                if ((tx.select({ n: count() }).from(links).where(mine).get()?.n ?? 0) >= MAX_LINKS_PER_EQUIPMENT_RECORD)
                    throw new Refusal('limit_reached');
                // A Link is a row naming two ids. Nothing of the other record is read into this one, and the
                // record's status is not touched — whatever is linked, and whatever becomes of it later.
                const row = tx
                    .insert(links)
                    .values({ id: randomUUID(), workspaceId: input.workspaceId, fromType: 'equipment', fromId: current.id, toType: input.target.type, toId: input.target.id, createdByUserId: actor.userId, createdByDisplayName: actor.displayName, createdAt: input.at })
                    .returning()
                    .get();
                recordAuditEvent(tx, {
                    workspaceId: input.workspaceId,
                    type: 'EQUIPMENT_LINK_ADDED',
                    actor,
                    subjectType: 'equipment',
                    subjectId: current.id,
                    occurredAt: input.at,
                    metadata: { title: current.name, linkedType: input.target.type, linkedId: input.target.id, ...(input.target.type === 'contact' ? {} : { linkedTitle: target.title ?? '' }) },
                });
                return { link: linkOf(tx, row) };
            });
        },
        async removeLink(input, actor, guard) {
            return write(input.workspaceId, actor, guard, (tx) => {
                const row = tx
                    .select()
                    .from(links)
                    // Source-owned Links only; either page uses the owning tool's removal API.
                    .where(and(eq(links.workspaceId, input.workspaceId), eq(links.id, input.linkId), eq(links.fromType, 'equipment')))
                    .get();
                if (row === undefined)
                    throw new Refusal('link_not_found');
                if (!recordToolEnabled(tx, input.workspaceId, row.toType, row.toId)) throw new Refusal('target_not_found');
                tx.delete(links).where(eq(links.id, row.id)).run();
                recordAuditEvent(tx, { workspaceId: input.workspaceId, type: 'EQUIPMENT_LINK_REMOVED', actor, subjectType: 'equipment', subjectId: row.fromId, occurredAt: input.at, metadata: { linkedType: row.toType, linkedId: row.toId } });
                return {};
            });
        },
    };
}
