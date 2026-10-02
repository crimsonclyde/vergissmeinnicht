import { DomainValidationError, normalizeRemovalReason, parseDocumentId, parseLinkId, parseLinkTarget, parseRunDocumentId, parseRunId, type LinkTarget, type User, type WorkspaceId } from '@vergissmeinnicht/domain';
import { roleHasCapability } from '@vergissmeinnicht/permissions';
import { DocumentLimitReachedError, DocumentNotFoundError, ToolNotEnabledError } from '../documents/errors.ts';
import { authorizeTool } from '../documents/tools.ts';
import { NotAuthorizedError } from '../invitations/errors.ts';
import type { ActorGuard } from '../ports/actor-guard.ts';
import type { Clock } from '../ports/clock.ts';
import type { WorkspaceToolRepository } from '../ports/document-repository.ts';
import type { LinkRefusal, LinkRepository, LinkView, LinkWrite, RunDocumentRemoval, RunDocumentView, RunLinkView } from '../ports/link-repository.ts';
import type { WorkspaceRepository } from '../ports/workspace-repository.ts';
import { RunNotFoundError } from '../runs/errors.ts';
import { userActor } from '../user-actor.ts';
import { authorizeWorkspace } from '../workspaces/use-cases.ts';

export interface LinkDeps {
  readonly workspaces: WorkspaceRepository;
  readonly tools: WorkspaceToolRepository;
  readonly links: LinkRepository;
  readonly clock: Clock;
}

/** The record to link does not exist in this Workspace (or is deleted, or in Trash). */
export class LinkTargetNotFoundError extends Error {
  constructor() {
    super('The record to link was not found');
    this.name = 'LinkTargetNotFoundError';
  }
}

export class LinkNotFoundError extends Error {
  constructor() {
    super('Link not found');
    this.name = 'LinkNotFoundError';
  }
}

export class AlreadyLinkedError extends Error {
  constructor() {
    super('Already linked');
    this.name = 'AlreadyLinkedError';
  }
}

/** The Run is still active: a kept Document is then removed the ordinary way, without a note. */
export class RunStillActiveError extends Error {
  constructor() {
    super('The Run is still active');
    this.name = 'RunStillActiveError';
  }
}

/** A Document version kept by a finished Run is not removed the ordinary way: only a Workspace admin can, with a reason (P4). */
export class RunFinishedError extends Error {
  constructor() {
    super('The Run is finished');
    this.name = 'RunFinishedError';
  }
}

interface Ref {
  readonly actor: User;
  readonly workspaceId: WorkspaceId;
}

/**
 * Whoever links must be able to manage Documents **and** to read the other end — both re-checked
 * inside the write. (Today every role that manages Documents also reads Procedures and Runs; the
 * check is spelled out so that this stays true if the matrix changes.)
 */
const linker: ActorGuard = { actorMay: (role) => roleHasCapability(role, 'document.manage') && roleHasCapability(role, 'procedure.view') && roleHasCapability(role, 'run.view') && roleHasCapability(role, 'contact.view') };

function refuse(status: LinkRefusal): never {
  switch (status) {
    case 'forbidden':
      throw new NotAuthorizedError();
    case 'tool_disabled':
      throw new ToolNotEnabledError();
    case 'document_not_found':
      throw new DocumentNotFoundError();
    case 'target_not_found':
      throw new LinkTargetNotFoundError();
    case 'run_not_found':
      throw new RunNotFoundError();
    case 'link_not_found':
      throw new LinkNotFoundError();
    case 'already_linked':
      throw new AlreadyLinkedError();
    case 'limit_reached':
      throw new DocumentLimitReachedError();
    case 'run_finished':
      throw new RunFinishedError();
    case 'run_active':
      throw new RunStillActiveError();
  }
}

function ok<T>(result: LinkWrite<T>): { readonly status: 'ok' } & T {
  if (result.status !== 'ok') refuse(result.status);
  return result;
}

