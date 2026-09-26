import { systemClock, type InvitationDeps, type MfaDeps, type UserRepository } from '@vergissmeinnicht/application';
import {
  createAuth,
  createSecretBox,
  invitationTokens,
  passwordHasher,
  recoveryCodes,
  totpAlgorithm,
  type Auth,
} from '@vergissmeinnicht/auth';
import {
  accounts,
  createInvitationRepository,
  createMfaChallengeRepository,
  createSecurityEventLog,
  createTotpRepository,
  createUserRepository,
  sessions,
  users,
  verifications,
  type AppDatabase,
  type SecurityEventLog,
} from '@vergissmeinnicht/database';
import { canAuthenticate, type UserId } from '@vergissmeinnicht/domain';
import { createSmtpEmailSender } from '@vergissmeinnicht/email';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from './config/index.ts';

/** Everything the HTTP layer needs. Built once per process by the composition root. */
export interface AppServices {
  readonly publicOrigin: string;
  readonly auth: Auth;
  readonly users: UserRepository;
  readonly invitations: InvitationDeps;
  readonly mfa: MfaDeps;
  readonly securityEvents: SecurityEventLog;
  /** `Secure` + `__Secure-` cookies (production). */
  readonly secureCookies: boolean;
}

/** Composition root: wires infrastructure adapters into application use-case dependencies. */
export function invitationDeps(config: AppConfig, database: AppDatabase): InvitationDeps {
  return {
    users: createUserRepository(database),
    invitations: createInvitationRepository(database),
    tokens: invitationTokens,
    passwords: passwordHasher,
    email: createSmtpEmailSender(config.smtp),
    clock: systemClock,
    publicOrigin: config.publicOrigin,
    invitationTtlHours: config.invitationTtlHours,
  };
}

export function createServices(config: AppConfig, database: AppDatabase) {
  return (log: FastifyBaseLogger): AppServices => {
    const userRepository = createUserRepository(database);
    const securityEvents = createSecurityEventLog(database);
    const auth = createAuth({
      db: database.db,
      schema: { users, sessions, accounts, verifications },
      secret: config.authSecret.reveal(),
      publicOrigin: config.publicOrigin,
      secureCookies: config.mode === 'production',
      canStartSession: async (userId) => {
        const user = await userRepository.findById(userId as UserId);
        return user !== undefined && canAuthenticate(user);
      },
      log: (level, message) => log[level]({ component: 'better-auth' }, message),
    });
    const mfa: MfaDeps = {
      users: userRepository,
      totp: createTotpRepository(database),
      challenges: createMfaChallengeRepository(database),
      secretBox: createSecretBox(config.dataEncryptionKey.reveal()),
      algorithm: totpAlgorithm,
      recoveryCodes,
      challengeTokens: invitationTokens,
      passwords: {
        verify: async (userId, password) => (await auth.api.checkPassword({ body: { userId, password } })).valid,
      },
      clock: systemClock,
    };
    return {
      publicOrigin: config.publicOrigin,
      auth,
      users: userRepository,
      invitations: invitationDeps(config, database),
      mfa,
      securityEvents,
      secureCookies: config.mode === 'production',
    };
  };
}
