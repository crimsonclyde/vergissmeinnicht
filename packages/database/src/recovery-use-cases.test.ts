import { randomUUID } from 'node:crypto';
import { TOTP } from 'otpauth';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AccountNotActiveError,
  InvalidRecoveryError,
  NotAuthorizedError,
  NothingToRecoverError,
  ReauthenticationFailedError,
  SecondFactorRequiredError,
  UnknownAccountError,
  changePassword,
  completeAccountRecovery,
  confirmTotpEnrollment,
  issueAccountRecovery,
  issueOperatorRecovery,
  mfaStatus,
  resolveAccountRecovery,
  startTotpEnrollment,
  type EmailMessage,
  type MfaDeps,
  type RecoveryDeps,
  type RecoveryScope,
} from '@vergissmeinnicht/application';
import {
  commonPasswords,
  createSecretBox,
  hashPassword,
  invitationTokens,
  passwordHasher,
  recoveryCodes,
  totpAlgorithm,
  verifyPassword,
} from '@vergissmeinnicht/auth';
import { DomainValidationError, normalizeEmail, type User } from '@vergissmeinnicht/domain';
import { createMfaChallengeRepository, createTotpRepository } from './mfa-repository.ts';
import { createAccountRecoveryRepository, createCredentialRepository } from './recovery-repository.ts';
import { createTestDatabase } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';

const ADMIN_PASSWORD = 'admin passphrase for recovery';
const BOB_PASSWORD = 'bob original passphrase';
const NEW_PASSWORD = 'bob brand new passphrase';
const LINK = /https:\/\/vmn\.example\.org\/recover\/([A-Za-z0-9_-]{43})/;
const PASSWORD_ONLY: RecoveryScope = { resetPassword: true, resetTotp: false };
const TOTP_ONLY: RecoveryScope = { resetPassword: false, resetTotp: true };

