import {randomUUID} from 'node:crypto';
import {AttachmentError, AttachmentUploadConflictError, NotAuthorizedError, type AttachmentUploadOperation, type AttachmentRepository} from '@vergissmeinnicht/application';
import {DEFAULT_ATTACHMENT_QUOTA_BYTES, DEFAULT_ATTACHMENT_UPLOAD_BYTES, type AttachmentRecord, type AttachmentScope, type User} from '@vergissmeinnicht/domain';
import {and,eq,sql,count,type SQL} from 'drizzle-orm';
import {IMMEDIATE,type Transaction} from './actor-guard.ts';
import type {AppDatabase} from './connection.ts';
import {attachments,attachmentUploadOperations,attachmentSettings,attachmentReservations,attachmentQuotaOverrides,users} from './schema.ts';
import {storageUsageIn} from './storage-usage.ts';
import {recordSecurityEvent} from './security-events.ts';
const scopeFilter=(scope:AttachmentScope)=>'workspaceId' in scope?eq(attachments.workspaceId,scope.workspaceId):eq(attachments.ownerId,scope.ownerId);
const view=(row:typeof attachments.$inferSelect):AttachmentRecord=>({...row,scope:row.workspaceId!==null?{workspaceId:row.workspaceId}:{ownerId:row.ownerId??''}});
export const attachmentBytes=sql<number>`${attachments.bytes}+${attachments.previewBytes}+${attachments.thumbnailBytes}`;
export function globalStorageIn(tx:Pick<Transaction,'select'>):{used:number;reserved:number;limit:number|null} {
 const limit=tx.select().from(attachmentSettings).where(eq(attachmentSettings.id,1)).get()?.serverLimitBytes??null;
 const used=Number(tx.select({n:sql<number>`coalesce(sum(bytes),0)`}).from(sql`(select max(bytes) as bytes from (select sha256,bytes from document_files union all select sha256,bytes from document_file_derivatives) group by sha256 union all select max(bytes) as bytes from step_images group by sha256 union all select length(jpeg) as bytes from user_avatars union all select length(jpeg) as bytes from user_place_backgrounds union all select bytes+preview_bytes+thumbnail_bytes as bytes from attachments)`).get()?.n??0);
 const reserved=Number(tx.select({n:sql<number>`coalesce(sum(${attachmentReservations.bytes}),0)`}).from(attachmentReservations).get()?.n??0);
 return {used,reserved,limit};
}
export const globalStorageAllows=(tx:Pick<Transaction,'select'>,additional:number)=>{if(tx.select().from(attachmentSettings).where(eq(attachmentSettings.id,1)).get()?.serverLimitBytes==null)return true;const value=globalStorageIn(tx);return value.limit===null||value.used+value.reserved+additional<=value.limit;};
export interface AttachmentConsumerPolicy {
 readonly key:string;
 guard(tx:Transaction,scope:AttachmentScope,actor:User):boolean;
 visible(scope:AttachmentScope,actor:User):SQL;
 uploadTargetExists?(tx:Transaction,workspaceId:string,targetId:string):boolean;
}
export function createAttachmentRepository({db}:AppDatabase,consumer:AttachmentConsumerPolicy):AttachmentRepository & { priorUpload(actor:User,scope:AttachmentScope,operation:AttachmentUploadOperation):Promise<AttachmentRecord|undefined> } {
 const guard=consumer.guard;const scoped=(scope:AttachmentScope)=>and(eq(attachments.policyKey,consumer.key),scopeFilter(scope));
 const policy=()=>{const row=db.select().from(attachmentSettings).where(eq(attachmentSettings.id,1)).get();return {maxUploadBytes:row?.maxUploadBytes??DEFAULT_ATTACHMENT_UPLOAD_BYTES,defaultQuotaBytes:row?.defaultQuotaBytes??DEFAULT_ATTACHMENT_QUOTA_BYTES,serverLimitBytes:row?.serverLimitBytes??null,formats:row?.formats??['JPEG','PNG'] as ('JPEG'|'PNG')[]};};
 const usage=(tx:Pick<Transaction,'select'>,user:User)=>{
  const limit=tx.select().from(attachmentQuotaOverrides).where(eq(attachmentQuotaOverrides.userId,user.id)).get()?.bytes??policy().defaultQuotaBytes;
  const used=Number(tx.select({n:sql<number>`coalesce(sum(${attachmentBytes}),0)`}).from(attachments).where(eq(attachments.chargeUserId,user.id)).get()?.n??0);
  const reserved=Number(tx.select({n:sql<number>`coalesce(sum(${attachmentReservations.bytes}),0)`}).from(attachmentReservations).where(eq(attachmentReservations.userId,user.id)).get()?.n??0);
  return {used,reserved,limit,remaining:Math.max(0,limit-used-reserved)};
 };
 const visible=consumer.visible;
 function priorUpload(tx:Transaction, actor:User, scope:AttachmentScope, operation:AttachmentUploadOperation) {
  if (!consumer.uploadTargetExists || !('workspaceId' in scope) || !guard(tx,scope,actor)
    || (operation.targetId !== null && !consumer.uploadTargetExists(tx,scope.workspaceId,operation.targetId))) throw new NotAuthorizedError();
  const prior=tx.select().from(attachmentUploadOperations).where(eq(attachmentUploadOperations.id,operation.id)).get();
  if (!prior) return undefined;
  if (prior.userId!==actor.id || prior.workspaceId!==scope.workspaceId || prior.payloadHash!==operation.payloadHash || !prior.attachmentId) throw new AttachmentUploadConflictError();
  const file=tx.select().from(attachments).where(and(scoped(scope),eq(attachments.id,prior.attachmentId),eq(attachments.deleting,false))).get();
  if (!file) throw new AttachmentUploadConflictError();
  return view(file);
 }
 return {
  async priorUpload(actor:User,scope:AttachmentScope,operation:AttachmentUploadOperation) {
   return db.transaction(tx=>priorUpload(tx,actor,scope,operation));
  },
  async policy(){return policy();},async usage(user){return usage(db,user);},
  async reserve(actor,scope,bytes){return db.transaction(tx=>{
   if(!guard(tx,scope,actor))throw new NotAuthorizedError();
   if((tx.select({n:count()}).from(attachmentReservations).where(eq(attachmentReservations.userId,actor.id)).get()?.n??0)>=3 || (tx.select({n:count()}).from(attachmentReservations).get()?.n??0)>=16)throw new AttachmentError('attachment_busy');
   const global=globalStorageIn(tx);let budget=Math.min(bytes,usage(tx,actor).remaining,global.limit===null?bytes:global.limit-global.used-global.reserved);
   if('workspaceId' in scope){const value=storageUsageIn(tx,scope.workspaceId,new Date(Date.now()-86400000));budget=Math.min(budget,value.limit-value.used-workspaceReservationBytesIn(tx,scope.workspaceId));}
   if(budget<1)throw new AttachmentError('attachment_quota');
   const id=randomUUID();const keys=[randomUUID(),randomUUID(),randomUUID()];tx.insert(attachmentReservations).values({id,keys,userId:actor.id,workspaceId:'workspaceId' in scope?scope.workspaceId:null,bytes:budget,expiresAt:new Date(Date.now()+15*60000)}).run();return {id,keys,bytes:budget};
  },IMMEDIATE);},
  async resize(actor,scope,reservation,bytes){db.transaction(tx=>{
   if(!guard(tx,scope,actor))throw new NotAuthorizedError();
   const claim=tx.select().from(attachmentReservations).where(and(eq(attachmentReservations.id,reservation),eq(attachmentReservations.userId,actor.id))).get();
   if(!claim||claim.expiresAt.getTime()<Date.now()||claim.workspaceId!==('workspaceId' in scope?scope.workspaceId:null)||!Number.isSafeInteger(bytes)||bytes<1||bytes>102_000_000)throw new AttachmentError('attachment_quota');
   const own=usage(tx,actor);const global=globalStorageIn(tx);const change=bytes-claim.bytes;
   if(own.used+own.reserved+change>own.limit||(global.limit!==null&&global.used+global.reserved+change>global.limit))throw new AttachmentError('attachment_quota');
   if('workspaceId' in scope){const value=storageUsageIn(tx,scope.workspaceId,new Date(Date.now()-86400000));if(value.used+workspaceReservationBytesIn(tx,scope.workspaceId)+change>value.limit)throw new AttachmentError('attachment_quota');}
   tx.update(attachmentReservations).set({bytes}).where(eq(attachmentReservations.id,reservation)).run();
  },IMMEDIATE);},
  async commit(actor,scope,reservation,record,operation){return db.transaction(tx=>{
   if(!guard(tx,scope,actor))throw new NotAuthorizedError();
   if(operation && (!('workspaceId' in scope) || priorUpload(tx,actor,scope,operation)))throw new AttachmentUploadConflictError();
   const claim=tx.select().from(attachmentReservations).where(and(eq(attachmentReservations.id,reservation),eq(attachmentReservations.userId,actor.id))).get();
   if(claim && (claim.keys[0]!==record.originalKey||claim.keys[1]!==record.previewKey||claim.keys[2]!==record.thumbnailKey))throw new AttachmentError('attachment_quota');
   const bytes=record.bytes+record.previewBytes+record.thumbnailBytes;const current=policy();
   if(!claim||claim.expiresAt.getTime()<Date.now()||claim.workspaceId!==('workspaceId' in scope?scope.workspaceId:null)||bytes>claim.bytes||record.bytes>current.maxUploadBytes||!current.formats.includes(record.format))throw new AttachmentError('attachment_quota');
   const own=usage(tx,actor);const global=globalStorageIn(tx);
   if(own.used+own.reserved>own.limit || (global.limit!==null&&global.used+global.reserved>global.limit))throw new AttachmentError('attachment_quota');
   if('workspaceId' in scope){const value=storageUsageIn(tx,scope.workspaceId,new Date(Date.now()-86400000));const reserved=Number(tx.select({n:sql<number>`coalesce(sum(${attachmentReservations.bytes}),0)`}).from(attachmentReservations).where(eq(attachmentReservations.workspaceId,scope.workspaceId)).get()?.n??0);if(value.used+reserved>value.limit)throw new AttachmentError('attachment_quota');}
   const id=randomUUID();const row={...record,id,policyKey:consumer.key,workspaceId:'workspaceId' in scope?scope.workspaceId:null,ownerId:'ownerId' in scope?scope.ownerId:null,uploadedBy:actor.id,chargeUserId:actor.id,at:new Date()};
   tx.insert(attachments).values(row).run();
   if(operation && 'workspaceId' in scope)tx.insert(attachmentUploadOperations).values({id:operation.id,workspaceId:scope.workspaceId,userId:actor.id,payloadHash:operation.payloadHash,attachmentId:id}).run();
   tx.delete(attachmentReservations).where(eq(attachmentReservations.id,reservation)).run();
   recordSecurityEvent(tx,{type:'ATTACHMENT_CHANGED',actor:{kind:'user',userId:actor.id,displayName:actor.displayName},subjectType:'user',subjectId:actor.id,occurredAt:new Date(),metadata:{action:'upload',bytes}});
   return view({...row,deleting:false});
  },IMMEDIATE);},
  async release(actor,reservation){db.delete(attachmentReservations).where(and(eq(attachmentReservations.id,reservation),eq(attachmentReservations.userId,actor.id))).run();},
  async find(scope,id,actor){const row=db.select().from(attachments).where(and(eq(attachments.deleting,false),scoped(scope),eq(attachments.id,id),visible(scope,actor))).get();return row?view(row):undefined;},
  async list(scope,actor){return db.select().from(attachments).where(and(eq(attachments.deleting,false),scoped(scope),visible(scope,actor))).limit(200).all().map(view);},
 };
}

