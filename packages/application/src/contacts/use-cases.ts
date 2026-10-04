import {
  CONTACTS_PAGE_SIZE,
  DomainValidationError,
  MAX_CONTACTS_PER_IMPORT,
  MAX_CONTACTS_PER_PURGE,
  contactKeys,
  normalizeContactContent,
  parseContactCursor,
  parseContactId,
  parseContactQuery,
  parseLinkId,
  parseProcedureId,
  type ContactContent,
  type ContactCursor,
  type ContactInput,
  type ContactKeyKind,
  type User,
  type WorkspaceId,
} from '@vergissmeinnicht/domain';
import { roleHasCapability } from '@vergissmeinnicht/permissions';
import { ToolNotEnabledError } from '../documents/errors.ts';
import { authorizeTool } from '../documents/tools.ts';
import { NotAuthorizedError } from '../invitations/errors.ts';
import { AlreadyLinkedError, LinkNotFoundError, LinkTargetNotFoundError } from '../links/use-cases.ts';
import type { ActorGuard } from '../ports/actor-guard.ts';
import type { Clock } from '../ports/clock.ts';
import type { ContactDuplicate, ContactListing, ContactProcedureLink, ContactRecord, ContactRefusal, ContactRepository, ContactWrite, ProcedureContactLink, TrashedContact } from '../ports/contact-repository.ts';
import type { WorkspaceToolRepository } from '../ports/document-repository.ts';
import { InvalidCursorError } from '../ports/paging.ts';
import type { WorkspaceRepository } from '../ports/workspace-repository.ts';
import { userActor } from '../user-actor.ts';
import { authorizeWorkspace } from '../workspaces/use-cases.ts';
import { ContactConflictError, ContactImportRefusedError, ContactLimitReachedError, ContactNotFoundError } from './errors.ts';

export interface ContactDeps {
  readonly workspaces: WorkspaceRepository;
  readonly tools: WorkspaceToolRepository;
  readonly contacts: ContactRepository;
  readonly clock: Clock;
}

interface Ref {
  readonly actor: User;
  readonly workspaceId: WorkspaceId;
}

/** Re-checked inside every write transaction (concurrent demotion, removal or disabling). */
const manage: ActorGuard = { actorMay: (role) => roleHasCapability(role, 'contact.manage') };
const exporter: ActorGuard = { actorMay: (role) => roleHasCapability(role, 'contact.export') };
const purger: ActorGuard = { actorMay: (role) => roleHasCapability(role, 'contact.purge') };
/** Whoever links a Contact to a Procedure manages Contacts and can read Procedures. */
const linker: ActorGuard = { actorMay: (role) => roleHasCapability(role, 'contact.manage') && roleHasCapability(role, 'procedure.view') };

function refuse(status: ContactRefusal): never {
  switch (status) {
    case 'forbidden':
      throw new NotAuthorizedError();
    case 'tool_disabled':
      throw new ToolNotEnabledError();
    case 'contact_not_found':
      throw new ContactNotFoundError();
    case 'conflict':
      throw new ContactConflictError();
    case 'limit_reached':
      throw new ContactLimitReachedError();
    case 'procedure_not_found':
      throw new LinkTargetNotFoundError();
    case 'link_not_found':
      throw new LinkNotFoundError();
    case 'already_linked':
      throw new AlreadyLinkedError();
  }
}

function ok<T>(result: ContactWrite<T>): { readonly status: 'ok' } & T {
  if (result.status !== 'ok') refuse(result.status);
  return result;
}

const view = (deps: ContactDeps, input: Ref) => authorizeTool(deps, input.actor, input.workspaceId, 'CONTACTS', 'contact.view');
const write = (deps: ContactDeps, input: Ref) => authorizeTool(deps, input.actor, input.workspaceId, 'CONTACTS', 'contact.manage');

/**
 * One page of Contacts by name (`contact.view`: every role, guests included), searched by name,
 * organisation, category, email address and phone number, and filtered by category. Never anything in
 * Trash or of another Workspace.
 */
