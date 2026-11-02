import {CONTROL_CHARS,type User,type WorkspaceId,type AttachmentRecord} from '@vergissmeinnicht/domain';
import {authorizeRecipes,type RecipeDeps} from './recipes.ts';
import {uploadAttachment,type AttachmentDeps} from './attachments/index.ts';
export class RecipeImageError extends Error {readonly code:'image_disabled'|'image_limit'|'image_conflict'|'image_uncertain';constructor(code:RecipeImageError['code']){super(code);this.code=code;}}
export interface RecipeImageJob {id:string;status:'STARTED'|'SUCCEEDED'|'FAILED'|'UNCERTAIN';attachmentId:string|null}
export interface RecipeImageJobs {
 claim(actor:User,workspaceId:WorkspaceId,id:string,prompt:string,model:string):Promise<{job:RecipeImageJob;created:boolean}>;
 finish(actor:User,workspaceId:WorkspaceId,id:string,status:'SUCCEEDED'|'FAILED'|'UNCERTAIN',attachmentId:string|null):Promise<void>;
}
export interface RecipeImageProvider {readonly model:string;generate(prompt:string):Promise<Uint8Array>}
export interface RecipeImageDeps {recipes:RecipeDeps;attachments:AttachmentDeps;jobs:RecipeImageJobs;provider:RecipeImageProvider|undefined}
/** The attachment upload reserves quota before it requests bytes from the paid provider. */
export async function generateRecipeImage(deps:RecipeImageDeps,actor:User,workspaceId:WorkspaceId,id:string,prompt:string):Promise<{job:RecipeImageJob;attachment:AttachmentRecord|null;duplicate:boolean}>{
 await authorizeRecipes(deps.recipes,actor,workspaceId,true);
 if(!deps.provider)throw new RecipeImageError('image_disabled');
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)||prompt.length<1||prompt.length>2000||CONTROL_CHARS.test(prompt.replace(/[\r\n\t]/g,'')))throw new RecipeImageError('image_conflict');
 const provider=deps.provider;const claimed=await deps.jobs.claim(actor,workspaceId,id,prompt,provider.model);
 if(!claimed.created){const attachment=claimed.job.attachmentId?await deps.attachments.repository.find({workspaceId},claimed.job.attachmentId,actor):null;await authorizeRecipes(deps.recipes,actor,workspaceId,true);return {job:claimed.job,attachment:attachment??null,duplicate:true};}
 let dispatched=false;let generated=false;
 try{
  const source=async function*(){await authorizeRecipes(deps.recipes,actor,workspaceId,true);dispatched=true;const bytes=await provider.generate(prompt);generated=true;yield bytes;};
  const name=`AI-generated-OpenAI-${provider.model}-${new Date().toISOString().slice(0,10)}.png`;
  const attachment=await uploadAttachment(deps.attachments,{actor,scope:{workspaceId},authorize:write=>authorizeRecipes(deps.recipes,actor,workspaceId,write)},name,source());
  await deps.jobs.finish(actor,workspaceId,id,'SUCCEEDED',attachment.id);return {job:{id,status:'SUCCEEDED',attachmentId:attachment.id},attachment,duplicate:false};
 }catch(error){await deps.jobs.finish(actor,workspaceId,id,dispatched&&!generated?'UNCERTAIN':'FAILED',null);throw error;}
}
