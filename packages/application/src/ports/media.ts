import type { Actor, ImageQuota, StepImageId, WorkspaceId } from '@vergissmeinnicht/domain';
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

/** Storage used by a Workspace's images and its quota, in bytes. */
export interface ImageUsage {
  readonly used: number;
  readonly quota: ImageQuota;
}

export type RegisterImageResult =
  | { readonly status: 'ok'; readonly image: StepImageRecord; readonly usage: ImageUsage }
  | { readonly status: 'forbidden' }
  | { readonly status: 'quota_exceeded'; readonly usage: ImageUsage };

/**
 * Image metadata per Workspace. Usage = the distinct images of the Workspace referenced by a Step
 * (also of restorable deleted Procedures) or a Run snapshot, plus images uploaded since `pendingSince`
 * that are not referenced yet (so uploads cannot bypass the quota before a Procedure is saved).
 */
export interface ImageRepository {
  /**
   * In one IMMEDIATE transaction: re-checks the guard, reuses the Workspace's row for identical content
   * (charged once), otherwise checks usage + bytes against the quota and inserts. `replacing`: an image
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
  usage(workspaceId: WorkspaceId, pendingSince: Date): Promise<ImageUsage>;
  /** Every Workspace with its usage and quota (server admin view). */
  listStorage(pendingSince: Date): Promise<{ readonly workspaceId: WorkspaceId; readonly name: string; readonly usage: ImageUsage }[]>;
  /** Sets the quota (never deletes anything) and records a security event; false when the Workspace is unknown. */
  setQuota(input: { readonly workspaceId: WorkspaceId; readonly quota: ImageQuota; readonly at: Date }, actor: UserActor): Promise<boolean>;
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
