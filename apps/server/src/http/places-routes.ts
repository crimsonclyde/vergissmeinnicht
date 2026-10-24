import { getPlaceSettings, readPlaceBackground, removePlaceBackground, resetPlaceSettings, savePlaceSettings, uploadPlaceBackground } from '@vergissmeinnicht/application';
import { MAX_IMAGE_UPLOAD_BYTES, type WorkspaceId } from '@vergissmeinnicht/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../composition.ts';
import { InvalidRequestError } from './errors.ts';
import { requireUser } from './session.ts';

const MINUTE_MS = 60_000;
const params = z.strictObject({ workspaceId: z.uuid({ version: 'v4' }).regex(/^[0-9a-f-]{36}$/) });
/** `?v=<version>` only changes the address when the photo changes; nothing else is accepted. */
export const placeBackgroundQuery = z.strictObject({ v: z.string().regex(/^\d{1,15}$/).optional() });
const emptyBody = z.strictObject({});
const settingsBody = z.strictObject({ preferences: z.unknown() });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new InvalidRequestError();
  return parsed.data;
}

function input(request: FastifyRequest) {
  if (request.principal === null) throw new Error('requireUser did not run');
  return { user: request.principal.user, workspaceId: parse(params, request.params).workspaceId as WorkspaceId };
}

/**
 * Places (section 30): the signed-in person's own look of one Workspace — settings and one private
 * background photo. The person always comes from the session, never from the request. Uploads are raw
 * bytes (`application/octet-stream`, at most 10 MB, only on this route); the server identifies,
 * validates and re-encodes them and never stores or serves an upload as it was sent. The photo is
 * served as `image/jpeg` (nosniff, `no-store` like every API answer) only to its owner.
 */
export async function placesRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  app.addHook('preHandler', requireUser(services));
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: MAX_IMAGE_UPLOAD_BYTES }, (_request, body, done) => done(null, body));
  const deps = services.places;

  app.get('/:workspaceId', async (request) => ({ places: await getPlaceSettings(deps, input(request)) }));

  app.post('/:workspaceId', { bodyLimit: 4096 }, async (request) => {
    const body = parse(settingsBody, request.body);
    if (body.preferences === undefined) throw new InvalidRequestError();
    return { places: await savePlaceSettings(deps, { ...input(request), preferences: body.preferences }) };
  });

  app.post('/:workspaceId/reset', { bodyLimit: 1024 }, async (request) => {
    parse(emptyBody, request.body ?? {});
    return { places: await resetPlaceSettings(deps, input(request)) };
  });

  app.get('/:workspaceId/background', async (request, reply) => {
    parse(placeBackgroundQuery, request.query);
    const jpeg = await readPlaceBackground(deps, input(request));
    return reply.type('image/jpeg').header('Content-Disposition', 'inline; filename="background.jpg"').send(Buffer.from(jpeg));
  });

  app.post(
    '/:workspaceId/background',
    {
      bodyLimit: MAX_IMAGE_UPLOAD_BYTES,
      config: {
        rateLimit: {
          max: 20,
          timeWindow: 15 * MINUTE_MS,
          hook: 'preHandler',
          keyGenerator: (request: FastifyRequest) => `place-background:${request.principal?.user.id ?? request.ip}`,
        },
      },
    },
    async (request) => {
      // Anything but raw bytes counts as an empty (unreadable) upload.
      const bytes = Buffer.isBuffer(request.body) ? new Uint8Array(request.body) : new Uint8Array(0);
      return { places: await uploadPlaceBackground(deps, { ...input(request), bytes }) };
    },
  );

  app.post('/:workspaceId/background/delete', { bodyLimit: 1024 }, async (request) => {
    parse(emptyBody, request.body ?? {});
    return { places: await removePlaceBackground(deps, input(request)) };
  });
}
