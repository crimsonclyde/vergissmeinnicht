import { z } from 'zod';
import { addMaintenanceLink, createMaintenanceRecord, deleteMaintenanceRecord, findMaintenance, getMaintenanceRecord, listMaintenanceLinks, listMaintenanceTrash, restoreMaintenanceRecord, setMaintenanceStatus, updateMaintenanceRecord, type MaintenanceRecord } from '@vergissmeinnicht/application';
import { MAINTENANCE_STATUSES } from '@vergissmeinnicht/domain';
import { cursor, define, destructive, isoDate, revision, uuid, workspace, type AssistantTool, withoutWorkspace } from './shared.ts';

/** Maintenance (48.4): work done or planned on the home, through the `home.*` scopes. Trash is the undo; never a purge. */
const maintenanceView = (record: MaintenanceRecord) => ({
  id: record.id, revision: record.revision, title: record.title, category: record.category, date: record.date, status: record.status,
  completedOn: record.completedOn, contact: record.contact, cost: record.cost, description: record.description,
  updatedAt: record.updatedAt.toISOString(), updatedBy: record.updatedByName,
});

const cost = z.strictObject({ amount: z.string().max(20).describe('A plain number such as 120 or 120.50.'), currency: z.string().regex(/^[A-Za-z]{3}$/).describe('ISO 4217 code such as EUR.') });
const maintenanceFields = {
  category: z.string().max(60).optional(), date: isoDate.nullable().optional().describe('When it was done or is planned.'),
  description: z.string().max(4000).optional(), contactId: uuid.nullable().optional().describe('The responsible Contact (needs the Contacts tool).'),
  cost: cost.nullable().optional(),
};

export const maintenanceTools: AssistantTool[] = [
  define('search_maintenance', 'Find Maintenance records (repairs, services, inspections) by words, status, category, year or Equipment, newest first, 50 at a time. Use next as cursor for more.', 'home.read', 'MAINTENANCE', false,
    { ...workspace, query: z.string().max(200).default(''), status: z.enum(MAINTENANCE_STATUSES).optional(), category: z.string().max(60).optional(), year: z.number().int().min(1900).max(2200).optional(), equipmentId: uuid.optional(), cursor },
    async ({ services, actor, workspaceId }, input) => {
      const page = await findMaintenance(services.maintenance, { actor, workspaceId, query: { q: input.query, status: input.status, category: input.category, year: input.year, equipment: input.equipmentId }, cursor: input.cursor ?? undefined });
      return { records: page.records, next: page.next, total: page.total };
    }),
  define('get_maintenance', 'Read one Maintenance record with its description, cost, status and linked records (Equipment, Documents, Procedures).', 'home.read', 'MAINTENANCE', false,
    { ...workspace, recordId: uuid },
    async ({ services, actor, workspaceId }, input) => {
      const record = await getMaintenanceRecord(services.maintenance, { actor, workspaceId, recordId: input.recordId });
      const links = await listMaintenanceLinks(services.maintenance, { actor, workspaceId, recordId: input.recordId });
      return { ...maintenanceView(record), links };
    }),
  define('create_maintenance', 'Record maintenance work when the user asks (only the title is required). New records start as PLANNED; use set_maintenance_status to mark them done. Link it to Equipment with equipmentId. Search first so nothing is recorded twice.', 'home.write', 'MAINTENANCE', true,
    { ...workspace, title: z.string().min(1).max(200), ...maintenanceFields, equipmentId: uuid.optional().describe('Equipment this work belongs to (needs the Equipment tool).') },
    async ({ services, actor, workspaceId }, { equipmentId, ...rest }) => {
      const content = withoutWorkspace(rest);
      const record = await createMaintenanceRecord(services.maintenance, { actor, workspaceId, content });
      if (equipmentId !== undefined) await addMaintenanceLink(services.maintenance, { actor, workspaceId, recordId: record.id, target: { type: 'equipment', id: equipmentId } });
      return { outcome: 'CREATED', record: maintenanceView(record) };
    }),
  define('update_maintenance', 'Change a Maintenance record at the revision read with get_maintenance. Fields left out stay as they are; null clears date, contact or cost.', 'home.write', 'MAINTENANCE', true,
    { ...workspace, recordId: uuid, expectedRevision: revision, title: z.string().min(1).max(200).optional(), ...maintenanceFields },
    async ({ services, actor, workspaceId }, { recordId, expectedRevision, ...rest }) => {
      const changes = withoutWorkspace(rest);
      const current = await getMaintenanceRecord(services.maintenance, { actor, workspaceId, recordId });
      const content = {
        title: changes.title ?? current.title, category: changes.category ?? current.category, date: changes.date === undefined ? current.date : changes.date,
        description: changes.description ?? current.description, contactId: changes.contactId === undefined ? (current.contact?.id ?? null) : changes.contactId,
        cost: changes.cost === undefined ? current.cost : changes.cost,
      };
      return { outcome: 'UPDATED', record: maintenanceView(await updateMaintenanceRecord(services.maintenance, { actor, workspaceId, recordId, content, expectedRevision })) };
    }),
  define('set_maintenance_status', 'Move a Maintenance record to PLANNED, IN_PROGRESS, COMPLETED (with the day it was done) or CANCELLED, at the read revision.', 'home.write', 'MAINTENANCE', true,
    { ...workspace, recordId: uuid, expectedRevision: revision, status: z.enum(MAINTENANCE_STATUSES), completedOn: isoDate.optional().describe('For COMPLETED: the day it was done; default today.') },
    async ({ services, actor, workspaceId }, input) => ({ outcome: 'UPDATED', record: maintenanceView(await setMaintenanceStatus(services.maintenance, { actor, workspaceId, recordId: input.recordId, status: input.status, expectedRevision: input.expectedRevision, completedOn: input.completedOn })) })),
  destructive(define('delete_maintenance', 'Move a Maintenance record to Trash when the user asks. It can be brought back with restore_maintenance.', 'home.write', 'MAINTENANCE', true,
    { ...workspace, recordId: uuid },
    async ({ services, actor, workspaceId }, input) => {
      await deleteMaintenanceRecord(services.maintenance, { actor, workspaceId, recordId: input.recordId });
      return { outcome: 'DELETED', recordId: input.recordId };
    })),
  define('list_deleted_maintenance', 'Read the Maintenance records in Trash that can still be restored.', 'home.read', 'MAINTENANCE', false,
    workspace,
    async ({ services, actor, workspaceId }) => ({ trash: await listMaintenanceTrash(services.maintenance, { actor, workspaceId }) })),
  define('restore_maintenance', 'Bring a Maintenance record back from Trash.', 'home.write', 'MAINTENANCE', true,
    { ...workspace, recordId: uuid },
    async ({ services, actor, workspaceId }, input) => ({ outcome: 'RESTORED', record: maintenanceView(await restoreMaintenanceRecord(services.maintenance, { actor, workspaceId, recordId: input.recordId })) })),
];
