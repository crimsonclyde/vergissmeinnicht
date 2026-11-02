import {useEffect,useId,useState} from 'react';
import {api,messageFor} from './api.ts';
import {formatBytes} from './document-model.ts';
import {t} from './i18n/index.ts';
type Loaded=Awaited<ReturnType<typeof api.attachmentAdmin>>;
export function AttachmentSettings(){
 const heading=useId();
 const [data,setData]=useState<Loaded|null>(null);const [upload,setUpload]=useState('20');const [quota,setQuota]=useState('500');const [cap,setCap]=useState('');const [formats,setFormats]=useState<('JPEG'|'PNG')[]>(['JPEG','PNG']);const [overrides,setOverrides]=useState<Record<string,string>>({});const [message,setMessage]=useState<string|null>(null);const [saved,setSaved]=useState(false);const [busy,setBusy]=useState(false);
 function show(value:Loaded){setData(value);setUpload(String(value.settings.maxUploadBytes/1e6));setQuota(String(value.settings.defaultQuotaBytes/1e6));setCap(value.settings.serverLimitBytes===null?'':String(value.settings.serverLimitBytes/1e9));setFormats([...value.settings.formats]);setOverrides(Object.fromEntries(value.accounts.map(user=>[user.id,user.override===null?'':String(user.override/1e6)])));}
 useEffect(()=>{api.attachmentAdmin().then(show,error=>setMessage(messageFor(error)));},[]);
 async function mutate(action:()=>Promise<unknown>){setBusy(true);setSaved(false);setMessage(null);try{await action();show(await api.attachmentAdmin());setSaved(true);}catch(error){setMessage(messageFor(error));}finally{setBusy(false);}}
 return <section className="card stack" aria-labelledby={heading}><h3 id={heading}>{t('attachments.settings')}</h3><p>{t('attachments.settingsHint')}</p>{message&&<p role="alert">{message}</p>}{saved&&<p role="status">{t('attachments.saved')}</p>}{data&&<>
  <p>{t('attachments.globalUsage',{used:formatBytes(data.global.used),reserved:formatBytes(data.global.reserved)})}</p>
  <form className="stack" onChange={()=>setSaved(false)} onSubmit={event=>{event.preventDefault();void mutate(()=>api.saveAttachmentPolicy({maxUploadBytes:Math.round(Number(upload)*1e6),defaultQuotaBytes:Math.round(Number(quota)*1e6),serverLimitBytes:cap===''?null:Math.round(Number(cap)*1e9),formats}));}}><fieldset className="stack" disabled={busy}>
   <label>{t('attachments.uploadMB')}<input type="number" min="1" max="100" step="0.1" required value={upload} onChange={event=>setUpload(event.target.value)}/></label>
   <label>{t('attachments.quotaMB')}<input type="number" min="0" max="1000000" step="0.1" required value={quota} onChange={event=>setQuota(event.target.value)}/></label>
   <label>{t('attachments.capGB')}<input type="number" min="0.1" max="1000000" step="0.1" value={cap} onChange={event=>setCap(event.target.value)}/></label>
   {(['JPEG','PNG'] as const).map(format=><label key={format} className="row"><input type="checkbox" checked={formats.includes(format)} onChange={event=>setFormats(event.target.checked?[...formats,format]:formats.filter(item=>item!==format))}/>{format}</label>)}
   <button type="submit" className="primary">{t('guide.save')}</button>
  </fieldset></form>
  <h4>{t('attachments.overrides')}</h4><ul className="plain-list stack">{data.accounts.map(user=><li key={user.id}><form className="row wrap" onSubmit={event=>{event.preventDefault();const value=overrides[user.id]??'';void mutate(()=>api.saveAttachmentQuota(user.id,value===''?null:Math.round(Number(value)*1e6)));}}><label>{user.name} · {formatBytes(user.used)}<input type="number" min="0" max="1000000" step="0.1" value={overrides[user.id]??''} disabled={busy} onChange={event=>{setOverrides({...overrides,[user.id]:event.target.value});setSaved(false);}}/></label><button type="submit" disabled={busy}>{t('guide.save')}</button></form></li>)}</ul>
 </>}</section>;
}
