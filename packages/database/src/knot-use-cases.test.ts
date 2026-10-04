import { createHash, randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  KnotAlreadyRevokedError,
  KnotLimitReachedError,
  KnotNotFoundError,
  KnotRecordNotFoundError,
  KnotTargetNotFoundError,
  NotAuthorizedError,
  WorkspaceNotFoundError,
  addMember,
  changeMemberRole,
  createKnot,
  createProcedure,
  createWorkspace,
  deleteProcedure,
  listKnots,
  removeMember,
  resolveKnot,
  restoreProcedure,
  revokeKnot,
  startRun,
  type InvitationTokens,
  type KnotDeps,
  type ProcedureDeps,
  type ProcedureInput,
  type RunDeps,
  type WorkspaceDeps,
} from '@vergissmeinnicht/application';
import { DomainValidationError, normalizeEmail, type KnotId, type KnotTarget, type User, type Workspace } from '@vergissmeinnicht/domain';
import { createKnotRepository } from './knot-repository.ts';
import { createProcedureRepository } from './procedure-repository.ts';
import { createRunRepository } from './run-repository.ts';
import { createTestDatabase } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';
import { createConfiguredWorkspaceRepository as createWorkspaceRepository } from './test-support.ts';

/** Same contract as the auth package's token service (256-bit base64url, SHA-256 hex). */
const tokens: InvitationTokens = {
  generate() {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: createHash('sha256').update(token).digest('hex') };
  },
  hash: (token) => (/^[A-Za-z0-9_-]{43}$/.test(token) ? createHash('sha256').update(token).digest('hex') : undefined),
};

const PROCEDURE: ProcedureInput = {
  title: 'Leave the house',
  description: '',
  icon: 'home',
  tags: [],
  sections: [
    {
      title: 'All',
      description: '',
      steps: [{ title: 'Stove off', description: '', icon: null, required: true, critical: false, skipReasonPolicy: 'OPTIONAL', notApplicableReasonPolicy: 'OPTIONAL' }],
    },
  ],
};

