import {receiveFile} from './receive-file.ts';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm, stat, statfs, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { AttachmentError, type AttachmentStore,type AttachmentProcessor } from '@vergissmeinnicht/application';
const KEY=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function attachmentObjectPath(root:string,key:string){if(!KEY.test(key))throw new Error('Invalid object key');return join(root,key);}
let processing=false;
/** Random object keys intentionally retain independent physical files, even for identical bytes. */
export function createAttachmentStore(root:string):AttachmentStore & AttachmentProcessor {
 const path=(key:string)=>attachmentObjectPath(root,key);
 const store:AttachmentStore & AttachmentProcessor={
  async stage(source,maxBytes,suppliedKey){
   await mkdir(root,{recursive:true,mode:0o700});const key=suppliedKey??randomUUID();const temporary=path(key)+'.tmp';const {bytes,sha256}=await receiveFile(source,temporary,maxBytes,reason=>new AttachmentError(reason==='too_large'?'attachment_too_large':'attachment_format'));
   try{await rename(temporary,path(key));const dir=await open(root,'r');try{await dir.sync();}finally{await dir.close();}}catch(error){await rm(temporary,{force:true});throw error;}
   return {key,bytes,sha256,discard:()=>store.remove(key)};
  },
  async put(bytes,key){return store.stage((async function*(){yield bytes;})(),2_000_000,key);},
  async open(key){const file=path(key);await stat(file);return createReadStream(file);},
  async remove(key){await rm(path(key),{force:true});await rm(path(key)+'.tmp',{force:true});},
  async repair(key,bytes,expectedHash){if(createHash('sha256').update(bytes).digest('hex')!==expectedHash)throw new AttachmentError('attachment_format');await store.put(bytes,key);},
  async freeBytes(){await mkdir(root,{recursive:true,mode:0o700});const space=await statfs(root,{bigint:true});return Number(space.bavail*space.bsize);},
  async derive(key){
   if(processing)throw new AttachmentError('attachment_busy');processing=true;
   try{return await new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./attachment-worker.ts',import.meta.url),{workerData:{path:path(key),bytes:0},resourceLimits:{maxOldGenerationSizeMb:128}});
    let settled=false;const end=(error?:Error,result?:Awaited<ReturnType<AttachmentProcessor['derive']>>)=>{if(settled)return;settled=true;clearTimeout(timer);const finish=()=>{if(error)reject(error);else if(result)resolve(result);else reject(new AttachmentError('attachment_format'));};
    // Keep the process-wide slot until the worker has actually stopped, including native work.
    void worker.terminate().then(finish,finish);};
    const timer=setTimeout(()=>end(new AttachmentError('attachment_format')),15_000);
    worker.once('message',result=>result.error?end(new AttachmentError('attachment_format')):end(undefined,result));worker.once('error',()=>end(new AttachmentError('attachment_format')));worker.once('exit',()=>{if(!settled)end(new AttachmentError('attachment_format'));});
   });}finally{processing=false;}
  },
 };
 return store;
}
/** Only old unreferenced objects/staging are removed; snapshots take copies before this grace expires. */
export async function sweepAttachmentObjects(root:string,used:ReadonlySet<string>,before:Date){
 let entries;try{entries=await readdir(root,{withFileTypes:true});}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
 for(const entry of entries){const key=entry.name.replace(/\.tmp$/,'');if(!entry.isFile()||!KEY.test(key)||used.has(key))continue;const file=join(root,entry.name);if((await stat(file)).mtimeMs<before.getTime())await rm(file,{force:true});}
}