export async function findContacts(deps: ContactDeps, input: Ref & { readonly query: { readonly q?: string | undefined; readonly category?: string | undefined }; readonly cursor?: unknown }): Promise<ContactListing> {
  await view(deps, input);
  const query = parseContactQuery(input.query);
  let after: ContactCursor | null = null;
  if (input.cursor !== undefined && input.cursor !== null) {
    const parsed = parseContactCursor(input.cursor);
    if (parsed === undefined) throw new InvalidCursorError();
    after = parsed;
  }
  return deps.contacts.find(input.workspaceId, query, after, CONTACTS_PAGE_SIZE);
}

export async function contactCategories(deps: ContactDeps, input: Ref): Promise<string[]> {
  await view(deps, input);
  return deps.contacts.categories(input.workspaceId);
}

/** One Contact with the Contacts that may be the same person or organisation (pointed out, never merged). */
export async function getContact(deps: ContactDeps, input: Ref & { readonly contactId: string }): Promise<{ readonly contact: ContactRecord; readonly duplicates: ContactDuplicate[] }> {
  await view(deps, input);
  const contact = await deps.contacts.get(input.workspaceId, parseContactId(input.contactId));
  if (contact === undefined) throw new ContactNotFoundError();
  return { contact, duplicates: await deps.contacts.duplicatesOf(input.workspaceId, contactKeys(contact), contact.id) };
}

/**
 * Whether what is being entered may already exist: Contacts with the same email address, the same
 * phone number or the same name. For the create and edit forms — a hint, never a refusal.
 */
export async function possibleContactDuplicates(deps: ContactDeps, input: Ref & { readonly content: ContactInput; readonly exceptId?: string | undefined }): Promise<ContactDuplicate[]> {
  await view(deps, input);
  return deps.contacts.duplicatesOf(input.workspaceId, contactKeys(normalizeContactContent(input.content)), input.exceptId === undefined ? null : parseContactId(input.exceptId));
}

/** A new Contact (`contact.manage`: USER and above). A name is all that is required. A possible duplicate is saved all the same. */
export async function createContact(deps: ContactDeps, input: Ref & { readonly content: ContactInput }): Promise<{ readonly contact: ContactRecord; readonly duplicates: ContactDuplicate[] }> {
  await write(deps, input);
  const content = normalizeContactContent(input.content);
  const { contact } = ok(await deps.contacts.create({ workspaceId: input.workspaceId, content, at: deps.clock.now() }, userActor(input.actor), manage));
  return { contact, duplicates: await deps.contacts.duplicatesOf(input.workspaceId, contactKeys(contact), contact.id) };
}

export async function updateContact(deps: ContactDeps, input: Ref & { readonly contactId: string; readonly content: ContactInput; readonly expectedRevision: number }): Promise<{ readonly contact: ContactRecord; readonly duplicates: ContactDuplicate[] }> {
  await write(deps, input);
  const values = { workspaceId: input.workspaceId, contactId: parseContactId(input.contactId), content: normalizeContactContent(input.content), expectedRevision: input.expectedRevision, at: deps.clock.now() };
  const { contact } = ok(await deps.contacts.update(values, userActor(input.actor), manage));
  return { contact, duplicates: await deps.contacts.duplicatesOf(input.workspaceId, contactKeys(contact), contact.id) };
}

/** Moves a Contact to Trash. Records linked to it show a "deleted contact" until it is restored. */
export async function deleteContact(deps: ContactDeps, input: Ref & { readonly contactId: string }): Promise<void> {
  await write(deps, input);
  ok(await deps.contacts.delete({ workspaceId: input.workspaceId, contactId: parseContactId(input.contactId), at: deps.clock.now() }, userActor(input.actor), manage));
}

export async function restoreContact(deps: ContactDeps, input: Ref & { readonly contactId: string }): Promise<ContactRecord> {
  await write(deps, input);
  return ok(await deps.contacts.restore({ workspaceId: input.workspaceId, contactId: parseContactId(input.contactId), at: deps.clock.now() }, userActor(input.actor), manage)).contact;
}

/** What is in Trash (`contact.manage`: those who can restore). */
export async function listContactTrash(deps: ContactDeps, input: Ref): Promise<TrashedContact[]> {
  await write(deps, input);
  return deps.contacts.listTrash(input.workspaceId);
}

