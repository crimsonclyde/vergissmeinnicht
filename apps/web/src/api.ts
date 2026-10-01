/** Thin JSON client for the same-origin API. The browser adds the `Origin` header the server checks. */
import type { ProcedureIcon, ReasonPolicy, RunState, StepState, UserPreferences, WorkspaceRole } from '@vergissmeinnicht/domain';
import { hasMessage, t } from './i18n/index.ts';

// Shared vocabulary comes from the domain package (browser-safe, no server code). The server still
// validates everything; these lists only drive the UI.
export { PROCEDURE_ICONS, REASON_POLICIES, WORKSPACE_ROLES } from '@vergissmeinnicht/domain';
export type { ProcedureIcon, ReasonPolicy, RunState, StepState, WorkspaceRole } from '@vergissmeinnicht/domain';

export interface CurrentUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly serverAdmin: boolean;
}


export interface WorkspaceSummary {
  readonly id: string;
  readonly name: string;
  readonly role: WorkspaceRole;
}

export interface WorkspaceMember {
  readonly userId: string;
  readonly displayName: string;
  readonly role: WorkspaceRole;
  readonly memberSince: string;
  /** Only returned to members who manage the Workspace. */
  readonly email?: string;
  readonly status?: string;
}



/** One optional instruction photo per Step, with its required caption (14.3). */
export interface StepImageRef {
  readonly id: string;
  readonly caption: string;
}

/** Image storage of a Workspace, in bytes. */
export interface ImageUsage {
  readonly usedBytes: number;
  readonly quotaBytes: number;
}

export interface WorkspaceImageStorage extends ImageUsage {
  readonly id: string;
  readonly name: string;
}

export interface StepInput {
  /** Existing Step id; omitted for new Steps (the server assigns ids). */
  readonly id?: string;
  readonly title: string;
  readonly description: string;
  readonly icon: ProcedureIcon | null;
  readonly required: boolean;
  readonly critical: boolean;
  readonly skipReasonPolicy: ReasonPolicy;
  readonly notApplicableReasonPolicy: ReasonPolicy;
  readonly image?: StepImageRef | null;
}

export interface SectionInput {
  readonly id?: string;
  readonly title: string;
  readonly description: string;
  readonly steps: readonly StepInput[];
}

export interface ProcedureContent {
  readonly title: string;
  readonly description: string;
  readonly icon: ProcedureIcon;
  readonly tags: readonly string[];
  readonly sections: readonly SectionInput[];
}

