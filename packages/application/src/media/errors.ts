import type { ImageUsage } from '../ports/media.ts';

/** Unknown image, one of another Workspace, or a file missing from the store: all look the same. */
export class ImageNotFoundError extends Error {
  constructor() {
    super('Image not found');
    this.name = 'ImageNotFoundError';
  }
}

/** The Workspace's image storage is full (D11a); existing images stay available. */
export class ImageQuotaExceededError extends Error {
  readonly usage: ImageUsage;

  constructor(usage: ImageUsage) {
    super('The Workspace image storage is full');
    this.name = 'ImageQuotaExceededError';
    this.usage = usage;
  }
}
