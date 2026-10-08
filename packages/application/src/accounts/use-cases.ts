import { isActiveServerAdmin, parseUserId, type User, type UserStatus } from '@vergissmeinnicht/domain';
import { rolesWithCapability } from '@vergissmeinnicht/permissions';
import { NotAuthorizedError } from '../invitations/errors.ts';
import { verifyStepUp, type MfaDeps, type SecondFactor } from '../mfa/use-cases.ts';
import type { AccountAdminRepository, AccountSummary } from '../ports/account-admin-repository.ts';
import type { Clock } from '../ports/clock.ts';
import type { Page } from '../ports/paging.ts';
import type { SecurityEventEntry, SecurityEventReader } from '../ports/security-event-reader.ts';
import { UnknownAccountError } from '../recovery/errors.ts';
import { AccountStatusUnchangedError, SoleWorkspaceManagerError } from './errors.ts';

export interface AccountAdminDeps {
  readonly accounts: AccountAdminRepository;
  readonly securityEvents: SecurityEventReader;
  /** Step-up of the acting admin. */
  readonly mfa: MfaDeps;
  readonly clock: Clock;
}

/** Server admins see every account (email, status, TOTP on/off) to manage access. */
export async function listAccounts(deps: AccountAdminDeps, input: { readonly actor: User }): Promise<AccountSummary[]> {
  if (!isActiveServerAdmin(input.actor)) throw new NotAuthorizedError();
  return deps.accounts.list();
}

/** How many historical identities the server administration lists at most (newest restore first). */
export const HISTORICAL_IDENTITY_LIST_LIMIT = 200;

/**
 * Server admins see historical identities (section 18) — read only: a name and the restore it came from. They
 * cannot be activated, converted, invited, recovered or deleted here (see `docs/development/steps.md` 18.3).
 */
export async function listHistoricalIdentities(deps: AccountAdminDeps, input: { readonly actor: User }) {
  if (!isActiveServerAdmin(input.actor)) throw new NotAuthorizedError();
  return deps.accounts.historicalIdentities(HISTORICAL_IDENTITY_LIST_LIMIT);
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

/** Events per page of the security log. */
export const SECURITY_LOG_PAGE_SIZE = 100;

/**
 * The server-wide security log (sign-ins, MFA, recovery, invitations, account status, Workspace
 * membership), newest first. Server admins only; read-only.
 */
export async function listSecurityEvents(
  deps: AccountAdminDeps,
  input: { readonly actor: User; readonly before?: string | undefined; readonly userId?: string | undefined },
): Promise<Page<SecurityEventEntry>> {
  if (!isActiveServerAdmin(input.actor)) throw new NotAuthorizedError();
  return deps.securityEvents.list({
    limit: SECURITY_LOG_PAGE_SIZE,
    before: input.before,
    subjectUserId: input.userId === undefined ? undefined : parseUserId(input.userId),
  });
}
