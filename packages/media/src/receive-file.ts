import {createHash} from 'node:crypto';
import {open,rm} from 'node:fs/promises';
/** Shared upload primitive: count/hash bytes while receiving, write privately and fsync unchanged. */
export async function receiveFile(source:AsyncIterable<Uint8Array>,path:string,maxBytes:number,reject:(reason:'too_large'|'empty')=>Error):Promise<{bytes:number;sha256:string}>{
 const file=await open(path,'wx',0o600);let bytes=0;const hash=createHash('sha256');
 try{for await(const chunk of source){bytes+=chunk.byteLength;if(bytes>maxBytes)throw reject('too_large');hash.update(chunk);await file.writeFile(chunk);}if(!bytes)throw reject('empty');await file.sync();}
 catch(error){await file.close();await rm(path,{force:true});throw error;}
 await file.close();return {bytes,sha256:hash.digest('hex')};
}
