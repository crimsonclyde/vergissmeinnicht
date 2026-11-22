import {describe,expect,it} from 'vitest';
import {createAskOpenAI} from './ask-openai.ts';
import {Secret} from '../config/secret.ts';
const signal=()=>{const controller=new AbortController();return {controller,cancellation:{get aborted(){return controller.signal.aborted;},onAbort:(listener:()=>void)=>{controller.signal.addEventListener('abort',listener);return()=>controller.signal.removeEventListener('abort',listener);}}};};
const event=(type:string,values:object)=>'data: '+JSON.stringify({type,...values})+'\n\n';
const answer=(output:unknown[]=[],usage:unknown={input_tokens:40,output_tokens:5})=>event('response.output_text.delta',{delta:'Ciao Gianni!'})+event('response.completed',{response:{status:'completed',output,usage}});
describe('bounded OpenAI Responses stream adapter',()=>{
 it('uses only fixed HTTPS Responses endpoint, dedicated key, store false and bounded output; streams fragmented UTF-8',async()=>{
  const {cancellation}=signal();let payload:Record<string,unknown>={};const chunks:string[]=[];
  const provider=createAskOpenAI(new Secret('test-key-never-log'),async(url,options)=>{
   expect(String(url)).toBe('https://api.openai.com/v1/responses');expect(options?.redirect).toBe('error');expect(options?.headers).toMatchObject({authorization:'Bearer test-key-never-log'});payload=JSON.parse(String(options?.body));
   const bytes=new TextEncoder().encode(answer());return new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=7)controller.enqueue(bytes.slice(i,i+7));controller.close();}}));
  });
  const result=await provider.respond([{role:'user',content:'hello'}],false,cancellation,value=>chunks.push(value));
  expect(result).toMatchObject({text:'Ciao Gianni!',usage:{input:40,output:5}});expect(chunks.join('')).toBe('Ciao Gianni!');expect(payload).toMatchObject({model:'gpt-5.4-mini-2026-03-17',service_tier:'default',store:false,max_output_tokens:2048,stream:true,reasoning:{effort:'none'},tools:[]});
  expect(JSON.stringify(provider)).not.toContain('test-key');
 });
 it('exposes one read-only lookup and refuses arbitrary tool names, oversized arguments and excess calls',async()=>{
  const call={type:'function_call',name:'search_records',call_id:'call_1',arguments:'{"query":"oven"}'};
  let output:unknown[]=[call];const provider=createAskOpenAI(new Secret('test'),async(_url,options)=>{expect(JSON.parse(String(options?.body)).tools).toHaveLength(1);return new Response(answer(output));});
  expect(await provider.respond([],true,signal().cancellation,()=>{throw new Error('lookup text must not stream');})).toMatchObject({query:'oven',callId:'call_1'});
  for(const invalid of [[{...call,name:'delete_note'}],[call,call],[{...call,arguments:JSON.stringify({query:'x'.repeat(121)})}]]){output=invalid;await expect(provider.respond([],true,signal().cancellation,()=>{})).rejects.toThrow();}
 });
 it('rejects provider failures, redirects, truncated and oversized streams; missing usage stays unknown',async()=>{
  for(const body of ['invalid',event('response.failed',{response:{error:{message:'SECRET'}}}),'x'.repeat(260000),event('response.output_text.delta',{delta:'Partial'})+event('response.incomplete',{response:{status:'incomplete',output:[],usage:{input_tokens:5,output_tokens:2048}}}),event('response.completed',{response:{status:'completed',output:[],usage:{input_tokens:5,output_tokens:0}}})]){
   const provider=createAskOpenAI(new Secret('test'),async()=>new Response(body));await expect(provider.respond([],false,signal().cancellation,()=>{})).rejects.toThrow();
  }
  const frame=event('ignored',{padding:'x'.repeat(9000)});
  const oversized=createAskOpenAI(new Secret('test'),async()=>new Response(new ReadableStream({start(controller){for(let i=0;i<120;i++)controller.enqueue(new TextEncoder().encode(frame));controller.enqueue(new TextEncoder().encode(answer()));controller.close();}})));
  await expect(oversized.respond([],false,signal().cancellation,()=>{})).rejects.toThrow('ask_provider_failed');
  const unknown=createAskOpenAI(new Secret('test'),async()=>new Response(answer([],null)));expect((await unknown.respond([],false,signal().cancellation,()=>{})).usage).toBeNull();
  let cancelled=false;const denied=createAskOpenAI(new Secret('test'),async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('SECRET'));},cancel(){cancelled=true;}}),{status:401}));await expect(denied.respond([],false,signal().cancellation,()=>{})).rejects.toThrow('ask_provider_failed');expect(cancelled).toBe(true);
 });
 it('propagates cancellation without consuming provider diagnostics',async()=>{
  const {controller,cancellation}=signal();const provider=createAskOpenAI(new Secret('test'),async(_url,options)=>new Promise((_resolve,reject)=>{options?.signal?.addEventListener('abort',()=>reject(new Error('aborted upstream')));controller.abort();}));
  await expect(provider.respond([],false,cancellation,()=>{})).rejects.toThrow('ask_provider_failed');
 });
});
