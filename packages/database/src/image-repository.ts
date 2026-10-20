import { enabledTool } from './tool-policy.ts';
import { randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { GalleryImage, ImageRepository, RegisterImageResult, RemoveImageResult, ReplaceImageResult, StepImageRecord } from '@vergissmeinnicht/application';
import { containsPattern, fitsStorage, type StepImageId, type WorkspaceId } from '@vergissmeinnicht/domain';
import { IMMEDIATE, actorAllowed, type Transaction } from './actor-guard.ts';
import { recordAuditEvent } from './audit-events.ts';
import type { AppDatabase } from './connection.ts';
import { activeIn } from './procedure-repository.ts';
import { procedureSteps, procedures, runSteps, stepImageRemovals, stepImages } from './schema.ts';
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
// Deleted from the gallery (23.4) and not shown by a current Step again since.
const removedFromGallery = sql`(exists (select 1 from ${stepImageRemovals} where ${stepImageRemovals.imageId} = ${stepImages.id}) and not exists (select 1 from ${currentSteps}))`;
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
        .where(and(enabledTool(workspaceId, 'PROCEDURES'), eq(stepImages.workspaceId, workspaceId), attachable, sql`not ${removedFromGallery}`, input.unused ? sql`not exists (select 1 from ${currentSteps})` : undefined, matches, after))
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

    async replaceEverywhere(input, actor, guard) {
      return db.transaction((tx): ReplaceImageResult => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' };
        const inWorkspace = and(enabledTool(input.workspaceId, 'PROCEDURES'), eq(stepImages.workspaceId, input.workspaceId));
        const from = tx.select({ id: stepImages.id }).from(stepImages).where(and(inWorkspace, eq(stepImages.id, input.from))).get();
        if (from === undefined) return { status: 'not_found' };
        // The new photo must already be charged to this Workspace: in use, or uploaded within the grace.
        const attachable = sql`(${stepImages.createdAt} >= ${input.pendingSince.getTime()} or ${imageReferencedByStep} or ${imageReferencedByRun})`;
        const to = tx.select({ id: stepImages.id }).from(stepImages).where(and(inWorkspace, eq(stepImages.id, input.to), attachable)).get();
        if (to === undefined) return { status: 'invalid_reference' };
        if (from.id === to.id) return { status: 'ok', procedures: 0, steps: 0 };
        const affected = tx
          .select({ id: procedures.id, revision: procedures.revision, steps: count(procedureSteps.id) })
          .from(procedureSteps)
          .innerJoin(procedures, eq(procedures.id, procedureSteps.procedureId))
          .where(and(activeIn(input.workspaceId), eq(procedureSteps.imageId, from.id)))
          .groupBy(procedures.id)
          .orderBy(asc(procedures.id))
          .all();
        let steps = 0;
        for (const procedure of affected) {
          const revision = procedure.revision + 1;
          tx.update(procedures).set({ revision, updatedAt: input.at }).where(eq(procedures.id, procedure.id)).run();
          tx.update(procedureSteps)
            .set({ imageId: to.id })
            .where(and(eq(procedureSteps.procedureId, procedure.id), eq(procedureSteps.imageId, from.id)))
            .run();
          steps += procedure.steps;
          recordAuditEvent(tx, {
            workspaceId: input.workspaceId,
            type: 'PROCEDURE_UPDATED',
            actor,
            subjectType: 'procedure',
            subjectId: procedure.id,
            occurredAt: input.at,
            metadata: { fields: ['structure'], revision, stepsChanged: procedure.steps, photoReplaced: procedure.steps },
          });
        }
        return { status: 'ok', procedures: affected.length, steps };
      }, IMMEDIATE);
    },

    async remove(input, actor, guard) {
      return db.transaction((tx): RemoveImageResult => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' };
        const image = tx
          .select({ id: stepImages.id, shown: stepCount, referenced: sql<number>`(${imageReferencedByStep} or ${imageReferencedByRun})` })
          .from(stepImages)
          .where(and(enabledTool(input.workspaceId, 'PROCEDURES'), eq(stepImages.workspaceId, input.workspaceId), eq(stepImages.id, input.imageId)))
          .get();
        if (image === undefined) return { status: 'not_found' };
        if (Number(image.shown) > 0) return { status: 'in_use' };
        const kept = Boolean(image.referenced);
        if (kept) {
          // Immutable and still shown by history: only the gallery leaves it out (again, if a restored Procedure brought it back).
          tx.insert(stepImageRemovals)
            .values({ imageId: image.id, workspaceId: input.workspaceId, removedByUserId: actor.userId, removedAt: input.at })
            .onConflictDoUpdate({ target: stepImageRemovals.imageId, set: { removedByUserId: actor.userId, removedAt: input.at } })
            .run();
        } else {
          tx.delete(stepImages).where(eq(stepImages.id, image.id)).run();
        }
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: 'STEP_IMAGE_REMOVED',
          actor,
          subjectType: 'workspace',
          subjectId: input.workspaceId,
          occurredAt: input.at,
          metadata: { image: image.id, kept },
        });
        return { status: 'ok', kept };
      }, IMMEDIATE);
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
