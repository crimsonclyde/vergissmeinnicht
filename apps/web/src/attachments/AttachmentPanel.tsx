import {useCallback,useEffect,useState} from 'react';
import {messageFor,type AttachmentClient,type AttachmentView} from '../api.ts';
import {formatBytes} from '../document-model.ts';
import {t} from '../i18n/index.ts';
export const imageReference=(file:AttachmentView)=>`attachments/${file.id}.${file.format==='PNG'?'png':'jpg'}`;
export function AttachmentPanel({client,initiallyOpen=false,refreshVersion,onInsert,onError,allowClipboardImage=false}:{client:AttachmentClient;initiallyOpen?:boolean;refreshVersion:number;onInsert:(text:string)=>void;onError:(text:string)=>void;allowClipboardImage?:boolean}){
 const [expanded,setExpanded]=useState(initiallyOpen);
 const [files,setFiles]=useState<AttachmentView[]>([]);const [usage,setUsage]=useState<{used:number;remaining:number;limit:number}|null>(null);const [busy,setBusy]=useState(false);
 const refresh=useCallback(async()=>{const [list,stats]=await Promise.all([client.list(),client.usage()]);setFiles(list.attachments);setUsage(stats.usage);},[client]);
 useEffect(()=>{let active=true;void Promise.all([client.list(),client.usage()]).then(([list,stats])=>{if(active){setFiles(list.attachments);setUsage(stats.usage);}},error=>{if(active)onError(messageFor(error));});return()=>{active=false;};},[client,onError,refreshVersion]);
 async function upload(file:File){setBusy(true);try{const result=await client.upload(file);onInsert(`\n\n![${result.name.replace(/[[\]\\]/g,'')} ](${imageReference(result)})\n`);await refresh();}catch(error){onError(messageFor(error));}finally{setBusy(false);}}
 async function pasteImage() {
   setBusy(true);
   try {
     const clipboard = await navigator.clipboard.read();
     for (const item of clipboard) {
       const type = item.types.find(value => value === 'image/png' || value === 'image/jpeg');
       if (!type) continue;
       const blob = await item.getType(type);
       await upload(new File([blob], type === 'image/png' ? 'recipe-image.png' : 'recipe-image.jpg', { type }));
       return;
     }
     onError(t('recipes.clipboardEmpty'));
   } catch {
     onError(t('recipes.clipboardUnavailable'));
   } finally {
     setBusy(false);
   }
 }
 return <details className="stack" open={expanded} onToggle={event=>setExpanded(event.currentTarget.open)}><summary>{t('journal.images')}</summary><div className="stack">
  <p className="muted">{t('attachments.originalNotice')}</p>{usage&&<p>{t('journal.imageUsage',{used:formatBytes(usage.used),remaining:formatBytes(usage.remaining),limit:formatBytes(usage.limit)})}</p>}
  <label>{t('journal.uploadImage')}<input type="file" accept="image/jpeg,image/png" disabled={busy} onChange={event=>{const file=event.target.files?.[0];if(file)void upload(file);event.target.value='';}}/></label>
  {allowClipboardImage && typeof navigator.clipboard?.read === 'function' && <button type="button" disabled={busy} onClick={() => void pasteImage()}>{t('recipes.pasteImage')}</button>}
  <ul className="plain-list stack">{files.map(file=><li key={file.id} className="row wrap"><span>{file.name} · {formatBytes(file.bytes)}</span><button type="button" onClick={()=>onInsert(`\n\n![${file.name.replace(/[[\]\\]/g,'')}](${imageReference(file)})\n`)}>{t('journal.insertImage')}</button><button type="button" disabled={busy} onClick={()=>{setBusy(true);void client.regenerate(file.id).catch(error=>onError(messageFor(error))).finally(()=>setBusy(false));}}>{t('journal.regenerate')}</button><a href={client.url(file.id,'original')} download>{t('journal.downloadOriginal')}</a></li>)}</ul>
 </div></details>;
}
