import { ATTACHMENT_DERIVATIVE_BUDGET, normalizeOriginalFileName, type AttachmentPolicy, type AttachmentRecord, type AttachmentScope, type AttachmentUsage, type User } from '@vergissmeinnicht/domain';
export class AttachmentError extends Error { readonly code:'attachment_not_found'|'attachment_quota'|'attachment_too_large'|'attachment_format'|'attachment_busy'; constructor(code:AttachmentError['code']){super(code);this.code=code;} }
export interface AttachmentStore {
 stage(source:AsyncIterable<Uint8Array>,maxBytes:number,key?:string):Promise<{key:string;sha256:string;bytes:number;discard():Promise<void>}>;
 open(key:string):Promise<AsyncIterable<Uint8Array>>;
 remove(key:string):Promise<void>;
 put(bytes:Uint8Array,key?:string):Promise<{key:string;sha256:string;bytes:number}>;
 repair(key:string,bytes:Uint8Array,expectedHash:string):Promise<void>;
 freeBytes():Promise<number>;
}
export interface AttachmentProcessor {
 /** Local processing is an adapter concern, not a path in the service contract. */
 derive(key:string):Promise<{format:'JPEG'|'PNG';width:number;height:number;preview:Uint8Array;thumbnail:Uint8Array}>;
}
/** Optional transaction participant for a delegated upload receipt. */
export interface AttachmentUploadOperation {
 readonly id:string;
 readonly targetId:string|null;
 readonly payloadHash:string;
}
export class AttachmentUploadConflictError extends Error {}
export interface AttachmentRepository {
 policy():Promise<AttachmentPolicy>;
 usage(user:User):Promise<AttachmentUsage>;
 reserve(actor:User,scope:AttachmentScope,bytes:number):Promise<{id:string;keys:readonly string[];bytes:number}>;
 resize(actor:User,scope:AttachmentScope,reservation:string,bytes:number):Promise<void>;
 commit(actor:User,scope:AttachmentScope,reservation:string,record:Omit<AttachmentRecord,'id'|'scope'|'uploadedBy'|'at'>,operation?:AttachmentUploadOperation):Promise<AttachmentRecord>;
 release(actor:User,reservation:string):Promise<void>;
 find(scope:AttachmentScope,id:string,actor:User):Promise<AttachmentRecord|undefined>;
 list(scope:AttachmentScope,actor:User):Promise<AttachmentRecord[]>;
}
export interface AttachmentDeps {readonly repository:AttachmentRepository;readonly store:AttachmentStore;readonly processor:AttachmentProcessor}
/** Feature policy is a reviewed adapter supplied by composition, never by request data. */
export interface AttachmentAccess {authorize(write:boolean):Promise<void>;readonly scope:AttachmentScope;readonly actor:User}
export async function uploadAttachment(deps:AttachmentDeps,access:AttachmentAccess,name:string,source:AsyncIterable<Uint8Array>,operation?:AttachmentUploadOperation) {
 await access.authorize(true);
 const policy=await deps.repository.policy();const originalName=normalizeOriginalFileName(name);
 if(await deps.store.freeBytes()<policy.maxUploadBytes*2+ATTACHMENT_DERIVATIVE_BUDGET+100_000_000)throw new AttachmentError('attachment_quota');
 const reservation=await deps.repository.reserve(access.actor,access.scope,policy.maxUploadBytes);
 const keys:string[]=[];let committed=false;
 try{
  const staged=await deps.store.stage(source,Math.min(policy.maxUploadBytes,reservation.bytes),reservation.keys[0]);keys.push(staged.key);
  const result=await deps.processor.derive(staged.key);
  if(!policy.formats.includes(result.format))throw new AttachmentError('attachment_format');
  await deps.repository.resize(access.actor,access.scope,reservation.id,staged.bytes+result.preview.byteLength+result.thumbnail.byteLength);
  const preview=await deps.store.put(result.preview,reservation.keys[1]);keys.push(preview.key);
  const thumbnail=await deps.store.put(result.thumbnail,reservation.keys[2]);keys.push(thumbnail.key);
  await access.authorize(true);
  const record=await deps.repository.commit(access.actor,access.scope,reservation.id,{name:originalName,format:result.format,bytes:staged.bytes,sha256:staged.sha256,originalKey:staged.key,previewKey:preview.key,previewBytes:preview.bytes,previewHash:preview.sha256,thumbnailKey:thumbnail.key,thumbnailBytes:thumbnail.bytes,thumbnailHash:thumbnail.sha256,width:result.width,height:result.height},operation);
  committed=true;return record;
 }catch(error){if(error instanceof AttachmentError&&error.code==='attachment_too_large'&&reservation.bytes<policy.maxUploadBytes)throw new AttachmentError('attachment_quota');throw error;}finally{
  if(!committed)for(const key of keys)await deps.store.remove(key);
  await deps.repository.release(access.actor,reservation.id);
 }
}
export async function getAttachment(deps:AttachmentDeps,access:AttachmentAccess,id:string,kind:'original'|'preview'|'thumbnail') {
 await access.authorize(false);const record=await deps.repository.find(access.scope,id,access.actor);
 const result=await openAttachment(deps.store,record,kind);
 await access.authorize(false);return result;
}

/** Open an attachment already resolved through its consumer's read policy. */
export async function openAttachment(store:AttachmentStore,record:AttachmentRecord|undefined,kind:'original'|'preview'|'thumbnail') {
 if(!record)throw new AttachmentError('attachment_not_found');
 try {
  const stream=await store.open(kind==='original'?record.originalKey:kind==='preview'?record.previewKey:record.thumbnailKey);
  return {record,stream};
 }catch(error){if((error as {code?:string}).code==='ENOENT')throw new AttachmentError('attachment_not_found');throw error;}
}

/** Regenerate the stored recipe without modifying original bytes or logical ownership. */
export async function regenerateAttachment(deps:AttachmentDeps,access:AttachmentAccess,id:string){
 await access.authorize(true);const record=await deps.repository.find(access.scope,id,access.actor);if(!record)throw new AttachmentError('attachment_not_found');
 const claim=await deps.repository.reserve(access.actor,access.scope,ATTACHMENT_DERIVATIVE_BUDGET);
 try{
  const rendered=await deps.processor.derive(record.originalKey);
  await access.authorize(true);
  await deps.repository.resize(access.actor,access.scope,claim.id,rendered.preview.byteLength+rendered.thumbnail.byteLength);
  // Repair only the derivative keys, preserving the original even if metadata was corrupted.
  if(new Set([record.originalKey,record.previewKey,record.thumbnailKey]).size!==3)throw new AttachmentError('attachment_format');
  await deps.store.repair(record.previewKey,rendered.preview,record.previewHash);
  await deps.store.repair(record.thumbnailKey,rendered.thumbnail,record.thumbnailHash);
  return record;
 }finally{await deps.repository.release(access.actor,claim.id);}
}
