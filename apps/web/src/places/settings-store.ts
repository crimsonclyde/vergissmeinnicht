import { DEFAULT_PLACE_PREFERENCES, normalizePlacePreferences, type PlacePreferences, type PlaceSettings } from '@vergissmeinnicht/domain';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { api } from '../api.ts';

/**
 * A person's own Places settings per Workspace (section 30), shared by the background and the Places
 * tab. The account is the source; this browser keeps a copy only so the first paint after a reload shows
 * the right kind of background (no flash of the illustration before a personal photo). The copy is
 * parsed defensively and never trusted for anything else; it holds no image, only its version.
 */
const STORAGE_KEY = 'vmn.places';
const KEY = /^[0-9a-f-]{36}:[0-9a-f-]{36}$/;
export const EMPTY_PLACE_SETTINGS: PlaceSettings = Object.freeze({ preferences: DEFAULT_PLACE_PREFERENCES, photo: null });

interface Entry {
  settings: PlaceSettings;
  /** True once the account answered (or could not: offline keeps the copy). */
  loaded: boolean;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const loading = new Set<string>();

const keyOf = (userId: string, workspaceId: string) => `${userId}:${workspaceId}`;

/** Only plausible keys and well-formed values survive; anything else is ignored. */
export function parseStoredPlaces(value: unknown): Record<string, PlaceSettings> {
  const result: Record<string, PlaceSettings> = {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return result;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!KEY.test(key) || typeof raw !== 'object' || raw === null) continue;
    const entry = raw as { preferences?: unknown; photo?: unknown };
    const photo = entry.photo as { version?: unknown; width?: unknown; height?: unknown } | null | undefined;
    const validPhoto =
      photo !== null && photo !== undefined && typeof photo.version === 'string' && /^\d{1,15}$/.test(photo.version) && Number.isInteger(photo.width) && Number.isInteger(photo.height)
        ? { version: photo.version, width: photo.width as number, height: photo.height as number }
        : null;
    result[key] = { preferences: normalizePlacePreferences(entry.preferences), photo: validPhoto };
  }
  return result;
}

function readCopy(): Record<string, PlaceSettings> {
  try {
    return parseStoredPlaces(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}'));
  } catch {
    return {};
  }
}

function writeCopy(key: string, settings: PlaceSettings | null): void {
  try {
    const others = Object.entries(readCopy()).filter(([other]) => other !== key);
    const all: Record<string, PlaceSettings> = Object.fromEntries(settings === null ? others : [...others, [key, settings]]);
    if (Object.keys(all).length === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable: the account still has everything */
  }
}

function notify(): void {
  for (const listener of listeners) listener();
}

function entryFor(key: string): Entry {
  let entry = entries.get(key);
  if (entry === undefined) {
    entry = { settings: readCopy()[key] ?? EMPTY_PLACE_SETTINGS, loaded: false };
    entries.set(key, entry);
  }
  return entry;
}

function store(key: string, settings: PlaceSettings): void {
  entries.set(key, { settings, loaded: true });
  const empty = settings.photo === null && JSON.stringify(settings.preferences) === JSON.stringify(DEFAULT_PLACE_PREFERENCES);
  writeCopy(key, empty ? null : settings);
  notify();
}

function load(userId: string, workspaceId: string): void {
  const key = keyOf(userId, workspaceId);
  if (loading.has(key) || entryFor(key).loaded) return;
  loading.add(key);
  api.placeSettings(workspaceId).then(
    (settings) => store(key, settings),
    () => {
      // Offline or not allowed: keep what this browser had (or the defaults) and stop asking.
      entries.set(key, { ...entryFor(key), loaded: true });
      notify();
    },
  ).finally(() => loading.delete(key));
}

/** Forgets everything of this browser (sign-out). */
export function clearPlaceCopies(): void {
  entries.clear();
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  notify();
}

export interface PlaceSettingsHandle {
  readonly settings: PlaceSettings;
  readonly loaded: boolean;
  readonly save: (preferences: PlacePreferences) => Promise<PlaceSettings>;
  readonly reset: () => Promise<PlaceSettings>;
  readonly upload: (image: Blob) => Promise<PlaceSettings>;
  readonly removePhoto: () => Promise<PlaceSettings>;
}

/**
 * The settings of `userId` in `workspaceId` (or the defaults when either is unknown). Writes go to the
 * account first; the shown value changes only when the account accepted it, so a failed save or upload
 * never loses the previous configuration.
 */
export function usePlaceSettings(userId: string | undefined, workspaceId: string | null | undefined): PlaceSettingsHandle {
  const key = userId === undefined || workspaceId === null || workspaceId === undefined ? null : keyOf(userId, workspaceId);
  useEffect(() => {
    if (key !== null && userId !== undefined && workspaceId) load(userId, workspaceId);
  }, [key, userId, workspaceId]);
  const entry = useSyncExternalStore(
    useCallback((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }, []),
    () => (key === null ? null : entryFor(key)),
  );
  const run = useCallback(
    async (action: (id: string) => Promise<PlaceSettings>) => {
      if (key === null || !workspaceId) throw new Error('no workspace');
      const settings = await action(workspaceId);
      store(key, settings);
      return settings;
    },
    [key, workspaceId],
  );
  return {
    settings: entry?.settings ?? EMPTY_PLACE_SETTINGS,
    loaded: entry?.loaded ?? true,
    save: useCallback((preferences: PlacePreferences) => run((id) => api.savePlaceSettings(id, preferences)), [run]),
    reset: useCallback(() => run((id) => api.resetPlaceSettings(id)), [run]),
    upload: useCallback((image: Blob) => run((id) => api.uploadPlaceBackground(id, image)), [run]),
    removePhoto: useCallback(() => run((id) => api.removePlaceBackground(id)), [run]),
  };
}
