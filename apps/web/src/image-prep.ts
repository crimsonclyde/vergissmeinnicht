/**
 * Prepares a photo in the browser before upload (14.3, T3): the browser decodes it (Safari also decodes
 * iPhone HEIC photos), applies its orientation, and a canvas re-encodes it as a JPEG of at most
 * 1600 px — so HEIC works without server support, uploads stay small on mobile data, and EXIF/GPS never
 * leave the device. This is a convenience only: the server checks and re-encodes every upload anyway.
 * When the browser cannot decode a file, the original is sent and the server explains the refusal.
 */
import { drawEdited, finishPixels, NO_EDIT, outputSize, type PhotoEdit } from './photo-edit.ts';

export const PREPARED_MAX_EDGE = 1600;
const JPEG_QUALITY = 0.9;
/** Same limit as the server's; larger originals are refused here without uploading them. */
export const MAX_UPLOAD_BYTES = 10_000_000;

/** The size to draw at: the long edge at most `maxEdge`, never enlarged. */
export function fittedSize(width: number, height: number, maxEdge = PREPARED_MAX_EDGE): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Decodes a photo with the browser (orientation applied); rejects when the browser cannot read it. */
export function decodeImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('undecodable'));
    };
    image.src = url;
  });
}

export type Prepared = { readonly kind: 'prepared'; readonly blob: Blob } | { readonly kind: 'original'; readonly blob: Blob } | { readonly kind: 'too_large' };

/**
 * Draws a decoded photo with its edits (23.3) into a JPEG of at most 1600 px; null when the browser
 * cannot encode it.
 */
export async function encodeEdited(image: HTMLImageElement, edit: PhotoEdit): Promise<Blob | null> {
  const source = { width: image.naturalWidth, height: image.naturalHeight };
  const size = outputSize(source, edit, PREPARED_MAX_EDGE);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (context === null) return null;
  // `<img>` applies the EXIF orientation (image-orientation: from-image), and so does drawing it.
  // Transparent areas become white, as on the server.
  context.imageSmoothingQuality = 'high';
  drawEdited(context, image, source, edit, size);
  // Brightness and contrast (23.7) and hidden areas (23.8) on the pixels themselves (`context.filter` is
  // missing in older Safari): the uploaded JPEG never holds what was hidden.
  finishPixels(context, edit, size);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  canvas.width = 0; // frees the pixels at once (iOS keeps canvas memory otherwise)
  return blob;
}

/** The unchanged original when the browser cannot prepare it; the server gives the exact reason. */
export function originalUpload(file: Blob): Prepared {
  return file.size > MAX_UPLOAD_BYTES ? { kind: 'too_large' } : { kind: 'original', blob: file };
}

export async function prepareImage(file: Blob): Promise<Prepared> {
  let image: HTMLImageElement;
  try {
    image = await decodeImage(file);
  } catch {
    // Not decodable here (e.g. HEIC outside Safari): the server gives the exact reason.
    return originalUpload(file);
  }
  const blob = await encodeEdited(image, NO_EDIT);
  return blob === null ? originalUpload(file) : { kind: 'prepared', blob };
}

/** Edge of the square a profile picture is prepared at (section 29); the server makes it 256 px. */
export const AVATAR_PREPARED_EDGE = 512;

/** The largest centred square of a `width`×`height` picture: where to cut it from. */
export function centreSquare(width: number, height: number): { x: number; y: number; size: number } {
  const size = Math.min(width, height);
  return { x: Math.round((width - size) / 2), y: Math.round((height - size) / 2), size };
}

/**
 * Prepares a profile picture in the browser: decoded with its orientation, cut to the centred square
 * and re-encoded as a 512 px JPEG — so EXIF/GPS never leave the device. The server re-checks and
 * re-encodes it anyway; when the browser cannot decode it, the original goes and the server explains.
 */
export async function prepareAvatar(file: Blob): Promise<Prepared> {
  let image: HTMLImageElement;
  try {
    image = await decodeImage(file);
  } catch {
    return originalUpload(file);
  }
  const square = centreSquare(image.naturalWidth, image.naturalHeight);
  const edge = Math.min(AVATAR_PREPARED_EDGE, square.size);
  const canvas = document.createElement('canvas');
  canvas.width = edge;
  canvas.height = edge;
  const context = canvas.getContext('2d');
  if (context === null || edge < 1) return originalUpload(file);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, edge, edge);
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, square.x, square.y, square.size, square.size, 0, 0, edge, edge);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  canvas.width = 0;
  return blob === null ? originalUpload(file) : { kind: 'prepared', blob };
}

/** Long edge a Places background is prepared at (section 30); the server keeps at most 2400 px too. */
export const PLACE_PREPARED_EDGE = 2400;

/**
 * Prepares a personal Places background in the browser: decoded with its orientation and re-encoded as
 * a JPEG of at most 2400 px — never cropped, so the focal point can be chosen later — so EXIF/GPS never
 * leave the device. The server re-checks and re-encodes it anyway.
 */
export async function preparePlaceBackground(file: Blob): Promise<Prepared> {
  let image: HTMLImageElement;
  try {
    image = await decodeImage(file);
  } catch {
    return originalUpload(file);
  }
  const size = fittedSize(image.naturalWidth, image.naturalHeight, PLACE_PREPARED_EDGE);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (context === null) return originalUpload(file);
  context.fillStyle = '#000000';
  context.fillRect(0, 0, size.width, size.height);
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, size.width, size.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
  canvas.width = 0;
  return blob === null ? originalUpload(file) : { kind: 'prepared', blob };
}
