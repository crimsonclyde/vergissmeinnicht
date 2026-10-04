import type { DocumentFileId } from './document-file.ts';
import { DomainValidationError } from './errors.ts';
import { normalizeProcedureTags } from './procedure.ts';
import { BIDI_CONTROLS, CONTROL_CHARS, normalizeSingleLineName } from './text.ts';
import { UUID_V4 } from './user.ts';

/**
 * Documents (steps.md 16.2). A **Folder** is a named, nestable place; a **Document** is one record
 * (title, dates, type, tags, notes) holding one or more ordered files, shown as pages. Deleting moves a
 * record to **Trash**; nothing here deletes for good. All of it is optional per Workspace: the
 * Documents tool is switched on by a Workspace admin.
 */
export type FolderId = string & { readonly __brand: 'FolderId' };
export type DocumentId = string & { readonly __brand: 'DocumentId' };
export type DocumentTypeId = string & { readonly __brand: 'DocumentTypeId' };

/** The optional tools a Workspace admin can enable (section 16): Documents (16.2), Contacts (16.6) and Maintenance (16.7) so far. */
export const WORKSPACE_TOOLS = ['PROCEDURES', 'REMINDERS', 'LISTS', 'CALENDAR', 'DOCUMENTS', 'CONTACTS', 'MAINTENANCE', 'EQUIPMENT'] as const;
export type WorkspaceTool = (typeof WORKSPACE_TOOLS)[number];

export const MAX_FOLDER_NAME_LENGTH = 80;
/** A top-level Folder has depth 1. */
export const MAX_FOLDER_DEPTH = 10;
export const MAX_FOLDERS_PER_WORKSPACE = 1000;
export const MAX_DOCUMENT_TITLE_LENGTH = 200;
export const MAX_DOCUMENT_NOTES_LENGTH = 4000;
export const MAX_FILES_PER_DOCUMENT = 50;
export const MAX_DOCUMENTS_PER_WORKSPACE = 50_000;
export const MAX_DOCUMENT_TYPE_NAME_LENGTH = 60;
export const MAX_CUSTOM_DOCUMENT_TYPES = 100;
/** Items of Trash deleted for good in one request ("Empty Trash" has no such limit). */
export const MAX_TRASH_ITEMS_PER_PURGE = 200;
/** Documents moved in one request. */
export const MAX_DOCUMENTS_PER_MOVE = 200;

/** Built-in types; a Workspace adds its own ("Condominium minutes"). */
export const BUILT_IN_DOCUMENT_TYPES = ['bill', 'receipt', 'contract', 'tax_notice', 'manual', 'warranty', 'inspection_report', 'correspondence'] as const;
export type BuiltInDocumentType = (typeof BUILT_IN_DOCUMENT_TYPES)[number];

/** A Document's type: a built-in one by key, or a Workspace's own by id. */
export type DocumentTypeRef = { readonly kind: 'builtin'; readonly key: BuiltInDocumentType } | { readonly kind: 'custom'; readonly id: DocumentTypeId };

function parseId<T extends string>(value: string, field: string, code: string): T {
  if (!UUID_V4.test(value)) throw new DomainValidationError(field, code, 'Id must be a lower-case UUIDv4');
  return value as T;
}
export const parseFolderId = (value: string) => parseId<FolderId>(value, 'folder', 'invalid_folder_id');
export const parseDocumentId = (value: string) => parseId<DocumentId>(value, 'document', 'invalid_document_id');
export const parseDocumentTypeId = (value: string) => parseId<DocumentTypeId>(value, 'type', 'invalid_document_type_id');

export function parseWorkspaceTool(value: string): WorkspaceTool {
  if (!(WORKSPACE_TOOLS as readonly string[]).includes(value)) throw new DomainValidationError('tool', 'invalid_tool', 'Unknown tool');
  return value as WorkspaceTool;
}

/** 1–80 code points, single line, no control or bidi characters, and no `/` (the separator of a shown path). */
export function normalizeFolderName(input: string): string {
  const name = normalizeSingleLineName(input, { field: 'name', codePrefix: 'folder_name', label: 'Folder name', maxLength: MAX_FOLDER_NAME_LENGTH });
  if (name.includes('/')) throw new DomainValidationError('name', 'folder_name_invalid_characters', 'A folder name cannot contain “/”');
  return name;
}

/** Siblings are compared by this: compatibility-normalised and without case, so "Water", "water" and "Ｗater" are one name. */
export function folderNameKey(name: string): string {
  return name.normalize('NFKC').toLowerCase();
}

export function normalizeDocumentTitle(input: string): string {
  return normalizeSingleLineName(input, { field: 'title', codePrefix: 'document_title', label: 'Title', maxLength: MAX_DOCUMENT_TITLE_LENGTH });
}

