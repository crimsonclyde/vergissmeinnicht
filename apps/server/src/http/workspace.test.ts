import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapServerAdmin, type EmailMessage } from '@vergissmeinnicht/application';
import { createTestDatabase } from '@vergissmeinnicht/database/test-support';
import { normalizeEmail } from '@vergissmeinnicht/domain';
import { buildApp } from '../app.ts';
import { createServices, type AppServices } from '../composition.ts';
import { loadConfig } from '../config/index.ts';

const ORIGIN = 'https://vmn.example.org';
const PASSWORD = 'correct horse battery staple';
const SESSION_COOKIE = '__Secure-vmn.session_token';
const INVITE_LINK = /\/invite\/([A-Za-z0-9_-]{43})/;
const UNKNOWN_ID = '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f';

type App = Awaited<ReturnType<typeof buildApp>>;
type Response = Awaited<ReturnType<App['inject']>>;

describe('Workspace HTTP API', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let app: App;
  let services: AppServices;
  let outbox: EmailMessage[];
  let admin: string;
  let bob: string;
  let carol: string;
  let bobId: string;
  let carolId: string;

  const config = loadConfig({
    NODE_ENV: 'production',
    PUBLIC_ORIGIN: ORIGIN,
    DATABASE_PATH: '/unused/by/tests.sqlite',
    AUTH_SECRET: randomBytes(32).toString('base64url'),
    DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64url'),
    SMTP_HOST: '127.0.0.1',
    MAIL_FROM_ADDRESS: 'noreply@example.org',
    LOG_LEVEL: 'info',
  });

  const cookie = (response: Response) =>
    [response.headers['set-cookie'] ?? []].flat().find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.split(';')[0];
  const post = (url: string, payload?: object, cookieHeader?: string, origin: string | null = ORIGIN) =>
    app.inject({
      method: 'POST',
      url,
      headers: {
        ...(origin === null ? {} : { origin }),
        ...(cookieHeader === undefined ? {} : { cookie: cookieHeader }),
      },
      ...(payload === undefined ? {} : { payload }),
    });
  const get = (url: string, cookieHeader?: string) =>
    app.inject({ method: 'GET', url, headers: cookieHeader === undefined ? {} : { cookie: cookieHeader } });

  async function signIn(email: string): Promise<string> {
    const session = cookie(await post('/api/auth/sign-in', { email, password: PASSWORD }));
    if (session === undefined) throw new Error('sign-in failed');
    return session;
  }
  async function invite(email: string, name: string): Promise<string> {
    await post('/api/admin/invitations', { email }, admin);
    const token = INVITE_LINK.exec(outbox.at(-1)?.text ?? '')?.[1];
    await post('/api/invitations/accept', { token, displayName: name, password: PASSWORD });
    return signIn(email);
  }
  async function createWorkspace(name = 'Home'): Promise<string> {
    const response = await post('/api/workspaces', { name }, admin);
    expect(response.statusCode).toBe(201);
    return (response.json() as { workspace: { id: string } }).workspace.id;
  }
  const addMember = (workspaceId: string, email: string, role: string, as = admin) =>
    post(`/api/workspaces/${workspaceId}/members`, { email, role }, as);
  const userIdOf = async (session: string) => ((await get('/api/auth/session', session)).json() as { user: { id: string } }).user.id;

  beforeEach(async () => {
    database = createTestDatabase();
    outbox = [];
    app = await buildApp({
      services: (log) => {
        const built = createServices(config, database)(log);
        const email = { send: async (message: EmailMessage) => void outbox.push(message) };
        services = { ...built, invitations: { ...built.invitations, email } };
        return services;
      },
    });
    const { acceptUrl } = await bootstrapServerAdmin(services.invitations, { email: normalizeEmail('admin@example.org') });
    await post('/api/invitations/accept', { token: INVITE_LINK.exec(acceptUrl)?.[1], displayName: 'Ada', password: PASSWORD });
    admin = await signIn('admin@example.org');
    bob = await invite('bob@example.org', 'Bob');
    carol = await invite('carol@example.org', 'Carol');
    bobId = await userIdOf(bob);
    carolId = await userIdOf(carol);
  });

  afterEach(async () => {
    await app.close();
    database.dispose();
  });

  it('requires a session on every route', async () => {
    const id = await createWorkspace();
    const responses = [
      await get('/api/workspaces'),
      await post('/api/workspaces', { name: 'X' }),
      await get(`/api/workspaces/${id}`),
      await post(`/api/workspaces/${id}/rename`, { name: 'X' }),
      await get(`/api/workspaces/${id}/members`),
      await post(`/api/workspaces/${id}/members`, { email: 'bob@example.org', role: 'ADMIN' }),
      await post(`/api/workspaces/${id}/members/${bobId}/role`, { role: 'ADMIN' }),
      await post(`/api/workspaces/${id}/members/${bobId}/remove`),
      await post(`/api/workspaces/${id}/leave`),
    ];
    expect(responses.map((r) => r.statusCode)).toEqual(Array(responses.length).fill(401));
  });

  it('rejects state-changing requests without the exact Origin', async () => {
    const id = await createWorkspace();
    for (const origin of [null, 'https://evil.example', 'http://vmn.example.org']) {
      expect((await post('/api/workspaces', { name: 'X' }, admin, origin)).statusCode).toBe(403);
      expect((await post(`/api/workspaces/${id}/members`, { email: 'bob@example.org', role: 'ADMIN' }, admin, origin)).statusCode).toBe(403);
    }
    expect((await get(`/api/workspaces/${id}/members`, admin)).json().members).toHaveLength(1);
  });

  it('lets only server admins create Workspaces', async () => {
    expect((await post('/api/workspaces', { name: 'Mine' }, bob)).statusCode).toBe(403);
    const id = await createWorkspace('  Home ');
    expect((await get(`/api/workspaces/${id}`, admin)).json()).toEqual({
      workspace: { id, name: 'Home', role: 'ADMIN' },
      capabilities: [
        'workspace.view',
        'workspace.members.view',
        'workspace.members.manage',
        'workspace.settings.manage',
        'procedure.view',
        'procedure.edit',
        'procedure.restore',
        'run.view',
        'run.start',
        'run.execute',
        'run.abort',
      ],
    });
    // A Workspace ADMIN without the server-admin flag still cannot create Workspaces.
    await addMember(id, 'bob@example.org', 'ADMIN');
    expect((await post('/api/workspaces', { name: 'Mine' }, bob)).statusCode).toBe(403);
  });

  it('answers non-members exactly like unknown Workspaces', async () => {
    const id = await createWorkspace();
    const asOutsider = await get(`/api/workspaces/${id}`, bob);
    const unknown = await get(`/api/workspaces/${UNKNOWN_ID}`, bob);
    expect(asOutsider.statusCode).toBe(404);
    expect(asOutsider.body).toBe(unknown.body);
    expect((await get(`/api/workspaces/${id}/members`, bob)).statusCode).toBe(404);
    expect((await addMember(id, 'carol@example.org', 'ADMIN', bob)).statusCode).toBe(404);
    expect((await post(`/api/workspaces/${id}/members/${bobId}/role`, { role: 'ADMIN' }, bob)).statusCode).toBe(404);
    expect((await post(`/api/workspaces/${id}/rename`, { name: 'Pwned' }, bob)).statusCode).toBe(404);
    expect((await get('/api/workspaces', bob)).json()).toEqual({ workspaces: [] });
  });

  it('keeps Workspaces isolated from each other', async () => {
    const home = await createWorkspace('Home');
    const office = await createWorkspace('Office');
    await addMember(home, 'bob@example.org', 'ADMIN');
    await addMember(office, 'carol@example.org', 'USER');
    // Bob administers Home, but cannot reach Office or its members through either Workspace.
    expect((await get(`/api/workspaces/${office}/members`, bob)).statusCode).toBe(404);
    expect((await post(`/api/workspaces/${home}/members/${carolId}/remove`, undefined, bob)).statusCode).toBe(404);
    expect((await post(`/api/workspaces/${home}/members/${carolId}/role`, { role: 'GUEST' }, bob)).json()).toEqual({
      error: 'member_not_found',
    });
    expect((await get('/api/workspaces', bob)).json()).toEqual({ workspaces: [{ id: home, name: 'Home', role: 'ADMIN' }] });
  });

  it('denies vertical escalation by USERs and hides contact details from them', async () => {
    const id = await createWorkspace();
    await addMember(id, 'bob@example.org', 'USER');
    await addMember(id, 'carol@example.org', 'GUEST');
    expect((await post(`/api/workspaces/${id}/members/${bobId}/role`, { role: 'ADMIN' }, bob)).statusCode).toBe(403);
    expect((await addMember(id, 'carol@example.org', 'ADMIN', bob)).statusCode).toBe(403);
    expect((await post(`/api/workspaces/${id}/members/${carolId}/remove`, undefined, bob)).statusCode).toBe(403);
    expect((await post(`/api/workspaces/${id}/rename`, { name: 'Bob’s' }, bob)).statusCode).toBe(403);

    const members = (await get(`/api/workspaces/${id}/members`, bob)).json() as { members: Record<string, unknown>[] };
    expect(members.members.map((m) => [m.displayName, m.role])).toEqual([
      ['Ada', 'ADMIN'],
      ['Bob', 'USER'],
      ['Carol', 'GUEST'],
    ]);
    expect(members.members.some((m) => 'email' in m || 'status' in m)).toBe(false);
    expect((await get(`/api/workspaces/${id}/members`, carol)).statusCode).toBe(403);
    expect((await get(`/api/workspaces/${id}/members`, admin)).json().members[1]).toMatchObject({
      email: 'bob@example.org',
      status: 'ACTIVE',
    });
  });

  it('revokes a removed member’s access on their next request with the same session', async () => {
    const id = await createWorkspace();
    await addMember(id, 'bob@example.org', 'EDITOR');
    expect((await get(`/api/workspaces/${id}`, bob)).statusCode).toBe(200);
    expect((await post(`/api/workspaces/${id}/members/${bobId}/remove`, undefined, admin)).statusCode).toBe(204);
    expect((await get(`/api/workspaces/${id}`, bob)).statusCode).toBe(404);
    expect((await get('/api/workspaces', bob)).json()).toEqual({ workspaces: [] });
    expect((await get('/api/auth/session', bob)).statusCode).toBe(200);
  });

  it('applies a demotion on the next request', async () => {
    const id = await createWorkspace();
    await addMember(id, 'bob@example.org', 'ADMIN');
    expect((await post(`/api/workspaces/${id}/members/${bobId}/role`, { role: 'GUEST' }, admin)).statusCode).toBe(204);
    expect((await addMember(id, 'carol@example.org', 'USER', bob)).statusCode).toBe(403);
    expect((await get(`/api/workspaces/${id}`, bob)).json().workspace.role).toBe('GUEST');
  });

  it('lets members leave on their own, but not the last admin', async () => {
    const id = await createWorkspace();
    await addMember(id, 'bob@example.org', 'GUEST');
    expect((await post(`/api/workspaces/${id}/leave`, undefined, carol)).statusCode).toBe(404);
    expect((await post(`/api/workspaces/${id}/leave`, undefined, bob, null)).statusCode).toBe(403);
    expect((await post(`/api/workspaces/${id}/leave`, undefined, bob)).statusCode).toBe(204);
    expect((await get(`/api/workspaces/${id}`, bob)).statusCode).toBe(404);
    expect((await post(`/api/workspaces/${id}/leave`, undefined, admin)).json()).toEqual({ error: 'last_workspace_admin' });
  });

  it('protects the last Workspace admin', async () => {
    const id = await createWorkspace();
    const adminId = await userIdOf(admin);
    expect((await post(`/api/workspaces/${id}/members/${adminId}/remove`, undefined, admin)).json()).toEqual({
      error: 'last_workspace_admin',
    });
    expect((await post(`/api/workspaces/${id}/members/${adminId}/role`, { role: 'USER' }, admin)).statusCode).toBe(409);
  });

  it('reports membership conflicts and unknown accounts', async () => {
    const id = await createWorkspace();
    expect((await addMember(id, 'BOB@Example.org ', 'USER')).statusCode).toBe(201);
    expect((await addMember(id, 'bob@example.org', 'ADMIN')).json()).toEqual({ error: 'already_member' });
    expect((await addMember(id, 'nobody@example.org', 'USER')).json()).toEqual({ error: 'unknown_account' });
  });

  it('validates input strictly', async () => {
    const id = await createWorkspace();
    const bad = [
      await post('/api/workspaces', { name: 'X', id: UNKNOWN_ID }, admin),
      await post('/api/workspaces', { name: '' }, admin),
      await post('/api/workspaces', { name: 'x'.repeat(300) }, admin),
      await addMember(id, 'bob@example.org', 'OWNER'),
      await addMember(id, 'bob@example.org', 'admin'),
      await post(`/api/workspaces/${id}/members`, { email: 'bob@example.org', role: 'USER', serverAdmin: true }, admin),
      await get('/api/workspaces/not-a-uuid', admin),
      await get(`/api/workspaces/${id.toUpperCase()}`, admin),
      await post(`/api/workspaces/${id}/members/${bobId}/role`, { role: 'ADMIN', userId: carolId }, admin),
    ];
    expect(bad.map((r) => r.statusCode)).toEqual(Array(bad.length).fill(400));
    expect((await get(`/api/workspaces/${id}/members`, admin)).json().members).toHaveLength(1);
  });

  it('rate-limits adding members', async () => {
    const id = await createWorkspace();
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await addMember(id, `probe${i}@example.org`, 'USER')).statusCode);
    expect(statuses.slice(0, 30).every((s) => s === 404)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});
