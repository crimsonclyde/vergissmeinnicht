import {useEffect,useRef,useState} from 'react';
import {api,messageFor} from '../../api.ts';
export function RecipeImageGenerator({workspaceId,onInsert}:{workspaceId:string;onInsert:(markdown:string)=>void}){
 const [enabled,setEnabled]=useState(false),[prompt,setPrompt]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const [operation,setOperation]=useState<{id:string;prompt:string}|null>(null);
 useEffect(()=>{let active=true;api.recipeImageStatus(workspaceId).then(result=>{if(active)setEnabled(result.enabled);},()=>undefined);return()=>{active=false;};},[workspaceId]);
 if(!enabled)return null;
 async function generate(){setBusy(true);setMessage('');const attempt=operation??{id:crypto.randomUUID(),prompt};setOperation(attempt);try{const result=await api.generateRecipeImage(workspaceId,attempt.id,attempt.prompt);if(!alive.current)return;if(result.attachment){onInsert(`![AI-generated recipe illustration](attachments/${result.attachment.id}.png)`);setMessage('AI image added. Save the Recipe to keep it with your instructions.');}else{setMessage('Image generation has no confirmed result. It may have been charged. This request will not generate another image when retried.');}}catch(error){setMessage(messageFor(error)+' Retry checks the same request; it never starts another paid generation.');}finally{setBusy(false);}}
 return <fieldset disabled={busy}><legend>Create an AI recipe image</legend><p>Uses this server’s OpenAI API project and may incur charges. Only the image description below is sent to OpenAI. The returned original is preserved.</p><label>Image description<textarea maxLength={2000} value={prompt} disabled={operation!==null} onChange={event=>setPrompt(event.target.value)}/></label><button type="button" disabled={!prompt.trim()} onClick={()=>void generate()}>{busy?'Creating image…':operation?'Check this image request':'Create AI image'}</button>{message&&<p role="status">{message}</p>}</fieldset>;
}
