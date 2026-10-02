import type { StorageInfo } from './api.ts';
import { formatBytes } from './document-model.ts';
import { t } from './i18n/index.ts';

/** Storage limits are entered in GB (decimal: 1 GB = 1 000 000 000 bytes), in steps of 0.1 GB. */
const GB = 1_000_000_000;
const STEP = 100_000_000;
export const STORAGE_GB_RANGE = { min: 0.1, max: 1000, step: 0.1 } as const;

/** Bytes for what was typed, or `null` when it is not a number in the range (100 MB to 1000 GB). */
export function gigabytesToBytes(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'));
  if (text.trim() === '' || !Number.isFinite(value)) return null;
  const bytes = Math.round((value * GB) / STEP) * STEP;
  return bytes < STORAGE_GB_RANGE.min * GB || bytes > STORAGE_GB_RANGE.max * GB ? null : bytes;
}

/** A limit as it is shown in its field: "5", "0.5", "2.5". */
export const bytesToGigabytes = (bytes: number): string => String(Math.round(bytes / STEP) / 10);

/** What the Workspace stores, by tool — each line names what it counts; only lines with something in them, Trash always. */
export function storageLines(storage: StorageInfo): { key: string; label: string; value: string }[] {
  return [
    { key: 'images', label: t('storage.line.images'), bytes: storage.imageBytes, always: false },
    { key: 'documents', label: t('storage.line.documents'), bytes: storage.documentBytes, always: false },
    { key: 'previews', label: t('storage.line.previews'), bytes: storage.previewBytes, always: false },
    { key: 'retained', label: t('storage.line.retained'), bytes: storage.retainedBytes, always: false },
    { key: 'trash', label: t('storage.line.trash'), bytes: storage.trashBytes, always: true },
  ]
    .filter((line) => line.always || line.bytes > 0)
    .map((line) => ({ key: line.key, label: line.label, value: formatBytes(line.bytes) }));
}

/** "1.2 GB of 5 GB used" — and how full that is, for a meter (0–100, never beyond). */
export function storageSummary(storage: Pick<StorageInfo, 'usedBytes' | 'limitBytes'>): { text: string; percent: number; full: boolean } {
  return {
    text: t('storage.usedOf', { used: formatBytes(storage.usedBytes), limit: formatBytes(storage.limitBytes) }),
    percent: storage.limitBytes <= 0 ? 100 : Math.min(100, Math.round((storage.usedBytes / storage.limitBytes) * 100)),
    full: storage.usedBytes >= storage.limitBytes,
  };
}
