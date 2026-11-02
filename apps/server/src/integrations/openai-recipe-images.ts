import type {RecipeImageProvider} from '@vergissmeinnicht/application';
/** Fixed destination, model, size and quality. No remote source images, retries or user-chosen host. */
export function openAiRecipeImages(key:string,fetcher:typeof fetch=fetch):RecipeImageProvider{
 return {model:'gpt-image-1.5',async generate(prompt){
  const response=await fetcher('https://api.openai.com/v1/images/generations',{method:'POST',redirect:'error',signal:AbortSignal.timeout(90000),headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({model:'gpt-image-1.5',n:1,size:'1024x1024',quality:'low',output_format:'png',prompt:'Create a food photograph illustrating this recipe. No text or branding. User recipe description:\n'+prompt})});
  if(!response.ok||!response.body)throw new Error('Image provider request failed');
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let length=0;
  try{for(;;){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>12*1024*1024)throw new Error('Image provider response too large');chunks.push(part.value);}}finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
  const data:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8'));const images=typeof data==='object'&&data!==null&&'data' in data?data.data:undefined;
  if(!Array.isArray(images)||images.length!==1)throw new Error('Invalid image response');const encoded:unknown=images[0]?.b64_json;
  if(typeof encoded!=='string'||encoded.length<1||encoded.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw new Error('Invalid image response');
  const image=Buffer.from(encoded,'base64');if(image.byteLength>8*1024*1024||!image.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('Invalid image response');return image;
 }};
}
