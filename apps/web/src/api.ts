/** Thin JSON client for the same-origin API. The browser adds the `Origin` header the server checks. */

export interface CurrentUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly serverAdmin: boolean;
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
  resolveInvitation: (token: string) =>
    request<{ email: string; expiresAt: string }>('POST', '/invitations/resolve', { token }),
  acceptInvitation: (token: string, displayName: string, password: string) =>
    request<{ status: 'accepted' }>('POST', '/invitations/accept', { token, displayName, password }),
};
