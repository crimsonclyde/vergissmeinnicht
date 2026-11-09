import {fromMarkdown} from 'mdast-util-from-markdown';
import {gfmFromMarkdown} from 'mdast-util-gfm';
import {gfm} from 'micromark-extension-gfm';
const DEST=/^attachments\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(jpg|png)$/;
export function markdownAttachments(source:string, imagesOnly=false):{id:string;url:string;start:number;end:number}[]{
 const tree=fromMarkdown(source,{extensions:[gfm()],mdastExtensions:[gfmFromMarkdown()]});const result:{id:string;url:string;start:number;end:number}[]=[];
 const imageDefinitions=new Set<string>();
 if(imagesOnly){
  function collect(node:unknown){const value=node as {type:string;identifier?:string;children?:unknown[]};if(value.type==='imageReference'&&value.identifier)imageDefinitions.add(value.identifier);for(const child of value.children??[])collect(child);}
  collect(tree);
 }
 function visit(node:{type:string;identifier?:string|undefined;url?:string|undefined;position?:{start:{offset?:number|undefined};end:{offset?:number|undefined}}|undefined;children?:unknown[]|undefined}){
  if((node.type==='image'||(node.type==='link'&&!imagesOnly)||(node.type==='definition'&&(!imagesOnly||imageDefinitions.has(node.identifier??''))))&&node.url){const match=DEST.exec(node.url);if(match){const start=node.position?.start.offset??0;const end=node.position?.end.offset??start;const raw=source.slice(start,end);const offset=destinationOffset(raw,node.type,node.url);if(offset>=0)result.push({id:match[1]??'',url:node.url,start:start+offset,end:start+offset+node.url.length});}}
  for(const child of node.children??[])visit(child as Parameters<typeof visit>[0]);
 }visit(tree);return result;
}
/** Rewrite parsed link destinations only, retaining all other source bytes including code blocks. */
export function remapMarkdownAttachments(source:string,remap:(id:string)=>string):string{
 for(const item of markdownAttachments(source).sort((a,b)=>b.start-a.start))source=source.slice(0,item.start)+item.url.replace(item.id,remap(item.id))+source.slice(item.end);return source;
}

export function markdownOutline(source:string):{text:string;anchor:string;depth:number}[]{
 const tree=fromMarkdown(source,{extensions:[gfm()],mdastExtensions:[gfmFromMarkdown()]});const result:{text:string;anchor:string;depth:number}[]=[];const used=new Map<string,number>();
 function text(node:unknown):string{const n=node as {value?:string;children?:unknown[]};return n.value??n.children?.map(text).join('')??'';}
 function visit(node:unknown){const n=node as {type:string;depth?:number;children?:unknown[]};if(n.type==='heading'){const label=text(node);const base=label.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}\s-]/gu,'').trim().replace(/\s+/g,'-')||'heading';const duplicate=used.get(base)??0;used.set(base,duplicate+1);result.push({text:label,anchor:base+(duplicate?'-'+duplicate:''),depth:n.depth??1});}for(const child of n.children??[])visit(child);}visit(tree);return result;
}

export function remapMarkdownRecordLinks(source:string,resolve:(target:{workspaceId:string;kind:string;id:string;url:string})=>string):string{
 const tree=fromMarkdown(source,{extensions:[gfm()],mdastExtensions:[gfmFromMarkdown()]});const changes:{start:number;end:number;text:string}[]=[];
 function visit(node:unknown){const n=node as {type:string;url?:string;position?:{start:{offset?:number};end:{offset?:number}};children?:unknown[]};
  if(['link','definition'].includes(n.type)&&n.url){const match=/^\/w\/([0-9a-f-]{36})\/(procedures|documents|contacts|maintenance|equipment|notes|journal|reminders)(?:\/|#)([0-9a-f-]{36})$/.exec(n.url);if(match){const start=n.position?.start.offset??0;const raw=source.slice(start,n.position?.end.offset??start);const index=destinationOffset(raw,n.type,n.url);if(index>=0)changes.push({start:start+index,end:start+index+n.url.length,text:resolve({workspaceId:match[1]??'',kind:match[2]??'',id:match[3]??'',url:n.url})});}}
  for(const child of n.children??[])visit(child);
 }visit(tree);for(const change of changes.sort((a,b)=>b.start-a.start))source=source.slice(0,change.start)+change.text+source.slice(change.end);return source;
}

function destinationOffset(raw:string,type:string,url:string):number {
 const pattern=type==='definition'?/\]:\s*<?/g:/\]\(\s*<?/g;
 for(const token of raw.matchAll(pattern)){const index=token.index+token[0].length;if(raw.startsWith(url,index))return index;}return -1;
}

export function markdownHasOpaqueSyntax(source:string):boolean{
 const tree=fromMarkdown(source,{extensions:[gfm()],mdastExtensions:[gfmFromMarkdown()]});
 function visit(node:unknown):boolean{const n=node as {type:string;children?:unknown[]};return ['html','definition','imageReference','linkReference'].includes(n.type)||(n.children??[]).some(visit);}return visit(tree);
}
