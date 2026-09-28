import { TOTP } from 'otpauth';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  InvalidMfaCodeError,
  MfaChallengeInvalidError,
  NoPendingEnrollmentError,
  ReauthenticationFailedError,
  TotpAlreadyEnabledError,
  TotpLockedError,
  TotpNotEnabledError,
  beginMfaChallenge,
  completeMfaChallenge,
  confirmTotpEnrollment,
  disableTotp,
  mfaStatus,
  regenerateRecoveryCodes,
  requiresSecondFactor,
  startTotpEnrollment,
  type MfaDeps,
} from '@vergissmeinnicht/application';
import { createSecretBox, invitationTokens, recoveryCodes, totpAlgorithm } from '@vergissmeinnicht/auth';
import { normalizeEmail, type User } from '@vergissmeinnicht/domain';
import { createMfaChallengeRepository, createTotpRepository } from './mfa-repository.ts';
import { createTestDatabase } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';

const PASSWORD = 'the right passphrase';
const MINUTE = 60_000;

describe('TOTP / MFA use-cases', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let deps: MfaDeps;
  let now: Date;
  let user: User;

  const codeFor = (secret: string, at = now) => TOTP.generate({ secret: TOTP_SECRET(secret), timestamp: at.getTime() });
  const TOTP_SECRET = (secret: string) => new TOTP({ secret }).secret;
  const advance = (ms: number) => {
    now = new Date(now.getTime() + ms);
  };
  const events = () =>
    (database.sqlite.prepare('SELECT type FROM security_events ORDER BY rowid').all() as { type: string }[]).map((r) => r.type);

  async function enroll(): Promise<{ secret: string; codes: readonly string[] }> {
    const { secret } = await startTotpEnrollment(deps, { user, password: PASSWORD });
    const { recoveryCodes: codes } = await confirmTotpEnrollment(deps, { user, code: codeFor(secret) });
    advance(30_000); // the confirmation code's time step is used up
    return { secret, codes };
  }

  beforeEach(async () => {
    database = createTestDatabase();
    now = new Date('2026-09-26T10:00:00Z');
    const users = createUserRepository(database);
    user = await users.create({
      email: normalizeEmail('ada@example.org'),
      displayName: 'Ada',
      emailVerified: true,
      status: 'ACTIVE',
      serverAdmin: false,
    });
    deps = {
      users,
      totp: createTotpRepository(database),
      challenges: createMfaChallengeRepository(database),
      secretBox: createSecretBox('test-data-encryption-key-0123456789abcdef'),
      algorithm: totpAlgorithm,
      recoveryCodes,
      challengeTokens: invitationTokens,
      passwords: { verify: async (userId, password) => userId === user.id && password === PASSWORD },
      clock: { now: () => now },
    };
  });

  afterEach(() => database.dispose());

  describe('enrollment', () => {
    it('requires the current password', async () => {
      await expect(startTotpEnrollment(deps, { user, password: 'wrong' })).rejects.toBeInstanceOf(ReauthenticationFailedError);
      expect(await deps.totp.find(user.id)).toBeUndefined();
    });

    it('is not active until a valid code is proven', async () => {
      const { secret, uri } = await startTotpEnrollment(deps, { user, password: PASSWORD });
      expect(uri).toContain(secret);
      expect(await requiresSecondFactor(deps, user)).toBe(false);
      await expect(confirmTotpEnrollment(deps, { user, code: '000000' })).rejects.toBeInstanceOf(InvalidMfaCodeError);
      expect(await requiresSecondFactor(deps, user)).toBe(false);

      const { recoveryCodes: codes } = await confirmTotpEnrollment(deps, { user, code: codeFor(secret) });
      expect(codes).toHaveLength(10);
      expect(await requiresSecondFactor(deps, user)).toBe(true);
      expect(await mfaStatus(deps, user)).toEqual({ totpEnabled: true, recoveryCodesRemaining: 10 });
      expect(events()).toEqual(['TOTP_ENROLLMENT_STARTED', 'TOTP_ENABLED']);
    });

    it('stores neither the secret nor recovery codes in plaintext', async () => {
      const { secret, codes } = await enroll();
      const dump = JSON.stringify(database.sqlite.prepare('SELECT * FROM totp_credentials').all()) +
        JSON.stringify(database.sqlite.prepare('SELECT * FROM recovery_codes').all()) +
        JSON.stringify(database.sqlite.prepare('SELECT * FROM security_events').all());
      expect(dump).not.toContain(secret);
      for (const code of codes) expect(dump).not.toContain(code.replaceAll('-', ''));
    });

    it('expires an unconfirmed enrollment', async () => {
      const { secret } = await startTotpEnrollment(deps, { user, password: PASSWORD });
      advance(10 * MINUTE);
      await expect(confirmTotpEnrollment(deps, { user, code: codeFor(secret) })).rejects.toBeInstanceOf(
        NoPendingEnrollmentError,
      );
    });

    it('replaces a previous unconfirmed secret', async () => {
      const first = await startTotpEnrollment(deps, { user, password: PASSWORD });
      const second = await startTotpEnrollment(deps, { user, password: PASSWORD });
      expect(second.secret).not.toBe(first.secret);
      await expect(confirmTotpEnrollment(deps, { user, code: codeFor(first.secret) })).rejects.toBeInstanceOf(
        InvalidMfaCodeError,
      );
      await expect(confirmTotpEnrollment(deps, { user, code: codeFor(second.secret) })).resolves.toBeDefined();
    });

    it('cannot be restarted (and so silently replaced) while enabled', async () => {
      await enroll();
      await expect(startTotpEnrollment(deps, { user, password: PASSWORD })).rejects.toBeInstanceOf(TotpAlreadyEnabledError);
    });
  });

  describe('sign-in challenge', () => {
    it('is single use', async () => {
      const { secret } = await enroll();
      const token = await beginMfaChallenge(deps, user);
      const result = await completeMfaChallenge(deps, { token, factor: { code: codeFor(secret) } });
      expect(result).toMatchObject({ user: { id: user.id }, method: 'totp' });
      advance(30_000);
      await expect(completeMfaChallenge(deps, { token, factor: { code: codeFor(secret) } })).rejects.toBeInstanceOf(
        MfaChallengeInvalidError,
      );
    });

    it('rejects a replayed code, even in a new challenge', async () => {
      const { secret } = await enroll();
      const code = codeFor(secret);
      await completeMfaChallenge(deps, { token: await beginMfaChallenge(deps, user), factor: { code } });
      await expect(
        completeMfaChallenge(deps, { token: await beginMfaChallenge(deps, user), factor: { code } }),
      ).rejects.toBeInstanceOf(InvalidMfaCodeError);
      // The confirmation code of the enrollment could not be reused either (enroll() moved on 30 s).
    });

    it('rejects the enrollment confirmation code at sign-in', async () => {
      const { secret } = await startTotpEnrollment(deps, { user, password: PASSWORD });
      const code = codeFor(secret);
      await confirmTotpEnrollment(deps, { user, code });
      await expect(
        completeMfaChallenge(deps, { token: await beginMfaChallenge(deps, user), factor: { code } }),
      ).rejects.toBeInstanceOf(InvalidMfaCodeError);
    });

    it('accepts one step of clock drift but not older codes', async () => {
      const { secret } = await enroll();
      advance(60_000); // keep both test codes newer than the step used by enrollment
      const previous = codeFor(secret, new Date(now.getTime() - 30_000));
      const older = codeFor(secret, new Date(now.getTime() - 60_000));
      await expect(
        completeMfaChallenge(deps, { token: await beginMfaChallenge(deps, user), factor: { code: older } }),
      ).rejects.toBeInstanceOf(InvalidMfaCodeError);
      await expect(
        completeMfaChallenge(deps, { token: await beginMfaChallenge(deps, user), factor: { code: previous } }),
      ).resolves.toMatchObject({ method: 'totp' });
    });

    it('allows five attempts per challenge', async () => {
      const { secret } = await enroll();
      const token = await beginMfaChallenge(deps, user);
      for (let i = 0; i < 5; i++) {
        await expect(completeMfaChallenge(deps, { token, factor: { code: '000000' } })).rejects.toBeInstanceOf(
          InvalidMfaCodeError,
        );
      }
      await expect(completeMfaChallenge(deps, { token, factor: { code: codeFor(secret) } })).rejects.toBeInstanceOf(
        MfaChallengeInvalidError,
      );
    });

    it('expires after five minutes', async () => {
      const { secret } = await enroll();
      const token = await beginMfaChallenge(deps, user);
      advance(5 * MINUTE);
      await expect(completeMfaChallenge(deps, { token, factor: { code: codeFor(secret) } })).rejects.toBeInstanceOf(
        MfaChallengeInvalidError,
      );
    });

    it.each(['', 'short', 'A'.repeat(43)])('rejects unknown or malformed challenge token %#', async (token) => {
      const { secret } = await enroll();
      await expect(completeMfaChallenge(deps, { token, factor: { code: codeFor(secret) } })).rejects.toBeInstanceOf(
        MfaChallengeInvalidError,
      );
    });

    it('fails for a user disabled after the password step', async () => {
      const { secret } = await enroll();
      const token = await beginMfaChallenge(deps, user);
      database.sqlite.prepare("UPDATE users SET status = 'DISABLED'").run();
      await expect(completeMfaChallenge(deps, { token, factor: { code: codeFor(secret) } })).rejects.toBeInstanceOf(
        MfaChallengeInvalidError,
      );
    });

    it('locks TOTP after ten consecutive failures, while recovery codes keep working', async () => {
      const { secret, codes } = await enroll();
      for (let i = 0; i < 10; i++) {
        const token = await beginMfaChallenge(deps, user);
        await expect(completeMfaChallenge(deps, { token, factor: { code: '000000' } })).rejects.toBeInstanceOf(
          InvalidMfaCodeError,
        );
      }
      await expect(
        completeMfaChallenge(deps, { token: await beginMfaChallenge(deps, user), factor: { code: codeFor(secret) } }),
      ).rejects.toBeInstanceOf(TotpLockedError);
      await expect(
        completeMfaChallenge(deps, { token: await beginMfaChallenge(deps, user), factor: { recoveryCode: codes[0] ?? '' } }),
      ).resolves.toMatchObject({ method: 'recovery_code' });
      expect(events()).toContain('TOTP_LOCKED');

      advance(15 * MINUTE);
      await expect(
        completeMfaChallenge(deps, { token: await beginMfaChallenge(deps, user), factor: { code: codeFor(secret) } }),
      ).resolves.toMatchObject({ method: 'totp' });
    });

    it('accepts each recovery code once, also under concurrency', async () => {
      const { codes } = await enroll();
      const code = codes[3] ?? '';
      const attempts = await Promise.allSettled(
        [0, 1, 2].map(async () =>
          completeMfaChallenge(deps, { token: await beginMfaChallenge(deps, user), factor: { recoveryCode: code } }),
        ),
      );
      expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
      expect((await mfaStatus(deps, user)).recoveryCodesRemaining).toBe(9);
      await expect(
        completeMfaChallenge(deps, { token: await beginMfaChallenge(deps, user), factor: { recoveryCode: code } }),
      ).rejects.toBeInstanceOf(InvalidMfaCodeError);
    });
  });

  describe('disable', () => {
    it('requires the password and a valid second factor', async () => {
      const { secret } = await enroll();
      await expect(disableTotp(deps, { user, password: 'wrong', factor: { code: codeFor(secret) } })).rejects.toBeInstanceOf(
        ReauthenticationFailedError,
      );
      await expect(disableTotp(deps, { user, password: PASSWORD, factor: { code: '000000' } })).rejects.toBeInstanceOf(
        InvalidMfaCodeError,
      );
      await expect(
        disableTotp(deps, { user, password: PASSWORD, factor: { recoveryCode: 'aaaa-bbbb-cccc-dddd' } }),
      ).rejects.toBeInstanceOf(InvalidMfaCodeError);
      expect(await requiresSecondFactor(deps, user)).toBe(true);

      await disableTotp(deps, { user, password: PASSWORD, factor: { code: codeFor(secret) } });
      expect(await requiresSecondFactor(deps, user)).toBe(false);
      expect(database.sqlite.prepare('SELECT count(*) AS n FROM recovery_codes').get()).toEqual({ n: 0 });
      expect(events()).toContain('TOTP_DISABLED');
      await expect(disableTotp(deps, { user, password: PASSWORD, factor: { code: '123456' } })).rejects.toBeInstanceOf(
        TotpNotEnabledError,
      );
    });

    it('accepts a recovery code', async () => {
      const { codes } = await enroll();
      await disableTotp(deps, { user, password: PASSWORD, factor: { recoveryCode: codes[0] ?? '' } });
      expect(await requiresSecondFactor(deps, user)).toBe(false);
    });
  });

  describe('recovery code regeneration', () => {
    it('requires the password and invalidates the old codes', async () => {
      const { codes } = await enroll();
      await expect(regenerateRecoveryCodes(deps, { user, password: 'wrong' })).rejects.toBeInstanceOf(
        ReauthenticationFailedError,
      );
      const { recoveryCodes: fresh } = await regenerateRecoveryCodes(deps, { user, password: PASSWORD });
      expect(fresh).toHaveLength(10);
      await expect(
        completeMfaChallenge(deps, { token: await beginMfaChallenge(deps, user), factor: { recoveryCode: codes[0] ?? '' } }),
      ).rejects.toBeInstanceOf(InvalidMfaCodeError);
      await expect(
        completeMfaChallenge(deps, { token: await beginMfaChallenge(deps, user), factor: { recoveryCode: fresh[0] ?? '' } }),
      ).resolves.toMatchObject({ method: 'recovery_code' });
      expect(events()).toContain('RECOVERY_CODES_REGENERATED');
    });

    it('is refused without TOTP', async () => {
      await expect(regenerateRecoveryCodes(deps, { user, password: PASSWORD })).rejects.toBeInstanceOf(TotpNotEnabledError);
    });
  });
});
