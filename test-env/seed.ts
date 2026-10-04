// Creates demo accounts and Workspaces for the local test environment through the public HTTP
// API and the real invitation emails (read back from Mailpit). No database shortcuts: the same
// authorization rules apply as for a person clicking through the app.
//
// Run by test-env/install.sh; expects the server and Mailpit to be running.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  if (method === 'POST' && path.endsWith('/tools') && body !== undefined) {
    const current = await api<{ revision: number }>('GET', path, undefined, cookie);
    body = { ...body, expectedRevision: current.data.revision };
  }
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
// The demo deliberately enables the tools it showcases; fresh Workspaces otherwise start empty.
for (const workspaceId of [household, office]) {
  for (const tool of ['PROCEDURES', 'REMINDERS', 'LISTS', 'CALENDAR']) {
    const { data } = await api<{ revision: number }>('GET', `/workspaces/${workspaceId}/tools`, undefined, admin);
    await api('POST', `/workspaces/${workspaceId}/tools`, { tool, enabled: true, expectedRevision: data.revision }, admin);
  }
}
const memberships = [
  [household, 'editor@vmn.test', 'EDITOR'],
  [household, 'user@vmn.test', 'USER'],
  [household, 'guest@vmn.test', 'GUEST'],
  [office, 'outsider@vmn.test', 'USER'],
] as const;
for (const [workspaceId, email, role] of memberships) {
  await api('POST', `/workspaces/${workspaceId}/members`, { email, role }, admin);
}

// Procedures are authored by the editor, like in real use.
const editor = await signIn('editor@vmn.test');
const check = (title: string, extra: object = {}) => ({
  title,
  required: true,
  critical: false,
  skipReasonPolicy: 'OPTIONAL',
  notApplicableReasonPolicy: 'OPTIONAL',
  ...extra,
});
const procedures = [
  {
    title: 'Leave the house',
    icon: 'home',
    tags: ['daily', 'safety'],
    description: 'Before everyone leaves.',
    sections: [
      {
        title: 'Kitchen',
        steps: [
          check('Stove and oven off', { critical: true, icon: 'kitchen', skipReasonPolicy: 'DISABLED' }),
          check('Dishwasher started', { required: false }),
        ],
      },
      {
        title: 'Everywhere',
        steps: [
          check('Windows closed', { notApplicableReasonPolicy: 'REQUIRED' }),
          check('Lights off', { required: false, skipReasonPolicy: 'DISABLED' }),
          check('Front door locked', { critical: true, icon: 'security', skipReasonPolicy: 'REQUIRED' }),
        ],
      },
    ],
  },
  {
    title: 'Weekly cleaning',
    icon: 'cleaning',
    tags: ['weekly'],
    description: 'Kitchen, bathroom, floors.',
    sections: [
      { title: 'Kitchen', steps: [check('Wipe counters'), check('Clean fridge', { required: false })] },
      { title: 'Bathroom', steps: [check('Clean sink and toilet'), check('Replace towels')] },
      { title: 'Floors', steps: [check('Vacuum'), check('Mop', { required: false })] },
    ],
  },
  {
    title: 'Pack for a trip',
    icon: 'travel',
    tags: ['travel'],
    description: '',
    sections: [
      {
        title: 'Documents',
        steps: [check('Passport / ID', { critical: true, icon: 'document' }), check('Tickets'), check('Insurance card')],
      },
      { title: 'Bag', steps: [check('Chargers'), check('Medication', { icon: 'health', notApplicableReasonPolicy: 'DISABLED' })] },
    ],
  },
];
const procedureIds: string[] = [];
for (const procedure of procedures) {
  const { data } = await api<{ procedure: { id: string } }>('POST', `/workspaces/${household}/procedures`, procedure, editor);
  procedureIds.push(data.procedure.id);
}
await api('POST', '/auth/sign-out', {}, editor);

