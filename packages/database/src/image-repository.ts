import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, lt, sql, type SQL } from 'drizzle-orm';
import type { ImageRepository, ImageUsage, RegisterImageResult, StepImageRecord } from '@vergissmeinnicht/application';
import type { ImageQuota, StepImageId, WorkspaceId } from '@vergissmeinnicht/domain';
import { IMMEDIATE, actorAllowed, type Transaction } from './actor-guard.ts';
import type { AppDatabase } from './connection.ts';
import { recordSecurityEvent } from './security-events.ts';
import { procedureSteps, runSteps, stepImages, workspaces } from './schema.ts';

type Reader = Pick<Transaction, 'select'>;
type Row = typeof stepImages.$inferSelect;

const toRecord = (row: Row): StepImageRecord => ({
  id: row.id as StepImageId,
  workspaceId: row.workspaceId as WorkspaceId,
  sha256: row.sha256,
  bytes: row.bytes,
  width: row.width,
  height: row.height,
  createdAt: row.createdAt,
});

const referencedByStep = sql`exists (select 1 from ${procedureSteps} where ${procedureSteps.imageId} = ${stepImages.id})`;
const referencedByRun = sql`exists (select 1 from ${runSteps} where ${runSteps.imageId} = ${stepImages.id})`;

/**
 * What a Workspace is charged for (D11a): its distinct images referenced by a Step (also of a
 * restorable deleted Procedure) or a Run snapshot, plus uploads since `pendingSince` not referenced yet.
 * `replacing` (an image only this upload's Steps still reference) is left out.
 */
function counted(pendingSince: Date, replacing: string | null): SQL {
  const pending = sql`${stepImages.createdAt} >= ${pendingSince.getTime()}`;
  const charged = sql`(${referencedByStep} or ${referencedByRun} or ${pending})`;
  return replacing === null ? charged : sql`${charged} and not (${stepImages.id} = ${replacing} and not ${referencedByRun})`;
}

function usageIn(tx: Reader, workspaceId: string, pendingSince: Date, replacing: string | null = null): ImageUsage {
  const used =
    tx
      .select({ n: sql<number>`coalesce(sum(${stepImages.bytes}), 0)` })
      .from(stepImages)
      .where(and(eq(stepImages.workspaceId, workspaceId), counted(pendingSince, replacing)))
      .get()?.n ?? 0;
  const quota = (tx.select({ quota: workspaces.imageQuotaBytes }).from(workspaces).where(eq(workspaces.id, workspaceId)).get()?.quota ?? 100_000_000) as ImageQuota;
  return { used: Number(used), quota };
}

function isUnreferenced(tx: Reader, imageId: string): boolean {
  return (
    tx
      .select({ id: stepImages.id })
      .from(stepImages)
      .where(and(eq(stepImages.id, imageId), sql`not ${referencedByStep}`, sql`not ${referencedByRun}`))
      .get() !== undefined
  );
}

/** Instruction image metadata (14.3). See `ImageRepository`. */
export function createImageRepository({ db }: Pick<AppDatabase, 'db'>): ImageRepository {
  return {
    async register(input, actor, guard) {
      return db.transaction((tx): RegisterImageResult => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' };
        const existing = tx
          .select()
          .from(stepImages)
          .where(and(eq(stepImages.workspaceId, input.workspaceId), eq(stepImages.sha256, input.sha256)))
          .get();
        const pending = existing !== undefined && existing.createdAt.getTime() >= input.pendingSince.getTime();
        if (existing !== undefined && (pending || !isUnreferenced(tx, existing.id))) {
          // Identical content already charged in this Workspace: the same image, charged once.
          return { status: 'ok', image: toRecord(existing), usage: usageIn(tx, input.workspaceId, input.pendingSince, input.replacing) };
        }
        // An old unreferenced copy (waiting for housekeeping) is replaced by a fresh row, so it counts again.
        if (existing !== undefined) tx.delete(stepImages).where(eq(stepImages.id, existing.id)).run();
        const usage = usageIn(tx, input.workspaceId, input.pendingSince, input.replacing);
        if (usage.used + input.bytes > usage.quota) return { status: 'quota_exceeded', usage };
        const row = tx
          .insert(stepImages)
          .values({
            id: randomUUID(),
            workspaceId: input.workspaceId,
            sha256: input.sha256,
            bytes: input.bytes,
            width: input.width,
            height: input.height,
            createdByUserId: actor.userId,
            createdAt: input.at,
          })
          .returning()
          .get();
        return { status: 'ok', image: toRecord(row), usage: { ...usage, used: usage.used + row.bytes } };
      }, IMMEDIATE);
    },

    async find(workspaceId, imageId) {
      const row = db
        .select()
        .from(stepImages)
        .where(and(eq(stepImages.workspaceId, workspaceId), eq(stepImages.id, imageId)))
        .get();
      return row === undefined ? undefined : toRecord(row);
    },

    async usage(workspaceId, pendingSince) {
      return usageIn(db, workspaceId, pendingSince);
    },

    async listStorage(pendingSince) {
      return db
        .select({ id: workspaces.id, name: workspaces.name })
        .from(workspaces)
        .orderBy(asc(workspaces.name))
        .all()
        .map((row) => ({ workspaceId: row.id as WorkspaceId, name: row.name, usage: usageIn(db, row.id, pendingSince) }));
    },

    async setQuota(input, actor) {
      return db.transaction((tx) => {
        const current = tx.select({ quota: workspaces.imageQuotaBytes }).from(workspaces).where(eq(workspaces.id, input.workspaceId)).get();
        if (current === undefined) return false;
        // Lowering below the current usage deletes nothing: further uploads are refused until usage is below it.
        tx.update(workspaces).set({ imageQuotaBytes: input.quota }).where(eq(workspaces.id, input.workspaceId)).run();
        recordSecurityEvent(tx, {
          type: 'WORKSPACE_IMAGE_QUOTA_CHANGED',
          actor,
          subjectType: 'workspace',
          subjectId: input.workspaceId,
          occurredAt: input.at,
          metadata: { from: current.quota, to: input.quota },
        });
        return true;
      }, IMMEDIATE);
    },

    async purgeUnreferenced(before) {
      return db.transaction((tx) => {
        const stale = tx
          .select({ id: stepImages.id, sha256: stepImages.sha256 })
          .from(stepImages)
          .where(and(lt(stepImages.createdAt, before), sql`not ${referencedByStep}`, sql`not ${referencedByRun}`))
          .all();
        if (stale.length === 0) return [];
        // Foreign keys from Steps and Run snapshots make deleting a referenced image impossible anyway.
        tx.delete(stepImages)
          .where(inArray(stepImages.id, stale.map((row) => row.id)))
          .run();
        const hashes = [...new Set(stale.map((row) => row.sha256))];
        const stillUsed = new Set(
          tx
            .select({ sha256: stepImages.sha256 })
            .from(stepImages)
            .where(inArray(stepImages.sha256, hashes))
            .all()
            .map((row) => row.sha256),
        );
        return hashes.filter((hash) => !stillUsed.has(hash));
      }, IMMEDIATE);
    },

    async release(workspaceId, imageIds) {
      if (imageIds.length === 0) return;
      db.delete(stepImages)
        .where(and(eq(stepImages.workspaceId, workspaceId), inArray(stepImages.id, [...imageIds]), sql`not ${referencedByStep}`, sql`not ${referencedByRun}`))
        .run();
    },

    async usedHashes() {
      return new Set(
        db
          .selectDistinct({ sha256: stepImages.sha256 })
          .from(stepImages)
          .all()
          .map((row) => row.sha256),
      );
    },
  };
}
