import {Readable} from 'node:stream';
import {regenerateAttachment,uploadAttachment,getAttachment,type AttachmentDeps,type AttachmentAccess} from '@vergissmeinnicht/application';
import {downloadFileName,UUID_V4} from '@vergissmeinnicht/domain';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {InvalidRequestError} from './errors.ts';
import {attachment} from './download-headers.ts';
function parse<T>(schema:z.ZodType<T>,value:unknown):T{const result=schema.safeParse(value);if(!result.success)throw new InvalidRequestError();return result.data;}
const view=(record:import('@vergissmeinnicht/domain').AttachmentRecord)=>({id:record.id,name:record.name,format:record.format,bytes:record.bytes,width:record.width,height:record.height});
/** Authentication is installed by the feature adapter; all operations re-authorize through Access. */
export function registerAttachmentHttp(app:FastifyInstance,deps:AttachmentDeps,access:(request:FastifyRequest)=>AttachmentAccess){
 app.addContentTypeParser('application/octet-stream',(_request,stream,done)=>done(null,stream));
 app.addHook('onResponse',async request=>{const body=request.raw;if(body.complete||body.destroyed)return;let discarded=0;body.on('data',(chunk:Buffer)=>{discarded+=chunk.byteLength;if(discarded>1_000_000)body.destroy();});body.resume();});
 app.get('/',async request=>{const policy=access(request);await policy.authorize(false);const files=await deps.repository.list(policy.scope,policy.actor);await policy.authorize(false);return {attachments:files.map(view)};});
 app.get('/usage',async request=>{const policy=access(request);await policy.authorize(false);return {usage:await deps.repository.usage(policy.actor),policy:await deps.repository.policy()};});
 app.post('/',{bodyLimit:100_000_000,config:{slowBody:true,rateLimit:{max:30,timeWindow:15*60_000,hook:'preHandler',keyGenerator:(request:FastifyRequest)=>`attachment:${request.principal?.user.id??request.ip}`}}},async(request,reply)=>{
  const policy=access(request);let name='';try{const raw=request.headers['x-file-name'];if(typeof raw==='string'&&raw.length<=3072)name=decodeURIComponent(raw);}catch{/* domain refuses after authorization */}
  const source=request.body instanceof Readable?request.body.iterator({destroyOnReturn:false}):Readable.from([]);
  return reply.code(201).send({attachment:view(await uploadAttachment(deps,policy,name,source))});
 });
 app.post('/:attachmentId/regenerate',{bodyLimit:256},async request=>{const policy=access(request);await policy.authorize(true);const {attachmentId}=parse(z.object({attachmentId:z.string().regex(UUID_V4)}),request.params);return {attachment:view(await regenerateAttachment(deps,policy,attachmentId))};});
 app.get('/:attachmentId/:kind',async(request,reply)=>{
  const policy=access(request);await policy.authorize(false);
  const {attachmentId,kind}=parse(z.object({attachmentId:z.string().regex(UUID_V4),kind:z.enum(['original','preview','thumbnail'])}),request.params);
  const {record,stream}=await getAttachment(deps,policy,attachmentId,kind);
  return reply.type(kind==='original'&&record.format==='PNG'?'image/png':'image/jpeg').header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff').header('Content-Security-Policy',"sandbox; default-src 'none'").header('Content-Disposition',kind==='original'?attachment(downloadFileName(record.name,record.format)):'inline').send(Readable.from(stream));
 });
}