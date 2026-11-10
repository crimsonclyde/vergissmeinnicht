import { parseRecipeContent, scaleRecipeIngredients, normalizeListItemTitle, normalizeListItemQuantity, normalizeListItemUnit, type AttachmentRecord, type RecipeTransfer, type Recipe, type RecipeContent, type User, type WorkspaceId } from '@vergissmeinnicht/domain';
import { authorizeTool, type ToolDeps } from './documents/tools.ts';
import { NotAuthorizedError } from './invitations/errors.ts';
import type { UserRepository } from './ports/user-repository.ts';

export class RecipeNotFoundError extends Error {}
export class RecipeConflictError extends Error {}
export type {RecipeTransfer} from '@vergissmeinnicht/domain';
export interface RecipeMealInput {operationId:string;recipeId:string|null;recipeRevision:number|null;content:RecipeContent|null;listId:string;listRevision:number;servings:number}
export interface RecipeRepository {
  createWithOperation(workspaceId:WorkspaceId,actor:User,operationId:string,content:RecipeContent,at:Date):Promise<{recipeId:string;duplicate:boolean}>;
  meal(workspaceId:WorkspaceId,actor:User,input:RecipeMealInput,at:Date):Promise<{recipeId:string;itemIds:string[];duplicate:boolean}>;
  list(workspaceId: WorkspaceId, actor: User, query: string, archived: boolean, offset: number, includeShared: boolean): Promise<{ recipes: Recipe[]; more: boolean }>;
  find(workspaceId: WorkspaceId, actor: User, id: string, includeShared: boolean): Promise<Recipe | undefined>;
  findAttachment(workspaceId: WorkspaceId, actor: User, recipeId: string, attachmentId: string): Promise<AttachmentRecord | undefined>;
  save(workspaceId: WorkspaceId, actor: User, id: string | undefined, revision: number, content: RecipeContent, archived: boolean, at: Date): Promise<Recipe>;
  transfer(workspaceId: WorkspaceId, actor: User, id: string, input: RecipeTransfer, at: Date, includeShared: boolean): Promise<{ itemIds: string[]; duplicate: boolean }>;
}
export interface RecipeDeps extends ToolDeps { readonly users: UserRepository; readonly recipes: RecipeRepository }
export async function authorizeRecipes(deps: RecipeDeps, actor: User, workspaceId: WorkspaceId, write = false) {
  const current = await deps.users.findById(actor.id);
  if (current?.status !== 'ACTIVE') throw new NotAuthorizedError();
  await authorizeTool(deps, current, workspaceId, 'RECIPES', write ? 'recipe.manage' : 'recipe.view');
}
export async function listRecipes(deps: RecipeDeps, actor: User, workspaceId: WorkspaceId, query: string, archived: boolean, offset: number, includeShared = false) {
  await authorizeRecipes(deps, actor, workspaceId);
  const result = await deps.recipes.list(workspaceId, actor, query, archived, offset, includeShared);
  await authorizeRecipes(deps, actor, workspaceId);
  return result;
}
export async function getRecipe(deps: RecipeDeps, actor: User, workspaceId: WorkspaceId, id: string, includeShared = false) {
  await authorizeRecipes(deps, actor, workspaceId);
  const result = await deps.recipes.find(workspaceId, actor, id, includeShared);
  await authorizeRecipes(deps, actor, workspaceId);
  if (!result) throw new RecipeNotFoundError();
  return result;
}
export async function saveRecipe(deps: RecipeDeps, actor: User, workspaceId: WorkspaceId, id: string | undefined, revision: number, content: unknown, archived: boolean, shareNew = false) {
  await authorizeRecipes(deps, actor, workspaceId, true);
  const parsed = parseRecipeContent(content);
  const next = shareNew && !id && parsed.private === undefined ? { ...parsed, private: false } : parsed;
  return deps.recipes.save(workspaceId, actor, id, revision, next, archived, deps.clock.now());
}
export async function recipeProjection(deps: RecipeDeps, actor: User, workspaceId: WorkspaceId, id: string, servings: number, includeShared = false) {
  const recipe = await getRecipe(deps, actor, workspaceId, id, includeShared);
  return { recipeRevision: recipe.revision, servings, ingredients: scaleRecipeIngredients(recipe, servings) };
}
export async function transferRecipe(deps: RecipeDeps, actor: User, workspaceId: WorkspaceId, id: string, input: RecipeTransfer, includeShared = false) {
  await authorizeRecipes(deps, actor, workspaceId);
  await authorizeTool(deps, actor, workspaceId, 'LISTS', 'list.edit');
  const items = input.items.map(item => ({ ingredient: item.ingredient, title: normalizeListItemTitle(item.title), quantity: normalizeListItemQuantity(item.quantity), unit: normalizeListItemUnit(item.unit) }));
  return deps.recipes.transfer(workspaceId, actor, id, { ...input, items }, deps.clock.now(), includeShared);
}

export async function prepareRecipeMeal(deps:RecipeDeps,actor:User,workspaceId:WorkspaceId,input:RecipeMealInput){
 await authorizeRecipes(deps,actor,workspaceId,true);await authorizeTool(deps,actor,workspaceId,'LISTS','list.edit');
 if((input.recipeId===null)!==(input.content!==null))throw new RecipeConflictError();
 return deps.recipes.meal(workspaceId,actor,{...input,content:input.content?parseRecipeContent(input.content):null},deps.clock.now());
}

export async function createRecipeWithOperation(deps:RecipeDeps,actor:User,workspaceId:WorkspaceId,operationId:string,content:unknown){
 await authorizeRecipes(deps,actor,workspaceId,true);return deps.recipes.createWithOperation(workspaceId,actor,operationId,parseRecipeContent(content),deps.clock.now());
}
