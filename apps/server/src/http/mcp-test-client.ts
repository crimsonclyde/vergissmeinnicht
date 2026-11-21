import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import type { McpScope } from '@vergissmeinnicht/domain';
import { ORIGIN, type startTestApp } from './test-harness.ts';

type TestApp = Awaited<ReturnType<typeof startTestApp>>;
export interface ToolResult { isError?: boolean; content: { text: string }[]; structuredContent?: { error: { code: string; message: string; fields?: string[] } } }

/** An approved MCP connection of the signed-in person `cookie` (48): list and call tools as an assistant would. */
export async function connectAssistant(t: TestApp, cookie: string, workspaceIds: string[], scopes: McpScope[], clientName = 'Test assistant') {
  const actor = await t.services.users.findById((await t.get('/api/auth/session', cookie)).json().user.id);
  if (!actor) throw new Error('Missing actor');
  const clientId = randomUUID();
  const redirectUri = 'https://client.example.org/callback';
  await t.services.mcp.registerClient(clientId, { client_name: clientName });
  const requestId = await t.services.mcp.begin({ clientId, redirectUri, state: null, codeChallenge: 'a'.repeat(43), scopes, resource: ORIGIN + '/mcp' });
  const approved = await t.services.mcp.approve(actor, requestId, workspaceIds, scopes, true);
  const { access_token } = await t.services.mcp.exchange(clientId, String(new URL(approved).searchParams.get('code')), 'code', redirectUri, ORIGIN + '/mcp');
  const rpc = async (method: string, params: object = {}) => {
    const response = await t.app.inject({ method: 'POST', url: '/mcp', headers: { authorization: 'Bearer ' + access_token, accept: 'application/json, text/event-stream' }, payload: { jsonrpc: '2.0', id: 1, method, params } });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().result;
  };
  const call = (name: string, args: object) => rpc('tools/call', { name, arguments: args }) as Promise<ToolResult>;
  const body = async (name: string, args: object) => {
    const result = await call(name, args);
    expect(result.isError, result.content[0]?.text).not.toBe(true);
    return JSON.parse(result.content[0]?.text ?? 'null');
  };
  const error = async (name: string, args: object) => {
    const result = await call(name, args);
    expect(result.isError, result.content[0]?.text).toBe(true);
    return result.structuredContent?.error;
  };
  const tools = async () => ((await rpc('tools/list')).tools as { name: string; annotations?: { destructiveHint?: boolean; readOnlyHint?: boolean } }[]);
  return { rpc, call, body, error, tools, clientId };
}

/** Switches the given tools on in a Workspace (as its admin). */
export async function enableTools(t: TestApp, workspaceId: string, tools: string[]) {
  for (const tool of tools) {
    const settings = (await t.get(`/api/workspaces/${workspaceId}/tools`, t.admin)).json();
    if (settings.tools.includes(tool)) continue;
    const response = await t.post(`/api/workspaces/${workspaceId}/tools`, { tool, enabled: true, expectedRevision: settings.revision }, t.admin);
    expect(response.statusCode, response.body).toBe(200);
  }
}

export const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
