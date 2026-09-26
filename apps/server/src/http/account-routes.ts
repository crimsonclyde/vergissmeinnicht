import {
  confirmTotpEnrollment,
  disableTotp,
  mfaStatus,
  regenerateRecoveryCodes,
  startTotpEnrollment,
} from '@vergissmeinnicht/application';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../composition.ts';
import { InvalidRequestError } from './errors.ts';
import { replaceAllSessions, requireUser } from './session.ts';

const password = z.string().max(1024);
const setupBody = z.strictObject({ password });
const confirmBody = z.strictObject({ code: z.string().max(32) });
const disableBody = z.union([
  z.strictObject({ password, code: z.string().max(32) }),
  z.strictObject({ password, recoveryCode: z.string().max(64) }),
]);
const regenerateBody = z.strictObject({ password });

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
 * Per-account throttle for password re-authentication and code entry, on top of the global
 * per-client limit. Runs after `requireUser`, so the key is the authenticated user.
 */
const perAccount = {
  rateLimit: {
    max: 10,
    timeWindow: 15 * 60_000,
    hook: 'preHandler' as const,
    keyGenerator: (request: FastifyRequest) => `account-security:${request.principal?.user.id ?? request.ip}`,
  },
};

/** The signed-in user's own security settings. Every change requires the current password. */
export async function accountRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  const deps = services.mfa;
  app.addHook('preHandler', requireUser(services));

  app.get('/mfa', async (request) => mfaStatus(deps, userOf(request)));

  app.post('/mfa/totp/setup', { bodyLimit: 2048, config: perAccount }, async (request) => {
    const { password: current } = parse(setupBody, request.body);
    // Secret and URI are shown once; responses under /api are never cached.
    return startTotpEnrollment(deps, { user: userOf(request), password: current });
  });

  app.post('/mfa/totp/confirm', { bodyLimit: 1024, config: perAccount }, async (request, reply) => {
    const { code } = parse(confirmBody, request.body);
    const user = userOf(request);
    const { recoveryCodes } = await confirmTotpEnrollment(deps, { user, code });
    // Sessions opened before TOTP was enabled did not pass it: end them all.
    await replaceAllSessions(services, request, reply, user.id);
    return { recoveryCodes };
  });

  app.post('/mfa/totp/disable', { bodyLimit: 2048, config: perAccount }, async (request, reply) => {
    const body = parse(disableBody, request.body);
    const user = userOf(request);
    const factor = 'code' in body ? { code: body.code } : { recoveryCode: body.recoveryCode };
    await disableTotp(deps, { user, password: body.password, factor });
    await replaceAllSessions(services, request, reply, user.id);
    return reply.code(204).send();
  });

  app.post('/mfa/recovery-codes', { bodyLimit: 2048, config: perAccount }, async (request) => {
    const { password: current } = parse(regenerateBody, request.body);
    return regenerateRecoveryCodes(deps, { user: userOf(request), password: current });
  });
}
