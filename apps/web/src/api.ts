/** Thin JSON client for the same-origin API. The browser adds the `Origin` header the server checks. */

export interface CurrentUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly serverAdmin: boolean;
}

export const WORKSPACE_ROLES = ['GUEST', 'USER', 'EDITOR', 'ADMIN'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

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

/** Must match PROCEDURE_ICONS on the server; the server rejects anything else. */
export const PROCEDURE_ICONS = [
  'checklist',
  'home',
  'kitchen',
  'cleaning',
  'laundry',
  'garden',
  'pet',
  'car',
  'travel',
  'tools',
  'health',
  'shopping',
  'document',
  'security',
  'star',
] as const;
export type ProcedureIcon = (typeof PROCEDURE_ICONS)[number];

/** Must match REASON_POLICIES on the server. */
export const REASON_POLICIES = ['DISABLED', 'OPTIONAL', 'REQUIRED'] as const;
export type ReasonPolicy = (typeof REASON_POLICIES)[number];

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
  deleteProcedure: (workspaceId: string, id: string) =>
    request<undefined>('POST', `/workspaces/${encodeURIComponent(workspaceId)}/procedures/${encodeURIComponent(id)}/delete`),
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
