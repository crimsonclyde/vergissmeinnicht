/** Shared schemas, views and helpers of the MCP tools (split from mcp/tools.ts, 48.3). */
import { z } from 'zod';
import { getSchedule, getJournalEntry, getProcedure, replayListChange, ListBatchError, ListNotFoundError, ListConflictError, getRecipe, NotAuthorizedError } from '@vergissmeinnicht/application';
import { gazetteWeatherPlan, GAZETTE_WATCH_CONDITIONS, DomainValidationError, MAX_LIST_BATCH_ITEMS, RECIPE_CATEGORIES, UUID_V4, recipeCategories, type GazetteWeatherSettings, type User, type WorkspaceId, type McpScope, type WorkspaceTool } from '@vergissmeinnicht/domain';
import type {AppServices} from '../../composition.ts';
export const uuid=z.string().regex(UUID_V4),workspace={workspaceId:uuid};
export const revision=z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const watchAmount=z.number().min(0).max(10_000_000).nullable().optional();
export const watchFields=z.strictObject({
 name:z.string().max(120), currency:z.string().regex(/^[A-Z]{3}$/), variant:z.string().max(120).optional(),
 condition:z.enum(GAZETTE_WATCH_CONDITIONS).optional(), market:z.string().max(8).optional(), shop:z.string().max(80).optional(),
 url:z.string().max(2048).nullable().optional(), typical:watchAmount, target:watchAmount, notes:z.string().max(1000).optional(),
 active:z.boolean().optional(), discountThreshold:z.number().min(2).max(100).nullable().optional(),
});
export const targetServings=z.number().int().min(1).max(1000).nullable().describe('Target servings. Use null when the base recipe has no serving count.');
export const ingredient=z.strictObject({
 name:z.string().max(120),
 amount:z.string().max(32).describe('A positive number, fraction, or descriptive amount in the recipe language, such as etwas, eine Prise, nach Geschmack, a bit, a pinch, to taste, un pizzico or q.b. Use an empty string when the recipe gives no amount.'),
 unit:z.string().max(16),
 note:z.string().max(240),
});
export const CATEGORY_HINT='Recipe categories from this fixed list; choose every one that fits (a Recipe may have several): starter, soup, salad, main (main course), side (side dish), dessert, baking (bread, cakes, pastry), breakfast, snack, sauce (sauces, dips, dressings), drink (non-alcoholic), cocktail (mixed or alcoholic drinks). Always set at least one for a new Recipe. On edits preserve the existing categories unless the user asks to change them. Free-form labels belong in tags.';
export const recipeContent=z.strictObject({version:z.literal(1),title:z.string().max(120),servings:z.number().int().min(1).max(1000).nullable().describe('The base recipe serving count. Use null if the source and the user give no serving count.'),ingredients:z.array(ingredient).min(1).max(100),instructions:z.string().max(50000),tags:z.array(z.string().max(40)).max(12),categories:z.array(z.enum(RECIPE_CATEGORIES)).max(RECIPE_CATEGORIES.length).optional().describe(CATEGORY_HINT),source:z.string().max(2048).describe('An HTTP or HTTPS URL or an empty string. Put cookbook titles and PDF filenames in instructions.'),prepMinutes:z.number().int().min(0).max(10080).nullable(),cookMinutes:z.number().int().min(0).max(10080).nullable(),private:z.boolean().optional().describe('New Recipes default to public in the shared VMN cookbook. Set true only when the user requests Private (home Workspace only). On edits preserve the existing choice.'),coverImage:z.string().max(52).optional()});
// ChatGPT may add descriptive fields to a file object; unknown keys are dropped, not refused.
export const chatGptFile = z.object({
 download_url: z.string().min(1).max(8192),
 file_id: z.string().min(1).max(256),
 mime_type: z.string().max(128).optional(),
 file_name: z.string().max(255).optional(),
});
export class RecipeCoverRequiredError extends Error {}
/** A tool input that is valid JSON but cannot be applied; the message is safe to return to the client. */
export interface Context {services:AppServices;actor:User;workspaceId:WorkspaceId;grantWorkspaceIds:string[]}
export interface AssistantTool {name:string;description:string;scope:McpScope;extraScopes?:McpScope[];tool:WorkspaceTool|null;extraTools?:WorkspaceTool[];write:boolean;schema:z.ZodObject;fileParams?:readonly string[];hiddenFromChatGpt?:boolean;execute:(context:Context,input:Record<string,unknown>)=>Promise<unknown>}
export function define<S extends z.ZodRawShape>(name:string,description:string,scope:McpScope,tool:WorkspaceTool|null,write:boolean,shape:S,execute:(context:Context,input:z.output<z.ZodObject<S>>)=>Promise<unknown>,extraScopes?:McpScope[],extraTools?:WorkspaceTool[]):AssistantTool{
 const schema=z.strictObject(shape);return {name,description,scope,tool,write,schema,...(extraScopes?{extraScopes}:{}),...(extraTools?{extraTools}:{}),execute:(context,input)=>execute(context,schema.parse(input))};
}
export const fileUpload = (tool: AssistantTool, fileParams: readonly string[] = ['file']): AssistantTool => ({ ...tool, fileParams });
// ChatGPT binds files natively, so it sees only the file routes. Base64 and picker tools stay for other MCP clients.
export const otherClients = (tool: AssistantTool): AssistantTool => ({ ...tool, hiddenFromChatGpt: true });
// Only allowlisted fields leave this boundary. No audit payloads, people, Documents or private Journal.
export async function replayGroceryWrite(deps:Parameters<typeof replayListChange>[0],input:Parameters<typeof replayListChange>[1]) {
 const result=await replayListChange(deps,input);
 if(result.outcome==='NOT_FOUND'||result.outcome==='LIST_DELETED')throw new NotAuthorizedError();
 if(result.outcome!=='APPLIED')throw new ListConflictError();
 // Offline replay includes a current List snapshot, which requires a separate MCP read scope.
 return {outcome:result.outcome,duplicate:result.duplicate};
}
/**
 * Grocery moves and batch removals (36.18) answer with a machine-readable code, so the assistant can
 * tell a refused permission, a stale revision, unusable items or a reused operation id apart.
 */
