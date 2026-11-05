import {InvalidRequestError} from '../http/errors.ts';
import { randomUUID } from 'node:crypto';
import type { OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import { InvalidClientMetadataError, InvalidGrantError, InvalidScopeError, TemporarilyUnavailableError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { createOAuthMetadata, mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { McpCredentialError } from '@vergissmeinnicht/database';
import { MCP_SCOPES, type McpScope } from '@vergissmeinnicht/domain';
import type { FastifyInstance } from 'fastify';
import type { AppServices } from '../composition.ts';

/** SDK owns OAuth protocol parsing, PKCE verification, client and redirect validation. */
export function createMcpOAuth(services:AppServices){
 const repository=services.mcp;
 const translated=async<T>(action:()=>Promise<T>):Promise<T>=>{try{return await action();}catch(error){if(error instanceof McpCredentialError){if(error.code==='invalid_scope')throw new InvalidScopeError('Unsupported scopes');if(error.code==='temporarily_unavailable')throw new TemporarilyUnavailableError('Request limit reached');throw new InvalidGrantError('Invalid or expired credential');}throw error;}};
 const provider:OAuthServerProvider={
  clientsStore:{
   getClient:async id=>await repository.client(id) as OAuthClientInformationFull|undefined,
   registerClient:async client=>{
    if(client.token_endpoint_auth_method!=='none'||!client.redirect_uris.length||client.redirect_uris.length>5||String(client.client_name??'').length>80)throw new InvalidClientMetadataError('Public clients with PKCE are required');
    for(const redirect of client.redirect_uris){const url=new URL(redirect);if(url.hash||url.username||url.password||url.href.length>2048||(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))))throw new InvalidClientMetadataError('Invalid redirect URI');}
    const metadata:OAuthClientInformationFull={client_id:randomUUID(),client_id_issued_at:Math.floor(Date.now()/1000),client_name:String(client.client_name??'MCP client'),redirect_uris:client.redirect_uris,token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']};
    await translated(()=>repository.registerClient(metadata.client_id,metadata as unknown as Record<string,unknown>));return metadata;
   },
  },
  authorize:async(client,params,response)=>{
   const requested=params.scopes?.length?params.scopes:[...MCP_SCOPES];
   if(requested.some(scope=>!MCP_SCOPES.includes(scope as McpScope)))throw new InvalidScopeError('Unsupported scopes');
   const id=await translated(()=>repository.begin({clientId:client.client_id,redirectUri:params.redirectUri,state:params.state??null,codeChallenge:params.codeChallenge,scopes:requested as McpScope[],resource:params.resource?.href??repository.resource}));
   response.redirect(services.publicOrigin+'/account/connections?request='+encodeURIComponent(id));
  },
  challengeForAuthorizationCode:(client,code)=>translated(()=>repository.challenge(client.client_id,code)),
  exchangeAuthorizationCode:(client,code,_verifier,redirect,resource)=>translated(()=>repository.exchange(client.client_id,code,'code',redirect,resource?.href)),
  exchangeRefreshToken:(client,refresh,scopes,resource)=>translated(()=>repository.exchange(client.client_id,refresh,'refresh',undefined,resource?.href,scopes)),
  verifyAccessToken:async raw=>{const {grant,expiresAt}=await translated(()=>repository.verify(raw));return {token:raw,clientId:grant.clientId,scopes:grant.scopes,expiresAt:Math.floor(expiresAt.getTime()/1000),resource:new URL(grant.resource),extra:{grantId:grant.id,userId:grant.userId}};},
  revokeToken:(client,request)=>repository.revokeToken(client.client_id,request.token),
 };
 return provider;
}

/** Browser cookie routes keep the existing CSRF policy; only these machine endpoints use OAuth. */
export async function registerMcpOAuth(app:FastifyInstance,services:AppServices){
 const provider=createMcpOAuth(services);const issuerUrl=new URL(services.publicOrigin);const resourceServerUrl=new URL(services.mcp.resource);
 const options={provider,issuerUrl,resourceServerUrl,scopesSupported:[...MCP_SCOPES],resourceName:'VergissMeinNicht'};
 const metadata={...createOAuthMetadata(options),token_endpoint_auth_methods_supported:['none'],revocation_endpoint_auth_methods_supported:['none']};
 const oauth=mcpAuthRouter({...options,clientRegistrationOptions:{rateLimit:false},tokenOptions:{rateLimit:false},authorizationOptions:{rateLimit:false},revocationOptions:{rateLimit:false}});
 await app.register(async machine=>{
  machine.addContentTypeParser('application/x-www-form-urlencoded',{parseAs:'string'},(_request,body,done)=>{
   const input=new URLSearchParams(String(body));const parsed:Record<string,string>={};for(const [key,value]of input){if(Object.hasOwn(parsed,key)){done(new InvalidRequestError());return;}parsed[key]=value;}done(null,parsed);
  });
  machine.get('/.well-known/oauth-authorization-server',{config:{mcpProtocol:true}},async()=>metadata);
  // RFC 8414 issuer identifiers must match exactly, including the SDK's root trailing slash.
  machine.get('/.well-known/oauth-protected-resource/mcp',{config:{mcpProtocol:true}},async()=>({resource:services.mcp.resource,authorization_servers:[metadata.issuer],scopes_supported:[...MCP_SCOPES],resource_name:'VergissMeinNicht'}));
  for(const [method,url]of [['GET','/authorize'],['POST','/token'],['POST','/register'],['POST','/revoke']] as const){
   machine.route({method,url,bodyLimit:16*1024,config:{mcpProtocol:true,rateLimit:{max:url==='/register'?20:100,timeWindow:15*60000}},handler:async(request,reply)=>{
    // SDK router owns protocol validation; Fastify owns parsing, limits and the response.
    // Do not let Express replace ServerResponse prototypes (breaks Fastify injection/hooks).
    const headers={...request.headers};delete headers['content-length'];delete headers['transfer-encoding'];
    const incoming=Object.assign(request.raw,{headers,body:request.body,query:request.query,ip:request.ip});
    return await new Promise<unknown>((resolve,reject)=>{
     const outgoing={
      status(code:number){reply.code(code);return outgoing;},
      setHeader(key:string,value:string){reply.header(key,value);return outgoing;},
      getHeader(key:string){return reply.getHeader(key);},
      set(key:string,value:string){reply.header(key,value);return outgoing;},
      json(value:unknown){resolve(value);return outgoing;},
      end(){resolve('');return outgoing;},
      redirect(codeOrUrl:number|string,url?:string){reply.code(typeof codeOrUrl==='number'?codeOrUrl:302).header('Location',url??String(codeOrUrl));resolve('');return outgoing;},
     };
     reply.header('Cache-Control','no-store');
     oauth(incoming,outgoing as unknown as Parameters<typeof oauth>[1],(error?:unknown)=>error?reject(error):reject(new Error('OAuth endpoint not handled')));
    });
   }});
  }
 });
}
