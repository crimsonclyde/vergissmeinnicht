import { createHash, randomUUID } from 'node:crypto';
import { GazetteConflictError, GazetteNotFoundError, GazetteOperationConflictError, NotAuthorizedError, type GazetteRepository, type StoredGazetteSettings } from '@vergissmeinnicht/application';
import { defaultGazetteSettings, gazetteOldestKept, parseTimeZone, type GazetteEdition, type GazetteSettings, type LocalDate, type TimeZoneName, type User, type WorkspaceId } from '@vergissmeinnicht/domain';
import { roleHasCapability, type WorkspaceCapability } from '@vergissmeinnicht/permissions';
import { and, desc, eq, gte, lt, lte, ne } from 'drizzle-orm';
import { actorAllowed, IMMEDIATE, type Transaction } from './actor-guard.ts';
import type { AppDatabase } from './connection.ts';
import { gazetteEditions, gazetteOperations, gazetteSettings, users, workspaces } from './schema.ts';
import { recordSecurityEvent } from './security-events.ts';

type Reader = Pick<Transaction, 'select'>;
const actorStamp = (actor: User) => ({ kind: 'user' as const, userId: actor.id, displayName: actor.displayName });
const guard = (tx: Transaction, workspaceId: WorkspaceId, actor: User, capability: WorkspaceCapability) =>
  actorAllowed(tx, workspaceId, actorStamp(actor), { tool: 'GAZETTE', actorMay: role => roleHasCapability(role, capability) });

/** Operation receipts are kept this long: a retry is expected within minutes, a day-old retry is a new import. */
export const GAZETTE_OPERATION_RETENTION_MS = 3 * 86_400_000;

function workspaceZone(tx: Reader, workspaceId: string): TimeZoneName | null {
  const zone = tx.select({ location: workspaces.location }).from(workspaces).where(eq(workspaces.id, workspaceId)).get()?.location?.timeZone;
  if (!zone) return null;
  try { return parseTimeZone(zone); } catch { return null; }
}
export function storedGazetteSettings(tx: Reader, workspaceId: string): StoredGazetteSettings {
  const row = tx.select().from(gazetteSettings).where(eq(gazetteSettings.workspaceId, workspaceId)).get();
  return row ? { settings: row.settings, revision: row.revision } : { settings: defaultGazetteSettings(workspaceZone(tx, workspaceId)), revision: 0 };
}

