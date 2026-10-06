import type { StorageRepository } from '@vergissmeinnicht/application';
import { DEFAULT_WORKSPACE_STORAGE_BYTES, effectiveStorageLimit, type StorageUsage, type WorkspaceId } from '@vergissmeinnicht/domain';
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import { IMMEDIATE, actorAllowed, type Transaction } from './actor-guard.ts';
import { recordAuditEvent } from './audit-events.ts';
import type { AppDatabase } from './connection.ts';
import { documentFileDerivatives, documentFileTexts, documentFiles, documentPages, documents, procedureSteps, runDocumentFiles, runSteps, stepImages, users, workspaces } from './schema.ts';
import { recordSecurityEvent } from './security-events.ts';

type Reader = Pick<Transaction, 'select'>;

export const imageReferencedByStep = sql`exists (select 1 from ${procedureSteps} where ${procedureSteps.imageId} = ${stepImages.id})`;
export const imageReferencedByRun = sql`exists (select 1 from ${runSteps} where ${runSteps.imageId} = ${stepImages.id})`;

/**
 * Which instruction images a Workspace is charged for (14.3): those referenced by a Step (also of a
 * restorable deleted Procedure) or a Run snapshot, plus uploads since `pendingSince` not referenced
 * yet. `replacing` (an image only this upload's Steps still reference) is left out.
 */
function countedImages(pendingSince: Date, replacing: string | null): SQL {
  const pending = sql`${stepImages.createdAt} >= ${pendingSince.getTime()}`;
  const charged = sql`(${imageReferencedByStep} or ${imageReferencedByRun} or ${pending})`;
  return replacing === null ? charged : sql`${charged} and not (${stepImages.id} = ${replacing} and not ${imageReferencedByRun})`;
}

/**
 * Where a file counts, as the smallest of: 0 — a Document that is not in Trash holds it, or nothing
 * does yet (an upload not saved); 1 — only Documents in Trash hold it; 2 — no Document holds it any
 * more, but a version retained for a Run does (16.5).
 */
const fileClass = sql`min(case when ${documents.id} is not null and ${documents.deletedAt} is null then 0 when ${documents.id} is not null then 1 when exists (select 1 from ${runDocumentFiles} where ${runDocumentFiles.fileId} = ${documentFiles.id}) then 2 else 0 end)`;

/**
 * The combined storage of a Workspace (16.4), by tool. Identical content is charged once per
 * Workspace (grouped by hash); content that a live Document and one in Trash share counts as live.
 * This one function is what every upload checks inside its transaction, and what every view shows.
 */
export function storageUsageIn(tx: Reader, workspaceId: string, pendingSince: Date, replacingImage: string | null = null): StorageUsage {
  const images =
    tx
      .select({ n: sql<number>`coalesce(sum(${stepImages.bytes}), 0)` })
      .from(stepImages)
      .where(and(eq(stepImages.workspaceId, workspaceId), countedImages(pendingSince, replacingImage)))
      .get()?.n ?? 0;
  const split = {
    live: sql<number>`coalesce(sum(case when class = 0 then bytes else 0 end), 0)`,
    trash: sql<number>`coalesce(sum(case when class = 1 then bytes else 0 end), 0)`,
    retained: sql<number>`coalesce(sum(case when class = 2 then bytes else 0 end), 0)`,
  };
  const originals = tx
    .select(split)
    .from(
      sql`(select max(${documentFiles.bytes}) as bytes, ${fileClass} as class from ${documentFiles} left join ${documentPages} on ${documentPages.fileId} = ${documentFiles.id} left join ${documents} on ${documents.id} = ${documentPages.documentId} where ${documentFiles.workspaceId} = ${workspaceId} group by ${documentFiles.sha256})`,
    )
    .get();
  const previews = tx
    .select(split)
    .from(
      sql`(select max(${documentFileDerivatives.bytes}) as bytes, ${fileClass} as class from ${documentFileDerivatives} inner join ${documentFiles} on ${documentFiles.id} = ${documentFileDerivatives.fileId} left join ${documentPages} on ${documentPages.fileId} = ${documentFiles.id} left join ${documents} on ${documents.id} = ${documentPages.documentId} where ${documentFiles.workspaceId} = ${workspaceId} group by ${documentFileDerivatives.sha256})`,
    )
    .get();
  // Recognised text (16.9) is derived like a preview and counts the same way, per file.
  const texts = tx
    .select(split)
    .from(
      sql`(select max(${documentFileTexts.bytes}) as bytes, ${fileClass} as class from ${documentFileTexts} inner join ${documentFiles} on ${documentFiles.id} = ${documentFileTexts.fileId} left join ${documentPages} on ${documentPages.fileId} = ${documentFiles.id} left join ${documents} on ${documents.id} = ${documentPages.documentId} where ${documentFileTexts.workspaceId} = ${workspaceId} and ${documentFileTexts.bytes} > 0 group by ${documentFileTexts.fileId})`,
    )
    .get();
  const limits = tx.select({ ceiling: workspaces.storageQuotaBytes, own: workspaces.storageLimitBytes }).from(workspaces).where(eq(workspaces.id, workspaceId)).get();
  const ceiling = limits?.ceiling ?? DEFAULT_WORKSPACE_STORAGE_BYTES;
  const ownLimit = limits?.own ?? null;
  const usage = {
    images: Number(images),
    originals: Number(originals?.live ?? 0),
    previews: Number(previews?.live ?? 0),
    text: Number(texts?.live ?? 0),
    trash: Number(originals?.trash ?? 0) + Number(previews?.trash ?? 0) + Number(texts?.trash ?? 0),
    retained: Number(originals?.retained ?? 0) + Number(previews?.retained ?? 0) + Number(texts?.retained ?? 0),
  };
  return { ...usage, used: usage.images + usage.originals + usage.previews + usage.text + usage.trash + usage.retained, limit: effectiveStorageLimit(ceiling, ownLimit), ceiling, ownLimit };
}

