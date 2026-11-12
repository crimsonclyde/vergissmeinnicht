import { awardProgress } from './progress-repository.ts';
import { enabledTool } from './tool-policy.ts';
import { createHash, randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, lt, max, sql } from 'drizzle-orm';
import type { ListBatchResult, ListItemEdit, ListReplayInput, ListReplayResult, ListRepository, ListSummary, ListWithItems } from '@vergissmeinnicht/application';
import { assertListItemKind, type List, type ListId, type ListItem, type ListItemId, type ListReplayOutcome, type UserId, type WorkspaceId } from '@vergissmeinnicht/domain';
import { IMMEDIATE, actorAllowed, type Transaction, type UserActor } from './actor-guard.ts';
import { roleHasCapability } from '@vergissmeinnicht/permissions';
import { attachmentView, type AttachmentConsumerPolicy } from './attachment-repository.ts';
import { recordSecurityEvent } from './security-events.ts';
import { currentDelegation } from './delegation-context.ts';
import { recordAuditEvent } from './audit-events.ts';
import type { AppDatabase } from './connection.ts';
import { attachments, listClientChanges, listItemOperations, listItems, lists } from './schema.ts';

type Reader = Pick<Transaction, 'select'>;

function toList(row: typeof lists.$inferSelect): List {
  return {
    id: row.id as ListId,
    workspaceId: row.workspaceId as WorkspaceId,
    kind: row.kind,
    icon: row.icon,
    coverId: row.coverId,
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

// The delegated Lists scopes were granted for grocery content only.
const mayUseCovers = () => {
  const delegation = currentDelegation();
  return !delegation || delegation.scope === 'lists.covers.write';
};
const delegatedListKind = () => mayUseCovers() ? undefined : eq(lists.kind, 'GROCERY');

export const listAttachmentPolicy: AttachmentConsumerPolicy = {
  key: 'lists',
  guard: (tx, scope, actor) => 'workspaceId' in scope && mayUseCovers()
    && actorAllowed(tx, scope.workspaceId as WorkspaceId,
      { kind: 'user', userId: actor.id, displayName: actor.displayName },
      { tool: 'LISTS', actorMay: role => roleHasCapability(role, 'list.edit') }),
  uploadTargetExists: (tx, workspaceId, id) => !!findRow(tx, workspaceId as WorkspaceId, id as ListId),
  // The HTTP adapter exposes only the current cover of an authorized List.
  visible: (_scope, actor) => sql`(${attachments.uploadedBy} = ${actor.id} OR EXISTS (
    SELECT 1 FROM ${lists} WHERE ${lists.coverId} = ${attachments.id} AND ${lists.deletedAt} IS NULL
  ))`,
};

/** The List row inside its Workspace; `deleted` chooses between live and deleted Lists. */
function findRow(db: Reader, workspaceId: WorkspaceId, listId: ListId, deleted = false) {
  return db
    .select()
    .from(lists)
    .where(and(enabledTool(workspaceId, 'LISTS'), eq(lists.workspaceId, workspaceId), eq(lists.id, listId), delegatedListKind(), deleted ? isNotNull(lists.deletedAt) : isNull(lists.deletedAt)))
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
        kind: change.listKind,
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
      assertListItemKind(row.kind, change);
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
      assertListItemKind(row.kind, change);
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
      if (change.checked) awardProgress(tx, actor.userId, { workspaceId: input.workspaceId }, `${input.workspaceId}:${item.id}`, 'LIST_ITEM_CHECKED', at);
      break;
    }
    case 'removeItem':
      tx.update(listItems).set({ deletedAt: at, deletedByDisplayName: actor.displayName }).where(eq(listItems.id, item.id)).run();
      break;
  }
  touch(tx, row.id, at);
  return applied;
}

/** Soft delete, as the app's single-item removal: kept with who removed it, so it can be put back. */
const softRemove = (tx: Transaction, itemId: string, at: Date, actor: UserActor) =>
  tx.update(listItems).set({ deletedAt: at, deletedByDisplayName: actor.displayName }).where(eq(listItems.id, itemId)).run();

type BatchKind = 'MOVE' | 'REMOVE' | 'UPDATE' | 'RESTORE';
/** Order-independent: a retry that lists the same items in another order is the same request. */
const batchHash = (kind: BatchKind, request: Record<string, unknown> & { itemIds: readonly string[] }) =>
  createHash('sha256').update(JSON.stringify({ kind, ...request, itemIds: [...request.itemIds].sort() })).digest('hex');

