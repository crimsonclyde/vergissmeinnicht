/** Thin JSON client for the same-origin API. The browser adds the `Origin` header the server checks. */

export interface CurrentUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly serverAdmin: boolean;
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
  signIn: async (email: string, password: string) =>
    (await request<{ user: CurrentUser }>('POST', '/auth/sign-in', { email, password })).user,
  signOut: () => request<undefined>('POST', '/auth/sign-out'),
  resolveInvitation: (token: string) =>
    request<{ email: string; expiresAt: string }>('POST', '/invitations/resolve', { token }),
  acceptInvitation: (token: string, displayName: string, password: string) =>
    request<{ status: 'accepted' }>('POST', '/invitations/accept', { token, displayName, password }),
};
