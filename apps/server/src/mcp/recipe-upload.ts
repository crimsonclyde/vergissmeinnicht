import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { AttachmentError, AttachmentUploadConflictError, authorizeRecipes, uploadAttachment } from '@vergissmeinnicht/application';
import { DEFAULT_ATTACHMENT_UPLOAD_BYTES, normalizeOriginalFileName, type User, type WorkspaceId } from '@vergissmeinnicht/domain';
import { CHATGPT_LEGACY_FILE_ORIGIN, chatGptFileUrl, type ChatGptFileSource } from '../integrations/chatgpt-files.ts';
import type { AppServices, DelegatedAttachmentDeps } from '../composition.ts';

export const MCP_IMAGE_BYTES = DEFAULT_ATTACHMENT_UPLOAD_BYTES;
export const MCP_IMAGE_BASE64_LENGTH = Math.ceil(MCP_IMAGE_BYTES / 3) * 4;

type UploadTarget = { targetId: string | null; operationId: string };
type AuthorizeUpload = (write: boolean) => Promise<void>;
export interface ChatGptFile {
  download_url: string;
  file_id: string;
  mime_type?: string | undefined;
  file_name?: string | undefined;
}

function recipeImageResult(result: Awaited<ReturnType<typeof persistDelegatedImage>>) {
  const { attachment } = result;
  const reference = `attachments/${attachment.id}.${attachment.format === 'PNG' ? 'png' : 'jpg'}`;
  return { ...result, attachment: { ...attachment, reference }, markdown: `![Recipe photo](${reference})` };
}

export async function uploadRecipeImage(
  services: AppServices,
  actor: User,
  workspaceId: WorkspaceId,
  input: { recipeId: string | null; operationId: string; fileName: string; imageBase64: string },
) {
  const authorize = (write: boolean) => authorizeRecipes(services.recipes, actor, workspaceId, write);
  return recipeImageResult(await uploadDelegatedImage(services.recipeAttachments, actor, workspaceId, authorize,
    { ...input, targetId: input.recipeId }));
}

export async function uploadRecipeImageFile(
  services: AppServices,
  actor: User,
  workspaceId: WorkspaceId,
  input: { recipeId: string | null; operationId: string; file: ChatGptFile },
) {
  const authorize = (write: boolean) => authorizeRecipes(services.recipes, actor, workspaceId, write);
  return recipeImageResult(await uploadDelegatedImageFile(services.recipeAttachments, actor, workspaceId, authorize,
    services.chatGptFileSource, { ...input, targetId: input.recipeId }));
}

export async function uploadDelegatedImage(
  deps: DelegatedAttachmentDeps,
  actor: User,
  workspaceId: WorkspaceId,
  authorize: AuthorizeUpload,
  input: UploadTarget & { fileName: string; imageBase64: string },
) {
  await authorize(true);
  const name = normalizeOriginalFileName(pngName(input.fileName));
  const encoded = input.imageBase64;
  // Buffer's decoder alone accepts whitespace, alternate alphabets and noncanonical encodings.
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  if (encoded.length % 4 !== 0 || /[^A-Za-z0-9+/]/.test(encoded.slice(0, encoded.length - padding))) {
    throw new AttachmentError('attachment_format');
  }
  const length = encoded.length / 4 * 3 - padding;
  if (length > MCP_IMAGE_BYTES) throw new AttachmentError('attachment_too_large');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) throw new AttachmentError('attachment_format');

  const payloadHash = createHash('sha256').update(JSON.stringify([input.targetId, name])).update(bytes).digest('hex');
  return persistDelegatedImage(deps, actor, workspaceId, authorize, { ...input, name, payloadHash,
    source: (maxBytes) => {
      if (length > maxBytes) throw new AttachmentError('attachment_too_large');
      return Readable.from([bytes]);
    },
  });
}

