import {
  DomainValidationError,
  UUID_V4,
  knotExpiresAt,
  knotStatus,
  normalizeKnotLabel,
  type Knot,
  type KnotId,
  type KnotTarget,
  type User,
  type WorkspaceId,
} from '@vergissmeinnicht/domain';
import { roleHasCapability } from '@vergissmeinnicht/permissions';
import { NotAuthorizedError } from '../invitations/errors.ts';
import type { Clock } from '../ports/clock.ts';
import type { InvitationTokens } from '../ports/invitation-tokens.ts';
import type { KnotListEntry, KnotRepository } from '../ports/knot-repository.ts';
import type { WorkspaceRepository } from '../ports/workspace-repository.ts';
import { userActor } from '../user-actor.ts';
import { WorkspaceNotFoundError } from '../workspaces/errors.ts';
import { ToolNotEnabledError } from '../documents/errors.ts';
import { authorizeWorkspace } from '../workspaces/use-cases.ts';
import {
  KnotAlreadyRevokedError,
  KnotLimitReachedError,
  KnotNotFoundError,
  KnotRecordNotFoundError,
  KnotTargetNotFoundError,
} from './errors.ts';

export interface KnotDeps {
  readonly workspaces: WorkspaceRepository;
  readonly knots: KnotRepository;
  /** 256-bit CSPRNG tokens; only hashes are stored. */
  readonly tokens: InvitationTokens;
  readonly clock: Clock;
}

/** Resource bound: unrevoked, unexpired Knots per Workspace. */
export const MAX_ACTIVE_KNOTS_PER_WORKSPACE = 500;
export const KNOT_LIST_LIMIT = 1000;

const manage = { tool: 'PROCEDURES' as const, actorMay: (role: Parameters<typeof roleHasCapability>[0]) => roleHasCapability(role, 'knot.manage') };

/**
 * Creates a Knot link to a Procedure or Run of the Workspace (`knot.manage`: EDITOR, ADMIN).
 * Returns the token exactly once; it is not stored and cannot be shown again.
 */
export async function createKnot(
  deps: KnotDeps,
  input: {
    readonly actor: User;
    readonly workspaceId: WorkspaceId;
    readonly target: KnotTarget;
    readonly label: string;
    /** Whole days (1..365), or `null` for a Knot that does not expire. */
    readonly expiresInDays: number | null;
  },
): Promise<{ knot: Knot; token: string }> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'knot.manage');
  if (!UUID_V4.test(input.target.id)) throw new DomainValidationError('targetId', 'invalid_target_id', 'Target id must be a UUID');
  const label = normalizeKnotLabel(input.label);
  const at = deps.clock.now();
  const expiresAt = knotExpiresAt(at, input.expiresInDays);
  const { token, hash } = deps.tokens.generate();
  const result = await deps.knots.create(
    {
      workspaceId: input.workspaceId,
      target: { type: input.target.type, id: input.target.id },
      label,
      tokenHash: hash,
      at,
      expiresAt,
      maxActive: MAX_ACTIVE_KNOTS_PER_WORKSPACE,
    },
    userActor(input.actor),
    manage,
  );
  switch (result.status) {
    case 'ok':
      return { knot: result.knot, token };
    case 'forbidden':
      throw new NotAuthorizedError();
    case 'target_not_found':
      throw new KnotTargetNotFoundError();
    case 'limit_reached':
      throw new KnotLimitReachedError();
  }
}

export async function listKnots(
  deps: KnotDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId },
): Promise<KnotListEntry[]> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'knot.manage');
  return deps.knots.list(input.workspaceId, KNOT_LIST_LIMIT);
}

/** Revokes a Knot of the Workspace for good (`knot.manage`). Audited; the record stays. */
export async function revokeKnot(
  deps: KnotDeps,
  input: { readonly actor: User; readonly workspaceId: WorkspaceId; readonly knotId: KnotId },
): Promise<void> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'knot.manage');
  const result = await deps.knots.revoke(
    { workspaceId: input.workspaceId, knotId: input.knotId, at: deps.clock.now() },
    userActor(input.actor),
    manage,
  );
  switch (result) {
    case 'ok':
      return;
    case 'forbidden':
      throw new NotAuthorizedError();
    case 'knot_not_found':
      throw new KnotRecordNotFoundError();
    case 'already_revoked':
      throw new KnotAlreadyRevokedError();
  }
}

/**
 * Opens a Knot for a signed-in User. The token does not grant anything by itself: the User must be
 * an ACTIVE member allowed to view the target (`procedure.view` / `run.view`), and the Knot must be
 * unexpired, unrevoked and point at an existing target. Every failure is the same
 * KnotNotFoundError, so the token reveals nothing about Workspace or target to anyone else.
 */
export async function resolveKnot(
  deps: KnotDeps,
  input: { readonly actor: User; readonly token: string },
): Promise<{ readonly workspaceId: WorkspaceId; readonly target: KnotTarget }> {
  const hash = deps.tokens.hash(input.token);
  if (hash === undefined) throw new KnotNotFoundError();
  const knot = await deps.knots.findByTokenHash(hash);
  if (knot === undefined || knotStatus(knot, deps.clock.now()) !== 'ACTIVE') throw new KnotNotFoundError();
  try {
    await authorizeWorkspace(deps, input.actor, knot.workspaceId, knot.target.type === 'PROCEDURE' ? 'procedure.view' : 'run.view');
  } catch (caught) {
    if (caught instanceof WorkspaceNotFoundError || caught instanceof NotAuthorizedError || caught instanceof ToolNotEnabledError) throw new KnotNotFoundError();
    throw caught;
  }
  if (!(await deps.knots.targetAvailable(knot))) throw new KnotNotFoundError();
  return { workspaceId: knot.workspaceId, target: knot.target };
}