describe('Knot links', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let now: Date;
  let workspaceDeps: WorkspaceDeps;
  let procedureDeps: ProcedureDeps;
  let deps: KnotDeps;
  let admin: User;
  let editor: User;
  let member: User;
  let guest: User;
  let outsider: User;
  let home: Workspace;
  let office: Workspace;
  let procedureId: string;
  let runId: string;
  let officeProcedureId: string;

  const count = (table: string) => (database.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
  const create = (target: KnotTarget, overrides: { actor?: User; workspace?: Workspace; label?: string; expiresInDays?: number | null } = {}) =>
    createKnot(deps, {
      actor: overrides.actor ?? editor,
      workspaceId: (overrides.workspace ?? home).id,
      target,
      label: overrides.label ?? 'Front door',
      expiresInDays: overrides.expiresInDays === undefined ? null : overrides.expiresInDays,
    });
  const resolve = (actor: User, token: string) => resolveKnot(deps, { actor, token });

  beforeEach(async () => {
    database = createTestDatabase();
    now = new Date('2026-09-27T12:00:00.000Z');
    const clock = { now: () => now };
    const users = createUserRepository(database);
    workspaceDeps = { users, workspaces: createWorkspaceRepository(database), clock };
    procedureDeps = { workspaces: workspaceDeps.workspaces, procedures: createProcedureRepository(database), clock };
    const runDeps: RunDeps = { workspaces: workspaceDeps.workspaces, runs: createRunRepository(database), clock };
    deps = { workspaces: workspaceDeps.workspaces, knots: createKnotRepository(database), tokens, clock };
    const user = (email: string, name: string, serverAdmin = false) =>
      users.create({ email: normalizeEmail(email), displayName: name, emailVerified: true, status: 'ACTIVE', serverAdmin });
    admin = await user('admin@example.org', 'Ada', true);
    editor = await user('editor@example.org', 'Eddie');
    member = await user('user@example.org', 'Uma');
    guest = await user('guest@example.org', 'Gus');
    outsider = await user('outsider@example.org', 'Otto');
    home = await createWorkspace(workspaceDeps, { actor: admin, name: 'Home' });
    office = await createWorkspace(workspaceDeps, { actor: admin, name: 'Office' });
    for (const [u, role] of [
      [editor, 'EDITOR'],
      [member, 'USER'],
      [guest, 'GUEST'],
    ] as const) {
      await addMember(workspaceDeps, { actor: admin, workspaceId: home.id, email: u.email, role });
    }
    await addMember(workspaceDeps, { actor: admin, workspaceId: office.id, email: outsider.email, role: 'ADMIN' });
    procedureId = (await createProcedure(procedureDeps, { actor: editor, workspaceId: home.id, content: PROCEDURE })).procedure.id;
    runId = (await startRun(runDeps, { actor: member, workspaceId: home.id, procedureId: procedureId as never })).run.id;
    officeProcedureId = (await createProcedure(procedureDeps, { actor: outsider, workspaceId: office.id, content: PROCEDURE })).procedure.id;
  });

  afterEach(() => database.dispose());

  it('creates Knots for Procedures and Runs, storing only the token hash and auditing without it', async () => {
    const procedureKnot = await create({ type: 'PROCEDURE', id: procedureId }, { label: '  Front door  ', expiresInDays: 30 });
    expect(procedureKnot.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(procedureKnot.knot).toMatchObject({
      label: 'Front door',
      target: { type: 'PROCEDURE', id: procedureId },
      createdBy: { userId: editor.id, displayName: 'Eddie' },
      expiresAt: new Date('2026-10-27T12:00:00.000Z'),
      revoked: null,
    });
    const runKnot = await create({ type: 'RUN', id: runId });
    expect(runKnot.knot.expiresAt).toBeNull();

    const dump = JSON.stringify([
      database.sqlite.prepare('SELECT * FROM knots').all(),
      database.sqlite.prepare("SELECT * FROM audit_events WHERE subject_type = 'knot'").all(),
    ]);
    expect(dump).not.toContain(procedureKnot.token);
    expect(dump).not.toContain(runKnot.token);
    const stored = database.sqlite.prepare('SELECT token_hash FROM knots WHERE id = ?').get(procedureKnot.knot.id) as { token_hash: string };
    expect(stored.token_hash).toBe(tokens.hash(procedureKnot.token));

    const audit = database.sqlite
      .prepare("SELECT type, actor_user_id, metadata FROM audit_events WHERE subject_type = 'knot' ORDER BY rowid")
      .all() as { type: string; actor_user_id: string; metadata: string }[];
    expect(audit.map((row) => [row.type, row.actor_user_id])).toEqual([
      ['KNOT_CREATED', editor.id],
      ['KNOT_CREATED', editor.id],
    ]);
    expect(JSON.parse(audit[0]?.metadata ?? '{}')).toEqual({
      label: 'Front door',
      targetType: 'PROCEDURE',
      targetId: procedureId,
      expiresAt: '2026-10-27T12:00:00.000Z',
    });

    const listed = await listKnots(deps, { actor: admin, workspaceId: home.id });
    expect(listed.map((entry) => [entry.knot.label, entry.targetTitle, entry.targetAvailable])).toEqual([
      ['Front door', 'Leave the house', true],
      ['Front door', 'Leave the house', true],
    ]);
  });

  it('lets only EDITOR and ADMIN manage Knots, only within their own Workspace', async () => {
    await expect(create({ type: 'PROCEDURE', id: procedureId }, { actor: member })).rejects.toThrow(NotAuthorizedError);
    await expect(create({ type: 'RUN', id: runId }, { actor: guest })).rejects.toThrow(NotAuthorizedError);
    await expect(create({ type: 'RUN', id: runId }, { actor: outsider })).rejects.toThrow(WorkspaceNotFoundError);
    await expect(listKnots(deps, { actor: member, workspaceId: home.id })).rejects.toThrow(NotAuthorizedError);
    // Otto administers Office: Home's Procedure and Run cannot be linked through it, and vice versa.
    await expect(create({ type: 'PROCEDURE', id: procedureId }, { actor: outsider, workspace: office })).rejects.toThrow(KnotTargetNotFoundError);
    await expect(create({ type: 'RUN', id: runId }, { actor: outsider, workspace: office })).rejects.toThrow(KnotTargetNotFoundError);
    await expect(create({ type: 'PROCEDURE', id: officeProcedureId })).rejects.toThrow(KnotTargetNotFoundError);
    // A Run id is not a Procedure id.
    await expect(create({ type: 'PROCEDURE', id: runId })).rejects.toThrow(KnotTargetNotFoundError);
    expect(count('knots')).toBe(0);

    const { knot } = await create({ type: 'RUN', id: runId });
    await expect(revokeKnot(deps, { actor: member, workspaceId: home.id, knotId: knot.id })).rejects.toThrow(NotAuthorizedError);
    await expect(revokeKnot(deps, { actor: outsider, workspaceId: office.id, knotId: knot.id })).rejects.toThrow(KnotRecordNotFoundError);
    expect(await listKnots(deps, { actor: outsider, workspaceId: office.id })).toEqual([]);
  });

  it('validates label, lifetime and target before writing anything', async () => {
    const target = { type: 'PROCEDURE', id: procedureId } as const;
    await expect(create(target, { label: ' ' })).rejects.toThrow(expect.objectContaining({ code: 'knot_label_empty' }));
    await expect(create(target, { label: 'a‮b' })).rejects.toThrow(expect.objectContaining({ code: 'knot_label_invalid_characters' }));
    await expect(create(target, { expiresInDays: 0 })).rejects.toThrow(expect.objectContaining({ code: 'invalid_knot_expiry' }));
    await expect(create(target, { expiresInDays: 366 })).rejects.toThrow(DomainValidationError);
    await expect(create({ type: 'PROCEDURE', id: 'not-a-uuid' })).rejects.toThrow(expect.objectContaining({ code: 'invalid_target_id' }));
    expect(count('knots')).toBe(0);
    expect(count("audit_events WHERE subject_type = 'knot'")).toBe(0);
  });

  it('resolves only for signed-in members who may view the target', async () => {
    const procedureKnot = await create({ type: 'PROCEDURE', id: procedureId });
    const runKnot = await create({ type: 'RUN', id: runId });
    expect(await resolve(guest, procedureKnot.token)).toEqual({ workspaceId: home.id, target: { type: 'PROCEDURE', id: procedureId } });
    expect(await resolve(member, runKnot.token)).toEqual({ workspaceId: home.id, target: { type: 'RUN', id: runId } });
    // Possession of the token is not enough: a member of another Workspace learns nothing.
    await expect(resolve(outsider, runKnot.token)).rejects.toThrow(KnotNotFoundError);
    // Unknown and malformed tokens fail the same way.
    await expect(resolve(guest, tokens.generate().token)).rejects.toThrow(KnotNotFoundError);
    for (const token of ['', 'short', `${procedureKnot.token}x`, procedureKnot.token.toUpperCase()]) {
      await expect(resolve(guest, token)).rejects.toThrow(KnotNotFoundError);
    }
    // Removed members lose access at once.
    await removeMember(workspaceDeps, { actor: admin, workspaceId: home.id, userId: guest.id });
    await expect(resolve(guest, procedureKnot.token)).rejects.toThrow(KnotNotFoundError);
    // Disabled accounts too (the HTTP layer never yields a Principal for them either).
    await expect(resolve({ ...member, status: 'DISABLED' }, runKnot.token)).rejects.toThrow(KnotNotFoundError);
  });

  it('stops resolving when expired, revoked or the Procedure is deleted', async () => {
    const expiring = await create({ type: 'RUN', id: runId }, { expiresInDays: 1 });
    expect((await resolve(member, expiring.token)).target.type).toBe('RUN');
    now = new Date(now.getTime() + 86_400_000);
    await expect(resolve(member, expiring.token)).rejects.toThrow(KnotNotFoundError);

    const revoked = await create({ type: 'RUN', id: runId });
    await revokeKnot(deps, { actor: admin, workspaceId: home.id, knotId: revoked.knot.id });
    await expect(resolve(member, revoked.token)).rejects.toThrow(KnotNotFoundError);
    await expect(revokeKnot(deps, { actor: admin, workspaceId: home.id, knotId: revoked.knot.id })).rejects.toThrow(KnotAlreadyRevokedError);
    const events = database.sqlite.prepare("SELECT type, actor_display_name FROM audit_events WHERE type = 'KNOT_REVOKED'").all();
    expect(events).toEqual([{ type: 'KNOT_REVOKED', actor_display_name: 'Ada' }]);

    const procedureKnot = await create({ type: 'PROCEDURE', id: procedureId });
    await deleteProcedure(procedureDeps, { actor: editor, workspaceId: home.id, procedureId: procedureId as never });
    await expect(resolve(member, procedureKnot.token)).rejects.toThrow(KnotNotFoundError);
    expect((await listKnots(deps, { actor: editor, workspaceId: home.id })).find((e) => e.knot.id === procedureKnot.knot.id)).toMatchObject({
      targetAvailable: false,
    });
    await restoreProcedure(procedureDeps, { actor: editor, workspaceId: home.id, procedureId: procedureId as never });
    expect((await resolve(member, procedureKnot.token)).target.id).toBe(procedureId);
  });

  it('re-checks the actor inside the transaction and bounds active Knots', async () => {
    const knotsRepo = createKnotRepository(database);
    const racing: KnotDeps = {
      ...deps,
      knots: {
        ...knotsRepo,
        async create(...args) {
          await changeMemberRole(workspaceDeps, { actor: admin, workspaceId: home.id, userId: editor.id, role: 'USER' });
          return knotsRepo.create(...args);
        },
      },
    };
    await expect(createKnot(racing, { actor: editor, workspaceId: home.id, target: { type: 'RUN', id: runId }, label: 'x', expiresInDays: null })).rejects.toThrow(
      NotAuthorizedError,
    );
    expect(count('knots')).toBe(0);

    const actor = { kind: 'user', userId: admin.id, displayName: 'Ada' } as const;
    const guard = { actorMay: () => true };
    const input = { workspaceId: home.id, target: { type: 'RUN', id: runId } as const, label: 'x', at: now, expiresAt: null, maxActive: 1 };
    expect((await knotsRepo.create({ ...input, tokenHash: 'a'.repeat(64) }, actor, guard)).status).toBe('ok');
    expect((await knotsRepo.create({ ...input, tokenHash: 'b'.repeat(64) }, actor, guard)).status).toBe('limit_reached');
    const limited: KnotDeps = { ...deps, knots: { ...knotsRepo, create: async () => ({ status: 'limit_reached' }) } };
    // (Eddie is a USER by now; Ada still administers Home.)
    await expect(createKnot(limited, { actor: admin, workspaceId: home.id, target: { type: 'RUN', id: runId }, label: 'x', expiresInDays: null })).rejects.toThrow(
      KnotLimitReachedError,
    );
  });

  it('keeps Knot records append-only apart from a single revocation (DB triggers and checks)', async () => {
    const { knot } = await create({ type: 'RUN', id: runId });
    const run = (sql: string, ...params: unknown[]) => () => database.sqlite.prepare(sql).run(...params);
    expect(run('DELETE FROM knots WHERE id = ?', knot.id)).toThrow(/cannot be deleted/);
    expect(run("UPDATE knots SET label = 'Other' WHERE id = ?", knot.id)).toThrow(/only revocation/);
    expect(run('UPDATE knots SET expires_at = NULL, run_id = ? WHERE id = ?', runId, knot.id)).not.toThrow();
    expect(run('UPDATE knots SET procedure_id = ?, target_type = ?, run_id = NULL WHERE id = ?', procedureId, 'PROCEDURE', knot.id)).toThrow(
      /only revocation/,
    );
    expect(run("UPDATE knots SET token_hash = ? WHERE id = ?", 'c'.repeat(64), knot.id)).toThrow(/only revocation/);
    // Revocation needs all three columns, and happens once.
    expect(run('UPDATE knots SET revoked_at = 1 WHERE id = ?', knot.id)).toThrow(/CHECK constraint failed/);
    await revokeKnot(deps, { actor: editor, workspaceId: home.id, knotId: knot.id });
    expect(run('UPDATE knots SET revoked_at = NULL, revoked_by_user_id = NULL, revoked_by_display_name = NULL WHERE id = ?', knot.id)).toThrow(
      /only revocation/,
    );
    // A Knot must point at exactly one target of its type.
    const insert = (targetType: string, procedure: string | null, runRef: string | null) =>
      run(
        `INSERT INTO knots (id, workspace_id, token_hash, label, target_type, procedure_id, run_id, created_by_user_id, created_by_display_name, created_at)
         VALUES (?, ?, ?, 'x', ?, ?, ?, ?, 'Ada', 1)`,
        crypto.randomUUID(),
        home.id,
        randomBytes(32).toString('hex'),
        targetType,
        procedure,
        runRef,
        admin.id,
      );
    expect(insert('RUN', procedureId, runId)).toThrow(/CHECK constraint failed/);
    expect(insert('PROCEDURE', null, runId)).toThrow(/CHECK constraint failed/);
    expect(insert('WORKSPACE', null, null)).toThrow(/CHECK constraint failed/);
    expect(insert('RUN', null, runId)).not.toThrow();
  });

  it('never resolves a Knot id as a token', async () => {
    const { knot } = await create({ type: 'RUN', id: runId });
    await expect(resolve(member, knot.id)).rejects.toThrow(KnotNotFoundError);
    await expect(revokeKnot(deps, { actor: editor, workspaceId: home.id, knotId: '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f' as KnotId })).rejects.toThrow(
      KnotRecordNotFoundError,
    );
  });
});