export function normalizeDocumentTypeName(input: string): string {
  return normalizeSingleLineName(input, { field: 'name', codePrefix: 'document_type_name', label: 'Type name', maxLength: MAX_DOCUMENT_TYPE_NAME_LENGTH });
}

// Line feed and tab are the only control characters notes may contain.
const DISALLOWED_IN_NOTES = new RegExp(`(?![\\n\\t])${CONTROL_CHARS.source}`, 'u');

/** Plain text (rendered as text). May be empty. */
export function normalizeDocumentNotes(input: string): string {
  const notes = input.replace(/\r\n?/g, '\n').normalize('NFC').trim();
  if ([...notes].length > MAX_DOCUMENT_NOTES_LENGTH) throw new DomainValidationError('notes', 'document_notes_too_long', 'Notes are too long');
  if (DISALLOWED_IN_NOTES.test(notes) || BIDI_CONTROLS.test(notes)) throw new DomainValidationError('notes', 'document_notes_invalid_characters', 'Notes contain control characters');
  return notes;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The date on the paper: a calendar date `YYYY-MM-DD` between 1900 and 2200 — old contracts are documents too. */
export function parseDocumentDate(value: string): string {
  const match = DATE.exec(value);
  if (match !== null) {
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const check = new Date(Date.UTC(year, month - 1, day));
    if (year >= 1900 && year <= 2200 && check.getUTCMonth() === month - 1 && check.getUTCDate() === day) return value;
  }
  throw new DomainValidationError('documentDate', 'invalid_document_date', 'The document date must be a calendar date');
}

/** The year a Document belongs to — independent of its date: a 2026 tax notice may be dated January 2027. */
export function parseDocumentYear(value: number): number {
  if (!Number.isInteger(value) || value < 1900 || value > 2200) throw new DomainValidationError('year', 'invalid_document_year', 'The year must be between 1900 and 2200');
  return value;
}

export function parseDocumentTypeRef(input: { readonly builtIn?: string | undefined; readonly customId?: string | undefined } | null | undefined): DocumentTypeRef | null {
  if (input === null || input === undefined) return null;
  if (input.builtIn !== undefined && input.customId === undefined && (BUILT_IN_DOCUMENT_TYPES as readonly string[]).includes(input.builtIn)) {
    return { kind: 'builtin', key: input.builtIn as BuiltInDocumentType };
  }
  if (input.customId !== undefined && input.builtIn === undefined) return { kind: 'custom', id: parseDocumentTypeId(input.customId) };
  throw new DomainValidationError('type', 'invalid_document_type', 'Unknown document type');
}

/** The ordered files of a Document: 1–50 distinct files. */
export function parseDocumentFileIds(ids: readonly string[]): DocumentFileId[] {
  if (ids.length === 0) throw new DomainValidationError('files', 'document_needs_file', 'A document needs at least one file');
  if (ids.length > MAX_FILES_PER_DOCUMENT) throw new DomainValidationError('files', 'too_many_document_files', 'A document holds at most 50 files');
  if (new Set(ids).size !== ids.length || ids.some((id) => !UUID_V4.test(id))) throw new DomainValidationError('files', 'invalid_document_files', 'The files of the document are not valid');
  return ids as DocumentFileId[];
}

export interface DocumentContent {
  readonly title: string;
  readonly type: DocumentTypeRef | null;
  readonly documentDate: string | null;
  readonly year: number | null;
  readonly notes: string;
  readonly tags: string[];
}

/** Only the title is required; everything else is optional (a general-purpose Workspace needs no house-specific data). */
export function normalizeDocumentContent(input: {
  readonly title: string;
  readonly type?: { readonly builtIn?: string | undefined; readonly customId?: string | undefined } | null | undefined;
  readonly documentDate?: string | null | undefined;
  readonly year?: number | null | undefined;
  readonly notes?: string | undefined;
  readonly tags?: readonly string[] | undefined;
}): DocumentContent {
  return {
    title: normalizeDocumentTitle(input.title),
    type: parseDocumentTypeRef(input.type),
    documentDate: input.documentDate === null || input.documentDate === undefined ? null : parseDocumentDate(input.documentDate),
    year: input.year === null || input.year === undefined ? null : parseDocumentYear(input.year),
    notes: normalizeDocumentNotes(input.notes ?? ''),
    tags: normalizeProcedureTags(input.tags ?? []),
  };
}

/** A title proposed from a file name: the name without its extension, shortened to fit. */
export function titleFromFileName(name: string): string {
  const dot = name.lastIndexOf('.');
  const stem = (dot > 0 ? name.slice(0, dot) : name).trim();
  return [...(stem.length === 0 ? name : stem)].slice(0, MAX_DOCUMENT_TITLE_LENGTH).join('');
}

// ---- The Folder tree: pure rules, used by the repository inside its transaction and tested on their own.

/** A Folder as the tree rules see it. `deleted` = in Trash. */
export interface FolderNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly deleted: boolean;
}

