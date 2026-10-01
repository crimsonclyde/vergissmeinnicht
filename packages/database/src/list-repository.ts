import { randomUUID } from 'node:crypto';
import { and, asc, count, eq, isNotNull, isNull, max, sql } from 'drizzle-orm';
import type { ListRepository, ListSummary, ListWithItems } from '@vergissmeinnicht/application';
import type { List, ListId, ListItem, ListItemId, UserId, WorkspaceId } from '@vergissmeinnicht/domain';
import { IMMEDIATE, actorAllowed, type Transaction } from './actor-guard.ts';
import { recordAuditEvent } from './audit-events.ts';
import type { AppDatabase } from './connection.ts';
import { listItems, lists } from './schema.ts';

type Reader = Pick<Transaction, 'select'>;

function toList(row: typeof lists.$inferSelect): List {
  return {
    id: row.id as ListId,
    workspaceId: row.workspaceId as WorkspaceId,
    kind: row.kind,
    title: row.title,
    revision: row.revision,
    created: { at: row.createdAt, by: { userId: row.createdByUserId as UserId, displayName: row.createdByDisplayName } },
    updatedAt: row.updatedAt,
    deleted:
      row.deletedAt === null || row.deletedByUserId === null || row.deletedByDisplayName === null
        ? null
        : { at: row.deletedAt, by: { userId: row.deletedByUserId as UserId, displayName: row.deletedByDisplayName } },
  };
}

function toItem(row: typeof listItems.$inferSelect): ListItem {
  return {
    id: row.id as ListItemId,
    listId: row.listId as ListId,
    title: row.title,
    quantity: row.quantity,
    unit: row.unit,
    position: row.position,
    revision: row.revision,
    created: { at: row.createdAt, by: { userId: row.createdByUserId as UserId, displayName: row.createdByDisplayName } },
    checked:
      row.checkedAt === null || row.checkedByUserId === null || row.checkedByDisplayName === null
        ? null
        : { at: row.checkedAt, by: { userId: row.checkedByUserId as UserId, displayName: row.checkedByDisplayName } },
  };
}

/** The List row inside its Workspace; `deleted` chooses between live and deleted Lists. */
function findRow(db: Reader, workspaceId: WorkspaceId, listId: ListId, deleted = false) {
  return db
    .select()
    .from(lists)
    .where(and(eq(lists.workspaceId, workspaceId), eq(lists.id, listId), deleted ? isNotNull(lists.deletedAt) : isNull(lists.deletedAt)))
    .get();
}

const itemsOf = (listId: string) => and(eq(listItems.listId, listId), isNull(listItems.deletedAt));

function withItems(db: Reader, row: typeof lists.$inferSelect): ListWithItems {
  const items = db.select().from(listItems).where(itemsOf(row.id)).orderBy(asc(listItems.position), asc(listItems.id)).all();
  return { list: toList(row), items: items.map(toItem) };
}

/** An item of this List; `removed` chooses between present and removed items. */
function findItem(db: Reader, listId: ListId, itemId: ListItemId, removed = false) {
  return db
    .select()
    .from(listItems)
    .where(and(eq(listItems.listId, listId), eq(listItems.id, itemId), removed ? isNotNull(listItems.deletedAt) : isNull(listItems.deletedAt)))
    .get();
}

/** Every change of a List or its items raises the List's revision. */
function touch(tx: Transaction, listId: string, at: Date) {
  return tx
    .update(lists)
    .set({ revision: sql`${lists.revision} + 1`, updatedAt: at })
    .where(eq(lists.id, listId))
    .returning()
    .get();
}

const liveLists = (tx: Reader, workspaceId: WorkspaceId) =>
  tx.select({ n: count() }).from(lists).where(and(eq(lists.workspaceId, workspaceId), isNull(lists.deletedAt))).get()?.n ?? 0;

const liveItems = (tx: Reader, listId: string) => tx.select({ n: count() }).from(listItems).where(itemsOf(listId)).get()?.n ?? 0;

