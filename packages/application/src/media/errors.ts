/** The photo is still shown by a Step of a current Procedure (23.4): replace it there first. */
export class ImageInUseError extends Error {
  constructor() {
    super('Image in use');
    this.name = 'ImageInUseError';
  }
}

/** Unknown image, one of another Workspace, or a file missing from the store: all look the same. */
export class ImageNotFoundError extends Error {
  constructor() {
    super('Image not found');
    this.name = 'ImageNotFoundError';
  }
}
