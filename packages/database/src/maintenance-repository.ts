import { randomUUID } from 'node:crypto';
import type {
  ActorGuard,
  MaintenanceColumn,
  MaintenanceContactRef,
  MaintenanceLink,
  MaintenanceRecord,
  MaintenanceRefusal,
  MaintenanceRepository,
  MaintenanceScope,
  MaintenanceSummary,
  MaintenanceWrite,
} from '@vergissmeinnicht/application';
import {
  MAINTENANCE_STATUSES,
  MAX_LINKS_PER_MAINTENANCE_RECORD,
  MAX_MAINTENANCE_RECORDS_PER_WORKSPACE,
  containsPattern,
  maintenanceCategoryKey,
  maintenanceSearchText,
  maintenanceSortDate,
  statusChange,
  type LinkId,
  type MaintenanceContent,
  type MaintenanceRecordId,
  type WorkspaceId,
} from '@vergissmeinnicht/domain';
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import { IMMEDIATE, actorAllowed, type Transaction, type UserActor } from './actor-guard.ts';
import { recordAuditEvent } from './audit-events.ts';
import type { AppDatabase } from './connection.ts';
import { recordToolEnabled, toolEnabled as linkedToolEnabled } from './tool-policy.ts';
import { linkedRecord, markLinksOfPurged } from './link-repository.ts';
import { contacts, links, maintenanceRecords, workspaceTools } from './schema.ts';

type Reader = Pick<Transaction, 'select'>;
type Row = typeof maintenanceRecords.$inferSelect;

/** Rolls the transaction back with a refusal: nothing of a refused write is kept. */
class Refusal extends Error {
  readonly status: MaintenanceRefusal;
  constructor(status: MaintenanceRefusal) {
    super(status);
    this.status = status;
  }
}

function toolEnabled(tx: Reader, workspaceId: string): boolean {
  return (
    tx
      .select({ enabled: workspaceTools.enabled })
      .from(workspaceTools)
      .where(and(eq(workspaceTools.workspaceId, workspaceId), eq(workspaceTools.tool, 'MAINTENANCE')))
      .get()?.enabled === true
  );
}

/** The responsible Contacts of some records, by id: a name while the Contact is there, `null` for one in Trash or gone. */
function contactRefs(tx: Reader, workspaceId: string, rows: readonly Row[], scope: MaintenanceScope): Map<string, MaintenanceContactRef> {
  const ids = [...new Set(rows.flatMap((row) => (row.contactId === null ? [] : [row.contactId])))];
  const refs = new Map<string, MaintenanceContactRef>();
  // With Contacts switched off nothing of them is shown — not even that one is set.
  if (!scope.contacts || ids.length === 0) return refs;
  const found = new Map(
    tx
      .select({ id: contacts.id, name: contacts.name, deletedAt: contacts.deletedAt })
      .from(contacts)
      .where(and(eq(contacts.workspaceId, workspaceId), inArray(contacts.id, ids)))
      .all()
      .map((contact) => [contact.id, contact]),
  );
  for (const id of ids) {
    const contact = found.get(id);
    refs.set(id, { id, name: contact === undefined || contact.deletedAt !== null ? null : contact.name });
  }
  return refs;
}

const summaryOf = (row: Row, refs: ReadonlyMap<string, MaintenanceContactRef>): MaintenanceSummary => ({
  id: row.id as MaintenanceRecordId,
  title: row.title,
  category: row.category,
  date: row.date,
  status: row.status,
  completedOn: row.completedOn,
  contact: row.contactId === null ? null : (refs.get(row.contactId) ?? null),
  cost: row.costAmount === null || row.costCurrency === null ? null : { amount: row.costAmount, currency: row.costCurrency },
  revision: row.revision,
});

function recordOf(tx: Reader, row: Row, scope: MaintenanceScope): MaintenanceRecord {
  return {
    ...summaryOf(row, contactRefs(tx, row.workspaceId, [row], scope)),
    description: row.description,
    createdAt: row.createdAt,
    createdByName: row.createdByDisplayName,
    updatedAt: row.updatedAt,
    updatedByName: row.updatedByDisplayName,
  };
}

function liveRecord(tx: Reader, workspaceId: string, recordId: string): Row | undefined {
  return tx
    .select()
    .from(maintenanceRecords)
    .where(and(eq(maintenanceRecords.workspaceId, workspaceId), eq(maintenanceRecords.id, recordId), isNull(maintenanceRecords.deletedAt)))
    .get();
}

