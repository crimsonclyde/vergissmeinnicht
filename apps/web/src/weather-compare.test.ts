import { describe, expect, it } from 'vitest';
import type { CompareResult, ModelChoice } from './api.ts';
import { compareDates, dayOf, defaultSources, paidCost, spread } from './weather-compare.ts';

const fresh = (provider: CompareResult['provider'], model: CompareResult['model'], days: { date: string; max?: number; precipitationSum?: number }[]): CompareResult => ({
  provider,
  model,
  paid: provider === 'OPENWEATHER' || provider === 'METEOMATICS',
  queries: provider === 'METEOMATICS' ? 2 : 1,
  state: 'fresh',
  forecast: { provider, days },
  fetchedAt: '2026-10-08T10:00:00Z',
  horizon: days.length,
  refreshFailed: null,
});

describe('forecast comparison (19.4c)', () => {
  const blend = fresh('OPEN_METEO', 'best_match', [
    { date: '2026-10-08', max: 19, precipitationSum: 3.4 },
    { date: '2026-10-09', max: 18, precipitationSum: 0 },
    { date: '2026-10-10', max: 17 },
  ]);
  const icon = fresh('OPEN_METEO', 'italia_meteo_arpae_icon_2i', [{ date: '2026-10-08', max: 18, precipitationSum: 11.9 }]);
  const met = fresh('MET_NORWAY', null, [{ date: '2026-10-08', max: 18 }, { date: '2026-10-09', max: 19, precipitationSum: 0.1 }]);

  it('offers every date any source forecasts — not only those all of them cover', () => {
    expect(compareDates([icon, blend, met, { provider: 'OPENWEATHER', model: null, paid: true, queries: 1, state: 'not_fetched' }])).toEqual(['2026-10-08', '2026-10-09', '2026-10-10']);
    expect(dayOf(icon, '2026-10-10')).toBeUndefined();
  });

  it('shows the range across sources, never an average, and counts sources without a value — 0 mm is a value', () => {
    expect(spread([blend, icon, met], '2026-10-08', 'max')).toEqual({ low: 18, high: 19, given: 3, missing: 0 });
    expect(spread([blend, icon, met], '2026-10-08', 'precipitationSum')).toEqual({ low: 3.4, high: 11.9, given: 2, missing: 1 });
    expect(spread([blend, icon, met], '2026-10-09', 'precipitationSum')).toEqual({ low: 0, high: 0.1, given: 2, missing: 0 });
    expect(spread([blend, icon, met], '2026-10-10', 'precipitationSum')).toBeNull();
  });

  it('starts with free sources only: the automatic blend, a regional model covering the place, and MET Norway', () => {
    const models = [
      { id: 'best_match', label: 'Automatic', days: null, hasCondition: null, hasPrecipitationProbability: null },
      { id: 'icon_d2', label: 'ICON-D2', days: 1, hasCondition: true, hasPrecipitationProbability: true },
      { id: 'italia_meteo_arpae_icon_2i', label: 'ICON-2I', days: 3, hasCondition: true, hasPrecipitationProbability: false },
    ] as ModelChoice[];
    expect(defaultSources(['OPEN_METEO', 'MET_NORWAY', 'OPENWEATHER'], models)).toEqual([
      { provider: 'OPEN_METEO', model: 'best_match' },
      { provider: 'OPEN_METEO', model: 'italia_meteo_arpae_icon_2i' },
      { provider: 'MET_NORWAY' },
    ]);
    expect(defaultSources(['MET_NORWAY'], models)).toEqual([{ provider: 'MET_NORWAY' }]);
  });

  it('says how many paid requests fetching would use — Meteomatics counts two', () => {
    const notFetched = (provider: 'OPENWEATHER' | 'METEOMATICS'): CompareResult => ({ provider, model: null, paid: true, queries: provider === 'METEOMATICS' ? 2 : 1, state: 'not_fetched' });
    expect(paidCost([notFetched('OPENWEATHER'), notFetched('METEOMATICS'), blend])).toEqual({ OPENWEATHER: 1, METEOMATICS: 2 });
    expect(paidCost([fresh('OPENWEATHER', null, [{ date: '2026-10-08' }])])).toEqual({});
  });
});
