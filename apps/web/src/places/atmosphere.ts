import { getPosition } from 'suncalc';

/**
 * Time of day for the Places background (section 30): decorative light only. The Workspace's shared
 * location (section 26) gives the sun's real height there; without it, the Workspace's time zone gives
 * the local hour; without that, the device's clock. The country never decides the time zone — an
 * Italian-themed Workspace may describe a flat in Glasgow.
 */
export type DayPhase = 'night' | 'morning' | 'day' | 'dusk' | 'evening';

export interface PlaceClock {
  readonly location: { readonly latitude: number; readonly longitude: number } | null;
  readonly timeZone: string | null;
}

/**
 * Weather the background could show one day. Integration point only: the scene never asks a weather
 * provider for decoration (no extra API calls); a later step may pass what Today already loaded.
 */
export type PlaceWeather = 'clear' | 'cloudy' | 'fog' | 'rain' | 'snow';

export interface PlaceLight {
  readonly phase: DayPhase;
  /** Warm (golden) tint over the picture, 0–1. */
  readonly warmth: number;
  /** Darkening toward evening and night, 0–1. */
  readonly darkness: number;
  /** How much the lit windows show, 0–1. */
  readonly windows: number;
  /** Extra mist, 0–1 (from weather; 0 for now). */
  readonly mist: number;
}

const LIGHT: Record<DayPhase, Omit<PlaceLight, 'phase' | 'mist'>> = {
  night: { warmth: 0.05, darkness: 0.62, windows: 1 },
  morning: { warmth: 0.35, darkness: 0.08, windows: 0.15 },
  day: { warmth: 0, darkness: 0, windows: 0 },
  dusk: { warmth: 0.6, darkness: 0.18, windows: 0.5 },
  evening: { warmth: 0.3, darkness: 0.42, windows: 0.85 },
};

function validLocation(location: PlaceClock['location']): location is { latitude: number; longitude: number } {
  return location !== null && Number.isFinite(location.latitude) && Number.isFinite(location.longitude) && Math.abs(location.latitude) <= 90 && Math.abs(location.longitude) <= 180;
}

/** The hour (0–23.99) at `now` in an IANA time zone, or on the device when the zone is unknown. */
export function localHour(now: Date, timeZone: string | null): number {
  if (timeZone !== null) {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
      const hour = Number(parts.find((part) => part.type === 'hour')?.value);
      const minute = Number(parts.find((part) => part.type === 'minute')?.value);
      if (Number.isFinite(hour) && Number.isFinite(minute)) return hour + minute / 60;
    } catch {
      /* unknown zone: the device's clock */
    }
  }
  return now.getHours() + now.getMinutes() / 60;
}

/** The phase from the sun's height (degrees) and whether it is rising. */
export function phaseFromSun(altitude: number, rising: boolean): DayPhase {
  if (altitude < -6) return 'night';
  if (altitude < 0) return rising ? 'morning' : 'evening';
  if (altitude < 12) return rising ? 'morning' : 'dusk';
  return 'day';
}

/** The phase from a local hour, where no location is known. */
export function phaseFromHour(hour: number): DayPhase {
  if (hour >= 5 && hour < 8) return 'morning';
  if (hour >= 8 && hour < 17) return 'day';
  if (hour >= 17 && hour < 20) return 'dusk';
  if (hour >= 20 && hour < 22.5) return 'evening';
  return 'night';
}

export function placeLight(now: Date, clock: PlaceClock, weather: PlaceWeather | null = null): PlaceLight {
  let phase: DayPhase;
  if (!Number.isFinite(now.getTime())) phase = 'day';
  else if (validLocation(clock.location)) {
    const { latitude, longitude } = clock.location;
    const altitude = (getPosition(now, latitude, longitude).altitude * 180) / Math.PI;
    const later = (getPosition(new Date(now.getTime() + 10 * 60_000), latitude, longitude).altitude * 180) / Math.PI;
    phase = phaseFromSun(altitude, later > altitude);
  } else phase = phaseFromHour(localHour(now, clock.timeZone));
  const mist = weather === 'fog' ? 0.6 : weather === 'rain' || weather === 'snow' ? 0.3 : 0;
  return { phase, ...LIGHT[phase], mist };
}
