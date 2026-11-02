import {NotAuthorizedError,authorizeJournal} from '@vergissmeinnicht/application';
import {UUID_V4,type WorkspaceId} from '@vergissmeinnicht/domain';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import type {AppServices} from '../composition.ts';
import {requireUser} from './session.ts';
import {InvalidRequestError} from './errors.ts';
import {registerAttachmentHttp} from './attachment-http.ts';
function parse<T>(schema:z.ZodType<T>,value:unknown):T{const result=schema.safeParse(value);if(!result.success)throw new InvalidRequestError();return result.data;}
const principal=(request:FastifyRequest)=>{if(request.principal===null)throw new Error('Missing principal');return request.principal.user;};

export async function attachmentRoutes(app:FastifyInstance,{services,shared}:{services:AppServices;shared:boolean}){
 app.addHook('preHandler',requireUser(services));
 const access=(request:FastifyRequest)=>{
  const {workspaceId}=parse(z.object({workspaceId:z.string().regex(UUID_V4).optional()}),request.params);const actor=principal(request);const id=shared?workspaceId as WorkspaceId:undefined;
  return {actor,scope:id?{workspaceId:id}:{ownerId:actor.id},authorize:async(write:boolean)=>{await authorizeJournal(services.journal,actor,id,write);}};
 };
 registerAttachmentHttp(app,services.attachments,access);
}

export async function attachmentAdminRoutes(app:FastifyInstance,{services}:{services:AppServices}){
 app.addHook('preHandler',requireUser(services));
 app.addHook('preHandler',async request=>{if(!principal(request).serverAdmin)throw new NotAuthorizedError();});
 app.get('/',request=>services.attachmentAdmin.get(principal(request)));
 app.post('/',{bodyLimit:1024},async request=>{const input=parse(z.strictObject({maxUploadBytes:z.number().int().min(1_000_000).max(100_000_000),defaultQuotaBytes:z.number().int().min(0).max(1_000_000_000_000),serverLimitBytes:z.number().int().min(100_000_000).max(1_000_000_000_000_000).nullable(),formats:z.array(z.enum(['JPEG','PNG'])).min(1).max(2)}),request.body);await services.attachmentAdmin.settings(principal(request),input);return {saved:true};});
 app.post('/:id',{bodyLimit:256},async request=>{const {id}=parse(z.strictObject({id:z.string().regex(UUID_V4)}),request.params);const {bytes}=parse(z.strictObject({bytes:z.number().int().min(0).max(1_000_000_000_000).nullable()}),request.body);await services.attachmentAdmin.override(principal(request),id,bytes);return {saved:true};});
}
