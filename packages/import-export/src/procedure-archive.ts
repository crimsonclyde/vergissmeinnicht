// Procedure archive (14.3, T4): the JSON v1 document plus the Procedure's processed instruction images,
// as a ZIP file. Imports are hostile input: entries are read into bounded memory only (never written to
// a path from the archive), every name must be listed in the manifest, and sizes, counts, compression
// ratios and hashes are checked while reading. The images are then processed again like any upload.
import { createHash } from 'node:crypto';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import yazl from 'yazl';
import { z } from 'zod';
import { ProcedureImportError, parseProcedureDocument, type ImportedProcedure, type ProcedureDocumentV1 } from './procedure-document.ts';

export const PROCEDURE_ARCHIVE_FORMAT = 'vergissmeinnicht.procedure-archive';
export const PROCEDURE_ARCHIVE_VERSION = 1;
const MANIFEST = 'procedure.json';

/** Limits of an archive import (T4). */
export const ARCHIVE_LIMITS = {
  /** The archive file itself (the HTTP body limit). */
  maxArchiveBytes: 125_000_000,
  /** procedure.json plus at most one image per Step, and never more than 200 images. */
  maxEntries: 201,
  maxImageBytes: 10_000_000,
  maxManifestBytes: 2_000_000,
  maxTotalBytes: 120_000_000,
  /** Uncompressed : compressed, for entries larger than 1 MB (JPEGs barely compress). */
  maxCompressionRatio: 100,
} as const;

export interface ArchiveImage {
  readonly section: number;
  readonly step: number;
  readonly caption: string;
  readonly bytes: Uint8Array;
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const imageEntry = (n: number) => `images/${n}.jpg`;

/** Writes an archive: `procedure.json` (manifest + JSON v1 document) and `images/<n>.jpg`. */
export async function writeProcedureArchive(document: ProcedureDocumentV1, images: readonly ArchiveImage[]): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  const manifest = {
    format: PROCEDURE_ARCHIVE_FORMAT,
    archiveVersion: PROCEDURE_ARCHIVE_VERSION,
    document,
    images: images.map((image, index) => ({
      section: image.section,
      step: image.step,
      caption: image.caption,
      entry: imageEntry(index + 1),
      bytes: image.bytes.byteLength,
      sha256: sha256(image.bytes),
    })),
  };
  // Fixed times: the same Procedure gives the same archive (no creation time or user leaks).
  const mtime = new Date('2000-01-01T00:00:00Z');
  zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2)), MANIFEST, { mtime, mode: 0o100644 });
  images.forEach((image, index) => zip.addBuffer(Buffer.from(image.bytes), imageEntry(index + 1), { mtime, mode: 0o100644, compress: false }));
  zip.end();
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

const manifestSchema = z.strictObject({
  format: z.literal(PROCEDURE_ARCHIVE_FORMAT),
  archiveVersion: z.literal(PROCEDURE_ARCHIVE_VERSION),
  document: z.unknown(),
  images: z
    .array(
      z.strictObject({
        section: z.number().int().min(0).max(59),
        step: z.number().int().min(0).max(249),
        caption: z.string().max(1024),
        entry: z.string().regex(/^images\/[1-9][0-9]{0,2}\.jpg$/),
        bytes: z.number().int().min(1).max(ARCHIVE_LIMITS.maxImageBytes),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
      }),
    )
    .max(ARCHIVE_LIMITS.maxEntries - 1),
});

const invalid = () => new ProcedureImportError('invalid_archive');
const S_IFMT = 0o170000;
const S_IFREG = 0o100000;

function open(buffer: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    // Names are decoded and validated by yauzl (no absolute paths, no `..`, no backslashes); entry
    // sizes are checked against the actual data while reading.
    yauzl.fromBuffer(buffer, { lazyEntries: true, decodeStrings: true, strictFileNames: true, validateEntrySizes: true, autoClose: true }, (error, zip) =>
      error === null && zip !== undefined ? resolve(zip) : reject(invalid()),
    );
  });
}