export class GroceryBatchToolError extends Error {
 readonly code:string;readonly hint:string;readonly itemIds:readonly string[];
 constructor(code:string,hint:string,itemIds:readonly string[]=[]){super(code);this.name='GroceryBatchToolError';this.code=code;this.hint=hint;this.itemIds=itemIds;}
}
export const batchHints:Record<string,string>={
 permission_denied:'This connection or account may not change grocery Lists in this Workspace. Nothing was changed.',
 list_not_found:'A List was not found in this Workspace (unknown, deleted, of the other kind, or in another Workspace). Grocery tools only reach grocery Lists and To-do tools only To-do Lists; moves only work within one Workspace. Nothing was changed.',
 same_list:'Source and destination are the same List. Nothing was changed.',
 kind_mismatch:'Items can only move between Lists of the same kind, and To-do tasks have no quantity or unit. Nothing was changed.',
 stale_revision:'A List changed since it was read. Read it again (get_grocery_list or get_todo_list), review the items with the user if they changed, and retry with a new operationId. Nothing was changed.',
 invalid_items:'Some item ids are not usable: not live items of the List (unknown, already deleted, or in another List), or, for a restore, not deleted items of the List. Read the List again (list_deleted_grocery_items for deleted items). Nothing was changed.',
 empty_edit:'An item edit names no field to change. Give at least one of title, quantity, unit or checked per item. Nothing was changed.',
 invalid_item_values:'A title, quantity or unit is not valid: titles must not be empty, quantities are positive numbers (up to five digits and three decimals), units are short. Nothing was changed.',
 duplicate_item_ids:'The same item id is listed more than once. Nothing was changed.',
 operation_reused:'This operationId was already used for a different request. Use a new operationId for a new request. Nothing was changed.',
 limit_reached:'The destination List would exceed its item limit. Nothing was changed.',
 invalid_operation_id:'operationId must be a lower-case UUIDv4. Nothing was changed.',
 invalid_arguments:'Check the arguments against the tool schema. Nothing was changed.',
};
export const groceryBatchError=(code:string,itemIds:readonly string[]=[])=>new GroceryBatchToolError(code,batchHints[code]??'Check the arguments against the tool schema. Nothing was changed.',itemIds);
export async function groceryBatch<T>(action:()=>Promise<T>):Promise<T>{
 try{return await action();}catch(error){
  const code=error instanceof ListBatchError?error.code:error instanceof NotAuthorizedError?'permission_denied':error instanceof ListNotFoundError?'list_not_found':error instanceof DomainValidationError?'invalid_item_values':null;
  if(code===null)throw error;
  throw groceryBatchError(code,error instanceof ListBatchError?error.itemIds:[]);
 }
}
export const batchItemIds=z.array(uuid).min(1).max(MAX_LIST_BATCH_ITEMS).refine(ids=>new Set(ids).size===ids.length,{message:'duplicate_item_ids'}).describe(`Exact item ids from get_grocery_list, 1 to ${MAX_LIST_BATCH_ITEMS}, each once.`);
export const itemEdit=z.strictObject({itemId:uuid,title:z.string().min(1).max(120).optional(),quantity:z.string().max(16).nullable().optional().describe('A positive number such as 2 or 1.5, or null to clear it. Grocery Lists only.'),unit:z.string().max(16).nullable().optional().describe('Such as l, kg or pack, or null to clear it. Grocery Lists only.'),checked:z.boolean().optional().describe('true ticks the item off as bought, false puts it back on the list.')});
export const batchItemEdits=z.array(itemEdit).min(1).max(MAX_LIST_BATCH_ITEMS).refine(edits=>new Set(edits.map(edit=>edit.itemId)).size===edits.length,{message:'duplicate_item_ids'}).refine(edits=>edits.every(edit=>Object.keys(edit).length>1),{message:'empty_edit'}).describe(`1 to ${MAX_LIST_BATCH_ITEMS} item changes, each item once, with exact item ids from get_grocery_list. Leave out a field to keep it.`);
export const batchOperationId=uuid.describe('A new UUIDv4 for this exact request. Reuse it, with the identical payload, only to retry the same request.');
export const recipeView=(recipe:Awaited<ReturnType<typeof getRecipe>>)=>({id:recipe.id,revision:recipe.revision,archived:recipe.archived,private:recipe.private,title:recipe.title,servings:recipe.servings,ingredients:recipe.ingredients,instructions:recipe.instructions,tags:recipe.tags,categories:recipeCategories(recipe),source:recipe.source,prepMinutes:recipe.prepMinutes,cookMinutes:recipe.cookMinutes,...(recipe.coverImage?{coverImage:recipe.coverImage}:{})});
export const procedureView=(detail:Awaited<ReturnType<typeof getProcedure>>)=>({id:detail.procedure.id,revision:detail.procedure.revision,title:detail.procedure.title,description:detail.procedure.description,sections:detail.sections.map(section=>({id:section.id,title:section.title,steps:section.steps.map(step=>({id:step.id,title:step.title,description:step.description,required:step.required,critical:step.critical}))}))});

