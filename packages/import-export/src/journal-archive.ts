import {Readable} from 'node:stream';
import yazl from 'yazl';
import {remapMarkdownRecordLinks,exportSegment,type JournalContent} from '@vergissmeinnicht/domain';
export function journalMarkdown(content:JournalContent):string {
 const body=content.version===1?content.body.replace(/([\\`*_{}[\]<>()#+.!|~-])/g,'\\$1'):content.body;
 const metadata=content.date||content.collection||content.tags?.length||content.pinned?`---\ntitle: ${JSON.stringify(content.title)}\ndate: ${JSON.stringify(content.date)}\ncollection: ${JSON.stringify(content.collection??'')}\ntags: ${JSON.stringify(content.tags??[])}\npinned: ${JSON.stringify(content.pinned??false)}\n---\n\n`:'';
 return metadata+`# ${content.title.replace(/([\\`*_{}[\]<>()#+.!|~-])/g,'\\$1')}\n\n${body}`;
}
export function journalArchive(entries:readonly {id:string;content:JournalContent;archived?:boolean}[],files:readonly {path:string;bytes:number;name?:string;sha256?:string;open:()=>Promise<AsyncIterable<Uint8Array>>}[],kind:'notes'|'journal'){
 const zip=new yazl.ZipFile();
 const notePaths=new Map(entries.map(entry=>[entry.id,`${exportSegment(entry.content.title)}-${entry.id}.md`]));
 for(const entry of entries)zip.addBuffer(Buffer.from(journalMarkdown({...entry.content,body:entry.content.version===2?remapMarkdownRecordLinks(entry.content.body,target=>(target.kind==='notes'||target.kind==='journal')&&notePaths.has(target.id)?notePaths.get(target.id)??target.url:target.url):entry.content.body}),'utf8'),`${kind}/${exportSegment(entry.content.title)}-${entry.id}.md`);
 for(const file of files)zip.addReadStreamLazy(`${kind}/${file.path}`,{size:file.bytes},callback=>{file.open().then(stream=>callback(null,Readable.from(stream)),error=>callback(error,Readable.from([])));});
 zip.addBuffer(Buffer.from(JSON.stringify({format:'vergissmeinnicht.markdown',version:1,attachments:files.map(file=>({path:file.path,name:file.name,size:file.bytes,sha256:file.sha256})),entries:entries.map(entry=>({file:`${exportSegment(entry.content.title)}-${entry.id}.md`,archived:entry.archived??false,title:entry.content.title,date:entry.content.date,collection:entry.content.collection??'',tags:entry.content.tags??[],pinned:entry.content.pinned??false}))},null,2),'utf8'),`${kind}/metadata.json`);
 zip.end();return zip.outputStream;
}
