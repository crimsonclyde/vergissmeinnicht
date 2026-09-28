import { isActiveServerAdmin, parseUserId, type User, type UserStatus } from '@vergissmeinnicht/domain';
import { rolesWithCapability } from '@vergissmeinnicht/permissions';
import { NotAuthorizedError } from '../invitations/errors.ts';
import { verifyStepUp, type MfaDeps, type SecondFactor } from '../mfa/use-cases.ts';
import type { AccountAdminRepository, AccountSummary } from '../ports/account-admin-repository.ts';
import type { Clock } from '../ports/clock.ts';
import { UnknownAccountError } from '../recovery/errors.ts';
import { AccountStatusUnchangedError, SoleWorkspaceManagerError } from './errors.ts';

export interface AccountAdminDeps {
  readonly accounts: AccountAdminRepository;
  /** Step-up of the acting admin. */
  readonly mfa: MfaDeps;
  readonly clock: Clock;
}

/** Server admins see every account (email, status, TOTP on/off) to manage access. */
export async function listAccounts(deps: AccountAdminDeps, input: { readonly actor: User }): Promise<AccountSummary[]> {
  if (!isActiveServerAdmin(input.actor)) throw new NotAuthorizedError();
  return deps.accounts.list();
}

/**
 * A server admin disables or re-enables another account. Requires step-up (password, plus TOTP if
 * enabled). Disabling ends every session at once; it is refused while the account is the only
 * active admin of a Workspace, so no Workspace is left without a manager.
 */
export async function setAccountStatus(
  deps: AccountAdminDeps,
  input: {
    readonly admin: User;
    readonly adminPassword: string;
    readonly adminFactor: SecondFactor | undefined;
    readonly userId: string;
    readonly status: UserStatus;
  },
): Promise<{ readonly sessionsRevoked: number }> {
  if (!isActiveServerAdmin(input.admin)) throw new NotAuthorizedError();
  const userId = parseUserId(input.userId);
  // Own access is never changed through the admin path (and the last admin cannot lock everyone out).
  if (userId === input.admin.id) throw new NotAuthorizedError();
  await verifyStepUp(deps.mfa, { user: input.admin, password: input.adminPassword, factor: input.adminFactor });

  const result = await deps.accounts.setStatus(
    {
      userId,
      status: input.status,
      at: deps.clock.now(),
      managingRoles: rolesWithCapability('workspace.members.manage'),
    },
    { kind: 'user', userId: input.admin.id, displayName: input.admin.displayName },
  );
  switch (result.outcome) {
    case 'ok':
      return { sessionsRevoked: result.sessionsRevoked };
    case 'forbidden':
      throw new NotAuthorizedError();
    case 'not_found':
      throw new UnknownAccountError();
    case 'unchanged':
      throw new AccountStatusUnchangedError();
    case 'sole_workspace_manager':
      throw new SoleWorkspaceManagerError(result.workspaces);
  }
}