export function createListRepository({ db }: Pick<AppDatabase, 'db'>): ListRepository {
  return {
    async listForWorkspace(workspaceId) {
      return db.transaction((tx): ListSummary[] =>
        tx
          .select()
          .from(lists)
          .where(and(eq(lists.workspaceId, workspaceId), isNull(lists.deletedAt)))
          .orderBy(asc(lists.createdAt), asc(lists.id))
          .all()
          .map((row) => {
            const checked = tx.select({ n: count() }).from(listItems).where(and(itemsOf(row.id), isNotNull(listItems.checkedAt))).get()?.n ?? 0;
            return { list: toList(row), open: liveItems(tx, row.id) - checked, checked };
          }),
      );
    },

    async find(workspaceId, listId) {
      return db.transaction((tx) => {
        const row = findRow(tx, workspaceId, listId);
        return row && withItems(tx, row);
      });
    },

    async create(input, actor, guard) {
      return db.transaction((tx) => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' } as const;
        if (liveLists(tx, input.workspaceId) >= input.maxLists) return { status: 'limit_reached' } as const;
        const row = tx
          .insert(lists)
          .values({
            id: randomUUID(),
            workspaceId: input.workspaceId,
            kind: input.kind,
            title: input.title,
            revision: 1,
            createdByUserId: actor.userId,
            createdByDisplayName: actor.displayName,
            createdAt: input.at,
            updatedAt: input.at,
          })
          .returning()
          .get();
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: 'LIST_CREATED',
          actor,
          subjectType: 'list',
          subjectId: row.id,
          occurredAt: input.at,
          metadata: { title: row.title, kind: row.kind },
        });
        return { status: 'ok', list: withItems(tx, row) } as const;
      }, IMMEDIATE);
    },

    async rename(input, actor, guard) {
      return db.transaction((tx) => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' } as const;
        const row = findRow(tx, input.workspaceId, input.listId);
        if (row === undefined) return { status: 'list_not_found' } as const;
        if (row.title !== input.expectedTitle) return { status: 'conflict' } as const;
        if (row.title === input.title) return { status: 'ok', list: withItems(tx, row) } as const;
        tx.update(lists).set({ title: input.title }).where(eq(lists.id, row.id)).run();
        const renamed = touch(tx, row.id, input.at);
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: 'LIST_RENAMED',
          actor,
          subjectType: 'list',
          subjectId: row.id,
          occurredAt: input.at,
          metadata: { title: input.title, previousTitle: row.title },
        });
        return { status: 'ok', list: withItems(tx, renamed) } as const;
      }, IMMEDIATE);
    },

    async delete(input, actor, guard) {
      return db.transaction((tx) => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' } as const;
        const row = findRow(tx, input.workspaceId, input.listId);
        if (row === undefined) return { status: 'list_not_found' } as const;
        tx.update(lists).set({ deletedAt: input.at, deletedByUserId: actor.userId, deletedByDisplayName: actor.displayName }).where(eq(lists.id, row.id)).run();
        const deleted = touch(tx, row.id, input.at);
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: 'LIST_DELETED',
          actor,
          subjectType: 'list',
          subjectId: row.id,
          occurredAt: input.at,
          metadata: { title: row.title },
        });
        return { status: 'ok', list: withItems(tx, deleted) } as const;
      }, IMMEDIATE);
    },

    async restore(input, actor, guard) {
      return db.transaction((tx) => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' } as const;
        const row = findRow(tx, input.workspaceId, input.listId, true);
        if (row === undefined) return { status: 'list_not_found' } as const;
        if (liveLists(tx, input.workspaceId) >= input.maxLists) return { status: 'limit_reached' } as const;
        tx.update(lists).set({ deletedAt: null, deletedByUserId: null, deletedByDisplayName: null }).where(eq(lists.id, row.id)).run();
        const restored = touch(tx, row.id, input.at);
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: 'LIST_RESTORED',
          actor,
          subjectType: 'list',
          subjectId: row.id,
          occurredAt: input.at,
          metadata: { title: row.title },
        });
        return { status: 'ok', list: withItems(tx, restored) } as const;
      }, IMMEDIATE);
    },

    async addItem(input, actor, guard) {
      return db.transaction((tx) => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' } as const;
        const row = findRow(tx, input.workspaceId, input.listId);
        if (row === undefined) return { status: 'list_not_found' } as const;
        if (liveItems(tx, row.id) >= input.maxItems) return { status: 'limit_reached' } as const;
        // After every item ever added (removed ones keep their place for Undo).
        const last = tx.select({ position: max(listItems.position) }).from(listItems).where(eq(listItems.listId, row.id)).get()?.position;
        const itemId = randomUUID() as ListItemId;
        tx.insert(listItems)
          .values({
            id: itemId,
            listId: row.id,
            workspaceId: row.workspaceId,
            position: last === null || last === undefined ? 0 : last + 1,
            title: input.title,
            quantity: input.quantity,
            unit: input.unit,
            revision: 1,
            createdByUserId: actor.userId,
            createdByDisplayName: actor.displayName,
            createdAt: input.at,
          })
          .run();
        return { status: 'ok', list: withItems(tx, touch(tx, row.id, input.at)), itemId } as const;
      }, IMMEDIATE);
    },

    async updateItem(input, actor, guard) {
      return db.transaction((tx) => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' } as const;
        const row = findRow(tx, input.workspaceId, input.listId);
        if (row === undefined) return { status: 'list_not_found' } as const;
        const item = findItem(tx, row.id as ListId, input.itemId);
        if (item === undefined) return { status: 'item_not_found' } as const;
        if (item.revision !== input.expectedRevision) return { status: 'conflict' } as const;
        tx.update(listItems)
          .set({ title: input.title, quantity: input.quantity, unit: input.unit, revision: item.revision + 1 })
          .where(and(eq(listItems.id, item.id), eq(listItems.revision, item.revision)))
          .run();
        return { status: 'ok', list: withItems(tx, touch(tx, row.id, input.at)) } as const;
      }, IMMEDIATE);
    },

    async setItemChecked(input, actor, guard) {
      return db.transaction((tx) => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' } as const;
        const row = findRow(tx, input.workspaceId, input.listId);
        if (row === undefined) return { status: 'list_not_found' } as const;
        const item = findItem(tx, row.id as ListId, input.itemId);
        if (item === undefined) return { status: 'item_not_found' } as const;
        // Already in that state (e.g. two people in the shop ticked it): nothing changes, nobody is overwritten.
        if ((item.checkedAt !== null) === input.checked) return { status: 'ok', list: withItems(tx, row) } as const;
        tx.update(listItems)
          .set(
            input.checked
              ? { checkedAt: input.at, checkedByUserId: actor.userId, checkedByDisplayName: actor.displayName }
              : { checkedAt: null, checkedByUserId: null, checkedByDisplayName: null },
          )
          .where(eq(listItems.id, item.id))
          .run();
        return { status: 'ok', list: withItems(tx, touch(tx, row.id, input.at)) } as const;
      }, IMMEDIATE);
    },

    async removeItem(input, actor, guard) {
      return db.transaction((tx) => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' } as const;
        const row = findRow(tx, input.workspaceId, input.listId);
        if (row === undefined) return { status: 'list_not_found' } as const;
        const item = findItem(tx, row.id as ListId, input.itemId);
        if (item === undefined) return { status: 'item_not_found' } as const;
        tx.update(listItems).set({ deletedAt: input.at }).where(eq(listItems.id, item.id)).run();
        return { status: 'ok', list: withItems(tx, touch(tx, row.id, input.at)) } as const;
      }, IMMEDIATE);
    },

    async restoreItem(input, actor, guard) {
      return db.transaction((tx) => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' } as const;
        const row = findRow(tx, input.workspaceId, input.listId);
        if (row === undefined) return { status: 'list_not_found' } as const;
        const item = findItem(tx, row.id as ListId, input.itemId, true);
        if (item === undefined) return { status: 'item_not_found' } as const;
        if (liveItems(tx, row.id) >= input.maxItems) return { status: 'limit_reached' } as const;
        tx.update(listItems).set({ deletedAt: null }).where(eq(listItems.id, item.id)).run();
        return { status: 'ok', list: withItems(tx, touch(tx, row.id, input.at)) } as const;
      }, IMMEDIATE);
    },
  };
}
