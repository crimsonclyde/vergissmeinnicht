import { PLACE_OVERLAY_MAX, PLACE_OVERLAY_MIN, type PlaceFocus, type PlaceSettings } from '@vergissmeinnicht/domain';
import { placeBackgroundUrl } from '../api.ts';
import type { PlaceConfig } from './types.ts';

/** Where the background is shown: strongest on Today, quiet on working pages, framed in the preview. */
export type PlaceProminence = 'today' | 'page';

/** Everything the backdrop draws, resolved from the country and the person's settings. */
export interface PlaceLook {
  readonly config: PlaceConfig;
  readonly background: 'illustration' | 'photo' | 'none';
  readonly photoUrl: string | null;
  readonly focusDesktop: PlaceFocus;
  readonly focusMobile: PlaceFocus;
  readonly overlay: number;
  readonly blur: number;
  readonly vignette: number;
  readonly atmosphere: boolean;
}

const CENTRE: PlaceFocus = { x: 50, y: 50 };

/**
 * Resolves defaults and fallbacks: `null` values take the country's own; "Personal photograph" without
 * a stored photo (removed, or never uploaded) shows the country illustration instead.
 */
export function placeLook(config: PlaceConfig, settings: PlaceSettings, workspaceId: string | null): PlaceLook {
  const { preferences, photo } = settings;
  const usePhoto = preferences.background === 'photo' && photo !== null && workspaceId !== null;
  const background = preferences.background === 'none' ? 'none' : usePhoto ? 'photo' : 'illustration';
  const ownFraming = background === 'photo';
  return {
    config,
    background,
    photoUrl: usePhoto ? placeBackgroundUrl(workspaceId, photo.version) : null,
    // A photograph has no designed framing: the centre until the person moves it.
    focusDesktop: preferences.focusDesktop ?? (ownFraming ? CENTRE : config.artwork.focusDesktop),
    focusMobile: preferences.focusMobile ?? (ownFraming ? CENTRE : config.artwork.focusMobile),
    overlay: clamp(preferences.overlay ?? config.defaults.overlay, PLACE_OVERLAY_MIN, PLACE_OVERLAY_MAX),
    blur: preferences.blur,
    vignette: preferences.vignette ?? config.defaults.vignette,
    atmosphere: preferences.atmosphere,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The overlay actually used: as chosen on Today; on working pages (lists, forms, tables) never below
 * 72 %, so a detailed picture never sits under dense content at full strength.
 */
export function effectiveOverlay(look: Pick<PlaceLook, 'overlay'>, prominence: PlaceProminence): number {
  return prominence === 'today' ? look.overlay : Math.min(92, Math.max(72, look.overlay + 30));
}
