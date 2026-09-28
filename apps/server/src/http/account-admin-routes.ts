import { listAccounts, setAccountStatus } from '@vergissmeinnicht/application';
import { USER_STATUSES } from '@vergissmeinnicht/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../composition.ts';
import { InvalidRequestError } from './errors.ts';
import { requireUser, type Principal } from './session.ts';

const MINUTE_MS = 60_000;

const userParams = z.strictObject({ userId: z.uuid({ version: 'v4' }) });
const statusBody = z
  .strictObject({
    status: z.enum(USER_STATUSES),
    /** The acting admin's own password (step-up). */
    password: z.string().max(1024),
    code: z.string().max(32).optional(),
    recoveryCode: z.string().max(64).optional(),
  })
  .refine((body) => body.code === undefined || body.recoveryCode === undefined);

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new InvalidRequestError();
  return parsed.data;
}

function principalOf(request: FastifyRequest): Principal {
  if (request.principal === null) throw new Error('requireUser did not run');
  return request.principal;
}

/** Server-admin account management. Authorization is enforced inside each use-case. */
export async function adminAccountRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  const deps = services.accounts;
  app.addHook('preHandler', requireUser(services));

  app.get('/', async (request) => {
    const accounts = await listAccounts(deps, { actor: principalOf(request).user });
    return {
      accounts: accounts.map((account) => ({
        id: account.id,
        email: account.email,
        displayName: account.displayName,
        status: account.status,
        serverAdmin: account.serverAdmin,
        totpEnabled: account.totpEnabled,
        createdAt: account.createdAt.toISOString(),
      })),
    };
  });

  app.post(
    '/:userId/status',
    {
      bodyLimit: 4096,
      config: {
        rateLimit: {
          max: 20,
          timeWindow: 15 * MINUTE_MS,
          hook: 'preHandler',
          keyGenerator: (request: FastifyRequest) => `admin-account-status:${request.principal?.user.id ?? request.ip}`,
        },
      },
    },
    async (request) => {
      const { userId } = parse(userParams, request.params);
      const body = parse(statusBody, request.body);
      const adminFactor =
        body.code !== undefined ? { code: body.code } : body.recoveryCode !== undefined ? { recoveryCode: body.recoveryCode } : undefined;
      const { sessionsRevoked } = await setAccountStatus(deps, {
        admin: principalOf(request).user,
        adminPassword: body.password,
        adminFactor,
        userId,
        status: body.status,
      });
      return { status: body.status, sessionsRevoked };
    },
  );
}