/**
 * The remembered answer to this operation id (36.18), after forgetting old ones: `undefined` for a
 * new id, the first answer for the same request again, `operation_reused` for anything else.
 */
function priorBatch(tx: Transaction, input: { operationId: string; workspaceId: WorkspaceId; keepSince: Date }, actor: UserActor, kind: BatchKind, hash: string): ListBatchResult | undefined {
  tx.delete(listItemOperations).where(lt(listItemOperations.at, input.keepSince)).run();
  const prior = tx.select().from(listItemOperations).where(eq(listItemOperations.id, input.operationId)).get();
  if (prior === undefined) return undefined;
  if (prior.userId !== actor.userId || prior.workspaceId !== input.workspaceId || prior.kind !== kind || prior.payloadHash !== hash) return { status: 'operation_reused' };
  return { status: 'ok', duplicate: true, itemIds: prior.result.itemIds as ListItemId[], revisions: prior.result.revisions };
}

/** The named items that are removed from this List (36.19), in List order; `missing` keeps the caller's order. */
function removedSelection(tx: Reader, listId: string, itemIds: readonly ListItemId[]) {
  const rows = tx.select().from(listItems).where(and(eq(listItems.listId, listId), isNotNull(listItems.deletedAt), inArray(listItems.id, [...itemIds]))).orderBy(asc(listItems.position), asc(listItems.id)).all();
  const found = new Set(rows.map((row) => row.id));
  return { rows, missing: itemIds.filter((id) => !found.has(id)) };
}

/** Only the fields an edit names, so the request hash does not depend on how a client spells "unchanged". */
const editKey = (edit: ListItemEdit) => ({
  itemId: edit.itemId,
  ...(edit.title === undefined ? {} : { title: edit.title }),
  ...(edit.quantity === undefined ? {} : { quantity: edit.quantity }),
  ...(edit.unit === undefined ? {} : { unit: edit.unit }),
  ...(edit.checked === undefined ? {} : { checked: edit.checked }),
});

/** The named items that are live in this List, in List order; `missing` keeps the caller's order. */
function liveSelection(tx: Reader, listId: string, itemIds: readonly ListItemId[]) {
  const rows = tx.select().from(listItems).where(and(itemsOf(listId), inArray(listItems.id, [...itemIds]))).orderBy(asc(listItems.position), asc(listItems.id)).all();
  const found = new Set(rows.map((row) => row.id));
  return { rows, missing: itemIds.filter((id) => !found.has(id)) };
}

