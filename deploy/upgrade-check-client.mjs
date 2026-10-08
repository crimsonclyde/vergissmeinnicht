// Drives a running VMN server over HTTP for deploy/upgrade-check.sh (fictional data only).
// Usage: node upgrade-check-client.mjs populate <base> <invitePath> | node upgrade-check-client.mjs verify <base>
const [mode, base, invitePath] = process.argv.slice(2);
const PASSWORD = 'violet anchor lantern marmalade';
let cookie = '';

async function call(method, path, body, raw) {
  const headers = { origin: base, ...(cookie ? { cookie } : {}) };
  let payload;
  if (raw !== undefined) {
    headers['content-type'] = 'application/octet-stream';
    if (raw.name) headers['x-file-name'] = encodeURIComponent(raw.name);
    payload = raw.bytes;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const response = await fetch(base + path, { method, headers, body: payload });
  const setCookie = response.headers.getSetCookie?.() ?? [];
  for (const each of setCookie) if (/session_token=/.test(each) && !/Max-Age=0/.test(each)) cookie = each.split(';')[0];
  const type = response.headers.get('content-type') ?? '';
  const result = type.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${JSON.stringify(result).slice(0, 200)}`);
  return result;
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const signIn = () => call('POST', '/api/auth/sign-in', { email: 'admin@example.org', password: PASSWORD });

async function tool(workspaceId, name) {
  const { toolsRevision } = await call('GET', `/api/workspaces/${workspaceId}`);
  await call('POST', `/api/workspaces/${workspaceId}/tools`, { tool: name, enabled: true, expectedRevision: toolsRevision });
}

if (mode === 'populate') {
  const token = /\/invite\/([A-Za-z0-9_-]+)/.exec(invitePath)[1];
  await call('POST', '/api/invitations/accept', { token, displayName: 'Ada Älteste', password: PASSWORD });
  await signIn();
  const { workspace } = await call('POST', '/api/workspaces', { name: 'Upgrade-Haus 🏠' });
  const ws = `/api/workspaces/${workspace.id}`;
  for (const name of ['PROCEDURES', 'REMINDERS', 'LISTS', 'CALENDAR', 'DOCUMENTS', 'CONTACTS', 'MAINTENANCE', 'EQUIPMENT']) await tool(workspace.id, name);
  const step = { title: 'Herd aus', description: '', icon: null, required: true, critical: false, skipReasonPolicy: 'OPTIONAL', notApplicableReasonPolicy: 'OPTIONAL' };
  const { procedure } = await call('POST', `${ws}/procedures`, { title: 'Abreise', description: 'Vor dem Gehen', icon: 'home', tags: ['haus'], sections: [{ title: 'Küche', description: '', steps: [step] }] });
  const { run } = await call('POST', `${ws}/runs`, { procedureId: procedure.id });
  await call('POST', `${ws}/runs/${run.id}/steps/${run.sections[0].steps[0].id}/state`, { expectedState: 'PENDING', state: 'DONE' });
  await call('POST', `${ws}/runs/${run.id}/complete`, {});
  const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  await call('POST', `${ws}/schedules`, { title: 'Müll rausbringen', date: soon, timeZone: 'Europe/Rome', recurrence: { kind: 'FIXED', unit: 'WEEK', interval: 1 }, reminders: [{ unit: 'DAYS', amount: 1 }] });
  const { list } = await call('POST', `${ws}/lists`, { title: 'Einkauf' });
  for (const title of ['Milch', 'Caffè']) await call('POST', `${ws}/lists/${list.id}/items`, { title });
  const { file } = await call('POST', `${ws}/document-files`, undefined, { bytes: PNG, name: 'Rechnung.png' });
  const { document } = await call('POST', `${ws}/documents`, { title: 'Rechnung', folderId: null, fileIds: [file.id] });
  await call('POST', `${ws}/documents/${document.id}/links`, { target: { type: 'procedure', id: procedure.id } });
  const { contact } = await call('POST', `${ws}/contacts`, { name: 'Installateur Rossi', phones: [{ value: '0471 123456' }] });
  await call('POST', `${ws}/maintenance`, { title: 'Heizung', contactId: contact.id });
  await call('POST', `${ws}/equipment`, { name: 'Boiler' });
  console.log(workspace.id);
} else if (mode === 'verify') {
  await signIn();
  const { workspaces } = await call('GET', '/api/workspaces');
  const source = workspaces.find((each) => each.name === 'Upgrade-Haus 🏠');
  if (source === undefined) throw new Error('workspace missing after upgrade');
  const ws = `/api/workspaces/${source.id}`;
  const { runs } = await call('GET', `${ws}/runs`).catch(() => ({ runs: null }));
  // The upgraded server makes a backup of the old Workspace and restores it as a new one.
  await call('POST', `${ws}/backups`, {});
  let job;
  for (let i = 0; i < 60 && job?.state !== 'READY'; i++) {
    await sleep(1000);
    [job] = (await call('GET', `${ws}/backups`)).jobs;
    if (job.state === 'FAILED') throw new Error(`export failed: ${job.errorCode}`);
  }
  const bytes = await call('GET', `${ws}/backups/${job.id}/download`);
  let { restore } = await call('POST', '/api/admin/workspace-restores', undefined, { bytes });
  for (let i = 0; i < 60 && !(restore.state === 'READY' && restore.phase === 'validated'); i++) {
    await sleep(1000);
    ({ restore } = await call('GET', `/api/admin/workspace-restores/${restore.id}`));
    if (restore.state === 'FAILED') throw new Error(`validation failed: ${restore.errorCode}`);
  }
  const preview = restore.preview;
  await call('POST', `/api/admin/workspace-restores/${restore.id}/confirm`, {});
  for (let i = 0; i < 60 && restore.phase !== 'restored'; i++) {
    await sleep(1000);
    ({ restore } = await call('GET', `/api/admin/workspace-restores/${restore.id}`));
    if (restore.state === 'FAILED') throw new Error(`restore failed: ${restore.errorCode}`);
  }
  const after = (await call('GET', '/api/workspaces')).workspaces;
  console.log(JSON.stringify({ sourceRuns: runs?.length ?? 'n/a', packageBytes: bytes.length, previewCounts: preview.counts, persons: preview.persons, restoredWorkspace: restore.workspaceId, workspacesBefore: workspaces.length, workspacesAfter: after.length }));
}
