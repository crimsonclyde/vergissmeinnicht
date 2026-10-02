import type { Actor, ContactContent, ContactCursor, ContactId, ContactKey, ContactKeyKind, ContactPoint, ContactQuery, LinkId, WorkspaceId } from '@vergissmeinnicht/domain';
import type { ActorGuard } from './actor-guard.ts';

type UserActor = Actor & { readonly kind: 'user' };

/** A Contact as a list shows it. */
export interface ContactSummary {
  readonly id: ContactId;
  readonly name: string;
  readonly organisation: string;
  readonly category: string;
  readonly emails: readonly ContactPoint[];
  readonly phones: readonly ContactPoint[];
  readonly revision: number;
}

export interface ContactRecord extends ContactSummary {
  readonly address: string;
  readonly website: string;
  readonly notes: string;
  readonly createdAt: Date;
  readonly createdByName: string;
  readonly updatedAt: Date;
  readonly updatedByName: string;
}

/** Another Contact that may be the same person or organisation, and what the two share. Never merged. */
export interface ContactDuplicate {
  readonly id: ContactId;
  readonly name: string;
  readonly organisation: string;
  readonly reasons: readonly ContactKeyKind[];
}

export interface ContactListing {
  readonly contacts: ContactSummary[];
  readonly next: ContactCursor | null;
  /** Counted for the first page only. */
  readonly total: number | null;
}

export interface TrashedContact {
  readonly id: ContactId;
  readonly name: string;
  readonly organisation: string;
  readonly deletedAt: Date;
  readonly deletedByName: string;
}

/** A Procedure linked to a Contact. */
export interface ContactProcedureLink {
  readonly id: LinkId;
  readonly procedureId: string;
  /** `null` when the Procedure no longer exists. */
  readonly title: string | null;
  readonly state: 'ok' | 'deleted' | 'gone';
  readonly createdAt: Date;
  readonly createdByName: string;
}

/**
 * A Contact linked to a Procedure, seen from the Procedure. A Contact in Trash or deleted for good is
 * a "deleted contact": that one was linked is still known, not who.
 */
export interface ProcedureContactLink {
  readonly id: LinkId;
  readonly contact: ContactSummary | null;
}

export type ContactRefusal = 'forbidden' | 'tool_disabled' | 'contact_not_found' | 'conflict' | 'limit_reached' | 'procedure_not_found' | 'link_not_found' | 'already_linked';
export type ContactWrite<T = unknown> = ({ readonly status: 'ok' } & T) | { readonly status: ContactRefusal };

/**
 * Contacts of a Workspace (16.6). Every method is scoped by the Workspace: an id of another Workspace
 * finds nothing. Writes run in one IMMEDIATE transaction that re-checks the actor and the tool switch
 * and records the audit event — which never holds a name, an address or a number.
 */
export interface ContactRepository {
  find(workspaceId: WorkspaceId, query: ContactQuery, after: ContactCursor | null, limit: number): Promise<ContactListing>;
  /** The categories in use (one spelling each), for the filter and as suggestions. */
  categories(workspaceId: WorkspaceId): Promise<string[]>;
  /** A Contact that is not in Trash. */
  get(workspaceId: WorkspaceId, contactId: ContactId): Promise<ContactRecord | undefined>;
  /** Contacts (not in Trash) sharing one of these keys. `except`: the Contact itself. */
  duplicatesOf(workspaceId: WorkspaceId, keys: readonly ContactKey[], except: ContactId | null): Promise<ContactDuplicate[]>;
  create(input: { readonly workspaceId: WorkspaceId; readonly content: ContactContent; readonly at: Date }, actor: UserActor, guard: ActorGuard): Promise<ContactWrite<{ contact: ContactRecord }>>;
  update(
    input: { readonly workspaceId: WorkspaceId; readonly contactId: ContactId; readonly content: ContactContent; readonly expectedRevision: number; readonly at: Date },
    actor: UserActor,
    guard: ActorGuard,
  ): Promise<ContactWrite<{ contact: ContactRecord }>>;
  /** To Trash. */
  delete(input: { readonly workspaceId: WorkspaceId; readonly contactId: ContactId; readonly at: Date }, actor: UserActor, guard: ActorGuard): Promise<ContactWrite>;
  restore(input: { readonly workspaceId: WorkspaceId; readonly contactId: ContactId; readonly at: Date }, actor: UserActor, guard: ActorGuard): Promise<ContactWrite<{ contact: ContactRecord }>>;
  listTrash(workspaceId: WorkspaceId): Promise<TrashedContact[]>;
  /** Deletes Contacts in Trash for good — those named, or all of Trash. Links to them say "deleted contact" from then on. */
  purge(input: { readonly workspaceId: WorkspaceId; readonly contactIds: readonly ContactId[] | 'all'; readonly at: Date }, actor: UserActor, guard: ActorGuard): Promise<ContactWrite<{ purged: number }>>;
  /** All or nothing: every Contact of an import is created, or none. One audit event with the number. */
  importMany(input: { readonly workspaceId: WorkspaceId; readonly contents: readonly ContactContent[]; readonly format: 'csv' | 'vcard'; readonly at: Date }, actor: UserActor, guard: ActorGuard): Promise<ContactWrite<{ created: number }>>;
  /** Every Contact that is not in Trash, by name; records who exported, in which format and how many. */
  exportAll(input: { readonly workspaceId: WorkspaceId; readonly format: 'csv' | 'vcard'; readonly at: Date }, actor: UserActor, guard: ActorGuard): Promise<ContactWrite<{ contacts: ContactRecord[] }>>;

  /** The Procedures linked to a Contact. `undefined` = no such Contact. */
  procedureLinks(workspaceId: WorkspaceId, contactId: ContactId): Promise<ContactProcedureLink[] | undefined>;
  /** The Contacts linked to a Procedure. */
  linksOfProcedure(workspaceId: WorkspaceId, procedureId: string): Promise<ProcedureContactLink[]>;
  linkProcedure(input: { readonly workspaceId: WorkspaceId; readonly contactId: ContactId; readonly procedureId: string; readonly at: Date }, actor: UserActor, guard: ActorGuard): Promise<ContactWrite<{ link: ContactProcedureLink }>>;
  /** Removes a Link between a Contact and a Procedure (never either record). */
  unlinkProcedure(input: { readonly workspaceId: WorkspaceId; readonly linkId: LinkId; readonly at: Date }, actor: UserActor, guard: ActorGuard): Promise<ContactWrite>;
}
