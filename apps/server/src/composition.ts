import {
  emailReminderNotifier,
  systemClock,
  telegramReminderNotifier,
  type AccountAdminDeps,
  type InstanceSettingsDeps,
  type PreferencesDeps,
  type HistoryDeps,
  type ImageDeps,
  type InvitationDeps,
  type KnotDeps,
  type ListDeps,
  type ProcedureDeps,
  type HomeDeps,
  type NotificationDeps,
  type ReminderDeps,
  type RunDeps,
  type ScheduleDeps,
  type MfaDeps,
  type RecoveryDeps,
  type UserRepository,
  type WorkspaceDeps,
} from '@vergissmeinnicht/application';
import {
  commonPasswords,
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
  createImageRepository,
  createInstanceSettingsRepository,
  createInvitationRepository,
  createKnotRepository,
  createListRepository,
  createMfaChallengeRepository,
  createPreferencesRepository,
  createProcedureRepository,
  createRateLimitCounter,
  createNotificationPreferencesRepository,
  createNotificationProviderRepository,
  createProcedureActivityRepository,
  createReminderQueue,
  createRunRepository,
  createScheduleRepository,
  createSecurityEventLog,
  createSecurityEventReader,
  createTelegramRepository,
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
import { createFileMediaStore, createSharpImageProcessor } from '@vergissmeinnicht/media';
import { createTelegramBotApi } from '@vergissmeinnicht/notifications';
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
  /** Settings of this server (footer), changed by server admins. */
  readonly instanceSettings: InstanceSettingsDeps;
  readonly workspaces: WorkspaceDeps;
  readonly procedures: ProcedureDeps;
  readonly runs: RunDeps;
  /** Scheduled Procedures (13.4); starting one needs the Run dependencies as well. */
  readonly schedules: ScheduleDeps & RunDeps;
  readonly knots: KnotDeps;
  /** Lists (grocery lists) of a Workspace (15.3). */
  readonly lists: ListDeps;
  readonly history: HistoryDeps;
  /** Instruction images (14.3): metadata in SQLite, files under `mediaPath`. */
  readonly images: ImageDeps;
  /** Notification providers, a person's reminder settings and Telegram pairing (13.6–13.8). */
  readonly notifications: NotificationDeps;
  /** The reminder dispatcher (13.5), run by the in-process scheduler. */
  readonly reminders: ReminderDeps;
  /** Home, Procedure cards and personal pins (13.9–13.13). */
  readonly home: HomeDeps;
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
    commonPasswords,
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
      commonPasswords,
      email: invitations.email,
      clock: systemClock,
      publicOrigin: config.publicOrigin,
    };
    const notificationPreferences = createNotificationPreferencesRepository(database);
    const notifications: NotificationDeps = {
      providers: createNotificationProviderRepository(database),
      preferences: notificationPreferences,
      telegram: createTelegramRepository(database),
      telegramApi: createTelegramBotApi(),
      secretBox: mfa.secretBox,
      tokens: invitationTokens,
      email: invitations.email,
      emailConfigured: true,
      clock: systemClock,
    };
    const reminders: ReminderDeps = {
      queue: createReminderQueue(database),
      notifiers: [emailReminderNotifier(notifications, new URL(config.publicOrigin).hostname), telegramReminderNotifier(notifications)],
      clock: systemClock,
      publicOrigin: config.publicOrigin,
    };
    const scheduleRepository = createScheduleRepository(database);
    const runChanges = createRunChangeHub();
    const runs: RunDeps = { workspaces: createWorkspaceRepository(database), runs: createRunRepository(database), clock: systemClock, changes: runChanges };
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
      instanceSettings: { settings: createInstanceSettingsRepository(database), clock: systemClock },
      workspaces: workspaceDeps,
      procedures: { workspaces: workspaceDeps.workspaces, procedures: createProcedureRepository(database), clock: systemClock },
      runs,
      schedules: { ...runs, schedules: scheduleRepository, notificationPreferences },
      home: {
        workspaces: runs.workspaces,
        procedures: createProcedureRepository(database),
        activity: createProcedureActivityRepository(database),
        schedules: scheduleRepository,
        runs: runs.runs,
        settings: createInstanceSettingsRepository(database),
        clock: systemClock,
      },
      notifications,
      reminders,
      runChanges,
      knots: { workspaces: workspaceDeps.workspaces, knots: createKnotRepository(database), tokens: invitationTokens, clock: systemClock },
      lists: { workspaces: workspaceDeps.workspaces, lists: createListRepository(database), clock: systemClock },
      history: { workspaces: workspaceDeps.workspaces, history: createAuditHistory(database) },
      images: {
        workspaces: workspaceDeps.workspaces,
        images: createImageRepository(database),
        store: createFileMediaStore(config.mediaPath),
        processor: createSharpImageProcessor(),
        clock: systemClock,
      },
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
