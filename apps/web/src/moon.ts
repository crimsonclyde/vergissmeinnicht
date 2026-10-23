import { getMoonIllumination, getMoonTimes } from 'suncalc';
import type { WeatherLocation } from '@vergissmeinnicht/domain';
import { todayIn } from './schedule-dates.ts';

export const MOON_PHASES = ['new', 'waxingCrescent', 'firstQuarter', 'waxingGibbous', 'full', 'waningGibbous', 'lastQuarter', 'waningCrescent'] as const;
export type MoonPhase = typeof MOON_PHASES[number];
const DAY = 86_400_000;
/** Find the next crossing of phase 0.5, bounded to a lunar cycle; no fixed-period calendar approximation. */
export function nextFullMoon(now: Date): Date {
  let left = now.getTime();
  let phase = getMoonIllumination(now).phase;
  for (let i = 1; i <= 140; i++) {
    const right = now.getTime() + i * DAY / 4;
    const next = getMoonIllumination(new Date(right)).phase;
    if (phase < 0.5 && next >= 0.5 && next - phase < 0.5) {
      let lo = left; let hi = right;
      for (let j = 0; j < 24; j++) { const mid = (lo + hi) / 2; if (getMoonIllumination(new Date(mid)).phase < 0.5) lo = mid; else hi = mid; }
      return new Date(hi);
    }
    left = right; phase = next;
  }
  throw new Error('No full moon in bounded calculation');
}
export function moonAt(now: Date, location: WeatherLocation | null) {
  const illumination = getMoonIllumination(now);
  const phase = MOON_PHASES[Math.round(illumination.phase * 8) % 8] as MoonPhase;
  let rise: Date | null = null; let set: Date | null = null;
  if (location !== null) {
    const day = todayIn(location.timeZone, now);
    const utcMidnight = Math.floor(now.getTime() / DAY) * DAY;
    // SunCalc v2 uses UTC days; select events by the location's civil date, including DST/polar days.
    for (const offset of [-1, 0, 1]) {
      const times = getMoonTimes(new Date(utcMidnight + offset * DAY), location.latitude, location.longitude);
      if (times.rise !== undefined && Number.isFinite(times.rise.getTime()) && todayIn(location.timeZone, times.rise) === day) rise = times.rise;
      if (times.set !== undefined && Number.isFinite(times.set.getTime()) && todayIn(location.timeZone, times.set) === day) set = times.set;
    }
  }
  return { phase, fraction: illumination.fraction, waxing: illumination.waxing, nextFull: nextFullMoon(now), rise, set };
}
