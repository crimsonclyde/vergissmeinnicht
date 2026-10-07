import { enabledTool } from './tool-policy.ts';
import { randomUUID } from 'node:crypto';
import { and, asc, count, eq, isNotNull, isNull, lt, max, sql } from 'drizzle-orm';
import type { ListReplayInput, ListReplayResult, ListRepository, ListSummary, ListWithItems } from '@vergissmeinnicht/application';
import type { List, ListId, ListItem, ListItemId, ListReplayOutcome, UserId, WorkspaceId } from '@vergissmeinnicht/domain';
import { IMMEDIATE, actorAllowed, type Transaction, type UserActor } from './actor-guard.ts';
import { recordAuditEvent } from './audit-events.ts';
import type { AppDatabase } from './connection.ts';
import { listClientChanges, listItems, lists } from './schema.ts';

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
    .where(and(enabledTool(workspaceId, 'LISTS'), eq(lists.workspaceId, workspaceId), eq(lists.id, listId), deleted ? isNotNull(lists.deletedAt) : isNull(lists.deletedAt)))
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
  tx.select({ n: count() }).from(lists).where(and(enabledTool(workspaceId, 'LISTS'), eq(lists.workspaceId, workspaceId), isNull(lists.deletedAt))).get()?.n ?? 0;

const liveItems = (tx: Reader, listId: string) => tx.select({ n: count() }).from(listItems).where(itemsOf(listId)).get()?.n ?? 0;

/** A new item's change stamps: name and checked state both set now, by its creator. */
const changeStamps = (at: Date, actor: UserActor) => ({ contentChangedAt: at, contentChangedByDisplayName: actor.displayName, checkChangedAt: at, checkChangedByDisplayName: actor.displayName });

/** What one replayed change did: its outcome and, when another change won, whose and when. */
interface Applied {
  readonly outcome: ListReplayOutcome;
  readonly by: string | null;
  readonly byAt: Date | null;
}
const applied: Applied = { outcome: 'APPLIED', by: null, byAt: null };
const lostTo = (outcome: ListReplayOutcome, by: string | null, byAt: Date | null): Applied => ({ outcome, by, byAt });

/** Any List with this id, in any Workspace — a client-chosen id must not be another List's. */
const anyList = (tx: Reader, listId: string) => tx.select().from(lists).where(eq(lists.id, listId)).get();
const anyItem = (tx: Reader, itemId: string) => tx.select({ id: listItems.id }).from(listItems).where(eq(listItems.id, itemId)).get();

/**
 * One change made offline (17.5), inside the replay transaction. The later change wins per part —
 * compared by when each was made — a removal wins over an edit or a check, and a deleted List wins
 * over every change to it. Returns 'id_taken' when a client-chosen id belongs to something else.
 */
