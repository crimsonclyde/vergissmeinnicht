import { randomBytes } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import { Secret } from './secret.ts';

const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
/** Marker used in `.env.example`; a value containing it is never a real secret. */
const PLACEHOLDER_MARKER = 'replace-me';
const MIN_SECRET_LENGTH = 32;

const modeSchema = z.enum(['development', 'test', 'production'], {
  error: 'NODE_ENV must be set explicitly to "development", "test" or "production"',
});

const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
const productionLogLevels = ['fatal', 'error', 'warn', 'info', 'silent'] as const;

const envSchema = z
  .object({
    NODE_ENV: modeSchema,
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    PUBLIC_ORIGIN: z.url({ protocol: /^https?$/ }).optional(),
    DATABASE_PATH: z.string().min(1).optional(),
    AUTH_SECRET: z
      .string()
      .min(MIN_SECRET_LENGTH, `AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters`)
      .refine((value) => !value.includes(PLACEHOLDER_MARKER), 'AUTH_SECRET still contains the .env.example placeholder')
      .optional(),
    LOG_LEVEL: z.enum(logLevels).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    // Production never falls back to development defaults: every value below must be injected explicitly.
    if (env.AUTH_SECRET === undefined) {
      ctx.addIssue({ code: 'custom', path: ['AUTH_SECRET'], message: 'AUTH_SECRET is required in production' });
    }
    if (env.PUBLIC_ORIGIN === undefined) {
      ctx.addIssue({ code: 'custom', path: ['PUBLIC_ORIGIN'], message: 'PUBLIC_ORIGIN is required in production' });
    } else {
      const url = new URL(env.PUBLIC_ORIGIN);
      if (url.protocol !== 'https:' && !LOOPBACK_HOSTNAMES.has(url.hostname)) {
        ctx.addIssue({
          code: 'custom',
          path: ['PUBLIC_ORIGIN'],
          message: 'PUBLIC_ORIGIN must use https in production (plain http is only allowed for loopback hosts)',
        });
      }
    }
    if (env.DATABASE_PATH === undefined || !isAbsolute(env.DATABASE_PATH)) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_PATH'],
        message: 'DATABASE_PATH must be set to an absolute path in production',
      });
    }
    if (env.LOG_LEVEL !== undefined && !(productionLogLevels as readonly string[]).includes(env.LOG_LEVEL)) {
      ctx.addIssue({
        code: 'custom',
        path: ['LOG_LEVEL'],
        message: `LOG_LEVEL must be one of ${productionLogLevels.join(', ')} in production`,
      });
    }
  });

export type Mode = z.infer<typeof modeSchema>;

export interface AppConfig {
  readonly mode: Mode;
  readonly host: string;
  readonly port: number;
  /** Origin the browser uses to reach the app; basis for auth callbacks and origin/CSRF checks. */
  readonly publicOrigin: string;
  readonly databasePath: string;
  readonly authSecret: Secret;
  /** True when no AUTH_SECRET was configured outside production and a per-process secret was generated. */
  readonly authSecretEphemeral: boolean;
  readonly logLevel: (typeof logLevels)[number];
}

export class ConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

/**
 * Validates the environment and builds the application configuration. Fails closed:
 * any invalid or missing required value throws a ConfigError. Error messages name
 * variables but never echo their values.
 */
export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`));
  }
  const values = parsed.data;
  const production = values.NODE_ENV === 'production';

  return Object.freeze({
    mode: values.NODE_ENV,
    host: values.HOST,
    port: values.PORT,
    publicOrigin: new URL(values.PUBLIC_ORIGIN ?? 'http://localhost:5173').origin,
    databasePath: resolve(REPO_ROOT, values.DATABASE_PATH ?? '.var/vergissmeinnicht.sqlite'),
    authSecret: new Secret(values.AUTH_SECRET ?? randomBytes(32).toString('base64url')),
    authSecretEphemeral: values.AUTH_SECRET === undefined,
    logLevel: values.LOG_LEVEL ?? (production ? 'info' : 'debug'),
  });
}
