import { AsyncLocalStorage } from 'node:async_hooks';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { WorkspaceTool, McpScope } from '@vergissmeinnicht/domain';
import type { Transaction } from './actor-guard.ts';
import { mcpGrants, mcpTokens } from './schema.ts';
export interface DelegationContext { grantId:string; clientId:string; userId:string; tokenHash:string; scope:McpScope; tool:WorkspaceTool|null; additionalScopes?:readonly McpScope[]; additionalTools?:readonly WorkspaceTool[] }
const storage=new AsyncLocalStorage<DelegationContext>();
export const currentDelegation=()=>storage.getStore();
export const withDelegation=<T>(context:DelegationContext,action:()=>T):T=>storage.run(context,action);
/** Rechecked under the same IMMEDIATE transaction as the actual application mutation. */
export function delegationAllows(tx:Pick<Transaction,'select'>,userId:string,workspaceId:string,tool:WorkspaceTool|undefined):boolean {
 const context=storage.getStore();if(!context)return true;
 if(context.userId!==userId||(context.tool!==tool&&!context.additionalTools?.includes(tool as WorkspaceTool)))return false;
 const now=new Date();const grant=tx.select().from(mcpGrants).where(and(eq(mcpGrants.id,context.grantId),eq(mcpGrants.userId,userId),eq(mcpGrants.clientId,context.clientId),isNull(mcpGrants.revokedAt),gt(mcpGrants.expiresAt,now))).get();
 const access=tx.select().from(mcpTokens).where(and(eq(mcpTokens.hash,context.tokenHash),eq(mcpTokens.grantId,context.grantId),eq(mcpTokens.kind,'access'),isNull(mcpTokens.usedAt),gt(mcpTokens.expiresAt,now))).get();
 return !!grant&&!!access&&grant.workspaceIds.includes(workspaceId)&&grant.scopes.includes(context.scope)&&(context.additionalScopes??[]).every(scope=>grant.scopes.includes(scope));
}
