import type { SectionInput, StepImageId, User, WorkspaceId } from '@vergissmeinnicht/domain';
import { roleHasCapability } from '@vergissmeinnicht/permissions';
import { NotAuthorizedError } from '../invitations/errors.ts';
import type { ProcessedImage } from '../ports/media.ts';
import type { ProcedureDetail } from '../ports/procedure-repository.ts';
import { importProcedure, type ProcedureDeps, type ProcedureInput } from '../procedures/use-cases.ts';
import { userActor } from '../user-actor.ts';
import { authorizeWorkspace } from '../workspaces/use-cases.ts';
import { ImageQuotaExceededError } from './errors.ts';
import { IMAGE_PENDING_MS, type ImageDeps } from './use-cases.ts';

export interface ImportedImage {
  /** Section and Step index within `content`. */
  readonly section: number;
  readonly step: number;
  readonly caption: string;
  readonly bytes: Uint8Array;
}

/**
 * Imports a Procedure archive (14.3, T4) into a Workspace: needs `procedure.edit` there. Every image is
 * processed again like an upload (the archive's files are never trusted) before anything is written,
 * and charged to the target Workspace's quota; the content passes the same rules as a manual create.
 * All-or-nothing: if the quota or the content is refused, the images registered for it are released.
 */
export async function importProcedureArchive(
  deps: ProcedureDeps & ImageDeps,
  input: {
    readonly actor: User;
    readonly workspaceId: WorkspaceId;
    /** Reads the (untrusted) archive — only after the caller is known to be allowed to import. */
    readonly read: () => Promise<{ readonly content: ProcedureInput; readonly images: readonly ImportedImage[] }>;
  },
): Promise<ProcedureDetail> {
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.edit');
  const archive = await input.read();
  const processed: { readonly image: ImportedImage; readonly result: ProcessedImage }[] = [];
  for (const image of archive.images) processed.push({ image, result: await deps.processor.process(image.bytes) });

  const now = deps.clock.now();
  const pendingSince = new Date(now.getTime() - IMAGE_PENDING_MS);
  // Nothing is written when the images cannot fit (the registration below still enforces it atomically).
  const usage = await deps.images.usage(input.workspaceId, pendingSince);
  const needed = processed.reduce((sum, entry) => sum + entry.result.jpeg.byteLength, 0);
  if (usage.used + needed > usage.quota) throw new ImageQuotaExceededError(usage);

  const registered: StepImageId[] = [];
  const refs = new Map<string, { id: string; caption: string }>();
  try {
    for (const { image, result } of processed) {
      const sha256 = await deps.store.put(result.jpeg);
      const outcome = await deps.images.register(
        { workspaceId: input.workspaceId, sha256, bytes: result.jpeg.byteLength, width: result.width, height: result.height, at: now, pendingSince, replacing: null },
        userActor(input.actor),
        { actorMay: (role) => roleHasCapability(role, 'procedure.edit') },
      );
      if (outcome.status === 'forbidden') throw new NotAuthorizedError();
      if (outcome.status === 'quota_exceeded') throw new ImageQuotaExceededError(outcome.usage);
      // Only rows this import created are released on failure — not a same-content image already there.
      if (outcome.image.createdAt.getTime() === now.getTime()) registered.push(outcome.image.id);
      refs.set(`${image.section}:${image.step}`, { id: outcome.image.id, caption: image.caption });
    }
    const sections: SectionInput[] = archive.content.sections.map((section, sectionIndex) => ({
      ...section,
      steps: section.steps.map((step, stepIndex) => ({ ...step, image: refs.get(`${sectionIndex}:${stepIndex}`) ?? null })),
    }));
    return await importProcedure(deps, { actor: input.actor, workspaceId: input.workspaceId, content: { ...archive.content, sections } });
  } catch (error) {
    await deps.images.release(input.workspaceId, registered);
    throw error;
  }
}