export function createListRepository({ db }: Pick<AppDatabase, 'db'>): ListRepository {
  return {
    async snapshot(workspaceId) {
      return db.transaction((tx) =>
        tx
          .select()
          .from(lists)
          .where(and(enabledTool(workspaceId, 'LISTS'), eq(lists.workspaceId, workspaceId), delegatedListKind(), isNull(lists.deletedAt)))
          .orderBy(asc(lists.createdAt), asc(lists.id))
          .all()
          .map((row) => withItems(tx, row)),
      );
    },

    async replay(input, actor, guard) {
      return db.transaction((tx): ListReplayResult => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' };
        // Scope delegated requests before consulting any replay receipt or applying the change.
        if (currentDelegation()) {
          const { change, workspaceId } = input;
          const toDo = change.kind === 'createList' ? change.listKind === 'TODO' : tx.select({ id: lists.id }).from(lists)
            .where(and(eq(lists.id, change.listId), eq(lists.workspaceId, workspaceId), eq(lists.kind, 'TODO'))).get();
          if (toDo) return { status: 'done', outcome: 'NOT_FOUND', duplicate: false, by: null, byAt: null, list: null };
        }
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
          .where(and(enabledTool(workspaceId, 'LISTS'), eq(lists.workspaceId, workspaceId), delegatedListKind(), isNull(lists.deletedAt)))
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

    async findCover(workspaceId, listId, attachmentId, actor, guard) {
      return db.transaction(tx => {
        if (!actorAllowed(tx, workspaceId, actor, guard)) return undefined;
        const row = findRow(tx, workspaceId, listId);
        if (row?.coverId !== attachmentId) return undefined;
        const file = tx.select().from(attachments).where(and(eq(attachments.id, attachmentId),
          eq(attachments.workspaceId, workspaceId), eq(attachments.policyKey, 'lists'), eq(attachments.deleting, false))).get();
        return file && attachmentView(file);
      });
    },

    async changeAppearance(input, actor, guard) {
      return db.transaction(tx => {
        if (!mayUseCovers() || !actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' } as const;
        const row = findRow(tx, input.workspaceId, input.listId);
        if (!row) return { status: 'list_not_found' } as const;
        const { appearance } = input;
        const icon = appearance.icon === undefined ? row.icon : appearance.icon;
        const coverId = appearance.coverId === undefined ? row.coverId : appearance.coverId;
        if (icon === row.icon && coverId === row.coverId) return { status: 'ok', list: withItems(tx, row) } as const;
        if (input.expectedRevision !== row.revision) return { status: 'conflict' } as const;
        if (coverId && coverId !== row.coverId) {
          const file = tx.select({ id: attachments.id }).from(attachments).where(and(eq(attachments.id, coverId),
            eq(attachments.workspaceId, row.workspaceId), eq(attachments.policyKey, 'lists'),
            eq(attachments.uploadedBy, actor.userId), eq(attachments.deleting, false))).get();
          const claimed = tx.select({ id: lists.id }).from(lists).where(eq(lists.coverId, coverId)).get();
          if (!file || claimed) return { status: 'cover_not_found' } as const;
        }
        const saved = tx.update(lists).set({ icon, coverId, revision: row.revision + 1, updatedAt: input.at })
          .where(eq(lists.id, row.id)).returning().get();
        recordSecurityEvent(tx, { type: 'ATTACHMENT_CHANGED', actor, subjectType: 'workspace', subjectId: row.workspaceId,
          occurredAt: input.at, metadata: { action: 'list_appearance', listId: row.id, hasCover: coverId !== null } });
        return { status: 'ok', list: withItems(tx, saved) } as const;
      }, IMMEDIATE);
    },

    async create(input, actor, guard) {
      return db.transaction((tx) => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard) || (currentDelegation() && input.kind !== 'GROCERY')) return { status: 'forbidden' } as const;
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
        assertListItemKind(row.kind, input);
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
        assertListItemKind(row.kind, input);
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
        if (input.checked) awardProgress(tx, actor.userId, { workspaceId: input.workspaceId }, `${input.workspaceId}:${item.id}`, 'LIST_ITEM_CHECKED', input.at);
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
        softRemove(tx, item.id, input.at, actor);
        return { status: 'ok', list: withItems(tx, touch(tx, row.id, input.at)) } as const;
      }, IMMEDIATE);
    },

    async moveItems(input, actor, guard) {
      return db.transaction((tx): ListBatchResult => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' };
        const hash = batchHash('MOVE', {
          workspaceId: input.workspaceId,
          sourceListId: input.sourceListId,
          destinationListId: input.destinationListId,
          itemIds: input.itemIds,
          expectedSourceRevision: input.expectedSourceRevision,
          expectedDestinationRevision: input.expectedDestinationRevision,
        });
        const prior = priorBatch(tx, input, actor, 'MOVE', hash);
        if (prior !== undefined) return prior;
        // Both Lists are looked up inside this Workspace only: another Workspace's List is "not found".
        const source = findRow(tx, input.workspaceId, input.sourceListId);
        const destination = findRow(tx, input.workspaceId, input.destinationListId);
        if (source === undefined || destination === undefined || source.id === destination.id) return { status: 'list_not_found' };
        if (source.kind !== destination.kind) return { status: 'kind_mismatch' };
        if (source.revision !== input.expectedSourceRevision || destination.revision !== input.expectedDestinationRevision) return { status: 'stale_revision' };
        const { rows, missing } = liveSelection(tx, source.id, input.itemIds);
        if (missing.length > 0) return { status: 'invalid_items', itemIds: missing };
        if (liveItems(tx, destination.id) + rows.length > input.maxItems) return { status: 'limit_reached' };
        const last = tx.select({ position: max(listItems.position) }).from(listItems).where(eq(listItems.listId, destination.id)).get()?.position;
        const start = last === null || last === undefined ? 0 : last + 1;
        // Same rows, new List: ids, text, quantity, unit, checked state and every stamp stay as they are.
        rows.forEach((row, offset) => {
          tx.update(listItems).set({ listId: destination.id, position: start + offset }).where(and(eq(listItems.id, row.id), eq(listItems.listId, source.id))).run();
        });
        const revisions = { [source.id]: touch(tx, source.id, input.at).revision, [destination.id]: touch(tx, destination.id, input.at).revision };
        const itemIds = rows.map((row) => row.id as ListItemId);
        tx.insert(listItemOperations).values({ id: input.operationId, userId: actor.userId, workspaceId: input.workspaceId, kind: 'MOVE', payloadHash: hash, result: { itemIds, revisions }, at: input.at }).run();
        recordSecurityEvent(tx, {
          type: 'LIST_ITEMS_MOVED',
          actor,
          subjectType: 'workspace',
          subjectId: input.workspaceId,
          occurredAt: input.at,
          metadata: { sourceListId: source.id, destinationListId: destination.id, count: itemIds.length },
        });
        return { status: 'ok', duplicate: false, itemIds, revisions };
      }, IMMEDIATE);
    },

    async removeItems(input, actor, guard) {
      return db.transaction((tx): ListBatchResult => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' };
        const hash = batchHash('REMOVE', { workspaceId: input.workspaceId, listId: input.listId, itemIds: input.itemIds, expectedRevision: input.expectedRevision });
        const prior = priorBatch(tx, input, actor, 'REMOVE', hash);
        if (prior !== undefined) return prior;
        const row = findRow(tx, input.workspaceId, input.listId);
        if (row === undefined) return { status: 'list_not_found' };
        if (row.revision !== input.expectedRevision) return { status: 'stale_revision' };
        // Already removed, unknown or another List's: refused, and nothing else is removed either.
        const { rows, missing } = liveSelection(tx, row.id, input.itemIds);
        if (missing.length > 0) return { status: 'invalid_items', itemIds: missing };
        for (const item of rows) softRemove(tx, item.id, input.at, actor);
        const revisions = { [row.id]: touch(tx, row.id, input.at).revision };
        const itemIds = rows.map((item) => item.id as ListItemId);
        tx.insert(listItemOperations).values({ id: input.operationId, userId: actor.userId, workspaceId: input.workspaceId, kind: 'REMOVE', payloadHash: hash, result: { itemIds, revisions }, at: input.at }).run();
        recordSecurityEvent(tx, {
          type: 'LIST_ITEMS_REMOVED',
          actor,
          subjectType: 'workspace',
          subjectId: input.workspaceId,
          occurredAt: input.at,
          metadata: { listId: row.id, count: itemIds.length },
        });
        return { status: 'ok', duplicate: false, itemIds, revisions };
      }, IMMEDIATE);
    },

    async updateItems(input, actor, guard) {
      return db.transaction((tx): ListBatchResult => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' };
        const edits = [...input.edits].map(editKey).sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
        const hash = batchHash('UPDATE', { workspaceId: input.workspaceId, listId: input.listId, itemIds: input.itemIds, edits, expectedRevision: input.expectedRevision });
        const prior = priorBatch(tx, input, actor, 'UPDATE', hash);
        if (prior !== undefined) return prior;
        const row = findRow(tx, input.workspaceId, input.listId);
        if (row === undefined) return { status: 'list_not_found' };
        if (row.revision !== input.expectedRevision) return { status: 'stale_revision' };
        const { rows, missing } = liveSelection(tx, row.id, input.itemIds);
        if (missing.length > 0) return { status: 'invalid_items', itemIds: missing };
        const byId = new Map(input.edits.map((edit) => [edit.itemId as string, edit]));
        // A To-do task has only a title: the whole edit is refused before anything changes.
        if (row.kind === 'TODO' && input.edits.some((edit) => (edit.quantity ?? null) !== null || (edit.unit ?? null) !== null)) return { status: 'kind_mismatch' };
        let checkedCount = 0;
        for (const item of rows) {
          const edit = byId.get(item.id);
          if (edit === undefined) continue;
          const title = edit.title ?? item.title;
          const quantity = edit.quantity === undefined ? item.quantity : edit.quantity;
          const unit = edit.unit === undefined ? item.unit : edit.unit;
          const contentChanged = title !== item.title || quantity !== item.quantity || unit !== item.unit;
          const checkChanged = edit.checked !== undefined && (item.checkedAt !== null) !== edit.checked;
          if (!contentChanged && !checkChanged) continue;
          tx.update(listItems)
            .set({
              ...(contentChanged ? { title, quantity, unit, revision: item.revision + 1, contentChangedAt: input.at, contentChangedByDisplayName: actor.displayName } : {}),
              ...(checkChanged
                ? {
                    ...(edit.checked
                      ? { checkedAt: input.at, checkedByUserId: actor.userId, checkedByDisplayName: actor.displayName }
                      : { checkedAt: null, checkedByUserId: null, checkedByDisplayName: null }),
                    checkChangedAt: input.at,
                    checkChangedByDisplayName: actor.displayName,
                  }
                : {}),
            })
            .where(eq(listItems.id, item.id))
            .run();
          if (checkChanged && edit.checked) {
            checkedCount += 1;
            awardProgress(tx, actor.userId, { workspaceId: input.workspaceId }, `${input.workspaceId}:${item.id}`, 'LIST_ITEM_CHECKED', input.at);
          }
        }
        const revisions = { [row.id]: touch(tx, row.id, input.at).revision };
        const itemIds = rows.map((item) => item.id as ListItemId);
        tx.insert(listItemOperations).values({ id: input.operationId, userId: actor.userId, workspaceId: input.workspaceId, kind: 'UPDATE', payloadHash: hash, result: { itemIds, revisions }, at: input.at }).run();
        recordSecurityEvent(tx, {
          type: 'LIST_ITEMS_UPDATED',
          actor,
          subjectType: 'workspace',
          subjectId: input.workspaceId,
          occurredAt: input.at,
          metadata: { listId: row.id, count: itemIds.length, checked: checkedCount },
        });
        return { status: 'ok', duplicate: false, itemIds, revisions };
      }, IMMEDIATE);
    },

    async restoreItems(input, actor, guard) {
      return db.transaction((tx): ListBatchResult => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' };
        const hash = batchHash('RESTORE', { workspaceId: input.workspaceId, listId: input.listId, itemIds: input.itemIds, expectedRevision: input.expectedRevision });
        const prior = priorBatch(tx, input, actor, 'RESTORE', hash);
        if (prior !== undefined) return prior;
        const row = findRow(tx, input.workspaceId, input.listId);
        if (row === undefined) return { status: 'list_not_found' };
        if (row.revision !== input.expectedRevision) return { status: 'stale_revision' };
        // Live, unknown or another List's: refused, and nothing else is put back either.
        const { rows, missing } = removedSelection(tx, row.id, input.itemIds);
        if (missing.length > 0) return { status: 'invalid_items', itemIds: missing };
        if (liveItems(tx, row.id) + rows.length > input.maxItems) return { status: 'limit_reached' };
        for (const item of rows) tx.update(listItems).set({ deletedAt: null, deletedByDisplayName: null }).where(eq(listItems.id, item.id)).run();
        const revisions = { [row.id]: touch(tx, row.id, input.at).revision };
        const itemIds = rows.map((item) => item.id as ListItemId);
        tx.insert(listItemOperations).values({ id: input.operationId, userId: actor.userId, workspaceId: input.workspaceId, kind: 'RESTORE', payloadHash: hash, result: { itemIds, revisions }, at: input.at }).run();
        recordSecurityEvent(tx, {
          type: 'LIST_ITEMS_RESTORED',
          actor,
          subjectType: 'workspace',
          subjectId: input.workspaceId,
          occurredAt: input.at,
          metadata: { listId: row.id, count: itemIds.length },
        });
        return { status: 'ok', duplicate: false, itemIds, revisions };
      }, IMMEDIATE);
    },

    async removedItems(workspaceId, listId, limit) {
      return db.transaction((tx) => {
        const row = findRow(tx, workspaceId, listId);
        if (row === undefined) return undefined;
        return tx
          .select()
          .from(listItems)
          .where(and(eq(listItems.listId, row.id), isNotNull(listItems.deletedAt)))
          .orderBy(desc(listItems.deletedAt), asc(listItems.id))
          .limit(limit)
          .all()
          .map((item) => ({ item: toItem(item), removedAt: item.deletedAt as Date, removedBy: item.deletedByDisplayName }));
      });
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
