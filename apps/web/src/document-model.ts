import type { DocumentDetail, DocumentFields, DocumentFile, DocumentFilterValues, DocumentFolder, DocumentSummary, DocumentTypeView, DocumentTypes, RestoreOutcome, TrashEntry } from './api.ts';
import { formatCalendarDate, formatDateTime, formatNumber, hasMessage, t } from './i18n/index.ts';

/** What the file picker offers; the server decides from the content, not from this list or the name. */
export const ACCEPTED_FILES = '.pdf,.jpg,.jpeg,.png,.heic,.heif,application/pdf,image/jpeg,image/png,image/heic,image/heif';

const byName = (a: DocumentFolder, b: DocumentFolder) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });

/** The Folders directly inside `parentId` (`null` = top level), by name. */
export function childFolders(folders: readonly DocumentFolder[], parentId: string | null): DocumentFolder[] {
  return folders.filter((folder) => folder.parentId === parentId).sort(byName);
}

/** The Folders from the top level down to `folderId` (the breadcrumb); empty for the top level or an unknown id. */
export function folderPath(folders: readonly DocumentFolder[], folderId: string | null): DocumentFolder[] {
  const index = new Map(folders.map((folder) => [folder.id, folder]));
  const path: DocumentFolder[] = [];
  for (let current = folderId; current !== null && path.length <= folders.length; ) {
    const folder = index.get(current);
    if (folder === undefined) return [];
    path.unshift(folder);
    current = folder.parentId;
  }
  return path;
}

/** "Water / 2026" — how a place is named in pickers and facts. */
export function folderLabel(folders: readonly DocumentFolder[], folderId: string | null): string {
  const path = folderPath(folders, folderId);
  return path.length === 0 ? t('documents.topLevel') : path.map((folder) => folder.name).join(' / ');
}

/** Every Folder in tree order with its depth (for an indented list or picker). */
export function folderTree(folders: readonly DocumentFolder[], parentId: string | null = null, depth = 0): { folder: DocumentFolder; depth: number }[] {
  return childFolders(folders, parentId).flatMap((folder) => [{ folder, depth }, ...folderTree(folders, folder.id, depth + 1)]);
}

/** Where a Folder may be moved: anywhere but into itself or one of its own sub-folders (the server checks the same). */
export function moveTargets(folders: readonly DocumentFolder[], movingId: string): { folder: DocumentFolder; depth: number }[] {
  const inside = new Set(folderPath(folders, movingId).length === 0 ? [] : [movingId, ...folderTree(folders, movingId).map((entry) => entry.folder.id)]);
  return folderTree(folders).filter((entry) => !inside.has(entry.folder.id));
}

/** What goes to Trash with a Folder: its sub-folders and the Documents in all of them. */
export function folderContents(folders: readonly DocumentFolder[], folderId: string): { folders: number; documents: number } {
  const below = folderTree(folders, folderId).map((entry) => entry.folder);
  const own = folders.find((folder) => folder.id === folderId)?.documents ?? 0;
  return { folders: below.length, documents: own + below.reduce((sum, folder) => sum + folder.documents, 0) };
}

export function typeLabel(type: DocumentTypeView | null): string | null {
  if (type === null) return null;
  if (type.kind === 'custom') return type.retired ? t('documents.type.retired', { name: type.name }) : type.name;
  const key = `documents.type.${type.key}`;
  return hasMessage(key) ? t(key) : type.key;
}

/** The value of the type field for a Document's type, and back. */
export const typeValue = (type: DocumentTypeView | null): string => (type === null ? '' : type.kind === 'builtin' ? `builtin:${type.key}` : `custom:${type.id}`);
export function typeFromValue(value: string): DocumentFields['type'] {
  if (value.startsWith('builtin:')) return { builtIn: value.slice('builtin:'.length) };
  if (value.startsWith('custom:')) return { customId: value.slice('custom:'.length) };
  return null;
}

