import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import { normalizeEmail } from '@vergissmeinnicht/domain';
import { Secret } from './secret.ts';

const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
/** Marker used in `.env.example`; a value containing it is never a real secret. */
const PLACEHOLDER_MARKER = 'replace-me';
const MIN_SECRET_LENGTH = 32;
export const DEFAULT_API_RATE_LIMIT_PER_MINUTE = 300;
/** One year; sent only when the public origin is https. */
const DEFAULT_HSTS_MAX_AGE = 31_536_000;
/** Secrets that may be given as a file (Docker/Kubernetes secrets) via `<NAME>_FILE`. */
const FILE_SECRETS = ['AUTH_SECRET', 'DATA_ENCRYPTION_KEY', 'SMTP_PASSWORD'] as const;

/** An IPv4/IPv6 address or CIDR range, or the `loopback` preset. Never "trust everything". */
function isTrustedProxyEntry(entry: string): boolean {
  if (entry === 'loopback') return true;
  const [address = '', prefix, extra] = entry.split('/');
  const version = isIP(address);
  if (version === 0 || extra !== undefined) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  const bits = Number(prefix);
  // A /0 range would trust every client's forwarding headers.
  return bits >= 1 && bits <= (version === 4 ? 32 : 128);
}
/** Upstream repository: the Corresponding Source offered to network users (AGPL-3.0 §13). */
export const UPSTREAM_SOURCE_URL = 'https://github.com/crimsonclyde/vergissmeinnicht';

function isValidEmail(value: string): boolean {
  try {
    normalizeEmail(value);
    return true;
  } catch {
    return false;
  }
}