/**
 * **Permanent deletion**: removes Contacts from Trash for good — those named, or all of Trash. Only a
 * Workspace admin (`contact.purge`), only what is in Trash, never by itself. Nothing of the person is
 * kept: the audit entry holds the id only. Copies in existing backups stay until those backups rotate.
 */
export async function purgeContactTrash(deps: ContactDeps, input: Ref & { readonly contactIds: readonly string[] | 'all' }): Promise<number> {
  await authorizeTool(deps, input.actor, input.workspaceId, 'CONTACTS', 'contact.purge');
  if (input.contactIds !== 'all' && (input.contactIds.length === 0 || input.contactIds.length > MAX_CONTACTS_PER_PURGE || new Set(input.contactIds).size !== input.contactIds.length)) {
    throw new DomainValidationError('contacts', 'invalid_trash_selection', 'Choose between 1 and 200 contacts of Trash');
  }
  const contactIds = input.contactIds === 'all' ? 'all' : input.contactIds.map(parseContactId);
  return ok(await deps.contacts.purge({ workspaceId: input.workspaceId, contactIds, at: deps.clock.now() }, userActor(input.actor), purger)).purged;
}

// ---- Import and export

/** One entry of an import file as the parser read it — nothing checked yet. `line`: where it starts in the file. */
export interface ContactImportDraft {
  readonly line: number;
  readonly input: ContactInput;
}

/** What a parser makes of a file: the entries, and what it left out — said, not hidden. */
export interface ParsedContactFile {
  readonly drafts: readonly ContactImportDraft[];
  /** CSV columns or vCard properties that were not used, by name. */
  readonly ignored: readonly string[];
}

export interface ContactImportEntry {
  readonly line: number;
  /** The entry as it would be saved; `null` when it cannot be imported. */
  readonly contact: ContactContent | null;
  /** What was read, for an entry that cannot be imported: enough to recognise it. */
  readonly name: string;
  /** Why it cannot be imported: the code and field of the first rule it breaks. */
  readonly problem: { readonly code: string; readonly field: string } | null;
  /** Contacts of the Workspace it may be the same as. */
  readonly duplicates: readonly ContactDuplicate[];
  /** Earlier entries of the same file it may be the same as (their positions in `entries`), and what they share. */
  readonly sameAs: readonly { readonly entry: number; readonly reasons: readonly ContactKeyKind[] }[];
}

export interface ContactImportPreview {
  readonly entries: ContactImportEntry[];
  readonly ignored: readonly string[];
}

/**
 * Reads an import file and says what it would create — **nothing is saved**. Each entry is checked by
 * the rules every Contact follows; one that breaks them is listed with the reason and cannot be
 * imported. Possible duplicates — of existing Contacts and within the file — are pointed out; what to
 * do with them is the person's choice. `parse` runs only after the actor is authorised.
 */
export async function previewContactImport(deps: ContactDeps, input: Ref & { readonly parse: () => ParsedContactFile }): Promise<ContactImportPreview> {
  await write(deps, input);
  const parsed = input.parse();
  if (parsed.drafts.length === 0) throw new ContactImportRefusedError('contact_import_empty');
  if (parsed.drafts.length > MAX_CONTACTS_PER_IMPORT) throw new ContactImportRefusedError('contact_import_too_many');
  const entries: ContactImportEntry[] = [];
  const seen = new Map<string, { entry: number; kind: ContactKeyKind }[]>();
  for (const [position, draft] of parsed.drafts.entries()) {
    let contact: ContactContent;
    try {
      contact = normalizeContactContent(draft.input);
    } catch (error) {
      if (!(error instanceof DomainValidationError)) throw error;
      entries.push({ line: draft.line, contact: null, name: [...draft.input.name.replace(/\p{Cc}/gu, ' ').trim()].slice(0, 200).join(''), problem: { code: error.code, field: error.field }, duplicates: [], sameAs: [] });
      continue;
    }
    const keys = contactKeys(contact);
    const within = new Map<number, ContactKeyKind[]>();
    for (const key of keys) {
      const id = `${key.kind}:${key.key}`;
      for (const earlier of seen.get(id) ?? []) within.set(earlier.entry, [...(within.get(earlier.entry) ?? []), key.kind]);
      seen.set(id, [...(seen.get(id) ?? []), { entry: position, kind: key.kind }]);
    }
    entries.push({
      line: draft.line,
      contact,
      name: contact.name,
      problem: null,
      duplicates: await deps.contacts.duplicatesOf(input.workspaceId, keys, null),
      sameAs: [...within].map(([entry, reasons]) => ({ entry, reasons: [...new Set(reasons)] })),
    });
  }
  return { entries, ignored: parsed.ignored };
}

