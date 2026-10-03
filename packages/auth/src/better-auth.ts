import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@vergissmeinnicht/domain';
import { hashPassword, verifyPassword } from './password-hashing.ts';
import { sessionPlugin } from './session-plugin.ts';

/** Better Auth routes are never mounted directly; the server calls `auth.api.*` from allow-listed routes. */
export const AUTH_BASE_PATH = '/api/auth';

/**
 * The only header Better Auth reads the client address from. The server sets it from the socket
 * address (or explicitly trusted proxy, Step 10.3) and never forwards client-supplied values.
 */
export const CLIENT_IP_HEADER = 'x-vmn-client-ip';

const DAY_SECONDS = 86_400;

/** Session lifetime policy (docs/development/security.md §2). */
export const SESSION_POLICY = Object.freeze({
  /** Idle timeout: a session unused for this long expires. */
  idleSeconds: 7 * DAY_SECONDS,
  /** Expiry is extended at most once per this interval of activity. */
  refreshSeconds: DAY_SECONDS,
  /** Absolute lifetime regardless of activity; enforced by the server on every request. */
  absoluteSeconds: 30 * DAY_SECONDS,
});

export interface AuthOptions {
  /** Drizzle database (better-sqlite3). */
  readonly db: Parameters<typeof drizzleAdapter>[0];
  /** Drizzle tables keyed by Better Auth model name. */
  readonly schema: {
    readonly users: unknown;
    readonly sessions: unknown;
    readonly accounts: unknown;
    readonly verifications: unknown;
  };
  readonly secret: string;
  readonly publicOrigin: string;
  /** Always true in production (`__Secure-` prefix + `Secure`). */
  readonly secureCookies: boolean;
  /** Returns false for unknown or non-ACTIVE Users; no session is created for them. */
  readonly canStartSession: (userId: string) => Promise<boolean>;
  /** Receives Better Auth's own log messages; structured arguments are dropped (they may hold user input). */
  readonly log: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void;
}

/**
 * Better Auth with the project's policy: invite-only (sign-up disabled; accounts are created by
 * invitation acceptance), Argon2id password hashing, server-side sessions without cookie caching,
 * strict cookies, no account linking, no telemetry. Rate limiting and CSRF/origin enforcement for
 * the HTTP surface live in the Fastify layer because Better Auth's routes are not exposed.
 */
export function createAuth(options: AuthOptions) {
  return betterAuth({
    appName: 'VergissMeinNicht',
    baseURL: options.publicOrigin,
    basePath: AUTH_BASE_PATH,
    secret: options.secret,
    trustedOrigins: [options.publicOrigin],
    database: drizzleAdapter(options.db, {
      provider: 'sqlite',
      schema: { ...options.schema },
      transaction: false,
    }),
    user: {
      modelName: 'users',
      additionalFields: {
        // Application-owned: never writable through Better Auth input.
        status: { type: 'string', input: false, required: false },
        serverAdmin: { type: 'boolean', input: false, required: false },
      },
      changeEmail: { enabled: false },
      deleteUser: { enabled: false },
    },
    session: {
      modelName: 'sessions',
      expiresIn: SESSION_POLICY.idleSeconds,
      updateAge: SESSION_POLICY.refreshSeconds,
      // Cookie caching would let a revoked or disabled session keep working (cf. GHSA-xg6x-h9c9-2m83).
      cookieCache: { enabled: false },
    },
    verification: { modelName: 'verifications' },
    account: {
      modelName: 'accounts',
      accountLinking: { enabled: false },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      revokeSessionsOnPasswordReset: true,
      password: {
        hash: hashPassword,
        verify: ({ hash, password }) => verifyPassword(hash, password),
      },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => ((await options.canStartSession(session.userId)) ? undefined : false),
        },
      },
    },
    advanced: {
      database: { generateId: () => randomUUID() },
      useSecureCookies: options.secureCookies,
      cookiePrefix: 'vmn',
      defaultCookieAttributes: { sameSite: 'strict', httpOnly: true, path: '/' },
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
      // Explicit so tests (NODE_ENV=test) run with production behaviour.
      disableOriginCheck: false,
      disableCSRFCheck: false,
    },
    plugins: [sessionPlugin()],
    rateLimit: { enabled: false },
    telemetry: { enabled: false },
    logger: {
      level: 'warn',
      log: (level, message) => options.log(level, message),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
