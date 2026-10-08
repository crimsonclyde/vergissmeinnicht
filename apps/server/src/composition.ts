import {
  emailReminderNotifier,
  systemClock,
  telegramReminderNotifier,
  createPreviewQueue,
  createTextRecognizer,
  type TextRecognitionUseCaseDeps,
  type SuggestionDeps,
  type TextRecognizer,
  type AccountAdminDeps,
  type DocumentExportDeps,
  type DocumentFileDeps,
  type StorageDeps,
  type LinkDeps,
  type ContactDeps,
  type MaintenanceDeps,
  type EquipmentDeps,
  type InstanceSettingsDeps,
  type PreferencesDeps,
  type TodayLayoutDeps,
  type HistoryDeps,
  type ImageDeps,
  type InvitationDeps,
  type KnotDeps,
  type ListDeps,
  type ProcedureDeps,
  type HomeDeps,
  type TodayDeps,
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
  createDocumentFileRepository,
  createDocumentRepository,
  createDocumentTextRepository,
  createStorageRepository,
  createLinkRepository,
  createContactRepository,
  createMaintenanceRepository,
  createEquipmentRepository,
  createImageRepository,
  createInstanceSettingsRepository,
  createInvitationRepository,
  createKnotRepository,
  createListRepository,
  createMfaChallengeRepository,
  createPreferencesRepository,
  createTodayLayoutRepository,
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
  createWorkspaceToolRepository,
  createTodayRepository,
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
import { createDocumentFileProcessor, createDocumentFileStore, createDocumentWorker, createFileMediaStore, createSharpImageProcessor, createTextExtractor } from '@vergissmeinnicht/media';
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
  readonly todayLayouts: TodayLayoutDeps;
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
  /** The combined storage of a Workspace: usage by tool, ceiling and own limit (16.4). */
  readonly storage: StorageDeps;
  /** Links between Documents and Procedures, Schedules and Runs (16.5). */
  readonly links: LinkDeps;
  /** Contacts of a Workspace (16.6): people and organisations — not Users. */
  readonly contacts: ContactDeps;
  /** MaintenanceRecords of a Workspace (16.7). */
  readonly maintenance: MaintenanceDeps;
  readonly equipment: EquipmentDeps;
  /** Files of Documents (16.1): metadata in SQLite, originals and previews under `documentsPath`. */
  readonly documentFiles: DocumentFileDeps;
  /** Folders, Documents, document types and the Workspace's optional tools (16.2). */
  readonly documents: DocumentExportDeps;
  /** Text recognition of document files (16.9): Retry and the Workspace switch. */
  readonly textRecognition: TextRecognitionUseCaseDeps;
  /** Suggestions from recognised text (16.9 task 5). */
  readonly suggestions: SuggestionDeps;
  /** The background text recognizer; the server wakes it periodically for retries that became due. */
  readonly recognizer: TextRecognizer;
  /** Stops the document and OCR worker threads and waits for running previews (shutdown, tests). */
  readonly closeDocumentFiles: () => Promise<void>;
  /** Notification providers, a person's reminder settings and Telegram pairing (13.6–13.8). */
  readonly notifications: NotificationDeps;
  /** The reminder dispatcher (13.5), run by the in-process scheduler. */
  readonly reminders: ReminderDeps;
  /** Home, Procedure cards and personal pins (13.9–13.13). */
  readonly home: HomeDeps;
  readonly today: TodayDeps;
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
    const settingsRepository = createInstanceSettingsRepository(database);
    const tools = createWorkspaceToolRepository(database);
    // One MuPDF thread for previews and embedded text: PDFs are parsed in one place (16.1, 16.9).
    const pdfWorker = createDocumentWorker();
    const documentProcessor = createDocumentFileProcessor({ pdfWorker });
    const documentFiles = {
      files: createDocumentFileRepository(database),
      store: createDocumentFileStore(config.documentsPath),
      processor: documentProcessor,
      clock: systemClock,
    };
    const textExtractor = createTextExtractor({ pdf: pdfWorker, tessdataPath: config.tessdataPath });
    const texts = createDocumentTextRepository(database);
    const recognizer = createTextRecognizer({
      texts,
      store: documentFiles.store,
      extractor: textExtractor,
      clock: systemClock,
      // The error type and code only: a parser's message could quote a file.
      onError: (error) => logger?.warn({ err: { type: (error as Error).name, code: (error as { code?: unknown }).code } }, 'text recognition failed'),
    });
    const previews = createPreviewQueue({
      ...documentFiles,
      // The error type only: a parser's message could quote a file.
      onError: (error) => logger?.error({ err: { type: (error as Error).name } }, 'document preview failed'),
    });
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
      todayLayouts: { todayLayouts: createTodayLayoutRepository(database), clock: systemClock },
      instanceSettings: { settings: createInstanceSettingsRepository(database), clock: systemClock },
      workspaces: workspaceDeps,
      procedures: { workspaces: workspaceDeps.workspaces, procedures: createProcedureRepository(database), clock: systemClock },
      runs,
      schedules: { ...runs, schedules: scheduleRepository, notificationPreferences },
      today: { workspaces: workspaceDeps.workspaces, progress: createTodayRepository(database), clock: systemClock },
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
      documentFiles: {
        ...documentFiles,
        workspaces: workspaceDeps.workspaces,
        tools,
        previews,
        recognizer,
        policy: async () => {
          const settings = await settingsRepository.get();
          return { maxFileBytes: settings.documentMaxFileBytes, formats: settings.documentFormats };
        },
      },
      storage: { workspaces: workspaceDeps.workspaces, storage: createStorageRepository(database), clock: systemClock },
      links: { workspaces: workspaceDeps.workspaces, tools, links: createLinkRepository(database), clock: systemClock },
      contacts: { workspaces: workspaceDeps.workspaces, tools, contacts: createContactRepository(database), clock: systemClock },
      equipment: { workspaces: workspaceDeps.workspaces, tools, equipment: createEquipmentRepository(database), clock: systemClock },
      maintenance: { workspaces: workspaceDeps.workspaces, tools, maintenance: createMaintenanceRepository(database), clock: systemClock },
      documents: { workspaces: workspaceDeps.workspaces, tools, documents: createDocumentRepository(database), store: documentFiles.store, clock: systemClock },
      textRecognition: { workspaces: workspaceDeps.workspaces, tools, texts, recognizer, clock: systemClock },
      recognizer,
      suggestions: { workspaces: workspaceDeps.workspaces, tools, documents: createDocumentRepository(database), texts, clock: systemClock },
      closeDocumentFiles: async () => {
        await recognizer.stop();
        await previews.idle();
        await textExtractor.close();
        await documentProcessor.close();
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