/** Reading Links needs the Documents tool, `document.view`, and the view capability of the other kind of record. */
async function reader(deps: LinkDeps, input: Ref, also: 'procedure.view' | 'run.view'): Promise<{ readonly seesTrash: boolean }> {
  await authorizeTool(deps, input.actor, input.workspaceId, 'DOCUMENTS', 'document.view');
  const membership = await authorizeWorkspace(deps, input.actor, input.workspaceId, also);
  return { seesTrash: roleHasCapability(membership.role, 'document.manage') };
}

/**
 * A Link never reveals what its viewer may not read: a Document in Trash is visible only to those who
 * can open Trash (`document.manage`) — everyone else learns that a Document in Trash is linked, not
 * which one.
 */
const withoutHiddenTitles = (links: LinkView[], seesTrash: boolean): LinkView[] =>
  seesTrash ? links : links.map((link) => (link.record.type === 'document' && link.record.state === 'trash' ? { ...link, record: { ...link.record, title: null, goneByName: null } } : link));

/** What a Document is linked to — Procedures, Reminders and scheduled Procedures, related Documents — and the Runs that retain a version of it. */
export async function listDocumentLinks(deps: LinkDeps, input: Ref & { readonly documentId: string }): Promise<{ readonly links: LinkView[]; readonly runs: RunLinkView[] }> {
  const { seesTrash } = await reader(deps, input, 'procedure.view');
  const found = await deps.links.listForDocument(input.workspaceId, parseDocumentId(input.documentId));
  if (found === undefined) throw new DocumentNotFoundError();
  // A tool that is switched off appears nowhere: Links to Contacts are shown only where Contacts is on.
  const on = await deps.tools.enabled(input.workspaceId);
  const membership = await authorizeWorkspace(deps, input.actor, input.workspaceId, 'workspace.view');
  const shown = (type: string): boolean =>
    type === 'contact' ? on.includes('CONTACTS') : type === 'maintenance' ? on.includes('MAINTENANCE') && roleHasCapability(membership.role, 'maintenance.view') : true;
  return { links: withoutHiddenTitles(found.links, seesTrash).filter((link) => shown(link.record.type)), runs: found.runs };
}

/** The Documents linked to a Procedure or to a Schedule (shown on the Reminder and on its Occurrences). */
export async function listLinkedDocuments(deps: LinkDeps, input: Ref & { readonly target: { readonly type: string; readonly id: string } }): Promise<LinkView[]> {
  const { seesTrash } = await reader(deps, input, 'procedure.view');
  const target = parseLinkTarget(input.target);
  if (target.type === 'contact') await authorizeTool(deps, input.actor, input.workspaceId, 'CONTACTS', 'contact.view');
  return withoutHiddenTitles(await deps.links.listForTarget(input.workspaceId, target), seesTrash);
}

/**
 * Links a Document to a Procedure, a Schedule or another Document of the same Workspace
 * (`document.manage`, and read access to the other end). A reference only: nothing is copied and
 * nobody gains access to anything. Audited.
 */
export async function addDocumentLink(deps: LinkDeps, input: Ref & { readonly documentId: string; readonly target: { readonly type: string; readonly id: string } }): Promise<LinkView> {
  await authorizeTool(deps, input.actor, input.workspaceId, 'DOCUMENTS', 'document.manage');
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'procedure.view');
  const target: LinkTarget = parseLinkTarget(input.target);
  // A Contact as the other end: the Contacts tool must be on, and its Contacts readable.
  if (target.type === 'contact') await authorizeTool(deps, input.actor, input.workspaceId, 'CONTACTS', 'contact.view');
  return ok(await deps.links.add({ workspaceId: input.workspaceId, documentId: parseDocumentId(input.documentId), target, at: deps.clock.now() }, userActor(input.actor), linker)).link;
}