export type FolderPlacementProblem = 'parent_not_found' | 'cycle' | 'too_deep' | 'name_taken';

const byId = (folders: readonly FolderNode[]) => new Map(folders.map((folder) => [folder.id, folder]));

/** Depth of a Folder (top level = 1), following parents whether or not they are in Trash; `undefined` if the chain is broken. */
export function folderDepth(folders: readonly FolderNode[], folderId: string | null): number | undefined {
  const index = byId(folders);
  let depth = 0;
  for (let current = folderId; current !== null; depth++) {
    const folder = index.get(current);
    if (folder === undefined || depth > folders.length) return undefined;
    current = folder.parentId;
  }
  return depth;
}

/** How many levels a Folder's live subtree has, itself included. */
export function subtreeHeight(folders: readonly FolderNode[], folderId: string): number {
  const children = folders.filter((folder) => folder.parentId === folderId && !folder.deleted);
  return 1 + Math.max(0, ...children.map((child) => subtreeHeight(folders, child.id)));
}

/** Whether `folderId` is `ancestorId` or lies below it. */
export function isWithin(folders: readonly FolderNode[], folderId: string | null, ancestorId: string): boolean {
  const index = byId(folders);
  for (let current = folderId, steps = 0; current !== null && steps <= folders.length; steps++) {
    if (current === ancestorId) return true;
    current = index.get(current)?.parentId ?? null;
  }
  return false;
}

/** Whether a live sibling under `parentId` already carries this name (ignoring `exceptId`). */
export function siblingNameTaken(folders: readonly FolderNode[], parentId: string | null, name: string, exceptId?: string): boolean {
  const key = folderNameKey(name);
  return folders.some((folder) => !folder.deleted && folder.parentId === parentId && folder.id !== exceptId && folderNameKey(folder.name) === key);
}

/**
 * Whether a Folder named `name` with a live subtree of `height` levels may sit under `parentId`
 * (`null` = top level). `movingId` is the Folder being moved: it can never go into itself or one of
 * its descendants — that would cut the subtree off as a cycle.
 */
export function folderPlacementProblem(
  folders: readonly FolderNode[],
  input: { readonly parentId: string | null; readonly name: string; readonly height: number; readonly movingId?: string },
): FolderPlacementProblem | undefined {
  if (input.parentId !== null) {
    const parent = byId(folders).get(input.parentId);
    if (parent === undefined || parent.deleted) return 'parent_not_found';
    if (input.movingId !== undefined && isWithin(folders, input.parentId, input.movingId)) return 'cycle';
  }
  const parentDepth = folderDepth(folders, input.parentId);
  if (parentDepth === undefined) return 'parent_not_found';
  if (parentDepth + input.height > MAX_FOLDER_DEPTH) return 'too_deep';
  if (siblingNameTaken(folders, input.parentId, input.name, input.movingId)) return 'name_taken';
  return undefined;
}

/**
 * Where a restored item goes: its original parent if that still exists, otherwise the **nearest
 * ancestor that still exists**, otherwise the top level (`null`). `moved` says the place changed.
 */
export function restoreParent(folders: readonly FolderNode[], parentId: string | null): { readonly parentId: string | null; readonly moved: boolean } {
  const index = byId(folders);
  for (let current = parentId, steps = 0; current !== null && steps <= folders.length; steps++) {
    const folder = index.get(current);
    if (folder === undefined) break;
    if (!folder.deleted) return { parentId: current, moved: current !== parentId };
    current = folder.parentId;
  }
  return { parentId: null, moved: parentId !== null };
}

/** The name a restored Folder gets when a sibling took its name meanwhile: "Water (restored)", then "(restored 2)", … */
export function restoredFolderName(folders: readonly FolderNode[], parentId: string | null, name: string, exceptId?: string): string {
  if (!siblingNameTaken(folders, parentId, name, exceptId)) return name;
  for (let attempt = 1; ; attempt++) {
    const suffix = attempt === 1 ? ' (restored)' : ` (restored ${attempt})`;
    const candidate = `${[...name].slice(0, MAX_FOLDER_NAME_LENGTH - suffix.length).join('')}${suffix}`;
    if (!siblingNameTaken(folders, parentId, candidate, exceptId)) return candidate;
  }
}
