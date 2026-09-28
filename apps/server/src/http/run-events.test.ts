import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp } from './test-harness.ts';

const STEP = { title: 'Stove off', required: true, critical: false, skipReasonPolicy: 'DISABLED', notApplicableReasonPolicy: 'OPTIONAL' };
const PROCEDURE = { title: 'Leave the house', icon: 'home', sections: [{ title: 'Kitchen', steps: [STEP, { ...STEP, title: 'Lights off' }] }] };

interface ServerEvent {
  readonly event: string;
  readonly data: Record<string, unknown>;
  readonly raw: string;
}

/** Minimal SSE client over fetch: yields parsed events, `null` once the server closed the stream. */
async function openStream(baseUrl: string, path: string, cookie?: string) {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}${path}`, {
    headers: cookie === undefined ? {} : { cookie },
    signal: controller.signal,
  });
  // Error responses are plain JSON; only a 200 is read as a stream.
  const reader = response.status === 200 ? response.body?.getReader() : undefined;
  const decoder = new TextDecoder();
  let buffer = '';
  async function next(timeoutMs = 3000): Promise<ServerEvent | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const end = buffer.indexOf('\n\n');
      if (end !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const lines = block.split('\n');
        const event = lines.find((line) => line.startsWith('event: '))?.slice(7);
        const data = lines.find((line) => line.startsWith('data: '))?.slice(6);
        if (event !== undefined && data !== undefined) return { event, data: JSON.parse(data) as Record<string, unknown>, raw: data };
        continue; // retry line or heartbeat comment
      }
      if (reader === undefined) return null;
      const chunk = await Promise.race([
        reader.read(),
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), Math.max(0, deadline - Date.now()))),
      ]);
      if (chunk === 'timeout') throw new Error('no event before timeout');
      if (chunk.done) return null;
      buffer += decoder.decode(chunk.value, { stream: true });
    }
  }
  return {
    response,
    next,
    close: () => controller.abort(),
  };
}

describe('Run events (SSE)', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let baseUrl: string;
  let home: string;
  let office: string;
  let user: string;
  let guest: string;
  let outsider: string;
  let procedureId: string;
  const streams: { close(): void }[] = [];

  const runs = (workspaceId: string) => `/api/workspaces/${workspaceId}/runs`;
  const events = (runId: string, workspaceId = home) => `${runs(workspaceId)}/${runId}/events`;
  async function stream(path: string, cookie?: string) {
    const opened = await openStream(baseUrl, path, cookie);
    streams.push(opened);
    return opened;
  }
  async function startRun() {
    const run = (await t.post(runs(home), { procedureId }, user)).json().run;
    return { id: run.id as string, stepIds: run.sections[0].steps.map((step: { id: string }) => step.id) as string[] };
  }
  const markDone = (runId: string, stepId: string, cookie = user) =>
    t.post(`${runs(home)}/${runId}/steps/${stepId}/state`, { expectedState: 'PENDING', state: 'DONE' }, cookie);

  beforeEach(async () => {
    t = await startTestApp({ runEvents: { heartbeatMs: 100 } });
    const editor = await t.invite('editor@example.org', 'Eddie');
    user = await t.invite('user@example.org', 'Uma');
    guest = await t.invite('guest@example.org', 'Gus');
    outsider = await t.invite('outsider@example.org', 'Otto');
    home = await t.createWorkspace('Home');
    office = await t.createWorkspace('Office');
    await t.addMember(home, 'editor@example.org', 'EDITOR');
    await t.addMember(home, 'user@example.org', 'USER');
    await t.addMember(home, 'guest@example.org', 'GUEST');
    await t.addMember(office, 'outsider@example.org', 'ADMIN');
    procedureId = (await t.post(`/api/workspaces/${home}/procedures`, PROCEDURE, editor)).json().procedure.id;
    baseUrl = await t.app.listen({ port: 0, host: '127.0.0.1' });
  });

  afterEach(async () => {
    for (const opened of streams.splice(0)) opened.close();
    await t.close();
  });

  it('pushes revisions, actor and time to every member viewing the Run and ends with the Run', async () => {
    const run = await startRun();
    const guestStream = await stream(events(run.id), guest);
    expect(guestStream.response.status).toBe(200);
    expect(guestStream.response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(guestStream.response.headers.get('cache-control')).toBe('no-store');
    expect(await guestStream.next()).toMatchObject({ event: 'ready', data: { revision: 1, state: 'ACTIVE' } });

    const firstStep = run.stepIds[0] as string;
    expect((await markDone(run.id, firstStep)).statusCode).toBe(200);
    const change = await guestStream.next();
    expect(change?.event).toBe('run');
    expect(change?.data).toEqual({ revision: 2, kind: 'STEP_STATE_CHANGED', stepId: firstStep, by: 'Uma', at: expect.any(String) });
    // Only the announcement: no user ids, emails or Step content travel over the stream.
    expect(change?.raw).not.toMatch(/userId|@example|Stove/);

    // The canonical state is fetched over the API; its revision matches the event.
    expect((await t.get(`${runs(home)}/${run.id}`, guest)).json().run.revision).toBe(2);

    await markDone(run.id, run.stepIds[1] as string);
    expect((await guestStream.next())?.data.revision).toBe(3);
    await t.post(`${runs(home)}/${run.id}/complete`, {}, user);
    expect(await guestStream.next()).toMatchObject({ event: 'run', data: { revision: 4, kind: 'RUN_COMPLETED', stepId: null, by: 'Uma' } });
    expect(await guestStream.next()).toBeNull();

    // Finished Runs have nothing to stream: 204 also stops EventSource from reconnecting.
    expect((await stream(events(run.id), guest)).response.status).toBe(204);
  });

  it('authorizes the subscription like reading the Run', async () => {
    const run = await startRun();
    expect((await stream(events(run.id))).response.status).toBe(401);
    // A cookie that is not a valid session (e.g. only the MFA challenge cookie) is not a session.
    expect((await stream(events(run.id), '__Secure-vmn.mfa_challenge=abc')).response.status).toBe(401);
    expect((await stream(events(run.id), '__Secure-vmn.session_token=forged.value')).response.status).toBe(401);
    const nonMember = await stream(events(run.id), outsider);
    expect(nonMember.response.status).toBe(404);
    expect(await nonMember.response.json()).toEqual({ error: 'workspace_not_found' });
    // Otto administers Office: the Home Run is not reachable through it.
    const crossWorkspace = await stream(events(run.id, office), outsider);
    expect(await crossWorkspace.response.json()).toEqual({ error: 'run_not_found' });
    expect((await stream(`${runs(home)}/not-a-uuid/events`, guest)).response.status).toBe(400);
  });

  it('stops delivering to a member who is removed while subscribed', async () => {
    const run = await startRun();
    const guestStream = await stream(events(run.id), guest);
    await guestStream.next();
    const members = (await t.get(`/api/workspaces/${home}/members`, t.admin)).json().members as { userId: string; displayName: string }[];
    const gus = members.find((member) => member.displayName === 'Gus');
    expect((await t.post(`/api/workspaces/${home}/members/${gus?.userId}/remove`, undefined, t.admin)).statusCode).toBe(204);

    await markDone(run.id, run.stepIds[0] as string);
    expect(await guestStream.next()).toBeNull();
  });

  it('closes the stream within one heartbeat after sign-out', async () => {
    const run = await startRun();
    const guestStream = await stream(events(run.id), guest);
    await guestStream.next();
    await t.post('/api/auth/sign-out', undefined, guest);
    expect(await guestStream.next(1000)).toBeNull();
  });

  it('limits open streams per user', async () => {
    const run = await startRun();
    const opened = [];
    for (let i = 0; i < 10; i += 1) opened.push(await stream(events(run.id), guest));
    expect(opened.every((s) => s.response.status === 200)).toBe(true);
    const tooMany = await stream(events(run.id), guest);
    expect(tooMany.response.status).toBe(429);
    expect(await tooMany.response.json()).toEqual({ error: 'too_many_streams' });
    // Another user is not affected, and closing a stream frees its slot.
    expect((await stream(events(run.id), user)).response.status).toBe(200);
    opened[0]?.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await stream(events(run.id), guest)).response.status).toBe(200);
  });
});