/** One entry into memory, at most `limit` bytes — counted while reading, whatever the header claims. */
function readEntry(zip: ZipFile, entry: Entry, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error !== null || stream === undefined) return reject(invalid());
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > limit) {
          stream.destroy();
          reject(invalid());
          return;
        }
        chunks.push(chunk);
      });
      stream.on('error', () => reject(invalid()));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  });
}

/** Every entry of the archive, validated, in memory. */
async function readEntries(buffer: Buffer): Promise<Map<string, Buffer>> {
  if (buffer.byteLength > ARCHIVE_LIMITS.maxArchiveBytes) throw invalid();
  const zip = await open(buffer);
  if (zip.entryCount > ARCHIVE_LIMITS.maxEntries) {
    zip.close();
    throw invalid();
  }
  const entries = new Map<string, Buffer>();
  let total = 0;
  return new Promise((resolve, reject) => {
    const fail = () => {
      zip.close();
      reject(invalid());
    };
    zip.on('error', fail);
    zip.on('end', () => resolve(entries));
    zip.on('entry', (entry: Entry) => {
      const name = entry.fileName;
      const mode = (entry.externalFileAttributes >>> 16) & S_IFMT;
      const isManifest = name === MANIFEST;
      const limit = isManifest ? ARCHIVE_LIMITS.maxManifestBytes : ARCHIVE_LIMITS.maxImageBytes;
      if (
        name.endsWith('/') || // directories
        (mode !== 0 && mode !== S_IFREG) || // symlinks and other special files
        entry.isEncrypted() ||
        entries.has(name) || // duplicates
        (!isManifest && !/^images\/[1-9][0-9]{0,2}\.jpg$/.test(name)) ||
        entry.uncompressedSize > limit ||
        (entry.uncompressedSize > 1_000_000 && entry.uncompressedSize > entry.compressedSize * ARCHIVE_LIMITS.maxCompressionRatio)
      ) {
        return fail();
      }
      total += entry.uncompressedSize;
      if (total > ARCHIVE_LIMITS.maxTotalBytes) return fail();
      readEntry(zip, entry, limit).then(
        (bytes) => {
          entries.set(name, bytes);
          zip.readEntry();
        },
        fail,
      );
    });
    zip.readEntry();
  });
}

/**
 * Reads an archive into Procedure content and its images. All-or-nothing: any problem refuses the
 * whole archive before anything is written. The images still go through server-side processing and
 * the quota when imported; captions go through the domain rules with the rest of the content.
 */
export async function readProcedureArchive(buffer: Buffer): Promise<{ readonly content: ImportedProcedure; readonly images: readonly ArchiveImage[] }> {
  const entries = await readEntries(buffer);
  const manifestBytes = entries.get(MANIFEST);
  if (manifestBytes === undefined) throw invalid();
  let json: unknown;
  try {
    json = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    throw invalid();
  }
  const manifest = manifestSchema.safeParse(json);
  if (!manifest.success) throw invalid();
  const content = parseProcedureDocument(manifest.data.document);

  // Exactly the listed entries, each used once, each for one existing Step, each Step at most once.
  const listed = new Set(manifest.data.images.map((image) => image.entry));
  const steps = new Set(manifest.data.images.map((image) => `${image.section}:${image.step}`));
  if (listed.size !== manifest.data.images.length || steps.size !== manifest.data.images.length || entries.size !== listed.size + 1) throw invalid();
  const images = manifest.data.images.map((image) => {
    const bytes = entries.get(image.entry);
    if (bytes === undefined || bytes.byteLength !== image.bytes || sha256(bytes) !== image.sha256) throw invalid();
    if (content.sections[image.section]?.steps[image.step] === undefined) throw invalid();
    return { section: image.section, step: image.step, caption: image.caption, bytes: new Uint8Array(bytes) };
  });
  return { content, images };
}
