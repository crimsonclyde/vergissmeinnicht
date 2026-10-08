import { describe, expect, it } from 'vitest';
import { DEFAULT_WEATHER_SETTINGS, conditionFromMetSymbol, conditionFromWmo, parseWeatherSettings, roundCoordinate } from './weather.ts';

describe('weather (19.4)', () => {
  it('maps provider codes to conditions and never guesses', () => {
    expect([0, 2, 3, 45, 53, 63, 67, 75, 81, 86, 95].map(conditionFromWmo)).toEqual(['CLEAR', 'PARTLY_CLOUDY', 'CLOUDY', 'FOG', 'DRIZZLE', 'RAIN', 'SLEET', 'SNOW', 'SHOWERS', 'SNOW', 'THUNDER']);
    expect(conditionFromWmo(42)).toBe('UNKNOWN');
    expect(conditionFromWmo(undefined)).toBeUndefined();
    expect(['clearsky_day', 'fair_night', 'cloudy', 'fog', 'lightrainshowers_day', 'heavysleet', 'snowandthunder', 'rain'].map(conditionFromMetSymbol)).toEqual(['CLEAR', 'PARTLY_CLOUDY', 'CLOUDY', 'FOG', 'SHOWERS', 'SLEET', 'THUNDER', 'RAIN']);
    expect(conditionFromMetSymbol('something_new')).toBe('UNKNOWN');
  });

  it('rounds coordinates to about a kilometre and keeps manual places anywhere', () => {
    expect(roundCoordinate(43.99309)).toBe(43.99);
    expect(roundCoordinate(-7.765)).toBe(-7.76);
    const settings = parseWeatherSettings({ ...DEFAULT_WEATHER_SETTINGS, location: { name: '  Ferienhaus ', latitude: -33.8688, longitude: 151.2093, timeZone: 'Australia/Sydney', elevation: null } });
    expect(settings.location).toEqual({ name: 'Ferienhaus', latitude: -33.87, longitude: 151.21, timeZone: 'Australia/Sydney', elevation: null });
  });

  it('refuses a fractional elevation, a missing flag and an offset instead of a time zone', () => {
    const base = { ...DEFAULT_WEATHER_SETTINGS, location: { name: 'X', latitude: 1, longitude: 1, timeZone: 'UTC', elevation: null } };
    expect(() => parseWeatherSettings({ ...base, location: { ...base.location, elevation: 10.5 } })).toThrow();
    expect(() => parseWeatherSettings({ ...base, location: { ...base.location, timeZone: '+02:00' } })).toThrow();
    expect(() => parseWeatherSettings({ ...base, fallback: undefined })).toThrow();
  });
});