const liveCount = (tx: Reader, workspaceId: string): number =>
  tx
    .select({ n: count() })
    .from(maintenanceRecords)
    .where(and(eq(maintenanceRecords.workspaceId, workspaceId), isNull(maintenanceRecords.deletedAt)))
    .get()?.n ?? 0;

/** The stored columns of the content that do not depend on anything else. */
const stored = (content: MaintenanceContent) => ({
  title: content.title,
  category: content.category,
  date: content.date,
  description: content.description,
  costAmount: content.cost?.amount ?? null,
  costCurrency: content.cost?.currency ?? null,
  categoryKey: maintenanceCategoryKey(content.category),
  searchText: maintenanceSearchText(content),
});

const day = (at: Date): string => at.toISOString().slice(0, 10);

/** The responsible Contact must be a Contact of this Workspace that is not in Trash. */
function requireContact(tx: Reader, workspaceId: string, contactId: string | null): void {
  if (contactId === null) return;
  if (!linkedToolEnabled(tx, workspaceId, 'CONTACTS')) throw new Refusal('contact_not_found');
  const contact = tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.id, contactId), isNull(contacts.deletedAt)))
    .get();
  if (contact === undefined) throw new Refusal('contact_not_found');
}

const linkOf = (tx: Reader, row: typeof links.$inferSelect): MaintenanceLink => ({
  id: row.id as LinkId,
  record: linkedRecord(tx, row.workspaceId, row.toType, row.toId, { at: row.toGoneAt, by: row.toGoneByDisplayName }),
  createdAt: row.createdAt,
  createdByName: row.createdByDisplayName,
});

