import type { AiAssistantsRepository } from '@vergissmeinnicht/application';
import { eq, inArray } from 'drizzle-orm';
import { actorAllowed, IMMEDIATE, type Transaction } from './actor-guard.ts';
import { recordAuditEvent } from './audit-events.ts';
import type { AppDatabase } from './connection.ts';
import { workspaces } from './schema.ts';

type Reader = Pick<Transaction, 'select'>;

/** 45.11: may AI assistants (MCP) reach this Workspace? Unknown ids read as allowed; membership decides. */
export function aiAssistantsAllowed(tx: Reader, workspaceId: string): boolean {
  return tx.select({ on: workspaces.aiAssistants }).from(workspaces).where(eq(workspaces.id, workspaceId)).get()?.on !== false;
}

/** The Workspaces of `ids` that AI assistants may reach, in the given order. */
export function aiAllowedWorkspaces(tx: Reader, ids: readonly string[]): string[] {
  if (ids.length === 0) return [];
  const blocked = new Set(tx.select({ id: workspaces.id }).from(workspaces).where(inArray(workspaces.id, [...ids])).all()
    .filter((row) => !aiAssistantsAllowed(tx, row.id)).map((row) => row.id));
  return ids.filter((id) => !blocked.has(id));
}

export function createAiAssistantsRepository({ db }: Pick<AppDatabase, 'db'>): AiAssistantsRepository {
  return {
    async allowed(workspaceId) {
      return aiAssistantsAllowed(db, workspaceId);
    },
    async set(input, actor, guard) {
      return db.transaction((tx) => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return 'forbidden';
        if (aiAssistantsAllowed(tx, input.workspaceId) === input.allowed) return 'ok';
        tx.update(workspaces).set({ aiAssistants: input.allowed }).where(eq(workspaces.id, input.workspaceId)).run();
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: input.allowed ? 'AI_ASSISTANTS_ALLOWED' : 'AI_ASSISTANTS_BLOCKED',
          actor,
          subjectType: 'workspace',
          subjectId: input.workspaceId,
          occurredAt: input.at,
        });
        return 'ok';
      }, IMMEDIATE);
    },
  };
}