const view = (row: typeof gazetteEditions.$inferSelect): GazetteEdition => ({
  id: row.id, date: row.editionDate as LocalDate, state: row.state, title: row.content.title, revision: row.revision,
  publishedAt: row.publishedAt ?? null, updatedAt: row.updatedAt, updatedBy: row.updatedBy, content: row.content,
});
const summary = (edition: GazetteEdition) => ({ id: edition.id, date: edition.date, state: edition.state, title: edition.title, revision: edition.revision, publishedAt: edition.publishedAt, updatedAt: edition.updatedAt, updatedBy: edition.updatedBy });
const hashOf = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function createGazetteRepository({ db }: AppDatabase): GazetteRepository {
  const nameOf = (tx: Transaction, actor: User) => tx.select({ name: users.name }).from(users).where(eq(users.id, actor.id)).get()?.name ?? actor.displayName;
  const event = (tx: Transaction, actor: User, workspaceId: WorkspaceId, at: Date, edition: { id: string; editionDate: string; state: string; revision: number }, action: string) =>
    recordSecurityEvent(tx, { type: 'GAZETTE_EDITION_CHANGED', actor: actorStamp(actor), subjectType: 'workspace', subjectId: workspaceId, occurredAt: at, metadata: { editionId: edition.id, date: edition.editionDate, state: edition.state, revision: edition.revision, action } });
  return {
    async settings(workspaceId) { return storedGazetteSettings(db, workspaceId); },

    async saveSettings(workspaceId, actor, settings, expectedRevision, at) {
      return db.transaction(tx => {
        if (!guard(tx, workspaceId, actor, 'gazette.manage')) throw new NotAuthorizedError();
        const current = storedGazetteSettings(tx, workspaceId);
        if (current.revision !== expectedRevision) throw new GazetteConflictError();
        const revision = expectedRevision + 1;
        if (current.revision === 0) tx.insert(gazetteSettings).values({ workspaceId, settings, revision, updatedAt: at, updatedByUserId: actor.id }).run();
        else tx.update(gazetteSettings).set({ settings, revision, updatedAt: at, updatedByUserId: actor.id }).where(eq(gazetteSettings.workspaceId, workspaceId)).run();
        recordSecurityEvent(tx, { type: 'GAZETTE_SETTINGS_CHANGED', actor: actorStamp(actor), subjectType: 'workspace', subjectId: workspaceId, occurredAt: at, metadata: { revision, retentionDays: settings.retentionDays, sections: settings.sections.length } });
        return { settings, revision };
      }, IMMEDIATE);
    },

    async write(workspaceId, actor, input, at) {
      return db.transaction(tx => {
        if (!guard(tx, workspaceId, actor, 'gazette.publish')) throw new NotAuthorizedError();
        const payloadHash = hashOf({ content: input.content, publish: input.publish });
        if (input.operationId) {
          const done = tx.select().from(gazetteOperations).where(eq(gazetteOperations.id, input.operationId)).get();
          if (done) {
            if (done.workspaceId !== workspaceId || done.payloadHash !== payloadHash) throw new GazetteOperationConflictError();
            const row = tx.select().from(gazetteEditions).where(and(eq(gazetteEditions.id, done.editionId), eq(gazetteEditions.workspaceId, workspaceId))).get()
              ?? tx.select().from(gazetteEditions).where(and(eq(gazetteEditions.workspaceId, workspaceId), eq(gazetteEditions.editionDate, done.editionDate), eq(gazetteEditions.state, 'PUBLISHED'))).get();
            if (!row) throw new GazetteNotFoundError();
            return { edition: view(row), duplicate: true };
          }
        }
        const state = input.publish ? 'PUBLISHED' as const : 'DRAFT' as const;
        const date = input.content.date;
        const existing = tx.select().from(gazetteEditions).where(and(eq(gazetteEditions.workspaceId, workspaceId), eq(gazetteEditions.editionDate, date), eq(gazetteEditions.state, state))).get();
        if (input.expectedRevision !== null && input.expectedRevision !== (existing?.revision ?? 0)) throw new GazetteConflictError();
        const name = nameOf(tx, actor);
        const stamps = { content: input.content, revision: (existing?.revision ?? 0) + 1, publishedAt: input.publish ? at : null, updatedAt: at, updatedByUserId: actor.id, updatedBy: name };
        let id: string;
        if (existing) { id = existing.id; tx.update(gazetteEditions).set(stamps).where(eq(gazetteEditions.id, id)).run(); }
        else { id = randomUUID(); tx.insert(gazetteEditions).values({ id, workspaceId, editionDate: date, state, createdAt: at, createdByUserId: actor.id, ...stamps }).run(); }
        if (input.operationId) tx.insert(gazetteOperations).values({ id: input.operationId, workspaceId, userId: actor.id, payloadHash, editionId: id, editionDate: date, at }).run();
        const saved = tx.select().from(gazetteEditions).where(eq(gazetteEditions.id, id)).get();
        if (!saved) throw new GazetteNotFoundError();
        event(tx, actor, workspaceId, at, saved, existing ? 'replaced' : 'created');
        return { edition: view(saved), duplicate: false };
      }, IMMEDIATE);
    },

    async publish(workspaceId, actor, editionId, expectedRevision, revalidate, at) {
      return db.transaction(tx => {
        if (!guard(tx, workspaceId, actor, 'gazette.publish')) throw new NotAuthorizedError();
        const row = tx.select().from(gazetteEditions).where(and(eq(gazetteEditions.id, editionId), eq(gazetteEditions.workspaceId, workspaceId))).get();
        if (!row) throw new GazetteNotFoundError();
        // Publishing the edition that is already published is a no-op: retries are safe.
        if (row.state === 'PUBLISHED') { if (row.revision !== expectedRevision) throw new GazetteConflictError(); return view(row); }
        if (row.revision !== expectedRevision) throw new GazetteConflictError();
        const content = revalidate(row.content);
        tx.delete(gazetteEditions).where(and(eq(gazetteEditions.workspaceId, workspaceId), eq(gazetteEditions.editionDate, row.editionDate), eq(gazetteEditions.state, 'PUBLISHED'))).run();
        tx.update(gazetteEditions).set({ state: 'PUBLISHED', content, revision: row.revision + 1, publishedAt: at, updatedAt: at, updatedByUserId: actor.id, updatedBy: nameOf(tx, actor) }).where(eq(gazetteEditions.id, editionId)).run();
        const saved = tx.select().from(gazetteEditions).where(eq(gazetteEditions.id, editionId)).get();
        if (!saved) throw new GazetteNotFoundError();
        event(tx, actor, workspaceId, at, saved, 'published');
        return view(saved);
      }, IMMEDIATE);
    },

    async deleteDraft(workspaceId, actor, editionId, at) {
      db.transaction(tx => {
        if (!guard(tx, workspaceId, actor, 'gazette.publish')) throw new NotAuthorizedError();
        const row = tx.select().from(gazetteEditions).where(and(eq(gazetteEditions.id, editionId), eq(gazetteEditions.workspaceId, workspaceId), eq(gazetteEditions.state, 'DRAFT'))).get();
        if (!row) throw new GazetteNotFoundError();
        tx.delete(gazetteEditions).where(eq(gazetteEditions.id, editionId)).run();
        event(tx, actor, workspaceId, at, row, 'draft_deleted');
      }, IMMEDIATE);
    },

    async list(workspaceId, oldest, includeDrafts) {
      return db.select().from(gazetteEditions)
        .where(and(eq(gazetteEditions.workspaceId, workspaceId), gte(gazetteEditions.editionDate, oldest), includeDrafts ? undefined : eq(gazetteEditions.state, 'PUBLISHED')))
        .orderBy(desc(gazetteEditions.editionDate), desc(gazetteEditions.state)).limit(100).all().map(row => summary(view(row)));
    },
    async findById(workspaceId, id) {
      const row = db.select().from(gazetteEditions).where(and(eq(gazetteEditions.id, id), eq(gazetteEditions.workspaceId, workspaceId))).get();
      return row ? view(row) : undefined;
    },
    async findByDate(workspaceId, date, state) {
      const row = db.select().from(gazetteEditions).where(and(eq(gazetteEditions.workspaceId, workspaceId), eq(gazetteEditions.editionDate, date), eq(gazetteEditions.state, state))).get();
      return row ? view(row) : undefined;
    },
    async latestPublished(workspaceId, onOrBefore) {
      const row = db.select().from(gazetteEditions).where(and(eq(gazetteEditions.workspaceId, workspaceId), eq(gazetteEditions.state, 'PUBLISHED'), lte(gazetteEditions.editionDate, onOrBefore)))
        .orderBy(desc(gazetteEditions.editionDate)).limit(1).get();
      return row ? view(row) : undefined;
    },
  };
}

