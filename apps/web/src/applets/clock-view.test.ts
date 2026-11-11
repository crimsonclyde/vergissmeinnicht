import { describe, expect, it } from 'vitest';
import { hoursMinutes, isoWeek, utcOffset, wallHour, zoneCity } from './clock-view.ts';

describe('Clock page helpers', () => {
  it('counts ISO weeks, including the year edges', () => {
    expect(isoWeek(new Date(2026, 10, 11))).toBe(46);
    expect(isoWeek(new Date(2026, 0, 1))).toBe(1);
    expect(isoWeek(new Date(2027, 0, 1))).toBe(53);
    expect(isoWeek(new Date(2024, 11, 30))).toBe(1);
  });

  it('writes UTC offsets briefly', () => {
    expect(utcOffset(-60)).toBe('+1');
    expect(utcOffset(300)).toBe('-5');
    expect(utcOffset(-330)).toBe('+5:30');
    expect(utcOffset(0)).toBe('±0');
  });

  it('names the city of a zone and reads wall times', () => {
    expect(zoneCity('Europe/Berlin')).toBe('Berlin');
    expect(zoneCity('America/Argentina/Buenos_Aires')).toBe('Buenos Aires');
    expect(zoneCity('UTC')).toBe('UTC');
    expect(wallHour('2026-11-11T07:30')).toBe(7.5);
    expect(hoursMinutes(548)).toEqual({ hours: 9, minutes: '08' });
  });
});
