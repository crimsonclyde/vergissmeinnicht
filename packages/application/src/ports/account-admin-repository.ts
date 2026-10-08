import type { Actor, NormalizedEmail, UserId, UserStatus, WorkspaceId, WorkspaceRole } from '@vergissmeinnicht/domain';

/** One account as shown to server admins. */
export interface AccountSummary {
  readonly id: UserId;
  readonly email: NormalizedEmail;
  readonly displayName: string;
  readonly status: UserStatus;
  readonly serverAdmin: boolean;
  readonly totpEnabled: boolean;
  readonly createdAt: Date;
}

export type AccountStatusChangeResult =
  | { readonly outcome: 'ok'; readonly sessionsRevoked: number }
  /** The actor is no longer an ACTIVE server admin, or tried to change their own account. */
  | { readonly outcome: 'forbidden' }
  | { readonly outcome: 'not_found' }
  | { readonly outcome: 'unchanged' }
  /** Disabling would leave these Workspaces without an ACTIVE member holding a managing role. */
  | { readonly outcome: 'sole_workspace_manager'; readonly workspaces: readonly { readonly id: WorkspaceId; readonly name: string }[] };

/** A historical identity (section 18) as server admins see it: a name in restored history, never an account. */
export interface HistoricalIdentitySummary {
  readonly id: UserId;
  readonly displayName: string;
  /** The Workspace it was restored for and when (null for an identity whose origin was not recorded). */
  readonly origin: { readonly workspaceId: WorkspaceId; readonly workspaceName: string; readonly restoredAt: Date } | null;
}

export interface AccountAdminRepository {
  /** Every account, ordered by display name. */
  list(): Promise<AccountSummary[]>;
  /** Historical identities, newest restore first (at most `limit`), and how many there are. Read only. */
  historicalIdentities(limit: number): Promise<{ readonly total: number; readonly items: readonly HistoricalIdentitySummary[] }>;
  /**
   * In one IMMEDIATE transaction: re-checks that the actor is still an ACTIVE server admin, refuses
   * self-changes and (when disabling) changes that would leave a Workspace without an ACTIVE member
   * holding one of `managingRoles`, then sets the status and records ACCOUNT_DISABLED / ACCOUNT_ENABLED.
   * Disabling also deletes every session, closes pending sign-in challenges, revokes pending account
   * recoveries of the user and pending invitations the user issued. Nothing is written unless 'ok'.
   */
  setStatus(
    input: {
      readonly userId: UserId;
      readonly status: UserStatus;
      readonly at: Date;
      readonly managingRoles: readonly WorkspaceRole[];
    },
    actor: Actor & { readonly kind: 'user' },
  ): Promise<AccountStatusChangeResult>;
}
