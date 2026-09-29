import type { Actor } from '@vergissmeinnicht/domain';

/** Settings of this server; none of them is secret. */
export interface InstanceSettings {
  /** The page footer is hidden (still in the HTML, with the `hidden` attribute). */
  readonly footerHidden: boolean;
  /** How many recently started Procedures Home shows per person (13.13); 0 hides the section. */
  readonly recentProceduresLimit: number;
}

export const RECENT_PROCEDURES_LIMIT_RANGE = Object.freeze({ min: 0, max: 20 });

export const DEFAULT_INSTANCE_SETTINGS: InstanceSettings = Object.freeze({ footerHidden: false, recentProceduresLimit: 5 });

export interface InstanceSettingsRepository {
  get(): Promise<InstanceSettings>;
  /**
   * In one IMMEDIATE transaction: re-checks that the actor is still an ACTIVE server admin, stores the
   * settings and records INSTANCE_SETTINGS_CHANGED. Returns false (nothing written) if not allowed.
   */
  save(settings: InstanceSettings, at: Date, actor: Actor & { readonly kind: 'user' }): Promise<boolean>;
}