// One active Run, started by the USER account; for Home (13.9, 14.2): one scheduled item due today, one in
// a week with reminders, two Reminders and a pinned Procedure.
const member = await signIn('user@vmn.test');
await api('POST', `/workspaces/${household}/runs`, { procedureId: procedureIds[0] }, member);
const localDate = (offsetDays: number) => {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
await api('POST', `/workspaces/${household}/schedules`, { procedureId: procedureIds[1], date: localDate(0), timeZone, reminders: [] }, member);
await api(
  'POST',
  `/workspaces/${household}/schedules`,
  { procedureId: procedureIds[procedureIds.length - 1], date: localDate(7), timeZone, reminders: [{ unit: 'DAYS', amount: 1 }, { unit: 'DAYS', amount: 0 }] },
  member,
);
// Standalone Reminders (14.1): a yearly one with month/week reminders, one counted from the last completion.
await api(
  'POST',
  `/workspaces/${household}/schedules`,
  { title: 'Pay the annual tax', date: localDate(30), timeZone, recurrence: { kind: 'FIXED', unit: 'YEAR', interval: 1 }, reminders: [{ unit: 'MONTHS', amount: 1 }, { unit: 'WEEKS', amount: 1 }] },
  member,
);
await api(
  'POST',
  `/workspaces/${household}/schedules`,
  { title: 'Change the water filter', date: localDate(1), timeZone, recurrence: { kind: 'AFTER_COMPLETION', unit: 'MONTH', interval: 6 }, reminders: [{ unit: 'DAYS', amount: 0 }] },
  member,
);
// A grocery list (15.3) with something to buy and something already purchased.
interface SeededList {
  readonly list: { readonly id: string; readonly items: readonly { readonly id: string }[] };
}
let groceries = (await api<SeededList>('POST', `/workspaces/${household}/lists`, { title: 'Groceries' }, member)).data;
for (const item of [{ title: 'Milk', quantity: '2', unit: 'l' }, { title: 'Bread' }, { title: 'Flour', quantity: '1.5', unit: 'kg' }, { title: 'Coffee' }]) {
  groceries = (await api<SeededList>('POST', `/workspaces/${household}/lists/${groceries.list.id}/items`, item, member)).data;
}
const coffee = groceries.list.items.at(-1);
if (coffee !== undefined) await api('POST', `/workspaces/${household}/lists/${groceries.list.id}/items/${coffee.id}/check`, { checked: true }, member);
// Documents (16.2): switched on by the Workspace admin for the Household only; two nested Folders and a
// bill of two pages, uploaded like a person would (the fixture files of the media tests).
await api('POST', `/workspaces/${household}/tools`, { tool: 'DOCUMENTS', enabled: true }, admin);
async function uploadFile(name: string, fixture: string): Promise<string> {
  const response = await fetch(`${origin}/api/workspaces/${household}/document-files`, {
    method: 'POST',
    headers: { origin, cookie: member, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name) },
    body: readFileSync(join(import.meta.dirname, '../packages/media/src/fixtures', fixture)),
  });
  if (!response.ok) throw new Error(`upload of ${name} failed: ${response.status} ${await response.text()}`);
  return ((await response.json()) as { file: { id: string } }).file.id;
}
interface SeededFolder {
  readonly folder: { readonly id: string };
}
const water = (await api<SeededFolder>('POST', `/workspaces/${household}/document-folders`, { name: 'Water', parentId: null }, member)).data.folder.id;
const thisYear = (await api<SeededFolder>('POST', `/workspaces/${household}/document-folders`, { name: String(new Date().getFullYear()), parentId: water }, member)).data.folder.id;
await api('POST', `/workspaces/${household}/document-folders`, { name: 'Insurance', parentId: null }, member);
interface SeededDocument {
  readonly document: { readonly id: string };
}
const waterBill = await api<SeededDocument>(
  'POST',
  `/workspaces/${household}/documents`,
  {
    title: 'Water bill',
    folderId: thisYear,
    fileIds: [await uploadFile('water-bill.pdf', 'three-pages.pdf'), await uploadFile('IMG_0001.HEIC', 'photo.heic')],
    type: { builtIn: 'bill' },
    documentDate: localDate(-20),
    year: new Date().getFullYear(),
    tags: ['water'],
  },
  member,
);
// Contacts (16.6) and Maintenance (16.7): switched on for the Household as well. A plumber and an office;
// one maintenance record in each status that matters for a first look — the completed one with its
// technician, its cost and the bill as evidence.
await api('POST', `/workspaces/${household}/tools`, { tool: 'CONTACTS', enabled: true }, admin);
await api('POST', `/workspaces/${household}/tools`, { tool: 'MAINTENANCE', enabled: true }, admin);
interface SeededContact {
  readonly contact: { readonly id: string };
}
const plumber = (
  await api<SeededContact>(
    'POST',
    `/workspaces/${household}/contacts`,
    { name: 'Plumber Rossi', category: 'Plumber', organisation: 'Rossi Impianti', phones: [{ value: '+39 0471 123456', label: 'Office' }, { value: '333 1234567', label: 'Mobile' }], emails: [{ value: 'rossi@example.org' }] },
    member,
  )
).data.contact.id;
await api('POST', `/workspaces/${household}/contacts`, { name: 'Water utility', category: 'Utility', phones: [{ value: '0471 997111' }], website: 'https://example.org' }, member);
await api('POST', `/workspaces/${household}/contacts/${plumber}/procedures`, { procedureId: procedureIds[0] }, member);
interface SeededRecord {
  readonly record: { readonly id: string; readonly revision: number };
}
const maintenance = async (body: object) => (await api<SeededRecord>('POST', `/workspaces/${household}/maintenance`, body, member)).data.record;
await maintenance({ title: 'Clean the gutters', category: 'Roof', date: localDate(30) });
const boiler = await maintenance({ title: 'Boiler service', category: 'Heating', date: localDate(7), contactId: plumber });
await api('POST', `/workspaces/${household}/maintenance/${boiler.id}/status`, { status: 'IN_PROGRESS', expectedRevision: boiler.revision }, member);
const pipe = await maintenance({ title: 'Fix the leaking pipe', category: 'Water', date: localDate(-25), contactId: plumber, cost: { amount: '120.00', currency: 'EUR' } });
await api('POST', `/workspaces/${household}/maintenance/${pipe.id}/status`, { status: 'COMPLETED', expectedRevision: pipe.revision, completedOn: localDate(-21) }, member);
await api('POST', `/workspaces/${household}/maintenance/${pipe.id}/links`, { target: { type: 'document', id: waterBill.data.document.id } }, member);
await api('POST', `/workspaces/${household}/procedures/${procedureIds[0]}/pin`, {}, member);
await api('POST', '/auth/sign-out', {}, member);
// The admin stays signed in until here: switching the optional tools on needs a Workspace admin.
await api('POST', `/workspaces/${household}/tools`, {tool:'EQUIPMENT',enabled:true},admin);
const heating=await api<{record:{id:string}}>('POST', `/workspaces/${household}/equipment`,{name:'Boiler',category:'Heating',location:'Cellar',manufacturer:'Example Heating',model:'Demo 200',serialNumber:'DEMO-001',purchaseDate:'2024-03-01',warrantyExpiry:localDate(365)},member);
await api('POST', `/workspaces/${household}/equipment/${heating.data.record.id}/links`,{target:{type:'contact',id:plumber}},member);
await api('POST', `/workspaces/${household}/equipment/${heating.data.record.id}/links`,{target:{type:'maintenance',id:boiler.id}},member);
await api('POST', '/auth/sign-out', {}, admin);
console.log(`Created ${people.length + 1} accounts, 2 Workspaces, ${procedures.length} Procedures, 1 Run, 2 scheduled Procedures, 2 Reminders, 1 grocery list, 3 document folders with 1 document, 2 contacts, 3 maintenance records and 1 pin.`);
