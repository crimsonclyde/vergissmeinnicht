import type { Actor, User } from '@vergissmeinnicht/domain';

/** The audit identity of an authenticated User: internal id plus a display-name snapshot. */
export function userActor(user: User): Actor & { kind: 'user' } {
  return { kind: 'user', userId: user.id, displayName: user.displayName };
}
