import {
  InvalidCursorError,
  contactCategories,
  createContact,
  deleteContact,
  exportContacts,
  findContacts,
  getContact,
  importContacts,
  linkContactProcedure,
  listContactProcedures,
  listContactTrash,
  listProcedureContacts,
  possibleContactDuplicates,
  previewContactImport,
  purgeContactTrash,
  restoreContact,
  unlinkContactProcedure,
  updateContact,
  type ContactDuplicate,
  type ContactImportEntry,
  type ContactProcedureLink,
  type ContactRecord,
  type ContactSummary,
  type ProcedureContactLink,
  type TrashedContact,
} from '@vergissmeinnicht/application';
import { MAX_CONTACTS_PER_IMPORT, MAX_CONTACT_IMPORT_BYTES, UUID_V4, exportSegment, mailtoHref, telHref, type ContactCursor, type ContactPoint, type WorkspaceId } from '@vergissmeinnicht/domain';
import { contactsToCsv, contactsToVcard, decodeContactFile, parseContactsCsv, parseContactsVcard } from '@vergissmeinnicht/import-export';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../composition.ts';
import { attachment } from './document-file-routes.ts';
import { InvalidRequestError } from './errors.ts';
import { requireUser, type Principal } from './session.ts';

const MINUTE_MS = 60_000;
// Lower-case UUIDv4 only, like the domain parsers: one canonical spelling per id.
const uuid = z.string().regex(UUID_V4);
const workspaceParams = z.strictObject({ workspaceId: uuid });
const contactParams = z.strictObject({ workspaceId: uuid, contactId: uuid });
const linkParams = z.strictObject({ workspaceId: uuid, linkId: uuid });
// Coarse transport bounds; the domain normalizes and enforces the exact rules.
const line = z.string().max(2048);
const point = z.strictObject({ value: line, label: line.optional() });
const content = {
  name: line,
  organisation: line.optional(),
  category: line.optional(),
  emails: z.array(point).max(64).optional(),
  phones: z.array(point).max(64).optional(),
  address: z.string().max(8000).optional(),
  website: line.optional(),
  notes: z.string().max(20_000).optional(),
};
const createBody = z.strictObject(content);
const updateBody = z.strictObject({ ...content, expectedRevision: z.number().int().min(1) });
const duplicatesBody = z.strictObject({ ...content, exceptId: uuid.optional() });
const listQuery = z.strictObject({ q: z.string().max(400).optional(), category: line.optional(), cursor: z.string().max(8192).regex(/^[A-Za-z0-9_-]+$/).optional() });
const noQuery = z.strictObject({});
const format = z.enum(['csv', 'vcard']);
const formatQuery = z.strictObject({ format });
const importBody = z.strictObject({ format, contacts: z.array(z.strictObject(content)).min(1).max(MAX_CONTACTS_PER_IMPORT) });
// Permanent deletion names its Contacts, or says "all" — never both, never nothing.
const purgeBody = z.union([z.strictObject({ contactIds: z.array(uuid).min(1).max(1000) }), z.strictObject({ all: z.literal(true) })]);
const linkBody = z.strictObject({ procedureId: uuid });
const procedureQuery = z.strictObject({ procedure: uuid });

const BODY_LIMIT = 64 * 1024;
/** A confirmed import: up to a thousand Contacts as JSON. */
const IMPORT_BODY_LIMIT = 4 * 1024 * 1024;

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new InvalidRequestError();
  return parsed.data;
}

function principalOf(request: FastifyRequest): Principal {
  if (request.principal === null) throw new Error('requireUser did not run');
  return request.principal;
}

const ref = (request: FastifyRequest, workspaceId: string) => ({ actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId });

/**
 * An address or number with the link to act on it. The links are built here, from values that passed
 * the domain rules — `mailto:` from a checked address, `tel:` from digits only — so that a client never
 * assembles one from text.
 */
const emailView = (email: ContactPoint) => ({ value: email.value, label: email.label, href: mailtoHref(email.value) });
const phoneView = (phone: ContactPoint) => ({ value: phone.value, label: phone.label, href: telHref(phone.value) });

const summaryView = (contact: ContactSummary) => ({
  id: contact.id,
  name: contact.name,
  organisation: contact.organisation,
  category: contact.category,
  emails: contact.emails.map(emailView),
  phones: contact.phones.map(phoneView),
  revision: contact.revision,
});

/** Display names only — never user ids. */
const contactView = (contact: ContactRecord) => ({
  ...summaryView(contact),
  address: contact.address,
  website: contact.website,
  notes: contact.notes,
  createdAt: contact.createdAt.toISOString(),
  createdBy: contact.createdByName,
  modifiedAt: contact.updatedAt.toISOString(),
  modifiedBy: contact.updatedByName,
});