/** Workspace storage: usage by tool, the ceiling and the Workspace's own limit (16.4). See `StorageRepository`. */
export function createStorageRepository({ db }: Pick<AppDatabase, 'db'>): StorageRepository {
  const exists = (tx: Reader, workspaceId: string) => tx.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId)).get() !== undefined;
  return {
    async usage(workspaceId, pendingSince) {
      return exists(db, workspaceId) ? storageUsageIn(db, workspaceId, pendingSince) : undefined;
    },

    async list(pendingSince) {
      return db
        .select({ id: workspaces.id, name: workspaces.name })
        .from(workspaces)
        .orderBy(asc(workspaces.name))
        .all()
        .map((row) => ({ workspaceId: row.id as WorkspaceId, name: row.name, usage: storageUsageIn(db, row.id, pendingSince) }));
    },

    async setCeiling(input, actor) {
      return db.transaction((tx) => {
        const admin = tx.select({ status: users.status, serverAdmin: users.serverAdmin }).from(users).where(eq(users.id, actor.userId)).get();
        if (admin?.status !== 'ACTIVE' || !admin.serverAdmin) return 'forbidden';
        const current = tx.select({ ceiling: workspaces.storageQuotaBytes }).from(workspaces).where(eq(workspaces.id, input.workspaceId)).get();
        if (current === undefined) return 'not_found';
        // Lowering below the current usage deletes nothing: new storage is refused until usage is below it.
        tx.update(workspaces).set({ storageQuotaBytes: input.bytes }).where(eq(workspaces.id, input.workspaceId)).run();
        recordSecurityEvent(tx, { type: 'WORKSPACE_STORAGE_CEILING_CHANGED', actor, subjectType: 'workspace', subjectId: input.workspaceId, occurredAt: input.at, metadata: { from: current.ceiling, to: input.bytes } });
        return 'ok';
      }, IMMEDIATE);
    },

    async setLimit(input, actor, guard) {
      return db.transaction((tx) => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return 'forbidden';
        const current = tx.select({ ceiling: workspaces.storageQuotaBytes, own: workspaces.storageLimitBytes }).from(workspaces).where(eq(workspaces.id, input.workspaceId)).get();
        if (current === undefined) return 'forbidden';
        if (input.bytes !== null && input.bytes > current.ceiling) return 'above_ceiling';
        tx.update(workspaces).set({ storageLimitBytes: input.bytes }).where(eq(workspaces.id, input.workspaceId)).run();
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: 'WORKSPACE_STORAGE_LIMIT_CHANGED',
          actor,
          subjectType: 'workspace',
          subjectId: input.workspaceId,
          occurredAt: input.at,
          // 0 stands for "no own limit" (the ceiling applies).
          metadata: { from: current.own ?? 0, to: input.bytes ?? 0, ceiling: current.ceiling },
        });
        return 'ok';
      }, IMMEDIATE);
    },
  };
}
