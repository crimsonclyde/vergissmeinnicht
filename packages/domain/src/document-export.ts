import { DOCUMENT_FILE_TYPES, type DocumentFileFormat } from './document-file.ts';

/**
 * Export of Documents (steps.md 16.4, H12): a ZIP with the **original files in their Folder
 * hierarchy**, machine-readable metadata and a readable HTML index. Every path in the archive is
 * **generated here** from normalised names — a title or file name is data and never becomes a path
 * as it is: no traversal, no absolute path, no reserved or control characters, bounded length,
 * collisions numbered. The stored original name is kept in the metadata.
 */
export const MAX_EXPORT_BYTES = 2_000_000_000;
export const MAX_EXPORT_FILES = 5000;
/** Documents chosen one by one for an export. */
export const MAX_EXPORT_SELECTION = 200;
/** Code points of one path segment. */
export const MAX_EXPORT_SEGMENT_LENGTH = 80;

/** At the root of every export; a Folder or Document of the same name is numbered instead. */
export const EXPORT_INDEX_NAME = 'index.html';
export const EXPORT_METADATA_NAME = 'metadata.json';

// Path separators, characters Windows refuses, control and format (invisible, bidi) characters.
const UNSAFE_SEGMENT_CHARS = /[\\/:*?"<>|\p{Cc}\p{Cf}]/gu;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

const shorten = (text: string, length: number) => [...text].slice(0, length).join('');
/** No leading or trailing dots and spaces: `..` cannot survive, and Windows drops them anyway. */
const trimEnds = (text: string) => text.replace(/^[.\s]+|[.\s]+$/g, '');

/**
 * One safe path segment from any text: NFC, unsafe characters replaced by `_`, runs of white space
 * collapsed, at most 80 code points, never empty, never a Windows device name.
 */
export function exportSegment(name: string): string {
  // White space (line breaks and tabs included) becomes one space first; what is unsafe after that becomes `_`.
  const cleaned = trimEnds(name.normalize('NFC').replace(/\s+/g, ' ').replace(UNSAFE_SEGMENT_CHARS, '_'));
  const segment = trimEnds(shorten(cleaned, MAX_EXPORT_SEGMENT_LENGTH));
  if (segment === '') return 'untitled';
  return WINDOWS_RESERVED.test(segment) ? `_${shorten(segment, MAX_EXPORT_SEGMENT_LENGTH - 1)}` : segment;
}

/** The segment for one file of a Document: its page number, then its name, ending in an extension of the **detected** format. */
export function exportFileSegment(page: number, pages: number, originalName: string, format: DocumentFileFormat): string {
  const type = DOCUMENT_FILE_TYPES[format];
  const dot = originalName.lastIndexOf('.');
  const hasExtension = dot > 0 && type.extensions.includes(originalName.slice(dot + 1).toLowerCase());
  const extension = hasExtension ? originalName.slice(dot + 1) : type.extension;
  const number = String(page).padStart(String(pages).length < 2 ? 2 : String(pages).length, '0');
  const prefix = `${number} - `;
  const stem = exportSegment(shorten(exportSegment(hasExtension ? originalName.slice(0, dot) : originalName), MAX_EXPORT_SEGMENT_LENGTH - prefix.length - extension.length - 1));
  return `${prefix}${stem}.${extension}`;
}

/** A name not yet taken in its directory (compared without case, as Windows and macOS do); otherwise "name (2)", "name (3)", … */
export function uniqueSegment(taken: Set<string>, segment: string): string {
  const key = (value: string) => value.normalize('NFKC').toLowerCase();
  let candidate = segment;
  for (let attempt = 2; taken.has(key(candidate)); attempt++) {
    const suffix = ` (${attempt})`;
    candidate = `${trimEnds(shorten(segment, MAX_EXPORT_SEGMENT_LENGTH - suffix.length))}${suffix}`;
  }
  taken.add(key(candidate));
  return candidate;
}

export interface ExportFolderInput {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
}

export interface ExportDocumentInput<File extends { readonly originalName: string; readonly format: DocumentFileFormat }> {
  readonly id: string;
  readonly folderId: string | null;
  readonly title: string;
  readonly files: readonly File[];
}

export interface ExportPaths {
  /** Folder id → its directory in the archive, as segments (root-relative). */
  readonly folders: ReadonlyMap<string, readonly string[]>;
  /** Document id → its directory and the segment of each file, in page order. */
  readonly documents: ReadonlyMap<string, { readonly directory: readonly string[]; readonly files: readonly string[] }>;
}

/**
 * Where everything goes in the archive. `folders` is the tree to show: for the export of one Folder,
 * that Folder (with `parentId` null — it becomes the top directory) and what is below it. Each
 * Document gets a directory named after its title,
 * holding its files in page order — so several Documents with the same title, or files with the same
 * name, never overwrite each other. Folders that are not on the way to an exported Document's
 * Folder are left out.
 */
export function planExportPaths<File extends { readonly originalName: string; readonly format: DocumentFileFormat }>(
  folders: readonly ExportFolderInput[],
  documents: readonly ExportDocumentInput<File>[],
): ExportPaths {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const taken = new Map<string, Set<string>>();
  const namesIn = (directory: string) => {
    let names = taken.get(directory);
    if (names === undefined) {
      // Nothing may be called like the two files every export has at its root.
      names = new Set(directory === '' ? [EXPORT_INDEX_NAME, EXPORT_METADATA_NAME] : []);
      taken.set(directory, names);
    }
    return names;
  };
  const folderPaths = new Map<string, readonly string[]>();
  const pathOf = (folderId: string | null, guard = 0): readonly string[] => {
    if (folderId === null) return [];
    const known = folderPaths.get(folderId);
    if (known !== undefined) return known;
    const folder = byId.get(folderId);
    // A Folder that is not in the list (or a broken chain) contributes nothing: its Documents sit one level up.
    if (folder === undefined || guard > folders.length) return [];
    const parent = pathOf(folder.parentId, guard + 1);
    const path = [...parent, uniqueSegment(namesIn(parent.join('/')), exportSegment(folder.name))];
    folderPaths.set(folderId, path);
    return path;
  };
  // Folders first, by name, so that their names are stable whatever Documents are added later.
  const needed = new Set(documents.map((document) => document.folderId).filter((id): id is string => id !== null));
  for (const folder of [...folders].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1))) if (needed.has(folder.id)) pathOf(folder.id);
  const documentPaths = new Map<string, { directory: readonly string[]; files: readonly string[] }>();
  for (const document of documents) {
    const parent = pathOf(document.folderId);
    const directory = [...parent, uniqueSegment(namesIn(parent.join('/')), exportSegment(document.title))];
    const names = namesIn(directory.join('/'));
    documentPaths.set(document.id, {
      directory,
      files: document.files.map((file, index) => uniqueSegment(names, exportFileSegment(index + 1, document.files.length, file.originalName, file.format))),
    });
  }
  return { folders: folderPaths, documents: documentPaths };
}
