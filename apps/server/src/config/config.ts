import { randomBytes } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import { normalizeEmail } from '@vergissmeinnicht/domain';
import { Secret } from './secret.ts';

const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
/** Marker used in `.env.example`; a value containing it is never a real secret. */
const PLACEHOLDER_MARKER = 'replace-me';
const MIN_SECRET_LENGTH = 32;

function isValidEmail(value: string): boolean {
  try {
    normalizeEmail(value);
    return true;
  } catch {
    return false;
  }
}

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
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
    SMTP_SECURITY: z.enum(['tls', 'starttls', 'none']).optional(),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    MAIL_FROM_ADDRESS: z.string().min(1).optional(),
    MAIL_FROM_NAME: z
      .string()
      .min(1)
      .max(80)
      .refine((value) => !/[\r\n"<>]/.test(value), 'MAIL_FROM_NAME must not contain line breaks, quotes or angle brackets')
      .optional(),
    INVITATION_TTL_HOURS: z.coerce.number().int().min(1).max(720).optional(),
  })
  .superRefine((env, ctx) => {
    if ((env.SMTP_USER === undefined) !== (env.SMTP_PASSWORD === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['SMTP_USER'], message: 'SMTP_USER and SMTP_PASSWORD must be set together' });
    }
    if (env.MAIL_FROM_ADDRESS !== undefined && !isValidEmail(env.MAIL_FROM_ADDRESS)) {
      ctx.addIssue({ code: 'custom', path: ['MAIL_FROM_ADDRESS'], message: 'MAIL_FROM_ADDRESS must be a valid email address' });
    }
    if (env.NODE_ENV !== 'production') return;
    for (const name of ['SMTP_HOST', 'MAIL_FROM_ADDRESS'] as const) {
      if (env[name] === undefined) {
        ctx.addIssue({ code: 'custom', path: [name], message: `${name} is required in production` });
      }
    }
    if (env.SMTP_SECURITY === 'none' && env.SMTP_HOST !== undefined && !LOOPBACK_HOSTNAMES.has(env.SMTP_HOST)) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_SECURITY'],
        message: 'SMTP_SECURITY=none is only allowed for a loopback SMTP host in production',
      });
    }
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
  readonly smtp: SmtpConfig;
  readonly invitationTtlHours: number;
}

export interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  readonly security: 'tls' | 'starttls' | 'none';
  readonly auth: { readonly user: string; readonly password: Secret } | undefined;
  readonly fromAddress: string;
  readonly fromName: string;
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
    // Development defaults target a local Mailpit (see docu/local-development.md).
    smtp: Object.freeze({
      host: values.SMTP_HOST ?? '127.0.0.1',
      port: values.SMTP_PORT ?? (production ? 587 : 1025),
      security: values.SMTP_SECURITY ?? (production ? 'starttls' : 'none'),
      auth:
        values.SMTP_USER !== undefined && values.SMTP_PASSWORD !== undefined
          ? Object.freeze({ user: values.SMTP_USER, password: new Secret(values.SMTP_PASSWORD) })
          : undefined,
      fromAddress: values.MAIL_FROM_ADDRESS ?? 'noreply@vergissmeinnicht.localhost',
      fromName: values.MAIL_FROM_NAME ?? 'Vergissmeinnicht',
    }),
    invitationTtlHours: values.INVITATION_TTL_HOURS ?? 72,
  });
}