/** MaintenanceRecords (16.7). See `MaintenanceRepository`. */
export function createMaintenanceRepository({ db }: Pick<AppDatabase, 'db'>): MaintenanceRepository {
  /** One write: IMMEDIATE transaction, actor and tool re-checked first; a `Refusal` rolls everything back. */
  function write<T>(workspaceId: WorkspaceId, actor: UserActor, guard: ActorGuard, change: (tx: Transaction) => T): MaintenanceWrite<T> {
    try {
      return db.transaction((tx) => {
        if (!actorAllowed(tx, workspaceId, actor, guard)) throw new Refusal('forbidden');
        if (!toolEnabled(tx, workspaceId)) throw new Refusal('tool_disabled');
        return { status: 'ok' as const, ...change(tx) };
      }, IMMEDIATE);
    } catch (error) {
      if (error instanceof Refusal) return { status: error.status };
      throw error;
    }
  }

  return {
    async board(workspaceId, scope, perColumn) {
      const columns: { status: (typeof MAINTENANCE_STATUSES)[number]; total: number; rows: Row[] }[] = [];
      for (const status of MAINTENANCE_STATUSES) {
        const where = and(eq(maintenanceRecords.workspaceId, workspaceId), eq(maintenanceRecords.status, status), isNull(maintenanceRecords.deletedAt));
        // What is still to do: soonest first. What is over: latest first.
        const open = status === 'PLANNED' || status === 'IN_PROGRESS';
        const rows = db
          .select()
          .from(maintenanceRecords)
          .where(where)
          .orderBy(open ? asc(maintenanceRecords.sortDate) : desc(maintenanceRecords.sortDate), asc(maintenanceRecords.id))
          .limit(perColumn)
          .all();
        columns.push({ status, total: rows.length < perColumn ? rows.length : (db.select({ n: count() }).from(maintenanceRecords).where(where).get()?.n ?? 0), rows });
      }
      const refs = contactRefs(db, workspaceId, columns.flatMap((column) => column.rows), scope);
      return columns.map((column): MaintenanceColumn => ({ status: column.status, total: column.total, records: column.rows.map((row) => summaryOf(row, refs)) }));
    },

    async find(workspaceId, query, after, limit, scope) {
      const where: SQL[] = [];
      if (query.status !== null) where.push(eq(maintenanceRecords.status, query.status));
      if (query.category !== null) where.push(eq(maintenanceRecords.categoryKey, query.category));
      if (query.contactId !== null) where.push(eq(maintenanceRecords.contactId, query.contactId));
      if (query.year !== null) where.push(sql`substr(${maintenanceRecords.sortDate}, 1, 4) = ${String(query.year)}`);
      for (const term of query.terms) where.push(sql`${maintenanceRecords.searchText} like ${containsPattern(term)} escape '\\'`);
      const scoped = and(eq(maintenanceRecords.workspaceId, workspaceId), isNull(maintenanceRecords.deletedAt), ...where);
      // Newest first; the id breaks ties so that a page never repeats or skips a record.
      const rows = db
        .select()
        .from(maintenanceRecords)
        .where(after === null ? scoped : and(scoped, or(lt(maintenanceRecords.sortDate, after.value), and(eq(maintenanceRecords.sortDate, after.value), lt(maintenanceRecords.id, after.id)))))
        .orderBy(desc(maintenanceRecords.sortDate), desc(maintenanceRecords.id))
        .limit(limit + 1)
        .all();
      const shown = rows.slice(0, limit);
      const last = shown.at(-1);
      const total = after === null ? (rows.length <= limit ? rows.length : (db.select({ n: count() }).from(maintenanceRecords).where(scoped).get()?.n ?? 0)) : null;
      const refs = contactRefs(db, workspaceId, shown, scope);
      return { records: shown.map((row) => summaryOf(row, refs)), next: rows.length > limit && last !== undefined ? { value: last.sortDate, id: last.id } : null, total };
    },

    async filterValues(workspaceId, scope) {
      const live = and(eq(maintenanceRecords.workspaceId, workspaceId), isNull(maintenanceRecords.deletedAt));
      const categories = db
        .select({ name: sql<string>`min(${maintenanceRecords.category})` })
        .from(maintenanceRecords)
        .where(and(live, ne(maintenanceRecords.categoryKey, '')))
        .groupBy(maintenanceRecords.categoryKey)
        .orderBy(asc(maintenanceRecords.categoryKey))
        .all()
        .map((row) => row.name);
      const years = db
        .select({ year: sql<string>`substr(${maintenanceRecords.sortDate}, 1, 4)` })
        .from(maintenanceRecords)
        .where(live)
        .groupBy(sql`substr(${maintenanceRecords.sortDate}, 1, 4)`)
        .orderBy(desc(sql`substr(${maintenanceRecords.sortDate}, 1, 4)`))
        .all()
        .map((row) => Number(row.year));
      // Responsible Contacts that can be named: those that are there. Only where Contacts are shown at all.
      const named = !scope.contacts
        ? []
        : db
            .selectDistinct({ id: contacts.id, name: contacts.name, key: contacts.sortKey })
            .from(maintenanceRecords)
            .innerJoin(contacts, and(eq(contacts.id, maintenanceRecords.contactId), eq(contacts.workspaceId, workspaceId), isNull(contacts.deletedAt)))
            .where(live)
            .orderBy(asc(contacts.sortKey), asc(contacts.id))
            .all()
            .map((row) => ({ id: row.id, name: row.name }));
      return { categories, years, contacts: named };
    },

    async get(workspaceId, recordId, scope) {
      const row = liveRecord(db, workspaceId, recordId);
      return row === undefined ? undefined : recordOf(db, row, scope);
    },

    async create(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        if (liveCount(tx, input.workspaceId) >= MAX_MAINTENANCE_RECORDS_PER_WORKSPACE) throw new Refusal('limit_reached');
        // With Contacts switched off there is no Contact to be responsible.
        const contactId = input.scope.contacts ? input.content.contactId : null;
        requireContact(tx, input.workspaceId, contactId);
        const who = { createdByUserId: actor.userId, createdByDisplayName: actor.displayName, createdAt: input.at, updatedByUserId: actor.userId, updatedByDisplayName: actor.displayName, updatedAt: input.at };
        const sortDate = maintenanceSortDate({ completedOn: null, date: input.content.date, createdOn: day(input.at) });
        const row = tx
          .insert(maintenanceRecords)
          .values({ id: randomUUID(), workspaceId: input.workspaceId, ...stored(input.content), contactId, status: 'PLANNED', completedOn: null, sortDate, ...who })
          .returning()
          .get();
        recordAuditEvent(tx, { workspaceId: input.workspaceId, type: 'MAINTENANCE_CREATED', actor, subjectType: 'maintenance', subjectId: row.id, occurredAt: input.at, metadata: { title: row.title } });
        return { record: recordOf(tx, row, input.scope) };
      });
    },

    async update(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        const current = liveRecord(tx, input.workspaceId, input.recordId);
        if (current === undefined) throw new Refusal('record_not_found');
        if (current.revision !== input.expectedRevision) throw new Refusal('conflict');
        // Who cannot see Contacts cannot change who is responsible: it stays as it is.
        const contactId = input.scope.contacts ? input.content.contactId : current.contactId;
        // A Contact that is already set may stay even when it is in Trash; a new one must be there.
        if (contactId !== current.contactId) requireContact(tx, input.workspaceId, contactId);
        const sortDate = maintenanceSortDate({ completedOn: current.completedOn, date: input.content.date, createdOn: day(current.createdAt) });
        const row = tx
          .update(maintenanceRecords)
          .set({ ...stored(input.content), contactId, sortDate, revision: current.revision + 1, updatedByUserId: actor.userId, updatedByDisplayName: actor.displayName, updatedAt: input.at })
          .where(eq(maintenanceRecords.id, current.id))
          .returning()
          .get();
        recordAuditEvent(tx, { workspaceId: input.workspaceId, type: 'MAINTENANCE_UPDATED', actor, subjectType: 'maintenance', subjectId: current.id, occurredAt: input.at, metadata: { title: row.title } });
        return { record: recordOf(tx, row, input.scope) };
      });
    },

    async setStatus(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        const current = liveRecord(tx, input.workspaceId, input.recordId);
        if (current === undefined) throw new Refusal('record_not_found');
        if (current.revision !== input.expectedRevision) throw new Refusal('conflict');
        const change = statusChange(current.status, input.to, input.completedOn, input.today);
        if (change === undefined) throw new Refusal('status_unchanged');
        const sortDate = maintenanceSortDate({ completedOn: change.completedOn, date: current.date, createdOn: day(current.createdAt) });
        // The status, the completion date that goes with it and where the record is filed — nothing else, and no other table.
        const row = tx
          .update(maintenanceRecords)
          .set({ status: change.status, completedOn: change.completedOn, sortDate, revision: current.revision + 1, updatedByUserId: actor.userId, updatedByDisplayName: actor.displayName, updatedAt: input.at })
          .where(eq(maintenanceRecords.id, current.id))
          .returning()
          .get();
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: 'MAINTENANCE_STATUS_CHANGED',
          actor,
          subjectType: 'maintenance',
          subjectId: current.id,
          occurredAt: input.at,
          metadata: { title: current.title, from: current.status, to: change.status, ...(change.completedOn === null ? {} : { completedOn: change.completedOn }) },
        });
        return { record: recordOf(tx, row, input.scope) };
      });
    },

    async delete(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        const current = liveRecord(tx, input.workspaceId, input.recordId);
        if (current === undefined) throw new Refusal('record_not_found');
        tx.update(maintenanceRecords)
          .set({ deletedAt: input.at, deletedByUserId: actor.userId, deletedByDisplayName: actor.displayName, revision: current.revision + 1 })
          .where(eq(maintenanceRecords.id, current.id))
          .run();
        recordAuditEvent(tx, { workspaceId: input.workspaceId, type: 'MAINTENANCE_DELETED', actor, subjectType: 'maintenance', subjectId: current.id, occurredAt: input.at, metadata: { title: current.title } });
        return {};
      });
    },

    async restore(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        const current = tx
          .select()
          .from(maintenanceRecords)
          .where(and(eq(maintenanceRecords.workspaceId, input.workspaceId), eq(maintenanceRecords.id, input.recordId), isNotNull(maintenanceRecords.deletedAt)))
          .get();
        if (current === undefined) throw new Refusal('record_not_found');
        if (liveCount(tx, input.workspaceId) >= MAX_MAINTENANCE_RECORDS_PER_WORKSPACE) throw new Refusal('limit_reached');
        const row = tx
          .update(maintenanceRecords)
          .set({ deletedAt: null, deletedByUserId: null, deletedByDisplayName: null, revision: current.revision + 1 })
          .where(eq(maintenanceRecords.id, current.id))
          .returning()
          .get();
        recordAuditEvent(tx, { workspaceId: input.workspaceId, type: 'MAINTENANCE_RESTORED', actor, subjectType: 'maintenance', subjectId: current.id, occurredAt: input.at, metadata: { title: current.title } });
        return { record: recordOf(tx, row, input.scope) };
      });
    },

    async listTrash(workspaceId) {
      return db
        .select()
        .from(maintenanceRecords)
        .where(and(eq(maintenanceRecords.workspaceId, workspaceId), isNotNull(maintenanceRecords.deletedAt)))
        .orderBy(desc(maintenanceRecords.deletedAt), asc(maintenanceRecords.id))
        .all()
        .flatMap((row) => (row.deletedAt === null || row.deletedByDisplayName === null ? [] : [{ id: row.id as MaintenanceRecordId, title: row.title, status: row.status, deletedAt: row.deletedAt, deletedByName: row.deletedByDisplayName }]));
    },

    async purge(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        const trashed = tx
          .select({ id: maintenanceRecords.id, title: maintenanceRecords.title })
          .from(maintenanceRecords)
          .where(and(eq(maintenanceRecords.workspaceId, input.workspaceId), isNotNull(maintenanceRecords.deletedAt)))
          .all();
        const ids = input.recordIds === 'all' ? trashed.map((row) => row.id) : [...input.recordIds];
        // Every one named must be in Trash of this Workspace: otherwise nothing is deleted.
        if (ids.some((id) => !trashed.some((row) => row.id === id))) throw new Refusal('record_not_found');
        for (let start = 0; start < ids.length; start += 500) {
          const chunk = ids.slice(start, start + 500);
          markLinksOfPurged(tx, input.workspaceId, 'maintenance', chunk, input.at, actor.displayName);
          tx.delete(maintenanceRecords).where(and(eq(maintenanceRecords.workspaceId, input.workspaceId), inArray(maintenanceRecords.id, chunk), isNotNull(maintenanceRecords.deletedAt))).run();
        }
        for (const id of ids) {
          recordAuditEvent(tx, { workspaceId: input.workspaceId, type: 'MAINTENANCE_PURGED', actor, subjectType: 'maintenance', subjectId: id, occurredAt: input.at, metadata: { title: trashed.find((row) => row.id === id)?.title ?? '' } });
        }
        return { purged: ids.length };
      });
    },

    async links(workspaceId, recordId, scope) {
      if (liveRecord(db, workspaceId, recordId) === undefined) return undefined;
      return db
        .select()
        .from(links)
        .where(and(eq(links.workspaceId, workspaceId), eq(links.fromType, 'maintenance'), eq(links.fromId, recordId)))
        .orderBy(asc(links.createdAt), asc(links.id))
        .all()
        .filter((row) => (scope.documents || row.toType !== 'document') && recordToolEnabled(db, workspaceId, row.toType, row.toId))
        .map((row) => linkOf(db, row));
    },

    async addLink(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        const current = liveRecord(tx, input.workspaceId, input.recordId);
        if (current === undefined) throw new Refusal('record_not_found');
        // A Document only where the Documents tool is on: a tool that is off does not exist.
        if (!recordToolEnabled(tx, input.workspaceId, input.target.type, input.target.id)) throw new Refusal('target_not_found');
        if (input.target.type === 'document' && !input.scope.documents) throw new Refusal('target_not_found');
        // The other end must be a record of this Workspace that is there. (The database checks the Workspace once more.)
        const target = linkedRecord(tx, input.workspaceId, input.target.type, input.target.id, { at: null, by: null });
        if (target.state === 'gone' || target.state === 'deleted' || target.state === 'trash') throw new Refusal('target_not_found');
        const mine = and(eq(links.workspaceId, input.workspaceId), eq(links.fromType, 'maintenance'), eq(links.fromId, current.id));
        if (tx.select({ id: links.id }).from(links).where(and(mine, eq(links.toType, input.target.type), eq(links.toId, input.target.id))).get() !== undefined) throw new Refusal('already_linked');
        if ((tx.select({ n: count() }).from(links).where(mine).get()?.n ?? 0) >= MAX_LINKS_PER_MAINTENANCE_RECORD) throw new Refusal('limit_reached');
        // A Link is a row naming two ids. Nothing of the other record is read into this one, and the
        // record's status is not touched — whatever is linked, and whatever becomes of it later.
        const row = tx
          .insert(links)
          .values({ id: randomUUID(), workspaceId: input.workspaceId, fromType: 'maintenance', fromId: current.id, toType: input.target.type, toId: input.target.id, createdByUserId: actor.userId, createdByDisplayName: actor.displayName, createdAt: input.at })
          .returning()
          .get();
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: 'MAINTENANCE_LINK_ADDED',
          actor,
          subjectType: 'maintenance',
          subjectId: current.id,
          occurredAt: input.at,
          metadata: { title: current.title, linkedType: input.target.type, linkedId: input.target.id, linkedTitle: target.title ?? '' },
        });
        return { link: linkOf(tx, row) };
      });
    },

    async removeLink(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        const row = tx
          .select()
          .from(links)
          // A MaintenanceRecord's Link only: every tool removes its own.
          .where(and(eq(links.workspaceId, input.workspaceId), eq(links.id, input.linkId), eq(links.fromType, 'maintenance')))
          .get();
        if (row === undefined) throw new Refusal('link_not_found');
        tx.delete(links).where(eq(links.id, row.id)).run();
        recordAuditEvent(tx, { workspaceId: input.workspaceId, type: 'MAINTENANCE_LINK_REMOVED', actor, subjectType: 'maintenance', subjectId: row.fromId, occurredAt: input.at, metadata: { linkedType: row.toType, linkedId: row.toId } });
        return {};
      });
    },
  };
}
