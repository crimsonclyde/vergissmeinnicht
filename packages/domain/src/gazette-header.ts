import { DomainValidationError } from './errors.ts';
import { UUID_V4 } from './user.ts';

export const GAZETTE_HEADER_MODES = ['default', 'fixed', 'daily', 'random', 'sequential'] as const;
export const MAX_GAZETTE_HEADER_IMAGES = 12;
export interface GazetteHeaderImage { readonly id: string; readonly x: number; readonly y: number }
export interface GazetteHeaderSettings {
  readonly mode: (typeof GAZETTE_HEADER_MODES)[number];
  readonly fixed: string | null;
  readonly images: readonly GazetteHeaderImage[];
}
export const DEFAULT_GAZETTE_HEADER: GazetteHeaderSettings = { mode: 'default', fixed: null, images: [] };

export function parseGazetteHeaderSettings(value: unknown): GazetteHeaderSettings {
  const invalid = (): never => { throw new DomainValidationError('header', 'invalid_gazette', 'Invalid header settings'); };
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const { mode, fixed, images, ...extra } = value as Record<string, unknown>;
  if (Object.keys(extra).length || !GAZETTE_HEADER_MODES.includes(mode as GazetteHeaderSettings['mode']) || !Array.isArray(images) || images.length > MAX_GAZETTE_HEADER_IMAGES) return invalid();
  const ids = new Set<string>();
  const position = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 100;
  const checked = images.map((image: unknown): GazetteHeaderImage => {
    if (image === null || typeof image !== 'object' || Array.isArray(image)) return invalid();
    const { id, x, y, ...rest } = image as Record<string, unknown>;
    if (Object.keys(rest).length || typeof id !== 'string' || !UUID_V4.test(id) || ids.has(id) || !position(x) || !position(y)) return invalid();
    ids.add(id); return { id, x, y };
  });
  if (fixed !== null && (typeof fixed !== 'string' || !ids.has(fixed))) return invalid();
  if (mode === 'fixed' && fixed === null) return invalid();
  return { mode: mode as GazetteHeaderSettings['mode'], fixed, images: checked };
}