export async function uploadDelegatedImageFile(
  deps: DelegatedAttachmentDeps,
  actor: User,
  workspaceId: WorkspaceId,
  authorize: AuthorizeUpload,
  source: ChatGptFileSource,
  input: UploadTarget & { file: ChatGptFile },
) {
  await authorize(true);
  const url = chatGptFileUrl(input.file.download_url);
  const name = normalizeOriginalFileName(pngName(input.file.file_name?.trim() || 'chatgpt-image'));
  // Keep old receipts compatible. Signed blob identity is the storage origin and path.
  const identity = url.origin === CHATGPT_LEGACY_FILE_ORIGIN
    ? url.pathname
    : [url.origin, url.pathname];
  const payloadHash = createHash('sha256')
    .update(JSON.stringify(['chatgpt-file', input.targetId, input.file.file_id, identity])).digest('hex');
  return persistDelegatedImage(deps, actor, workspaceId, authorize, { ...input, name, payloadHash,
    source: (maxBytes) => source(url, maxBytes),
  });
}

const pngName = (name: string) => name.replace(/\.webp$/i, '.png');
const isWebp = (head: Buffer) => head.length >= 12 && head.toString('latin1', 0, 4) === 'RIFF' &&
  head.toString('latin1', 8, 12) === 'WEBP';

/**
 * Attachments keep JPEG or PNG originals. A still WebP (as ChatGPT may deliver) is converted to a
 * lossless PNG within the same size limit; everything else streams through unchanged and is
 * identified by the attachment pipeline as before.
 */
async function* convertWebp(source: AsyncIterable<Uint8Array>, maxBytes: number, convert: DelegatedAttachmentDeps['convertWebp']) {
  const iterator = source[Symbol.asyncIterator]();
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < 12) {
      const next = await iterator.next();
      if (next.done) break;
      chunks.push(next.value);
      size += next.value.byteLength;
    }
    const head = Buffer.concat(chunks);
    if (!isWebp(head)) {
      if (head.byteLength) yield head;
      for (let next = await iterator.next(); !next.done; next = await iterator.next()) yield next.value;
      return;
    }
    for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
      size += next.value.byteLength;
      if (size > maxBytes) throw new AttachmentError('attachment_too_large');
      chunks.push(next.value);
    }
    let png: Uint8Array;
    try { png = await convert(Buffer.concat(chunks)); } catch { throw new AttachmentError('attachment_format'); }
    if (png.byteLength > maxBytes) throw new AttachmentError('attachment_too_large');
    yield png;
  } finally {
    await iterator.return?.();
  }
}

async function persistDelegatedImage(
  deps: DelegatedAttachmentDeps, actor: User, workspaceId: WorkspaceId, authorize: AuthorizeUpload,
  input: UploadTarget & { name: string; payloadHash: string; source: (maxBytes: number) => AsyncIterable<Uint8Array> },
) {
  const scope = { workspaceId };
  const operation = { id: input.operationId, targetId: input.targetId, payloadHash: input.payloadHash };
  const prior = () => deps.repository.priorUpload(actor, scope, operation);
  let attachment = await prior();
  let duplicate = !!attachment;
  if (!attachment) {
    const maxBytes = Math.min(MCP_IMAGE_BYTES, (await deps.repository.policy()).maxUploadBytes);
    // Keep file retrieval lazy so the common upload pipeline authorizes and reserves capacity first.
    const original = (async function* () { yield* convertWebp(input.source(maxBytes), maxBytes, deps.convertWebp); })();
    try {
      attachment = await uploadAttachment(deps, { actor, scope, authorize }, input.name, original, operation);
    } catch (error) {
      // A concurrent caller may have committed the receipt while this request was processing.
      if (!(error instanceof AttachmentUploadConflictError)) throw error;
      attachment = await prior();
      if (!attachment) throw error;
      duplicate = true;
    }
  }
  return { attachment: { id: attachment.id, name: attachment.name, format: attachment.format }, duplicate };
}
