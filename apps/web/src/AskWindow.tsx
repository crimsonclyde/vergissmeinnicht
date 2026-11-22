import {useEffect,useRef,useState} from 'react';
import {askApi,messageFor,type AskConversation} from './api.ts';
import {hasMessage,t,formatDateTime} from './i18n/index.ts';
import './ask.css';
const empty=(workspaceId:string|null):AskConversation=>({id:crypto.randomUUID(),workspaceId,messages:[],sources:[],updatedAt:Date.now()});
export function AskWindow({workspaceId}:{workspaceId?:string}){
 const [enabled,setEnabled]=useState(false);const [available,setAvailable]=useState(false);const [lookups,setLookups]=useState(false);const [open,setOpen]=useState(false);const [policy,setPolicy]=useState<{enabled:boolean;name:string;canManage:boolean}>();
 const [conversation,setConversation]=useState(()=>empty(null));const [question,setQuestion]=useState('');const [draft,setDraft]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const [history,setHistory]=useState<Pick<AskConversation,'id'|'workspaceId'|'updatedAt'>[]>([]);
 const dialog=useRef<HTMLDialogElement>(null);const controller=useRef<AbortController|null>(null);const end=useRef<HTMLDivElement>(null);
 useEffect(()=>{let live=true;const refresh=()=>{askApi.status().then(value=>{if(live){setEnabled(value.enabled);setLookups(value.lookups);setAvailable(value.enabled||value.hasHistory);}}).catch(()=>{});if(workspaceId)askApi.policy(workspaceId).then(value=>{if(live)setPolicy(value);}).catch(()=>{if(live)setPolicy(undefined);});};const changed=(event:Event)=>{const path=(event as CustomEvent<{path:string}>).detail?.path;if((path?.startsWith('/ask/')||path?.endsWith('/ai-assistants')))refresh();};refresh();window.addEventListener('focus',refresh);window.addEventListener('vmn-mutation-succeeded',changed);return()=>{live=false;window.removeEventListener('focus',refresh);window.removeEventListener('vmn-mutation-succeeded',changed);controller.current?.abort();};},[workspaceId]);
 useEffect(()=>{if(open){dialog.current?.showModal();askApi.list().then(value=>setHistory(value.conversations)).catch(()=>{});}else dialog.current?.close();},[open]);
 useEffect(()=>{end.current?.scrollIntoView({block:'nearest'});},[draft,busy]);
 function reset(lookup:boolean){controller.current?.abort();setConversation(empty(lookup?workspaceId??null:null));setDraft('');setError('');}
 async function send(){if(busy||!question.trim())return;const abort=new AbortController();controller.current=abort;setBusy(true);setDraft('');setError('');let finished=false;let failureMessage=t('ask.retry');
 try{const response=await fetch('/api/ask/turn',{method:'POST',credentials:'same-origin',signal:abort.signal,headers:{'content-type':'application/json'},body:JSON.stringify({conversationId:conversation.id,workspaceId:conversation.workspaceId,question,requestId:crypto.randomUUID()})});if(!response.ok||!response.body)throw new Error('request_failed');const reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';
 while(true){const next=await reader.read();if(next.done)break;buffer+=decoder.decode(next.value,{stream:true});let end:number;while((end=buffer.indexOf('\n'))>=0){const event=JSON.parse(buffer.slice(0,end)) as {type:string;text?:string;code?:string;conversation?:AskConversation};buffer=buffer.slice(end+1);if(event.type==='delta')setDraft(value=>value+(event.text??''));if(event.type==='done'&&event.conversation){setConversation(event.conversation);setQuestion('');setDraft('');finished=true;}if(event.type==='error'){const key=`error.${event.code}`;failureMessage=hasMessage(key)?t(key):t('ask.retry');throw new Error('ask_request_failed');}}}
 if(!finished)throw new Error(t('ask.retry'));
 }catch{setError(abort.signal.aborted?t('ask.stopped'):failureMessage);setDraft('');}finally{setBusy(false);controller.current=null;}}
 if(!available)return null;
 return <><button type="button" className="ask-launch" onClick={()=>setOpen(true)}>{t('ask.title')}</button>
 <dialog ref={dialog} className="ask-dialog" aria-labelledby="ask-heading" onCancel={event=>{event.preventDefault();controller.current?.abort();setOpen(false);}}>
 <div className="ask-head"><h2 id="ask-heading">{t('ask.title')}</h2><button type="button" onClick={()=>{controller.current?.abort();setOpen(false);}} aria-label={t('ask.close')}>×</button></div>
 <div className="ask-controls">{!enabled&&<p role="status">{t('error.ask_disabled')}</p>}<p>{conversation.workspaceId?t('ask.workspace',{name:policy?.name??''}):t('ask.general')}</p>
 {workspaceId&&((policy?.enabled&&lookups)||conversation.workspaceId!==null)&&<label className="check-label"><input type="checkbox" disabled={busy} checked={conversation.workspaceId!==null} onChange={e=>reset(e.target.checked)}/>{t('ask.lookup')}</label>}
 <div className="button-row"><button disabled={busy} onClick={()=>reset(conversation.workspaceId!==null)}>{t('ask.new')}</button><button disabled={busy||!conversation.messages.length} onClick={()=>void askApi.delete(conversation.id).then(()=>{setHistory(rows=>rows.filter(row=>row.id!==conversation.id));reset(conversation.workspaceId!==null);},error=>setError(messageFor(error)))}>{t('ask.delete')}</button></div>
 <details><summary>{t('ask.history')}</summary><button disabled={busy} onClick={()=>void askApi.deleteAll().then(()=>{setHistory([]);reset(false);},error=>setError(messageFor(error)))}>{t('ask.deleteAll')}</button>{history.filter(row=>row.workspaceId===conversation.workspaceId).map(row=><button key={row.id} disabled={busy} onClick={()=>void askApi.find(row.id).then(setConversation,error=>setError(messageFor(error)))}>{t('ask.previous',{date:formatDateTime(new Date(row.updatedAt).toISOString())})}</button>)}</details>
 </div>
 <div className="ask-messages" tabIndex={0} aria-label={t('ask.title')}>
 {!conversation.messages.length&&<p className="muted">{t('ask.disclosure')}</p>}
 {conversation.messages.map((message,index)=><p key={index} className={`ask-message ask-${message.role}`}>{message.kind==='no_matches'?t('ask.noMatches'):message.content}</p>)}
 {busy&&<p className="ask-message ask-user">{question}</p>}{draft&&<p className="ask-message ask-assistant">{draft}</p>}
 {!!conversation.sources.length&&<nav aria-label={t('ask.sources')}><strong>{t('ask.sources')}</strong><ul>{conversation.sources.map(source=><li key={source.kind+source.id}><a href={source.url}>{source.title}</a></li>)}</ul></nav>}<div ref={end}/>
 </div>
 <div className="ask-compose">{error&&<p role="alert">{error}</p>}<p className="muted" role="status">{busy?t(draft?'ask.answering':'ask.thinking'):!error&&conversation.messages.length?t('ask.finished'):''}</p>
 <form onSubmit={event=>{event.preventDefault();void send();}}><label htmlFor="ask-question">{t('ask.question')}</label><textarea id="ask-question" value={question} maxLength={2000} rows={3} disabled={busy} onChange={e=>setQuestion(e.target.value)}/>
 <div className="button-row">{busy?<button type="button" onClick={()=>controller.current?.abort()}>{t('ask.stop')}</button>:<button className="primary" disabled={!enabled||!question.trim()}>{t('ask.send')}</button>}</div></form>
 {workspaceId&&policy?.canManage&&<details><summary>{t('ask.policy')}</summary><p>{t('ask.policyHint')}</p><label className="check-label"><input type="checkbox" disabled={busy} checked={policy.enabled} onChange={e=>{const value=e.target.checked;void askApi.setPolicy(workspaceId,value).then(saved=>{setPolicy(saved);reset(false);},error=>setError(messageFor(error)));}}/>{t('ask.policy')}</label></details>}
 </div></dialog></>;
}
