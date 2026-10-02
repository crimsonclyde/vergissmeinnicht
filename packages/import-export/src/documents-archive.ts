// Export of Documents (16.4, H12): a ZIP holding the original files in their Folder hierarchy,
// `metadata.json` (machine-readable) and `index.html` (readable without VMN). The archive is written
// as a stream — files are opened one at a time and never held in memory. Every path is given by the
// caller as already-safe segments (`planExportPaths`); nothing here turns a title or a file name into
// a path. The HTML is static: every value is escaped, there is no script and no remote resource, and
// links only point into the archive.
import { Readable } from 'node:stream';
import { EXPORT_INDEX_NAME, EXPORT_METADATA_NAME } from '@vergissmeinnicht/domain';
import yazl from 'yazl';

export const DOCUMENTS_EXPORT_FORMAT = 'vergissmeinnicht.documents-export';
export const DOCUMENTS_EXPORT_VERSION = 1;

type TypeView = { readonly kind: 'builtin'; readonly key: string } | { readonly kind: 'custom'; readonly name: string } | null;

export interface ArchiveFile {
  readonly page: number;
  /** Path in the archive, as safe segments. */
  readonly path: readonly string[];
  readonly originalName: string;
  readonly format: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly pageCount: number | null;
  /** Opens the original for reading; called when the file's turn comes. */
  readonly open: () => Promise<AsyncIterable<Uint8Array>>;
}

export interface ArchiveDocument {
  readonly id: string;
  readonly title: string;
  readonly folderNames: readonly string[];
  readonly directory: readonly string[];
  readonly type: TypeView;
  readonly documentDate: string | null;
  readonly year: number | null;
  readonly notes: string;
  readonly tags: readonly string[];
  readonly uploadedAt: Date;
  readonly uploadedByName: string;
  readonly modifiedAt: Date;
  readonly modifiedByName: string;
  readonly files: readonly ArchiveFile[];
}

export interface DocumentsArchiveInput {
  readonly workspaceName: string;
  readonly folderName: string | null;
  readonly scope: 'all' | 'folder' | 'selection';
  readonly exportedAt: Date;
  readonly exportedByName: string;
  readonly documents: readonly ArchiveDocument[];
}

/** Built-in type keys in words, for the index (English, like the app). */
const TYPE_NAMES: Readonly<Record<string, string>> = {
  bill: 'Bill',
  receipt: 'Receipt',
  contract: 'Contract',
  tax_notice: 'Tax notice',
  manual: 'Manual',
  warranty: 'Warranty',
  inspection_report: 'Inspection report',
  correspondence: 'Correspondence',
};

const typeName = (type: TypeView): string | null => (type === null ? null : type.kind === 'custom' ? type.name : Object.hasOwn(TYPE_NAMES, type.key) ? (TYPE_NAMES[type.key] ?? type.key) : type.key);

/** The machine-readable description of the export. Relationships (`links`) are listed per Document; none exist before Links do (16.5). */
export function documentsMetadata(input: DocumentsArchiveInput): string {
  return JSON.stringify(
    {
      format: DOCUMENTS_EXPORT_FORMAT,
      version: DOCUMENTS_EXPORT_VERSION,
      exportedAt: input.exportedAt.toISOString(),
      exportedBy: input.exportedByName,
      workspace: input.workspaceName,
      scope: input.scope,
      folder: input.folderName,
      documents: input.documents.map((document) => ({
        id: document.id,
        title: document.title,
        folder: document.folderNames,
        path: document.directory.join('/'),
        type: document.type === null ? null : document.type.kind === 'custom' ? { custom: document.type.name } : { builtIn: document.type.key },
        documentDate: document.documentDate,
        year: document.year,
        notes: document.notes,
        tags: document.tags,
        uploadedAt: document.uploadedAt.toISOString(),
        uploadedBy: document.uploadedByName,
        lastModifiedAt: document.modifiedAt.toISOString(),
        lastModifiedBy: document.modifiedByName,
        files: document.files.map((file) => ({
          page: file.page,
          path: file.path.join('/'),
          originalName: file.originalName,
          format: file.format,
          bytes: file.bytes,
          sha256: file.sha256,
          pdfPages: file.pageCount !== null && file.format === 'PDF' ? file.pageCount : null,
        })),
        links: [],
      })),
    },
    null,
    2,
  );
}

const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Every value that reaches the HTML goes through this — as text or inside a quoted attribute. */
export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
/** A relative link into the archive: each segment percent-encoded, so nothing in a name can form a scheme, a query or a parent path. */
const href = (path: readonly string[]): string => `./${path.map(encodeURIComponent).join('/')}`;