function applyChange(tx: Transaction, input: ListReplayInput, actor: UserActor): Applied | 'id_taken' {
  const { change, madeAt, at } = input;
  if (change.kind === 'createList') {
    if (anyList(tx, change.listId) !== undefined) return 'id_taken';
    if (liveLists(tx, input.workspaceId) >= input.maxLists) return lostTo('LIMIT_REACHED', null, null);
    const row = tx
      .insert(lists)
      .values({
        id: change.listId,
        workspaceId: input.workspaceId,
        kind: 'GROCERY',
        title: change.title,
        revision: 1,
        createdByUserId: actor.userId,
        createdByDisplayName: actor.displayName,
        createdAt: at,
        updatedAt: at,
        titleChangedAt: madeAt,
        titleChangedByDisplayName: actor.displayName,
      })
      .returning()
      .get();
    recordAuditEvent(tx, { workspaceId: input.workspaceId, type: 'LIST_CREATED', actor, subjectType: 'list', subjectId: row.id, occurredAt: at, metadata: { title: row.title, kind: row.kind, offline: true }, clientChangeId: input.clientChangeId });
    return applied;
  }
  // The List of this Workspace (Lists switched on), deleted or not.
  const row = tx.select().from(lists).where(and(enabledTool(input.workspaceId, 'LISTS'), eq(lists.workspaceId, input.workspaceId), eq(lists.id, change.listId))).get();
  if (row === undefined) return lostTo('NOT_FOUND', null, null);
  if (row.deletedAt !== null) return change.kind === 'deleteList' ? applied : lostTo('LIST_DELETED', row.deletedByDisplayName, row.deletedAt);
  switch (change.kind) {
    case 'renameList': {
      if (row.titleChangedAt > madeAt) return lostTo('OVERRIDDEN', row.titleChangedByDisplayName, row.titleChangedAt);
      if (row.title === change.title) return applied;
      tx.update(lists).set({ title: change.title, titleChangedAt: madeAt, titleChangedByDisplayName: actor.displayName }).where(eq(lists.id, row.id)).run();
      touch(tx, row.id, at);
      recordAuditEvent(tx, { workspaceId: input.workspaceId, type: 'LIST_RENAMED', actor, subjectType: 'list', subjectId: row.id, occurredAt: at, metadata: { title: change.title, previousTitle: row.title, offline: true }, clientChangeId: input.clientChangeId });
      return applied;
    }
    case 'deleteList': {
      // Deleting wins over everything changed meanwhile.
      tx.update(lists).set({ deletedAt: at, deletedByUserId: actor.userId, deletedByDisplayName: actor.displayName }).where(eq(lists.id, row.id)).run();
      touch(tx, row.id, at);
      recordAuditEvent(tx, { workspaceId: input.workspaceId, type: 'LIST_DELETED', actor, subjectType: 'list', subjectId: row.id, occurredAt: at, metadata: { title: row.title, offline: true }, clientChangeId: input.clientChangeId });
      return applied;
    }
    case 'addItem': {
      if (anyItem(tx, change.itemId) !== undefined) return 'id_taken';
      if (liveItems(tx, row.id) >= input.maxItems) return lostTo('LIMIT_REACHED', null, null);
      const last = tx.select({ position: max(listItems.position) }).from(listItems).where(eq(listItems.listId, row.id)).get()?.position;
      tx.insert(listItems)
        .values({
          id: change.itemId,
          listId: row.id,
          workspaceId: row.workspaceId,
          position: last === null || last === undefined ? 0 : last + 1,
          title: change.title,
          quantity: change.quantity,
          unit: change.unit,
          revision: 1,
          createdByUserId: actor.userId,
          createdByDisplayName: actor.displayName,
          createdAt: at,
          ...changeStamps(madeAt, actor),
        })
        .run();
      touch(tx, row.id, at);
      return applied;
    }
  }
  const item = tx.select().from(listItems).where(and(eq(listItems.listId, row.id), eq(listItems.id, change.itemId))).get();
  if (item === undefined) return lostTo('NOT_FOUND', null, null);
  // A removal wins over an edit or a check, whenever either was made.
  if (item.deletedAt !== null) return change.kind === 'removeItem' ? applied : lostTo('ITEM_REMOVED', item.deletedByDisplayName, item.deletedAt);
  switch (change.kind) {
    case 'editItem': {
      if (item.contentChangedAt > madeAt) return lostTo('OVERRIDDEN', item.contentChangedByDisplayName, item.contentChangedAt);
      if (item.title === change.title && item.quantity === change.quantity && item.unit === change.unit) return applied;
      tx.update(listItems)
        .set({ title: change.title, quantity: change.quantity, unit: change.unit, revision: item.revision + 1, contentChangedAt: madeAt, contentChangedByDisplayName: actor.displayName })
        .where(eq(listItems.id, item.id))
        .run();
      break;
    }
    case 'checkItem': {
      // Already so (two people in the shop): nothing to decide.
      if ((item.checkedAt !== null) === change.checked) return applied;
      if (item.checkChangedAt > madeAt) return lostTo('OVERRIDDEN', item.checkChangedByDisplayName, item.checkChangedAt);
      tx.update(listItems)
        .set({
          ...(change.checked ? { checkedAt: madeAt, checkedByUserId: actor.userId, checkedByDisplayName: actor.displayName } : { checkedAt: null, checkedByUserId: null, checkedByDisplayName: null }),
          checkChangedAt: madeAt,
          checkChangedByDisplayName: actor.displayName,
        })
        .where(eq(listItems.id, item.id))
        .run();
      break;
    }
    case 'removeItem':
      tx.update(listItems).set({ deletedAt: at, deletedByDisplayName: actor.displayName }).where(eq(listItems.id, item.id)).run();
      break;
  }
  touch(tx, row.id, at);
  return applied;
}

