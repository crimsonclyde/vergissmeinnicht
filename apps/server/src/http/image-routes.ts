import { imageUsage, readStepImage, uploadStepImage, type ImageUsage } from '@vergissmeinnicht/application';
import { MAX_IMAGE_UPLOAD_BYTES, UUID_V4, type WorkspaceId } from '@vergissmeinnicht/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../composition.ts';
import { InvalidRequestError } from './errors.ts';
import { requireUser, type Principal } from './session.ts';

const MINUTE_MS = 60_000;
const uuid = z.string().regex(UUID_V4);
const workspaceParams = z.strictObject({ workspaceId: uuid });
const imageParams = z.strictObject({ workspaceId: uuid, imageId: uuid });
const uploadQuery = z.strictObject({ replacing: uuid.optional() });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new InvalidRequestError();
  return parsed.data;
}

function principalOf(request: FastifyRequest): Principal {
  if (request.principal === null) throw new Error('requireUser did not run');
  return request.principal;
}

/** Used and limit of the Workspace's combined storage (16.4) — what an author needs; the breakdown is for admins. */
const usageView = (usage: ImageUsage) => ({ usedBytes: usage.used, limitBytes: usage.limit });

/**
 * Instruction images of a Workspace (14.3). Uploads are raw bytes (`application/octet-stream`, at most
 * 10 MB, only on this route); the server identifies, validates and re-encodes them and never serves an
 * upload as it was sent. Images are served only to members with `procedure.view`, as `image/jpeg`
 * (nosniff, `no-store` like every API answer): a file hash or image id is never a capability.
 */
export async function imageRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  const deps = services.images;
  app.addHook('preHandler', requireUser(services));
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: MAX_IMAGE_UPLOAD_BYTES }, (_request, body, done) => done(null, body));

  app.post(
    '/',
    {
      bodyLimit: MAX_IMAGE_UPLOAD_BYTES,
      config: {
        rateLimit: {
          max: 60,
          timeWindow: 15 * MINUTE_MS,
          hook: 'preHandler',
          keyGenerator: (request: FastifyRequest) => `image-upload:${request.principal?.user.id ?? request.ip}`,
        },
      },
    },
    async (request, reply) => {
      const { workspaceId } = parse(workspaceParams, request.params);
      const { replacing } = parse(uploadQuery, request.query);
      // Anything but raw bytes counts as an empty (unreadable) upload — after the authorization check.
      const bytes = Buffer.isBuffer(request.body) ? new Uint8Array(request.body) : new Uint8Array(0);
      const { image, usage } = await uploadStepImage(deps, { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId, bytes, replacing });
      return reply.code(201).send({ image: { id: image.id, width: image.width, height: image.height, bytes: image.bytes }, usage: usageView(usage) });
    },
  );

  app.get('/usage', async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    return { usage: usageView(await imageUsage(deps, { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId })) };
  });

  app.get('/:imageId', async (request, reply) => {
    const { workspaceId, imageId } = parse(imageParams, request.params);
    const bytes = await readStepImage(deps, { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId, imageId });
    return reply.type('image/jpeg').header('Content-Disposition', 'inline; filename="image.jpg"').send(Buffer.from(bytes));
  });
}