const INDEX_STYLE =
  'body{font:16px/1.5 system-ui,sans-serif;max-width:52rem;margin:2rem auto;padding:0 1rem;color:#1a1a1a;background:#fff}h1{font-size:1.5rem}h2{font-size:1.15rem;margin-top:2rem;border-bottom:1px solid #999}article{margin:1rem 0;padding:.75rem 1rem;border:1px solid #999;border-radius:.4rem}h3{margin:0 0 .25rem;font-size:1.05rem}dl{margin:.25rem 0;display:grid;grid-template-columns:max-content 1fr;gap:.1rem .75rem}dt{color:#555}dd{margin:0;overflow-wrap:anywhere}.notes{white-space:pre-wrap}ul{margin:.5rem 0 0;padding-left:1.25rem}small{color:#555}@media (prefers-color-scheme:dark){body{color:#eee;background:#111}dt,small{color:#aaa}a{color:#9cf}}';

/** The readable index: every exported Document with its details and links to its files, grouped by Folder. Static and inert. */
export function documentsIndexHtml(input: DocumentsArchiveInput): string {
  const title = input.folderName === null ? `Documents of ${input.workspaceName}` : `${input.folderName} — documents of ${input.workspaceName}`;
  const groups = new Map<string, ArchiveDocument[]>();
  for (const document of input.documents) {
    const key = document.folderNames.join(' / ');
    groups.set(key, [...(groups.get(key) ?? []), document]);
  }
  const fact = (label: string, value: string | null, className = '') => (value === null || value === '' ? '' : `<dt>${escapeHtml(label)}</dt><dd${className === '' ? '' : ` class="${className}"`}>${escapeHtml(value)}</dd>`);
  const article = (document: ArchiveDocument) =>
    `<article><h3>${escapeHtml(document.title)}</h3><dl>${[
      fact('Type', typeName(document.type)),
      fact('Document date', document.documentDate),
      fact('Year', document.year === null ? null : String(document.year)),
      fact('Tags', document.tags.join(', ')),
      fact('Notes', document.notes, 'notes'),
      fact('Uploaded', `${document.uploadedAt.toISOString().slice(0, 10)} by ${document.uploadedByName}`),
      fact('Last modified', `${document.modifiedAt.toISOString().slice(0, 10)} by ${document.modifiedByName}`),
    ].join('')}</dl><ul>${document.files
      .map((file) => `<li><a href="${escapeHtml(href(file.path))}">${escapeHtml(`Page ${file.page}: ${file.originalName}`)}</a> <small>${escapeHtml(`${file.format}, ${file.bytes} bytes`)}</small></li>`)
      .join('')}</ul></article>`;
  const sections = [...groups]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([folder, documents]) => `<section><h2>${escapeHtml(folder === '' ? 'Not in a folder' : folder)}</h2>${documents.map(article).join('')}</section>`)
    .join('');
  const files = input.documents.reduce((sum, document) => sum + document.files.length, 0);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style>${INDEX_STYLE}</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(`Exported from VergissMeinNicht on ${input.exportedAt.toISOString().slice(0, 10)} by ${input.exportedByName}: ${input.documents.length} documents, ${files} files.`)} The files are the originals, exactly as they were uploaded. <a href="./${EXPORT_METADATA_NAME}">${EXPORT_METADATA_NAME}</a> holds the same details in machine-readable form.</p>
${sections === '' ? '<p>No documents.</p>' : sections}
</body>
</html>
`;
}

/**
 * The archive as a stream: `index.html`, `metadata.json`, then every original under its path, stored
 * without compression (PDFs and photos do not shrink) and with one time for all entries. A file that
 * cannot be opened ends the stream with an error — a truncated archive is never passed off as complete.
 */
export function writeDocumentsArchive(input: DocumentsArchiveInput): Readable {
  const zip = new yazl.ZipFile();
  const options = { mtime: input.exportedAt, mode: 0o100644 };
  zip.addBuffer(Buffer.from(documentsIndexHtml(input), 'utf8'), EXPORT_INDEX_NAME, options);
  zip.addBuffer(Buffer.from(documentsMetadata(input), 'utf8'), EXPORT_METADATA_NAME, options);
  for (const document of input.documents) {
    for (const file of document.files) {
      zip.addReadStreamLazy(file.path.join('/'), { ...options, compress: false, size: file.bytes }, (ready) => {
        file.open().then(
          (source) => ready(null, Readable.from(source)),
          (error: unknown) => ready(error, Readable.from([])),
        );
      });
    }
  }
  zip.end();
  const output = zip.outputStream as Readable;
  zip.on('error', (error: Error) => output.destroy(error));
  return output;
}
