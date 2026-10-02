/** Unknown image, one of another Workspace, or a file missing from the store: all look the same. */
export class ImageNotFoundError extends Error {
  constructor() {
    super('Image not found');
    this.name = 'ImageNotFoundError';
  }
}
