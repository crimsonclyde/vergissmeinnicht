import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { AttachmentError, AttachmentUploadConflictError, authorizeRecipes, uploadAttachment } from '@vergissmeinnicht/application';
import { DEFAULT_ATTACHMENT_UPLOAD_BYTES, normalizeOriginalFileName, type User, type WorkspaceId } from '@vergissmeinnicht/domain';
import type { AppServices } from '../composition.ts';

export const MCP_IMAGE_BYTES = DEFAULT_ATTACHMENT_UPLOAD_BYTES;
export const MCP_IMAGE_BASE64_LENGTH = Math.ceil(MCP_IMAGE_BYTES / 3) * 4;

export async function uploadRecipeImage(
  services: AppServices,
  actor: User,
  workspaceId: WorkspaceId,
  input: { recipeId: string | null; operationId: string; fileName: string; imageBase64: string },
) {
  const authorize = (write: boolean) => authorizeRecipes(services.recipes, actor, workspaceId, write);
  const result = await uploadDelegatedImage(services.recipeAttachments, actor, workspaceId, authorize,
    { ...input, targetId: input.recipeId });
  const { attachment } = result;
  const reference = `attachments/${attachment.id}.${attachment.format === 'PNG' ? 'png' : 'jpg'}`;
  return { ...result, attachment: { ...attachment, reference }, markdown: `![Recipe photo](${reference})` };
}

export async function uploadDelegatedImage(
  deps: AppServices['recipeAttachments'],
  actor: User,
  workspaceId: WorkspaceId,
  authorize: (write: boolean) => Promise<void>,
  input: { targetId: string | null; operationId: string; fileName: string; imageBase64: string },
) {
  await authorize(true);
  const name = normalizeOriginalFileName(input.fileName);
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

  const scope = { workspaceId };
  const payloadHash = createHash('sha256').update(JSON.stringify([input.targetId, name])).update(bytes).digest('hex');
  const operation = { id: input.operationId, targetId: input.targetId, payloadHash };
  const prior = () => deps.repository.priorUpload(actor, scope, operation);
  let attachment = await prior();
  let duplicate = !!attachment;
  if (!attachment) {
    if (length > (await deps.repository.policy()).maxUploadBytes) throw new AttachmentError('attachment_too_large');
    try {
      attachment = await uploadAttachment(deps, { actor, scope, authorize }, name, Readable.from([bytes]), operation);
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
