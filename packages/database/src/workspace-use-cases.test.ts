import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AlreadyMemberError,
  LastWorkspaceAdminError,
  MemberNotFoundError,
  NotAuthorizedError,
  UnknownAccountError,
  WorkspaceNotFoundError,
  addMember,
  changeMemberRole,
  createWorkspace,
  getWorkspace,
  leaveWorkspace,
  listMembers,
  listMyWorkspaces,
  removeMember,
  renameWorkspace,
  type WorkspaceDeps,
} from '@vergissmeinnicht/application';
import {
  DomainValidationError,
  normalizeEmail,
  type User,
  type UserId,
  type Workspace,
  type WorkspaceId,
  type WorkspaceRole,
} from '@vergissmeinnicht/domain';
import { createTestDatabase } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';
import { createWorkspaceRepository } from './workspace-repository.ts';

describe('Workspace and Membership use-cases', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let deps: WorkspaceDeps;
  let serverAdmin: User;
  let alice: User;
  let bob: User;
  let carol: User;
  let home: Workspace;

  const events = () =>
    database.sqlite
      .prepare("SELECT type, actor_user_id AS actor, metadata FROM security_events WHERE subject_type = 'workspace' ORDER BY rowid")
      .all() as { type: string; actor: string; metadata: string | null }[];
  const setStatus = (user: User, status: User['status']) =>
    database.sqlite.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, user.id);
  const refreshed = async (user: User) => {
    const found = await deps.users.findById(user.id);
    if (found === undefined) throw new Error('user vanished');
    return found;
  };

  async function createUser(email: string, name: string, admin = false): Promise<User> {
    return deps.users.create({
      email: normalizeEmail(email),
      displayName: name,
      emailVerified: true,
      status: 'ACTIVE',
      serverAdmin: admin,
    });
  }

  async function join(workspace: Workspace, user: User, role: WorkspaceRole) {
    await addMember(deps, { actor: serverAdmin, workspaceId: workspace.id, email: user.email, role });
  }

  beforeEach(async () => {
    database = createTestDatabase();
    deps = {
      users: createUserRepository(database),
      workspaces: createWorkspaceRepository(database),
      clock: { now: () => new Date() },
    };
    serverAdmin = await createUser('root@example.org', 'Root', true);
    alice = await createUser('alice@example.org', 'Alice');
    bob = await createUser('bob@example.org', 'Bob');
    carol = await createUser('carol@example.org', 'Carol');
    home = await createWorkspace(deps, { actor: serverAdmin, name: '  Home ' });
  });

  afterEach(() => database.dispose());

  describe('creation', () => {
    it('lets an ACTIVE server admin create a Workspace and makes them its ADMIN, atomically audited', async () => {
      expect(home.name).toBe('Home');
      expect(home.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4/);
      expect(await getWorkspace(deps, { actor: serverAdmin, workspaceId: home.id })).toMatchObject({
        role: 'ADMIN',
        capabilities: expect.arrayContaining(['workspace.members.manage']),
      });
      expect(events().map((e) => e.type)).toEqual(['WORKSPACE_CREATED', 'MEMBERSHIP_ADDED']);
      expect(events().every((e) => e.actor === serverAdmin.id)).toBe(true);
    });

    it('refuses users without the server-admin flag, including Workspace ADMINs', async () => {
      await join(home, alice, 'ADMIN');
      await expect(createWorkspace(deps, { actor: alice, name: 'Mine' })).rejects.toThrow(NotAuthorizedError);
      await expect(createWorkspace(deps, { actor: bob, name: 'Mine' })).rejects.toThrow(NotAuthorizedError);
    });

    it('refuses a DISABLED server admin', async () => {
      setStatus(serverAdmin, 'DISABLED');
      await expect(createWorkspace(deps, { actor: await refreshed(serverAdmin), name: 'X' })).rejects.toThrow(
        NotAuthorizedError,
      );
    });

    it('validates the name', async () => {
      await expect(createWorkspace(deps, { actor: serverAdmin, name: '‮evil' })).rejects.toThrow(DomainValidationError);
    });

    it('never produces sequential or guessable ids', async () => {
      const other = await createWorkspace(deps, { actor: serverAdmin, name: 'Other' });
      expect(other.id).not.toBe(home.id);
      expect(other.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab]/);
    });
  });

  describe('multiple Workspaces per user', () => {
    it('lists only the caller’s own Workspaces with the role in each', async () => {
      const office = await createWorkspace(deps, { actor: serverAdmin, name: 'Office' });
      await createWorkspace(deps, { actor: serverAdmin, name: 'Secret' });
      await join(home, alice, 'USER');
      await join(office, alice, 'EDITOR');
      const mine = await listMyWorkspaces(deps, { actor: alice });
      expect(mine.map((m) => [m.workspace.name, m.role])).toEqual([
        ['Home', 'USER'],
        ['Office', 'EDITOR'],
      ]);
      expect(await listMyWorkspaces(deps, { actor: bob })).toEqual([]);
    });
  });

  describe('cross-Workspace isolation', () => {
    it('treats a non-member exactly like an unknown Workspace', async () => {
      const office = await createWorkspace(deps, { actor: serverAdmin, name: 'Office' });
      await join(office, alice, 'ADMIN');
      const unknown = '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f' as WorkspaceId;
      for (const workspaceId of [home.id, unknown]) {
        await expect(getWorkspace(deps, { actor: alice, workspaceId })).rejects.toThrow(WorkspaceNotFoundError);
        await expect(listMembers(deps, { actor: alice, workspaceId })).rejects.toThrow(WorkspaceNotFoundError);
        await expect(
          addMember(deps, { actor: alice, workspaceId, email: bob.email, role: 'USER' }),
        ).rejects.toThrow(WorkspaceNotFoundError);
        await expect(renameWorkspace(deps, { actor: alice, workspaceId, name: 'Pwned' })).rejects.toThrow(
          WorkspaceNotFoundError,
        );
        await expect(
          changeMemberRole(deps, { actor: alice, workspaceId, userId: serverAdmin.id, role: 'GUEST' }),
        ).rejects.toThrow(WorkspaceNotFoundError);
        await expect(removeMember(deps, { actor: alice, workspaceId, userId: serverAdmin.id })).rejects.toThrow(
          WorkspaceNotFoundError,
        );
      }
      expect((await getWorkspace(deps, { actor: serverAdmin, workspaceId: home.id })).workspace.name).toBe('Home');
    });

    it('does not let an ADMIN of Workspace A manage a member of Workspace B through A', async () => {
      const office = await createWorkspace(deps, { actor: serverAdmin, name: 'Office' });
      await join(office, alice, 'ADMIN');
      await join(home, bob, 'USER');
      await expect(
        changeMemberRole(deps, { actor: alice, workspaceId: office.id, userId: bob.id, role: 'ADMIN' }),
      ).rejects.toThrow(MemberNotFoundError);
      await expect(removeMember(deps, { actor: alice, workspaceId: office.id, userId: bob.id })).rejects.toThrow(
        MemberNotFoundError,
      );
      expect((await deps.workspaces.findMembership(home.id, bob.id))?.role).toBe('USER');
    });

    it('does not give a server admin implicit access to Workspaces they are not a member of', async () => {
      await join(home, alice, 'ADMIN');
      await removeMember(deps, { actor: alice, workspaceId: home.id, userId: serverAdmin.id });
      await expect(getWorkspace(deps, { actor: serverAdmin, workspaceId: home.id })).rejects.toThrow(
        WorkspaceNotFoundError,
      );
    });
  });

  describe('roles (vertical escalation)', () => {
    it.each(['GUEST', 'USER', 'EDITOR'] as const)('%s cannot manage members, roles or settings', async (role) => {
      await join(home, alice, role);
      await join(home, bob, 'USER');
      await expect(addMember(deps, { actor: alice, workspaceId: home.id, email: carol.email, role: 'GUEST' })).rejects.toThrow(
        NotAuthorizedError,
      );
      await expect(
        changeMemberRole(deps, { actor: alice, workspaceId: home.id, userId: alice.id, role: 'ADMIN' }),
      ).rejects.toThrow(NotAuthorizedError);
      await expect(
        changeMemberRole(deps, { actor: alice, workspaceId: home.id, userId: bob.id, role: 'ADMIN' }),
      ).rejects.toThrow(NotAuthorizedError);
      await expect(removeMember(deps, { actor: alice, workspaceId: home.id, userId: bob.id })).rejects.toThrow(
        NotAuthorizedError,
      );
      await expect(renameWorkspace(deps, { actor: alice, workspaceId: home.id, name: 'Mine now' })).rejects.toThrow(
        NotAuthorizedError,
      );
      expect((await deps.workspaces.findMembership(home.id, alice.id))?.role).toBe(role);
      expect(await deps.workspaces.findMembership(home.id, carol.id)).toBeUndefined();
    });

    it('lets GUESTs see the Workspace but not the member list', async () => {
      await join(home, alice, 'GUEST');
      await expect(getWorkspace(deps, { actor: alice, workspaceId: home.id })).resolves.toMatchObject({
        role: 'GUEST',
        capabilities: ['workspace.view', 'procedure.view', 'run.view', 'list.view', 'document.view'],
      });
      await expect(listMembers(deps, { actor: alice, workspaceId: home.id })).rejects.toThrow(NotAuthorizedError);
    });

    it('shows member emails and status only to members who manage the Workspace', async () => {
      await join(home, alice, 'USER');
      const asUser = await listMembers(deps, { actor: alice, workspaceId: home.id });
      expect(asUser.map((m) => m.displayName)).toEqual(['Alice', 'Root']);
      expect(asUser.every((m) => m.email === undefined && m.status === undefined)).toBe(true);
      const asAdmin = await listMembers(deps, { actor: serverAdmin, workspaceId: home.id });
      expect(asAdmin.map((m) => m.email)).toEqual(['alice@example.org', 'root@example.org']);
    });

    it('re-checks the actor’s role inside the write transaction', async () => {
      await join(home, alice, 'ADMIN');
      // Alice passed the use-case check, then was demoted before the write ran.
      const workspaces = createWorkspaceRepository(database);
      const racing: WorkspaceDeps = {
        ...deps,
        workspaces: {
          ...workspaces,
          async addMember(...args) {
            await changeMemberRole(deps, { actor: serverAdmin, workspaceId: home.id, userId: alice.id, role: 'USER' });
            return workspaces.addMember(...args);
          },
        },
      };
      await expect(
        addMember(racing, { actor: alice, workspaceId: home.id, email: carol.email, role: 'ADMIN' }),
      ).rejects.toThrow(NotAuthorizedError);
      expect(await deps.workspaces.findMembership(home.id, carol.id)).toBeUndefined();
    });
  });

  describe('membership management', () => {
    it('adds, re-roles and removes members with an audit event for each change', async () => {
      await join(home, alice, 'ADMIN');
      const added = await addMember(deps, { actor: alice, workspaceId: home.id, email: bob.email, role: 'USER' });
      expect(added).toMatchObject({ userId: bob.id, role: 'USER', displayName: 'Bob' });
      await changeMemberRole(deps, { actor: alice, workspaceId: home.id, userId: bob.id, role: 'EDITOR' });
      await removeMember(deps, { actor: alice, workspaceId: home.id, userId: bob.id });

      const log = events().slice(2);
      expect(log.map((e) => e.type)).toEqual(['MEMBERSHIP_ADDED', 'MEMBERSHIP_ADDED', 'MEMBERSHIP_ROLE_CHANGED', 'MEMBERSHIP_REMOVED']);
      expect(log.slice(1).every((e) => e.actor === alice.id)).toBe(true);
      expect(JSON.parse(log[2]?.metadata ?? 'null')).toEqual({ userId: bob.id, previousRole: 'USER', role: 'EDITOR' });
      expect(JSON.parse(log[3]?.metadata ?? 'null')).toEqual({ userId: bob.id, previousRole: 'EDITOR' });
    });

    it('reports unknown and DISABLED accounts identically and adds nobody', async () => {
      setStatus(carol, 'DISABLED');
      for (const email of [normalizeEmail('nobody@example.org'), carol.email]) {
        await expect(addMember(deps, { actor: serverAdmin, workspaceId: home.id, email, role: 'USER' })).rejects.toThrow(
          UnknownAccountError,
        );
      }
      expect(await deps.workspaces.findMembership(home.id, carol.id)).toBeUndefined();
    });

    it('refuses duplicate membership without changing the existing role', async () => {
      await join(home, alice, 'GUEST');
      await expect(join(home, alice, 'ADMIN')).rejects.toThrow(AlreadyMemberError);
      expect((await deps.workspaces.findMembership(home.id, alice.id))?.role).toBe('GUEST');
    });

    it('does not record an event when the role does not change', async () => {
      await join(home, alice, 'USER');
      const before = events().length;
      await changeMemberRole(deps, { actor: serverAdmin, workspaceId: home.id, userId: alice.id, role: 'USER' });
      expect(events()).toHaveLength(before);
    });

    it('rejects unknown targets', async () => {
      await expect(
        removeMember(deps, { actor: serverAdmin, workspaceId: home.id, userId: bob.id }),
      ).rejects.toThrow(MemberNotFoundError);
      await expect(
        changeMemberRole(deps, {
          actor: serverAdmin,
          workspaceId: home.id,
          userId: '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f' as UserId,
          role: 'USER',
        }),
      ).rejects.toThrow(MemberNotFoundError);
    });

    it('renames with an audit event', async () => {
      await renameWorkspace(deps, { actor: serverAdmin, workspaceId: home.id, name: 'Family' });
      expect((await deps.workspaces.findById(home.id))?.name).toBe('Family');
      expect(events().at(-1)).toMatchObject({ type: 'WORKSPACE_RENAMED' });
    });
  });

  describe('last ACTIVE admin', () => {
    it('cannot be removed or demoted, not even by themselves', async () => {
      await expect(removeMember(deps, { actor: serverAdmin, workspaceId: home.id, userId: serverAdmin.id })).rejects.toThrow(
        LastWorkspaceAdminError,
      );
      await expect(
        changeMemberRole(deps, { actor: serverAdmin, workspaceId: home.id, userId: serverAdmin.id, role: 'EDITOR' }),
      ).rejects.toThrow(LastWorkspaceAdminError);
      expect((await deps.workspaces.findMembership(home.id, serverAdmin.id))?.role).toBe('ADMIN');
    });

    it('does not count a DISABLED admin as remaining', async () => {
      await join(home, alice, 'ADMIN');
      setStatus(alice, 'DISABLED');
      await expect(removeMember(deps, { actor: serverAdmin, workspaceId: home.id, userId: serverAdmin.id })).rejects.toThrow(
        LastWorkspaceAdminError,
      );
    });

    it('can step down once another ACTIVE admin exists', async () => {
      await join(home, alice, 'ADMIN');
      await changeMemberRole(deps, { actor: serverAdmin, workspaceId: home.id, userId: serverAdmin.id, role: 'USER' });
      await expect(
        changeMemberRole(deps, { actor: serverAdmin, workspaceId: home.id, userId: serverAdmin.id, role: 'ADMIN' }),
      ).rejects.toThrow(NotAuthorizedError);
    });
  });

  describe('leaving', () => {
    it.each(['GUEST', 'USER', 'EDITOR'] as const)('lets a %s leave, audited as their own action', async (role) => {
      await join(home, alice, role);
      await leaveWorkspace(deps, { actor: alice, workspaceId: home.id });
      await expect(getWorkspace(deps, { actor: alice, workspaceId: home.id })).rejects.toThrow(WorkspaceNotFoundError);
      expect(events().at(-1)).toMatchObject({ type: 'MEMBERSHIP_REMOVED', actor: alice.id });
    });

    it('lets an admin leave only while another ACTIVE admin remains', async () => {
      await expect(leaveWorkspace(deps, { actor: serverAdmin, workspaceId: home.id })).rejects.toThrow(LastWorkspaceAdminError);
      await join(home, alice, 'ADMIN');
      await leaveWorkspace(deps, { actor: serverAdmin, workspaceId: home.id });
      expect(await listMyWorkspaces(deps, { actor: serverAdmin })).toEqual([]);
    });

    it('only ever removes the caller and fails for non-members like an unknown Workspace', async () => {
      await join(home, alice, 'USER');
      const office = await createWorkspace(deps, { actor: serverAdmin, name: 'Office' });
      await expect(leaveWorkspace(deps, { actor: bob, workspaceId: home.id })).rejects.toThrow(WorkspaceNotFoundError);
      await expect(leaveWorkspace(deps, { actor: alice, workspaceId: office.id })).rejects.toThrow(WorkspaceNotFoundError);
      expect((await deps.workspaces.findMembership(home.id, alice.id))?.role).toBe('USER');
    });
  });

  describe('removal and disabled accounts', () => {
    it('revokes access on the very next call', async () => {
      await join(home, alice, 'EDITOR');
      await expect(getWorkspace(deps, { actor: alice, workspaceId: home.id })).resolves.toBeDefined();
      await removeMember(deps, { actor: serverAdmin, workspaceId: home.id, userId: alice.id });
      await expect(getWorkspace(deps, { actor: alice, workspaceId: home.id })).rejects.toThrow(WorkspaceNotFoundError);
      expect(await listMyWorkspaces(deps, { actor: alice })).toEqual([]);
    });

    it('denies a DISABLED member even with a stale User object', async () => {
      await join(home, alice, 'ADMIN');
      const stale = { ...alice, status: 'DISABLED' as const };
      await expect(getWorkspace(deps, { actor: stale, workspaceId: home.id })).rejects.toThrow(WorkspaceNotFoundError);
      setStatus(alice, 'DISABLED');
      // The in-transaction check reads the current status from the database.
      await expect(
        addMember(deps, { actor: alice, workspaceId: home.id, email: bob.email, role: 'USER' }),
      ).rejects.toThrow(NotAuthorizedError);
    });
  });

  describe('atomicity and storage constraints', () => {
    it('rolls back the membership change when the audit event cannot be written', async () => {
      database.sqlite.exec(`CREATE TRIGGER fail_audit BEFORE INSERT ON security_events BEGIN SELECT RAISE(ABORT, 'no'); END`);
      await expect(join(home, alice, 'USER')).rejects.toThrow();
      await expect(createWorkspace(deps, { actor: serverAdmin, name: 'Nope' })).rejects.toThrow();
      expect(await deps.workspaces.findMembership(home.id, alice.id)).toBeUndefined();
      expect((database.sqlite.prepare('SELECT count(*) AS n FROM workspaces').get() as { n: number }).n).toBe(1);
    });

    it('rejects invalid roles, orphan memberships and duplicate rows at the database level', () => {
      const insert = database.sqlite.prepare(
        'INSERT INTO memberships (workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, 0, 0)',
      );
      expect(() => insert.run(home.id, alice.id, 'OWNER')).toThrow(/CHECK/);
      expect(() => insert.run('3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f', alice.id, 'USER')).toThrow(/FOREIGN KEY/);
      expect(() => insert.run(home.id, serverAdmin.id, 'USER')).toThrow(/UNIQUE|PRIMARY/);
    });

    it('does not allow deleting a Workspace that still has members', () => {
      expect(() => database.sqlite.prepare('DELETE FROM workspaces WHERE id = ?').run(home.id)).toThrow(/FOREIGN KEY/);
    });
  });
});
