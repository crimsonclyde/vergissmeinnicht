import { completeAccountRecovery, issueAccountRecovery, resolveAccountRecovery } from '@vergissmeinnicht/application';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../composition.ts';
import { InvalidRequestError } from './errors.ts';
import { requireUser } from './session.ts';

const MINUTE_MS = 60_000;
const token = z.string().max(64);
const password = z.string().max(1024);

const resolveBody = z.strictObject({ token });
const completeBody = z.strictObject({ token, newPassword: password.optional(), currentPassword: password.optional() });
const issueBody = z
  .strictObject({
    email: z.string().max(320),
    resetPassword: z.boolean(),
    resetTotp: z.boolean(),
    /** The acting admin's own password (step-up). */
    password,
    code: z.string().max(32).optional(),
    recoveryCode: z.string().max(64).optional(),
  })
  .refine((body) => body.resetPassword || body.resetTotp)
  .refine((body) => body.code === undefined || body.recoveryCode === undefined);

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new InvalidRequestError();
  return parsed.data;
}

/** Public: the `/recover/{token}` page. Possession of the emailed link is the credential. */
export async function recoveryRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  const deps = services.recovery;
  const limit = { rateLimit: { persist: 'recovery-link', max: 10, timeWindow: 15 * MINUTE_MS } };

  app.post('/resolve', { bodyLimit: 1024, config: limit }, async (request) => {
    const result = await resolveAccountRecovery(deps, parse(resolveBody, request.body).token);
    return { ...result, expiresAt: result.expiresAt.toISOString() };
  });

  app.post('/complete', { bodyLimit: 4096, config: limit }, async (request, reply) => {
    const body = parse(completeBody, request.body);
    // Revokes every session of the account; the user signs in again afterwards.
    await completeAccountRecovery(deps, body);
    return reply.code(204).send();
  });
}

/** Server-admin: start the recovery of another account. */
export async function adminRecoveryRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  app.addHook('preHandler', requireUser(services));

  app.post(
    '/',
    {
      bodyLimit: 4096,
      config: {
        rateLimit: {
          persist: 'admin-recovery',
          max: 10,
          timeWindow: 15 * MINUTE_MS,
          hook: 'preHandler',
          keyGenerator: (request: FastifyRequest) => `admin-recovery:${request.principal?.user.id ?? request.ip}`,
        },
      },
    },
    async (request, reply) => {
      const body = parse(issueBody, request.body);
      if (request.principal === null) throw new Error('requireUser did not run');
      const adminFactor =
        body.code !== undefined ? { code: body.code } : body.recoveryCode !== undefined ? { recoveryCode: body.recoveryCode } : undefined;
      const { recovery, delivery } = await issueAccountRecovery(services.recovery, {
        admin: request.principal.user,
        adminPassword: body.password,
        adminFactor,
        email: body.email,
        scope: { resetPassword: body.resetPassword, resetTotp: body.resetTotp },
      });
      return reply.code(201).send({
        recovery: {
          id: recovery.id,
          resetPassword: recovery.resetPassword,
          resetTotp: recovery.resetTotp,
          expiresAt: recovery.expiresAt.toISOString(),
        },
        delivery,
      });
    },
  );
}
