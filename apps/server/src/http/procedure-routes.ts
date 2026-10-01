import {
  createProcedure,
  deleteProcedure,
  duplicateProcedure,
  getProcedure,
  getProcedureHistory,
  importProcedure,
  importProcedureArchive,
  readStepImage,
  getDeletedProcedure,
  listDeletedProcedures,
  listProcedureCards,
  pinProcedure,
  restoreProcedure,
  unpinProcedure,
  updateProcedure,
} from '@vergissmeinnicht/application';
import type { ProcedureCard, ProcedureDetail } from '@vergissmeinnicht/application';
import { UUID_V4, type Procedure, type ProcedureId, type WorkspaceId } from '@vergissmeinnicht/domain';
import { ARCHIVE_LIMITS, parseProcedureDocument, readProcedureArchive, toProcedureDocument, writeProcedureArchive } from '@vergissmeinnicht/import-export';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../composition.ts';
import { InvalidRequestError } from './errors.ts';
import { auditEventView, historyQuery } from './history-view.ts';
import { requireUser, type Principal } from './session.ts';

// Lower-case UUIDv4 only, like the domain parsers: one canonical spelling per id.
const uuid = z.string().regex(UUID_V4);
const workspaceParams = z.strictObject({ workspaceId: uuid });
const procedureParams = z.strictObject({ workspaceId: uuid, procedureId: uuid });
// Coarse transport bounds; the domain applies the exact rules (code points, characters, icon keys,
// id format, reason policies, counts).
const text = (max: number) => z.string().max(max);
const itemId = text(64).optional();
const step = z.strictObject({
  id: itemId,
  title: text(1024),
  description: text(16_384).default(''),
  icon: text(64).nullable().default(null),
  required: z.boolean(),
  critical: z.boolean().default(false),
  skipReasonPolicy: text(32),
  notApplicableReasonPolicy: text(32),
  image: z.strictObject({ id: text(64), caption: text(1024) }).nullable().optional(),
});
const section = z.strictObject({
  id: itemId,
  title: text(512),
  description: text(16_384).default(''),
  steps: z.array(step).max(250).default([]),
});
const content = {
  title: text(512),
  description: text(16_384).default(''),
  icon: text(64),
  tags: z.array(text(128)).max(50).default([]),
};
const createBody = z.strictObject({ ...content, sections: z.array(section).max(60).default([]) });
// Updates always carry the complete structure: a missing `sections` must never mean "delete all".
const updateBody = z.strictObject({
  ...content,
  sections: z.array(section).max(60),
  expectedRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
});
/** A full Procedure with up to 200 Steps can exceed the global 64 KiB body limit. */
const STRUCTURE_BODY_LIMIT = 1024 * 1024;

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new InvalidRequestError();
  return parsed.data;
}

function principalOf(request: FastifyRequest): Principal {
  if (request.principal === null) throw new Error('requireUser did not run');
  return request.principal;
}

function procedureView(procedure: Procedure) {
  return {
    id: procedure.id,
    title: procedure.title,
    description: procedure.description,
    icon: procedure.icon,
    tags: procedure.tags,
    revision: procedure.revision,
    createdAt: procedure.createdAt.toISOString(),
    updatedAt: procedure.updatedAt.toISOString(),
  };
}

/** A Procedure with the person's pin, its last completion, active executions and next open Occurrence. */
export function procedureCardView(card: ProcedureCard) {
  return {
    ...procedureView(card.procedure),
    pinned: card.pinned,
    lastCompletedAt: card.activity.lastCompletedAt?.toISOString() ?? null,
    active: card.activity.active.map((run) => ({ runId: run.runId, startedBy: run.startedBy, startedAt: run.startedAt.toISOString() })),
    nextOccurrence:
      card.nextOccurrence === null
        ? null
        : {
            id: card.nextOccurrence.occurrence.id,
            scheduleId: card.nextOccurrence.schedule.id,
            date: card.nextOccurrence.occurrence.dueDate,
            time: card.nextOccurrence.occurrence.time,
            timeZone: card.nextOccurrence.schedule.timeZone,
          },
  };
}

