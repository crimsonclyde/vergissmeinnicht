/**
 * Prepares a photo in the browser before upload (14.3, T3): the browser decodes it (Safari also decodes
 * iPhone HEIC photos), applies its orientation, and a canvas re-encodes it as a JPEG of at most
 * 1600 px — so HEIC works without server support, uploads stay small on mobile data, and EXIF/GPS never
 * leave the device. This is a convenience only: the server checks and re-encodes every upload anyway.
 * When the browser cannot decode a file, the original is sent and the server explains the refusal.
 */
export const PREPARED_MAX_EDGE = 1600;
const JPEG_QUALITY = 0.9;
/** Same limit as the server's; larger originals are refused here without uploading them. */
export const MAX_UPLOAD_BYTES = 10_000_000;

/** The size to draw at: the long edge at most `maxEdge`, never enlarged. */
export function fittedSize(width: number, height: number, maxEdge = PREPARED_MAX_EDGE): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function decode(file: Blob): Promise<HTMLImageElement> {
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

export async function prepareImage(file: Blob): Promise<Prepared> {
  let image: HTMLImageElement;
  try {
    image = await decode(file);
  } catch {
    // Not decodable here (e.g. HEIC outside Safari): the server gives the exact reason.
    return file.size > MAX_UPLOAD_BYTES ? { kind: 'too_large' } : { kind: 'original', blob: file };
  }
  // `<img>` applies the EXIF orientation (image-orientation: from-image), and so does drawing it.
  const size = fittedSize(image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (context === null) return file.size > MAX_UPLOAD_BYTES ? { kind: 'too_large' } : { kind: 'original', blob: file };
  // Transparent areas become white, as on the server.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size.width, size.height);
  context.drawImage(image, 0, 0, size.width, size.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  canvas.width = 0; // frees the pixels at once (iOS keeps canvas memory otherwise)
  if (blob === null) return file.size > MAX_UPLOAD_BYTES ? { kind: 'too_large' } : { kind: 'original', blob: file };
  return { kind: 'prepared', blob };
}
