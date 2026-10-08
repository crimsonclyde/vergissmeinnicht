import { canAuthenticate, parseTodayLayout, type TodayLayout, type User } from '@vergissmeinnicht/domain';
import { NotAuthorizedError } from '../invitations/errors.ts';
import type { Clock } from '../ports/clock.ts';
import type { StoredTodayLayout, TodayLayoutRepository } from '../ports/today-layout-repository.ts';

export interface TodayLayoutDeps {
  readonly todayLayouts: TodayLayoutRepository;
  readonly clock: Clock;
}

/**
 * The signed-in person's own Today layout (19.2), or `null` for the defaults. Returned as stored: a
 * layout saved by an earlier version may name cards this version no longer knows — the client merges
 * it with its card registry and ignores what it does not know. There is no way to read anyone else's.
 */
export async function getTodayLayout(deps: TodayLayoutDeps, input: { readonly user: User }): Promise<StoredTodayLayout | null> {
  if (!canAuthenticate(input.user)) throw new NotAuthorizedError();
  return (await deps.todayLayouts.find(input.user.id)) ?? null;
}

/** Saves the person's layout after strict validation; `null` resets to the defaults. */
export async function saveTodayLayout(deps: TodayLayoutDeps, input: { readonly user: User; readonly layout: unknown }): Promise<TodayLayout | null> {
  if (!canAuthenticate(input.user)) throw new NotAuthorizedError();
  if (input.layout === null) {
    await deps.todayLayouts.remove(input.user.id);
    return null;
  }
  const layout = parseTodayLayout(input.layout);
  await deps.todayLayouts.save(input.user.id, layout, layout.version, deps.clock.now());
  return layout;
}
