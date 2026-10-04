import { enabledTool } from './tool-policy.ts';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { ImageRepository, RegisterImageResult, StepImageRecord } from '@vergissmeinnicht/application';
import { fitsStorage, type StepImageId, type WorkspaceId } from '@vergissmeinnicht/domain';
import { IMMEDIATE, actorAllowed, type Transaction } from './actor-guard.ts';
import type { AppDatabase } from './connection.ts';
import { stepImages } from './schema.ts';
import { imageReferencedByRun, imageReferencedByStep, storageUsageIn } from './storage-usage.ts';

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

function isUnreferenced(tx: Reader, imageId: string): boolean {
  return (
    tx
      .select({ id: stepImages.id })
      .from(stepImages)
      .where(and(eq(stepImages.id, imageId), sql`not ${imageReferencedByStep}`, sql`not ${imageReferencedByRun}`))
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
          return { status: 'ok', image: toRecord(existing), usage: storageUsageIn(tx, input.workspaceId, input.pendingSince, input.replacing) };
        }
        // An old unreferenced copy (waiting for housekeeping) is replaced by a fresh row, so it counts again.
        if (existing !== undefined) tx.delete(stepImages).where(eq(stepImages.id, existing.id)).run();
        const usage = storageUsageIn(tx, input.workspaceId, input.pendingSince, input.replacing);
        // One limit for everything the Workspace stores (16.4): images and Documents together.
        if (!fitsStorage(usage.used, input.bytes, usage.limit)) return { status: 'quota_exceeded', usage };
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
        return { status: 'ok', image: toRecord(row), usage: { ...usage, images: usage.images + row.bytes, used: usage.used + row.bytes } };
      }, IMMEDIATE);
    },

    async find(workspaceId, imageId) {
      const row = db
        .select()
        .from(stepImages)
        .where(and(enabledTool(workspaceId, 'PROCEDURES'), eq(stepImages.workspaceId, workspaceId), eq(stepImages.id, imageId)))
        .get();
      return row === undefined ? undefined : toRecord(row);
    },

    async usage(workspaceId, pendingSince) {
      return storageUsageIn(db, workspaceId, pendingSince);
    },

    async purgeUnreferenced(before) {
      return db.transaction((tx) => {
        const stale = tx
          .select({ id: stepImages.id, sha256: stepImages.sha256 })
          .from(stepImages)
          .where(and(lt(stepImages.createdAt, before), sql`not ${imageReferencedByStep}`, sql`not ${imageReferencedByRun}`))
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
        .where(and(enabledTool(workspaceId, 'PROCEDURES'), eq(stepImages.workspaceId, workspaceId), inArray(stepImages.id, [...imageIds]), sql`not ${imageReferencedByStep}`, sql`not ${imageReferencedByRun}`))
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
