import { stat } from 'node:fs/promises';
import { parentPort, workerData } from 'node:worker_threads';
import { createDocumentFileProcessor } from './document-file-processor.ts';
const processor=createDocumentFileProcessor();
try {
 const info=await processor.inspect(workerData.path,(await stat(workerData.path)).size);
 if(!['JPEG','PNG'].includes(info.format))throw new Error('format');
 const preview=await processor.renderPage(workerData.path,info.format,0);
 if(!preview || preview.jpeg.byteLength>1_500_000)throw new Error('complex');
 const thumbnail=await processor.thumbnail(preview.jpeg);
 if(thumbnail.jpeg.byteLength>500_000)throw new Error('complex');
 parentPort?.postMessage({format:info.format,width:info.width,height:info.height,preview:preview.jpeg,thumbnail:thumbnail.jpeg});
} catch {parentPort?.postMessage({error:true});} finally {processor.close();}
