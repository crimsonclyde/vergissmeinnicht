import { getMoonIllumination, getMoonPosition } from 'suncalc';

export interface ForestLocation {
  readonly latitude: number;
  readonly longitude: number;
}

/** Decorative light only. Dates are absolute instants: no local-calendar or DST conversion. */
export function forestLight(date: Date, location: ForestLocation | null = null): { moonlight: number; starlight: number } {
  if (!Number.isFinite(date.getTime())) return { moonlight: 0.4, starlight: 0.5 };
  const fraction = getMoonIllumination(date).fraction;
  const validLocation = location !== null && Number.isFinite(location.latitude) && Number.isFinite(location.longitude)
    && Math.abs(location.latitude) <= 90 && Math.abs(location.longitude) <= 180;
  // With no coordinates we know the phase, but make no claim about the local horizon.
  const altitude = validLocation ? getMoonPosition(date, location.latitude, location.longitude).altitude : null;
  // Ease through the horizon over 8 degrees; no sudden sunrise/set scene change.
  const horizon = altitude === null ? 1 : Math.max(0, Math.min(1, altitude / 8));
  return { moonlight: fraction * horizon, starlight: 1 - fraction * horizon };
}
