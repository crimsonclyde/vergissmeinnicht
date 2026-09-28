import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  NotAuthorizedError,
  StepStateConflictError,
  addMember,
  changeStepState,
  completeRun,
  createProcedure,
  createWorkspace,
  getRun,
  startRun,
  type ProcedureInput,
  type RunChangeNotifier,
  type RunDeps,
} from '@vergissmeinnicht/application';
import { DomainValidationError, normalizeEmail, type RunDetail, type RunStep, type User, type Workspace } from '@vergissmeinnicht/domain';
import { createProcedureRepository } from './procedure-repository.ts';
import { createRunRepository } from './run-repository.ts';
import { createTestDatabase } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';
import { createWorkspaceRepository } from './workspace-repository.ts';

const STEP = { description: '', icon: null, required: false, critical: false, skipReasonPolicy: 'OPTIONAL', notApplicableReasonPolicy: 'OPTIONAL' } as const;
const PROCEDURE: ProcedureInput = {
  title: 'Leave the house',
  description: '',
  icon: 'home',
  tags: [],
  sections: [{ title: 'All', description: '', steps: [{ ...STEP, title: 'Router off' }, { ...STEP, title: 'Door locked' }] }],
};

describe('offline Step changes (Step 8.5)', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let deps: RunDeps;
  let now: Date;
  let announced: number;
  let admin: User;
  let uma: User;
  let cole: User;
  let home: Workspace;
  let run: RunDetail;
  let router: RunStep;
  let door: RunStep;

  const offline = (actor: User, step: RunStep, deviceTime: Date | undefined, id: string = randomUUID(), expectedState: 'PENDING' | 'DONE' = 'PENDING', to: 'PENDING' | 'DONE' = 'DONE') =>
    changeStepState(deps, {
      actor,
      workspaceId: home.id,
      runId: run.run.id,
      stepId: step.id,
      expectedState,
      to,
      offline: { clientChangeId: id, deviceAt: deviceTime },
    });
  const stepNow = async (step: RunStep) =>
    (await getRun(deps, { actor: uma, workspaceId: home.id, runId: run.run.id })).sections[0]?.steps.find((s) => s.id === step.id);
  const events = () =>
    database.sqlite.prepare("SELECT metadata, client_change_id AS id FROM audit_events WHERE type = 'STEP_STATE_CHANGED' ORDER BY rowid").all() as {
      metadata: string;
      id: string | null;
    }[];

  beforeEach(async () => {
    database = createTestDatabase();
    now = new Date('2026-09-28T10:00:00Z');
    announced = 0;
    const clock = { now: () => now };
    const users = createUserRepository(database);
    const workspaces = createWorkspaceRepository(database);
    const changes: RunChangeNotifier = { runChanged: () => void (announced += 1) };
    deps = { workspaces, runs: createRunRepository(database), clock, changes };
    const user = (email: string, name: string, serverAdmin = false) =>
      users.create({ email: normalizeEmail(email), displayName: name, emailVerified: true, status: 'ACTIVE', serverAdmin });
    admin = await user('admin@example.org', 'Ada', true);
    uma = await user('uma@example.org', 'Uma');
    cole = await user('cole@example.org', 'Cole');
    home = await createWorkspace({ users, workspaces, clock }, { actor: admin, name: 'Home' });
    for (const member of [uma, cole]) await addMember({ users, workspaces, clock }, { actor: admin, workspaceId: home.id, email: member.email, role: 'USER' });
    const procedure = await createProcedure({ workspaces, procedures: createProcedureRepository(database), clock }, { actor: admin, workspaceId: home.id, content: PROCEDURE });
    run = await startRun(deps, { actor: uma, workspaceId: home.id, procedureId: procedure.procedure.id });
    [router, door] = run.sections[0]?.steps as [RunStep, RunStep];
  });
  afterEach(() => database.dispose());

  it('keeps the server time authoritative and stores a plausible device time next to it', async () => {
    const deviceTime = new Date('2026-09-28T10:10:00Z'); // after the Run started at 10:00
    now = new Date('2026-09-28T10:30:00Z');
    const result = await offline(uma, router, deviceTime);
    expect(result.duplicate).toBe(false);
    expect(result.step.stateChange).toMatchObject({ at: now, deviceAt: deviceTime });
    const [event] = events();
    expect(JSON.parse(event?.metadata ?? '{}')).toMatchObject({ offline: true, deviceTime: deviceTime.toISOString() });
    expect(announced).toBe(1);
  });

  it('drops an implausible device time but applies the change', async () => {
    const result = await offline(uma, router, new Date('2020-01-01T00:00:00Z'));
    expect(result.step.state).toBe('DONE');
    expect(result.step.stateChange?.deviceAt).toBeNull();
    expect(JSON.parse(events()[0]?.metadata ?? '{}')).not.toHaveProperty('deviceTime');
  });

  it('applies the same offline change once, also after the Run finished', async () => {
    const id = randomUUID();
    await offline(uma, router, undefined, id);
    const again = await offline(uma, router, undefined, id);
    expect(again).toMatchObject({ duplicate: true, step: { state: 'DONE' } });
    expect(events()).toHaveLength(1);
    expect(announced).toBe(1);
    await offline(uma, door, undefined);
    await completeRun(deps, { actor: uma, workspaceId: home.id, runId: run.run.id });
    await expect(offline(uma, router, undefined, id)).resolves.toMatchObject({ duplicate: true });
  });

  it('never lets a change id stand for another Step, and ids are per actor', async () => {
    const id = randomUUID();
    await offline(uma, router, undefined, id);
    await expect(offline(uma, door, undefined, id)).rejects.toBeInstanceOf(StepStateConflictError);
    // Cole reusing Uma's id is his own, separate change.
    await expect(offline(cole, door, undefined, id)).resolves.toMatchObject({ duplicate: false });
    expect(events().map((event) => event.id)).toEqual([id, id]);
  });

  it('reports a conflict when someone changed the Step meanwhile — never overwrites', async () => {
    await changeStepState(deps, { actor: cole, workspaceId: home.id, runId: run.run.id, stepId: router.id, expectedState: 'PENDING', to: 'DONE' });
    await expect(offline(uma, router, undefined)).rejects.toBeInstanceOf(StepStateConflictError);
    expect((await stepNow(router))?.stateChange?.by.displayName).toBe('Cole');
  });

  it('clears the device time on a later online change and freezes it with the Run', async () => {
    await offline(uma, router, new Date('2026-09-28T10:00:00Z'));
    const online = await changeStepState(deps, { actor: uma, workspaceId: home.id, runId: run.run.id, stepId: router.id, expectedState: 'DONE', to: 'PENDING' });
    expect(online.step.stateChange?.deviceAt).toBeNull();
    await offline(uma, router, new Date('2026-09-28T10:00:00Z'));
    await offline(uma, door, undefined);
    await completeRun(deps, { actor: uma, workspaceId: home.id, runId: run.run.id });
    expect(() => database.sqlite.prepare('UPDATE run_steps SET state_changed_device_at = 1 WHERE id = ?').run(router.id)).toThrow(/run is not active/);
  });

  it('keeps authorization and input rules for offline changes', async () => {
    const guest = await createUserRepository(database).create({
      email: normalizeEmail('gus@example.org'),
      displayName: 'Gus',
      emailVerified: true,
      status: 'ACTIVE',
      serverAdmin: false,
    });
    await addMember({ users: createUserRepository(database), workspaces: deps.workspaces, clock: deps.clock }, { actor: admin, workspaceId: home.id, email: guest.email, role: 'GUEST' });
    await expect(offline(guest, router, undefined)).rejects.toBeInstanceOf(NotAuthorizedError);
    await expect(offline(uma, router, undefined, 'not-a-uuid')).rejects.toBeInstanceOf(DomainValidationError);
    expect(events()).toEqual([]);
  });

  it('enforces one change id per actor in the database as well', () => {
    const insert = database.sqlite.prepare(
      "INSERT INTO audit_events (id, workspace_id, occurred_at, type, actor_user_id, actor_display_name, subject_type, subject_id, client_change_id) VALUES (?, ?, 1, 'X', ?, 'Uma', 'run', 'x', ?)",
    );
    const id = randomUUID();
    insert.run(randomUUID(), home.id, uma.id, id);
    expect(() => insert.run(randomUUID(), home.id, uma.id, id)).toThrow(/UNIQUE/);
  });
});
