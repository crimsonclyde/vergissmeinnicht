import { randomUUID } from 'node:crypto';
import type { ActorGuard, ContactDuplicate, ContactProcedureLink, ContactRecord, ContactRefusal, ContactRepository, ContactSummary, ContactWrite, ProcedureContactLink } from '@vergissmeinnicht/application';
import {
  MAX_CONTACTS_PER_WORKSPACE,
  MAX_LINKS_PER_CONTACT,
  contactCategoryKey,
  contactKeys as keysOf,
  contactSearchText,
  contactSortKey,
  containsPattern,
  type ContactContent,
  type ContactId,
  type ContactKeyKind,
  type LinkId,
  type WorkspaceId,
} from '@vergissmeinnicht/domain';
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { IMMEDIATE, actorAllowed, type Transaction, type UserActor } from './actor-guard.ts';
import { recordAuditEvent } from './audit-events.ts';
import type { AppDatabase } from './connection.ts';
import { markLinksOfPurged } from './link-repository.ts';
import { contactKeys, contacts, links, procedures, workspaceTools } from './schema.ts';

type Reader = Pick<Transaction, 'select'>;
type ContactRow = typeof contacts.$inferSelect;

/** Rolls the transaction back with a refusal: nothing of a refused write is kept. */
class Refusal extends Error {
  readonly status: ContactRefusal;
  constructor(status: ContactRefusal) {
    super(status);
    this.status = status;
  }
}

const summary = (row: ContactRow): ContactSummary => ({ id: row.id as ContactId, name: row.name, organisation: row.organisation, category: row.category, emails: row.emails, phones: row.phones, revision: row.revision });

const record = (row: ContactRow): ContactRecord => ({
  ...summary(row),
  address: row.address,
  website: row.website,
  notes: row.notes,
  createdAt: row.createdAt,
  createdByName: row.createdByDisplayName,
  updatedAt: row.updatedAt,
  updatedByName: row.updatedByDisplayName,
});

function toolEnabled(tx: Reader, workspaceId: string): boolean {
  return (
    tx
      .select({ enabled: workspaceTools.enabled })
      .from(workspaceTools)
      .where(and(eq(workspaceTools.workspaceId, workspaceId), eq(workspaceTools.tool, 'CONTACTS')))
      .get()?.enabled === true
  );
}

function liveContact(tx: Reader, workspaceId: string, contactId: string): ContactRow | undefined {
  return tx
    .select()
    .from(contacts)
    .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.id, contactId), isNull(contacts.deletedAt)))
    .get();
}

const liveCount = (tx: Reader, workspaceId: string): number =>
  tx
    .select({ n: count() })
    .from(contacts)
    .where(and(eq(contacts.workspaceId, workspaceId), isNull(contacts.deletedAt)))
    .get()?.n ?? 0;

/** The columns derived from the content, written with every change. */
const derived = (content: ContactContent) => ({ sortKey: contactSortKey(content.name), categoryKey: contactCategoryKey(content.category), searchText: contactSearchText(content) });

const stored = (content: ContactContent) => ({
  name: content.name,
  organisation: content.organisation,
  category: content.category,
  emails: content.emails.map((each) => ({ value: each.value, label: each.label })),
  phones: content.phones.map((each) => ({ value: each.value, label: each.label })),
  address: content.address,
  website: content.website,
  notes: content.notes,
  ...derived(content),
});

function writeKeys(tx: Transaction, workspaceId: string, contactId: string, content: ContactContent): void {
  tx.delete(contactKeys).where(eq(contactKeys.contactId, contactId)).run();
  const keys = keysOf(content);
  if (keys.length > 0) tx.insert(contactKeys).values(keys.map((key) => ({ contactId, workspaceId, kind: key.kind, key: key.key }))).run();
}

function insertContact(tx: Transaction, workspaceId: string, content: ContactContent, actor: UserActor, at: Date): ContactRow {
  const who = { createdByUserId: actor.userId, createdByDisplayName: actor.displayName, createdAt: at, updatedByUserId: actor.userId, updatedByDisplayName: actor.displayName, updatedAt: at };
  const row = tx
    .insert(contacts)
    .values({ id: randomUUID(), workspaceId, ...stored(content), ...who })
    .returning()
    .get();
  writeKeys(tx, workspaceId, row.id, content);
  return row;
}

