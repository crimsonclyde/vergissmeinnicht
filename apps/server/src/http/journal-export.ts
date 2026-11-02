import {Readable} from 'node:stream';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {getJournalEntry,listJournal,getAttachment,authorizeJournal,TooManyUploadsError} from '@vergissmeinnicht/application';
import {markdownAttachments,UUID_V4,type WorkspaceId,type JournalEntry,type JournalContent} from '@vergissmeinnicht/domain';
import {journalArchive,journalMarkdown} from '@vergissmeinnicht/import-export';
import {z} from 'zod';
import type {AppServices} from '../composition.ts';
import {InvalidRequestError} from './errors.ts';
const running=new Set<string>();
export function registerJournalExport(app:FastifyInstance,services:AppServices,shared:boolean){
 async function handler(request:FastifyRequest,reply:import('fastify').FastifyReply){
  const params=z.object({workspaceId:z.string().regex(UUID_V4).optional(),entryId:z.string().regex(UUID_V4).optional()}).safeParse(request.params);
  const query=z.strictObject({q:z.string().max(120).default(''),archived:z.enum(['true','false']).default('false'),all:z.enum(['true','false']).default('false')}).safeParse(request.query);
  if(!params.success||!query.success)throw new InvalidRequestError();
  if(request.principal===null)throw new Error('Missing principal');const actor=request.principal.user;const workspaceId=shared?params.data.workspaceId as WorkspaceId:undefined;
  await authorizeJournal(services.journal,actor,workspaceId);
  if(running.has(actor.id))throw new TooManyUploadsError();running.add(actor.id);
  let streaming=false;
  try{
   const entries:JournalEntry[]=[];
   if(params.data.entryId)entries.push(await getJournalEntry(services.journal,actor,workspaceId,params.data.entryId));
   else for(const archived of query.data.all==='true'?[false,true]:[query.data.archived==='true'])for(let offset=0;offset<1000;offset+=30){const page=await listJournal(services.journal,actor,workspaceId,query.data.all==='true'?'':query.data.q,archived,offset);entries.push(...page.entries);if(!page.more)break;}
   const files=new Map<string,{path:string;bytes:number;name:string;sha256:string;open:()=>Promise<AsyncIterable<Uint8Array>>}>();let bytes=0;
   for(const entry of entries)if(entry.version===2)for(const ref of markdownAttachments(entry.body))if(!files.has(ref.id)){
    const access={actor,scope:workspaceId?{workspaceId}:{ownerId:actor.id},authorize:async()=>{await authorizeJournal(services.journal,actor,workspaceId);}};
    const record=await services.attachments.repository.find(access.scope,ref.id,actor);if(!record)throw new InvalidRequestError();bytes+=record.bytes;if(bytes>2_000_000_000)throw new InvalidRequestError();
    files.set(ref.id,{path:ref.url,bytes:record.bytes,name:record.name,sha256:record.sha256,open:async()=>{return (await getAttachment(services.attachments,access,ref.id,'original')).stream;}});
   }
   await authorizeJournal(services.journal,actor,workspaceId);
   const content=(entry:JournalEntry):JournalContent=>({kind:entry.kind,version:entry.version,title:entry.title,date:entry.date,body:entry.body,collection:entry.collection??'',tags:entry.tags??[],pinned:entry.pinned??false});
   if(entries.length===1&&params.data.entryId&&files.size===0)return reply.type('text/markdown; charset=utf-8').header('Content-Disposition','attachment; filename="entry.md"').send(journalMarkdown(content(entries[0] as JournalEntry)));
   const stream=Readable.from(journalArchive(entries.map(entry=>({id:entry.id,content:content(entry),archived:entry.archived})),[...files.values()],shared?'notes':'journal'));
   streaming=true;
   reply.raw.once('close',()=>{running.delete(actor.id);stream.destroy();});reply.raw.once('finish',()=>running.delete(actor.id));
   return reply.type('application/zip').header('Content-Disposition',`attachment; filename="${shared?'notes':'journal'}.zip"`).send(stream);
  }finally{if(!streaming)running.delete(actor.id);}
 }
 app.get('/export',{config:{rateLimit:{max:10,timeWindow:15*60000}}},handler);
 app.get('/:entryId/export',{config:{rateLimit:{max:10,timeWindow:15*60000}}},handler);
}
