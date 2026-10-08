import { describe, expect, it } from 'vitest';
import { rainIndication, showable, sourceLabel, temperature } from './weather-view.ts';

describe('weather on Today (19.4)', () => {
  it('converts only in the browser and only for display; a missing value stays missing', () => {
    expect(temperature(16.2, 'C')).toBe('16°');
    expect(temperature(16.2, 'F')).toBe('61°');
    expect(temperature(-0.4, 'C')).toBe('0°');
    expect(temperature(undefined, 'C')).toBeNull();
  });

  it('shows rain as the provider gives it — a chance where there is one, else an amount, else nothing', () => {
    expect(rainIndication({ date: '2026-10-08', precipitationProbabilityMax: 70, precipitationSum: 3.4 })).toEqual({ kind: 'probability', value: 70 });
    expect(rainIndication({ date: '2026-10-08', precipitationSum: 11.9 })).toEqual({ kind: 'amount', value: 11.9 });
    expect(rainIndication({ date: '2026-10-08' })).toBeNull();
    expect(rainIndication(undefined)).toBeNull();
  });

  it('names who supplied the forecast, with the model when one was chosen', () => {
    expect(sourceLabel('OPEN_METEO', 'best_match')).toBe('Open-Meteo');
    expect(sourceLabel('OPEN_METEO', 'italia_meteo_arpae_icon_2i')).toBe('Open-Meteo · ItaliaMeteo ARPAE ICON-2I');
    expect(sourceLabel('MET_NORWAY', undefined)).toBe('MET Norway');
  });

  it('never shows a forecast older than 6 hours', () => {
    const now = new Date('2026-10-08T16:00:00Z');
    expect(showable('2026-10-08T10:00:00Z', now)).toBe(true);
    expect(showable('2026-10-08T09:59:00Z', now)).toBe(false);
  });
});
