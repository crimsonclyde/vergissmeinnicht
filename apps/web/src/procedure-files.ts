import { t } from './i18n/index.ts';

/** Same bound as the server's body limit for imports. */
export const MAX_IMPORT_BYTES = 1024 * 1024;

/** A safe download file name derived from a Procedure title (letters, digits, dashes only). */
export function exportFileName(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .toLowerCase();
  return `${slug === '' ? 'procedure' : slug}.vmn.json`;
}

/** File name of a Procedure archive (JSON + images, 14.3). */
export const archiveFileName = (title: string) => exportFileName(title).replace(/\.json$/, '.zip');

/** The archive size limit of the server. */
export const MAX_ARCHIVE_BYTES = 125_000_000;

/** A ZIP file (Procedure archive) rather than a JSON export: by its first bytes, not its name. */
export async function isArchive(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}

/** Offers a file download. Nothing is sent anywhere. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** Offers `data` as a JSON file download. Nothing is sent anywhere. */
export function downloadJson(data: unknown, fileName: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export type ReadResult = { readonly ok: true; readonly document: unknown } | { readonly ok: false; readonly message: string };

/** Reads a selected file as JSON. Only a size and syntax pre-check: the server validates everything. */
export async function readImportFile(file: File): Promise<ReadResult> {
  if (file.size > MAX_IMPORT_BYTES) return { ok: false, message: t('import.tooLarge') };
  try {
    return { ok: true, document: JSON.parse(await file.text()) as unknown };
  } catch {
    return { ok: false, message: t('import.notJson') };
  }
}
