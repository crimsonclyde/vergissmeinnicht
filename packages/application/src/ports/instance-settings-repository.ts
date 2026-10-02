import { DEFAULT_MAX_DOCUMENT_FILE_BYTES, DOCUMENT_FILE_FORMATS, type Actor, type DocumentFileFormat } from '@vergissmeinnicht/domain';

/** Settings of this server; none of them is secret. */
export interface InstanceSettings {
  /** The page footer is hidden (still in the HTML, with the `hidden` attribute). */
  readonly footerHidden: boolean;
  /** How many recently started Procedures Home shows per person (13.13); 0 hides the section. */
  readonly recentProceduresLimit: number;
  /** Largest accepted document file in bytes (16.1, H8): 1 MB to 100 MB, 50 MB by default. */
  readonly documentMaxFileBytes: number;
  /** Accepted document formats: a subset of what the server can validate, never more. */
  readonly documentFormats: readonly DocumentFileFormat[];
}

export const RECENT_PROCEDURES_LIMIT_RANGE = Object.freeze({ min: 0, max: 20 });

export const DEFAULT_INSTANCE_SETTINGS: InstanceSettings = Object.freeze({
  footerHidden: false,
  recentProceduresLimit: 5,
  documentMaxFileBytes: DEFAULT_MAX_DOCUMENT_FILE_BYTES,
  documentFormats: DOCUMENT_FILE_FORMATS,
});

export interface InstanceSettingsRepository {
  get(): Promise<InstanceSettings>;
  /**
   * In one IMMEDIATE transaction: re-checks that the actor is still an ACTIVE server admin, stores the
   * settings and records INSTANCE_SETTINGS_CHANGED. Returns false (nothing written) if not allowed.
   */
  save(settings: InstanceSettings, at: Date, actor: Actor & { readonly kind: 'user' }): Promise<boolean>;
}
