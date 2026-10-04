import { and, eq, sql } from 'drizzle-orm';
import type { WorkspaceTool } from '@vergissmeinnicht/domain';
import type { Transaction } from './actor-guard.ts';
import { schedules, workspaceTools } from './schema.ts';

type Reader = Pick<Transaction, 'select'>;
export function toolEnabled(tx: Reader, workspaceId: string, tool: WorkspaceTool): boolean {
  return tx.select({ enabled: workspaceTools.enabled }).from(workspaceTools).where(and(eq(workspaceTools.workspaceId, workspaceId), eq(workspaceTools.tool, tool))).get()?.enabled === true;
}
/** Query-time source filtering, before ordering, paging or counts. */
export const enabledTool = (workspaceId: string, tool: WorkspaceTool) => sql`exists (select 1 from ${workspaceTools} where ${workspaceTools.workspaceId} = ${workspaceId} and ${workspaceTools.tool} = ${tool} and ${workspaceTools.enabled} = 1)`;

export const enabledScheduleSource = sql`exists (select 1 from ${workspaceTools} where ${workspaceTools.workspaceId} = ${schedules.workspaceId} and ${workspaceTools.enabled} = 1 and ${workspaceTools.tool} = case ${schedules.kind} when 'PROCEDURE' then 'PROCEDURES' else 'REMINDERS' end)`;
export function recordToolEnabled(tx: Reader, workspaceId: string, type: string, id: string): boolean {
  if (type === 'schedule') {
    const row = tx.select({ kind: schedules.kind }).from(schedules).where(and(eq(schedules.workspaceId, workspaceId), eq(schedules.id, id))).get();
    return row === undefined ? toolEnabled(tx, workspaceId, 'PROCEDURES') || toolEnabled(tx, workspaceId, 'REMINDERS') : toolEnabled(tx, workspaceId, row.kind === 'PROCEDURE' ? 'PROCEDURES' : 'REMINDERS');
  }
  const tool = ({ procedure: 'PROCEDURES', run: 'PROCEDURES', document: 'DOCUMENTS', contact: 'CONTACTS', maintenance: 'MAINTENANCE', equipment:'EQUIPMENT' } as const)[type as 'procedure'];
  return tool !== undefined && toolEnabled(tx, workspaceId, tool);
}
