import {useEffect,useState} from 'react';
import {api,messageFor} from '../api.ts';
import {paths} from '../router.tsx';
import {t} from '../i18n/index.ts';
interface Reference {id:string;title:string;href:string}
const KINDS=['JOURNAL','PROCEDURES','REMINDERS','DOCUMENTS','CONTACTS','MAINTENANCE','EQUIPMENT'] as const;
type Kind=typeof KINDS[number];
const LABELS={JOURNAL:'journal.heading',PROCEDURES:'shell.procedures',REMINDERS:'shell.reminders',DOCUMENTS:'shell.documents',CONTACTS:'shell.contacts',MAINTENANCE:'shell.maintenance',EQUIPMENT:'shell.equipment'} as const;
/** Only existing, tool-gated Workspace APIs are queried; personal Journal is never a target. */
export function WorkspaceReferences({workspaceId,onInsert}:{workspaceId:string;onInsert:(markdown:string)=>void}){
 const [open,setOpen]=useState(false);const [tools,setTools]=useState<Kind[]>([]);const [kind,setKind]=useState<Kind>('JOURNAL');const [query,setQuery]=useState('');const [found,setFound]=useState<Reference[]>([]);const [message,setMessage]=useState<string|null>(null);
 useEffect(()=>{if(!open)return;let active=true;api.workspace(workspaceId).then(result=>{if(active)setTools(KINDS.filter(tool=>result.tools.includes(tool)));},error=>{if(active)setMessage(messageFor(error));});return()=>{active=false;};},[workspaceId,open]);
 useEffect(()=>{if(!open||!tools.includes(kind))return;let active=true;const search=async():Promise<Reference[]>=>{
  const q=new URLSearchParams({q:query}).toString();
  switch(kind){
   case 'JOURNAL':return (await api.journal(workspaceId,query,false,0)).entries.map(entry=>({id:entry.id,title:entry.title,href:paths.note(workspaceId,entry.id)}));
   case 'PROCEDURES':return (await api.procedures(workspaceId)).map(entry=>({id:entry.id,title:entry.title,href:paths.procedure(workspaceId,entry.id)}));
   case 'REMINDERS':return (await api.schedules(workspaceId)).map(entry=>({id:entry.id,title:entry.title??entry.procedure?.title??entry.id,href:paths.reminders(workspaceId)+'#'+entry.id}));
   case 'DOCUMENTS':return (await api.documents(workspaceId,q)).documents.map(entry=>({id:entry.id,title:entry.title,href:paths.document(workspaceId,entry.id)}));
   case 'CONTACTS':return (await api.contacts(workspaceId,q)).contacts.map(entry=>({id:entry.id,title:entry.name,href:paths.contact(workspaceId,entry.id)}));
   case 'MAINTENANCE':return (await api.maintenance(workspaceId,q)).records.map(entry=>({id:entry.id,title:entry.title,href:paths.maintenanceRecord(workspaceId,entry.id)}));
   case 'EQUIPMENT':return (await api.equipment(workspaceId,q)).records.map(entry=>({id:entry.id,title:entry.name,href:paths.equipmentRecord(workspaceId,entry.id)}));
  }
 };
 const timer=window.setTimeout(()=>{void search().then(result=>{if(active){setFound(result.filter(entry=>entry.title.toLowerCase().includes(query.toLowerCase())).slice(0,30));setMessage(null);}},error=>{if(active){setFound([]);setMessage(messageFor(error));}});},250);return()=>{active=false;window.clearTimeout(timer);};},[kind,tools,workspaceId,query,open]);
 return <details open={open} onToggle={event=>setOpen(event.currentTarget.open)}><summary>{t('markdown.references')}</summary>{message&&<p role="alert">{message}</p>}{tools.length>0&&<div className="stack"><label>{t('markdown.referenceType')}<select value={kind} onChange={event=>{setKind(event.target.value as Kind);setFound([]);}}>{tools.map(tool=><option key={tool} value={tool}>{t(LABELS[tool])}</option>)}</select></label><label>{t('markdown.referenceSearch')}<input value={query} maxLength={100} onChange={event=>setQuery(event.target.value)}/></label><ul className="plain-list">{found.map(entry=><li key={entry.id}><button type="button" onClick={()=>{onInsert(`[${entry.title.replace(/([\\[\]])/g,'\\$1')}](${entry.href})`);setOpen(false);}}>{entry.title}</button></li>)}</ul></div>}</details>;
}
