import {useEffect,useState} from 'react';
import {askApi,messageFor} from './api.ts';
import {t} from './i18n/index.ts';
export function AskWorkspacePolicy({workspaceId}:{workspaceId:string}){
 const [state,setState]=useState<{enabled:boolean;canManage:boolean}>();const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 useEffect(()=>{let live=true;askApi.policy(workspaceId).then(value=>{if(live)setState(value);},error=>{if(live)setError(messageFor(error));});return()=>{live=false;};},[workspaceId]);
 async function change(enabled:boolean){setBusy(true);try{const saved=await askApi.setPolicy(workspaceId,enabled);setState(saved);setError('');}catch(error){setError(messageFor(error));}finally{setBusy(false);}}
 return <section className="card stack"><h3>{t('ask.title')}</h3><p>{t('ask.policyHint')}</p>{state?.canManage&&<label className="check-label"><input type="checkbox" checked={state.enabled} disabled={busy} onChange={event=>void change(event.target.checked)}/>{t('ask.policy')}</label>}{error&&<p role="alert">{error}</p>}</section>;
}
