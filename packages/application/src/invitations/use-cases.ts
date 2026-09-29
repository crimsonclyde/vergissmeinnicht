import {
  invitationState,
  isActiveServerAdmin,
  type Actor,
  type Invitation,
  type InvitationId,
  normalizeDisplayName,
  passwordContextOf,
  validateNewPassword,
  type CommonPasswordList,
  type NormalizedEmail,
  type User,
} from '@vergissmeinnicht/domain';
import type { Clock } from '../ports/clock.ts';
import type { EmailSender } from '../ports/email-sender.ts';
import type { InvitationRepository } from '../ports/invitation-repository.ts';
import type { InvitationTokens } from '../ports/invitation-tokens.ts';
import type { PasswordHasher } from '../ports/password-hasher.ts';
import type { UserRepository } from '../ports/user-repository.ts';
import {
  AccountAlreadyExistsError,
  BootstrapNotAllowedError,
  InvalidInvitationError,
  InvitationNotRevocableError,
  NotAuthorizedError,
} from './errors.ts';
import { invitationAcceptUrl, invitationEmail } from './invitation-email.ts';

export interface InvitationDeps {
  readonly users: UserRepository;
  readonly invitations: InvitationRepository;
  readonly tokens: InvitationTokens;
  readonly passwords: PasswordHasher;
  /** Offline list of common/breached passwords (13.3). */
  readonly commonPasswords: CommonPasswordList;
  readonly email: EmailSender;
  readonly clock: Clock;
  readonly publicOrigin: string;
  readonly invitationTtlHours: number;
}

const HOUR_MS = 3_600_000;

function userActor(user: User): Actor {
  return { kind: 'user', userId: user.id, displayName: user.displayName };
}

async function createInvitation(
  deps: InvitationDeps,
  email: NormalizedEmail,
  grantsServerAdmin: boolean,
  actor: Actor,
): Promise<{ invitation: Invitation; token: string }> {
  if (await deps.users.findByEmail(email)) {
    throw new AccountAlreadyExistsError();
  }
  const now = deps.clock.now();
  const { token, hash } = deps.tokens.generate();
  const invitation = await deps.invitations.issue(
    {
      email,
      tokenHash: hash,
      grantsServerAdmin,
      createdAt: now,
      expiresAt: new Date(now.getTime() + deps.invitationTtlHours * HOUR_MS),
    },
    actor,
  );
  return { invitation, token };
}

export type DeliveryResult = 'sent' | 'failed';

/**
 * A server admin invites someone by email. The token only ever travels in the email: it is
 * not returned, so the inviter cannot accept on the invitee's behalf. If delivery fails the
 * invitation stays pending (no account exists yet) and can be re-issued or revoked.
 */
export async function issueInvitation(
  deps: InvitationDeps,
  input: { readonly inviter: User; readonly email: NormalizedEmail; readonly grantsServerAdmin: boolean },
): Promise<{ invitation: Invitation; delivery: DeliveryResult }> {
  if (!isActiveServerAdmin(input.inviter)) {
    throw new NotAuthorizedError();
  }
  const { invitation, token } = await createInvitation(
    deps,
    input.email,
    input.grantsServerAdmin,
    userActor(input.inviter),
  );
  try {
    await deps.email.send(
      invitationEmail(invitation, invitationAcceptUrl(deps.publicOrigin, token), input.inviter.displayName),
    );
    return { invitation, delivery: 'sent' };
  } catch {
    return { invitation, delivery: 'failed' };
  }
}

/**
 * One-time creation of the first server admin from the operator's terminal. Returns the
 * acceptance URL for the operator to open; nothing is emailed. Refused once any server admin exists.
 */
export async function bootstrapServerAdmin(
  deps: InvitationDeps,
  input: { readonly email: NormalizedEmail },
): Promise<{ invitation: Invitation; acceptUrl: string }> {
  if (await deps.users.hasServerAdmin()) {
    throw new BootstrapNotAllowedError();
  }
  const { invitation, token } = await createInvitation(deps, input.email, true, {
    kind: 'system',
    label: 'cli:admin-bootstrap',
  });
  return { invitation, acceptUrl: invitationAcceptUrl(deps.publicOrigin, token) };
}

export async function revokeInvitation(
  deps: InvitationDeps,
  input: { readonly actor: User; readonly invitationId: InvitationId },
): Promise<void> {
  if (!isActiveServerAdmin(input.actor)) {
    throw new NotAuthorizedError();
  }
  const revoked = await deps.invitations.revoke(input.invitationId, userActor(input.actor), deps.clock.now());
  if (!revoked) {
    throw new InvitationNotRevocableError();
  }
}

/**
 * Looks up a pending invitation by its raw token (for the acceptance page). Every failure mode
 * — malformed, unknown, expired, revoked, accepted, bootstrap link after the first server admin
 * exists — raises the same InvalidInvitationError.
 */
export async function resolvePendingInvitation(deps: InvitationDeps, token: string): Promise<Invitation> {
  const hash = deps.tokens.hash(token);
  const invitation = hash === undefined ? undefined : await deps.invitations.findByTokenHash(hash);
  if (invitation === undefined || invitationState(invitation, deps.clock.now()) !== 'PENDING') {
    throw new InvalidInvitationError();
  }
  if (invitation.invitedBy === undefined && (await deps.users.hasServerAdmin())) {
    // A CLI bootstrap link is only valid until the first server admin exists.
    throw new InvalidInvitationError();
  }
  return invitation;
}

/** Pending invitations for the server-admin overview. Never includes tokens (only hashes exist). */
export async function listPendingInvitations(deps: InvitationDeps, input: { readonly actor: User }): Promise<Invitation[]> {
  if (!isActiveServerAdmin(input.actor)) {
    throw new NotAuthorizedError();
  }
  return deps.invitations.listPending(deps.clock.now());
}

/**
 * The invitee proves possession of the emailed link and chooses a display name and password.
 * Creates the User (email verified by the link, server-admin grant from the invitation) and the
 * password credential atomically. Does not sign in: a session is only ever created by login.
 *
 * Throws DomainValidationError for an unacceptable display name or password (checked only after
 * the token is known to be valid, so invalid links never trigger password hashing) and the
 * generic InvalidInvitationError for every token problem, including losing a concurrent race.
 */
export async function acceptInvitation(
  deps: InvitationDeps,
  input: { readonly token: string; readonly displayName: string; readonly password: string },
): Promise<User> {
  const invitation = await resolvePendingInvitation(deps, input.token);
  const displayName = normalizeDisplayName(input.displayName);
  validateNewPassword(input.password, { common: deps.commonPasswords, context: passwordContextOf({ email: invitation.email, displayName }) });
  const passwordHash = await deps.passwords.hash(input.password);
  const tokenHash = deps.tokens.hash(input.token);
  const user =
    tokenHash === undefined
      ? undefined
      : await deps.invitations.accept({ tokenHash, displayName, passwordHash, acceptedAt: deps.clock.now() });
  if (user === undefined) {
    throw new InvalidInvitationError();
  }
  return user;
}