const secretSchema = (name: string) =>
  z
    .string()
    .min(MIN_SECRET_LENGTH, `${name} must be at least ${MIN_SECRET_LENGTH} characters`)
    .refine((value) => !value.includes(PLACEHOLDER_MARKER), `${name} still contains the .env.example placeholder`)
    .optional();

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
    AUTH_SECRET: secretSchema('AUTH_SECRET'),
    DATA_ENCRYPTION_KEY: secretSchema('DATA_ENCRYPTION_KEY'),
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
    // Operators running a modified version must point this at their own source (AGPL-3.0 §13).
    SOURCE_CODE_URL: z.url({ protocol: /^https$/, error: 'SOURCE_CODE_URL must be an https URL' }).optional(),
    // Reverse proxies whose X-Forwarded-For is believed (comma-separated IPs/CIDRs or `loopback`).
    TRUSTED_PROXIES: z
      .string()
      .transform((value) => value.split(',').map((entry) => entry.trim()).filter((entry) => entry !== ''))
      .refine((entries) => entries.every(isTrustedProxyEntry), 'TRUSTED_PROXIES must list IP addresses, CIDR ranges (not /0) or "loopback"')
      .optional(),
    HSTS_MAX_AGE: z.coerce.number().int().min(0).max(63_072_000).optional(),
    // Scheduled backups into <database dir>/backups (Step 10.5); 0 or unset = off.
    BACKUP_INTERVAL_HOURS: z.coerce.number().int().min(0).max(24 * 31).optional(),
    BACKUP_KEEP: z.coerce.number().int().min(1).max(1000).optional(),
    // Global per-client limit on /api requests per minute (default 300). Security-sensitive routes keep
    // their own, persisted limits regardless of this value.
    API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(60).max(10_000).optional(),
  })
  .superRefine((env, ctx) => {
    if ((env.SMTP_USER === undefined) !== (env.SMTP_PASSWORD === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['SMTP_USER'], message: 'SMTP_USER and SMTP_PASSWORD (or SMTP_PASSWORD_FILE) must be set together' });
    }
    if (env.MAIL_FROM_ADDRESS !== undefined && !isValidEmail(env.MAIL_FROM_ADDRESS)) {
      ctx.addIssue({ code: 'custom', path: ['MAIL_FROM_ADDRESS'], message: 'MAIL_FROM_ADDRESS must be a valid email address' });
    }
    if (env.AUTH_SECRET !== undefined && env.AUTH_SECRET === env.DATA_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATA_ENCRYPTION_KEY'],
        message: 'DATA_ENCRYPTION_KEY must differ from AUTH_SECRET',
      });
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
    if (env.DATA_ENCRYPTION_KEY === undefined) {
      ctx.addIssue({ code: 'custom', path: ['DATA_ENCRYPTION_KEY'], message: 'DATA_ENCRYPTION_KEY is required in production' });
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
  /**
   * Encrypts recoverable secrets at rest (TOTP seeds). Separate from AUTH_SECRET so that rotating
   * the session secret does not destroy enrolled authenticators.
   */
  readonly dataEncryptionKey: Secret;
  /** True when no DATA_ENCRYPTION_KEY was configured outside production (TOTP enrollments break on restart). */
  readonly dataEncryptionKeyEphemeral: boolean;
  readonly logLevel: (typeof logLevels)[number];
  readonly smtp: SmtpConfig;
  readonly invitationTtlHours: number;
  /** Where users can obtain the source of the running version (AGPL-3.0 §13). */
  readonly sourceCodeUrl: string;
  /** Proxies allowed to set the client address via X-Forwarded-For; empty = trust nobody. */
  readonly trustedProxies: readonly string[];
  /** Strict-Transport-Security max-age in seconds; 0 = header not sent. */
  readonly hstsMaxAge: number;
  /** Scheduled automatic backups (10.5); `intervalHours` 0 = off. */
  readonly backup: { readonly intervalHours: number; readonly keep: number };
  /** Global per-client limit on /api requests per minute. */
  readonly apiRateLimitPerMinute: number;
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
export function loadConfig(env: NodeJS.ProcessEnv, readFile: (path: string) => string = (path) => readFileSync(path, 'utf8')): AppConfig {
  const parsed = envSchema.safeParse(withFileSecrets(env, readFile));
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
    dataEncryptionKey: new Secret(values.DATA_ENCRYPTION_KEY ?? randomBytes(32).toString('base64url')),
    dataEncryptionKeyEphemeral: values.DATA_ENCRYPTION_KEY === undefined,
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
      fromName: values.MAIL_FROM_NAME ?? 'VergissMeinNicht',
    }),
    invitationTtlHours: values.INVITATION_TTL_HOURS ?? 72,
    sourceCodeUrl: values.SOURCE_CODE_URL ?? UPSTREAM_SOURCE_URL,
    trustedProxies: Object.freeze([...(values.TRUSTED_PROXIES ?? [])]),
    // HSTS only makes sense (and is only honoured) on https origins; loopback http never gets it.
    hstsMaxAge: new URL(values.PUBLIC_ORIGIN ?? 'http://localhost').protocol === 'https:' ? (values.HSTS_MAX_AGE ?? DEFAULT_HSTS_MAX_AGE) : 0,
    backup: Object.freeze({ intervalHours: values.BACKUP_INTERVAL_HOURS ?? 0, keep: values.BACKUP_KEEP ?? 14 }),
    apiRateLimitPerMinute: values.API_RATE_LIMIT_PER_MINUTE ?? DEFAULT_API_RATE_LIMIT_PER_MINUTE,
  });
}

/**
 * Resolves `<NAME>_FILE` for secrets (e.g. `AUTH_SECRET_FILE=/run/secrets/auth_secret`): the file
 * content, without a trailing line break, becomes `<NAME>`. Setting both is an error. Errors name
 * the variable, never the path's content.
 */
function withFileSecrets(env: NodeJS.ProcessEnv, readFile: (path: string) => string): NodeJS.ProcessEnv {
  const resolved: NodeJS.ProcessEnv = { ...env };
  const issues: string[] = [];
  for (const name of FILE_SECRETS) {
    const path = env[`${name}_FILE`];
    if (path === undefined || path === '') continue;
    if (env[name] !== undefined) {
      issues.push(`${name}_FILE: set either ${name} or ${name}_FILE, not both`);
      continue;
    }
    if (!isAbsolute(path)) {
      issues.push(`${name}_FILE: must be an absolute path`);
      continue;
    }
    try {
      resolved[name] = readFile(path).replace(/\r?\n$/, '');
    } catch {
      issues.push(`${name}_FILE: file cannot be read`);
    }
  }
  if (issues.length > 0) throw new ConfigError(issues);
  return resolved;
}
