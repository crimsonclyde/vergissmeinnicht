/** Local, ephemeral timing. Absolute elapsed timestamps recover after a suspended browser tab. */
export interface Timing { readonly elapsed: number; readonly started: number | null }
export const idleTiming = (): Timing => ({ elapsed: 0, started: null });
export const elapsedAt = (timing: Timing, now: number): number => timing.elapsed + (timing.started === null ? 0 : Math.max(0, now - timing.started));
export const pauseTiming = (timing: Timing, now: number): Timing => ({ elapsed: elapsedAt(timing, now), started: null });
export const startTiming = (timing: Timing, now: number): Timing => timing.started === null ? { ...timing, started: now } : timing;
export const remainingAt = (timing: Timing, duration: number, now: number): number => Math.max(0, duration - elapsedAt(timing, now));
export const validMinutes = (value: number): boolean => Number.isInteger(value) && value >= 1 && value <= 1440;
export function durationText(milliseconds: number): string {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const hours = Math.floor(seconds / 3600);
  const parts = [Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, '0'));
  if (hours > 0) parts.unshift(String(hours).padStart(2, '0'));
  return parts.join(':');
}
