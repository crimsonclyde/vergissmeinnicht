import { Readable } from 'node:stream';
import { cancelWorkspaceRestore, confirmWorkspaceRestore, getWorkspaceRestore, listWorkspaceRestores, uploadWorkspaceRestore, type BackupJob } from '@vergissmeinnicht/application';
import { UUID_V4 } from '@vergissmeinnicht/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../composition.ts';
import { InvalidRequestError } from './errors.ts';
import { requireUser } from './session.ts';

const MINUTE_MS = 60_000;
/** A refused upload may still be arriving: this much is read and discarded so the client gets the reason. */
const MAX_DISCARDED_BYTES = 8 * 1024 * 1024;
/** The hard ceiling of a request is the server's `requestTimeout`; the instance setting bounds the size (D4). */
const UPLOAD_BODY_LIMIT = Number.MAX_SAFE_INTEGER;

const jobParams = z.strictObject({ jobId: z.string().regex(UUID_V4) });
const noQuery = z.strictObject({});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new InvalidRequestError();
  return parsed.data;
}

function userOf(request: FastifyRequest) {
  if (request.principal === null) throw new Error('requireUser did not run');
  return request.principal.user;
}

/** Status and the validation result — never the requester's internal id, and nothing of the records themselves. */
const jobView = (job: BackupJob) => ({
  id: job.id,
  state: job.state,
  phase: job.phase,
  progressDone: job.progressDone,
  progressTotal: job.progressTotal,
  sizeBytes: job.sizeBytes,
  preview: job.preview,
  workspaceId: job.phase === 'restored' ? job.workspaceId : null,
  errorCode: job.errorCode,
  createdAt: job.createdAt.toISOString(),
  finishedAt: job.finishedAt?.toISOString() ?? null,
  expiresAt: job.expiresAt?.toISOString() ?? null,
});

/**
 * Restoring a Workspace backup (section 18, 18b) — server administration. The package is the raw request body
 * (`application/octet-stream`), streamed into a private job folder; validation runs in the background and its
 * result must be confirmed explicitly. A restore always creates a new Workspace. Server admins only, checked in
 * each use case (and again in the repository's transactions).
 */
export async function workspaceRestoreRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  const deps = services.workspaceBackups;
  app.addHook('preHandler', requireUser(services));
  app.addContentTypeParser('application/octet-stream', (_request, payload, done) => done(null, payload));
  app.addHook('onSend', async (request, reply) => {
    const body = request.raw;
    if (request.method !== 'POST' || reply.statusCode < 400 || body.complete || body.destroyed) return;
    let discarded = 0;
    body.on('data', (chunk: Buffer) => {
      discarded += chunk.byteLength;
      if (discarded > MAX_DISCARDED_BYTES) body.destroy();
    });
    body.resume();
  });

  app.get('/', async (request) => {
    parse(noQuery, request.query);
    return { restores: (await listWorkspaceRestores(deps, { actor: userOf(request) })).map(jobView) };
  });

  app.post(
    '/',
    {
      bodyLimit: UPLOAD_BODY_LIMIT,
      config: {
        slowBody: 'backup',
        rateLimit: { max: 20, timeWindow: 60 * MINUTE_MS, hook: 'preHandler' as const, persist: 'workspace-restore-upload', keyGenerator: (request: FastifyRequest) => `workspace-restore:${request.principal?.user.id ?? request.ip}` },
      },
    },
    async (request, reply) => {
      parse(noQuery, request.query);
      const source: AsyncIterable<Uint8Array> = request.body instanceof Readable ? request.body.iterator({ destroyOnReturn: false }) : Readable.from([]);
      const job = await uploadWorkspaceRestore(deps, { actor: userOf(request), source });
      void services.backupRunner.wake();
      return reply.code(202).send({ restore: jobView(job) });
    },
  );

  app.get('/:jobId', async (request) => {
    const { jobId } = parse(jobParams, request.params);
    return { restore: jobView(await getWorkspaceRestore(deps, { actor: userOf(request), jobId })) };
  });

  app.post('/:jobId/confirm', { bodyLimit: 1024, config: { rateLimit: { max: 10, timeWindow: 60 * MINUTE_MS, hook: 'preHandler' as const, persist: 'workspace-restore-confirm', keyGenerator: (request: FastifyRequest) => `workspace-restore-confirm:${request.principal?.user.id ?? request.ip}` } } }, async (request, reply) => {
    const { jobId } = parse(jobParams, request.params);
    const job = await confirmWorkspaceRestore(deps, { actor: userOf(request), jobId });
    void services.backupRunner.wake();
    return reply.code(202).send({ restore: jobView(job) });
  });

  app.post('/:jobId/cancel', { bodyLimit: 1024 }, async (request) => {
    const { jobId } = parse(jobParams, request.params);
    return { restore: jobView(await cancelWorkspaceRestore(deps, { actor: userOf(request), jobId })) };
  });
}
