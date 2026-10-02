import { DomainValidationError } from './errors.ts';

/**
 * Workspace storage (steps.md 16.4, H7 / P1): **one combined limit per Workspace** for everything its
 * tools store — instruction images of Procedures, originals and previews of Documents, and what is in
 * Trash. It is a **usage limit**: no disk space is reserved or set aside. The instance (server) admin
 * sets the **ceiling** of a Workspace; a Workspace admin may set a **lower limit**, never a higher
 * one. Lowering either deletes nothing: it only refuses new storage until usage is below it again.
 * Sizes are decimal (1 GB = 1 000 000 000 bytes), as everywhere.
 */
export const STORAGE_BYTES_RANGE = Object.freeze({ min: 100_000_000, max: 1_000_000_000_000 });

function parseBytes(bytes: number, field: string, code: string): number {
  if (!Number.isSafeInteger(bytes) || bytes < STORAGE_BYTES_RANGE.min || bytes > STORAGE_BYTES_RANGE.max) {
    throw new DomainValidationError(field, code, 'Choose a storage limit between 100 MB and 1000 GB');
  }
  return bytes;
}

/** The ceiling the instance admin sets for a Workspace: 100 MB to 1000 GB. */
export const parseStorageCeiling = (bytes: number): number => parseBytes(bytes, 'ceiling', 'invalid_storage_ceiling');

/** The Workspace admin's own limit: the same range, or `null` for "no lower limit" (the ceiling applies). That it stays at or below the ceiling is checked where the ceiling is known. */
export const parseStorageLimit = (bytes: number | null): number | null => (bytes === null ? null : parseBytes(bytes, 'limit', 'invalid_storage_limit'));

/** The limit in force: the Workspace's own limit when it has one — never more than the ceiling, also after the ceiling was lowered. */
export const effectiveStorageLimit = (ceiling: number, ownLimit: number | null): number => (ownLimit === null ? ceiling : Math.min(ownLimit, ceiling));

/**
 * What a Workspace stores, by tool, in bytes. Identical content is charged once per Workspace; a file
 * that is both in a live Document and in one in Trash counts as live.
 */
export interface StorageUsage {
  /** Procedures: instruction images in use (or uploaded within the last day and not used yet). */
  readonly images: number;
  /** Documents: original files that are not in Trash (uploads not yet saved as a Document included). */
  readonly originals: number;
  /** Documents: previews and thumbnails of those originals. */
  readonly previews: number;
  /** Documents in Trash: their originals and previews. Trash counts. */
  readonly trash: number;
  /** Document versions kept for Runs (16.5) whose Document no longer holds these files — changed, or deleted for good. */
  readonly retained: number;
  /** The sum of the above. */
  readonly used: number;
  /** The limit in force (`effectiveStorageLimit`). */
  readonly limit: number;
  readonly ceiling: number;
  /** The Workspace admin's own lower limit, if one is set. */
  readonly ownLimit: number | null;
}
