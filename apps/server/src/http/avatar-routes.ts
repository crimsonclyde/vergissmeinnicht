import { readOwnAvatar, removeAvatar, uploadAvatar } from '@vergissmeinnicht/application';
import { MAX_IMAGE_UPLOAD_BYTES } from '@vergissmeinnicht/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../composition.ts';
import { InvalidRequestError } from './errors.ts';
import { requireUser } from './session.ts';

const MINUTE_MS = 60_000;
/** `?v=<version>` only changes the address when the picture changes; nothing else is accepted. */
export const avatarQuery = z.strictObject({ v: z.string().regex(/^\d{1,15}$/).optional() });
const emptyBody = z.strictObject({});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new InvalidRequestError();
  return parsed.data;
}

function userOf(request: FastifyRequest) {
  if (request.principal === null) throw new Error('requireUser did not run');
  return request.principal.user;
}

/**
 * The signed-in person's own profile picture (section 29). Uploads are raw bytes
 * (`application/octet-stream`, at most 10 MB, only on this route); the server identifies, validates and
 * re-encodes them and never stores or serves an upload as it was sent. Served as `image/jpeg` (nosniff,
 * `no-store` like every API answer).
 */
export async function avatarRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  app.addHook('preHandler', requireUser(services));
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: MAX_IMAGE_UPLOAD_BYTES }, (_request, body, done) => done(null, body));

  app.get('/', async (request, reply) => {
    parse(avatarQuery, request.query);
    const jpeg = await readOwnAvatar(services.avatars, { user: userOf(request) });
    return reply.type('image/jpeg').header('Content-Disposition', 'inline; filename="avatar.jpg"').send(Buffer.from(jpeg));
  });

  app.post(
    '/',
    {
      bodyLimit: MAX_IMAGE_UPLOAD_BYTES,
      config: {
        rateLimit: {
          max: 20,
          timeWindow: 15 * MINUTE_MS,
          hook: 'preHandler',
          keyGenerator: (request: FastifyRequest) => `avatar-upload:${request.principal?.user.id ?? request.ip}`,
        },
      },
    },
    async (request) => {
      // Anything but raw bytes counts as an empty (unreadable) upload.
      const bytes = Buffer.isBuffer(request.body) ? new Uint8Array(request.body) : new Uint8Array(0);
      return { avatar: await uploadAvatar(services.avatars, { user: userOf(request), bytes }) };
    },
  );

  app.post('/delete', { bodyLimit: 1024 }, async (request) => {
    parse(emptyBody, request.body ?? {});
    await removeAvatar(services.avatars, { user: userOf(request) });
    return { avatar: null };
  });
}