function procedureLink(tx: Reader, row: typeof links.$inferSelect): ContactProcedureLink {
  const procedure = tx
    .select({ title: procedures.title, deletedAt: procedures.deletedAt })
    .from(procedures)
    .where(and(eq(procedures.workspaceId, row.workspaceId), eq(procedures.id, row.toId)))
    .get();
  return {
    id: row.id as LinkId,
    procedureId: row.toId,
    title: procedure?.title ?? null,
    state: procedure === undefined ? 'gone' : procedure.deletedAt === null ? 'ok' : 'deleted',
    createdAt: row.createdAt,
    createdByName: row.createdByDisplayName,
  };
}

/** Contacts (16.6). See `ContactRepository`. */
export function createContactRepository({ db }: Pick<AppDatabase, 'db'>): ContactRepository {
  /** One write: IMMEDIATE transaction, actor and tool re-checked first; a `Refusal` rolls everything back. */
  function write<T>(workspaceId: WorkspaceId, actor: UserActor, guard: ActorGuard, change: (tx: Transaction) => T): ContactWrite<T> {
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
    async find(workspaceId, query, after, limit) {
      const where: SQL[] = [];
      if (query.category !== null) where.push(eq(contacts.categoryKey, query.category));
      for (const term of query.terms) where.push(sql`${contacts.searchText} like ${containsPattern(term)} escape '\\'`);
      const scope = and(eq(contacts.workspaceId, workspaceId), isNull(contacts.deletedAt), ...where);
      const rows = db
        .select()
        .from(contacts)
        .where(after === null ? scope : and(scope, or(gt(contacts.sortKey, after.value), and(eq(contacts.sortKey, after.value), gt(contacts.id, after.id)))))
        .orderBy(asc(contacts.sortKey), asc(contacts.id))
        .limit(limit + 1)
        .all();
      const shown = rows.slice(0, limit);
      const last = shown.at(-1);
      const total = after === null ? (rows.length <= limit ? rows.length : (db.select({ n: count() }).from(contacts).where(scope).get()?.n ?? 0)) : null;
      return { contacts: shown.map(summary), next: rows.length > limit && last !== undefined ? { value: last.sortKey, id: last.id } : null, total };
    },

    async categories(workspaceId) {
      const rows = db
        .select({ key: contacts.categoryKey, name: sql<string>`min(${contacts.category})` })
        .from(contacts)
        .where(and(eq(contacts.workspaceId, workspaceId), isNull(contacts.deletedAt), ne(contacts.categoryKey, '')))
        .groupBy(contacts.categoryKey)
        .orderBy(asc(contacts.categoryKey))
        .all();
      return rows.map((row) => row.name);
    },

    async get(workspaceId, contactId) {
      const row = liveContact(db, workspaceId, contactId);
      return row === undefined ? undefined : record(row);
    },

    async duplicatesOf(workspaceId, keys, except) {
      const found = new Map<string, Set<ContactKeyKind>>();
      for (const kind of ['email', 'phone', 'name'] as const) {
        const values = keys.filter((key) => key.kind === kind).map((key) => key.key);
        if (values.length === 0) continue;
        const rows = db
          .select({ id: contactKeys.contactId })
          .from(contactKeys)
          .innerJoin(contacts, eq(contacts.id, contactKeys.contactId))
          .where(and(eq(contactKeys.workspaceId, workspaceId), eq(contactKeys.kind, kind), inArray(contactKeys.key, values), isNull(contacts.deletedAt)))
          .all();
        for (const row of rows) {
          if (row.id === except) continue;
          found.set(row.id, (found.get(row.id) ?? new Set()).add(kind));
        }
      }
      if (found.size === 0) return [];
      // At most a handful are shown; a common name could match many.
      const ids = [...found.keys()].slice(0, 20);
      return db
        .select({ id: contacts.id, name: contacts.name, organisation: contacts.organisation })
        .from(contacts)
        .where(and(eq(contacts.workspaceId, workspaceId), inArray(contacts.id, ids)))
        .orderBy(asc(contacts.sortKey), asc(contacts.id))
        .all()
        .map((row): ContactDuplicate => ({ id: row.id as ContactId, name: row.name, organisation: row.organisation, reasons: [...(found.get(row.id) ?? [])] }));
    },

    async create(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        if (liveCount(tx, input.workspaceId) >= MAX_CONTACTS_PER_WORKSPACE) throw new Refusal('limit_reached');
        const row = insertContact(tx, input.workspaceId, input.content, actor, input.at);
        // No name, no number: history is never rewritten, and a Contact can be deleted for good.
        recordAuditEvent(tx, { workspaceId: input.workspaceId, type: 'CONTACT_CREATED', actor, subjectType: 'contact', subjectId: row.id, occurredAt: input.at, metadata: {} });
        return { contact: record(row) };
      });
    },

    async update(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        const current = liveContact(tx, input.workspaceId, input.contactId);
        if (current === undefined) throw new Refusal('contact_not_found');
        if (current.revision !== input.expectedRevision) throw new Refusal('conflict');
        const row = tx
          .update(contacts)
          .set({ ...stored(input.content), revision: current.revision + 1, updatedByUserId: actor.userId, updatedByDisplayName: actor.displayName, updatedAt: input.at })
          .where(eq(contacts.id, current.id))
          .returning()
          .get();
        writeKeys(tx, input.workspaceId, current.id, input.content);
        recordAuditEvent(tx, { workspaceId: input.workspaceId, type: 'CONTACT_UPDATED', actor, subjectType: 'contact', subjectId: current.id, occurredAt: input.at, metadata: {} });
        return { contact: record(row) };
      });
    },

    async delete(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        const current = liveContact(tx, input.workspaceId, input.contactId);
        if (current === undefined) throw new Refusal('contact_not_found');
        tx.update(contacts)
          .set({ deletedAt: input.at, deletedByUserId: actor.userId, deletedByDisplayName: actor.displayName, revision: current.revision + 1 })
          .where(eq(contacts.id, current.id))
          .run();
        recordAuditEvent(tx, { workspaceId: input.workspaceId, type: 'CONTACT_DELETED', actor, subjectType: 'contact', subjectId: current.id, occurredAt: input.at, metadata: {} });
        return {};
      });
    },

    async restore(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        const current = tx
          .select()
          .from(contacts)
          .where(and(eq(contacts.workspaceId, input.workspaceId), eq(contacts.id, input.contactId), isNotNull(contacts.deletedAt)))
          .get();
        if (current === undefined) throw new Refusal('contact_not_found');
        if (liveCount(tx, input.workspaceId) >= MAX_CONTACTS_PER_WORKSPACE) throw new Refusal('limit_reached');
        const row = tx
          .update(contacts)
          .set({ deletedAt: null, deletedByUserId: null, deletedByDisplayName: null, revision: current.revision + 1 })
          .where(eq(contacts.id, current.id))
          .returning()
          .get();
        recordAuditEvent(tx, { workspaceId: input.workspaceId, type: 'CONTACT_RESTORED', actor, subjectType: 'contact', subjectId: current.id, occurredAt: input.at, metadata: {} });
        return { contact: record(row) };
      });
    },

    async listTrash(workspaceId) {
      return db
        .select()
        .from(contacts)
        .where(and(eq(contacts.workspaceId, workspaceId), isNotNull(contacts.deletedAt)))
        .orderBy(desc(contacts.deletedAt), asc(contacts.sortKey), asc(contacts.id))
        .all()
        .flatMap((row) => (row.deletedAt === null || row.deletedByDisplayName === null ? [] : [{ id: row.id as ContactId, name: row.name, organisation: row.organisation, deletedAt: row.deletedAt, deletedByName: row.deletedByDisplayName }]));
    },

    async purge(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        const trashed = tx
          .select({ id: contacts.id })
          .from(contacts)
          .where(and(eq(contacts.workspaceId, input.workspaceId), isNotNull(contacts.deletedAt)))
          .all()
          .map((row) => row.id);
        const ids = input.contactIds === 'all' ? trashed : [...input.contactIds];
        // Every one named must be in Trash of this Workspace: otherwise nothing is deleted.
        if (ids.some((id) => !trashed.includes(id))) throw new Refusal('contact_not_found');
        for (let start = 0; start < ids.length; start += 500) {
          const chunk = ids.slice(start, start + 500);
          // Links to them say "deleted contact" from now on.
          markLinksOfPurged(tx, input.workspaceId, 'contact', chunk, input.at, actor.displayName);
          tx.delete(contactKeys).where(inArray(contactKeys.contactId, chunk)).run();
          tx.delete(contacts).where(and(eq(contacts.workspaceId, input.workspaceId), inArray(contacts.id, chunk), isNotNull(contacts.deletedAt))).run();
        }
        // The id only: nothing of the person stays behind.
        for (const id of ids) recordAuditEvent(tx, { workspaceId: input.workspaceId, type: 'CONTACT_PURGED', actor, subjectType: 'contact', subjectId: id, occurredAt: input.at, metadata: {} });
        return { purged: ids.length };
      });
    },

    async importMany(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        if (liveCount(tx, input.workspaceId) + input.contents.length > MAX_CONTACTS_PER_WORKSPACE) throw new Refusal('limit_reached');
        for (const content of input.contents) insertContact(tx, input.workspaceId, content, actor, input.at);
        recordAuditEvent(tx, { workspaceId: input.workspaceId, type: 'CONTACTS_IMPORTED', actor, subjectType: 'workspace', subjectId: input.workspaceId, occurredAt: input.at, metadata: { format: input.format, contacts: input.contents.length } });
        return { created: input.contents.length };
      });
    },

    async exportAll(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        const rows = tx
          .select()
          .from(contacts)
          .where(and(eq(contacts.workspaceId, input.workspaceId), isNull(contacts.deletedAt)))
          .orderBy(asc(contacts.sortKey), asc(contacts.id))
          .all();
        recordAuditEvent(tx, { workspaceId: input.workspaceId, type: 'CONTACTS_EXPORTED', actor, subjectType: 'workspace', subjectId: input.workspaceId, occurredAt: input.at, metadata: { format: input.format, contacts: rows.length } });
        return { contacts: rows.map(record) };
      });
    },

    async procedureLinks(workspaceId, contactId) {
      if (liveContact(db, workspaceId, contactId) === undefined) return undefined;
      return db
        .select()
        .from(links)
        .where(and(eq(links.workspaceId, workspaceId), eq(links.fromType, 'contact'), eq(links.fromId, contactId), eq(links.toType, 'procedure')))
        .orderBy(asc(links.createdAt), asc(links.id))
        .all()
        .map((row) => procedureLink(db, row));
    },

    async linksOfProcedure(workspaceId, procedureId) {
      return db
        .select()
        .from(links)
        .where(and(eq(links.workspaceId, workspaceId), eq(links.fromType, 'contact'), eq(links.toType, 'procedure'), eq(links.toId, procedureId)))
        .orderBy(asc(links.createdAt), asc(links.id))
        .all()
        .map((row): ProcedureContactLink => {
          // In Trash or deleted for good: a "deleted contact" — that one was linked, not who.
          const contact = row.fromGoneAt === null ? liveContact(db, workspaceId, row.fromId) : undefined;
          return { id: row.id as LinkId, contact: contact === undefined ? null : summary(contact) };
        });
    },

    async linkProcedure(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        const contact = liveContact(tx, input.workspaceId, input.contactId);
        if (contact === undefined) throw new Refusal('contact_not_found');
        const procedure = tx
          .select({ id: procedures.id })
          .from(procedures)
          .where(and(eq(procedures.workspaceId, input.workspaceId), eq(procedures.id, input.procedureId), isNull(procedures.deletedAt)))
          .get();
        if (procedure === undefined) throw new Refusal('procedure_not_found');
        const mine = and(eq(links.workspaceId, input.workspaceId), eq(links.fromType, 'contact'), eq(links.fromId, contact.id));
        if (tx.select({ id: links.id }).from(links).where(and(mine, eq(links.toType, 'procedure'), eq(links.toId, procedure.id))).get() !== undefined) throw new Refusal('already_linked');
        if ((tx.select({ n: count() }).from(links).where(mine).get()?.n ?? 0) >= MAX_LINKS_PER_CONTACT) throw new Refusal('limit_reached');
        const row = tx
          .insert(links)
          .values({ id: randomUUID(), workspaceId: input.workspaceId, fromType: 'contact', fromId: contact.id, toType: 'procedure', toId: procedure.id, createdByUserId: actor.userId, createdByDisplayName: actor.displayName, createdAt: input.at })
          .returning()
          .get();
        recordAuditEvent(tx, { workspaceId: input.workspaceId, type: 'CONTACT_LINK_ADDED', actor, subjectType: 'contact', subjectId: contact.id, occurredAt: input.at, metadata: { linkedType: 'procedure', linkedId: procedure.id } });
        return { link: procedureLink(tx, row) };
      });
    },

    async unlinkProcedure(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        const row = tx
          .select()
          .from(links)
          .where(and(eq(links.workspaceId, input.workspaceId), eq(links.id, input.linkId), eq(links.fromType, 'contact')))
          .get();
        if (row === undefined) throw new Refusal('link_not_found');
        tx.delete(links).where(eq(links.id, row.id)).run();
        recordAuditEvent(tx, { workspaceId: input.workspaceId, type: 'CONTACT_LINK_REMOVED', actor, subjectType: 'contact', subjectId: row.fromId, occurredAt: input.at, metadata: { linkedType: row.toType, linkedId: row.toId } });
        return {};
      });
    },
  };
}
