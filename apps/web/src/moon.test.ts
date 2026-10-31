import { describe, expect, it } from 'vitest';
import { getMoonIllumination } from 'suncalc';
import { moonAt, nextFullMoon } from './moon.ts';
import { todayIn } from './schedule-dates.ts';
const place = { name: 'Triora', latitude: 43.99, longitude: 7.76, timeZone: 'Europe/Rome', elevation: null };
describe('Moon astronomy', () => {
  it('distinguishes new and full moons and finds the next full phase across a cycle', () => {
    const eclipse = new Date('2024-04-08T18:21:00Z');
    expect(moonAt(eclipse, null).phase).toBe('new');
    const full = nextFullMoon(eclipse);
    expect(full.getTime()).toBeGreaterThan(eclipse.getTime());
    expect(full.getTime() - eclipse.getTime()).toBeLessThan(32 * 86_400_000);
    expect(getMoonIllumination(full).fraction).toBeGreaterThan(.999);
    expect(moonAt(full, null).phase).toBe('full');
    const after = nextFullMoon(new Date(full.getTime() + 60_000));
    expect(after.getTime() - full.getTime()).toBeGreaterThan(28 * 86_400_000);
  });
  it('selects rise/set by the place civil day across DST and opposite date-line zones', () => {
    for (const timeZone of ['Europe/Rome', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) for (const date of ['2026-03-29T23:30:00Z', '2026-10-25T00:30:00Z']) {
      const now = new Date(date); const result = moonAt(now, { ...place, timeZone });
      for (const event of [result.rise, result.set]) if (event !== null) expect(todayIn(timeZone, event)).toBe(todayIn(timeZone, now));
    }
  });
  it('needs no location for phase and safely represents days with no polar events', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    expect(moonAt(now, null)).toMatchObject({ rise: null, set: null });
    expect(() => moonAt(now, { ...place, latitude: 89.9 })).not.toThrow();
    expect(moonAt(now, null).fraction).toBe(moonAt(now, place).fraction);
  });
});

it('finds solar events on the configured civil day, including DST and the date line', () => {
  const locations = [place, { ...place, latitude: 1.87, longitude: -157.4, timeZone: 'Pacific/Kiritimati' }, { ...place, latitude: -14.28, longitude: -170.7, timeZone: 'Pacific/Pago_Pago' }];
  for (const location of locations) for (const date of ['2026-03-29T23:30:00Z', '2026-10-25T00:30:00Z']) {
    const now = new Date(date); const result = moonAt(now, location);
    for (const event of [result.sunrise, result.sunset]) {
      expect(event).not.toBeNull();
      if (event === null) throw new Error('Missing solar event');
      expect(todayIn(location.timeZone, event)).toBe(todayIn(location.timeZone, now));
    }
  }
});

it('uses real solar times and reports polar day/night without inventing events', () => {
  const equinox = moonAt(new Date('2026-03-20T12:00:00Z'), { ...place, latitude: 51.48, longitude: 0, timeZone: 'Europe/London', elevation: 0 });
  expect(equinox.sunrise?.getUTCHours()).toBe(6);
  expect(equinox.sunset?.getUTCHours()).toBe(18);
  for (const date of ['2026-06-21T12:00:00Z', '2026-12-21T12:00:00Z']) {
    expect(moonAt(new Date(date), { ...place, latitude: 89.9 })).toMatchObject({ sunrise: null, sunset: null });
  }
  expect(moonAt(new Date(), null)).toMatchObject({ sunrise: null, sunset: null });
});

it('keeps moonset before moonrise when both occur on the same civil date', () => {
  const result = moonAt(new Date('2026-10-31T12:00:00Z'), place);
  expect(result.rise).not.toBeNull(); expect(result.set).not.toBeNull();
  if (result.rise === null || result.set === null) throw new Error('Missing lunar event');
  expect(result.set.getTime()).toBeLessThan(result.rise.getTime());
});
