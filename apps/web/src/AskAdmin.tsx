import {useEffect,useState} from 'react';
import {askApi,messageFor,type AskAdminState,type WorkspaceSummary} from './api.ts';
import {t} from './i18n/index.ts';
import {McpConnections} from './McpConnections.tsx';
import './ask.css';
export function AskAdmin({workspaces,currentUserId}:{workspaces:readonly WorkspaceSummary[]|null;currentUserId:string}){
 const [state,setState]=useState<AskAdminState>();const [cap,setCap]=useState('0');const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
 useEffect(()=>{let live=true;askApi.admin().then(value=>{if(live){setState(value);setCap(String(value.cap/1000000));}},error=>{if(live)setMessage(messageFor(error));});return()=>{live=false;};},[]);
 async function save(){if(!state)return;setBusy(true);setMessage('');try{await askApi.configure({enabled:state.enabled,lookups:state.lookups,cap:Math.round(Number(cap)*1000000),model:state.model});setState(await askApi.admin());setMessage(t('ask.saved'));}catch(error){setMessage(messageFor(error));}finally{setBusy(false);}}
 async function test(){setBusy(true);setMessage('');try{await askApi.test();setMessage(t('ask.testPassed'));}catch(error){setMessage(messageFor(error));}finally{setState(await askApi.admin());setBusy(false);}}
 if(new URLSearchParams(window.location.search).has('request'))return <McpConnections workspaces={workspaces} currentUserId={currentUserId}/>;
 return <div className="stack ask-admin"><header><h2>{t('ask.adminTitle')}</h2><p>{t('ask.adminLead')}</p><nav className="button-row" aria-label={t('ask.adminTitle')}><a href="#ask-admin-heading">{t('ask.title')}</a><a href="#mcp-heading">{t('ask.external')}</a></nav></header>
 <section className="card stack" aria-labelledby="ask-admin-heading"><h3 id="ask-admin-heading">{t('ask.title')}</h3>{state&&<p>{t(!state.enabled?'ask.configOff':!state.configured?'ask.configKeyMissing':state.usage.charge+100000>state.cap?'error.ask_budget_reached':'ask.configReady')}</p>}
 {message&&<p role="status">{message}</p>}
 {state?<><form className="stack" onSubmit={event=>{event.preventDefault();void save();}}><fieldset disabled={busy} className="stack">
 <label className="check-label"><input type="checkbox" checked={state.enabled} onChange={e=>setState({...state,enabled:e.target.checked})}/>{t('ask.availability')}</label>
 <label>{t('ask.model')}<select value={state.model} disabled><option value={state.model}>{t('ask.modelName')}</option></select></label>
 <div><strong>{t('ask.key')}</strong><p>{t(state.configured?'ask.keyPresent':'ask.keyMissing')}</p></div>
 <label className="check-label"><input type="checkbox" checked={state.lookups} onChange={e=>setState({...state,lookups:e.target.checked})}/>{t('ask.lookups')}</label><p className="muted">{t('ask.workspaceConsentHint')}</p>
 <label>{t('ask.cap')}<input type="number" min="0" max="1000" step="0.01" required value={cap} onChange={e=>setCap(e.target.value)}/></label>
 <button className="primary">{t('ask.save')}</button></fieldset></form>
 <div><strong>{t('ask.month',{month:state.month})}</strong><p>{t('ask.usage',{cost:(state.usage.charge/1000000).toFixed(4),requests:state.usage.requests,pending:state.usage.pending})}</p></div>
 <div><button type="button" disabled={busy||!state.configured||!state.enabled} onClick={()=>void test()}>{t('ask.test')}</button><p className="muted">{t('ask.testHint')}</p></div>
 </>:<p>{t('common.loading')}</p>}
 <p className="muted">{t('ask.disclosure')}</p><details><summary>{t('ask.technical')}</summary><p>{t('ask.technicalHint')}</p></details>
 </section>
 <McpConnections workspaces={workspaces} currentUserId={currentUserId}/>
 </div>;
}