/** Removes a Link (never either record). Audited. */
export async function removeDocumentLink(deps: LinkDeps, input: Ref & { readonly linkId: string }): Promise<void> {
  await authorizeTool(deps, input.actor, input.workspaceId, 'DOCUMENTS', 'document.manage');
  ok(await deps.links.remove({ workspaceId: input.workspaceId, linkId: parseLinkId(input.linkId), at: deps.clock.now() }, userActor(input.actor), linker));
}

/** The Document versions a Run retains, with their files of then, and the notes of versions removed from it (`run.view` and `document.view`). */
export async function listRunDocuments(deps: LinkDeps, input: Ref & { readonly runId: string }): Promise<{ readonly documents: RunDocumentView[]; readonly removals: RunDocumentRemoval[] }> {
  await reader(deps, input, 'run.view');
  const found = await deps.links.listForRun(input.workspaceId, parseRunId(input.runId));
  if (found === undefined) throw new RunNotFoundError();
  return found;
}

/**
 * Links a Document to a Run — ACTIVE or finished — by **retaining the Document as it is now**: its
 * details and its files. Later edits, Trash or permanent deletion of the Document never change what
 * the Run shows. The Run itself (snapshot, Steps, earlier history) is not touched; the addition is
 * recorded in the Run's history. This is not a completion photo and proves nothing by itself (14.5).
 */
export async function linkRunDocument(deps: LinkDeps, input: Ref & { readonly runId: string; readonly documentId: string }): Promise<RunDocumentView> {
  await authorizeTool(deps, input.actor, input.workspaceId, 'DOCUMENTS', 'document.manage');
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'run.view');
  const values = { workspaceId: input.workspaceId, runId: parseRunId(input.runId), documentId: parseDocumentId(input.documentId), at: deps.clock.now() };
  return ok(await deps.links.linkRun(values, userActor(input.actor), linker)).document;
}

/** Re-checked inside the removing transaction: only a Workspace admin removes what a finished Run keeps. */
const remover: ActorGuard = { actorMay: (role) => roleHasCapability(role, 'run.document.remove') };

/**
 * Removes a Document version from a **finished** Run (P4, decided 2026-10-02): a Workspace admin only
 * (`run.document.remove`), with an explicit confirmation and a reason. The Run then no longer shows
 * the version or its files; in its place stays a permanent note — who removed it, when and why — and
 * an entry in the Run's history. The Document itself, versions other Runs keep, the Run's results
 * and its earlier history are not touched. Files nothing else references become unreachable at once
 * and stop counting towards storage; copies in existing backups follow the backup retention.
 */
export async function removeRunDocumentFromFinishedRun(
  deps: LinkDeps,
  input: Ref & { readonly runId: string; readonly runDocumentId: string; readonly reason: string; readonly confirmed: boolean },
): Promise<RunDocumentRemoval> {
  await authorizeTool(deps, input.actor, input.workspaceId, 'DOCUMENTS', 'document.view');
  await authorizeWorkspace(deps, input.actor, input.workspaceId, 'run.document.remove');
  if (!input.confirmed) throw new DomainValidationError('confirmed', 'removal_not_confirmed', 'Confirm the removal');
  const values = { workspaceId: input.workspaceId, runId: parseRunId(input.runId), runDocumentId: parseRunDocumentId(input.runDocumentId), reason: normalizeRemovalReason(input.reason), at: deps.clock.now() };
  return ok(await deps.links.removeFromFinishedRun(values, userActor(input.actor), remover)).removal;
}

/** Removes a retained Document version from a Run that is still ACTIVE (anyone who manages Documents). From a finished Run: `removeRunDocumentFromFinishedRun`. Audited. */
export async function unlinkRunDocument(deps: LinkDeps, input: Ref & { readonly runId: string; readonly runDocumentId: string }): Promise<void> {
  await authorizeTool(deps, input.actor, input.workspaceId, 'DOCUMENTS', 'document.manage');
  const values = { workspaceId: input.workspaceId, runId: parseRunId(input.runId), runDocumentId: parseRunDocumentId(input.runDocumentId), at: deps.clock.now() };
  ok(await deps.links.unlinkRun(values, userActor(input.actor), linker));
}
