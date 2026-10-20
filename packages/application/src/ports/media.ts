import type { Actor, StepImageId, StorageUsage, WorkspaceId } from '@vergissmeinnicht/domain';
import type { ActorGuard } from './actor-guard.ts';

type UserActor = Actor & { readonly kind: 'user' };

/** A processed instruction image: JPEG, orientation applied, metadata removed, ≤1600 px, ≤500 KB (14.3). */
export interface ProcessedImage {
  readonly jpeg: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/** Why an upload was refused — stable codes for messages; never the file's content. */
export const IMAGE_REJECTIONS = ['too_large', 'unsupported_format', 'heic_unsupported', 'too_many_pixels', 'animated', 'unreadable', 'too_complex'] as const;
export type ImageRejection = (typeof IMAGE_REJECTIONS)[number];

export class ImageRejectedError extends Error {
  readonly code: ImageRejection;

  constructor(code: ImageRejection) {
    super('The image was refused');
    this.name = 'ImageRejectedError';
    this.code = code;
  }
}

/**
 * Validates and processes an upload on the server (content-based format check, decoded-pixel limit,
 * orientation, metadata removal, resizing, JPEG within the size limit). Throws `ImageRejectedError`.
 */
export interface ImageProcessor {
  process(input: Uint8Array): Promise<ProcessedImage>;
  /**
   * A small JPEG (long edge at most `maxEdge`, never enlarged, no metadata) of an image already stored
   * — the gallery's thumbnails (23.1). Optional: without it the stored image is served.
   */
  thumbnail?(stored: Uint8Array, maxEdge: number): Promise<Uint8Array>;
}

/**
 * Immutable, content-addressed image files (SHA-256 names; no user-supplied names or paths). Writes are
 * atomic (temporary file, fsync, rename). A file is only ever removed by housekeeping.
 */
export interface MediaStore {
  /** Stores the bytes (if not present yet) and returns their SHA-256 (lower-case hex). */
  put(bytes: Uint8Array): Promise<string>;
  /** The file's bytes, or undefined when missing. */
  read(sha256: string): Promise<Uint8Array | undefined>;
  remove(sha256: string): Promise<void>;
  /** Every stored file with its modification time (for housekeeping). */
  list(): Promise<{ readonly sha256: string; readonly modifiedAt: Date }[]>;
}

export interface StepImageRecord {
  readonly id: StepImageId;
  readonly workspaceId: WorkspaceId;
  readonly sha256: string;
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
  readonly createdAt: Date;
}

/** The combined storage of the Workspace and its limit (16.4): instruction images share it with Documents. */
export type ImageUsage = StorageUsage;

/** One photo of the Workspace gallery (23.1): what an author needs to pick it, nothing about who uploaded it. */
export interface GalleryImage {
  readonly id: StepImageId;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly createdAt: Date;
  /** Steps of current (not deleted) Procedures that show it, and how many Procedures that is. */
  readonly steps: number;
  readonly procedures: number;
  /** The caption last used with it (current Steps first, else a Run's), to prefill a new one. */
  readonly caption: string | null;
}

export interface GalleryCursor {
  readonly createdAt: Date;
  readonly id: StepImageId;
}

/** A current Procedure Step that shows an image (where a gallery photo is used). */
export interface ImageUse {
  readonly procedureId: string;
  readonly procedureTitle: string;
  readonly stepId: string;
  readonly stepTitle: string;
}

export type ReplaceImageResult =
  | { readonly status: 'ok'; readonly procedures: number; readonly steps: number }
  | { readonly status: 'forbidden' | 'not_found' | 'invalid_reference' };

/** `kept`: a Run snapshot or a deleted Procedure still shows the photo, so it only left the gallery. */
export type RemoveImageResult =
  | { readonly status: 'ok'; readonly kept: boolean }
  | { readonly status: 'forbidden' | 'not_found' | 'in_use' };

export type RegisterImageResult =
  | { readonly status: 'ok'; readonly image: StepImageRecord; readonly usage: ImageUsage }
  | { readonly status: 'forbidden' }
  | { readonly status: 'quota_exceeded'; readonly usage: ImageUsage };

/**
 * Image metadata per Workspace. Images are charged to the Workspace's combined storage (16.4): the
 * distinct images referenced by a Step (also of restorable deleted Procedures) or a Run snapshot, plus
 * images uploaded since `pendingSince` that are not referenced yet (so uploads cannot bypass the limit
 * before a Procedure is saved).
 */
export interface ImageRepository {
  /**
   * In one IMMEDIATE transaction: re-checks the guard, reuses the Workspace's row for identical content
   * (charged once), otherwise checks the combined usage + bytes against the storage limit and inserts. `replacing`: an image
   * the upload replaces — not counted when only this Procedure's Steps reference it.
   */
  register(
    input: {
      readonly workspaceId: WorkspaceId;
      readonly sha256: string;
      readonly bytes: number;
      readonly width: number;
      readonly height: number;
      readonly at: Date;
      readonly pendingSince: Date;
      readonly replacing: StepImageId | null;
    },
    actor: UserActor,
    guard: ActorGuard,
  ): Promise<RegisterImageResult>;
  find(workspaceId: WorkspaceId, imageId: StepImageId): Promise<StepImageRecord | undefined>;
  /**
   * The gallery (23.1): the Workspace's photos a Step may use — referenced by a Step or a Run snapshot,
   * or uploaded since `pendingSince`, and not deleted from the gallery unless a current Step uses it again (23.4) — newest first, `limit` per page after `after`. `search` matches
   * captions and current Step titles (plain text, no wildcards). Nothing when Procedures is switched off.
   */
  gallery(
    workspaceId: WorkspaceId,
    input: { readonly pendingSince: Date; readonly search: string | null; readonly after: GalleryCursor | null; readonly limit: number },
  ): Promise<{ readonly images: readonly GalleryImage[]; readonly next: GalleryCursor | null }>;
  /**
   * Replace everywhere (23.2): in one IMMEDIATE transaction, every Step of a current (not deleted)
   * Procedure of the Workspace showing `from` shows `to` instead (captions kept); each changed Procedure
   * gets a new revision and one audit event. Runs and deleted Procedures are not touched. `to` must be a
   * photo a Step may use (in use, or uploaded since `pendingSince`); `from` any photo of the Workspace.
   */
  replaceEverywhere(
    input: { readonly workspaceId: WorkspaceId; readonly from: StepImageId; readonly to: StepImageId; readonly at: Date; readonly pendingSince: Date },
    actor: UserActor,
    guard: ActorGuard,
  ): Promise<ReplaceImageResult>;
  /**
   * Delete from the gallery (23.4), in one IMMEDIATE transaction: refused (`in_use`) while a Step of a
   * current Procedure shows the photo. A photo nothing references is deleted (its file goes with
   * housekeeping); one a Run snapshot or a deleted Procedure still shows is only marked, so history keeps
   * it and the gallery leaves it out. One audit event either way.
   */
  remove(input: { readonly workspaceId: WorkspaceId; readonly imageId: StepImageId; readonly at: Date }, actor: UserActor, guard: ActorGuard): Promise<RemoveImageResult>;
  /** Current (not deleted) Procedure Steps of the Workspace showing this image, by Procedure title. */
  uses(workspaceId: WorkspaceId, imageId: StepImageId): Promise<readonly ImageUse[]>;
  usage(workspaceId: WorkspaceId, pendingSince: Date): Promise<ImageUsage>;
  /**
   * Housekeeping: deletes image rows referenced by nothing and created before `before`; returns the
   * SHA-256 of files that no row uses any more (to be removed from the media store).
   */
  purgeUnreferenced(before: Date): Promise<string[]>;
  /** Deletes these images of the Workspace if nothing references them (an import that failed half-way). */
  release(workspaceId: WorkspaceId, imageIds: readonly StepImageId[]): Promise<void>;
  /** Every SHA-256 used by a row (files not in this set and older than the grace period are orphans). */
  usedHashes(): Promise<Set<string>>;
}
