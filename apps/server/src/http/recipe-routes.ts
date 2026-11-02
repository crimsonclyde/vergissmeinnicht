import {generateRecipeImage} from '@vergissmeinnicht/application';
import {registerRecipeExport} from './recipe-export.ts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authorizeRecipes, getRecipe, listRecipes, recipeProjection, saveRecipe, transferRecipe } from '@vergissmeinnicht/application';
import { UUID_V4, type WorkspaceId } from '@vergissmeinnicht/domain';
import type { AppServices } from '../composition.ts';
import { requireUser } from './session.ts';
import { InvalidRequestError } from './errors.ts';
import { registerAttachmentHttp } from './attachment-http.ts';

const uuid = z.string().regex(UUID_V4);
function parse<T>(schema: z.ZodType<T>, value: unknown): T { const result = schema.safeParse(value); if (!result.success) throw new InvalidRequestError(); return result.data; }
function context(request: FastifyRequest) {
  const { workspaceId } = parse(z.object({ workspaceId: uuid }), request.params);
  if (!request.principal) throw new Error('Missing principal');
  return { actor: request.principal.user, workspaceId: workspaceId as WorkspaceId };
}
const content = z.strictObject({ content: z.unknown(), expectedRevision: z.number().int().min(0).max(1_000_000_000), archived: z.boolean() });

export async function recipeRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  app.addHook('preHandler', requireUser(services));
  registerRecipeExport(app,services);
  await app.register(async child => {
    registerAttachmentHttp(child, services.recipeAttachments, request => {
      const { actor, workspaceId } = context(request);
      return { actor, scope: { workspaceId }, authorize: write => authorizeRecipes(services.recipes, actor, workspaceId, write) };
    });
  }, { prefix: '/attachments' });
  app.get('/image-generation/status',async request=>{const {actor,workspaceId}=context(request);await authorizeRecipes(services.recipes,actor,workspaceId);return {enabled:!!services.recipeImages.provider};});
  app.post('/image-generation',{bodyLimit:4096,config:{rateLimit:{max:10,timeWindow:60000}}},async request=>{const {actor,workspaceId}=context(request);const input=parse(z.strictObject({operationId:uuid,prompt:z.string().min(1).max(2000)}),request.body);return generateRecipeImage(services.recipeImages,actor,workspaceId,input.operationId,input.prompt).then(result=>({job:result.job,duplicate:result.duplicate,attachment:result.attachment?{id:result.attachment.id,name:result.attachment.name,format:result.attachment.format}:null}));});
  app.get('/', async request => {
    const { actor, workspaceId } = context(request);
    const query = parse(z.strictObject({ q: z.string().max(100).default(''), archived: z.enum(['true', 'false']).default('false'), offset: z.coerce.number().int().min(0).max(1000).default(0) }), request.query);
    return listRecipes(services.recipes, actor, workspaceId, query.q, query.archived === 'true', query.offset);
  });
  app.get('/:recipeId', async request => {
    const { actor, workspaceId } = context(request); const { recipeId } = parse(z.object({ recipeId: uuid }), request.params);
    return { recipe: await getRecipe(services.recipes, actor, workspaceId, recipeId) };
  });
  app.post('/', { bodyLimit: 256 * 1024 }, async (request, reply) => {
    const { actor, workspaceId } = context(request); const input = parse(content, request.body);
    return reply.code(201).send({ recipe: await saveRecipe(services.recipes, actor, workspaceId, undefined, input.expectedRevision, input.content, input.archived) });
  });
  app.post('/:recipeId', { bodyLimit: 256 * 1024 }, async request => {
    const { actor, workspaceId } = context(request); const { recipeId } = parse(z.object({ recipeId: uuid }), request.params); const input = parse(content, request.body);
    return { recipe: await saveRecipe(services.recipes, actor, workspaceId, recipeId, input.expectedRevision, input.content, input.archived) };
  });
  app.get('/:recipeId/ingredients', async request => {
    const { actor, workspaceId } = context(request); const { recipeId } = parse(z.object({ recipeId: uuid }), request.params);
    const { servings } = parse(z.strictObject({ servings: z.coerce.number().int().min(1).max(1000) }), request.query);
    return recipeProjection(services.recipes, actor, workspaceId, recipeId, servings);
  });
  app.post('/:recipeId/shopping', { bodyLimit: 64 * 1024 }, async request => {
    const { actor, workspaceId } = context(request); const { recipeId } = parse(z.object({ recipeId: uuid }), request.params);
    const input = parse(z.strictObject({ operationId: uuid, recipeRevision: z.number().int().min(1).max(1_000_000_000), listId: uuid, listRevision: z.number().int().min(1).max(1_000_000_000), servings: z.number().int().min(1).max(1000), items: z.array(z.strictObject({ ingredient: z.number().int().min(0).max(99), title: z.string().max(120), quantity: z.string().max(16).nullable(), unit: z.string().max(16).nullable() })).min(1).max(100) }), request.body);
    return transferRecipe(services.recipes, actor, workspaceId, recipeId, input);
  });
}
