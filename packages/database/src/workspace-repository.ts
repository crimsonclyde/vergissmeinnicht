import { randomUUID } from 'node:crypto';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import type {
  MembershipChangeResult,
  MembershipGuard,
  WorkspaceMember,
  WorkspaceRepository,
} from '@vergissmeinnicht/application';
import type {
  Membership,
  NormalizedEmail,
  UserId,
  Workspace,
  WorkspaceId,
  WorkspaceRole,
} from '@vergissmeinnicht/domain';
import type { AppDatabase } from './connection.ts';
import { memberships, users, workspaces } from './schema.ts';
import { IMMEDIATE, actorAllowed, type Transaction, type UserActor } from './actor-guard.ts';
import { recordSecurityEvent } from './security-events.ts';

function toWorkspace(row: typeof workspaces.$inferSelect): Workspace {
  return { id: row.id as WorkspaceId, name: row.name, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

function toMembership(row: typeof memberships.$inferSelect): Membership {
  return {
    workspaceId: row.workspaceId as WorkspaceId,
    userId: row.userId as UserId,
    role: row.role,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function roleOf(tx: Transaction, workspaceId: WorkspaceId, userId: string): WorkspaceRole | undefined {
  return tx
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
    .get()?.role;
}

function activeManagers(tx: Transaction, workspaceId: WorkspaceId, guard: MembershipGuard): number {
  if (guard.managingRoles.length === 0) return 0;
  return (
    tx
      .select({ n: count() })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.workspaceId, workspaceId),
          inArray(memberships.role, [...guard.managingRoles]),
          eq(users.status, 'ACTIVE'),
        ),
      )
      .get()?.n ?? 0
  );
}

/** Thrown inside the transaction so better-sqlite3 rolls it back; carries the result to report. */
class Abort extends Error {
  readonly result: MembershipChangeResult;

  constructor(result: MembershipChangeResult) {
    super(result);
    this.result = result;
  }
}

/**
 * Runs a guarded membership change. `change` returns a non-ok result to abort without writing;
 * the managing-role invariant is checked after the change and rolls it back when violated.
 */
function guardedChange(
  database: Pick<AppDatabase, 'db'>,
  workspaceId: WorkspaceId,
  actor: UserActor,
  guard: MembershipGuard,
  change: (tx: Transaction) => MembershipChangeResult,
): MembershipChangeResult {
  try {
    return database.db.transaction((tx) => {
      if (!actorAllowed(tx, workspaceId, actor, guard)) return 'forbidden';
      const result = change(tx);
      if (result !== 'ok') throw new Abort(result);
      if (activeManagers(tx, workspaceId, guard) === 0) throw new Abort('last_manager');
      return 'ok';
    }, IMMEDIATE);
  } catch (error) {
    if (error instanceof Abort) return error.result;
    throw error;
  }
}

export function createWorkspaceRepository(database: Pick<AppDatabase, 'db'>): WorkspaceRepository {
  const { db } = database;
  return {
    async create(input, actor) {
      return db.transaction((tx) => {
        const row = tx
          .insert(workspaces)
          .values({
            id: randomUUID(),
            name: input.name,
            createdByUserId: input.creatorId,
            createdAt: input.at,
            updatedAt: input.at,
          })
          .returning()
          .get();
        tx.insert(memberships)
          .values({ workspaceId: row.id, userId: input.creatorId, role: input.creatorRole, createdAt: input.at, updatedAt: input.at })
          .run();
        recordSecurityEvent(tx, {
          type: 'WORKSPACE_CREATED',
          actor,
          subjectType: 'workspace',
          subjectId: row.id,
          occurredAt: input.at,
        });
        recordSecurityEvent(tx, {
          type: 'MEMBERSHIP_ADDED',
          actor,
          subjectType: 'workspace',
          subjectId: row.id,
          occurredAt: input.at,
          metadata: { userId: input.creatorId, role: input.creatorRole },
        });
        return toWorkspace(row);
      }, IMMEDIATE);
    },

    async findById(id) {
      const row = db.select().from(workspaces).where(eq(workspaces.id, id)).get();
      return row && toWorkspace(row);
    },

    async findMembership(workspaceId, userId) {
      const row = db
        .select()
        .from(memberships)
        .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
        .get();
      return row && toMembership(row);
    },

    async listForUser(userId) {
      return db
        .select({ workspace: workspaces, role: memberships.role })
        .from(memberships)
        .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
        .where(eq(memberships.userId, userId))
        .orderBy(asc(workspaces.name), asc(workspaces.id))
        .all()
        .map((row) => ({ workspace: toWorkspace(row.workspace), role: row.role }));
    },

    async listMembers(workspaceId) {
      return db
        .select({
          userId: users.id,
          displayName: users.name,
          email: users.email,
          status: users.status,
          role: memberships.role,
          memberSince: memberships.createdAt,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.workspaceId, workspaceId))
        .orderBy(asc(users.name), asc(users.id))
        .all()
        .map(
          (row): WorkspaceMember => ({
            ...row,
            userId: row.userId as UserId,
            email: row.email as NormalizedEmail,
          }),
        );
    },

    async rename(input, actor, guard) {
      const result = guardedChange(database, input.workspaceId, actor, guard, (tx) => {
        const previous = tx.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, input.workspaceId)).get();
        if (previous === undefined) return 'forbidden';
        tx.update(workspaces).set({ name: input.name, updatedAt: input.at }).where(eq(workspaces.id, input.workspaceId)).run();
        recordSecurityEvent(tx, {
          type: 'WORKSPACE_RENAMED',
          actor,
          subjectType: 'workspace',
          subjectId: input.workspaceId,
          occurredAt: input.at,
          metadata: { previousName: previous.name, name: input.name },
        });
        return 'ok';
      });
      return result === 'ok' ? 'ok' : 'forbidden';
    },

    async addMember(input, actor, guard) {
      return guardedChange(database, input.workspaceId, actor, guard, (tx) => {
        if (roleOf(tx, input.workspaceId, input.userId) !== undefined) return 'already_member';
        tx.insert(memberships)
          .values({
            workspaceId: input.workspaceId,
            userId: input.userId,
            role: input.role,
            createdAt: input.at,
            updatedAt: input.at,
          })
          .run();
        recordSecurityEvent(tx, {
          type: 'MEMBERSHIP_ADDED',
          actor,
          subjectType: 'workspace',
          subjectId: input.workspaceId,
          occurredAt: input.at,
          metadata: { userId: input.userId, role: input.role },
        });
        return 'ok';
      });
    },

    async changeRole(input, actor, guard) {
      return guardedChange(database, input.workspaceId, actor, guard, (tx) => {
        const previousRole = roleOf(tx, input.workspaceId, input.userId);
        if (previousRole === undefined) return 'member_not_found';
        if (previousRole === input.role) return 'ok';
        tx.update(memberships)
          .set({ role: input.role, updatedAt: input.at })
          .where(and(eq(memberships.workspaceId, input.workspaceId), eq(memberships.userId, input.userId)))
          .run();
        recordSecurityEvent(tx, {
          type: 'MEMBERSHIP_ROLE_CHANGED',
          actor,
          subjectType: 'workspace',
          subjectId: input.workspaceId,
          occurredAt: input.at,
          metadata: { userId: input.userId, previousRole, role: input.role },
        });
        return 'ok';
      });
    },

    async removeMember(input, actor, guard) {
      return guardedChange(database, input.workspaceId, actor, guard, (tx) => {
        const previousRole = roleOf(tx, input.workspaceId, input.userId);
        if (previousRole === undefined) return 'member_not_found';
        tx.delete(memberships)
          .where(and(eq(memberships.workspaceId, input.workspaceId), eq(memberships.userId, input.userId)))
          .run();
        recordSecurityEvent(tx, {
          type: 'MEMBERSHIP_REMOVED',
          actor,
          subjectType: 'workspace',
          subjectId: input.workspaceId,
          occurredAt: input.at,
          metadata: { userId: input.userId, previousRole },
        });
        return 'ok';
      });
    },
  };
}