/** Metadata-only administration; no private names, ids, hashes or content are returned. */
export function createAttachmentAdmin({db}:AppDatabase){
 function authorize(tx:Pick<Transaction,'select'>,actor:User){const user=tx.select().from(users).where(eq(users.id,actor.id)).get();if(user?.status!=='ACTIVE'||!user.serverAdmin)throw new NotAuthorizedError();}
 return {
  async get(actor:User){authorize(db,actor);const settings=db.select().from(attachmentSettings).where(eq(attachmentSettings.id,1)).get();if(!settings)throw new Error('Missing attachment settings');const accounts=db.select({id:users.id,name:users.name}).from(users).where(sql`${users.status} != 'IMPORTED'`).all().map(user=>({id:user.id,name:user.name,override:db.select().from(attachmentQuotaOverrides).where(eq(attachmentQuotaOverrides.userId,user.id)).get()?.bytes??null,used:Number(db.select({n:sql<number>`coalesce(sum(${attachmentBytes}),0)`}).from(attachments).where(eq(attachments.chargeUserId,user.id)).get()?.n??0)})).sort((a,b)=>b.used-a.used);return {settings,accounts,global:globalStorageIn(db)};},
  async settings(actor:User,input:import('@vergissmeinnicht/domain').AttachmentPolicy){db.transaction(tx=>{authorize(tx,actor);tx.update(attachmentSettings).set({...input,formats:[...input.formats]}).where(eq(attachmentSettings.id,1)).run();recordSecurityEvent(tx,{type:'ATTACHMENT_SETTINGS_CHANGED',actor:{kind:'user',userId:actor.id,displayName:actor.displayName},subjectType:'instance',subjectId:'instance',occurredAt:new Date(),metadata:{action:'policy'}});},IMMEDIATE);},
  async override(actor:User,id:string,bytes:number|null){db.transaction(tx=>{authorize(tx,actor);if(tx.select().from(users).where(eq(users.id,id)).get()?.status!=='ACTIVE')throw new NotAuthorizedError();if(bytes===null)tx.delete(attachmentQuotaOverrides).where(eq(attachmentQuotaOverrides.userId,id)).run();else tx.insert(attachmentQuotaOverrides).values({userId:id,bytes}).onConflictDoUpdate({target:attachmentQuotaOverrides.userId,set:{bytes}}).run();recordSecurityEvent(tx,{type:'ATTACHMENT_SETTINGS_CHANGED',actor:{kind:'user',userId:actor.id,displayName:actor.displayName},subjectType:'user',subjectId:id,occurredAt:new Date(),metadata:{action:'override',bytes:bytes??-1}});},IMMEDIATE);},
 };
}

export const workspaceReservationBytesIn=(tx:Pick<Transaction,'select'>,id:string)=>Number(tx.select({n:sql<number>`coalesce(sum(${attachmentReservations.bytes}),0)`}).from(attachmentReservations).where(eq(attachmentReservations.workspaceId,id)).get()?.n??0);