/** The types offered for choosing: built-in ones, the Workspace's own that are not retired — and the current one even if retired. */
export function typeOptions(types: DocumentTypes, current: DocumentTypeView | null): { value: string; label: string }[] {
  const builtIn = types.builtIn.map((key) => ({ value: `builtin:${key}`, label: typeLabel({ kind: 'builtin', key }) ?? key }));
  const custom = types.custom
    .filter((type) => !type.retired || (current?.kind === 'custom' && current.id === type.id))
    .map((type) => ({ value: `custom:${type.id}`, label: typeLabel({ kind: 'custom', ...type }) ?? type.name }));
  return [...builtIn, ...custom].sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The date shown with a Document, always with its meaning: the date on the paper when there is one,
 * otherwise when it was uploaded — the two are never shown as if they were the same thing.
 */
export function dateLine(document: Pick<DocumentSummary, 'documentDate' | 'uploadedAt'>): string {
  return document.documentDate === null ? t('documents.uploadedOn', { when: formatDateTime(document.uploadedAt) }) : t('documents.documentDateOn', { date: formatCalendarDate(document.documentDate) });
}

// ---- Finding Documents (16.3): what is searched, filtered and sorted — applied by the server.

export const DOCUMENT_SORTS = ['uploaded', 'documentDate', 'title', 'modified'] as const;
export type DocumentSort = (typeof DOCUMENT_SORTS)[number];
export type SortDirection = 'asc' | 'desc';

/** Newest first for the dates, A → Z for titles — as the server defaults. */
export const defaultDirection = (sort: DocumentSort): SortDirection => (sort === 'title' ? 'asc' : 'desc');

export interface DocumentFilters {
  readonly q: string;
  /** At the top level only: `''` = all Folders, `'top'` = not in a Folder, or a Folder id. Inside a Folder the address decides. */
  readonly folder: string;
  readonly subfolders: boolean;
  /** As the type field: `''`, `builtin:<key>` or `custom:<id>`. */
  readonly type: string;
  readonly year: string;
  readonly tags: readonly string[];
  readonly uploader: string;
  readonly sort: DocumentSort;
  readonly dir: SortDirection;
}

export const NO_FILTERS: DocumentFilters = { q: '', folder: '', subfolders: false, type: '', year: '', tags: [], uploader: '', sort: 'uploaded', dir: 'desc' };

/** Whether anything narrows the list (the order does not). */
export function isFiltering(filters: DocumentFilters): boolean {
  return filters.q.trim() !== '' || filters.folder !== '' || filters.subfolders || filters.type !== '' || filters.year !== '' || filters.tags.length > 0 || filters.uploader !== '';
}

/** Search and filters removed; the chosen order stays. */
export const cleared = (filters: DocumentFilters): DocumentFilters => ({ ...NO_FILTERS, sort: filters.sort, dir: filters.dir });

const FOLDER_ID = /^[0-9a-f-]{36}$/;

/** The filters as kept in the address (`?q=…&year=…`), so Back from a Document returns to the same list. Defaults are left out. */
export function filtersToSearch(filters: DocumentFilters): string {
  const params = new URLSearchParams();
  if (filters.q.trim() !== '') params.set('q', filters.q.trim());
  if (filters.folder !== '') params.set('folder', filters.folder);
  if (filters.subfolders) params.set('sub', '1');
  if (filters.type !== '') params.set('type', filters.type);
  if (filters.year !== '') params.set('year', filters.year);
  for (const tag of filters.tags) params.append('tag', tag);
  if (filters.uploader !== '') params.set('uploader', filters.uploader);
  if (filters.sort !== NO_FILTERS.sort) params.set('sort', filters.sort);
  if (filters.dir !== defaultDirection(filters.sort)) params.set('dir', filters.dir);
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

/** Reads them back; anything unknown or malformed is dropped (an address is input like any other). */
export function filtersFromSearch(search: string): DocumentFilters {
  const params = new URLSearchParams(search);
  const sort = DOCUMENT_SORTS.find((each) => each === params.get('sort')) ?? NO_FILTERS.sort;
  const dir = params.get('dir');
  const folder = params.get('folder') ?? '';
  const type = params.get('type') ?? '';
  const year = params.get('year') ?? '';
  return {
    q: (params.get('q') ?? '').slice(0, 100),
    folder: folder === 'top' || FOLDER_ID.test(folder) ? folder : '',
    subfolders: params.get('sub') === '1',
    type: /^(builtin:[a-z_]{1,40}|custom:[0-9a-f-]{36})$/.test(type) ? type : '',
    year: /^\d{4}$/.test(year) ? year : '',
    tags: [...new Set(params.getAll('tag').map((tag) => tag.trim()).filter((tag) => tag !== ''))].slice(0, 10),
    uploader: (params.get('uploader') ?? '').trim().slice(0, 200),
    sort,
    dir: dir === 'asc' || dir === 'desc' ? dir : defaultDirection(sort),
  };
}

/**
 * The parameters of one request to the server. Inside a Folder (`routeFolderId`) the list is that
 * Folder — with its sub-folders if asked; at the top level it is everything unless a Folder is chosen.
 */
export function listingParams(filters: DocumentFilters, routeFolderId: string | null, cursor: string | null): string {
  const params = new URLSearchParams();
  const folder = routeFolderId ?? filters.folder;
  if (filters.q.trim() !== '') params.set('q', filters.q.trim());
  if (folder !== '') params.set('folder', folder);
  if (filters.subfolders && folder !== '' && folder !== 'top') params.set('sub', '1');
  if (filters.type !== '') params.set('type', filters.type);
  if (filters.year !== '') params.set('year', filters.year);
  for (const tag of filters.tags) params.append('tag', tag);
  if (filters.uploader !== '') params.set('uploader', filters.uploader);
  params.set('sort', filters.sort);
  params.set('dir', filters.dir);
  if (cursor !== null) params.set('cursor', cursor);
  return params.toString();
}

/** Whether the list can hold Documents of several Folders — then each row says where it is. */
export function spansFolders(filters: DocumentFilters, routeFolderId: string | null): boolean {
  return routeFolderId === null ? filters.folder === '' || (filters.folder !== 'top' && filters.subfolders) : filters.subfolders;
}

/** The eight orders offered, as one choice: what is sorted by, and which way. */
export const SORT_CHOICES: readonly { readonly value: string; readonly sort: DocumentSort; readonly dir: SortDirection }[] = DOCUMENT_SORTS.flatMap((sort) =>
  (defaultDirection(sort) === 'asc' ? (['asc', 'desc'] as const) : (['desc', 'asc'] as const)).map((dir) => ({ value: `${sort}:${dir}`, sort, dir })),
);

/** A type filter in words ("Bill", "Condominium minutes"); the raw value if the type is not known (yet). */
export function typeFilterLabel(value: string, types: DocumentTypes | null): string {
  if (value.startsWith('builtin:')) return typeLabel({ kind: 'builtin', key: value.slice('builtin:'.length) }) ?? value;
  const custom = types?.custom.find((type) => `custom:${type.id}` === value);
  return custom === undefined ? t('documents.find.typeUnknown') : (typeLabel({ kind: 'custom', ...custom }) ?? custom.name);
}

export interface FilterChip {
  readonly key: string;
  readonly label: string;
  /** The filters without this one. */
  readonly without: DocumentFilters;
}

/** Every active filter as a chip that removes exactly that filter. The search text has its own field. */
export function filterChips(filters: DocumentFilters, routeFolderId: string | null, folders: readonly DocumentFolder[], types: DocumentTypes | null): FilterChip[] {
  const chips: FilterChip[] = [];
  if (routeFolderId === null && filters.folder !== '') {
    const where = filters.folder === 'top' ? t('documents.find.folderNone') : folderLabel(folders, filters.folder);
    chips.push({ key: 'folder', label: t(filters.subfolders && filters.folder !== 'top' ? 'documents.find.chip.folderWithSub' : 'documents.find.chip.folder', { name: where }), without: { ...filters, folder: '', subfolders: false } });
  }
  if (routeFolderId !== null && filters.subfolders) chips.push({ key: 'sub', label: t('documents.find.chip.subfolders'), without: { ...filters, subfolders: false } });
  if (filters.type !== '') chips.push({ key: 'type', label: t('documents.find.chip.type', { name: typeFilterLabel(filters.type, types) }), without: { ...filters, type: '' } });
  if (filters.year !== '') chips.push({ key: 'year', label: t('documents.find.chip.year', { year: filters.year }), without: { ...filters, year: '' } });
  for (const tag of filters.tags) chips.push({ key: `tag:${tag}`, label: t('documents.find.chip.tag', { name: tag }), without: { ...filters, tags: filters.tags.filter((each) => each !== tag) } });
  if (filters.uploader !== '') chips.push({ key: 'uploader', label: t('documents.find.chip.uploader', { name: filters.uploader }), without: { ...filters, uploader: '' } });
  return chips;
}

/** The values a filter offers, with the one in use kept even if no Document has it any more. */
export function filterOptions(values: DocumentFilterValues | null, filters: DocumentFilters): { years: string[]; tags: string[]; uploaders: string[] } {
  const withCurrent = (list: readonly string[], current: string) => (current === '' || list.includes(current) ? [...list] : [current, ...list]);
  const lower = filters.tags.map((tag) => tag.toLowerCase());
  return {
    years: withCurrent((values?.years ?? []).map(String), filters.year),
    tags: (values?.tags ?? []).filter((tag) => !lower.includes(tag.toLowerCase())),
    uploaders: withCurrent(values?.uploaders ?? [], filters.uploader),
  };
}

/**
 * The date shown with a Document in a list, **named after what the list is sorted by** — so the date
 * on the paper and the day of the upload are never mistaken for each other. Sorted by title, it is the
 * document date when there is one.
 */
export function sortedDateLine(document: Pick<DocumentSummary, 'documentDate' | 'uploadedAt' | 'modifiedAt'>, sort: DocumentSort): string {
  if (sort === 'uploaded') return t('documents.uploadedOn', { when: formatDateTime(document.uploadedAt) });
  if (sort === 'modified') return t('documents.modifiedOn', { when: formatDateTime(document.modifiedAt) });
  if (sort === 'documentDate') return document.documentDate === null ? t('documents.noDocumentDate') : t('documents.documentDateOn', { date: formatCalendarDate(document.documentDate) });
  return dateLine(document);
}

/** One line under a Document's title in a list: type, the labelled date, pages — and the Folder when the list spans several. */
export function listLine(document: DocumentSummary, sort: DocumentSort, place: string | null): string {
  return [typeLabel(document.type), sortedDateLine(document, sort), t('documents.fileCount', { count: document.files }), place].filter((part) => part !== null).join(' · ');
}

/** Decimal units, as the server counts: 1 MB = 1 000 000 bytes. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return t('documents.size.bytes', { n: formatNumber(bytes) });
  if (bytes < 1_000_000) return t('documents.size.kb', { n: formatNumber(bytes / 1000) });
  if (bytes < 1_000_000_000) return t('documents.size.mb', { n: formatNumber(bytes / 1_000_000, 1) });
  return t('documents.size.gb', { n: formatNumber(bytes / 1_000_000_000, 2) });
}

/** A title proposed from a file name: the name without its extension. */
export function titleFromFileName(name: string): string {
  const dot = name.lastIndexOf('.');
  const stem = (dot > 0 ? name.slice(0, dot) : name).trim();
  return [...(stem === '' ? name : stem)].slice(0, 200).join('');
}

/** Tags as typed in one field, separated by commas. */
export const parseTags = (text: string): string[] => text.split(',').map((tag) => tag.trim()).filter((tag) => tag !== '');

export interface DocumentForm {
  readonly title: string;
  readonly type: string;
  readonly documentDate: string;
  readonly year: string;
  readonly notes: string;
  readonly tags: string;
}

export const EMPTY_FORM: DocumentForm = { title: '', type: '', documentDate: '', year: '', notes: '', tags: '' };

export function formOf(document: DocumentDetail): DocumentForm {
  return { title: document.title, type: typeValue(document.type), documentDate: document.documentDate ?? '', year: document.year === null ? '' : String(document.year), notes: document.notes, tags: document.tags.join(', ') };
}

export function fieldsOf(form: DocumentForm): DocumentFields {
  return {
    title: form.title,
    type: typeFromValue(form.type),
    documentDate: form.documentDate === '' ? null : form.documentDate,
    year: form.year.trim() === '' ? null : Number(form.year),
    notes: form.notes,
    tags: parseTags(form.tags),
  };
}

/**
 * Setting the document date proposes its year — a convenience only: once the person has typed a year
 * themselves (`yearTouched`), it is theirs (a 2026 tax notice may be dated January 2027).
 */
export function withDocumentDate(form: DocumentForm, documentDate: string, yearTouched: boolean): DocumentForm {
  const year = !yearTouched && /^\d{4}-/.test(documentDate) ? documentDate.slice(0, 4) : form.year;
  return { ...form, documentDate, year };
}

/** A list with the item at `index` moved by `delta` places (unchanged at the ends). */
export function moved<T>(items: readonly T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return [...items];
  const next = [...items];
  const [item] = next.splice(index, 1);
  if (item !== undefined) next.splice(target, 0, item);
  return next;
}

/** What to say where a file's preview would be, or `null` when there is one to show. */
export function previewNote(file: DocumentFile): string | null {
  if (file.preview.unavailable === 'format') return t('documents.preview.format');
  if (file.preview.unavailable === 'password_protected') return t('documents.preview.passwordProtected');
  if (file.preview.pages > 0) return null;
  if (file.preview.state === 'PENDING') return t('documents.preview.pending');
  if (file.preview.state === 'PARTIAL') return t('documents.preview.storageFull');
  return t('documents.preview.failed');
}

/** What a restore did, in words — including where the item went and under which name when its place was gone or taken. */
export function restoreMessage(name: string, outcome: RestoreOutcome): string {
  const parts = [t('documents.trash.restored', { name: outcome.renamedTo ?? name })];
  if (outcome.renamedTo !== null) parts.push(t('documents.trash.renamed', { name }));
  if (outcome.movedTo !== null) {
    parts.push(outcome.movedTo.name === null ? t('documents.trash.movedTop', { because: outcome.movedTo.because }) : t('documents.trash.movedTo', { name: outcome.movedTo.name, because: outcome.movedTo.because }));
  }
  if (outcome.folders + outcome.documents > 1) parts.push(t('documents.trash.restoredContents', { folders: outcome.folders, documents: outcome.documents }));
  return parts.join(' ');
}

// ---- Export and permanent deletion (16.4)

/** What an export covers, as the server's parameters: one Folder (with its sub-folders), chosen Documents, or — neither — everything. */
export function exportQuery(scope: { readonly folderId?: string | null; readonly documentIds?: readonly string[] }): string {
  const params = new URLSearchParams();
  if (scope.documentIds !== undefined) for (const id of scope.documentIds) params.append('document', id);
  else if (scope.folderId != null) params.set('folder', scope.folderId);
  return params.toString();
}

/** What deleting these Trash entries for good removes: the Documents, the Folders and the files in them. */
export function purgeTotals(entries: readonly Pick<TrashEntry, 'kind' | 'folders' | 'documents' | 'files'>[]): { folders: number; documents: number; files: number } {
  return entries.reduce(
    (sum, entry) => ({
      folders: sum.folders + (entry.kind === 'folder' ? 1 + entry.folders : 0),
      documents: sum.documents + (entry.kind === 'document' ? 1 : entry.documents),
      files: sum.files + entry.files,
    }),
    { folders: 0, documents: 0, files: 0 },
  );
}
