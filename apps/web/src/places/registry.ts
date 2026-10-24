import { PLACE_IDS, placeOfTheme, type PlaceId } from '@vergissmeinnicht/domain';
import { germany } from './countries/de.ts';
import { italy } from './countries/it.ts';
import { scotland } from './countries/scotland.ts';
import { unitedKingdom } from './countries/uk.ts';
import type { PlaceConfig } from './types.ts';

/**
 * The Places countries (section 30). The domain's `PLACE_IDS` lists which ids exist (the server checks
 * them); this registry holds everything visual. The `Record` makes TypeScript insist on a configuration
 * for every id. Order follows `PLACE_IDS`.
 */
export const PLACES: Readonly<Record<PlaceId, PlaceConfig>> = {
  de: germany,
  it: italy,
  uk: unitedKingdom,
  scotland,
};

export const PLACE_LIST: readonly PlaceConfig[] = PLACE_IDS.map((id) => PLACES[id]);

/** The country of a theme mode, or null for every other theme. */
export function placeForTheme(mode: string | null | undefined): PlaceConfig | null {
  const id = placeOfTheme(mode);
  return id === null ? null : PLACES[id];
}

/**
 * The country the person sees in a Workspace: that Workspace's own theme, else their default (section
 * 28). Null when it is not a Places theme, or no Workspace is in use; the Places tab is shown only then.
 */
export function placeOfWorkspace(defaultMode: string, workspaceThemes: Readonly<Record<string, string>>, workspaceId: string | null): PlaceConfig | null {
  if (workspaceId === null) return null;
  return placeForTheme(Object.hasOwn(workspaceThemes, workspaceId) ? (workspaceThemes[workspaceId] ?? defaultMode) : defaultMode);
}