/**
 * Saves exactly the Contacts the person confirmed after the preview — every one checked again by the
 * same rules, all or nothing. Nothing is merged: a possible duplicate that was confirmed becomes a
 * Contact of its own.
 */
export async function importContacts(deps: ContactDeps, input: Ref & { readonly contacts: readonly ContactInput[]; readonly format: 'csv' | 'vcard' }): Promise<number> {
  await write(deps, input);
  if (input.contacts.length === 0 || input.contacts.length > MAX_CONTACTS_PER_IMPORT) throw new DomainValidationError('contacts', 'invalid_contact_import', 'Choose between 1 and 1000 contacts');
  const contents = input.contacts.map(normalizeContactContent);
  return ok(await deps.contacts.importMany({ workspaceId: input.workspaceId, contents, format: input.format, at: deps.clock.now() }, userActor(input.actor), manage)).created;
}

/** All live Contacts or one requested Contact (`contact.export`: USER and above). Audited by id/count only. */
export async function exportContacts(deps: ContactDeps, input: Ref & { readonly format: 'csv' | 'vcard'; readonly contactId?: string }): Promise<ContactRecord[]> {
  await authorizeTool(deps, input.actor, input.workspaceId, 'CONTACTS', 'contact.export');
  return ok(await deps.contacts.exportAll({ workspaceId: input.workspaceId, format: input.format, ...(input.contactId === undefined ? {} : { contactId: parseContactId(input.contactId) }), at: deps.clock.now() }, userActor(input.actor), exporter)).contacts;
}

// ---- Links to Procedures (Links to Documents are the Document's: `links/use-cases.ts`)

/** The Procedures linked to a Contact (`contact.view` and `procedure.view`). */
export async function listContactProcedures(deps: ContactDeps, input: Ref & { readonly contactId: string }): Promise<ContactProcedureLink[]> {
  await view(deps, input);
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.view');
  const found = await deps.contacts.procedureLinks(input.workspaceId, parseContactId(input.contactId));
  if (found === undefined) throw new ContactNotFoundError();
  return found;
}

/** The Contacts linked to a Procedure — whom to call. A Contact in Trash or deleted for good shows as a "deleted contact". */
export async function listProcedureContacts(deps: ContactDeps, input: Ref & { readonly procedureId: string }): Promise<ProcedureContactLink[]> {
  await view(deps, input);
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.view');
  return deps.contacts.linksOfProcedure(input.workspaceId, parseProcedureId(input.procedureId));
}

/** Links a Contact to a Procedure of the same Workspace: a reference, nothing is copied and nobody gains access. Audited. */
export async function linkContactProcedure(deps: ContactDeps, input: Ref & { readonly contactId: string; readonly procedureId: string }): Promise<ContactProcedureLink> {
  await view(deps, input);
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.view');
  await write(deps, input);
  const values = { workspaceId: input.workspaceId, contactId: parseContactId(input.contactId), procedureId: parseProcedureId(input.procedureId), at: deps.clock.now() };
  return ok(await deps.contacts.linkProcedure(values, userActor(input.actor), linker)).link;
}

export async function unlinkContactProcedure(deps: ContactDeps, input: Ref & { readonly linkId: string }): Promise<void> {
  await view(deps, input);
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.view');
  await write(deps, input);
  ok(await deps.contacts.unlinkProcedure({ workspaceId: input.workspaceId, linkId: parseLinkId(input.linkId), at: deps.clock.now() }, userActor(input.actor), linker));
}
