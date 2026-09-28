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
