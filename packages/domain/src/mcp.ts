/** Delegation is an intersection with current membership/capabilities, never another role. */
export const MCP_SCOPES = ['workspaces.read','procedures.read','procedures.write','runs.read','runs.write','lists.read','lists.write','recipes.read','recipes.write','lists.covers.write','todos.read','todos.write','calendar.read','calendar.write','notes.read','notes.write','gazette.read','gazette.write'] as const;
export type McpScope = typeof MCP_SCOPES[number];
export interface McpAuthorizationRequest {
  clientId: string; redirectUri: string; state: string | null; codeChallenge: string; scopes: McpScope[]; resource: string;
}
export interface McpGrant {
  id: string; userId: string; clientId: string; workspaceIds: string[]; scopes: McpScope[]; resource: string; createdAt: Date; expiresAt: Date; revokedAt: Date | null;
}

/**
 * Shape of an extra ChatGPT file host (36.25): exactly one label below OpenAI's file domain or Azure
 * Blob storage. Used for MCP_CHATGPT_FILE_HOSTS and for hosts a server admin allows in Server admin.
 * The shape is only a fence: a host still needs an exact entry to be contacted.
 */
export const CHATGPT_EXTRA_FILE_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:oaiusercontent\.com|blob\.core\.windows\.net)$/;
/** At most this many refused hosts are kept for review, and this many allowed in Server admin. */
export const MCP_FILE_HOST_LIMITS = { refused: 20, allowed: 20 } as const;
