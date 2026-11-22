import { z } from 'zod';
import { createContact, deleteContact, findContacts, getContact, listContactTrash, restoreContact, updateContact, type ContactRecord } from '@vergissmeinnicht/application';
import { cursor, define, destructive, revision, uuid, workspace, type AssistantTool, withoutWorkspace } from './shared.ts';

/**
 * Contacts (48.4): people and organisations of the Workspace, through their own `contacts.*` scopes,
 * which the consent screen leaves off unless chosen (addresses and phone numbers are personal data).
 * Trash is the undo; never a purge, an import or an export.
 */
const contactView = (contact: ContactRecord) => ({
  id: contact.id, revision: contact.revision, name: contact.name, organisation: contact.organisation, category: contact.category,
  emails: contact.emails, phones: contact.phones, address: contact.address, website: contact.website, notes: contact.notes,
  updatedAt: contact.updatedAt.toISOString(), updatedBy: contact.updatedByName,
});
const point = z.strictObject({ value: z.string().min(1).max(320), label: z.string().max(60).default('') });
const contactFields = {
  organisation: z.string().max(200).optional(), category: z.string().max(60).optional().describe('What they are to the household, such as Plumber or Insurer.'),
  emails: z.array(point).max(10).optional().describe('Replaces all email addresses when given.'), phones: z.array(point).max(10).optional().describe('Replaces all phone numbers when given.'),
  address: z.string().max(1000).optional(), website: z.string().max(2048).optional().describe('http or https address, or empty.'), notes: z.string().max(4000).optional(),
};
const duplicatesView = (duplicates: readonly { id: string; name: string; organisation: string; reasons: readonly string[] }[]) => duplicates.map(({ id, name, organisation, reasons }) => ({ id, name, organisation, reasons }));

export const contactsTools: AssistantTool[] = [
  define('search_contacts', 'Find Contacts by name, organisation, email, phone or category, 50 at a time. Contact details are personal data: use them only for what the user asked.', 'contacts.read', 'CONTACTS', false,
    { ...workspace, query: z.string().max(200).default(''), category: z.string().max(60).optional(), cursor },
    async ({ services, actor, workspaceId }, input) => {
      const page = await findContacts(services.contacts, { actor, workspaceId, query: { q: input.query, category: input.category }, cursor: input.cursor ?? undefined });
      return { contacts: page.contacts, next: page.next, total: page.total };
    }),
  define('get_contact', 'Read one Contact with address, website, notes and possible duplicates.', 'contacts.read', 'CONTACTS', false,
    { ...workspace, contactId: uuid },
    async ({ services, actor, workspaceId }, input) => {
      const result = await getContact(services.contacts, { actor, workspaceId, contactId: input.contactId });
      return { ...contactView(result.contact), possibleDuplicates: duplicatesView(result.duplicates) };
    }),
  define('create_contact', 'Add a Contact when the user asks (only the name is required). Search first; the answer lists possible duplicates, which are never merged automatically.', 'contacts.write', 'CONTACTS', true,
    { ...workspace, name: z.string().min(1).max(200), ...contactFields },
    async ({ services, actor, workspaceId }, input) => {
      const content = withoutWorkspace(input);
      const result = await createContact(services.contacts, { actor, workspaceId, content });
      return { outcome: 'CREATED', contact: contactView(result.contact), possibleDuplicates: duplicatesView(result.duplicates) };
    }),
  define('update_contact', 'Change a Contact at the revision read with get_contact. Fields left out stay as they are.', 'contacts.write', 'CONTACTS', true,
    { ...workspace, contactId: uuid, expectedRevision: revision, name: z.string().min(1).max(200).optional(), ...contactFields },
    async ({ services, actor, workspaceId }, { contactId, expectedRevision, ...rest }) => {
      const changes = withoutWorkspace(rest);
      const { contact: current } = await getContact(services.contacts, { actor, workspaceId, contactId });
      const content = {
        name: changes.name ?? current.name, organisation: changes.organisation ?? current.organisation, category: changes.category ?? current.category,
        emails: changes.emails ?? current.emails, phones: changes.phones ?? current.phones, address: changes.address ?? current.address,
        website: changes.website ?? current.website, notes: changes.notes ?? current.notes,
      };
      const result = await updateContact(services.contacts, { actor, workspaceId, contactId, content, expectedRevision });
      return { outcome: 'UPDATED', contact: contactView(result.contact), possibleDuplicates: duplicatesView(result.duplicates) };
    }),
  destructive(define('delete_contact', 'Move a Contact to Trash when the user asks. It can be brought back with restore_contact.', 'contacts.write', 'CONTACTS', true,
    { ...workspace, contactId: uuid },
    async ({ services, actor, workspaceId }, input) => {
      await deleteContact(services.contacts, { actor, workspaceId, contactId: input.contactId });
      return { outcome: 'DELETED', contactId: input.contactId };
    })),
  define('list_deleted_contacts', 'Read the Contacts in Trash that can still be restored.', 'contacts.read', 'CONTACTS', false,
    workspace,
    async ({ services, actor, workspaceId }) => ({ trash: await listContactTrash(services.contacts, { actor, workspaceId }) })),
  define('restore_contact', 'Bring a Contact back from Trash.', 'contacts.write', 'CONTACTS', true,
    { ...workspace, contactId: uuid },
    async ({ services, actor, workspaceId }, input) => ({ outcome: 'RESTORED', contact: contactView(await restoreContact(services.contacts, { actor, workspaceId, contactId: input.contactId })) })),
];
