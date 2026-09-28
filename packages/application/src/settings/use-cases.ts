import { isActiveServerAdmin, type User } from '@vergissmeinnicht/domain';
import { NotAuthorizedError } from '../invitations/errors.ts';
import type { Clock } from '../ports/clock.ts';
import type { InstanceSettings, InstanceSettingsRepository } from '../ports/instance-settings-repository.ts';
import { userActor } from '../user-actor.ts';

export interface InstanceSettingsDeps {
  readonly settings: InstanceSettingsRepository;
  readonly clock: Clock;
}

/** Public: presentation settings of this server (no secrets, needed before sign-in). */
export async function getInstanceSettings(deps: InstanceSettingsDeps): Promise<InstanceSettings> {
  return deps.settings.get();
}

/** Server admins change the settings of this server; audited. */
export async function updateInstanceSettings(
  deps: InstanceSettingsDeps,
  input: { readonly actor: User; readonly settings: InstanceSettings },
): Promise<InstanceSettings> {
  if (!isActiveServerAdmin(input.actor)) throw new NotAuthorizedError();
  if (!(await deps.settings.save(input.settings, deps.clock.now(), userActor(input.actor)))) throw new NotAuthorizedError();
  return deps.settings.get();
}
