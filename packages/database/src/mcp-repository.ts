import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { MCP_SCOPES, type McpAuthorizationRequest, type McpGrant, type McpScope, type User } from '@vergissmeinnicht/domain';
import { NotAuthorizedError } from '@vergissmeinnicht/application';
import type { AppDatabase } from './connection.ts';
import { IMMEDIATE, type Transaction } from './actor-guard.ts';
import { mcpClients, mcpAuthorizationRequests, mcpGrants, mcpTokens, memberships, users } from './schema.ts';
import { recordSecurityEvent } from './security-events.ts';
export class McpCredentialError extends Error { readonly code:'invalid_grant'|'invalid_client'|'invalid_scope'|'temporarily_unavailable'; constructor(code:McpCredentialError['code']){super(code);this.code=code;} }
export const hashMcpToken = (value:string) => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const reject = ():never=>{throw new McpCredentialError('invalid_grant');};
const active = (tx:Pick<Transaction,'select'>,id:string) => tx.select({id:users.id}).from(users).where(and(eq(users.id,id as User['id']),eq(users.status,'ACTIVE'))).get()!==undefined;
export function createMcpRepository({db}:AppDatabase,resource:string){
 const validGrant=(tx:Pick<Transaction,'select'>,id:string):McpGrant|undefined=>{
  const grant=tx.select().from(mcpGrants).where(and(eq(mcpGrants.id,id),isNull(mcpGrants.revokedAt),gt(mcpGrants.expiresAt,new Date()))).get();
  return grant&&grant.resource===resource&&active(tx,grant.userId)?grant:undefined;
 };
 const issue=(tx:Transaction,grant:McpGrant)=>{
  const access=token(),refresh=token();const now=Date.now();
  tx.delete(mcpTokens).where(sql`${mcpTokens.expiresAt} < ${now-86400000}`).run();
  tx.insert(mcpTokens).values([{hash:hashMcpToken(access),grantId:grant.id,kind:'access',expiresAt:new Date(Math.min(now+15*60000,grant.expiresAt.getTime()))},{hash:hashMcpToken(refresh),grantId:grant.id,kind:'refresh',expiresAt:new Date(Math.min(now+30*86400000,grant.expiresAt.getTime()))}]).run();
  return {access_token:access,token_type:'Bearer' as const,expires_in:Math.floor((Math.min(now+15*60000,grant.expiresAt.getTime())-now)/1000),refresh_token:refresh,scope:grant.scopes.join(' ')};
 };
 return {
  resource,
  async registerClient(id:string,metadata:Record<string,unknown>){
   db.transaction(tx=>{if((tx.select({n:sql<number>`count(*)`}).from(mcpClients).get()?.n??0)>=1000)throw new McpCredentialError('temporarily_unavailable');tx.insert(mcpClients).values({id,metadata}).run();},IMMEDIATE);
  },
  async client(id:string){return db.select().from(mcpClients).where(eq(mcpClients.id,id)).get()?.metadata;},
  async begin(params:McpAuthorizationRequest){
   if(params.resource!==resource||params.scopes.some(scope=>!MCP_SCOPES.includes(scope))||!/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge))throw new McpCredentialError('invalid_scope');
   return db.transaction(tx=>{
    const now=new Date();tx.delete(mcpAuthorizationRequests).where(sql`${mcpAuthorizationRequests.expiresAt}<${now.getTime()}`).run();
    if((tx.select({n:sql<number>`count(*)`}).from(mcpAuthorizationRequests).get()?.n??0)>=1000)throw new McpCredentialError('temporarily_unavailable');
    const id=randomUUID();tx.insert(mcpAuthorizationRequests).values({id,clientId:params.clientId,params,expiresAt:new Date(now.getTime()+10*60000)}).run();return id;
   },IMMEDIATE);
  },
  async request(actor:User,id:string){
   if(!active(db,actor.id))throw new NotAuthorizedError();
   const row=db.select().from(mcpAuthorizationRequests).where(and(eq(mcpAuthorizationRequests.id,id),isNull(mcpAuthorizationRequests.usedAt),gt(mcpAuthorizationRequests.expiresAt,new Date()))).get();if(!row)return reject();
   const client=db.select().from(mcpClients).where(eq(mcpClients.id,row.clientId)).get();if(!client)return reject();
   return {id:row.id,clientName:String(client.metadata['client_name']??'MCP client'),redirectOrigin:new URL(row.params.redirectUri).origin,scopes:row.params.scopes,expiresAt:row.expiresAt};
  },
  async approve(actor:User,id:string,workspaceIds:string[],scopes:McpScope[],allow:boolean){
   return db.transaction(tx=>{
    if(!active(tx,actor.id))throw new NotAuthorizedError();
    const row=tx.select().from(mcpAuthorizationRequests).where(and(eq(mcpAuthorizationRequests.id,id),isNull(mcpAuthorizationRequests.usedAt),gt(mcpAuthorizationRequests.expiresAt,new Date()))).get();if(!row)return reject();
    const redirect=new URL(row.params.redirectUri);if(row.params.state!==null)redirect.searchParams.set('state',row.params.state);
    if(!allow){tx.update(mcpAuthorizationRequests).set({usedAt:new Date()}).where(eq(mcpAuthorizationRequests.id,id)).run();redirect.searchParams.set('error','access_denied');return redirect.href;}
    if(workspaceIds.length<1||workspaceIds.length>32||new Set(workspaceIds).size!==workspaceIds.length||scopes.length<1||scopes.some(scope=>!row.params.scopes.includes(scope))||new Set(scopes).size!==scopes.length)return reject();
    for(const workspaceId of workspaceIds)if(!tx.select().from(memberships).where(and(eq(memberships.userId,actor.id),eq(memberships.workspaceId,workspaceId))).get())throw new NotAuthorizedError();
    if((tx.select({n:sql<number>`count(*)`}).from(mcpGrants).where(and(eq(mcpGrants.userId,actor.id),isNull(mcpGrants.revokedAt),gt(mcpGrants.expiresAt,new Date()))).get()?.n??0)>=30)throw new McpCredentialError('temporarily_unavailable');
    const grantId=randomUUID(),code=token(),now=new Date();
    tx.insert(mcpGrants).values({id:grantId,userId:actor.id,clientId:row.clientId,workspaceIds,scopes,resource,expiresAt:new Date(now.getTime()+90*86400000)}).run();
    tx.insert(mcpTokens).values({hash:hashMcpToken(code),grantId,kind:'code',codeChallenge:row.params.codeChallenge,redirectUri:row.params.redirectUri,expiresAt:new Date(now.getTime()+5*60000)}).run();
    tx.update(mcpAuthorizationRequests).set({usedAt:now}).where(eq(mcpAuthorizationRequests.id,id)).run();
    recordSecurityEvent(tx,{type:'MCP_CONNECTION_CHANGED',actor:{kind:'user',userId:actor.id,displayName:actor.displayName},subjectType:'user',subjectId:actor.id,occurredAt:now,metadata:{action:'authorize',grantId,clientId:row.clientId}});
    redirect.searchParams.set('code',code);return redirect.href;
   },IMMEDIATE);
  },
  async challenge(clientId:string,code:string){
   const row=db.select().from(mcpTokens).where(and(eq(mcpTokens.hash,hashMcpToken(code)),eq(mcpTokens.kind,'code'),gt(mcpTokens.expiresAt,new Date()))).get();
   const grant=row?validGrant(db,row.grantId):undefined;if(!row||!grant||grant.clientId!==clientId||!row.codeChallenge)return reject();return row.codeChallenge;
  },
  async exchange(clientId:string,raw:string,kind:'code'|'refresh',redirectUri:string|undefined,requestedResource:string|undefined,scopes?:string[]){
   const result=db.transaction(tx=>{
    const row=tx.select().from(mcpTokens).where(and(eq(mcpTokens.hash,hashMcpToken(raw)),eq(mcpTokens.kind,kind),gt(mcpTokens.expiresAt,new Date()))).get();
    const grant=row?validGrant(tx,row.grantId):undefined;
    if(!row||!grant||grant.clientId!==clientId||(requestedResource!==undefined&&requestedResource!==resource)||(kind==='code'&&redirectUri!==row.redirectUri)||(scopes!==undefined&&(scopes.length!==grant.scopes.length||scopes.some(scope=>!grant.scopes.includes(scope as McpScope)))))return undefined;
    // Commit replay revocation before returning the refusal; throwing inside would roll it back.
    if(row.usedAt!==null){tx.update(mcpGrants).set({revokedAt:new Date()}).where(eq(mcpGrants.id,grant.id)).run();return undefined;}
    tx.update(mcpTokens).set({usedAt:new Date()}).where(eq(mcpTokens.hash,row.hash)).run();return issue(tx,grant);
   },IMMEDIATE);
   if(!result)return reject();return result;
  },
  async verify(raw:string){
   if(!/^[A-Za-z0-9_-]{43}$/.test(raw))return reject();
   const row=db.select().from(mcpTokens).where(and(eq(mcpTokens.hash,hashMcpToken(raw)),eq(mcpTokens.kind,'access'),isNull(mcpTokens.usedAt),gt(mcpTokens.expiresAt,new Date()))).get();const grant=row?validGrant(db,row.grantId):undefined;
   if(!row||!grant)return reject();return {grant,expiresAt:row.expiresAt};
  },
  async connections(actor:User){
   if(!active(db,actor.id))throw new NotAuthorizedError();
   return db.select().from(mcpGrants).where(eq(mcpGrants.userId,actor.id)).all().map(grant=>({id:grant.id,clientName:String(db.select().from(mcpClients).where(eq(mcpClients.id,grant.clientId)).get()?.metadata['client_name']??'MCP client'),workspaceIds:grant.workspaceIds,scopes:grant.scopes,expiresAt:grant.expiresAt,revokedAt:grant.revokedAt,
    tokenIssued:db.select({present:sql<number>`1`}).from(mcpTokens).where(and(eq(mcpTokens.grantId,grant.id),eq(mcpTokens.kind,'refresh'))).get()!==undefined,
   }));
  },
  async revokeOwned(actor:User,id:string){
   db.transaction(tx=>{if(!active(tx,actor.id))throw new NotAuthorizedError();const row=tx.select().from(mcpGrants).where(and(eq(mcpGrants.id,id),eq(mcpGrants.userId,actor.id))).get();if(!row)throw new NotAuthorizedError();tx.update(mcpGrants).set({revokedAt:new Date()}).where(eq(mcpGrants.id,id)).run();recordSecurityEvent(tx,{type:'MCP_CONNECTION_CHANGED',actor:{kind:'user',userId:actor.id,displayName:actor.displayName},subjectType:'user',subjectId:actor.id,occurredAt:new Date(),metadata:{action:'revoke',grantId:id}});},IMMEDIATE);
  },
  async revokeToken(clientId:string,raw:string){db.transaction(tx=>{const row=tx.select().from(mcpTokens).where(eq(mcpTokens.hash,hashMcpToken(raw))).get();if(!row)return;const grant=tx.select().from(mcpGrants).where(eq(mcpGrants.id,row.grantId)).get();if(grant?.clientId===clientId)tx.update(mcpGrants).set({revokedAt:new Date()}).where(eq(mcpGrants.id,grant.id)).run();},IMMEDIATE);},
  async authorize(grantId:string,actorId:string,workspaceId:string|undefined,scope:McpScope){
   const grant=validGrant(db,grantId);if(!grant||grant.userId!==actorId||!grant.scopes.includes(scope)||(workspaceId!==undefined&&!grant.workspaceIds.includes(workspaceId)))throw new NotAuthorizedError();return grant;
  },
 };
}
export type McpRepository=ReturnType<typeof createMcpRepository>;
