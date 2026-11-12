import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PASSWORD, startTestApp } from './test-harness.ts';
import { escapeText, foldLine } from './calendar-feed-ics.ts';

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const basic = (date: string) => date.replaceAll('-', '');

describe('calendar subscription links (39)', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let home: string;
  let office: string;
  let uma: string;
  let gus: string;
  const feedApi = (workspaceId = home) => `/api/workspaces/${workspaceId}/calendar-feed`;
  const pathOf = (url: string) => new URL(url).pathname;
  const idOf = (email: string) => (t.database.sqlite.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string }).id;

  beforeEach(async () => {
    t = await startTestApp({ captureLogs: true });
    uma = await t.invite('uma@example.org', 'Uma');
    gus = await t.invite('gus@example.org', 'Gus');
    home = await t.createWorkspace('Home');
    office = await t.createWorkspace('Office');
    await t.addMember(home, 'uma@example.org', 'USER');
    await t.addMember(home, 'gus@example.org', 'GUEST');
    await t.addMember(office, 'uma@example.org', 'USER');
  });
  afterEach(async () => t.close());

  const remind = (title: string, date: string, extra: object = {}) =>
    t.post(`/api/workspaces/${home}/schedules`, { title, date, timeZone: 'Europe/Berlin', reminders: [], assigneeUserId: null, ...extra }, uma);

  it('makes a private link once, serves an iCalendar feed of what the person may see, and keeps it private', async () => {
    expect((await t.get(feedApi(), uma)).json()).toEqual({ feed: null });
    const created = await t.post(feedApi(), { scope: 'ALL' }, uma);
    expect(created.statusCode).toBe(201);
    const { url, feed } = created.json();
    expect(url).toMatch(/^https:\/\/[^/]+\/api\/calendar-feed\/[A-Za-z0-9_-]{43}\.ics$/);
    expect(feed).toEqual({ scope: 'ALL', createdAt: expect.any(String), lastUsedAt: null });
    // The token is not stored and never listed again.
    const token = /([A-Za-z0-9_-]{43})\.ics$/.exec(url)?.[1] ?? '';
    expect(JSON.stringify(t.database.sqlite.prepare('SELECT * FROM calendar_feeds').all())).not.toContain(token);
    expect((await t.get(feedApi(), uma)).body).not.toContain(token);

    await remind('Pay rent; and, tax', inDays(2), { time: '09:30' });
    await remind('Water plants', inDays(3), { recurrence: { kind: 'FIXED', unit: 'WEEK', interval: 1 }, assigneeUserId: idOf('gus@example.org') });
    const response = await t.get(pathOf(url));
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/calendar; charset=utf-8');
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers['x-robots-tag']).toContain('noindex');
    const ics = response.body;
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('X-WR-CALNAME:VMN · Home');
    expect(ics).toContain('SUMMARY:Pay rent\\; and\\, tax');
    // 09:30 in Berlin is a UTC instant; a date without time is an all-day entry; planned dates are tentative.
    expect(ics).toMatch(new RegExp(`DTSTART:${basic(inDays(2))}T0[78]3000Z`));
    expect(ics).toContain(`DTSTART;VALUE=DATE:${basic(inDays(3))}`);
    expect(ics).toContain(`DTSTART;VALUE=DATE:${basic(inDays(10))}`);
    expect(ics).toContain('STATUS:TENTATIVE');
    expect(ics).toContain('Assigned to Gus');
    // Display names only: no email addresses, no user ids.
    expect(ics).not.toMatch(/@example\.org/);
    expect(ics).not.toContain(idOf('gus@example.org'));
    // The fetch is noted (for "last fetched"), the token never reaches the log.
    expect((await t.get(feedApi(), uma)).json().feed.lastUsedAt).toEqual(expect.any(String));
    expect(t.logs).toContain('/api/calendar-feed/[REDACTED]');
    expect(t.logs).not.toContain(token);
  });

  it('includes only own and shared entries for "Mine", and the scope can change without a new link', async () => {
    const { url } = (await t.post(feedApi(), { scope: 'MINE' }, uma)).json();
    await remind('Shared chore', inDays(2));
    await remind('Uma task', inDays(2), { assigneeUserId: idOf('uma@example.org') });
    await remind('Gus task', inDays(2), { assigneeUserId: idOf('gus@example.org') });
    const mine = (await t.get(pathOf(url))).body;
    expect(mine).toContain('Shared chore');
    expect(mine).toContain('Uma task');
    expect(mine).not.toContain('Gus task');
    expect((await t.post(`${feedApi()}/scope`, { scope: 'ALL' }, uma)).json().feed.scope).toBe('ALL');
    expect((await t.get(pathOf(url))).body).toContain('Gus task');
  });

  it('answers every unusable link with the same 404: unknown, replaced, turned off, malformed', async () => {
    const first = (await t.post(feedApi(), { scope: 'ALL' }, uma)).json().url;
    const second = (await t.post(feedApi(), { scope: 'ALL' }, uma)).json().url;
    expect(second).not.toBe(first);
    expect((await t.get(pathOf(first))).statusCode).toBe(404);
    expect((await t.get(pathOf(second))).statusCode).toBe(200);
    for (const path of ['/api/calendar-feed/' + 'A'.repeat(43) + '.ics', '/api/calendar-feed/short.ics', `/api/calendar-feed/${'A'.repeat(43)}`, '/api/calendar-feed/%00.ics']) {
      const response = await t.get(path);
      expect({ path, status: response.statusCode, body: response.body }).toEqual({ path, status: 404, body: 'Not found' });
    }
    expect((await t.post(`${feedApi()}/delete`, {}, uma)).statusCode).toBe(204);
    expect((await t.get(pathOf(second))).body).toBe('Not found');
    expect((await t.post(`${feedApi()}/delete`, {}, uma)).json()).toEqual({ error: 'calendar_feed_not_found' });
    expect((await t.post(`${feedApi()}/scope`, { scope: 'MINE' }, uma)).json()).toEqual({ error: 'calendar_feed_not_found' });
  });

  it('re-checks access on every fetch: calendar off, membership removed, account disabled', async () => {
    const { url } = (await t.post(feedApi(), { scope: 'ALL' }, gus)).json();
    expect((await t.get(pathOf(url))).statusCode).toBe(200);
    // Calendar tool switched off: the link answers 404, and comes back when it is on again.
    await t.post(`/api/workspaces/${home}/tools`, { tool: 'CALENDAR', enabled: false }, t.admin);
    expect((await t.get(pathOf(url))).statusCode).toBe(404);
    expect((await t.post(feedApi(), { scope: 'ALL' }, gus)).statusCode).toBe(404);
    await t.post(`/api/workspaces/${home}/tools`, { tool: 'CALENDAR', enabled: true }, t.admin);
    expect((await t.get(pathOf(url))).statusCode).toBe(200);
    // Disabled account: 404 while disabled; the link is gone afterwards (access revoked).
    await t.post(`/api/admin/accounts/${idOf('gus@example.org')}/status`, { status: 'DISABLED', password: PASSWORD }, t.admin);
    expect((await t.get(pathOf(url))).statusCode).toBe(404);
    await t.post(`/api/admin/accounts/${idOf('gus@example.org')}/status`, { status: 'ACTIVE', password: PASSWORD }, t.admin);
    expect((await t.get(pathOf(url))).statusCode).toBe(404);
    // Removed from the Workspace: the link is deleted and does not come back on re-joining.
    const again = (await t.post(feedApi(), { scope: 'ALL' }, uma)).json().url;
    await t.post(`/api/workspaces/${home}/members/${idOf('uma@example.org')}/remove`, {}, t.admin);
    expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM calendar_feeds WHERE user_id = ?').get(idOf('uma@example.org'))).toEqual({ n: 0 });
    await t.addMember(home, 'uma@example.org', 'USER');
    expect((await t.get(pathOf(again))).statusCode).toBe(404);
  });

  it('keeps links per person and Workspace, records changes without the token, and needs a session to manage', async () => {
    const homeUrl = (await t.post(feedApi(home), { scope: 'ALL' }, uma)).json().url;
    const officeUrl = (await t.post(feedApi(office), { scope: 'ALL' }, uma)).json().url;
    expect(homeUrl).not.toBe(officeUrl);
    expect((await t.get(pathOf(officeUrl))).body).toContain('X-WR-CALNAME:VMN · Office');
    // Gus sees only his own (none), never Uma's.
    expect((await t.get(feedApi(home), gus)).json()).toEqual({ feed: null });
    // Uma is not in another Workspace of Ada's.
    const other = await t.createWorkspace('Other');
    expect((await t.post(feedApi(other), { scope: 'ALL' }, uma)).statusCode).toBe(404);
    expect((await t.get(feedApi(home))).statusCode).toBe(401);
    expect((await t.post(feedApi(home), { scope: 'ALL' }, uma, null)).statusCode).toBe(403);
    expect((await t.post(feedApi(home), { scope: 'SOME' }, uma)).statusCode).toBe(400);
    const events = t.database.sqlite.prepare("SELECT metadata FROM security_events WHERE type = 'CALENDAR_FEED_CHANGED'").all() as { metadata: string }[];
    expect(events.length).toBe(2);
    const token = /([A-Za-z0-9_-]{43})\.ics$/.exec(homeUrl)?.[1] ?? '';
    expect(JSON.stringify(events)).not.toContain(token);
  });

  it('writes valid iCalendar text: escaping and line folding', () => {
    expect(escapeText('a\\b;c,d\ne\u0007')).toBe('a\\\\b\\;c\\,d\\ne');
    const folded = foldLine(`SUMMARY:${'ü'.repeat(60)}`);
    for (const line of folded.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(folded.split('\r\n').map((line, index) => (index === 0 ? line : line.slice(1))).join('')).toBe(`SUMMARY:${'ü'.repeat(60)}`);
  });
});