/** Calendar and Notes (36.22): plain views, display names only; Notes are always the Workspace's, never the private Journal. */
export const reminderView=(schedule:Awaited<ReturnType<typeof getSchedule>>)=>({id:schedule.id,title:schedule.title,description:schedule.description,date:schedule.anchorDate,time:schedule.time,timeZone:schedule.timeZone,revision:schedule.revision});
type CalendarItem={schedule:Awaited<ReturnType<typeof getSchedule>>};
export const calendarTitle=(item:CalendarItem)=>item.schedule.title??item.schedule.procedure?.title??'Procedure';
export const noteView=(entry:Awaited<ReturnType<typeof getJournalEntry>>)=>({id:entry.id,revision:entry.revision,title:entry.title,notebook:entry.collection??'',tags:entry.tags??[],pinned:entry.pinned??false,date:entry.date,archived:entry.archived,updatedAt:entry.updatedAt.toISOString(),updatedBy:entry.updatedBy,markdown:entry.body});
export const noteContent=(input:{title:string;markdown:string;notebook:string;tags:readonly string[];pinned:boolean;date:string|null})=>({kind:'note',version:2,title:input.title,date:input.date,body:input.markdown,collection:input.notebook,tags:[...input.tags],pinned:input.pinned});
export const isoDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** The Workspace place and source plan for get_gazette_config (43.7): discoverable without fetching any forecast. Authorization ran before. */
export async function gazetteWeatherConfig(services:AppServices,workspaceId:WorkspaceId,weather:GazetteWeatherSettings|undefined){
 const automatic=weather?.automatic!==false;
 const workspace=await services.gazette.workspaces.findById(workspaceId);
 const place=workspace?.location ?? null;
 if(place===null)return {automatic,location:null,setup:'No Workspace location is set. A Workspace admin sets it in the Workspace settings (Location). Do not use any other place.'};
 const plan=gazetteWeatherPlan(place,weather);
 return {automatic,location:{name:place.name,latitude:place.latitude,longitude:place.longitude,elevation:place.elevation,timeZone:place.timeZone},region:plan.region,alertZone:plan.alertZone,sources:plan.sources.filter(source=>source.enabled).map(({id,label,family,role})=>({id,label,family,role}))};
}
export class AssistantOperationReusedError extends Error {}
