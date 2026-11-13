import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { McpScope } from '@vergissmeinnicht/domain';
import { ORIGIN, startTestApp } from './test-harness.ts';

/** 36.22: Calendar and shared Notes through their own opt-in MCP scopes; the private Journal stays out of reach. */
describe('MCP Calendar and Notes', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  afterEach(async () => {
    await t?.close();
  });

  async function connect(cookie: string, workspaceIds: string[], scopes: McpScope[]) {
    const actor = await t.services.users.findById((await t.get('/api/auth/session', cookie)).json().user.id);
    if (!actor) throw new Error('Missing actor');
    const clientId = randomUUID();
    const redirectUri = 'https://client.example.org/callback';
    await t.services.mcp.registerClient(clientId, { client_name: 'Test assistant' });
    const requestId = await t.services.mcp.begin({ clientId, redirectUri, state: null, codeChallenge: 'a'.repeat(43), scopes, resource: ORIGIN + '/mcp' });
    const approved = await t.services.mcp.approve(actor, requestId, workspaceIds, scopes, true);
    const { access_token } = await t.services.mcp.exchange(clientId, String(new URL(approved).searchParams.get('code')), 'code', redirectUri, ORIGIN + '/mcp');
    const rpc = async (method: string, params: object = {}) => {
      const response = await t.app.inject({ method: 'POST', url: '/mcp', headers: { authorization: 'Bearer ' + access_token, accept: 'application/json, text/event-stream' }, payload: { jsonrpc: '2.0', id: 1, method, params } });
      expect(response.statusCode, response.body).toBe(200);
      return response.json().result;
    };
    const call = (name: string, args: object) => rpc('tools/call', { name, arguments: args }) as Promise<{ isError?: boolean; content: { text: string }[]; structuredContent?: { error: { code: string; message: string; fields?: string[] } } }>;
    const body = async (name: string, args: object) => {
      const result = await call(name, args);
      expect(result.isError, result.content[0]?.text).not.toBe(true);
      return JSON.parse(result.content[0]?.text ?? 'null');
    };
    const errorCode = async (name: string, args: object) => {
      const result = await call(name, args);
      expect(result.isError).toBe(true);
      return result.structuredContent?.error;
    };
    return { rpc, call, body, errorCode };
  }

  async function enable(workspaceId: string, tools: string[]) {
    for (const tool of tools) {
      const settings = (await t.get(`/api/workspaces/${workspaceId}/tools`, t.admin)).json();
      if (settings.tools.includes(tool)) continue;
      const response = await t.post(`/api/workspaces/${workspaceId}/tools`, { tool, enabled: true, expectedRevision: settings.revision }, t.admin);
      expect(response.statusCode, response.body).toBe(200);
    }
  }
  const today = () => new Date().toISOString().slice(0, 10);
  const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

  it('offers Calendar and Notes tools only to grants that include them', async () => {
    t = await startTestApp({ mcpEnabled: true });
    const workspaceId = await t.createWorkspace('Casa Nostra');
    const all = await connect(t.admin, [workspaceId], ['workspaces.read', 'calendar.read', 'calendar.write', 'notes.read', 'notes.write']);
    const names = ((await all.rpc('tools/list')).tools as { name: string }[]).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(['get_calendar', 'add_reminder', 'search_notes', 'get_note', 'create_note', 'update_note']));
    const lists = await connect(t.admin, [workspaceId], ['workspaces.read', 'lists.read']);
    const listNames = ((await lists.rpc('tools/list')).tools as { name: string }[]).map((tool) => tool.name);
    for (const name of ['get_calendar', 'add_reminder', 'search_notes', 'create_note']) expect(listNames).not.toContain(name);
    const reader = await connect(t.admin, [workspaceId], ['workspaces.read', 'calendar.read', 'notes.read']);
    const readNames = ((await reader.rpc('tools/list')).tools as { name: string }[]).map((tool) => tool.name);
    expect(readNames).toEqual(expect.arrayContaining(['get_calendar', 'search_notes', 'get_note']));
    expect(readNames).not.toContain('add_reminder');
    expect(readNames).not.toContain('update_note');
  });

  it('adds a Reminder once, even when retried, and shows it in the Calendar', async () => {
    t = await startTestApp({ mcpEnabled: true });
    const workspaceId = await t.createWorkspace('Casa Nostra');
    await enable(workspaceId, ['REMINDERS', 'CALENDAR']);
    const assistant = await connect(t.admin, [workspaceId], ['workspaces.read', 'calendar.read', 'calendar.write']);
    const request = { workspaceId, reminderId: randomUUID(), title: 'Dentist', date: inDays(3), time: '10:00', timeZone: 'Europe/Berlin' };
    const added = await assistant.body('add_reminder', request);
    expect(added).toMatchObject({ outcome: 'ADDED', duplicate: false, reminder: { title: 'Dentist', date: inDays(3), time: '10:00', timeZone: 'Europe/Berlin' } });
    expect(await assistant.body('add_reminder', request)).toMatchObject({ duplicate: true, reminder: { id: request.reminderId } });
    expect(await assistant.errorCode('add_reminder', { ...request, title: 'Barber' })).toMatchObject({ code: 'operation_reused' });
    const calendar = await assistant.body('get_calendar', { workspaceId, from: today(), to: inDays(7) });
    expect(calendar.entries.filter((entry: { title: string }) => entry.title === 'Dentist')).toEqual([expect.objectContaining({ kind: 'reminder', date: inDays(3), time: '10:00', state: 'OPEN', scheduleId: request.reminderId })]);
    // The web app sees the same one Reminder.
    const schedules = (await t.get(`/api/workspaces/${workspaceId}/schedules`, t.admin)).json().schedules as { title: string }[];
    expect(schedules.filter((schedule) => schedule.title === 'Dentist')).toHaveLength(1);
    expect(await assistant.errorCode('add_reminder', { ...request, reminderId: randomUUID(), date: '2020-01-01' })).toMatchObject({ code: 'invalid_value' });
    expect(await assistant.errorCode('get_calendar', { workspaceId, from: today(), to: inDays(400) })).toMatchObject({ code: 'invalid_value' });
  });

  it('refuses Reminders when the Reminders tool is off, and Calendar reads when the Calendar is off', async () => {
    t = await startTestApp({ mcpEnabled: true });
    const workspaceId = await t.createWorkspace('Casa Nostra');
    const settings = (await t.get(`/api/workspaces/${workspaceId}/tools`, t.admin)).json();
    for (const tool of ['REMINDERS', 'CALENDAR']) {
      const current = (await t.get(`/api/workspaces/${workspaceId}/tools`, t.admin)).json();
      if (current.tools.includes(tool)) await t.post(`/api/workspaces/${workspaceId}/tools`, { tool, enabled: false, expectedRevision: current.revision }, t.admin);
    }
    expect(settings).toBeDefined();
    const assistant = await connect(t.admin, [workspaceId], ['workspaces.read', 'calendar.read', 'calendar.write']);
    expect(await assistant.errorCode('add_reminder', { workspaceId, reminderId: randomUUID(), title: 'Dentist', date: inDays(3), time: null, timeZone: 'Europe/Berlin' })).toMatchObject({ code: 'tool_disabled' });
    expect(await assistant.errorCode('get_calendar', { workspaceId, from: today(), to: inDays(7) })).toMatchObject({ code: 'tool_disabled' });
  });

  it('creates, finds, appends to and edits shared Notes in Markdown, and never touches the private Journal', async () => {
    t = await startTestApp({ mcpEnabled: true });
    const workspaceId = await t.createWorkspace('Casa Nostra');
    await enable(workspaceId, ['JOURNAL']);
    const assistant = await connect(t.admin, [workspaceId], ['workspaces.read', 'notes.read', 'notes.write']);
    const noteId = randomUUID();
    const request = { workspaceId, noteId, title: 'Garden', markdown: '## Beds\n\n- Tomatoes', notebook: 'House', tags: ['garden'] };
    const created = await assistant.body('create_note', request);
    expect(created).toMatchObject({ outcome: 'CREATED', duplicate: false, note: { id: noteId, title: 'Garden', notebook: 'House', tags: ['garden'], markdown: '## Beds\n\n- Tomatoes', revision: 1 } });
    expect((await assistant.body('create_note', request)).duplicate).toBe(true);
    expect(await assistant.errorCode('create_note', { ...request, markdown: 'Other' })).toMatchObject({ code: 'operation_reused' });

    const found = await assistant.body('search_notes', { workspaceId, query: 'tomatoes' });
    expect(found.notes.map((note: { id: string }) => note.id)).toEqual([noteId]);
    const appended = await assistant.body('update_note', { workspaceId, noteId, expectedRevision: 1, appendMarkdown: '- Basil' });
    expect(appended.note).toMatchObject({ revision: 2, markdown: '## Beds\n\n- Tomatoes\n\n- Basil', title: 'Garden', notebook: 'House', tags: ['garden'] });
    expect(await assistant.errorCode('update_note', { workspaceId, noteId, expectedRevision: 1, title: 'Old revision' })).toMatchObject({ code: 'stale_revision' });
    expect(await assistant.errorCode('update_note', { workspaceId, noteId, expectedRevision: 2, markdown: 'x', appendMarkdown: 'y' })).toMatchObject({ code: 'invalid_value' });
    const renamed = await assistant.body('update_note', { workspaceId, noteId, expectedRevision: 2, title: 'Garden plan', pinned: true });
    expect(renamed.note).toMatchObject({ title: 'Garden plan', pinned: true, markdown: '## Beds\n\n- Tomatoes\n\n- Basil' });
    // The web app reads the same Note.
    const web = await t.get(`/api/workspaces/${workspaceId}/journal/${noteId}`, t.admin);
    expect(web.statusCode, web.body).toBe(200);

    // A private Journal entry exists but is unreachable through these tools.
    expect((await t.post('/api/account/journal/privacy', { version: 1 }, t.admin)).statusCode).toBeLessThan(300);
    const privateEntry = await t.post('/api/account/journal', { content: { kind: 'note', version: 2, title: 'Secret diary', date: null, body: 'Private tomatoes' }, expectedRevision: 0, archived: false }, t.admin);
    expect(privateEntry.statusCode, privateEntry.body).toBeLessThan(300);
    const privateId = privateEntry.json().entry?.id ?? privateEntry.json().id;
    expect((await assistant.body('search_notes', { workspaceId, query: 'Private' })).notes).toEqual([]);
    expect(await assistant.errorCode('get_note', { workspaceId, noteId: privateId })).toMatchObject({ code: 'not_found' });
    expect(await assistant.errorCode('update_note', { workspaceId, noteId: privateId, expectedRevision: 1, appendMarkdown: 'x' })).toMatchObject({ code: 'not_found' });
  });
});
