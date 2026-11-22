import {PassThrough} from 'node:stream';
import {randomUUID} from 'node:crypto';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {AskError,askTurn,askMonth,checkAskContext,NotAuthorizedError} from '@vergissmeinnicht/application';
import {UUID_V4,type WorkspaceId} from '@vergissmeinnicht/domain';
import type {AppServices} from '../composition.ts';
import {requireUser} from './session.ts';
import {InvalidRequestError} from './errors.ts';
const cancellation=(signal:AbortSignal)=>({get aborted(){return signal.aborted;},onAbort:(listener:()=>void)=>{signal.addEventListener('abort',listener,{once:true});return()=>signal.removeEventListener('abort',listener);}});
const actor=(request:FastifyRequest)=>{if(!request.principal)throw new NotAuthorizedError();return request.principal.user;};
const uuid=z.string().regex(UUID_V4);
function parse<T>(schema:z.ZodType<T>,input:unknown){const result=schema.safeParse(input);if(!result.success)throw new InvalidRequestError();return result.data;}
export async function askRoutes(app:FastifyInstance,{services}:{services:AppServices}){
 app.addHook('preHandler',requireUser(services));
 app.setErrorHandler((error,_request,reply)=>{if(error instanceof AskError)return reply.code(error.code==='ask_not_found'?404:409).send({error:error.code});throw error;});
 app.get('/status',request=>({enabled:services.ask.repo.settings(actor(request)).enabled,lookups:services.ask.repo.settings(actor(request)).lookups,hasHistory:services.ask.repo.hasHistory(actor(request))}));
 app.post('/conversations/delete-all',{bodyLimit:256},request=>{const user=actor(request);for(const row of services.ask.repo.list(user))services.ask.repo.delete(user,row.id);return {deleted:true};});
 app.get('/conversations',async request=>{
  const user=actor(request);const rows=services.ask.repo.list(user);const allowed=[];
  for(const row of rows){try{await checkAskContext(services.ask,user,row);allowed.push({id:row.id,workspaceId:row.workspaceId,updatedAt:row.updatedAt});}catch{/* inaccessible history is hidden, deletion remains available by id */}}
  return {conversations:allowed};
 });
 app.get('/conversations/:id',async request=>{const {id}=parse(z.object({id:uuid}),request.params);const row=services.ask.repo.find(actor(request),id);await checkAskContext(services.ask,actor(request),row);return row;});
 app.post('/conversations/:id/delete',{bodyLimit:256},request=>{const {id}=parse(z.object({id:uuid}),request.params);services.ask.repo.delete(actor(request),id);return {deleted:true};});
 app.get('/policy/:workspaceId',request=>{const {workspaceId}=parse(z.object({workspaceId:uuid}),request.params);return services.ask.repo.policy(actor(request),workspaceId as WorkspaceId);});
 app.post('/policy/:workspaceId',{bodyLimit:256},request=>{const {workspaceId}=parse(z.object({workspaceId:uuid}),request.params);const {enabled}=parse(z.strictObject({enabled:z.boolean()}),request.body);return services.ask.repo.policy(actor(request),workspaceId as WorkspaceId,enabled);});
 app.post('/turn',{bodyLimit:12000,config:{rateLimit:{persist:'ask-turn',max:20,timeWindow:60000,hook:'preHandler',keyGenerator:request=>request.principal?.user.id??request.ip}}},async(request,reply)=>{
  const input=parse(z.strictObject({conversationId:uuid,requestId:uuid,workspaceId:uuid.nullable(),question:z.string().trim().min(1).max(2000)}),request.body);
  const controller=new AbortController();const stream=new PassThrough();const timer=setTimeout(()=>controller.abort(),90000);let done=false;
  reply.raw.on('close',()=>{if(!done)controller.abort();});
  const send=(event:object)=>{if(!controller.signal.aborted&&stream.writableLength<65536)stream.write(JSON.stringify(event)+'\n');else controller.abort();};
  reply.header('content-type','application/x-ndjson').header('cache-control','no-store').header('x-accel-buffering','no');
  void askTurn(services.ask,actor(request),input,cancellation(controller.signal),text=>send({type:'delta',text})).then(conversation=>send({type:'done',conversation})).catch(error=>send({type:'error',code:error instanceof AskError?error.code:'ask_context_unavailable'})).finally(()=>{done=true;clearTimeout(timer);stream.end();});
  return reply.send(stream);
 });
 app.get('/admin',request=>{const user=actor(request);if(!user.serverAdmin)throw new NotAuthorizedError();return {...services.ask.repo.settings(user),configured:services.ask.provider.configured,month:askMonth(),usage:services.ask.repo.usage(user,askMonth())};});
 app.post('/admin',{bodyLimit:512},request=>{const user=actor(request);if(!user.serverAdmin)throw new NotAuthorizedError();const input=parse(z.strictObject({enabled:z.boolean(),lookups:z.boolean(),cap:z.number().int().min(0).max(1000000000),model:z.literal('gpt-5.4-mini-2026-03-17')}),request.body);return services.ask.repo.settings(user,input);});
 app.post('/admin/test',{bodyLimit:256},async request=>{const user=actor(request);if(!user.serverAdmin)throw new NotAuthorizedError();const conversation=await askTurn(services.ask,user,{conversationId:randomUUID(),workspaceId:null,question:'Reply with OK.',requestId:randomUUID()},cancellation(AbortSignal.timeout(30000)),()=>{});services.ask.repo.delete(user,conversation.id);return {tested:true};});
}
