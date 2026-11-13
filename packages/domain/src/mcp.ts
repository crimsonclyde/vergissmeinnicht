/** Delegation is an intersection with current membership/capabilities, never another role. */
export const MCP_SCOPES = ['workspaces.read','procedures.read','procedures.write','runs.read','runs.write','lists.read','lists.write','recipes.read','recipes.write','lists.covers.write','todos.read','todos.write'] as const;
export type McpScope = typeof MCP_SCOPES[number];
export interface McpAuthorizationRequest {
  clientId: string; redirectUri: string; state: string | null; codeChallenge: string; scopes: McpScope[]; resource: string;
}
export interface McpGrant {
  id: string; userId: string; clientId: string; workspaceIds: string[]; scopes: McpScope[]; resource: string; createdAt: Date; expiresAt: Date; revokedAt: Date | null;
}
