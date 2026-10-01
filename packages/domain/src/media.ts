import { DomainValidationError } from './errors.ts';
import { normalizeSingleLineName } from './text.ts';
import { UUID_V4 } from './user.ts';

/**
 * Instruction images (steps.md 14.3): at most one optional image per Procedure Step, processed on the
 * server into a JPEG and stored once; Steps and Run snapshots reference it by id with a caption. Sizes
 * are decimal: 1 KB = 1 000 bytes, 1 MB = 1 000 000 bytes, 1 GB = 1 000 000 000 bytes.
 */
export type StepImageId = string & { readonly __brand: 'StepImageId' };

/** A Step's (or Run Step's) image: the stored image and its descriptive caption (the accessible text). */
export interface StepImageRef {
  readonly id: StepImageId;
  readonly caption: string;
}

/** Largest accepted upload (before processing). */
export const MAX_IMAGE_UPLOAD_BYTES = 10_000_000;
/** Largest decoded image (width × height) — 48-megapixel phone photos fit. */
export const MAX_IMAGE_PIXELS = 50_000_000;
/** Longest edge of a stored image (never upscaled). */
export const MAX_IMAGE_EDGE = 1600;
/** Largest stored (processed) image. */
export const MAX_STORED_IMAGE_BYTES = 500_000;
export const MAX_IMAGE_CAPTION_LENGTH = 200;
/** Workspace image storage quotas a server admin can choose (D11a); 100 MB by default. */
export const IMAGE_QUOTA_CHOICES = [100_000_000, 250_000_000, 500_000_000, 1_000_000_000] as const;
export type ImageQuota = (typeof IMAGE_QUOTA_CHOICES)[number];
export const DEFAULT_IMAGE_QUOTA: ImageQuota = 100_000_000;

export function parseStepImageId(value: string): StepImageId {
  if (!UUID_V4.test(value)) throw new DomainValidationError('image', 'invalid_image_id', 'Image id must be a lower-case UUIDv4');
  return value as StepImageId;
}

/** Required with an image: short single-line text (1–200 code points, no control or bidi characters). */
export function normalizeImageCaption(value: string): string {
  return normalizeSingleLineName(value, { field: 'image', codePrefix: 'image_caption', label: 'Image caption', maxLength: MAX_IMAGE_CAPTION_LENGTH });
}

export function parseStepImage(input: { readonly id: string; readonly caption: string } | null | undefined): StepImageRef | null {
  if (input === null || input === undefined) return null;
  return { id: parseStepImageId(input.id), caption: normalizeImageCaption(input.caption) };
}

export function parseImageQuota(bytes: number): ImageQuota {
  if (!(IMAGE_QUOTA_CHOICES as readonly number[]).includes(bytes)) {
    throw new DomainValidationError('quota', 'invalid_image_quota', 'Choose 100 MB, 250 MB, 500 MB or 1 GB');
  }
  return bytes as ImageQuota;
}