describe('account recovery use-cases', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let deps: RecoveryDeps;
  let mfa: MfaDeps;
  let outbox: EmailMessage[];
  let now: Date;
  let admin: User;
  let bob: User;

  const events = () =>
    (database.sqlite.prepare('SELECT type FROM security_events ORDER BY rowid').all() as { type: string }[]).map((r) => r.type);
  const count = (table: string, userId: string) =>
    (database.sqlite.prepare(`SELECT count(*) AS n FROM ${table} WHERE user_id = ?`).get(userId) as { n: number }).n;
  const tokenFromOutbox = () => LINK.exec(outbox.at(-1)?.text ?? '')?.[1] ?? '';
  const passwordOf = (user: User) =>
    (database.sqlite.prepare("SELECT password FROM accounts WHERE user_id = ? AND provider_id = 'credential'").get(user.id) as {
      password: string;
    }).password;

  async function createUser(email: string, name: string, password: string, serverAdmin = false): Promise<User> {
    const user = await createUserRepository(database).create({
      email: normalizeEmail(email),
      displayName: name,
      emailVerified: true,
      status: 'ACTIVE',
      serverAdmin,
    });
    database.sqlite
      .prepare("INSERT INTO accounts (id, account_id, provider_id, user_id, password) VALUES (?, ?, 'credential', ?, ?)")
      .run(randomUUID(), user.id, user.id, await hashPassword(password));
    return user;
  }

  function addSession(user: User) {
    database.sqlite
      .prepare('INSERT INTO sessions (id, token, user_id, expires_at) VALUES (?, ?, ?, ?)')
      .run(randomUUID(), randomUUID(), user.id, Date.now() + 86_400_000);
  }

  async function enableTotp(user: User, password: string): Promise<string> {
    const { secret } = await startTotpEnrollment(mfa, { user, password });
    await confirmTotpEnrollment(mfa, { user, code: TOTP.generate({ secret: new TOTP({ secret }).secret, timestamp: now.getTime() }) });
    now = new Date(now.getTime() + 30_000);
    return secret;
  }

  const issue = (scope: RecoveryScope = PASSWORD_ONLY, email = 'bob@example.org', actor = admin) =>
    issueAccountRecovery(deps, { admin: actor, adminPassword: ADMIN_PASSWORD, adminFactor: undefined, email, scope });

  beforeEach(async () => {
    database = createTestDatabase();
    outbox = [];
    now = new Date();
    admin = await createUser('admin@example.org', 'Ada Admin', ADMIN_PASSWORD, true);
    bob = await createUser('bob@example.org', 'Bob', BOB_PASSWORD);
    const users = createUserRepository(database);
    mfa = {
      users,
      totp: createTotpRepository(database),
      challenges: createMfaChallengeRepository(database),
      secretBox: createSecretBox('test-data-encryption-key-0123456789abcdef'),
      algorithm: totpAlgorithm,
      recoveryCodes,
      challengeTokens: invitationTokens,
      passwords: { verify: async (userId, password) => verifyPassword(passwordOf({ id: userId } as User), password) },
      clock: { now: () => now },
    };
    deps = {
      users,
      recoveries: createAccountRecoveryRepository(database),
      credentials: createCredentialRepository(database),
      mfa,
      tokens: invitationTokens,
      passwordHasher,
      commonPasswords,
      email: {
        async send(message) {
          outbox.push(message);
        },
      },
      clock: { now: () => now },
      publicOrigin: 'https://vmn.example.org',
    };
  });

  afterEach(() => database.dispose());

  describe('issuing', () => {
    it('emails a single-use link to the account owner only, never to the admin', async () => {
      const result = await issue();
      expect(result.delivery).toBe('sent');
      expect(outbox).toHaveLength(1);
      expect(outbox[0]?.to).toBe('bob@example.org');
      expect(outbox[0]?.text).toContain('Ada Admin');
      const token = tokenFromOutbox();
      expect(JSON.stringify(result)).not.toContain(token);
      const dump = JSON.stringify(database.sqlite.prepare('SELECT * FROM account_recoveries').all()) +
        JSON.stringify(database.sqlite.prepare('SELECT * FROM security_events').all());
      expect(dump).not.toContain(token);
      expect(events()).toEqual(['ACCOUNT_RECOVERY_ISSUED']);
    });

    it('is refused for non-admins, disabled admins and wrong admin passwords', async () => {
      await expect(issue(PASSWORD_ONLY, 'admin@example.org', bob)).rejects.toBeInstanceOf(NotAuthorizedError);
      await expect(issue(PASSWORD_ONLY, 'bob@example.org', { ...admin, status: 'DISABLED' })).rejects.toBeInstanceOf(NotAuthorizedError);
      await expect(
        issueAccountRecovery(deps, { admin, adminPassword: 'wrong', adminFactor: undefined, email: 'bob@example.org', scope: PASSWORD_ONLY }),
      ).rejects.toBeInstanceOf(ReauthenticationFailedError);
      expect(outbox).toHaveLength(0);
      expect(events()).toEqual([]);
    });

    it('requires the admin second factor when the admin has TOTP', async () => {
      const secret = await enableTotp(admin, ADMIN_PASSWORD);
      await expect(issue()).rejects.toBeInstanceOf(SecondFactorRequiredError);
      await expect(
        issueAccountRecovery(deps, { admin, adminPassword: ADMIN_PASSWORD, adminFactor: { code: '000000' }, email: 'bob@example.org', scope: PASSWORD_ONLY }),
      ).rejects.toThrow();
      const code = TOTP.generate({ secret: new TOTP({ secret }).secret, timestamp: now.getTime() });
      await expect(
        issueAccountRecovery(deps, { admin, adminPassword: ADMIN_PASSWORD, adminFactor: { code }, email: 'bob@example.org', scope: PASSWORD_ONLY }),
      ).resolves.toMatchObject({ delivery: 'sent' });
    });

    it('cannot target the admin themself, unknown, disabled or TOTP-less accounts', async () => {
      await expect(issue(PASSWORD_ONLY, 'ADMIN@example.org')).rejects.toBeInstanceOf(NotAuthorizedError);
      await expect(issue(PASSWORD_ONLY, 'nobody@example.org')).rejects.toBeInstanceOf(UnknownAccountError);
      await expect(issue(TOTP_ONLY)).rejects.toBeInstanceOf(NothingToRecoverError);
      database.sqlite.prepare("UPDATE users SET status = 'DISABLED' WHERE id = ?").run(bob.id);
      await expect(issue()).rejects.toBeInstanceOf(AccountNotActiveError);
    });

    it('supersedes the previous link', async () => {
      await issue();
      const first = tokenFromOutbox();
      await issue();
      await expect(resolveAccountRecovery(deps, first)).rejects.toBeInstanceOf(InvalidRecoveryError);
      await expect(resolveAccountRecovery(deps, tokenFromOutbox())).resolves.toMatchObject({ email: 'bob@example.org' });
      expect(events()).toContain('ACCOUNT_RECOVERY_SUPERSEDED');
    });
  });

  describe('completing a password reset', () => {
    it('sets the new password, revokes all access and is single use', async () => {
      await issue();
      const token = tokenFromOutbox();
      addSession(bob);
      addSession(bob);
      addSession(admin);
      expect(await resolveAccountRecovery(deps, token)).toMatchObject({ resetPassword: true, requiresCurrentPassword: false });

      await completeAccountRecovery(deps, { token, newPassword: NEW_PASSWORD });
      expect(await verifyPassword(passwordOf(bob), NEW_PASSWORD)).toBe(true);
      expect(await verifyPassword(passwordOf(bob), BOB_PASSWORD)).toBe(false);
      expect(count('sessions', bob.id)).toBe(0);
      expect(count('sessions', admin.id)).toBe(1);
      expect(events()).toEqual(['ACCOUNT_RECOVERY_ISSUED', 'PASSWORD_RESET', 'ACCOUNT_RECOVERY_COMPLETED']);

      await expect(completeAccountRecovery(deps, { token, newPassword: 'mallory chooses a password' })).rejects.toBeInstanceOf(
        InvalidRecoveryError,
      );
      expect(await verifyPassword(passwordOf(bob), NEW_PASSWORD)).toBe(true);
    });

    it('rejects a weak password and stays usable', async () => {
      await issue();
      const token = tokenFromOutbox();
      await expect(completeAccountRecovery(deps, { token, newPassword: 'short' })).rejects.toBeInstanceOf(DomainValidationError);
      await expect(completeAccountRecovery(deps, { token })).rejects.toBeInstanceOf(DomainValidationError);
      // Common/breached and account-derived passwords are refused as well (13.3).
      await expect(completeAccountRecovery(deps, { token, newPassword: 'Correct Horse Battery Staple' })).rejects.toMatchObject({
        code: 'password_too_common',
      });
      await expect(completeAccountRecovery(deps, { token, newPassword: 'bob@example.org 2026' })).rejects.toMatchObject({
        code: 'password_too_predictable',
      });
      await expect(resolveAccountRecovery(deps, token)).resolves.toBeDefined();
      expect(await verifyPassword(passwordOf(bob), BOB_PASSWORD)).toBe(true);
    });

    it('expires after one hour', async () => {
      await issue();
      now = new Date(now.getTime() + 60 * 60_000);
      await expect(completeAccountRecovery(deps, { token: tokenFromOutbox(), newPassword: NEW_PASSWORD })).rejects.toBeInstanceOf(
        InvalidRecoveryError,
      );
    });

    it('fails if the account was disabled after issuing', async () => {
      await issue();
      database.sqlite.prepare("UPDATE users SET status = 'DISABLED' WHERE id = ?").run(bob.id);
      await expect(completeAccountRecovery(deps, { token: tokenFromOutbox(), newPassword: NEW_PASSWORD })).rejects.toBeInstanceOf(
        InvalidRecoveryError,
      );
    });

    it('succeeds once under concurrency', async () => {
      await issue();
      const token = tokenFromOutbox();
      const results = await Promise.allSettled(
        ['first new passphrase', 'second new passphrase', 'third new passphrase'].map((newPassword) =>
          completeAccountRecovery(deps, { token, newPassword }),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(events().filter((e) => e === 'PASSWORD_RESET')).toHaveLength(1);
    });

    it.each(['', 'nope', 'A'.repeat(43)])('rejects malformed or unknown token %#', async (token) => {
      await expect(resolveAccountRecovery(deps, token)).rejects.toBeInstanceOf(InvalidRecoveryError);
      await expect(completeAccountRecovery(deps, { token, newPassword: NEW_PASSWORD })).rejects.toBeInstanceOf(
        InvalidRecoveryError,
      );
    });
  });

  describe('completing a TOTP reset', () => {
    it('requires the current password, removes TOTP and recovery codes, and invalidates challenges', async () => {
      await enableTotp(bob, BOB_PASSWORD);
      await issue(TOTP_ONLY);
      const token = tokenFromOutbox();
      expect(await resolveAccountRecovery(deps, token)).toMatchObject({ resetTotp: true, requiresCurrentPassword: true });
      database.sqlite
        .prepare('INSERT INTO mfa_challenges (id, token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
        .run(randomUUID(), 'a'.repeat(64), bob.id, Date.now(), Date.now() + 300_000);

      await expect(completeAccountRecovery(deps, { token })).rejects.toBeInstanceOf(ReauthenticationFailedError);
      await expect(completeAccountRecovery(deps, { token, currentPassword: 'wrong' })).rejects.toBeInstanceOf(
        ReauthenticationFailedError,
      );
      expect((await mfaStatus(mfa, bob)).totpEnabled).toBe(true);

      await completeAccountRecovery(deps, { token, currentPassword: BOB_PASSWORD });
      expect(await mfaStatus(mfa, bob)).toEqual({ totpEnabled: false, recoveryCodesRemaining: 0 });
      expect(count('recovery_codes', bob.id)).toBe(0);
      expect(
        database.sqlite.prepare('SELECT count(*) AS n FROM mfa_challenges WHERE consumed_at IS NULL').get(),
      ).toEqual({ n: 0 });
      expect(await verifyPassword(passwordOf(bob), BOB_PASSWORD)).toBe(true);
      expect(events()).toContain('TOTP_RESET');
      // The user may enroll again.
      await expect(enableTotp(bob, BOB_PASSWORD)).resolves.toBeDefined();
    });

    it('resets both factors without the current password when both are in scope', async () => {
      await enableTotp(bob, BOB_PASSWORD);
      await issue({ resetPassword: true, resetTotp: true });
      await completeAccountRecovery(deps, { token: tokenFromOutbox(), newPassword: NEW_PASSWORD });
      expect((await mfaStatus(mfa, bob)).totpEnabled).toBe(false);
      expect(await verifyPassword(passwordOf(bob), NEW_PASSWORD)).toBe(true);
    });
  });

  describe('operator recovery (CLI)', () => {
    it('recovers the only server admin and is attributed to the CLI', async () => {
      await enableTotp(admin, ADMIN_PASSWORD);
      const { url } = await issueOperatorRecovery(deps, { email: 'admin@example.org', scope: TOTP_ONLY });
      expect(outbox).toHaveLength(0);
      const token = LINK.exec(url)?.[1] ?? '';
      await completeAccountRecovery(deps, { token, currentPassword: ADMIN_PASSWORD });
      expect((await mfaStatus(mfa, admin)).totpEnabled).toBe(false);
      const issued = database.sqlite
        .prepare("SELECT actor_label, actor_user_id FROM security_events WHERE type = 'ACCOUNT_RECOVERY_ISSUED'")
        .get();
      expect(issued).toEqual({ actor_label: 'cli:admin-recover', actor_user_id: null });
    });
  });

  describe('changePassword', () => {
    it('requires the current password and a valid new one, then revokes all sessions', async () => {
      addSession(bob);
      await expect(changePassword(deps, { user: bob, currentPassword: 'wrong', newPassword: NEW_PASSWORD })).rejects.toBeInstanceOf(
        ReauthenticationFailedError,
      );
      await expect(changePassword(deps, { user: bob, currentPassword: BOB_PASSWORD, newPassword: 'short' })).rejects.toBeInstanceOf(
        DomainValidationError,
      );
      await expect(changePassword(deps, { user: bob, currentPassword: BOB_PASSWORD, newPassword: 'manchesterunited1' })).rejects.toMatchObject({
        code: 'password_too_common',
      });
      await expect(changePassword(deps, { user: bob, currentPassword: BOB_PASSWORD, newPassword: 'zqxzqxzqxzqxzqxzqx' })).rejects.toMatchObject({
        code: 'password_too_predictable',
      });
      expect(count('sessions', bob.id)).toBe(1);
      expect(events()).toEqual([]);
      await changePassword(deps, { user: bob, currentPassword: BOB_PASSWORD, newPassword: NEW_PASSWORD });
      expect(await verifyPassword(passwordOf(bob), NEW_PASSWORD)).toBe(true);
      expect(count('sessions', bob.id)).toBe(0);
      expect(events()).toEqual(['PASSWORD_CHANGED']);
    });
  });
});