/** List entry (no structure). */
export interface Procedure {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly icon: ProcedureIcon;
  readonly tags: readonly string[];
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A Procedure in the list (13.10): the person's pin, last completion, active executions, next open Occurrence. */
export interface ProcedureCard extends Procedure {
  readonly pinned: boolean;
  readonly lastCompletedAt: string | null;
  readonly active: readonly ActiveExecution[];
  readonly nextOccurrence: { readonly id: string; readonly scheduleId: string; readonly date: string; readonly time: string | null; readonly timeZone: string } | null;
}

export interface ActiveExecution {
  readonly runId: string;
  readonly startedBy: string;
  readonly startedAt: string;
}

export type ReminderUnit = 'DAYS' | 'WEEKS' | 'MONTHS' | 'HOURS';
export interface ReminderOffset {
  readonly unit: ReminderUnit;
  readonly amount: number;
}

export type RecurrenceUnit = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';
/** One-time, fixed calendar, or counted from the last completion (14.1). */
export type Recurrence =
  | { readonly kind: 'ONCE' }
  | { readonly kind: 'FIXED'; readonly unit: RecurrenceUnit; readonly interval: number; readonly weekdays: readonly number[] | null; readonly lastDayOfMonth: boolean }
  | { readonly kind: 'AFTER_COMPLETION'; readonly unit: RecurrenceUnit; readonly interval: number };

export interface PersonRef {
  readonly id: string;
  readonly name: string;
}

/** A series of a standalone Reminder or of a Procedure (14.1). */
export interface Schedule {
  readonly id: string;
  readonly kind: 'REMINDER' | 'PROCEDURE';
  readonly procedureId: string | null;
  /** The Procedure as it is now; `deleted` = its Occurrences can no longer be started. */
  readonly procedure: { readonly title: string; readonly icon: ProcedureIcon; readonly deleted: boolean } | null;
  readonly title: string;
  readonly description: string;
  readonly recurrence: Recurrence;
  /** First due date (`YYYY-MM-DD`) and optional `HH:MM` in `timeZone`. */
  readonly date: string;
  readonly time: string | null;
  readonly timeZone: string;
  readonly reminders: readonly ReminderOffset[];
  readonly assignee: PersonRef | null;
  readonly state: 'ACTIVE' | 'PAUSED' | 'ENDED';
  readonly pausedAt: string | null;
  readonly ended: { readonly at: string; readonly by: string } | null;
  readonly revision: number;
  readonly createdAt: string;
  readonly createdBy: string;
}

export type OccurrenceState = 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED' | 'CANCELLED';

/** One dated instance of a Schedule with its own state and history. */
export interface Occurrence {
  readonly id: string;
  readonly schedule: Schedule;
  readonly dueDate: string;
  readonly time: string | null;
  readonly state: OccurrenceState;
  /** This Occurrence's own Assignee (override). */
  readonly assignee: PersonRef | null;
  /** Who is responsible: the override, else the Schedule's Assignee; null = shared. */
  readonly responsible: PersonRef | null;
  readonly closed: { readonly at: string; readonly by: string } | null;
  readonly skipReason: string | null;
  readonly run: { readonly id: string; readonly state: RunState; readonly startedAt: string; readonly startedBy: string } | null;
  readonly revision: number;
}

export interface OccurrenceHistoryEntry extends Occurrence {
  readonly runs: readonly { readonly runId: string; readonly how: 'STARTED' | 'LINKED'; readonly linkedAt: string; readonly linkedBy: string; readonly ended: 'ABORTED' | 'UNLINKED' | null }[];
}

/** What the Schedule dialog sends; the server validates everything again. */
export interface ScheduleInput {
  readonly title?: string;
  readonly description?: string;
  readonly recurrence: Recurrence;
  readonly date: string;
  readonly time: string | null;
  readonly timeZone: string;
  readonly reminders: readonly ReminderOffset[];
  readonly assigneeUserId: string | null;
}

export interface HomeOverview {
  readonly overdue: readonly Occurrence[];
  readonly today: readonly Occurrence[];
  /** The next 90 days. */
  readonly upcoming: readonly Occurrence[];
  /** Open Occurrences further ahead. */
  readonly later: number;
  readonly recentlyDone: readonly Occurrence[];
  readonly active: readonly RunSummary[];
  readonly pinned: readonly ProcedureCard[];
  readonly recent: readonly ProcedureCard[];
  readonly recentLimit: number;
}

export interface NotificationSettings {
  readonly reminderTime: string;
  readonly email: { readonly available: boolean; readonly enabled: boolean };
  readonly telegram: {
    readonly available: boolean;
    readonly enabled: boolean;
    readonly connected: { readonly label: string; readonly connectedAt: string } | null;
    readonly pairing: { readonly expiresAt: string; readonly claimedBy: string | null } | null;
  };
}

/** Server-wide providers; never contains a provider credential. */
export interface NotificationProviders {
  readonly email: { readonly configured: boolean; readonly enabled: boolean };
  readonly telegram: { readonly enabled: boolean; readonly configured: boolean; readonly botName: string | null };
}

export interface InstanceSettings {
  readonly footerHidden: boolean;
  readonly recentProceduresLimit: number;
}

export interface DeletedProcedure extends Procedure {
  readonly deletedAt: string;
  /** Display name of the person who deleted it. */
  readonly deletedBy: string;
}

export interface ProcedureStep extends StepInput {
  readonly id: string;
  readonly kind: 'CHECK';
}

export interface ProcedureSection {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly steps: readonly ProcedureStep[];
}

export interface ProcedureDetail extends Procedure {
  readonly sections: readonly ProcedureSection[];
}


export interface RunInfo {
  readonly id: string;
  readonly procedureId: string;
  readonly procedureRevision: number;
  readonly title: string;
  readonly description: string;
  readonly icon: ProcedureIcon;
  readonly tags: readonly string[];
  readonly state: RunState;
  /** Increases with every change; used to notice missed live updates. */
  readonly revision: number;
  readonly startedAt: string;
  /** Display name at the time the Run was started. */
  readonly startedBy: string;
  /** Set once the Run is COMPLETED or ABORTED. */
  readonly ended: { readonly at: string; readonly by: string; readonly reason: string | null } | null;
}

export interface RunSummary extends RunInfo {
  readonly stepCounts: Readonly<Record<StepState, number>>;
}

export interface RunStep {
  readonly id: string;
  readonly kind: 'CHECK';
  readonly title: string;
  readonly description: string;
  readonly icon: ProcedureIcon | null;
  readonly required: boolean;
  readonly critical: boolean;
  readonly skipReasonPolicy: ReasonPolicy;
  readonly notApplicableReasonPolicy: ReasonPolicy;
  /** The photo as it was when the Run started. */
  readonly image: StepImageRef | null;
  readonly state: StepState;
  /**
   * Who set the current state (display-name snapshot), when (server time), and why. `deviceAt`: the
   * device clock of a change made offline and sent later — informational only (8.5).
   */
  readonly stateChange: { readonly by: string; readonly at: string; readonly reason: string | null; readonly deviceAt?: string | null } | null;
}

export interface RunDetail extends RunInfo {
  readonly sections: readonly { readonly id: string; readonly title: string; readonly description: string; readonly steps: readonly RunStep[] }[];
}

export interface HistoryEvent {
  readonly id: string;
  readonly type: string;
  readonly at: string;
  /** Display name at the time of the event. */
  readonly actor: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly metadata: Readonly<Record<string, string | number | boolean | readonly string[]>>;
}

/** One page of a list; pass `nextCursor` back to load the following page (null = last page). */
export interface HistoryPage {
  readonly events: HistoryEvent[];
  readonly nextCursor: string | null;
}

export interface SecurityLogEntry {
  readonly id: string;
  readonly type: string;
  readonly at: string;
  /** Display-name snapshot or system channel (e.g. `anonymous`, `cli:admin-recover`). */
  readonly actor: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly subjectEmail: string | null;
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
}

export type KnotTargetType = 'PROCEDURE' | 'RUN';

export interface KnotInfo {
  readonly id: string;
  readonly label: string;
  /** `title` is null right after creation; `available` is false for a deleted Procedure. */
  readonly target: { readonly type: KnotTargetType; readonly id: string; readonly title: string | null; readonly available: boolean };
  readonly status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  readonly createdAt: string;
  /** Display name of the creator. */
  readonly createdBy: string;
  readonly expiresAt: string | null;
  readonly revoked: { readonly at: string; readonly by: string } | null;
}

export interface PendingInvitation {
  readonly id: string;
  readonly email: string;
  readonly grantsServerAdmin: boolean;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface AccountInfo {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly status: 'ACTIVE' | 'DISABLED';
  readonly serverAdmin: boolean;
  readonly totpEnabled: boolean;
  readonly createdAt: string;
}

export type SecondFactor = { readonly code: string } | { readonly recoveryCode: string };

export interface MfaStatus {
  readonly totpEnabled: boolean;
  readonly recoveryCodesRemaining: number;
}

/** User-facing text for an API error: the catalog's `error.<code>` message, else the fallback. */
export function messageFor(error: unknown, fallback: string = t('error.generic')): string {
  const key = error instanceof ApiError ? `error.${error.code}` : '';
  return hasMessage(key) ? t(key) : fallback;
}

/** The request never got an answer (offline, server unreachable) — as opposed to an error answer. */
export const isNetworkError = (error: unknown): boolean => !(error instanceof ApiError) && error instanceof TypeError;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** The rest of the error body (e.g. the Workspaces of `sole_workspace_admin`). */
  readonly details: Readonly<Record<string, unknown>>;

