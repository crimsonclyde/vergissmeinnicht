import { MAX_CONTACT_IMPORT_BYTES, type ContactInput } from '@vergissmeinnicht/domain';

/**
 * Contact import and export files (steps.md 16.6): CSV and vCard. The readers here turn bytes into
 * *drafts* — plain strings, nothing trusted — and refuse a file that is not usable at all. Every draft
 * is then checked by the same domain rules as a Contact typed by hand. Nothing here touches the
 * database, the network or the file system.
 */

/** One entry of an import file as read. `line`: where it starts in the file (1-based). */
export interface ContactDraft {
  readonly line: number;
  readonly input: ContactInput;
}

export interface ParsedContacts {
  readonly drafts: ContactDraft[];
  /** Columns or properties that hold data and were not used, by name — said to the person, not hidden. */
  readonly ignored: string[];
}

export type ContactFileProblem =
  | 'contact_import_too_large'
  | 'contact_import_not_text'
  | 'contact_import_malformed'
  | 'contact_import_field_too_long'
  | 'contact_import_too_many'
  | 'contact_import_no_name_column';

/** The file as a whole cannot be used. Carries a stable code and, where it helps, the line. */
export class ContactFileError extends Error {
  readonly code: ContactFileProblem;
  readonly line: number | null;

  constructor(code: ContactFileProblem, line: number | null = null) {
    super(`Contact file refused: ${code}`);
    this.name = 'ContactFileError';
    this.code = code;
    this.line = line;
  }
}

/** The longest single value a reader accepts (a note is at most 4000 characters; this leaves room for escaping). */
export const MAX_CONTACT_FIELD_LENGTH = 10_000;
/** Entries a reader collects before it gives up — above what one import may hold, so the refusal can say "too many". */
export const MAX_CONTACT_FILE_ENTRIES = 5000;

function decode(bytes: Uint8Array, encoding: string, fatal: boolean): string | undefined {
  try {
    return new TextDecoder(encoding, { fatal, ignoreBOM: false }).decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * The text of an import file: UTF-8 (with or without a byte-order mark), UTF-16 with a byte-order
 * mark (what spreadsheets call "Unicode text"), and otherwise — when the bytes are not valid UTF-8 —
 * Windows-1252, the encoding of older address books. A file with NUL characters is not text.
 */
export function decodeContactFile(bytes: Uint8Array): string {
  if (bytes.length > MAX_CONTACT_IMPORT_BYTES) throw new ContactFileError('contact_import_too_large');
  const [a, b] = [bytes[0], bytes[1]];
  const text =
    a === 0xff && b === 0xfe
      ? decode(bytes, 'utf-16le', true)
      : a === 0xfe && b === 0xff
        ? decode(bytes, 'utf-16be', true)
        : (decode(bytes, 'utf-8', true) ?? decode(bytes, 'windows-1252', false));
  if (text === undefined || text.includes('\u0000')) throw new ContactFileError('contact_import_not_text');
  return text.startsWith('\uFEFF') ? text.slice(1) : text;
}
