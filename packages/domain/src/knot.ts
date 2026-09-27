import { DomainValidationError } from './errors.ts';
import { normalizeSingleLineName } from './text.ts';
import { UUID_V4, type UserId } from './user.ts';
import type { WorkspaceId } from './workspace.ts';

/**
 * A Knot is a shareable entry link (`/knot/{token}`) to one Procedure or Run of a Workspace.
 * The token is only a pointer: opening it still requires a signed-in User who may view the
 * target. Knots can expire and be revoked; only the token's hash is stored.
 */
export type KnotId = string & { readonly __brand: 'KnotId' };

export const KNOT_TARGET_TYPES = ['PROCEDURE', 'RUN'] as const;
export type KnotTargetType = (typeof KNOT_TARGET_TYPES)[number];

export const MAX_KNOT_LABEL_LENGTH = 80;
/** Longest allowed lifetime; Knots may also never expire. */
export const MAX_KNOT_EXPIRY_DAYS = 365;

export interface KnotTarget {
  readonly type: KnotTargetType;
  /** Procedure id or Run id, depending on `type`. */
  readonly id: string;
}

export interface Knot {
  readonly id: KnotId;
  readonly workspaceId: WorkspaceId;
  readonly label: string;
  readonly target: KnotTarget;
  readonly createdAt: Date;
  readonly createdBy: { readonly userId: UserId; readonly displayName: string };
  /** `null` = does not expire. */
  readonly expiresAt: Date | null;
  readonly revoked: { readonly at: Date; readonly by: { readonly userId: UserId; readonly displayName: string } } | null;
}

export type KnotStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

export function knotStatus(knot: Pick<Knot, 'expiresAt' | 'revoked'>, now: Date): KnotStatus {
  if (knot.revoked !== null) return 'REVOKED';
  if (knot.expiresAt !== null && knot.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  return 'ACTIVE';
}

export function normalizeKnotLabel(input: string): string {
  return normalizeSingleLineName(input, {
    field: 'label',
    codePrefix: 'knot_label',
    label: 'Knot label',
    maxLength: MAX_KNOT_LABEL_LENGTH,
  });
}

/** Expiry for a lifetime in whole days (1..365), or `null` for a Knot that does not expire. */
export function knotExpiresAt(createdAt: Date, days: number | null): Date | null {
  if (days === null) return null;
  if (!Number.isInteger(days) || days < 1 || days > MAX_KNOT_EXPIRY_DAYS) {
    throw new DomainValidationError('expiresInDays', 'invalid_knot_expiry', 'Knot lifetime must be 1 to 365 days');
  }
  return new Date(createdAt.getTime() + days * 86_400_000);
}

export function parseKnotId(value: string): KnotId {
  if (!UUID_V4.test(value)) {
    throw new DomainValidationError('knotId', 'invalid_knot_id', 'Knot id must be a lower-case UUIDv4');
  }
  return value as KnotId;
}