/**
 * Retention (43): per Workspace, editions dated before the oldest kept day (in the Workspace's Gazette time
 * zone) are deleted — except the newest published edition, which stays until a newer one replaces it, so the
 * Dashboard never goes empty only because an import was missed. Old operation receipts go too. Settings and
 * anything outside the Gazette are never touched. One transaction.
 */
export function purgeGazette({ db }: Pick<AppDatabase, 'db'>, now: Date = new Date()): { readonly editions: number; readonly operations: number } {
  return db.transaction(tx => {
    const workspaceIds = [...new Set(tx.selectDistinct({ id: gazetteEditions.workspaceId }).from(gazetteEditions).all().map(row => row.id))];
    let editions = 0;
    for (const workspaceId of workspaceIds) {
      const settings: GazetteSettings = storedGazetteSettings(tx, workspaceId).settings;
      const oldest = gazetteOldestKept(settings, now);
      const keep = tx.select({ id: gazetteEditions.id }).from(gazetteEditions)
        .where(and(eq(gazetteEditions.workspaceId, workspaceId), eq(gazetteEditions.state, 'PUBLISHED')))
        .orderBy(desc(gazetteEditions.editionDate)).limit(1).get()?.id;
      editions += tx.delete(gazetteEditions).where(and(eq(gazetteEditions.workspaceId, workspaceId), lt(gazetteEditions.editionDate, oldest), keep ? ne(gazetteEditions.id, keep) : undefined))
        .returning({ id: gazetteEditions.id }).all().length;
    }
    const operations = tx.delete(gazetteOperations).where(lt(gazetteOperations.at, new Date(now.getTime() - GAZETTE_OPERATION_RETENTION_MS))).returning({ id: gazetteOperations.id }).all().length;
    return { editions, operations };
  }, IMMEDIATE);
}
