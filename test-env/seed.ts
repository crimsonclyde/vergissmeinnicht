// Creates demo accounts and Workspaces for the local test environment through the public HTTP
// API and the real invitation emails (read back from Mailpit). No database shortcuts: the same
// authorization rules apply as for a person clicking through the app.
//
// Run by test-env/install.sh; expects the server and Mailpit to be running.

import { setTimeout as sleep } from 'node:timers/promises';

const origin = requireEnv('VMN_TEST_ORIGIN');
const mailpit = requireEnv('VMN_TEST_MAILPIT');
const password = requireEnv('VMN_TEST_PASSWORD');
const bootstrapLink = requireEnv('VMN_TEST_BOOTSTRAP_LINK');

const INVITE_TOKEN = /\/invite\/([A-Za-z0-9_-]{43})/;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
}

async function api<T>(method: 'GET' | 'POST', path: string, body?: object, cookie?: string): Promise<{ data: T; headers: Headers }> {
  const response = await fetch(`${origin}/api${path}`, {
    method,
    headers: {
      // The server's CSRF guard requires the exact public origin on state-changing requests.
      origin,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie === undefined ? {} : { cookie }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} failed: ${response.status} ${text}`);
  return { data: (text === '' ? undefined : JSON.parse(text)) as T, headers: response.headers };
}

async function signIn(email: string): Promise<string> {
  const { headers } = await api('POST', '/auth/sign-in', { email, password });
  const session = headers
    .getSetCookie()
    .map((c) => c.split(';')[0] ?? '')
    .find((c) => c.includes('vmn.session_token='));
  if (session === undefined) throw new Error(`sign-in as ${email} returned no session`);
  return session;
}

async function accept(token: string, displayName: string): Promise<void> {
  await api('POST', '/invitations/accept', { token, displayName, password });
}

interface MailpitList {
  messages: { ID: string; To: { Address: string }[]; Created: string }[];
}

/** Newest invitation token emailed to `email`, polling Mailpit for a few seconds. */
async function invitationTokenFor(email: string, notBefore: Date): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const list = (await (await fetch(`${mailpit}/api/v1/messages?limit=50`)).json()) as MailpitList;
    const message = list.messages.find(
      (m) => m.To.some((to) => to.Address.toLowerCase() === email) && new Date(m.Created) >= notBefore,
    );
    if (message !== undefined) {
      const detail = (await (await fetch(`${mailpit}/api/v1/message/${message.ID}`)).json()) as { Text: string };
      const token = INVITE_TOKEN.exec(detail.Text)?.[1];
      if (token !== undefined) return token;
    }
    await sleep(250);
  }
  throw new Error(`no invitation email for ${email} arrived in Mailpit`);
}

const bootstrapToken = INVITE_TOKEN.exec(bootstrapLink)?.[1];
if (bootstrapToken === undefined) throw new Error('bootstrap link has no token');
await accept(bootstrapToken, 'Ada Admin');
const admin = await signIn('admin@vmn.test');

const people = [
  { email: 'editor@vmn.test', name: 'Eddie Editor' },
  { email: 'user@vmn.test', name: 'Uma User' },
  { email: 'guest@vmn.test', name: 'Gus Guest' },
  { email: 'outsider@vmn.test', name: 'Otto Outsider' },
] as const;
for (const person of people) {
  // Mailpit timestamps have second precision.
  const issuedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  const { data } = await api<{ delivery: string }>('POST', '/admin/invitations', { email: person.email }, admin);
  if (data.delivery !== 'sent') throw new Error(`invitation email to ${person.email} could not be sent`);
  await accept(await invitationTokenFor(person.email, issuedAt), person.name);
}

type Created = { workspace: { id: string } };
const household = (await api<Created>('POST', '/workspaces', { name: 'Demo Household' }, admin)).data.workspace.id;
const office = (await api<Created>('POST', '/workspaces', { name: 'Demo Office' }, admin)).data.workspace.id;
const memberships = [
  [household, 'editor@vmn.test', 'EDITOR'],
  [household, 'user@vmn.test', 'USER'],
  [household, 'guest@vmn.test', 'GUEST'],
  [office, 'outsider@vmn.test', 'USER'],
] as const;
for (const [workspaceId, email, role] of memberships) {
  await api('POST', `/workspaces/${workspaceId}/members`, { email, role }, admin);
}
await api('POST', '/auth/sign-out', {}, admin);

// Procedures are authored by the editor, like in real use.
const editor = await signIn('editor@vmn.test');
const procedures = [
  { title: 'Leave the house', icon: 'home', tags: ['daily', 'safety'], description: 'Before everyone leaves:\nwindows, stove, lights, door.' },
  { title: 'Weekly cleaning', icon: 'cleaning', tags: ['weekly'], description: 'Kitchen, bathroom, floors.' },
  { title: 'Pack for a trip', icon: 'travel', tags: ['travel'], description: '' },
];
for (const procedure of procedures) {
  await api('POST', `/workspaces/${household}/procedures`, procedure, editor);
}
await api('POST', '/auth/sign-out', {}, editor);
console.log(`Created ${people.length + 1} accounts, 2 Workspaces and ${procedures.length} Procedures.`);
