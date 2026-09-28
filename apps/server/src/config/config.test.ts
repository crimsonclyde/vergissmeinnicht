import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.ts';

const SECRET = 'a'.repeat(20) + 'unique-secret-value-xyz';
const DATA_KEY = 'b'.repeat(20) + 'unique-data-key-value-xyz';
const production = {
  NODE_ENV: 'production',
  AUTH_SECRET: SECRET,
  DATA_ENCRYPTION_KEY: DATA_KEY,
  PUBLIC_ORIGIN: 'https://vmn.example.org',
  DATABASE_PATH: '/var/lib/vergissmeinnicht/app.sqlite',
  SMTP_HOST: 'smtp.example.org',
  MAIL_FROM_ADDRESS: 'noreply@example.org',
};

function issuesOf(env: NodeJS.ProcessEnv): readonly string[] {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.issues;
    throw error;
  }
  throw new Error('expected loadConfig to fail');
}

describe('loadConfig', () => {
  it('accepts a complete production configuration', () => {
    const config = loadConfig(production);
    expect(config.mode).toBe('production');
    expect(config.publicOrigin).toBe('https://vmn.example.org');
    expect(config.authSecret.reveal()).toBe(SECRET);
    expect(config.authSecretEphemeral).toBe(false);
    expect(config.logLevel).toBe('info');
    expect(config.host).toBe('127.0.0.1');
  });

  it('fails closed when NODE_ENV is missing or unknown', () => {
    expect(issuesOf({ ...production, NODE_ENV: undefined }).join()).toMatch(/NODE_ENV/);
    expect(issuesOf({ ...production, NODE_ENV: 'prod' }).join()).toMatch(/NODE_ENV/);
  });

  it.each(['AUTH_SECRET', 'DATA_ENCRYPTION_KEY', 'PUBLIC_ORIGIN', 'DATABASE_PATH', 'SMTP_HOST', 'MAIL_FROM_ADDRESS'] as const)(
    'requires %s in production instead of using a development default',
    (name) => {
      const env: NodeJS.ProcessEnv = { ...production, [name]: undefined };
      expect(issuesOf(env).join()).toMatch(new RegExp(name));
    },
  );

  it('keeps the data encryption key separate from the session secret', () => {
    const config = loadConfig(production);
    expect(config.dataEncryptionKey.reveal()).toBe(DATA_KEY);
    expect(`${config.dataEncryptionKey}`).toBe('[REDACTED]');
    expect(issuesOf({ ...production, DATA_ENCRYPTION_KEY: SECRET }).join()).toMatch(/must differ from AUTH_SECRET/);
    expect(issuesOf({ ...production, DATA_ENCRYPTION_KEY: 'short' }).join()).toMatch(/DATA_ENCRYPTION_KEY/);
    expect(issuesOf({ ...production, DATA_ENCRYPTION_KEY: 'replace-me'.repeat(4) }).join()).toMatch(/placeholder/);
    const development = loadConfig({ NODE_ENV: 'development' });
    expect(development.dataEncryptionKeyEphemeral).toBe(true);
    expect(development.dataEncryptionKey.reveal()).not.toBe(development.authSecret.reveal());
  });

  it('rejects a short or placeholder AUTH_SECRET in every mode', () => {
    expect(issuesOf({ ...production, AUTH_SECRET: 'too-short' }).join()).toMatch(/AUTH_SECRET/);
    expect(issuesOf({ NODE_ENV: 'development', AUTH_SECRET: 'replace-me'.repeat(4) }).join()).toMatch(/placeholder/);
  });

  it('rejects plain-http public origins in production except loopback', () => {
    expect(issuesOf({ ...production, PUBLIC_ORIGIN: 'http://vmn.example.org' }).join()).toMatch(/https/);
    expect(loadConfig({ ...production, PUBLIC_ORIGIN: 'http://127.0.0.1:3100' }).publicOrigin).toBe(
      'http://127.0.0.1:3100',
    );
  });

  it('rejects non-http(s) public origins', () => {
    expect(issuesOf({ ...production, PUBLIC_ORIGIN: 'javascript:alert(1)' }).join()).toMatch(/PUBLIC_ORIGIN/);
  });

  it('requires an absolute DATABASE_PATH in production', () => {
    expect(issuesOf({ ...production, DATABASE_PATH: 'data/app.sqlite' }).join()).toMatch(/absolute/);
  });

  it('forbids debug and trace logging in production', () => {
    expect(issuesOf({ ...production, LOG_LEVEL: 'debug' }).join()).toMatch(/LOG_LEVEL/);
    expect(issuesOf({ ...production, LOG_LEVEL: 'trace' }).join()).toMatch(/LOG_LEVEL/);
  });

  it('never echoes secret values in validation errors', () => {
    const leaked = 'short-leaky-secret';
    const error = (() => {
      try {
        loadConfig({ ...production, AUTH_SECRET: leaked, PUBLIC_ORIGIN: 'http://secret-host.example' });
      } catch (caught) {
        return caught as Error;
      }
      throw new Error('expected failure');
    })();
    expect(error.message).not.toContain(leaked);
    expect(inspect(error)).not.toContain(leaked);
  });

  it('never exposes the secret when the config is serialized or inspected', () => {
    const config = loadConfig(production);
    expect(JSON.stringify(config)).not.toContain(SECRET);
    expect(inspect(config, { depth: 5 })).not.toContain(SECRET);
    expect(`${config.authSecret}`).toBe('[REDACTED]');
  });

  it('generates an ephemeral secret outside production when none is configured', () => {
    const a = loadConfig({ NODE_ENV: 'development' });
    const b = loadConfig({ NODE_ENV: 'development' });
    expect(a.authSecretEphemeral).toBe(true);
    expect(a.authSecret.reveal()).toHaveLength(43);
    expect(a.authSecret.reveal()).not.toBe(b.authSecret.reveal());
    expect(a.logLevel).toBe('debug');
  });

  it('returns an immutable configuration', () => {
    const config = loadConfig(production);
    expect(Object.isFrozen(config)).toBe(true);
  });

  describe('SMTP settings', () => {
    it('defaults to STARTTLS on port 587 in production and Mailpit in development', () => {
      expect(loadConfig(production).smtp).toMatchObject({ port: 587, security: 'starttls', auth: undefined });
      expect(loadConfig({ NODE_ENV: 'development' }).smtp).toMatchObject({
        host: '127.0.0.1',
        port: 1025,
        security: 'none',
      });
    });

    it('rejects unencrypted SMTP to a remote host in production', () => {
      expect(issuesOf({ ...production, SMTP_SECURITY: 'none' }).join()).toMatch(/SMTP_SECURITY/);
      expect(loadConfig({ ...production, SMTP_HOST: '127.0.0.1', SMTP_SECURITY: 'none' }).smtp.security).toBe('none');
    });

    it('requires SMTP_USER and SMTP_PASSWORD together', () => {
      expect(issuesOf({ ...production, SMTP_USER: 'mailer' }).join()).toMatch(/SMTP_USER/);
      expect(issuesOf({ ...production, SMTP_PASSWORD: 'pw' }).join()).toMatch(/SMTP_USER/);
    });

    it('never exposes the SMTP password when serialized or inspected', () => {
      const config = loadConfig({ ...production, SMTP_USER: 'mailer', SMTP_PASSWORD: 'smtp-password-value' });
      expect(config.smtp.auth?.password.reveal()).toBe('smtp-password-value');
      expect(JSON.stringify(config)).not.toContain('smtp-password-value');
      expect(inspect(config, { depth: 10 })).not.toContain('smtp-password-value');
    });

    it('validates the sender', () => {
      expect(issuesOf({ ...production, MAIL_FROM_ADDRESS: 'not-an-address' }).join()).toMatch(/MAIL_FROM_ADDRESS/);
      expect(issuesOf({ ...production, MAIL_FROM_NAME: 'Evil\r\nBcc: x@y.z' }).join()).toMatch(/MAIL_FROM_NAME/);
    });
  });

  it('bounds the invitation lifetime', () => {
    expect(loadConfig(production).invitationTtlHours).toBe(72);
    expect(issuesOf({ ...production, INVITATION_TTL_HOURS: '0' }).join()).toMatch(/INVITATION_TTL_HOURS/);
    expect(issuesOf({ ...production, INVITATION_TTL_HOURS: '10000' }).join()).toMatch(/INVITATION_TTL_HOURS/);
  });

  it('trusts forwarding headers only from explicitly listed proxies', () => {
    expect(loadConfig(production).trustedProxies).toEqual([]);
    expect(loadConfig({ ...production, TRUSTED_PROXIES: ' 172.31.250.0/24, loopback,::1 ' }).trustedProxies).toEqual([
      '172.31.250.0/24',
      'loopback',
      '::1',
    ]);
    for (const value of ['*', 'true', '0.0.0.0/0', '::/0', '10.0.0.0/33', 'proxy.example.org', '10.0.0.1/8/1', 'uniquelocal']) {
      expect(issuesOf({ ...production, TRUSTED_PROXIES: value }).join(), value).toMatch(/TRUSTED_PROXIES/);
    }
  });

  it('sends HSTS only for https origins, one year by default', () => {
    expect(loadConfig(production).hstsMaxAge).toBe(31_536_000);
    expect(loadConfig({ ...production, HSTS_MAX_AGE: '0' }).hstsMaxAge).toBe(0);
    expect(loadConfig({ ...production, PUBLIC_ORIGIN: 'http://127.0.0.1:3000' }).hstsMaxAge).toBe(0);
    expect(issuesOf({ ...production, HSTS_MAX_AGE: '-1' }).join()).toMatch(/HSTS_MAX_AGE/);
  });

  it('has scheduled backups off by default and validates their settings', () => {
    expect(loadConfig(production).backup).toEqual({ intervalHours: 0, keep: 14 });
    expect(loadConfig({ ...production, BACKUP_INTERVAL_HOURS: '24', BACKUP_KEEP: '7' }).backup).toEqual({ intervalHours: 24, keep: 7 });
    expect(issuesOf({ ...production, BACKUP_INTERVAL_HOURS: '-1' }).join()).toMatch(/BACKUP_INTERVAL_HOURS/);
    expect(issuesOf({ ...production, BACKUP_INTERVAL_HOURS: 'daily' }).join()).toMatch(/BACKUP_INTERVAL_HOURS/);
    expect(issuesOf({ ...production, BACKUP_KEEP: '0' }).join()).toMatch(/BACKUP_KEEP/);
  });

  it('reads secrets from files (Docker secrets) without echoing them', () => {
    const files: Record<string, string> = { '/run/secrets/auth': `${SECRET}\n`, '/run/secrets/data': DATA_KEY };
    const read = (path: string) => {
      const content = files[path];
      if (content === undefined) throw new Error('ENOENT');
      return content;
    };
    const rest: NodeJS.ProcessEnv = { ...production };
    delete rest.AUTH_SECRET;
    delete rest.DATA_ENCRYPTION_KEY;
    const config = loadConfig({ ...rest, AUTH_SECRET_FILE: '/run/secrets/auth', DATA_ENCRYPTION_KEY_FILE: '/run/secrets/data' }, read);
    expect(config.authSecret.reveal()).toBe(SECRET);
    expect(config.dataEncryptionKey.reveal()).toBe(DATA_KEY);

    const failures = (env: NodeJS.ProcessEnv) => {
      try {
        loadConfig(env, read);
      } catch (error) {
        if (error instanceof ConfigError) return error.message;
      }
      return 'no error';
    };
    expect(failures({ ...production, AUTH_SECRET_FILE: '/run/secrets/auth' })).toMatch(/either AUTH_SECRET or AUTH_SECRET_FILE/);
    expect(failures({ ...rest, DATA_ENCRYPTION_KEY: DATA_KEY, AUTH_SECRET_FILE: 'secrets/auth' })).toMatch(/absolute path/);
    const missing = failures({ ...rest, DATA_ENCRYPTION_KEY: DATA_KEY, AUTH_SECRET_FILE: '/run/secrets/nope' });
    expect(missing).toMatch(/AUTH_SECRET_FILE: file cannot be read/);
    files['/run/secrets/short'] = 'too-short';
    const short = failures({ ...rest, DATA_ENCRYPTION_KEY: DATA_KEY, AUTH_SECRET_FILE: '/run/secrets/short' });
    expect(short).toMatch(/AUTH_SECRET/);
    expect(short).not.toContain('too-short');
  });

  it('offers the upstream source by default and accepts only https source links', () => {
    expect(loadConfig(production).sourceCodeUrl).toBe('https://github.com/crimsonclyde/vergissmeinnicht');
    expect(loadConfig({ ...production, SOURCE_CODE_URL: 'https://git.example.org/fork' }).sourceCodeUrl).toBe('https://git.example.org/fork');
    for (const value of ['http://git.example.org/fork', 'javascript:alert(1)', 'not a url']) {
      expect(issuesOf({ ...production, SOURCE_CODE_URL: value }).join()).toMatch(/SOURCE_CODE_URL/);
    }
  });
});