export function createListRepository({ db }: Pick<AppDatabase, 'db'>): ListRepository {
  return {
    async snapshot(workspaceId) {
      return db.transaction((tx) =>
        tx
          .select()
          .from(lists)
          .where(and(enabledTool(workspaceId, 'LISTS'), eq(lists.workspaceId, workspaceId), isNull(lists.deletedAt)))
          .orderBy(asc(lists.createdAt), asc(lists.id))
          .all()
          .map((row) => withItems(tx, row)),
      );
    },

    async replay(input, actor, guard) {
      return db.transaction((tx): ListReplayResult => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' };
        tx.delete(listClientChanges).where(lt(listClientChanges.appliedAt, input.keepSince)).run();
        const current = () => {
          const row = findRow(tx, input.workspaceId, input.change.listId);
          return row === undefined ? null : withItems(tx, row);
        };
        const seen = tx
          .select()
          .from(listClientChanges)
          .where(and(eq(listClientChanges.userId, actor.userId), eq(listClientChanges.clientChangeId, input.clientChangeId)))
          .get();
        if (seen !== undefined) {
          if (seen.workspaceId !== input.workspaceId || seen.listId !== input.change.listId) return { status: 'id_taken' };
          return { status: 'done', outcome: seen.outcome, duplicate: true, by: seen.byDisplayName, byAt: seen.at, list: current() };
        }
        const result = applyChange(tx, input, actor);
        if (result === 'id_taken') return { status: 'id_taken' };
        tx.insert(listClientChanges)
          .values({
            userId: actor.userId,
            clientChangeId: input.clientChangeId,
            workspaceId: input.workspaceId,
            listId: input.change.listId,
            outcome: result.outcome,
            byDisplayName: result.by,
            at: result.byAt,
            appliedAt: input.at,
          })
          .run();
        return { status: 'done', outcome: result.outcome, duplicate: false, by: result.by, byAt: result.byAt, list: current() };
      }, IMMEDIATE);
    },

    async listForWorkspace(workspaceId) {
      return db.transaction((tx): ListSummary[] =>
        tx
          .select()
          .from(lists)
          .where(and(enabledTool(workspaceId, 'LISTS'), eq(lists.workspaceId, workspaceId), isNull(lists.deletedAt)))
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
            titleChangedAt: input.at,
            titleChangedByDisplayName: actor.displayName,
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
        tx.update(lists).set({ title: input.title, titleChangedAt: input.at, titleChangedByDisplayName: actor.displayName }).where(eq(lists.id, row.id)).run();
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
            ...changeStamps(input.at, actor),
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
          .set({ title: input.title, quantity: input.quantity, unit: input.unit, revision: item.revision + 1, contentChangedAt: input.at, contentChangedByDisplayName: actor.displayName })
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
            {
              ...(input.checked
                ? { checkedAt: input.at, checkedByUserId: actor.userId, checkedByDisplayName: actor.displayName }
                : { checkedAt: null, checkedByUserId: null, checkedByDisplayName: null }),
              checkChangedAt: input.at,
              checkChangedByDisplayName: actor.displayName,
            },
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
        tx.update(listItems).set({ deletedAt: input.at, deletedByDisplayName: actor.displayName }).where(eq(listItems.id, item.id)).run();
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
        tx.update(listItems).set({ deletedAt: null, deletedByDisplayName: null }).where(eq(listItems.id, item.id)).run();
        return { status: 'ok', list: withItems(tx, touch(tx, row.id, input.at)) } as const;
      }, IMMEDIATE);
    },
  };
}
