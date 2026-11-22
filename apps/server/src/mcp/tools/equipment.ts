import { z } from 'zod';
import { createEquipmentRecord, deleteEquipmentRecord, findEquipment, getEquipmentRecord, listEquipmentTrash, restoreEquipmentRecord, updateEquipmentRecord, type EquipmentRecord } from '@vergissmeinnicht/application';
import { cursor, define, destructive, isoDate, revision, uuid, workspace, type AssistantTool, withoutWorkspace } from './shared.ts';

/** Equipment (48.4): what the household owns, through the `home.*` scopes. Never a purge: Trash stays the undo. */
const equipmentView = (record: EquipmentRecord) => ({
  id: record.id, revision: record.revision, name: record.name, category: record.category, location: record.location,
  manufacturer: record.manufacturer, model: record.model, serialNumber: record.serialNumber, purchaseDate: record.purchaseDate,
  warrantyExpiry: record.warrantyExpiry, notes: record.notes, replacementParts: record.replacementParts, customFields: record.customFields,
  updatedAt: record.updatedAt.toISOString(), updatedBy: record.updatedByName,
});

const line = (max: number) => z.string().max(max);
const equipmentFields = {
  category: line(200).optional(), location: line(200).optional(), manufacturer: line(200).optional(), model: line(200).optional(),
  serialNumber: line(200).optional(), purchaseDate: isoDate.nullable().optional(), warrantyExpiry: isoDate.nullable().optional(),
  notes: z.string().max(4000).optional(), replacementParts: z.string().max(2000).optional(),
  customFields: z.array(z.strictObject({ label: line(60), value: line(500) })).max(16).optional().describe('Extra details as label/value pairs; replaces all existing details when given.'),
};

export const equipmentTools: AssistantTool[] = [
  define('search_equipment', 'Find Equipment of a Workspace (appliances, devices, tools) by words, category, location or manufacturer, 50 at a time. Use next as cursor for more. Never anything in Trash.', 'home.read', 'EQUIPMENT', false,
    { ...workspace, query: z.string().max(200).default(''), category: line(200).optional(), location: line(200).optional(), manufacturer: line(200).optional(), cursor },
    async ({ services, actor, workspaceId }, input) => {
      const page = await findEquipment(services.equipment, { actor, workspaceId, query: { q: input.query, category: input.category, location: input.location, manufacturer: input.manufacturer }, cursor: input.cursor ?? undefined });
      return { equipment: page.records.map(equipmentView), next: page.next, total: page.total };
    }),
  define('get_equipment', 'Read one Equipment record with all its details and revision.', 'home.read', 'EQUIPMENT', false,
    { ...workspace, equipmentId: uuid },
    async ({ services, actor, workspaceId }, input) => equipmentView(await getEquipmentRecord(services.equipment, { actor, workspaceId, recordId: input.equipmentId }))),
  define('create_equipment', 'Add an Equipment record when the user asks (only the name is required). Search first so nothing is added twice; after a not_confirmed answer, search again before retrying.', 'home.write', 'EQUIPMENT', true,
    { ...workspace, name: line(200).min(1), ...equipmentFields },
    async ({ services, actor, workspaceId }, input) => ({ outcome: 'CREATED', equipment: equipmentView(await createEquipmentRecord(services.equipment, { actor, workspaceId, content: withoutWorkspace(input) })) })),
  define('update_equipment', 'Change an Equipment record at the revision read with get_equipment. Fields left out stay as they are.', 'home.write', 'EQUIPMENT', true,
    { ...workspace, equipmentId: uuid, expectedRevision: revision, name: line(200).min(1).optional(), ...equipmentFields },
    async ({ services, actor, workspaceId }, { equipmentId, expectedRevision, ...rest }) => {
      const changes = withoutWorkspace(rest);
      const current = await getEquipmentRecord(services.equipment, { actor, workspaceId, recordId: equipmentId });
      const content = {
        name: changes.name ?? current.name, category: changes.category ?? current.category, location: changes.location ?? current.location,
        manufacturer: changes.manufacturer ?? current.manufacturer, model: changes.model ?? current.model, serialNumber: changes.serialNumber ?? current.serialNumber,
        purchaseDate: changes.purchaseDate === undefined ? current.purchaseDate : changes.purchaseDate,
        warrantyExpiry: changes.warrantyExpiry === undefined ? current.warrantyExpiry : changes.warrantyExpiry,
        notes: changes.notes ?? current.notes, replacementParts: changes.replacementParts ?? current.replacementParts, customFields: changes.customFields ?? current.customFields,
      };
      return { outcome: 'UPDATED', equipment: equipmentView(await updateEquipmentRecord(services.equipment, { actor, workspaceId, recordId: equipmentId, content, expectedRevision })) };
    }),
  destructive(define('delete_equipment', 'Move an Equipment record to Trash when the user asks. It can be brought back with restore_equipment.', 'home.write', 'EQUIPMENT', true,
    { ...workspace, equipmentId: uuid },
    async ({ services, actor, workspaceId }, input) => {
      await deleteEquipmentRecord(services.equipment, { actor, workspaceId, recordId: input.equipmentId });
      return { outcome: 'DELETED', equipmentId: input.equipmentId };
    })),
  define('list_deleted_equipment', 'Read the Equipment records in Trash that can still be restored.', 'home.read', 'EQUIPMENT', false,
    workspace,
    async ({ services, actor, workspaceId }) => ({ trash: await listEquipmentTrash(services.equipment, { actor, workspaceId }) })),
  define('restore_equipment', 'Bring an Equipment record back from Trash.', 'home.write', 'EQUIPMENT', true,
    { ...workspace, equipmentId: uuid },
    async ({ services, actor, workspaceId }, input) => ({ outcome: 'RESTORED', equipment: equipmentView(await restoreEquipmentRecord(services.equipment, { actor, workspaceId, recordId: input.equipmentId })) })),
];
