import {MobileActionBar} from '../../mobile/MobileActionBar.tsx';
import {useCompactLayout} from '../../mobile/useCompactLayout.ts';
import {WorkspaceReferences} from '../../markdown/WorkspaceReferences.tsx';
import {markdownOutline} from '@vergissmeinnicht/domain';
import {JournalImages,imageReference} from './JournalImages.tsx';
import { useCallback, useEffect, useLayoutEffect, useId, useRef, useState } from 'react';
import type { JournalContent, JournalDraft, JournalRevision } from '@vergissmeinnicht/domain';
import { api, attachmentUrl, uploadJournalImage, messageFor, type JournalView } from '../../api.ts';
import { formatCalendarDate, formatDateTime, t } from '../../i18n/index.ts';
import { Link, paths, replaceEditorPath, setNavigationGuard } from '../../router.tsx';
import { Markdown } from '../../markdown/Markdown.tsx';
import { MarkdownEditor } from '../../markdown/MarkdownEditor.tsx';

type EditorScreen = 'title' | 'write' | 'details' | 'files';
const SCREENS = ['write','details','files'] as const;
const SCREEN_LABELS = {write:'journal.writeScreen',details:'journal.detailsScreen',files:'journal.filesScreen'} as const;

const contentOf = (entry: JournalView): JournalContent => ({kind:entry.kind,version:entry.version,title:entry.title,date:entry.date,body:entry.body,collection:entry.collection??'',tags:entry.tags??[],pinned:entry.pinned??false});
const fresh = ():JournalContent=>({kind:'note',version:2,title:'',date:null,body:'',collection:'',tags:[],pinned:false});
export function JournalPage({workspaceId,canWrite,creating=false,entryId}:{workspaceId?:string;canWrite:boolean;creating?:boolean;entryId?:string}) {
 const compact=useCompactLayout();const [editorStarted,setEditorStarted]=useState(false);const titleInput=useRef<HTMLInputElement>(null);
 const [screen,setScreen]=useState<EditorScreen>(()=>compact&&creating?'title':'write');
 const activeScreen=compact?(screen==='files'?'details':screen):(screen==='title'?'write':screen);const panelId=useId();
 function showScreen(next:EditorScreen){if(next==='write'||activeScreen==='write')setEditorStarted(true);setScreen(next);window.requestAnimationFrame(()=>{document.getElementById(panelId+next)?.focus({preventScroll:true});document.getElementById(formId)?.closest('.journal-editor')?.scrollIntoView({block:'start'});});}
 const formId=useId();const heading=useId();const [loadingEntry,setLoadingEntry]=useState(entryId!==undefined);const [consent,setConsent]=useState<boolean|null>(workspaceId===undefined?null:true);
 const [entries,setEntries]=useState<JournalView[]|null>(null);const [entry,setEntry]=useState<JournalView|null>(null);
 const [draft,setDraft]=useState<JournalContent|null>(null);const [original,setOriginal]=useState('');
 const [recovery,setRecovery]=useState<JournalDraft|null>(null);const [history,setHistory]=useState<JournalRevision[]|null>(null);const [historyMore,setHistoryMore]=useState(false);const [imageVersion,setImageVersion]=useState(0);
 const [tagText,setTagText]=useState<string|null>(null);
 const [search,setSearch]=useState('');const [query,setQuery]=useState('');const [archived,setArchived]=useState(false);const [offset,setOffset]=useState(0);const [more,setMore]=useState(false);
 const [busy,setBusy]=useState(false);const [message,setMessage]=useState<string|null>(null);const [status,setStatus]=useState('');const [autosave,setAutosave]=useState(false);const [editorKey,setEditorKey]=useState(0);const [sourceMode,setSourceMode]=useState(false);
 const isEditing=draft!==null&&canWrite;
 useEffect(()=>{window.dispatchEvent(new CustomEvent('vmn-journal-editing',{detail:isEditing}));return()=>{window.dispatchEvent(new CustomEvent('vmn-journal-editing',{detail:false}));};},[isEditing]);
 const dirty=draft!==null&&JSON.stringify(draft)!==original;const current=useRef({draft,entry,busy,dirty});useLayoutEffect(()=>{current.current={draft,entry,busy,dirty};},[draft,entry,busy,dirty]);
 const leave=useCallback(()=>!dirty||window.confirm(t('journal.unsaved')),[dirty]);
 useEffect(()=>{setNavigationGuard(leave);const warn=(event:BeforeUnloadEvent)=>{if(dirty){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>{setNavigationGuard(null);window.removeEventListener('beforeunload',warn);};},[leave,dirty]);
 useEffect(()=>{if(workspaceId!==undefined)return;let active=true;api.journalPrivacy().then(result=>{if(active)setConsent(result.acknowledged);},error=>{if(active)setMessage(messageFor(error));});return()=>{active=false;};},[workspaceId]);
 useEffect(()=>{if(!entryId||consent!==true)return;let active=true;api.journalEntry(workspaceId,entryId).then(result=>{if(active){setEntry(result);const content=contentOf(result);setDraft(content);setOriginal(JSON.stringify(content));setEditorKey(value=>value+1);}},error=>{if(active)setMessage(messageFor(error));}).finally(()=>{if(active)setLoadingEntry(false);});return()=>{active=false;};},[workspaceId,entryId,consent]);
 const reload=useCallback(async()=>{const result=await api.journal(workspaceId,query,archived,offset);setEntries(result.entries);setMore(result.more);},[workspaceId,query,archived,offset]);
 useEffect(()=>{if(consent!==true)return;let active=true;api.journal(workspaceId,query,archived,offset).then(result=>{if(active){setEntries(result.entries);setMore(result.more);}},error=>{if(active)setMessage(messageFor(error));});return()=>{active=false;};},[consent,workspaceId,query,archived,offset]);
 useEffect(()=>{if(consent!==true||!canWrite)return;let active=true;api.journalDraft(workspaceId).then(result=>{if(active){setRecovery(result.draft);if(creating&&result.draft===null){const next=fresh();setDraft(next);setOriginal(JSON.stringify(next));}}},error=>{if(active)setMessage(messageFor(error));});return()=>{active=false;};},[consent,canWrite,creating,workspaceId]);
 const showError=useCallback((message:string)=>setMessage(message),[]);
 const resolveImage=(path:string)=>{const match=/^attachments\/([0-9a-f-]{36})\.(?:jpg|png)$/.exec(path);return match?attachmentUrl(workspaceId,match[1]??''):undefined;};
 async function uploadFile(file:File){try{const fileRef=imageReference(await uploadJournalImage(workspaceId,file));setImageVersion(value=>value+1);return fileRef;}catch(error){setMessage(messageFor(error));throw error;}}
 function change(next:JournalContent){setDraft(next);setStatus('');setMessage(null);}
 async function open(id:string){if(!leave())return;setBusy(true);setMessage(null);try{const result=await api.journalEntry(workspaceId,id);setScreen('write');setEntry(result);replaceEditorPath(workspaceId?paths.note(workspaceId,result.id):paths.journalEntry(result.id));setTagText(null);const next=contentOf(result);setDraft(next);setOriginal(JSON.stringify(next));setHistory(null);setEditorKey(k=>k+1);setStatus('');}catch(error){setMessage(messageFor(error));}finally{setBusy(false);}}
 const save=useCallback(async(archive?:boolean)=>{
  const state=current.current;if(state.draft===null||state.busy)return;setBusy(true);setMessage(null);setStatus(t('journal.saving'));
  try{const result=await api.saveJournal(workspaceId,state.entry?.id,state.draft,state.entry?.revision??0,archive??state.entry?.archived??false);setEntry(result);replaceEditorPath(workspaceId?paths.note(workspaceId,result.id):paths.journalEntry(result.id));const next=contentOf(result);const unchanged=JSON.stringify(current.current.draft)===JSON.stringify(state.draft);if(unchanged){setDraft(next);setTagText(null);}setOriginal(JSON.stringify(next));setRecovery(null);setStatus(t(unchanged?'journal.saved':'journal.unsavedStatus'));await reload().catch(error=>setMessage(messageFor(error)));}
  catch(error){setMessage(messageFor(error));setStatus(t('journal.unsavedStatus'));setAutosave(false);}finally{setBusy(false);}
 },[workspaceId,reload]);
 useEffect(()=>{
  if(recovery!==null||!dirty||busy||draft===null||draft.title.trim()===''||consent!==true||!canWrite)return;
  let active=true;const timer=window.setTimeout(()=>{
   if(autosave){void save();return;}
   void api.saveJournalDraft(workspaceId,{entryId:entry?.id??null,expectedRevision:entry?.revision??0,content:draft,archived:entry?.archived??false}).then(()=>{if(active)setStatus(t('journal.draftSaved'));},error=>{if(active)setMessage(messageFor(error));});
  },1500);return()=>{active=false;window.clearTimeout(timer);};
 },[recovery,dirty,busy,draft,entry,consent,canWrite,autosave,save,workspaceId]);
 async function recover(){if(!recovery||!leave())return;setBusy(true);try{let target:JournalView|null=null;if(recovery.entryId!==null)target=await api.journalEntry(workspaceId,recovery.entryId);if(target&&target.revision!==recovery.expectedRevision){setMessage(t('error.journal_conflict'));setAutosave(false);}setEntry(target?{...target,revision:recovery.expectedRevision}:null);if(target)replaceEditorPath(workspaceId?paths.note(workspaceId,target.id):paths.journalEntry(target.id));setScreen('write');setDraft(recovery.content);setOriginal('');setEditorKey(k=>k+1);setRecovery(null);}catch(error){setMessage(messageFor(error));}finally{setBusy(false);}}
 function closeEditor(){if(busy||!leave())return;replaceEditorPath(workspaceId?paths.journal(workspaceId):paths.account('journal'));setDraft(null);setEntry(null);setHistory(null);setStatus('');}
 function advance(){if(busy||recovery!==null)return;if(activeScreen==='title'){if(!titleInput.current?.reportValidity())return;showScreen('write');}else showScreen('details');}
 const fileTools=draft?.version===2?<>
  {workspaceId&&<WorkspaceReferences workspaceId={workspaceId} onInsert={text=>{change({...draft,body:draft.body+'\n\n'+text});setEditorKey(value=>value+1);}}/>}
  <JournalImages initiallyOpen refreshVersion={imageVersion} workspaceId={workspaceId} onError={showError} onInsert={text=>{change({...draft,body:draft.body+text});setEditorKey(k=>k+1);}}/>
 </>:null;
 const Heading=draft!==null&&canWrite?'h1':'h2';
 const outline=draft?.version===2?markdownOutline(draft.body):[];
 if(loadingEntry&&consent===true)return <p>{t('journal.loading')}</p>;
 if(consent!==true)return <section className="card stack"><h2>{t('journal.noticeTitle')}</h2>{message&&<p role="alert">{message}</p>}{consent===null?<p>{t('journal.loading')}</p>:<><p>{t('journal.noticeOwnership')}</p><p>{t('journal.noticeAdmin')}</p><button type="button" className="primary" disabled={busy} onClick={()=>{setBusy(true);void api.acknowledgeJournal().then(()=>setConsent(true),error=>setMessage(messageFor(error))).finally(()=>setBusy(false));}}>{t('journal.agree')}</button></>}</section>;
 return <section className="stack journal" data-editing={isEditing} data-staged={compact&&isEditing} aria-labelledby={heading}>
  <div className="page-header"><Heading id={heading}>{t(workspaceId===undefined?'journal.privateHeading':'journal.heading')}</Heading></div>
  {!isEditing&&<p className="muted">{t(workspaceId===undefined?'journal.privateHint':'journal.sharedHint')}</p>}
  {!isEditing&&workspaceId!==undefined&&<Link href={paths.account('journal')}>{t('journal.privateLink')}</Link>}
  {message&&<p role="alert">{message}</p>}<p className="journal-status" role="status">{status||(dirty?t('journal.unsavedStatus'):'')}</p>
  {recovery&&<div className="card row wrap"><button type="button" disabled={busy} onClick={()=>void recover()}>{t('journal.recover')}</button><button type="button" disabled={busy} onClick={()=>{void api.saveJournalDraft(workspaceId,null).then(()=>{setRecovery(null);if(creating&&draft===null){const next=fresh();setDraft(next);setOriginal(JSON.stringify(next));}},error=>setMessage(messageFor(error)));}}>{t('journal.discardDraft')}</button></div>}
  {draft!==null?<div className="card stack journal-editor">
   {!compact&&<div className="journal-actions"><button aria-label={t(screen==='write'?'journal.cancel':'journal.backWriting')} type="button" className="quiet" disabled={busy} onClick={()=>{if(canWrite&&screen!=='write'){showScreen('write');return;}if(leave()){replaceEditorPath(workspaceId?paths.journal(workspaceId):paths.account('journal'));setDraft(null);setEntry(null);setHistory(null);setStatus('');}}}>{t('journal.backShort')}</button>{canWrite&&<button type="submit" form={formId} aria-label={t('journal.save')} className="primary" disabled={busy||recovery!==null}>{t('journal.saveShort')}</button>}</div>}
   {canWrite?<form id={formId} className="stack" onInvalidCapture={event=>{const target=event.target as HTMLElement;const panel=target.closest<HTMLElement>('[data-editor-screen]');const next=panel?.dataset.editorScreen as EditorScreen|undefined;if(next&&next!==activeScreen){event.preventDefault();setScreen(next);window.requestAnimationFrame(()=>target.focus());}}} onSubmit={event=>{event.preventDefault();if(compact&&activeScreen!=='details'){advance();return;}void save();}}><fieldset className="stack" disabled={busy||recovery!==null}>
    {!compact&&<nav className="journal-screens" aria-label={t('journal.editorNavigation')}>{SCREENS.map(item=><button key={item} type="button" aria-current={screen===item?'page':undefined} aria-controls={panelId+item} onClick={()=>showScreen(item)}>{t(SCREEN_LABELS[item])}</button>)}</nav>}
    {compact&&<p className="journal-phone-step" aria-live="polite">{t('journal.stepOf',{step:activeScreen==='title'?1:activeScreen==='write'?2:3})}</p>}
    {compact&&<section id={panelId+'title'} className="stack journal-screen journal-title-screen" data-editor-screen="title" aria-label={t('journal.titleScreen')} tabIndex={-1} hidden={activeScreen!=='title'}>
     <h2>{t('journal.phoneTitle')}</h2><label><span className="visually-hidden">{t('journal.title')}</span><input placeholder={t('journal.titlePlaceholder')} ref={titleInput} name="entryTitle" value={draft.title} required maxLength={160} enterKeyHint="next" onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();advance();}}} onChange={event=>change({...draft,title:event.target.value})}/></label>
    </section>}
    <section id={panelId+'write'} className="stack journal-screen" data-editor-screen="write" aria-label={t('journal.writeScreen')} tabIndex={-1} hidden={activeScreen!=='write'}>
    {compact?<h2>{draft.title||t('journal.phoneWrite')}</h2>:<label>{t('journal.title')}<input ref={titleInput} name="entryTitle" value={draft.title} required maxLength={160} onChange={event=>change({...draft,title:event.target.value})}/></label>}
    {(!compact||editorStarted||activeScreen==='write')&&<>{draft.version===1?<><p>{t('journal.legacy')}</p><label>{t('journal.body')}<textarea value={draft.body} maxLength={50000} onChange={event=>change({...draft,body:event.target.value})}/></label><button type="button" onClick={()=>{change({...draft,version:2,body:draft.body.replace(/([\\`*_{}[\]<>()#+.!|~-])/g,'\\$1')});setEditorKey(k=>k+1);}}>{t('journal.convert')}</button></>:<MarkdownEditor visualOnly={compact} sourceMode={sourceMode} onSourceModeChange={setSourceMode} key={editorKey} resolveImage={resolveImage} upload={uploadFile} value={draft.body} onChange={body=>change({...draft,body})}/>}</>}
    </section>
    <section id={panelId+'details'} className="stack journal-screen journal-details" data-editor-screen="details" aria-label={t('journal.detailsScreen')} tabIndex={-1} hidden={activeScreen!=='details'}>
    <h2>{t(compact?'journal.phoneDetails':'journal.details')}</h2><p className="muted">{t('journal.detailsHint')}</p>
    <div className="row wrap"><label>{t('journal.optionalDate')}<input type="date" value={draft.date??''} required={draft.version===1} onChange={event=>change({...draft,date:event.target.value||null,version:draft.version})}/></label><label>{t('journal.collection')}<input list={panelId+'collections'} value={draft.collection??''} maxLength={80} onChange={event=>change({...draft,collection:event.target.value})}/></label></div>
    <datalist id={panelId+'collections'}>{[...new Set((entries??[]).map(item=>item.collection).filter((value):value is string=>Boolean(value)))].map(value=><option key={value} value={value}/>)}</datalist>
    <label>{t('journal.tags')}<input value={tagText??(draft.tags??[]).join(', ')} maxLength={340} onChange={event=>{setTagText(event.target.value);change({...draft,tags:event.target.value.split(',').map(tag=>tag.trim()).filter(Boolean)});}}/></label>
    <label className="row"><input type="checkbox" checked={draft.pinned??false} onChange={event=>change({...draft,pinned:event.target.checked})}/>{t('journal.pinned')}</label>
    {compact&&fileTools&&<details className="journal-phone-files"><summary>{t('journal.filesScreen')}</summary><div className="stack">{fileTools}</div></details>}
    <label className="row"><input type="checkbox" checked={autosave} onChange={event=>setAutosave(event.target.checked)}/>{t('journal.autosave')}</label>
    <div className="row wrap">{entry&&<button type="button" onClick={()=>void save(!entry.archived)}>{t(entry.archived?'journal.restore':'journal.archive')}</button>}</div>
    </section>
    <section id={panelId+'files'} className="stack journal-screen" data-editor-screen="files" aria-label={t('journal.filesScreen')} tabIndex={-1} hidden={compact||activeScreen!=='files'}>
    <h2>{t('journal.filesScreen')}</h2><p className="muted">{t('journal.filesHint')}</p>
    {!compact&&fileTools}
    </section>
   </fieldset></form>:<><h3>{draft.title}</h3>{draft.date&&<time dateTime={draft.date}>{formatCalendarDate(draft.date)}</time>}{draft.version===1?<p className="journal-note">{draft.body}</p>:<Markdown source={draft.body} resolveImage={resolveImage} resolveOriginal={path=>resolveImage(path)?.replace(/\/preview$/,'/original')}/>}</>}
   <div className="stack" hidden={canWrite&&activeScreen!=='details'}>
   {outline.length>0&&<details><summary>{t('journal.outline')}</summary><ol className="journal-outline">{outline.map(item=><li key={item.anchor}><a href={'#'+item.anchor}>{item.text}</a></li>)}</ol></details>}
   {entry&&<a className="button quiet" href={`/api${workspaceId?'/workspaces/'+encodeURIComponent(workspaceId)+'/journal':'/account/journal'}/${entry.id}/export`} download>{t('journal.export')}</a>}
   {entry&&<><small className="muted">{t('journal.attribution',{name:entry.updatedBy,date:formatDateTime(entry.updatedAt)})}</small><button type="button" disabled={busy} onClick={()=>{void api.journalHistory(workspaceId,entry.id).then(result=>{setHistory(result.revisions);setHistoryMore(result.revisions.length===30);},error=>setMessage(messageFor(error)));}}>{t('journal.history')}</button></>}
   {history&&<ol className="stack">{history.map(revision=><li key={revision.revision}><details><summary>{revision.revision} · {revision.by} · {formatDateTime(revision.at)}</summary><pre className="journal-note">{revision.content.body}</pre>{canWrite&&<button type="button" onClick={()=>{change(revision.content);setEditorKey(k=>k+1);showScreen('write');}}>{t('journal.useRevision')}</button>}</details></li>)}</ol>}
   {history&&historyMore&&entry&&<button type="button" onClick={()=>{const before=history.at(-1)?.revision;if(before)void api.journalHistory(workspaceId,entry.id,before).then(result=>{setHistory([...history,...result.revisions]);setHistoryMore(result.revisions.length===30);},error=>setMessage(messageFor(error)));}}>{t('journal.more')}</button>}
   </div>
   {compact&&canWrite&&<MobileActionBar label={t('journal.phoneActions')}
    actions={[
     {id:'back',label:t(activeScreen==='title'?'journal.cancel':'journal.backShort'),icon:'back',disabled:busy,onClick:()=>{if(activeScreen==='title')closeEditor();else showScreen(activeScreen==='details'?'write':'title');}},
     {id:'cancel',label:t('journal.cancelEditing'),icon:'close',disabled:busy,onClick:closeEditor},
    ]}
    primary={activeScreen==='details'?{id:'save',label:t('journal.save'),icon:'save',type:'submit',form:formId,disabled:busy||recovery!==null}:{id:'next',label:t('journal.next'),icon:'forward',disabled:busy||recovery!==null,onClick:advance}}
   />}
  </div>:<>
   <a className="button quiet" href={`/api${workspaceId?'/workspaces/'+encodeURIComponent(workspaceId)+'/journal':'/account/journal'}/export?${new URLSearchParams({q:query,archived:String(archived)})}`} download>{t('journal.exportAll')}</a><a className="button quiet" href={`/api${workspaceId?'/workspaces/'+encodeURIComponent(workspaceId)+'/journal':'/account/journal'}/export?all=true`} download>{t('journal.exportArchive')}</a>
   {canWrite&&<button type="button" disabled={recovery!==null} className="primary" onClick={()=>{const next=fresh();setScreen(compact?'title':'write');setEntry(null);setTagText(null);setDraft(next);setOriginal(JSON.stringify(next));setEditorKey(k=>k+1);setStatus('');}}>{t('journal.new')}</button>}
   <form className="row wrap" onSubmit={event=>{event.preventDefault();setQuery(search);setOffset(0);}}><label>{t('journal.search')}<input value={search} maxLength={120} onChange={event=>setSearch(event.target.value)}/></label><button type="submit">{t('journal.searchButton')}</button></form>
   <label className="row"><input type="checkbox" checked={archived} onChange={event=>{setArchived(event.target.checked);setOffset(0);}}/>{t('journal.archived')}</label>
   {entries===null?<p>{t('journal.loading')}</p>:entries.length===0?<p className="muted">{t('journal.empty')}</p>:<ul className="plain-list stack">{entries.map(item=><li key={item.id}><button type="button" className="card link-card" disabled={busy} onClick={()=>void open(item.id)}><span className="item-body"><strong>{item.pinned?'★ ':''}{item.title}</strong><small>{item.collection}{item.date?' · '+formatCalendarDate(item.date):''}</small></span></button></li>)}</ul>}
   <div className="row wrap">{offset>0&&<button type="button" onClick={()=>setOffset(Math.max(0,offset-30))}>{t('journal.previous')}</button>}{more&&<button type="button" onClick={()=>setOffset(offset+30)}>{t('journal.more')}</button>}</div>
  </>}
 </section>;
}
