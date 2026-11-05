import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TOTP } from 'otpauth';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MCP_SCOPES, UUID_V4 } from '@vergissmeinnicht/domain';
import { ORIGIN, PASSWORD, startTestApp, type InjectResponse } from './test-harness.ts';

const RESOURCE = ORIGIN + '/mcp';
const CALLBACK = 'https://client.example.org/callback?fixed=1';
const SCOPES = ['workspaces.read', 'lists.read'];
type Tokens = { access_token: string; refresh_token: string; expires_in: number; scope: string; token_type: string };

// Exercise the actual Fastify/SDK endpoints. No tunnel, network provider or production credentials.
describe('MCP OAuth protocol and canonical discovery', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;

  let webDistDir: string;
  beforeAll(() => {
    webDistDir = mkdtempSync(join(tmpdir(), 'vmn-oauth-web-'));
    writeFileSync(join(webDistDir, 'index.html'), '<!doctype html><title>VMN SPA</title>');
  });
  afterAll(() => rmSync(webDistDir, { recursive: true, force: true }));
  beforeEach(async () => { t = await startTestApp({ mcpEnabled: true, captureLogs: true, webDistDir }); });
  afterEach(async () => { vi.useRealTimers(); await t?.close(); });

  const count = (table: 'mcp_clients' | 'mcp_authorization_requests' | 'mcp_grants' | 'mcp_tokens') => {
    // Fixed test-only table names; never caller input.
    return (t.database.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
  };
  async function register(redirects = [CALLBACK]) {
    const response = await t.app.inject({ method: 'POST', url: '/register', payload: {
      client_name: 'Synthetic public OAuth client', redirect_uris: redirects, token_endpoint_auth_method: 'none',
    } });
    expect(response.statusCode).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['content-type']).toMatch(/^application\/json\b/);
    expect(response.json()).toMatchObject({ grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] });
    expect(response.json().client_id_issued_at).toEqual(expect.any(Number));
    return response.json<{ client_id: string; redirect_uris: string[]; token_endpoint_auth_method: string }>();
  }
  async function begin(clientId: string, overrides: Record<string, string | undefined> = {}) {
    const verifier = randomBytes(32).toString('base64url');
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: CALLBACK, response_type: 'code',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
      scope: SCOPES.join(' '), resource: RESOURCE, state: 'synthetic state + / & ? = ü',
    });
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) params.delete(key); else params.set(key, value);
    }
    const response = await t.app.inject({ method: 'GET', url: '/authorize?' + params });
    return { response, verifier, params };
  }
  function pending(response: InjectResponse) {
    expect(response.statusCode).toBe(302);
    const location = new URL(String(response.headers.location));
    expect(location.origin).toBe(ORIGIN);
    expect(location.pathname).toBe('/account/connections');
    expect(location.searchParams.has('code')).toBe(false);
    const requestId = location.searchParams.get('request');
    expect(requestId).toMatch(UUID_V4);
    return String(requestId);
  }
  async function approved() {
    const workspaceId = await t.createWorkspace('Synthetic OAuth workspace');
    const client = await register();
    const authorization = await begin(client.client_id);
    const requestId = pending(authorization.response);
    const response = await t.post('/api/account/mcp/approve', { requestId, allow: true, workspaceIds: [workspaceId], scopes: SCOPES }, t.admin);
    expect(response.statusCode).toBe(200);
    const callback = new URL(response.json<{ redirect: string }>().redirect);
    expect(callback.origin + callback.pathname).toBe(new URL(CALLBACK).origin + new URL(CALLBACK).pathname);
    expect(callback.searchParams.get('fixed')).toBe('1');
    expect(callback.searchParams.get('state')).toBe(authorization.params.get('state'));
    expect(callback.searchParams.has('code')).toBe(true);
    return { ...authorization, clientId: client.client_id, code: String(callback.searchParams.get('code')), requestId, workspaceId };
  }
  const form = (url: '/token' | '/revoke', params: Record<string, string>) => t.app.inject({
    method: 'POST', url, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams(params).toString(),
  });
  const exchange = (grant: Awaited<ReturnType<typeof approved>>, overrides: Record<string, string> = {}) => form('/token', {
    grant_type: 'authorization_code', client_id: grant.clientId, code: grant.code, code_verifier: grant.verifier,
    redirect_uri: CALLBACK, resource: RESOURCE, ...overrides,
  });
  const refresh = (clientId: string, token: string, overrides: Record<string, string> = {}) => form('/token', {
    grant_type: 'refresh_token', client_id: clientId, refresh_token: token, resource: RESOURCE, ...overrides,
  });
  function success(response: InjectResponse) {
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    return response.json<Tokens>();
  }

  it('advertises one exact issuer and canonical resource independently of request/proxy headers', async () => {
    for (const headers of [{}, { host: 'attacker.example', 'x-forwarded-host': 'attacker.example', 'x-forwarded-proto': 'http' }]) {
      const metadata = (await t.app.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server', headers })).json();
      const protectedResource = (await t.app.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource/mcp', headers })).json();
      expect(metadata).toEqual({ issuer: ORIGIN + '/', authorization_endpoint: ORIGIN + '/authorize',
        registration_endpoint: ORIGIN + '/register', token_endpoint: ORIGIN + '/token', revocation_endpoint: ORIGIN + '/revoke',
        response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'],
        revocation_endpoint_auth_methods_supported: ['none'], scopes_supported: MCP_SCOPES,
      });
      expect(protectedResource).toEqual({ resource: RESOURCE, authorization_servers: [metadata.issuer], scopes_supported: MCP_SCOPES, resource_name: 'VergissMeinNicht' });
      expect(t.services.publicOrigin).toBe(ORIGIN);
      expect(t.services.mcp.resource).toBe(RESOURCE);
      for (const method of ['GET', 'POST', 'DELETE'] as const) {
        const response = await t.app.inject({ method, url: '/mcp', headers: { ...headers, cookie: t.admin } });
        expect(response.statusCode).toBe(401);
        expect(response.headers['www-authenticate']).toBe(`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`);
      }
    }
  });

  it('serves identical JSON for both discovery path spellings with the production SPA enabled', async () => {
    for (const path of ['/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource/mcp']) {
      const canonical = await t.app.inject({ method: 'GET', url: path });
      for (const suffix of ['', '/', '?discovery=1', '/?discovery=1']) {
        const response = await t.app.inject({ method: 'GET', url: path + suffix, headers: { accept: 'text/html' } });
        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toMatch(/^application\/json\b/);
        expect(response.body).toBe(canonical.body);
        expect(response.json()).toEqual(canonical.json());
      }
    }
    for (const url of ['/.well-known/unknown', '/.well-known/unknown/?x=1',
      '/.well-known/oauth-authorization-server/unknown', '/.well-known/oauth-protected-resource/mcp/unknown']) {
      const response = await t.app.inject({ method: 'GET', url, headers: { accept: 'text/html' } });
      expect(response.statusCode).toBe(404);
      expect(response.headers['content-type']).toMatch(/^application\/json\b/);
      expect(response.json()).toEqual({ error: 'Not Found' });
    }
    const spa = await t.app.inject({ method: 'GET', url: '/account/connections' });
    expect(spa.statusCode).toBe(200);
    expect(spa.headers['content-type']).toMatch(/^text\/html\b/);
  });

  it('keeps all discovery and OAuth endpoints unavailable when disabled', async () => {
    await t.close(); t = await startTestApp({ webDistDir });
    for (const path of ['/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource/mcp']) {
      for (const suffix of ['', '/']) {
        const response = await t.app.inject({ method: 'GET', url: path + suffix });
        expect(response.statusCode).toBe(404);
        expect(response.headers['content-type']).toMatch(/^application\/json\b/);
        expect(response.json()).toEqual({ error: 'Not Found' });
      }
    }
    await t.close(); t = await startTestApp();
    for (const [method, url] of [['GET', '/.well-known/oauth-protected-resource/mcp'], ['GET', '/.well-known/oauth-authorization-server'],
      ['GET', '/authorize'], ['POST', '/register'], ['POST', '/token'], ['POST', '/revoke'], ['POST', '/mcp']] as const) {
      // Unknown state-changing routes still pass through the ordinary CSRF guard first.
      expect((await t.app.inject({ method, url, headers: { origin: ORIGIN } })).statusCode).toBe(404);
    }
  });

  it('registers a public client without a secret or application grant', async () => {
    const client = await register();
    expect(client.client_id).toMatch(UUID_V4);
    expect(client.redirect_uris).toEqual([CALLBACK]);
    expect(client.token_endpoint_auth_method).toBe('none');
    expect(Object.hasOwn(client, 'client_secret')).toBe(false);
    expect(count('mcp_clients')).toBe(1);
    expect(count('mcp_grants')).toBe(0);
    expect(count('mcp_tokens')).toBe(0);
  });

  it.each([
    { name: 'omitted client authentication', metadata: {} },
    { name: 'client secret authentication', metadata: { token_endpoint_auth_method: 'client_secret_post' } },
    { name: 'non-loopback HTTP redirect', metadata: { redirect_uris: ['http://attacker.example/callback'] } },
    { name: 'script redirect', metadata: { redirect_uris: ['javascript:alert(1)'] } },
    { name: 'Harpoon redirect', metadata: { redirect_uris: ['harpoon://callback'] } },
    { name: 'credential-bearing redirect', metadata: { redirect_uris: ['https://user:password@client.example/callback'] } },
    { name: 'fragment redirect', metadata: { redirect_uris: ['https://client.example/callback#fragment'] } },
    { name: 'too many redirects', metadata: { redirect_uris: Array.from({ length: 6 }, (_, i) => `https://client.example/${i}`) } },
  ])('refuses $name at registration', async ({ name, metadata }) => {
    const input: Record<string, unknown> = { redirect_uris: [CALLBACK], token_endpoint_auth_method: 'none', ...metadata };
    if (name === 'omitted client authentication') delete input['token_endpoint_auth_method'];
    const response = await t.app.inject({ method: 'POST', url: '/register', payload: input });
    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toMatch(/^application\/json\b/);
    expect(response.json().error).toBe('invalid_client_metadata');
    expect(count('mcp_clients')).toBe(0);
  });

  it('bounds registration input and preserves the SDK loopback redirect matching', async () => {
    expect((await t.app.inject({ method: 'POST', url: '/register', payload: { client_name: 'x'.repeat(17 * 1024) } })).statusCode).toBe(413);
    const client = await register(['http://127.0.0.1:1234/callback']);
    const allowed = await begin(client.client_id, { redirect_uri: 'http://127.0.0.1:4321/callback' });
    pending(allowed.response);
    const denied = await begin(client.client_id, { redirect_uri: 'http://127.0.0.1:4321/other' });
    expect(denied.response.statusCode).toBe(400);
    expect(denied.response.headers.location).toBeUndefined();
  });

  it.each([
    { code_challenge: undefined }, { code_challenge_method: 'plain' }, { code_challenge_method: undefined },
    { code_challenge: 'short' }, { response_type: 'token' }, { scope: 'ungranted.scope' },
  ])('refuses invalid authorization parameters %j without creating consent', async overrides => {
    const client = await register();
    const { response } = await begin(client.client_id, overrides);
    expect(response.statusCode).toBe(302);
    const callback = new URL(String(response.headers.location));
    expect(callback.origin).toBe(new URL(CALLBACK).origin);
    expect(callback.searchParams.has('error')).toBe(true);
    expect(callback.searchParams.has('code')).toBe(false);
    expect(count('mcp_authorization_requests')).toBe(0);
    expect(count('mcp_grants')).toBe(0);
  });

  it('never redirects an unknown client or unregistered callback, and preserves state on decline', async () => {
    const client = await register();
    for (const overrides of [{ client_id: 'unknown' }, { redirect_uri: 'https://attacker.example/callback' }]) {
      const { response } = await begin(client.client_id, overrides);
      expect(response.statusCode).toBe(400);
      expect(response.headers.location).toBeUndefined();
    }
    const authorization = await begin(client.client_id);
    const requestId = pending(authorization.response);
    const response = await t.post('/api/account/mcp/approve', { requestId, allow: false, workspaceIds: [], scopes: [] }, t.admin);
    expect(response.statusCode).toBe(200);
    const redirect = new URL(response.json().redirect);
    expect(redirect.searchParams.get('state')).toBe(authorization.params.get('state'));
    expect(redirect.searchParams.get('error')).toBe('access_denied');
    expect(redirect.searchParams.get('fixed')).toBe('1');
    expect(redirect.searchParams.has('code')).toBe(false);
    expect(count('mcp_grants')).toBe(0);
    expect(count('mcp_tokens')).toBe(0);
  });

  it('defaults an omitted resource while refusing foreign and transport-specific audiences at every stage', async () => {
    const grant = await approved();
    const before = count('mcp_authorization_requests');
    for (const resource of ['https://foreign.example/mcp', ORIGIN + '/', RESOURCE + '/', 'https://api.openai.com/v1/mcp/synthetic', 'harpoon://synthetic']) {
      const rejected = await begin(grant.clientId, { resource });
      expect(new URL(String(rejected.response.headers.location)).searchParams.has('error')).toBe(true);
      expect(count('mcp_authorization_requests')).toBe(before);
      expect((await exchange(grant, { resource })).statusCode).toBe(400);
    }
    const omitted = await begin(grant.clientId, { resource: undefined });
    pending(omitted.response);
    const codeParams = { grant_type: 'authorization_code', client_id: grant.clientId, code: grant.code, code_verifier: grant.verifier, redirect_uri: CALLBACK };
    const tokens = success(await form('/token', codeParams));
    expect((await t.services.mcp.verify(tokens.access_token)).grant.resource).toBe(RESOURCE);
    for (const resource of ['https://foreign.example/mcp', RESOURCE + '/', 'https://api.openai.com/v1/mcp/synthetic', 'harpoon://synthetic']) {
      expect((await refresh(grant.clientId, tokens.refresh_token, { resource })).statusCode).toBe(400);
    }
    success(await form('/token', { grant_type: 'refresh_token', client_id: grant.clientId, refresh_token: tokens.refresh_token }));
  });

  it('requires the verifier, registered client and exact callback without consuming a valid code on failure', async () => {
    const grant = await approved();
    const other = await register();
    for (const overrides of [{ code_verifier: randomBytes(32).toString('base64url') }, { client_id: other.client_id }, { redirect_uri: 'https://client.example.org/other' }]) {
      expect((await exchange(grant, overrides)).statusCode).toBe(400);
      expect(count('mcp_tokens')).toBe(1);
    }
    expect((await form('/token', { grant_type: 'authorization_code', client_id: grant.clientId, code: grant.code, redirect_uri: CALLBACK })).statusCode).toBe(400);
    const duplicate = await t.app.inject({ method: 'POST', url: '/token', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ grant_type: 'authorization_code', client_id: grant.clientId, code: grant.code, code_verifier: grant.verifier, redirect_uri: CALLBACK }).toString() + '&client_id=other',
    });
    expect(duplicate.statusCode).toBe(400);
    const tokens = success(await exchange(grant));
    expect(tokens.token_type).toBe('Bearer');
    expect(tokens.expires_in).toBeGreaterThanOrEqual(899);
    expect(tokens.expires_in).toBeLessThanOrEqual(900);
    expect(tokens.scope).toBe(SCOPES.join(' '));
    expect((await t.services.mcp.verify(tokens.access_token)).grant.workspaceIds).toEqual([grant.workspaceId]);
    expect((await exchange(grant)).statusCode).toBe(400);
    await expect(t.services.mcp.verify(tokens.access_token)).rejects.toThrow();
  });

  it('refuses an expired authorization request and code', async () => {
    const grant = await approved();
    const request = pending((await begin(grant.clientId)).response);
    t.database.sqlite.prepare('UPDATE mcp_authorization_requests SET expires_at = 0 WHERE id = ?').run(request);
    expect((await t.post('/api/account/mcp/approve', { requestId: request, allow: true, workspaceIds: [grant.workspaceId], scopes: SCOPES }, t.admin)).statusCode).toBe(400);
    t.database.sqlite.prepare("UPDATE mcp_tokens SET expires_at = 0 WHERE kind = 'code'").run();
    expect((await exchange(grant)).statusCode).toBe(400);
    expect(count('mcp_tokens')).toBe(1);
  });

  it('rotates refresh tokens for omitted or equal scopes and revokes the grant on replay', async () => {
    const grant = await approved();
    const first = success(await exchange(grant));
    const other = await register();
    for (const overrides of [{ client_id: other.client_id }, { scope: 'workspaces.read' }, { scope: 'workspaces.read lists.read lists.write' }]) {
      expect((await refresh(grant.clientId, first.refresh_token, overrides)).statusCode).toBe(400);
    }
    const second = success(await refresh(grant.clientId, first.refresh_token));
    expect(second.access_token !== first.access_token && second.refresh_token !== first.refresh_token).toBe(true);
    const third = success(await refresh(grant.clientId, second.refresh_token, { scope: [...SCOPES].reverse().join(' ') }));
    await t.services.mcp.verify(third.access_token);
    expect((await refresh(grant.clientId, first.refresh_token)).statusCode).toBe(400);
    for (const tokens of [first, second, third]) await expect(t.services.mcp.verify(tokens.access_token)).rejects.toThrow();
    expect((await refresh(grant.clientId, third.refresh_token)).statusCode).toBe(400);
  });

  it('allows only one concurrent refresh and commits replay revocation of the winner', async () => {
    const grant = await approved();
    const first = success(await exchange(grant));
    const results = await Promise.all([refresh(grant.clientId, first.refresh_token), refresh(grant.clientId, first.refresh_token)]);
    expect(results.map(result => result.statusCode).sort()).toEqual([200, 400]);
    const winner = results.find(result => result.statusCode === 200);
    if (!winner) throw new Error('No refresh winner');
    await expect(t.services.mcp.verify(winner.json<Tokens>().access_token)).rejects.toThrow();
  });

  it('keeps refresh expiry at 30 days and caps later refreshes at the 90-day grant expiry', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    const day = 86400000;
    const grant = await approved();
    let tokens = success(await exchange(grant));
    const refreshExpiries = () => t.database.sqlite.prepare("SELECT expires_at FROM mcp_tokens WHERE kind='refresh' ORDER BY rowid DESC").all() as { expires_at: number }[];
    expect(Number(refreshExpiries()[0]?.expires_at)).toBe(start + 30 * day);
    for (const elapsedDays of [29, 58, 87]) {
      vi.setSystemTime(start + elapsedDays * day);
      tokens = success(await refresh(grant.clientId, tokens.refresh_token));
    }
    expect(Number(refreshExpiries()[0]?.expires_at)).toBe(start + 90 * day);
    vi.setSystemTime(start + 90 * day);
    expect((await refresh(grant.clientId, tokens.refresh_token)).statusCode).toBe(400);
    await expect(t.services.mcp.verify(tokens.access_token)).rejects.toThrow();
  });

  it('rolls back a failed token issue so its code can still be exchanged', async () => {
    const grant = await approved();
    t.database.sqlite.exec("CREATE TRIGGER synthetic_token_failure BEFORE INSERT ON mcp_tokens WHEN NEW.kind='access' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
    expect((await exchange(grant)).statusCode).toBe(500);
    expect(count('mcp_tokens')).toBe(1);
    t.database.sqlite.exec('DROP TRIGGER synthetic_token_failure');
    success(await exchange(grant));
  });

  it('requires cookie authentication and same-origin consent and prevents another account revoking a grant', async () => {
    const grant = await approved();
    const requestId = pending((await begin(grant.clientId)).response);
    const input = { requestId, allow: true, workspaceIds: [grant.workspaceId], scopes: SCOPES };
    expect((await t.get('/api/account/mcp/requests/' + requestId)).statusCode).toBe(401);
    expect((await t.post('/api/account/mcp/approve', input)).statusCode).toBe(401);
    for (const origin of [null, 'https://attacker.example', 'https://chatgpt.com']) {
      expect((await t.post('/api/account/mcp/approve', input, t.admin, origin)).statusCode).toBe(403);
    }
    const foreign = await t.invite('synthetic-outsider@example.org', 'Outsider');
    expect((await t.post('/api/account/mcp/approve', input, foreign)).statusCode).toBe(403);
    const tokens = success(await exchange(grant));
    const verified = await t.services.mcp.verify(tokens.access_token);
    expect((await t.post(`/api/account/mcp/${verified.grant.id}/revoke`, {}, foreign)).statusCode).toBe(403);
    const other = await register();
    success(await form('/revoke', { client_id: other.client_id, token: tokens.refresh_token }));
    await t.services.mcp.verify(tokens.access_token);
    success(await form('/revoke', { client_id: grant.clientId, token: tokens.refresh_token }));
    await expect(t.services.mcp.verify(tokens.access_token)).rejects.toThrow();
  });

  it('requires completed TOTP before consent and revokes prior grants on MFA enrollment', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const grant = await approved();
    const tokens = success(await exchange(grant));
    const setup = await t.post('/api/account/mfa/totp/setup', { password: PASSWORD }, t.admin);
    expect(setup.statusCode).toBe(200);
    const totp = new TOTP({ secret: setup.json<{ secret: string }>().secret });
    await expect(t.services.mcp.verify(tokens.access_token)).rejects.toThrow();
    expect((await t.post('/api/account/mfa/totp/confirm', { code: totp.generate() }, t.admin)).statusCode).toBe(200);
    vi.setSystemTime(Date.now() + 30000);
    const requestId = pending((await begin(grant.clientId)).response);
    const input = { requestId, allow: true, workspaceIds: [grant.workspaceId], scopes: SCOPES };
    const login = await t.post('/api/auth/sign-in', { email: 'admin@example.org', password: PASSWORD });
    expect(login.json()).toEqual({ mfaRequired: true });
    const challenge = [login.headers['set-cookie'] ?? []].flat().find(value => value.startsWith('__Secure-vmn.mfa_challenge='))?.split(';')[0];
    if (!challenge) throw new Error('Missing MFA challenge');
    expect((await t.get('/api/account/mcp/requests/' + requestId, challenge)).statusCode).toBe(401);
    expect((await t.post('/api/account/mcp/approve', input, challenge)).statusCode).toBe(401);
    const verified = await t.post('/api/auth/mfa', { code: totp.generate() }, challenge);
    expect(verified.statusCode).toBe(200);
    const cookie = [verified.headers['set-cookie'] ?? []].flat().find(value => value.startsWith('__Secure-vmn.session_token='))?.split(';')[0];
    if (!cookie) throw new Error('Missing authenticated session');
    expect((await t.post('/api/account/mcp/approve', input, cookie)).statusCode).toBe(200);
  });

  it('keeps codes, verifiers and tokens out of logs and audit metadata on success, failure and replay', async () => {
    const grant = await approved();
    const wrongVerifier = randomBytes(32).toString('base64url');
    expect((await exchange(grant, { code_verifier: wrongVerifier })).statusCode).toBe(400);
    const first = success(await exchange(grant));
    const second = success(await refresh(grant.clientId, first.refresh_token));
    expect((await refresh(grant.clientId, first.refresh_token)).statusCode).toBe(400);
    await t.app.inject({ method: 'POST', url: '/mcp', headers: { authorization: 'Bearer ' + second.access_token } });
    const audit = JSON.stringify(t.database.sqlite.prepare('SELECT metadata FROM security_events').all());
    const secrets = [grant.code, grant.verifier, wrongVerifier, first.access_token, first.refresh_token, second.access_token, second.refresh_token];
    expect(t.logs.length > 0).toBe(true);
    // Boolean assertions avoid dumping credential-bearing logs/values even if this guard regresses.
    expect(secrets.every(secret => !t.logs.includes(secret) && !audit.includes(secret))).toBe(true);
  });
});
