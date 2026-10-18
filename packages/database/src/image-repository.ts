import { enabledTool } from './tool-policy.ts';
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { GalleryImage, ImageRepository, RegisterImageResult, StepImageRecord } from '@vergissmeinnicht/application';
import { containsPattern, fitsStorage, type StepImageId, type WorkspaceId } from '@vergissmeinnicht/domain';
import { IMMEDIATE, actorAllowed, type Transaction } from './actor-guard.ts';
import type { AppDatabase } from './connection.ts';
import { procedureSteps, procedures, runSteps, stepImages } from './schema.ts';
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

// Steps of current (not deleted) Procedures showing the image.
const currentSteps = sql`${procedureSteps} join ${procedures} on ${procedures.id} = ${procedureSteps.procedureId} and ${procedures.deletedAt} is null where ${procedureSteps.imageId} = ${stepImages.id}`;
const stepCount = sql<number>`(select count(*) from ${currentSteps})`;
const procedureCount = sql<number>`(select count(distinct ${procedureSteps.procedureId}) from ${currentSteps})`;
// The caption last used: on a current Step of the most recently saved Procedure, else in the latest Run snapshot.
const lastCaption = sql<string | null>`coalesce(
  (select ${procedureSteps.imageCaption} from ${currentSteps} order by ${procedures.updatedAt} desc limit 1),
  (select ${runSteps.imageCaption} from ${runSteps} where ${runSteps.imageId} = ${stepImages.id} order by ${runSteps}.rowid desc limit 1))`;

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

    async gallery(workspaceId, input) {
      const attachable = sql`(${stepImages.createdAt} >= ${input.pendingSince.getTime()} or ${imageReferencedByStep} or ${imageReferencedByRun})`;
      const pattern = input.search === null ? null : containsPattern(input.search);
      const matches =
        pattern === null
          ? undefined
          : sql`(exists (select 1 from ${currentSteps} and (${procedureSteps.imageCaption} like ${pattern} escape '\\' or ${procedureSteps.title} like ${pattern} escape '\\'))
              or exists (select 1 from ${runSteps} where ${runSteps.imageId} = ${stepImages.id} and ${runSteps.imageCaption} like ${pattern} escape '\\'))`;
      const after =
        input.after === null
          ? undefined
          : or(lt(stepImages.createdAt, input.after.createdAt), and(eq(stepImages.createdAt, input.after.createdAt), lt(stepImages.id, input.after.id)));
      const rows = db
        .select({
          id: stepImages.id,
          width: stepImages.width,
          height: stepImages.height,
          bytes: stepImages.bytes,
          createdAt: stepImages.createdAt,
          steps: stepCount,
          procedures: procedureCount,
          caption: lastCaption,
        })
        .from(stepImages)
        .where(and(enabledTool(workspaceId, 'PROCEDURES'), eq(stepImages.workspaceId, workspaceId), attachable, matches, after))
        .orderBy(desc(stepImages.createdAt), desc(stepImages.id))
        .limit(input.limit + 1)
        .all();
      const page = rows.slice(0, input.limit);
      const images = page.map(
        (row): GalleryImage => ({
          id: row.id as StepImageId,
          width: row.width,
          height: row.height,
          bytes: row.bytes,
          createdAt: row.createdAt,
          steps: Number(row.steps),
          procedures: Number(row.procedures),
          caption: row.caption,
        }),
      );
      const last = images.at(-1);
      return { images, next: rows.length > input.limit && last !== undefined ? { createdAt: last.createdAt, id: last.id } : null };
    },

    async uses(workspaceId, imageId) {
      return db
        .select({ procedureId: procedures.id, procedureTitle: procedures.title, stepId: procedureSteps.id, stepTitle: procedureSteps.title })
        .from(procedureSteps)
        .innerJoin(procedures, eq(procedures.id, procedureSteps.procedureId))
        .where(and(enabledTool(workspaceId, 'PROCEDURES'), eq(procedures.workspaceId, workspaceId), isNull(procedures.deletedAt), eq(procedureSteps.imageId, imageId)))
        .orderBy(asc(procedures.title), asc(procedures.id), asc(procedureSteps.title), asc(procedureSteps.id))
        .all();
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