const duplicateView = (duplicate: ContactDuplicate) => ({ id: duplicate.id, name: duplicate.name, organisation: duplicate.organisation, reasons: duplicate.reasons });
const trashView = (contact: TrashedContact) => ({ id: contact.id, name: contact.name, organisation: contact.organisation, deletedAt: contact.deletedAt.toISOString(), deletedBy: contact.deletedByName });
const procedureLinkView = (link: ContactProcedureLink) => ({ id: link.id, procedureId: link.procedureId, title: link.title, state: link.state, createdAt: link.createdAt.toISOString(), createdBy: link.createdByName });
const procedureContactView = (link: ProcedureContactLink) => ({ id: link.id, contact: link.contact === null ? null : summaryView(link.contact) });
const entryView = (entry: ContactImportEntry) => ({ line: entry.line, name: entry.name, contact: entry.contact, problem: entry.problem, duplicates: entry.duplicates.map(duplicateView), sameAs: entry.sameAs });

/** A cursor travels as base64url JSON: opaque to the client, and only a position — it carries no authority. */
const encodeCursor = (cursor: ContactCursor | null) => (cursor === null ? null : Buffer.from(JSON.stringify([cursor.value, cursor.id]), 'utf8').toString('base64url'));
function decodeCursor(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(Buffer.from(text, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw new InvalidCursorError();
  }
}

/**
 * Contacts (16.6). All routes need a session and the Contacts tool switched on in that Workspace (404
 * otherwise, for every role). Reading needs `contact.view` (every member, guests included); changing
 * and importing need `contact.manage`, exporting `contact.export` (both USER and above), permanent
 * deletion `contact.purge` (Workspace admins). Ids of another Workspace are "not found". A Contact is
 * not a User: nothing here grants access to anything.
 */
export async function contactRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  const deps = services.contacts;
  app.addHook('preHandler', requireUser(services));
  // An import file is the raw request body, read into memory up to the limit of one import (1 MiB).
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: MAX_CONTACT_IMPORT_BYTES }, (_request, body, done) => done(null, body));

  // One page of Contacts by name: `q` (name, organisation, category, email, phone), `category`, `cursor`.
  app.get('/contacts', async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const { cursor, ...query } = parse(listQuery, request.query);
    const found = await findContacts(deps, { ...ref(request, workspaceId), query, cursor: decodeCursor(cursor) });
    return { contacts: found.contacts.map(summaryView), nextCursor: encodeCursor(found.next), total: found.total };
  });

  app.get('/contacts/categories', async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    parse(noQuery, request.query);
    return { categories: await contactCategories(deps, ref(request, workspaceId)) };
  });

  app.post('/contacts', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const created = await createContact(deps, { ...ref(request, workspaceId), content: parse(createBody, request.body) });
    return reply.code(201).send({ contact: contactView(created.contact), duplicates: created.duplicates.map(duplicateView) });
  });

  // "Possibly the same as …" while typing: a hint for the form, never a refusal. Changes nothing.
  app.post('/contacts/duplicates', { bodyLimit: BODY_LIMIT }, async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const { exceptId, ...fields } = parse(duplicatesBody, request.body);
    return { duplicates: (await possibleContactDuplicates(deps, { ...ref(request, workspaceId), content: fields, exceptId })).map(duplicateView) };
  });

  app.get('/contacts/trash', async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    parse(noQuery, request.query);
    return { contacts: (await listContactTrash(deps, ref(request, workspaceId))).map(trashView) };
  });

  // Deletes Contacts in Trash for good: Workspace admins only (`contact.purge`).
  app.post('/contacts/trash/purge', { bodyLimit: BODY_LIMIT }, async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const body = parse(purgeBody, request.body);
    return { purged: await purgeContactTrash(deps, { ...ref(request, workspaceId), contactIds: 'all' in body ? 'all' : body.contactIds }) };
  });

  // Every Contact as one file — `format=csv` or `format=vcard` — sent as a download. USER and above; audited.
  app.get(
    '/contacts/export',
    { config: { rateLimit: { max: 10, timeWindow: 15 * MINUTE_MS, hook: 'preHandler', keyGenerator: (request: FastifyRequest) => `contact-export:${request.principal?.user.id ?? request.ip}` } } },
    async (request, reply) => {
      const { workspaceId } = parse(workspaceParams, request.params);
      const query = parse(formatQuery, request.query);
      const contacts = await exportContacts(deps, { ...ref(request, workspaceId), format: query.format });
      const name = exportSegment(`Contacts - ${new Date().toISOString().slice(0, 10)}`);
      return query.format === 'csv'
        ? reply.type('text/csv; charset=utf-8').header('Content-Disposition', attachment(`${name}.csv`)).send(contactsToCsv(contacts))
        : reply.type('text/vcard; charset=utf-8').header('Content-Disposition', attachment(`${name}.vcf`)).send(contactsToVcard(contacts));
    },
  );

  // Reads an import file (the raw body; `format=csv|vcard`) and answers what it would create, with the
  // possible duplicates. Saves nothing.
  app.post(
    '/contacts/import/preview',
    { bodyLimit: MAX_CONTACT_IMPORT_BYTES, config: { rateLimit: { max: 30, timeWindow: 15 * MINUTE_MS, hook: 'preHandler', keyGenerator: (request: FastifyRequest) => `contact-import:${request.principal?.user.id ?? request.ip}` } } },
    async (request) => {
      const { workspaceId } = parse(workspaceParams, request.params);
      const query = parse(formatQuery, request.query);
      const body = request.body;
      const preview = await previewContactImport(deps, {
        ...ref(request, workspaceId),
        // Only after the actor is authorised is the body looked at, and the file read, at all.
        parse: () => {
          if (!Buffer.isBuffer(body)) throw new InvalidRequestError();
          return query.format === 'csv' ? parseContactsCsv(decodeContactFile(body)) : parseContactsVcard(decodeContactFile(body));
        },
      });
      return { entries: preview.entries.map(entryView), ignored: preview.ignored };
    },
  );

  // Saves exactly the Contacts confirmed after the preview — each checked again; all or nothing.
  app.post('/contacts/import', { bodyLimit: IMPORT_BODY_LIMIT }, async (request, reply) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const body = parse(importBody, request.body);
    return reply.code(201).send({ created: await importContacts(deps, { ...ref(request, workspaceId), contacts: body.contacts, format: body.format }) });
  });

  app.get('/contacts/:contactId', async (request) => {
    const { workspaceId, contactId } = parse(contactParams, request.params);
    const found = await getContact(deps, { ...ref(request, workspaceId), contactId });
    return { contact: contactView(found.contact), duplicates: found.duplicates.map(duplicateView) };
  });

  app.post('/contacts/:contactId/update', { bodyLimit: BODY_LIMIT }, async (request) => {
    const { workspaceId, contactId } = parse(contactParams, request.params);
    const { expectedRevision, ...fields } = parse(updateBody, request.body);
    const updated = await updateContact(deps, { ...ref(request, workspaceId), contactId, expectedRevision, content: fields });
    return { contact: contactView(updated.contact), duplicates: updated.duplicates.map(duplicateView) };
  });

  app.post('/contacts/:contactId/delete', { bodyLimit: 1024 }, async (request, reply) => {
    const { workspaceId, contactId } = parse(contactParams, request.params);
    await deleteContact(deps, { ...ref(request, workspaceId), contactId });
    return reply.code(204).send();
  });

  app.post('/contacts/:contactId/restore', { bodyLimit: 1024 }, async (request) => {
    const { workspaceId, contactId } = parse(contactParams, request.params);
    return { contact: contactView(await restoreContact(deps, { ...ref(request, workspaceId), contactId })) };
  });

  // The Procedures linked to a Contact. (Its Documents: `GET …/document-links?contact=<id>`.)
  app.get('/contacts/:contactId/procedures', async (request) => {
    const { workspaceId, contactId } = parse(contactParams, request.params);
    return { links: (await listContactProcedures(deps, { ...ref(request, workspaceId), contactId })).map(procedureLinkView) };
  });

  app.post('/contacts/:contactId/procedures', { bodyLimit: 1024 }, async (request, reply) => {
    const { workspaceId, contactId } = parse(contactParams, request.params);
    const { procedureId } = parse(linkBody, request.body);
    return reply.code(201).send({ link: procedureLinkView(await linkContactProcedure(deps, { ...ref(request, workspaceId), contactId, procedureId })) });
  });

  // The Contacts linked to one Procedure: `?procedure=<id>`.
  app.get('/contact-links', async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const { procedure } = parse(procedureQuery, request.query);
    return { links: (await listProcedureContacts(deps, { ...ref(request, workspaceId), procedureId: procedure })).map(procedureContactView) };
  });

  app.post('/contact-links/:linkId/delete', { bodyLimit: 1024 }, async (request, reply) => {
    const { workspaceId, linkId } = parse(linkParams, request.params);
    await unlinkContactProcedure(deps, { ...ref(request, workspaceId), linkId });
    return reply.code(204).send();
  });
}
