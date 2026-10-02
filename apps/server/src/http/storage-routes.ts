import { listWorkspaceStorage, setWorkspaceStorageCeiling, setWorkspaceStorageLimit, workspaceStorage } from '@vergissmeinnicht/application';
import { UUID_V4, type StorageUsage, type WorkspaceId } from '@vergissmeinnicht/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../composition.ts';
import { InvalidRequestError } from './errors.ts';
import { requireUser, type Principal } from './session.ts';

const MINUTE_MS = 60_000;
const uuid = z.string().regex(UUID_V4);
const workspaceParams = z.strictObject({ workspaceId: uuid });
const idParams = z.strictObject({ id: uuid });
// Coarse transport bounds; the domain decides the range.
const bytes = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const limitBody = z.strictObject({ bytes: bytes.nullable() });
const ceilingBody = z.strictObject({ bytes });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new InvalidRequestError();
  return parsed.data;
}

function principalOf(request: FastifyRequest): Principal {
  if (request.principal === null) throw new Error('requireUser did not run');
  return request.principal;
}

/** Storage by tool, the limit in force, the ceiling and the Workspace's own limit — numbers only. */
export const storageView = (usage: StorageUsage) => ({
  imageBytes: usage.images,
  documentBytes: usage.originals,
  previewBytes: usage.previews,
  trashBytes: usage.trash,
  usedBytes: usage.used,
  limitBytes: usage.limit,
  ceilingBytes: usage.ceiling,
  ownLimitBytes: usage.ownLimit,
});

/**
 * The combined storage of a Workspace (16.4), for its admins (`workspace.settings.manage`): what is
 * used, by tool, and the Workspace's own limit — at or below the ceiling, never above.
 */
export async function workspaceStorageRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  const deps = services.storage;
  app.addHook('preHandler', requireUser(services));

  app.get('/', async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    return { storage: storageView(await workspaceStorage(deps, { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId })) };
  });

  app.post('/limit', { bodyLimit: 1024 }, async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const body = parse(limitBody, request.body);
    return { storage: storageView(await setWorkspaceStorageLimit(deps, { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId, bytes: body.bytes })) };
  });
}

/** Server admin: storage of every Workspace and its ceiling (16.4; replaces the image quota of 14.3). */
export async function adminStorageRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  const deps = services.storage;
  app.addHook('preHandler', requireUser(services));

  app.get('/', async (request) => {
    const storage = await listWorkspaceStorage(deps, { actor: principalOf(request).user });
    return { workspaces: storage.map((entry) => ({ id: entry.workspaceId, name: entry.name, ...storageView(entry.usage) })) };
  });

  app.post(
    '/:id/ceiling',
    {
      bodyLimit: 1024,
      config: {
        rateLimit: {
          persist: 'admin-storage-ceiling',
          max: 30,
          timeWindow: 15 * MINUTE_MS,
          hook: 'preHandler',
          keyGenerator: (request: FastifyRequest) => `admin-storage-ceiling:${request.principal?.user.id ?? request.ip}`,
        },
      },
    },
    async (request, reply) => {
      const { id } = parse(idParams, request.params);
      const body = parse(ceilingBody, request.body);
      await setWorkspaceStorageCeiling(deps, { actor: principalOf(request).user, workspaceId: id as WorkspaceId, bytes: body.bytes });
      return reply.code(204).send();
    },
  );
}
