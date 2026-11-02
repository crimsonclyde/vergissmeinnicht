import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {UUID_V4,type AttachmentRecord} from '@vergissmeinnicht/domain';
import type {AttachmentStore,AttachmentProcessor} from '@vergissmeinnicht/application';
export type AttachmentRecoveryFacts=Omit<AttachmentRecord,'id'|'scope'|'uploadedBy'|'at'>;
/** Package originals live in the existing files/documents namespace; each logical file is copied independently. */
export async function recoverAttachmentObjects(data:ReadonlyMap<string,string>,files:ReadonlyMap<string,{path:string;size:number}>,store:AttachmentStore & AttachmentProcessor){
 const result=new Map<string,AttachmentRecoveryFacts>();const keys:string[]=[];
 async function cleanup(){for(const key of keys)await store.remove(key);}
 try{
  const path=data.get('attachments');if(!path)return {facts:result,cleanup};
  for await(const line of createInterface({input:createReadStream(path),crlfDelay:Infinity})){
   if(line.length>400000)throw new Error('Invalid attachment');const row=JSON.parse(line);
   if(typeof row.id!=='string'||!UUID_V4.test(row.id)||typeof row.sha256!=='string'||!/^[a-f0-9]{64}$/.test(row.sha256)||result.has(row.id))throw new Error('Invalid attachment');
   const source=files.get(row.sha256);if(!source||source.size>100_000_000||source.size!==row.bytes)throw new Error('Missing attachment');
   const original=await store.stage(createReadStream(source.path),source.size);keys.push(original.key);if(original.sha256!==row.sha256)throw new Error('Damaged attachment');
   const rendered=await store.derive(original.key);const preview=await store.put(rendered.preview);keys.push(preview.key);const thumbnail=await store.put(rendered.thumbnail);keys.push(thumbnail.key);
   result.set(row.id,{name:row.name,format:rendered.format,bytes:original.bytes,sha256:original.sha256,originalKey:original.key,previewKey:preview.key,previewBytes:preview.bytes,previewHash:preview.sha256,thumbnailKey:thumbnail.key,thumbnailBytes:thumbnail.bytes,thumbnailHash:thumbnail.sha256,width:rendered.width,height:rendered.height});
  }
  return {facts:result,cleanup};
 }catch(error){await cleanup();throw error;}
}
