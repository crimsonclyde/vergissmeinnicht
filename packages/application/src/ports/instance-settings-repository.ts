import type { Actor } from '@vergissmeinnicht/domain';

/** Settings of this server that everyone may know (the web app reads them before sign-in). */
export interface InstanceSettings {
  /** The page footer is hidden (still in the HTML, with the `hidden` attribute). */
  readonly footerHidden: boolean;
}

export const DEFAULT_INSTANCE_SETTINGS: InstanceSettings = Object.freeze({ footerHidden: false });

export interface InstanceSettingsRepository {
  get(): Promise<InstanceSettings>;
  /**
   * In one IMMEDIATE transaction: re-checks that the actor is still an ACTIVE server admin, stores the
   * settings and records INSTANCE_SETTINGS_CHANGED. Returns false (nothing written) if not allowed.
   */
  save(settings: InstanceSettings, at: Date, actor: Actor & { readonly kind: 'user' }): Promise<boolean>;
}