  constructor(status: number, code: string, details: Readonly<Record<string, unknown>> = {}) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const afterQuery = (after: string | undefined) => (after === undefined ? '' : `?after=${encodeURIComponent(after)}`);

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const { error, ...details } = (await response.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
    throw new ApiError(response.status, error ?? 'request_failed', details);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

/** The image as served to members of the Workspace (same-origin, session cookie). */
export const imageUrl = (workspaceId: string, imageId: string) => `/api/workspaces/${encodeURIComponent(workspaceId)}/images/${encodeURIComponent(imageId)}`;

/** Sends raw bytes (image or archive) and maps error answers like `request`. */
async function sendBytes<T>(path: string, body: Blob): Promise<T> {
  const response = await fetch(`/api${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/octet-stream' }, body });
  if (!response.ok) {
    const { error, ...details } = (await response.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
    throw new ApiError(response.status, error ?? 'request_failed', details);
  }
  return (await response.json()) as T;
}

/** A Procedure archive (JSON document + images) as a file to save. */
async function exportProcedureArchive(workspaceId: string, id: string): Promise<Blob> {
  const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/procedures/${encodeURIComponent(id)}/archive`, { credentials: 'same-origin' });
  if (!response.ok) {
    const { error, ...details } = (await response.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
    throw new ApiError(response.status, error ?? 'request_failed', details);
  }
  return response.blob();
}

/** Raw bytes (not JSON): the server identifies, checks and re-encodes the image. */
async function uploadImage(workspaceId: string, image: Blob, replacing?: string): Promise<{ image: { id: string; width: number; height: number }; usage: ImageUsage }> {
  const query = replacing === undefined ? '' : `?replacing=${encodeURIComponent(replacing)}`;
  const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/images${query}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/octet-stream' },
    body: image,
  });
  if (!response.ok) {
    const { error, ...details } = (await response.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
    // 413 comes from the body limit, before any route code.
    throw new ApiError(response.status, response.status === 413 ? 'image_too_large' : (error ?? 'request_failed'), details);
  }
  return (await response.json()) as { image: { id: string; width: number; height: number }; usage: ImageUsage };
}

const schedulePath = (workspaceId: string, scheduleId: string) => `/workspaces/${encodeURIComponent(workspaceId)}/schedules/${encodeURIComponent(scheduleId)}`;
const occurrencePath = (workspaceId: string, id: string) => `/workspaces/${encodeURIComponent(workspaceId)}/occurrences/${encodeURIComponent(id)}`;

export const api = {
  uploadImage,
  imageUsage: async (workspaceId: string) => (await request<{ usage: ImageUsage }>('GET', `/workspaces/${encodeURIComponent(workspaceId)}/images/usage`)).usage,
  imageStorage: async () => (await request<{ workspaces: WorkspaceImageStorage[] }>('GET', '/admin/image-storage')).workspaces,
  setImageQuota: (workspaceId: string, quota: number) => request<undefined>('POST', `/admin/image-storage/${encodeURIComponent(workspaceId)}/quota`, { quota }),
  about: () => request<{ license: string; sourceCodeUrl: string; footerHidden: boolean }>('GET', '/about'),
  instanceSettings: async () => (await request<{ settings: InstanceSettings }>('GET', '/admin/settings')).settings,
  updateInstanceSettings: async (settings: Partial<InstanceSettings>) =>
    (await request<{ settings: InstanceSettings }>('POST', '/admin/settings', settings)).settings,
  notificationProviders: async () => (await request<{ providers: NotificationProviders }>('GET', '/admin/notifications')).providers,
  setEmailReminders: async (enabled: boolean) =>
    (await request<{ providers: NotificationProviders }>('POST', '/admin/notifications/email', { enabled })).providers,
  /** `botToken`: a new token (checked by the server with Telegram), `null` removes it, omitted keeps it. It is never sent back. */
  configureTelegram: async (input: { enabled: boolean; botToken?: string | null }) =>
    (await request<{ providers: NotificationProviders }>('POST', '/admin/notifications/telegram', input)).providers,
  testNotificationProvider: async (provider: 'EMAIL' | 'TELEGRAM') =>
    (await request<{ result: { delivered: boolean; botName?: string; reason?: string } }>('POST', '/admin/notifications/test', { provider })).result,
  notificationSettings: async () => (await request<{ settings: NotificationSettings }>('GET', '/account/notifications')).settings,
  updateNotificationSettings: async (changes: { reminderTime?: string; emailReminders?: boolean; telegramReminders?: boolean }) =>
    (await request<{ settings: NotificationSettings }>('POST', '/account/notifications', changes)).settings,
  /** The link carries a one-time token; it is shown once. */
  startTelegramPairing: () => request<{ url: string; expiresAt: string }>('POST', '/account/notifications/telegram/pair'),
  confirmTelegramPairing: async () => (await request<{ settings: NotificationSettings }>('POST', '/account/notifications/telegram/confirm')).settings,
  cancelTelegramPairing: async () => (await request<{ settings: NotificationSettings }>('POST', '/account/notifications/telegram/cancel')).settings,
  disconnectTelegram: async () => (await request<{ settings: NotificationSettings }>('POST', '/account/notifications/telegram/disconnect')).settings,
  currentUser: async (): Promise<CurrentUser | null> => {
    try {
      return (await request<{ user: CurrentUser }>('GET', '/auth/session')).user;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },
  /** Either a full sign-in or the request for the second factor (no session exists yet). */
  signIn: (email: string, password: string) =>
    request<{ user: CurrentUser } | { mfaRequired: true }>('POST', '/auth/sign-in', { email, password }),
  completeMfa: async (factor: SecondFactor) => (await request<{ user: CurrentUser }>('POST', '/auth/mfa', factor)).user,
  mfaStatus: () => request<MfaStatus>('GET', '/account/mfa'),
  preferences: async () => (await request<{ preferences: UserPreferences }>('GET', '/account/preferences')).preferences,
  updatePreferences: async (changes: Partial<UserPreferences>) =>
    (await request<{ preferences: UserPreferences }>('POST', '/account/preferences', changes)).preferences,
  startTotp: (password: string) => request<{ secret: string; uri: string }>('POST', '/account/mfa/totp/setup', { password }),
  confirmTotp: (code: string) => request<{ recoveryCodes: string[] }>('POST', '/account/mfa/totp/confirm', { code }),
  disableTotp: (password: string, factor: SecondFactor) =>
    request<undefined>('POST', '/account/mfa/totp/disable', { password, ...factor }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<undefined>('POST', '/account/password', { currentPassword, newPassword }),
  resolveRecovery: (token: string) =>
    request<{ email: string; resetPassword: boolean; resetTotp: boolean; requiresCurrentPassword: boolean; expiresAt: string }>(
      'POST',
      '/recoveries/resolve',
      { token },
    ),
  completeRecovery: (token: string, passwords: { newPassword?: string; currentPassword?: string }) =>
    request<undefined>('POST', '/recoveries/complete', { token, ...passwords }),
  regenerateRecoveryCodes: (password: string) =>
    request<{ recoveryCodes: string[] }>('POST', '/account/mfa/recovery-codes', { password }),
  signOut: () => request<undefined>('POST', '/auth/sign-out'),
  invitations: async () => (await request<{ invitations: PendingInvitation[] }>('GET', '/admin/invitations')).invitations,
  invite: (email: string, grantsServerAdmin: boolean) =>
    request<{ invitation: PendingInvitation; delivery: 'sent' | 'failed' }>('POST', '/admin/invitations', { email, grantsServerAdmin }),
  revokeInvitation: (id: string) => request<undefined>('POST', `/admin/invitations/${encodeURIComponent(id)}/revoke`),
  startRecovery: (input: {
    email: string;
    resetPassword: boolean;
    resetTotp: boolean;
    password: string;
    code?: string;
  }) => request<{ recovery: { expiresAt: string }; delivery: 'sent' | 'failed' }>('POST', '/admin/recoveries', input),
  securityLog: (page: { before?: string; userId?: string } = {}) => {
    const query = new URLSearchParams();
    if (page.before !== undefined) query.set('before', page.before);
    if (page.userId !== undefined) query.set('userId', page.userId);
    const suffix = query.size === 0 ? '' : `?${query.toString()}`;
    return request<{ events: SecurityLogEntry[]; nextCursor: string | null }>('GET', `/admin/security-events${suffix}`);
  },
  accounts: async () => (await request<{ accounts: AccountInfo[] }>('GET', '/admin/accounts')).accounts,
  setAccountStatus: (userId: string, input: { status: AccountInfo['status']; password: string; code?: string }) =>
    request<{ status: AccountInfo['status']; sessionsRevoked: number }>(
      'POST',
      `/admin/accounts/${encodeURIComponent(userId)}/status`,
      input,
    ),
  workspaces: async () => (await request<{ workspaces: WorkspaceSummary[] }>('GET', '/workspaces')).workspaces,
  createWorkspace: async (name: string) =>
    (await request<{ workspace: WorkspaceSummary }>('POST', '/workspaces', { name })).workspace,
  workspace: (id: string) =>
    request<{ workspace: WorkspaceSummary; capabilities: string[] }>('GET', `/workspaces/${encodeURIComponent(id)}`),
  renameWorkspace: (id: string, name: string) =>
    request<undefined>('POST', `/workspaces/${encodeURIComponent(id)}/rename`, { name }),
  procedures: async (workspaceId: string) =>
    (await request<{ procedures: ProcedureCard[] }>('GET', `/workspaces/${encodeURIComponent(workspaceId)}/procedures`)).procedures,
  home: (workspaceId: string) => request<HomeOverview>('GET', `/workspaces/${encodeURIComponent(workspaceId)}/home`),
  pinProcedure: (workspaceId: string, id: string, pinned: boolean) =>
    request<undefined>('POST', `/workspaces/${encodeURIComponent(workspaceId)}/procedures/${encodeURIComponent(id)}/${pinned ? 'pin' : 'unpin'}`),
  createSchedule: async (workspaceId: string, input: ScheduleInput & { readonly procedureId?: string }) =>
    (await request<{ schedule: Schedule }>('POST', `/workspaces/${encodeURIComponent(workspaceId)}/schedules`, input)).schedule,
  updateSchedule: async (workspaceId: string, scheduleId: string, expectedRevision: number, input: ScheduleInput) =>
    (await request<{ schedule: Schedule }>('POST', `${schedulePath(workspaceId, scheduleId)}/update`, { expectedRevision, ...input })).schedule,
  pauseSchedule: async (workspaceId: string, scheduleId: string, expectedRevision: number) =>
    (await request<{ schedule: Schedule }>('POST', `${schedulePath(workspaceId, scheduleId)}/pause`, { expectedRevision })).schedule,
  resumeSchedule: async (workspaceId: string, scheduleId: string, expectedRevision: number, skipElapsed: boolean) =>
    (await request<{ schedule: Schedule }>('POST', `${schedulePath(workspaceId, scheduleId)}/resume`, { expectedRevision, skipElapsed })).schedule,
  endSchedule: async (workspaceId: string, scheduleId: string, expectedRevision: number) =>
    (await request<{ schedule: Schedule }>('POST', `${schedulePath(workspaceId, scheduleId)}/end`, { expectedRevision })).schedule,
  skipOlderOccurrences: async (workspaceId: string, scheduleId: string, before: string) =>
    (await request<{ skipped: number }>('POST', `${schedulePath(workspaceId, scheduleId)}/skip-older`, { before })).skipped,
  scheduleHistory: (workspaceId: string, scheduleId: string) =>
    request<{ schedule: Schedule; occurrences: OccurrenceHistoryEntry[] }>('GET', schedulePath(workspaceId, scheduleId)),
  completeOccurrence: async (workspaceId: string, id: string) =>
    (await request<{ occurrence: Occurrence }>('POST', `${occurrencePath(workspaceId, id)}/complete`, {})).occurrence,
  reopenOccurrence: async (workspaceId: string, id: string) =>
    (await request<{ occurrence: Occurrence }>('POST', `${occurrencePath(workspaceId, id)}/reopen`, {})).occurrence,
  skipOccurrence: async (workspaceId: string, id: string, reason: string) =>
    (await request<{ occurrence: Occurrence }>('POST', `${occurrencePath(workspaceId, id)}/skip`, reason.trim() === '' ? {} : { reason })).occurrence,
  moveOccurrence: async (workspaceId: string, id: string, date: string, time: string | null) =>
    (await request<{ occurrence: Occurrence }>('POST', `${occurrencePath(workspaceId, id)}/move`, { date, time })).occurrence,
  assignOccurrence: async (workspaceId: string, id: string, assigneeUserId: string | null) =>
    (await request<{ occurrence: Occurrence }>('POST', `${occurrencePath(workspaceId, id)}/assign`, { assigneeUserId })).occurrence,
  startOccurrence: async (workspaceId: string, id: string) => (await request<{ run: RunDetail }>('POST', `${occurrencePath(workspaceId, id)}/start`)).run,
  linkableRuns: async (workspaceId: string, id: string) => (await request<{ runs: RunSummary[] }>('GET', `${occurrencePath(workspaceId, id)}/linkable-runs`)).runs,
  linkRun: async (workspaceId: string, id: string, runId: string) =>
    (await request<{ occurrence: Occurrence }>('POST', `${occurrencePath(workspaceId, id)}/link-run`, { runId })).occurrence,
  unlinkRun: async (workspaceId: string, id: string) =>
    (await request<{ occurrence: Occurrence }>('POST', `${occurrencePath(workspaceId, id)}/unlink-run`, {})).occurrence,
  procedure: async (workspaceId: string, id: string) =>
    (
      await request<{ procedure: ProcedureDetail }>(
        'GET',
        `/workspaces/${encodeURIComponent(workspaceId)}/procedures/${encodeURIComponent(id)}`,
      )
    ).procedure,
  createProcedure: async (workspaceId: string, content: ProcedureContent) =>
    (await request<{ procedure: ProcedureDetail }>('POST', `/workspaces/${encodeURIComponent(workspaceId)}/procedures`, content))
      .procedure,
  updateProcedure: async (workspaceId: string, id: string, expectedRevision: number, content: ProcedureContent) =>
    (
      await request<{ procedure: ProcedureDetail }>(
        'POST',
        `/workspaces/${encodeURIComponent(workspaceId)}/procedures/${encodeURIComponent(id)}/update`,
        { ...content, expectedRevision },
      )
    ).procedure,
  deletedProcedures: async (workspaceId: string) =>
    (await request<{ procedures: DeletedProcedure[] }>('GET', `/workspaces/${encodeURIComponent(workspaceId)}/procedures/deleted`))
      .procedures,
  deletedProcedure: async (workspaceId: string, id: string) =>
    (
      await request<{ procedure: ProcedureDetail }>(
        'GET',
        `/workspaces/${encodeURIComponent(workspaceId)}/procedures/deleted/${encodeURIComponent(id)}`,
      )
    ).procedure,
  restoreProcedure: async (workspaceId: string, id: string) =>
    (
      await request<{ procedure: ProcedureDetail }>(
        'POST',
        `/workspaces/${encodeURIComponent(workspaceId)}/procedures/${encodeURIComponent(id)}/restore`,
      )
    ).procedure,
  exportProcedureArchive,
  importProcedureArchive: async (workspaceId: string, archive: Blob) =>
    (await sendBytes<{ procedure: ProcedureDetail }>(`/workspaces/${encodeURIComponent(workspaceId)}/procedures/import-archive`, archive)).procedure,
  exportProcedure: (workspaceId: string, id: string) =>
    request<unknown>('GET', `/workspaces/${encodeURIComponent(workspaceId)}/procedures/${encodeURIComponent(id)}/export`),
  importProcedure: async (workspaceId: string, document: unknown) =>
    (await request<{ procedure: ProcedureDetail }>('POST', `/workspaces/${encodeURIComponent(workspaceId)}/procedures/import`, document))
      .procedure,
  duplicateProcedure: async (workspaceId: string, id: string) =>
    (
      await request<{ procedure: ProcedureDetail }>(
        'POST',
        `/workspaces/${encodeURIComponent(workspaceId)}/procedures/${encodeURIComponent(id)}/duplicate`,
      )
    ).procedure,
  deleteProcedure: (workspaceId: string, id: string) =>
    request<undefined>('POST', `/workspaces/${encodeURIComponent(workspaceId)}/procedures/${encodeURIComponent(id)}/delete`),
  /** Newest first; `before` = `nextCursor` of the previous page. */
  runs: (workspaceId: string, page: { state?: RunState; procedureId?: string; before?: string } = {}) => {
    const query = new URLSearchParams();
    if (page.state !== undefined) query.set('state', page.state);
    if (page.procedureId !== undefined) query.set('procedureId', page.procedureId);
    if (page.before !== undefined) query.set('before', page.before);
    const suffix = query.size === 0 ? '' : `?${query.toString()}`;
    return request<{ runs: RunSummary[]; nextCursor: string | null }>('GET', `/workspaces/${encodeURIComponent(workspaceId)}/runs${suffix}`);
  },
  run: async (workspaceId: string, id: string) =>
    (await request<{ run: RunDetail }>('GET', `/workspaces/${encodeURIComponent(workspaceId)}/runs/${encodeURIComponent(id)}`)).run,
  changeStepState: (
    workspaceId: string,
    runId: string,
    stepId: string,
    change: { expectedState: StepState; state: StepState; reason?: string },
    /** Only for changes made offline and sent later (8.5); `userId` is the account that made it. */
    offline?: { clientChangeId: string; userId: string; deviceTime: string },
  ) =>
    request<{ step: RunStep; runRevision: number; duplicate: boolean }>(
      'POST',
      `/workspaces/${encodeURIComponent(workspaceId)}/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}/state`,
      offline === undefined ? change : { ...change, offline },
    ),
  completeRun: async (workspaceId: string, runId: string) =>
    (await request<{ run: RunDetail }>('POST', `/workspaces/${encodeURIComponent(workspaceId)}/runs/${encodeURIComponent(runId)}/complete`))
      .run,
  abortRun: async (workspaceId: string, runId: string, reason: string) =>
    (
      await request<{ run: RunDetail }>(
        'POST',
        `/workspaces/${encodeURIComponent(workspaceId)}/runs/${encodeURIComponent(runId)}/abort`,
        reason.trim() === '' ? {} : { reason },
      )
    ).run,
  runHistory: (workspaceId: string, runId: string, after?: string) =>
    request<HistoryPage>(
      'GET',
      `/workspaces/${encodeURIComponent(workspaceId)}/runs/${encodeURIComponent(runId)}/history${afterQuery(after)}`,
    ),
  procedureHistory: (workspaceId: string, procedureId: string, after?: string) =>
    request<HistoryPage>(
      'GET',
      `/workspaces/${encodeURIComponent(workspaceId)}/procedures/${encodeURIComponent(procedureId)}/history${afterQuery(after)}`,
    ),
  startRun: async (workspaceId: string, procedureId: string) =>
    (await request<{ run: RunDetail }>('POST', `/workspaces/${encodeURIComponent(workspaceId)}/runs`, { procedureId })).run,
  knots: async (workspaceId: string) =>
    (await request<{ knots: KnotInfo[] }>('GET', `/workspaces/${encodeURIComponent(workspaceId)}/knots`)).knots,
  /** The returned URL contains the token; it is shown once and never again. */
  createKnot: (
    workspaceId: string,
    input: { target: { type: KnotTargetType; id: string }; label: string; expiresInDays: number | null },
  ) => request<{ knot: KnotInfo; url: string }>('POST', `/workspaces/${encodeURIComponent(workspaceId)}/knots`, input),
  revokeKnot: (workspaceId: string, knotId: string) =>
    request<undefined>('POST', `/workspaces/${encodeURIComponent(workspaceId)}/knots/${encodeURIComponent(knotId)}/revoke`),
  /** The token travels in the body, never in the API URL. */
  resolveKnot: (token: string) =>
    request<{ workspaceId: string; target: { type: KnotTargetType; id: string } }>('POST', '/knots/resolve', { token }),
  leaveWorkspace: (id: string) => request<undefined>('POST', `/workspaces/${encodeURIComponent(id)}/leave`),
  members: async (id: string) =>
    (await request<{ members: WorkspaceMember[] }>('GET', `/workspaces/${encodeURIComponent(id)}/members`)).members,
  addMember: (id: string, email: string, role: WorkspaceRole) =>
    request<{ member: WorkspaceMember }>('POST', `/workspaces/${encodeURIComponent(id)}/members`, { email, role }),
  changeMemberRole: (id: string, userId: string, role: WorkspaceRole) =>
    request<undefined>('POST', `/workspaces/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}/role`, { role }),
  removeMember: (id: string, userId: string) =>
    request<undefined>('POST', `/workspaces/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}/remove`),
  resolveInvitation: (token: string) =>
    request<{ email: string; expiresAt: string }>('POST', '/invitations/resolve', { token }),
  acceptInvitation: (token: string, displayName: string, password: string) =>
    request<{ status: 'accepted' }>('POST', '/invitations/accept', { token, displayName, password }),
};
