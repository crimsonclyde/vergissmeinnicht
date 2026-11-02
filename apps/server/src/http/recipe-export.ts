import { Readable } from 'node:stream';
import { authorizeRecipes, getAttachment, getRecipe, listRecipes, TooManyUploadsError } from '@vergissmeinnicht/application';
import { markdownAttachments, parseRecipeContent, UUID_V4, type Recipe, type WorkspaceId } from '@vergissmeinnicht/domain';
import { recipeArchive, recipeMarkdown, type RecipeArchiveFile } from '@vergissmeinnicht/import-export';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../composition.ts';
import { InvalidRequestError } from './errors.ts';
const running = new Set<string>();
export function registerRecipeExport(app: FastifyInstance, services: AppServices) {
  async function handler(request: FastifyRequest, reply: FastifyReply) {
    const params = z.object({ workspaceId: z.string().regex(UUID_V4), recipeId: z.string().regex(UUID_V4).optional() }).safeParse(request.params);
    if (!params.success || !request.principal) throw new InvalidRequestError();
    const actor = request.principal.user; const workspaceId = params.data.workspaceId as WorkspaceId;
    await authorizeRecipes(services.recipes, actor, workspaceId);
    if (running.has(actor.id)) throw new TooManyUploadsError();
    running.add(actor.id); let streaming = false;
    try {
      const entries: Recipe[] = [];
      if (params.data.recipeId) entries.push(await getRecipe(services.recipes, actor, workspaceId, params.data.recipeId));
      else for (const archived of [false, true]) for (let offset = 0; offset < 1000; offset += 30) { const page = await listRecipes(services.recipes, actor, workspaceId, '', archived, offset); entries.push(...page.recipes); if (!page.more) break; }
      const files = new Map<string, RecipeArchiveFile>(); let bytes = 0;
      const access = { actor, scope: { workspaceId }, authorize: (write: boolean) => authorizeRecipes(services.recipes, actor, workspaceId, write) };
      for (const recipe of entries) for (const ref of markdownAttachments(recipe.instructions)) if (!files.has(ref.id)) {
        const file = await services.recipeAttachments.repository.find(access.scope, ref.id, actor);
        if (!file || (bytes += file.bytes) > 2_000_000_000) throw new InvalidRequestError();
        files.set(ref.id, { path: ref.url, bytes: file.bytes, name: file.name, sha256: file.sha256, open: async () => (await getAttachment(services.recipeAttachments, access, ref.id, 'original')).stream });
      }
      const content = (recipe: Recipe) => { return parseRecipeContent({version:recipe.version,title:recipe.title,servings:recipe.servings,ingredients:recipe.ingredients,instructions:recipe.instructions,tags:recipe.tags,source:recipe.source,prepMinutes:recipe.prepMinutes,cookMinutes:recipe.cookMinutes}); };
      await authorizeRecipes(services.recipes, actor, workspaceId);
      if (params.data.recipeId && entries[0] && files.size === 0) return reply.type('text/markdown; charset=utf-8').header('Content-Disposition', 'attachment; filename="recipe.md"').send(recipeMarkdown(content(entries[0])));
      const stream = Readable.from(recipeArchive(entries.map(recipe => ({ id: recipe.id, content: content(recipe), archived: recipe.archived })), [...files.values()]));
      streaming = true; reply.raw.once('close', () => { running.delete(actor.id); stream.destroy(); }); reply.raw.once('finish', () => running.delete(actor.id));
      return reply.type('application/zip').header('Content-Disposition', 'attachment; filename="recipes.zip"').send(stream);
    } finally { if (!streaming) running.delete(actor.id); }
  }
  app.get('/export', { config: { rateLimit: { max: 10, timeWindow: 15 * 60000 } } }, handler);
  app.get('/:recipeId/export', { config: { rateLimit: { max: 10, timeWindow: 15 * 60000 } } }, handler);
}
