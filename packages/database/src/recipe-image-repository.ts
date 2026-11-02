import {createHash} from 'node:crypto';
import {and,eq,gte,sql} from 'drizzle-orm';
import {RecipeImageError,NotAuthorizedError,type RecipeImageJobs} from '@vergissmeinnicht/application';
import {roleHasCapability} from '@vergissmeinnicht/permissions';
import type {AppDatabase} from './connection.ts';
import {actorAllowed,IMMEDIATE} from './actor-guard.ts';
import {recipeImageJobs} from './schema.ts';
export function createRecipeImageJobs({db}:AppDatabase,monthlyLimit:number,perUserLimit:number):RecipeImageJobs{
 return {
  async claim(actor,workspaceId,id,prompt,model){return db.transaction(tx=>{
   if(!actorAllowed(tx,workspaceId,{kind:'user',userId:actor.id,displayName:actor.displayName},{tool:'RECIPES',actorMay:role=>roleHasCapability(role,'recipe.manage')}))throw new NotAuthorizedError();
   const hash=createHash('sha256').update(JSON.stringify({prompt,model})).digest('hex');const previous=tx.select().from(recipeImageJobs).where(eq(recipeImageJobs.id,id)).get();
   if(previous){if(previous.userId!==actor.id||previous.workspaceId!==workspaceId||previous.payloadHash!==hash)throw new RecipeImageError('image_conflict');return {job:{...previous,status:previous.status==='STARTED'?'UNCERTAIN' as const:previous.status},created:false};}
   const now=new Date();const month=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1));
   const pending=tx.select({userId:recipeImageJobs.userId}).from(recipeImageJobs).where(and(eq(recipeImageJobs.status,'STARTED'),gte(recipeImageJobs.createdAt,new Date(now.getTime()-180000)))).all();if(pending.length>=2||pending.some(job=>job.userId===actor.id))throw new RecipeImageError('image_limit');
   const all=tx.select({n:sql<number>`count(*)`}).from(recipeImageJobs).where(gte(recipeImageJobs.createdAt,month)).get()?.n??0;
   const mine=tx.select({n:sql<number>`count(*)`}).from(recipeImageJobs).where(and(gte(recipeImageJobs.createdAt,month),eq(recipeImageJobs.userId,actor.id))).get()?.n??0;
   if(all>=monthlyLimit||mine>=perUserLimit)throw new RecipeImageError('image_limit');
   tx.insert(recipeImageJobs).values({id,userId:actor.id,workspaceId,payloadHash:hash,status:'STARTED',model}).run();return {job:{id,status:'STARTED' as const,attachmentId:null},created:true};
  },IMMEDIATE);},
  async finish(actor,workspaceId,id,status,attachmentId){db.update(recipeImageJobs).set({status,attachmentId,finishedAt:new Date()}).where(and(eq(recipeImageJobs.id,id),eq(recipeImageJobs.userId,actor.id),eq(recipeImageJobs.workspaceId,workspaceId),eq(recipeImageJobs.status,'STARTED'))).run();},
 };
}
