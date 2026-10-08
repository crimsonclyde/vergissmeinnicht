import { DomainValidationError, isActiveServerAdmin, parseDocumentFormats, parseMaxDocumentFileBytes, parseWorkspaceRestoreMaxBytes, type User } from '@vergissmeinnicht/domain';
import { NotAuthorizedError } from '../invitations/errors.ts';
import type { Clock } from '../ports/clock.ts';
import { RECENT_PROCEDURES_LIMIT_RANGE, type InstanceSettings, type InstanceSettingsRepository } from '../ports/instance-settings-repository.ts';
import { userActor } from '../user-actor.ts';

export interface InstanceSettingsDeps {
  readonly settings: InstanceSettingsRepository;
  readonly clock: Clock;
}

/** Public: presentation settings of this server (no secrets, needed before sign-in). */
export async function getInstanceSettings(deps: InstanceSettingsDeps): Promise<InstanceSettings> {
  return deps.settings.get();
}

/** All settings, for the admin page (server admins only). */
export async function getInstanceSettingsForAdmin(deps: InstanceSettingsDeps, input: { readonly actor: User }): Promise<InstanceSettings> {
  if (!isActiveServerAdmin(input.actor)) throw new NotAuthorizedError();
  return deps.settings.get();
}

/**
 * Server admins change some settings of this server; audited. The Recent limit only changes how many
 * entries Home shows — no history is touched. The document limits (16.1) apply to new uploads only:
 * files already stored stay readable when the size limit is lowered or a format is removed.
 */
export async function updateInstanceSettings(
  deps: InstanceSettingsDeps,
  input: { readonly actor: User; readonly settings: Partial<InstanceSettings> },
): Promise<InstanceSettings> {
  if (!isActiveServerAdmin(input.actor)) throw new NotAuthorizedError();
  const limit = input.settings.recentProceduresLimit;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < RECENT_PROCEDURES_LIMIT_RANGE.min || limit > RECENT_PROCEDURES_LIMIT_RANGE.max)) {
    throw new DomainValidationError('recentProceduresLimit', 'invalid_recent_limit', 'The Recent limit is 0 to 20');
  }
  const current = await deps.settings.get();
  const next = {
    ...current,
    ...input.settings,
    documentMaxFileBytes: input.settings.documentMaxFileBytes === undefined ? current.documentMaxFileBytes : parseMaxDocumentFileBytes(input.settings.documentMaxFileBytes),
    documentFormats: input.settings.documentFormats === undefined ? current.documentFormats : parseDocumentFormats(input.settings.documentFormats),
    // Applies to uploads that start after the change; one already arriving keeps the limit it started with.
    workspaceRestoreMaxBytes: input.settings.workspaceRestoreMaxBytes === undefined ? current.workspaceRestoreMaxBytes : parseWorkspaceRestoreMaxBytes(input.settings.workspaceRestoreMaxBytes),
  };
  if (!(await deps.settings.save(next, deps.clock.now(), userActor(input.actor)))) throw new NotAuthorizedError();
  return deps.settings.get();
}
