/** Thin JSON client for the same-origin API. The browser adds the `Origin` header the server checks. */
import type { ProcedureIcon, ReasonPolicy, RunState, StepState, WorkspaceRole } from '@vergissmeinnicht/domain';

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
  readonly state: StepState;
  /** Who set the current state (display-name snapshot), when, and why. */
  readonly stateChange: { readonly by: string; readonly at: string; readonly reason: string | null } | null;
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

export type SecondFactor = { readonly code: string } | { readonly recoveryCode: string };

export interface MfaStatus {
  readonly totpEnabled: boolean;
  readonly recoveryCodesRemaining: number;
}

/** User-facing texts for the API's stable error codes. */
export const ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: 'Email or password is not correct.',
  rate_limited: 'Too many attempts. Please wait a few minutes and try again.',
  invalid_code: 'That code is not valid. Codes can only be used once.',
  mfa_locked: 'Too many wrong codes. Authenticator codes are locked for a while; a recovery code still works.',
  mfa_challenge_invalid: 'The sign-in has expired. Please enter your password again.',
  reauthentication_failed: 'Your current password is not correct.',
  no_pending_enrollment: 'The setup has expired. Please start again.',
  totp_already_enabled: 'Two-factor authentication is already enabled.',
  totp_not_enabled: 'Two-factor authentication is not enabled.',
  invalid_recovery: 'This recovery link is invalid, has expired or was already used.',
  password_too_short: 'The new password must be at least 15 characters.',
  password_too_long: 'The new password must be at most 128 characters.',
  invitation_not_pending: 'This invitation is no longer pending.',
  account_exists: 'An account with this email address already exists.',
  account_not_active: 'This account is disabled.',
  nothing_to_recover: 'This account has no two-factor authentication to reset.',
  second_factor_required: 'Enter your own authenticator code (or a recovery code) to confirm.',
  workspace_not_found: 'This Workspace does not exist or you are no longer a member.',
  forbidden: 'You are not allowed to do this.',
  unknown_account: 'There is no active account with this email address. A server admin must invite the person first.',
  already_member: 'This person is already a member.',
  last_workspace_admin: 'A Workspace needs at least one active admin. Make someone else admin first.',
  member_not_found: 'This person is no longer a member.',
  workspace_name_empty: 'Please enter a name.',
  workspace_name_too_long: 'The name must be at most 80 characters.',
  workspace_name_invalid_characters: 'The name contains characters that are not allowed.',
  invalid_email: 'Please enter a valid email address.',
  procedure_not_found: 'This Procedure no longer exists.',
  procedure_conflict: 'Someone else changed this Procedure in the meantime. Reload it and apply your changes again.',
  procedure_limit_reached: 'This Workspace has reached the maximum number of Procedures.',
  procedure_title_empty: 'Please enter a title.',
  procedure_title_too_long: 'The title must be at most 120 characters.',
  procedure_title_invalid_characters: 'The title contains characters that are not allowed.',
  description_too_long: 'The description must be at most 4000 characters.',
  description_invalid_characters: 'The description contains characters that are not allowed.',
  tag_too_long: 'Each tag must be at most 32 characters.',
  tag_invalid_characters: 'A tag contains characters that are not allowed.',
  too_many_tags: 'A Procedure can have at most 10 tags.',
  too_many_sections: 'A Procedure can have at most 50 Sections.',
  too_many_steps: 'A Procedure can have at most 200 Steps.',
  section_title_empty: 'Every Section needs a title.',
  section_title_too_long: 'Section titles must be at most 120 characters.',
  section_title_invalid_characters: 'A Section title contains characters that are not allowed.',
  step_title_empty: 'Every Step needs a title.',
  step_title_too_long: 'Step titles must be at most 200 characters.',
  step_title_invalid_characters: 'A Step title contains characters that are not allowed.',
  invalid_document: 'This file is not a valid Procedure export.',
  unsupported_format: 'This file is not a Vergissmeinnicht Procedure.',
  unsupported_schema_version: 'This file was created by a different version of Vergissmeinnicht and cannot be imported.',
  invalid_icon: 'The file uses an unknown icon.',
  invalid_reason_policy: 'The file uses an unknown reason setting.',
  invalid_request: 'The request was not valid.',
  run_not_found: 'This Run does not exist.',
  step_not_found: 'This Step does not exist.',
  required_steps_open: 'Some required Steps are still pending or skipped. Mark them done or not applicable, or abort the Run.',
  run_not_active: 'This Run is finished; its Steps can no longer change.',
  step_conflict: 'Someone else changed this Step just now. The Run has been reloaded.',
  invalid_transition: 'This change is not possible. Undo the Step first.',
  reason_required: 'Please give a reason.',
  reason_not_allowed: 'This Step does not take a reason.',
  reason_too_long: 'The reason must be at most 500 characters.',
  reason_invalid_characters: 'The reason contains characters that are not allowed.',
  procedure_has_no_steps: 'This Procedure has no Steps yet. Add at least one Step before starting a Run.',
  run_limit_reached: 'This Workspace has too many active Runs. Finish some before starting new ones.',
  too_many_streams: 'Live updates are not available right now because too many are open. Reload the page to see changes.',
  knot_not_found: 'This Knot link is not valid: it may have expired or been revoked, or you do not have access to what it points to.',
  knot_already_revoked: 'This Knot link was already revoked.',
  knot_target_not_found: 'What this Knot link should point to no longer exists.',
  knot_limit_reached: 'This Workspace has too many active Knot links. Revoke some first.',
  knot_label_empty: 'Please give the link a name.',
  knot_label_too_long: 'The name must be at most 80 characters.',
  knot_label_invalid_characters: 'The name contains characters that are not allowed.',
  invalid_knot_expiry: 'Choose a lifetime between 1 and 365 days, or no expiry.',
  invalid_item_reference: 'This Procedure was restructured in the meantime. Reload it and apply your changes again.',
};

