import { createReadStream } from 'node:fs';
import { cancelWorkspaceExport, listWorkspaceExports, openWorkspaceExport, requestWorkspaceExport, type BackupJob } from '@vergissmeinnicht/application';
import { UUID_V4, type WorkspaceId } from '@vergissmeinnicht/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../composition.ts';
import { InvalidRequestError } from './errors.ts';
import { requireUser } from './session.ts';

const workspaceParams = z.strictObject({ workspaceId: z.string().regex(UUID_V4) });
const jobParams = z.strictObject({ workspaceId: z.string().regex(UUID_V4), jobId: z.string().regex(UUID_V4) });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new InvalidRequestError();
  return parsed.data;
}

function userOf(request: FastifyRequest) {
  if (request.principal === null) throw new Error('requireUser did not run');
  return request.principal.user;
}

/** Status only — never the requester's internal id or anything of the content. */
const jobView = (job: BackupJob) => ({
  id: job.id,
  state: job.state,
  phase: job.phase,
  progressDone: job.progressDone,
  progressTotal: job.progressTotal,
  sizeBytes: job.sizeBytes,
  counts: job.counts,
  errorCode: job.errorCode,
  createdAt: job.createdAt.toISOString(),
  finishedAt: job.finishedAt?.toISOString() ?? null,
  expiresAt: job.expiresAt?.toISOString() ?? null,
});

/** A file name with nothing but safe ASCII: the Workspace's name is not trusted in a header. */
const fileName = (createdAt: Date) => `vergissmeinnicht-workspace-${createdAt.toISOString().slice(0, 16).replace(/[:T]/g, '-')}.vmnbackup`;

/**
 * Workspace backup (section 18a, `/api/workspaces/{id}/backups`): Workspace ADMIN only (B1), checked in
 * every use-case; another Workspace's job id is "not found". The package is downloaded only through this
 * signed-in route — there is no link that works on its own.
 */
export async function workspaceBackupRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  const deps = services.workspaceBackups;
  app.addHook('preHandler', requireUser(services));

  app.get('/', async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    return { jobs: (await listWorkspaceExports(deps, { actor: userOf(request), workspaceId: workspaceId as WorkspaceId })).map(jobView) };
  });

  app.post(
    '/',
    {
      bodyLimit: 256,
      config: {
        rateLimit: { persist: 'workspace-backup', max: 10, timeWindow: 60 * 60_000, hook: 'preHandler' as const, keyGenerator: (request: FastifyRequest) => `workspace-backup:${request.principal?.user.id ?? request.ip}` },
      },
    },
    async (request, reply) => {
      const { workspaceId } = parse(workspaceParams, request.params);
      const job = await requestWorkspaceExport(deps, { actor: userOf(request), workspaceId: workspaceId as WorkspaceId });
      // The work happens in the background; the page follows the job's progress.
      void services.backupRunner.wake();
      return reply.code(202).send({ job: jobView(job) });
    },
  );

  app.post('/:jobId/cancel', { bodyLimit: 256 }, async (request) => {
    const { workspaceId, jobId } = parse(jobParams, request.params);
    return { job: jobView(await cancelWorkspaceExport(deps, { actor: userOf(request), workspaceId: workspaceId as WorkspaceId, jobId })) };
  });

  app.get('/:jobId/download', async (request, reply) => {
    const { workspaceId, jobId } = parse(jobParams, request.params);
    const opened = await openWorkspaceExport(deps, { actor: userOf(request), workspaceId: workspaceId as WorkspaceId, jobId });
    return reply
      .header('content-type', 'application/zip')
      .header('content-length', String(opened.sizeBytes))
      .header('content-disposition', `attachment; filename="${fileName(opened.createdAt)}"`)
      .header('cache-control', 'no-store')
      .send(createReadStream(opened.path));
  });
}