function detailView(detail: ProcedureDetail) {
  return { ...procedureView(detail.procedure), sections: detail.sections };
}

/**
 * Procedures of one Workspace (`/api/workspaces/{workspaceId}/procedures`). Every route requires a
 * session; membership, capabilities and Workspace scoping of the Procedure id are enforced in the use-cases.
 */
export async function procedureRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  const deps = services.procedures;
  app.addHook('preHandler', requireUser(services));
  // Procedure archives (14.3) are uploaded as raw bytes, only to the archive import route.
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: ARCHIVE_LIMITS.maxArchiveBytes }, (_request, body, done) => done(null, body));

  app.get('/', async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const cards = await listProcedureCards(services.home, { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId });
    return { procedures: cards.map(procedureCardView) };
  });

  // Personal pins (13.12): not audited, only for Procedures the person can see.
  app.post('/:procedureId/pin', async (request, reply) => {
    const { workspaceId, procedureId } = parse(procedureParams, request.params);
    await pinProcedure(services.home, { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId, procedureId: procedureId as ProcedureId });
    return reply.code(204).send();
  });

  app.post('/:procedureId/unpin', async (request, reply) => {
    const { workspaceId, procedureId } = parse(procedureParams, request.params);
    await unpinProcedure(services.home, { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId, procedureId: procedureId as ProcedureId });
    return reply.code(204).send();
  });

  app.post('/', { bodyLimit: STRUCTURE_BODY_LIMIT }, async (request, reply) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const body = parse(createBody, request.body);
    const detail = await createProcedure(deps, {
      actor: principalOf(request).user,
      workspaceId: workspaceId as WorkspaceId,
      content: body,
    });
    return reply.code(201).send({ procedure: detailView(detail) });
  });

  // Import: the body is an untrusted document (e.g. a file someone sent around). Parsed strictly by
  // the import-export package, then created through the regular rules; ids from the file are never used.
  app.post(
    '/import',
    { bodyLimit: STRUCTURE_BODY_LIMIT, config: { rateLimit: { max: 30, timeWindow: 15 * 60_000 } } },
    async (request, reply) => {
      const { workspaceId } = parse(workspaceParams, request.params);
      const detail = await importProcedure(deps, {
        actor: principalOf(request).user,
        workspaceId: workspaceId as WorkspaceId,
        content: parseProcedureDocument(request.body),
      });
      return reply.code(201).send({ procedure: detailView(detail) });
    },
  );

  // Archive import (14.3, T4): an untrusted ZIP with the JSON document and its images. Read in bounded
  // memory only after the caller may import here; every image is processed like an upload and charged.
  app.post(
    '/import-archive',
    {
      bodyLimit: ARCHIVE_LIMITS.maxArchiveBytes,
      config: {
        rateLimit: {
          max: 10,
          timeWindow: 15 * 60_000,
          hook: 'preHandler',
          keyGenerator: (request: FastifyRequest) => `archive-import:${request.principal?.user.id ?? request.ip}`,
        },
      },
    },
    async (request, reply) => {
      const { workspaceId } = parse(workspaceParams, request.params);
      const body = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      const detail = await importProcedureArchive(
        { ...deps, ...services.images },
        { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId, read: () => readProcedureArchive(body) },
      );
      return reply.code(201).send({ procedure: detailView(detail) });
    },
  );

  // Static segment: takes precedence over '/:procedureId'.
  app.get('/deleted', async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const deleted = await listDeletedProcedures(deps, { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId });
    return {
      procedures: deleted.map((entry) => ({
        ...procedureView(entry.procedure),
        deletedAt: entry.deletedAt.toISOString(),
        deletedBy: entry.deletedBy.displayName,
      })),
    };
  });

  // Registered before '/:procedureId' routes; 'deleted' is not a UUID, so the two never collide.
  app.get('/deleted/:procedureId', async (request) => {
    const { workspaceId, procedureId } = parse(procedureParams, request.params);
    const detail = await getDeletedProcedure(deps, {
      actor: principalOf(request).user,
      workspaceId: workspaceId as WorkspaceId,
      procedureId: procedureId as ProcedureId,
    });
    return { procedure: detailView(detail) };
  });

  app.post('/:procedureId/restore', async (request) => {
    const { workspaceId, procedureId } = parse(procedureParams, request.params);
    const detail = await restoreProcedure(deps, {
      actor: principalOf(request).user,
      workspaceId: workspaceId as WorkspaceId,
      procedureId: procedureId as ProcedureId,
    });
    return { procedure: detailView(detail) };
  });

  app.get('/:procedureId/history', async (request) => {
    const { workspaceId, procedureId } = parse(procedureParams, request.params);
    const { after } = parse(historyQuery, request.query);
    const page = await getProcedureHistory(services.history, {
      actor: principalOf(request).user,
      workspaceId: workspaceId as WorkspaceId,
      procedureId: procedureId as ProcedureId,
      after,
    });
    return { events: page.items.map(auditEventView), nextCursor: page.nextCursor };
  });

  app.get('/:procedureId/export', async (request) => {
    const { workspaceId, procedureId } = parse(procedureParams, request.params);
    const detail = await getProcedure(deps, {
      actor: principalOf(request).user,
      workspaceId: workspaceId as WorkspaceId,
      procedureId: procedureId as ProcedureId,
    });
    return toProcedureDocument(detail);
  });

  // The archive carries the stored (already processed) images; they are read with the same checks as when viewed.
  app.get('/:procedureId/archive', async (request, reply) => {
    const { workspaceId, procedureId } = parse(procedureParams, request.params);
    const actor = principalOf(request).user;
    const detail = await getProcedure(deps, { actor, workspaceId: workspaceId as WorkspaceId, procedureId: procedureId as ProcedureId });
    const images = [];
    for (const [section, entry] of detail.sections.entries()) {
      for (const [step, item] of entry.steps.entries()) {
        if (item.image === null) continue;
        const bytes = await readStepImage(services.images, { actor, workspaceId: workspaceId as WorkspaceId, imageId: item.image.id });
        images.push({ section, step, caption: item.image.caption, bytes });
      }
    }
    const archive = await writeProcedureArchive(toProcedureDocument(detail), images);
    return reply.type('application/zip').header('Content-Disposition', 'attachment; filename="procedure.vmn.zip"').send(archive);
  });

  app.post('/:procedureId/duplicate', async (request, reply) => {
    const { workspaceId, procedureId } = parse(procedureParams, request.params);
    const detail = await duplicateProcedure(deps, {
      actor: principalOf(request).user,
      workspaceId: workspaceId as WorkspaceId,
      procedureId: procedureId as ProcedureId,
    });
    return reply.code(201).send({ procedure: detailView(detail) });
  });

  app.get('/:procedureId', async (request) => {
    const { workspaceId, procedureId } = parse(procedureParams, request.params);
    const detail = await getProcedure(deps, {
      actor: principalOf(request).user,
      workspaceId: workspaceId as WorkspaceId,
      procedureId: procedureId as ProcedureId,
    });
    return { procedure: detailView(detail) };
  });

  app.post('/:procedureId/update', { bodyLimit: STRUCTURE_BODY_LIMIT }, async (request) => {
    const { workspaceId, procedureId } = parse(procedureParams, request.params);
    const { expectedRevision, ...body } = parse(updateBody, request.body);
    const detail = await updateProcedure(deps, {
      actor: principalOf(request).user,
      workspaceId: workspaceId as WorkspaceId,
      procedureId: procedureId as ProcedureId,
      expectedRevision,
      content: body,
    });
    return { procedure: detailView(detail) };
  });

  app.post('/:procedureId/delete', async (request, reply) => {
    const { workspaceId, procedureId } = parse(procedureParams, request.params);
    await deleteProcedure(deps, {
      actor: principalOf(request).user,
      workspaceId: workspaceId as WorkspaceId,
      procedureId: procedureId as ProcedureId,
    });
    return reply.code(204).send();
  });
}