export function messageFor(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  return (error instanceof ApiError ? ERROR_MESSAGES[error.code] : undefined) ?? fallback;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(response.status, payload.error ?? 'request_failed');
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export const api = {
  about: () => request<{ license: string; sourceCodeUrl: string }>('GET', '/about'),
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
  workspaces: async () => (await request<{ workspaces: WorkspaceSummary[] }>('GET', '/workspaces')).workspaces,
  createWorkspace: async (name: string) =>
    (await request<{ workspace: WorkspaceSummary }>('POST', '/workspaces', { name })).workspace,
  workspace: (id: string) =>
    request<{ workspace: WorkspaceSummary; capabilities: string[] }>('GET', `/workspaces/${encodeURIComponent(id)}`),
  renameWorkspace: (id: string, name: string) =>
    request<undefined>('POST', `/workspaces/${encodeURIComponent(id)}/rename`, { name }),
  procedures: async (workspaceId: string) =>
    (await request<{ procedures: Procedure[] }>('GET', `/workspaces/${encodeURIComponent(workspaceId)}/procedures`)).procedures,
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
  restoreProcedure: async (workspaceId: string, id: string) =>
    (
      await request<{ procedure: ProcedureDetail }>(
        'POST',
        `/workspaces/${encodeURIComponent(workspaceId)}/procedures/${encodeURIComponent(id)}/restore`,
      )
    ).procedure,
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
  runs: async (workspaceId: string, state?: RunState) =>
    (
      await request<{ runs: RunSummary[] }>(
        'GET',
        `/workspaces/${encodeURIComponent(workspaceId)}/runs${state === undefined ? '' : `?state=${state}`}`,
      )
    ).runs,
  run: async (workspaceId: string, id: string) =>
    (await request<{ run: RunDetail }>('GET', `/workspaces/${encodeURIComponent(workspaceId)}/runs/${encodeURIComponent(id)}`)).run,
  changeStepState: (
    workspaceId: string,
    runId: string,
    stepId: string,
    change: { expectedState: StepState; state: StepState; reason?: string },
  ) =>
    request<{ step: RunStep; runRevision: number }>(
      'POST',
      `/workspaces/${encodeURIComponent(workspaceId)}/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}/state`,
      change,
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
  runHistory: async (workspaceId: string, runId: string) =>
    (
      await request<{ events: HistoryEvent[] }>(
        'GET',
        `/workspaces/${encodeURIComponent(workspaceId)}/runs/${encodeURIComponent(runId)}/history`,
      )
    ).events,
  procedureHistory: async (workspaceId: string, procedureId: string) =>
    (
      await request<{ events: HistoryEvent[] }>(
        'GET',
        `/workspaces/${encodeURIComponent(workspaceId)}/procedures/${encodeURIComponent(procedureId)}/history`,
      )
    ).events,
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
