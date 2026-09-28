import {
  systemClock,
  type AccountAdminDeps,
  type PreferencesDeps,
  type HistoryDeps,
  type InvitationDeps,
  type KnotDeps,
  type ProcedureDeps,
  type RunDeps,
  type MfaDeps,
  type RecoveryDeps,
  type UserRepository,
  type WorkspaceDeps,
} from '@vergissmeinnicht/application';
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
  createAccountAdminRepository,
  createAccountRecoveryRepository,
  createAuditHistory,
  createCredentialRepository,
  createInvitationRepository,
  createKnotRepository,
  createMfaChallengeRepository,
  createPreferencesRepository,
  createProcedureRepository,
  createRateLimitCounter,
  createRunRepository,
  createSecurityEventLog,
  createSecurityEventReader,
  createTotpRepository,
  createUserRepository,
  createWorkspaceRepository,
  migrationStatus,
  sessions,
  users,
  verifications,
  type AppDatabase,
  type RateLimitCounter,
  type SecurityEventLog,
} from '@vergissmeinnicht/database';
import { canAuthenticate, type UserId } from '@vergissmeinnicht/domain';
import { createSmtpEmailSender } from '@vergissmeinnicht/email';
import { createRunChangeHub, type RunChangeHub } from '@vergissmeinnicht/realtime';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from './config/index.ts';
import type { RunEventsOptions } from './http/run-events.ts';

/** Everything the HTTP layer needs. Built once per process by the composition root. */
export interface AppServices {
  readonly publicOrigin: string;
  /** Offered to every user via `GET /api/about` (AGPL-3.0 §13). */
  readonly sourceCodeUrl: string;
  readonly auth: Auth;
  readonly users: UserRepository;
  readonly invitations: InvitationDeps;
  readonly mfa: MfaDeps;
  readonly recovery: RecoveryDeps;
  readonly accounts: AccountAdminDeps;
  readonly preferences: PreferencesDeps;
  readonly workspaces: WorkspaceDeps;
  readonly procedures: ProcedureDeps;
  readonly runs: RunDeps;
  readonly knots: KnotDeps;
  readonly history: HistoryDeps;
  /** In-process fan-out of committed Run changes to SSE subscribers. */
  readonly runChanges: RunChangeHub;
  /** Stream timing overrides (tests). */
  readonly runEvents?: RunEventsOptions | undefined;
  readonly securityEvents: SecurityEventLog;
  /** Persistent counters for the security-sensitive rate limits (Step 2.9). */
  readonly rateLimits: RateLimitCounter;
  /** Readiness: the database answers and every shipped migration is applied. Never throws. */
  readonly readiness: () => { readonly ready: boolean; readonly reason?: 'database_unavailable' | 'migrations_pending' };
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
  // Without a logger (CLI), Better Auth warnings and errors go to stderr.
  return (logger?: FastifyBaseLogger): AppServices => {
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
      log: (level, message) => {
        if (logger !== undefined) logger[level]({ component: 'better-auth' }, message);
        else if (level === 'warn' || level === 'error') console.error(message);
      },
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
    const invitations = invitationDeps(config, database);
    const recovery: RecoveryDeps = {
      users: userRepository,
      recoveries: createAccountRecoveryRepository(database),
      credentials: createCredentialRepository(database),
      mfa,
      tokens: invitationTokens,
      passwordHasher,
      email: invitations.email,
      clock: systemClock,
      publicOrigin: config.publicOrigin,
    };
    const runChanges = createRunChangeHub();
    const workspaceDeps: WorkspaceDeps = {
      users: userRepository,
      workspaces: createWorkspaceRepository(database),
      clock: systemClock,
    };
    return {
      publicOrigin: config.publicOrigin,
      sourceCodeUrl: config.sourceCodeUrl,
      auth,
      users: userRepository,
      invitations,
      mfa,
      recovery,
      accounts: {
        accounts: createAccountAdminRepository(database),
        securityEvents: createSecurityEventReader(database),
        mfa,
        clock: systemClock,
      },
      preferences: { preferences: createPreferencesRepository(database), clock: systemClock },
      workspaces: workspaceDeps,
      procedures: { workspaces: workspaceDeps.workspaces, procedures: createProcedureRepository(database), clock: systemClock },
      runs: { workspaces: workspaceDeps.workspaces, runs: createRunRepository(database), clock: systemClock, changes: runChanges },
      runChanges,
      knots: { workspaces: workspaceDeps.workspaces, knots: createKnotRepository(database), tokens: invitationTokens, clock: systemClock },
      history: { workspaces: workspaceDeps.workspaces, history: createAuditHistory(database) },
      securityEvents,
      rateLimits: createRateLimitCounter(database),
      readiness: () => {
        try {
          return migrationStatus(database.sqlite).pending ? { ready: false, reason: 'migrations_pending' } : { ready: true };
        } catch {
          return { ready: false, reason: 'database_unavailable' };
        }
      },
      secureCookies: config.mode === 'production',
    };
  };
}
