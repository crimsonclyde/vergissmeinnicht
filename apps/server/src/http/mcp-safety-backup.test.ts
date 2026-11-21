import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createAiBackupService } from '../mcp/safety-backup.ts';
import { connectAssistant } from './mcp-test-client.ts';
import { startTestApp } from './test-harness.ts';

/** 48.1: a verified server backup before AI changes, at most one per interval, refused change when it fails. */
describe('AI safety backups', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  afterEach(async () => {
    await t?.close();
  });
  const backupFiles = () => (existsSync(t.paths.aiBackups) ? readdirSync(t.paths.aiBackups).filter((name) => name.endsWith('.sqlite')) : []);

  it('backs up before the first change, not before reads, and lists who triggered it', async () => {
    t = await startTestApp({ mcpEnabled: true });
    const workspaceId = await t.createWorkspace('Casa Nostra');
    const assistant = await connectAssistant(t, t.admin, [workspaceId], ['workspaces.read', 'lists.read', 'lists.write'], 'ChatGPT');
    await assistant.body('list_grocery_lists', { workspaceId });
    expect(backupFiles()).toEqual([]);
    const listId = randomUUID();
    await assistant.body('create_grocery_list', { workspaceId, listId, operationId: randomUUID(), title: 'Weekend' });
    const [file] = backupFiles();
    expect(file).toMatch(/^vergissmeinnicht-ai-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.sqlite$/);
    // The backup holds the state before the change: the new List is not in it.
    const snapshot = new DatabaseSync(join(t.paths.aiBackups, String(file)), { readOnly: true });
    try {
      expect(snapshot.prepare('SELECT count(*) AS n FROM lists WHERE id = ?').get(listId)).toMatchObject({ n: 0 });
      expect(snapshot.prepare('SELECT count(*) AS n FROM workspaces WHERE id = ?').get(workspaceId)).toMatchObject({ n: 1 });
    } finally {
      snapshot.close();
    }
    // A second change inside the interval reuses that backup.
    await assistant.body('create_grocery_list', { workspaceId, listId: randomUUID(), operationId: randomUUID(), title: 'Market' });
    expect(backupFiles()).toHaveLength(1);

    const listed = await t.get('/api/admin/mcp/backups', t.admin);
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual({
      settings: { intervalMinutes: 30, keep: 48 },
      backups: [expect.objectContaining({ name: file, person: 'Ada', assistant: 'ChatGPT', workspace: 'Casa Nostra', tool: 'create_grocery_list', bytes: expect.any(Number) })],
    });
  });

  it('refuses the change when the backup cannot be written', async () => {
    t = await startTestApp({ mcpEnabled: true, aiBackupWrite: async () => { throw new Error('disk full'); } });
    const workspaceId = await t.createWorkspace('Casa Nostra');
    const assistant = await connectAssistant(t, t.admin, [workspaceId], ['workspaces.read', 'lists.read', 'lists.write']);
    const listId = randomUUID();
    expect(await assistant.error('create_grocery_list', { workspaceId, listId, operationId: randomUUID(), title: 'Weekend' })).toMatchObject({ code: 'backup_failed' });
    expect((await assistant.body('list_grocery_lists', { workspaceId })).lists).toEqual([]);
    expect(backupFiles()).toEqual([]);
  });

  it('shows the list only to server admins', async () => {
    t = await startTestApp({ mcpEnabled: true });
    const member = await t.invite('bo@example.org', 'Bo');
    expect((await t.get('/api/admin/mcp/backups', member)).statusCode).toBe(403);
    expect((await t.get('/api/admin/mcp/backups')).statusCode).toBe(401);
  });
});

describe('AI safety backup service', () => {
  const trigger = { userId: randomUUID(), clientId: 'client', workspaceId: null, tool: 'add_reminder' };

  it('writes at most one per interval, keeps the newest and shares a backup between parallel calls', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vmn-ai-backup-'));
    let now = new Date('2026-11-21T10:00:00.000Z');
    let writes = 0;
    const service = createAiBackupService({ dir, intervalMinutes: 30, keep: 2, now: () => now, write: async (target) => { writes++; writeFileSync(target, 'x'); } });
    const parallel = await Promise.all([service.beforeChange(trigger), service.beforeChange(trigger), service.beforeChange(trigger)]);
    expect(writes).toBe(1);
    expect(parallel.filter((result) => result.written !== null)).toHaveLength(1);
    now = new Date('2026-11-21T10:29:59.000Z');
    expect((await service.beforeChange(trigger)).written).toBeNull();
    for (const at of ['2026-11-21T10:30:00.000Z', '2026-11-21T11:00:00.000Z', '2026-11-21T11:30:00.000Z']) {
      now = new Date(at);
      expect((await service.beforeChange(trigger)).written).not.toBeNull();
    }
    expect(writes).toBe(4);
    expect(service.list().map((entry) => entry.createdAt.toISOString())).toEqual(['2026-11-21T11:30:00.000Z', '2026-11-21T11:00:00.000Z']);
    expect(service.list()[0]?.trigger).toEqual(trigger);
    // Side files of removed backups go with them.
    expect(readdirSync(dir).sort()).toEqual(['vergissmeinnicht-ai-2026-11-21T11-00-00.000Z.sqlite', 'vergissmeinnicht-ai-2026-11-21T11-00-00.000Z.sqlite.json', 'vergissmeinnicht-ai-2026-11-21T11-30-00.000Z.sqlite', 'vergissmeinnicht-ai-2026-11-21T11-30-00.000Z.sqlite.json']);
  });

  it('removes nothing but its own files and leaves no partial backup listed after a failure', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vmn-ai-backup-'));
    writeFileSync(join(dir, 'vergissmeinnicht-auto-2026-11-20T00-00-00.000Z.sqlite'), 'scheduled');
    const service = createAiBackupService({ dir, intervalMinutes: 5, keep: 1, write: async () => { throw new Error('disk full'); } });
    await expect(service.beforeChange(trigger)).rejects.toThrow('AI safety backup failed');
    expect(service.list()).toEqual([]);
    expect(readdirSync(dir)).toEqual(['vergissmeinnicht-auto-2026-11-20T00-00-00.000Z.sqlite']);
  });
});
