import { describe, expect, it } from 'vitest';
import {
  combineGazetteForecast, gazetteSourceSkill, gazetteWeatherPlan, gazetteWeatherRegion, liguriaAlertZoneFor, parseGazetteWeatherSettings, type GazetteSourceSeries,
} from './gazette-weather.ts';
import { defaultGazetteSections, parseGazetteEdition, sampleGazetteEdition, type LocalDate } from './index.ts';

const TRIORA = { name: 'Triora', latitude: 43.99, longitude: 7.76, timeZone: 'Europe/Rome', elevation: 780 };
const GOGGENHOFEN = { name: 'Göggenhofen', latitude: 48.22, longitude: 11.04, timeZone: 'Europe/Berlin', elevation: 520 };
const TODAY = '2026-11-20' as LocalDate;
const PLACE = { latitude: 43.99, longitude: 7.76, timeZone: 'Europe/Rome', elevation: 780 };
const day = (offset: number) => new Date(Date.parse(`${TODAY}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
const series = (id: string, family: string, days: GazetteSourceSeries['days'], weight = 1): GazetteSourceSeries =>
  ({ id, label: id.toUpperCase(), model: id, family, url: 'https://example.org/', retrievedAt: '2026-11-20T05:00:00.000Z', weight, days });
const combine = (list: GazetteSourceSeries[]) => combineGazetteForecast({
  name: 'Triora', region: 'Liguria, Italy', place: PLACE, today: TODAY, series: list, warnings: [], warningSources: [], references: [], fetchedAt: '2026-11-20T05:00:00.000Z', failed: [],
});

describe('Daily Planet weather: regions and sources (43.7)', () => {
  it('chooses the region from coordinates and time zone together', () => {
    expect(gazetteWeatherRegion(TRIORA)).toBe('liguria');
    expect(gazetteWeatherRegion(GOGGENHOFEN)).toBe('germany');
    expect(gazetteWeatherRegion({ latitude: 41.9, longitude: 12.5, timeZone: 'Europe/Rome' })).toBe('italy');
    // Nice lies inside Liguria's box but is in France: never Ligurian sources.
    expect(gazetteWeatherRegion({ latitude: 43.7, longitude: 7.6, timeZone: 'Europe/Paris' })).toBe('europe');
    expect(gazetteWeatherRegion({ latitude: 40.7, longitude: -74, timeZone: 'America/New_York' })).toBe('global');
  });

  it('plans regional, global and official sources per region, with independent families', () => {
    const liguria = gazetteWeatherPlan(TRIORA);
    expect(liguria.sources.map(s => s.id)).toEqual(['arpae-icon-2i', 'dwd-icon-eu', 'ecmwf-ifs', 'met-norway', 'allerta-liguria', 'meteoalarm-it']);
    expect(liguria.alertZone).toBe('A');
    expect(liguria.references.map(r => r.name).join(' ')).toContain('ARPAL');
    const bavaria = gazetteWeatherPlan(GOGGENHOFEN);
    expect(bavaria.sources.map(s => s.id)).toEqual(['dwd-icon-d2', 'dwd-icon-eu', 'dwd-mosmix', 'ecmwf-ifs', 'met-norway', 'dwd-warnings']);
    expect(bavaria.alertZone).toBeNull();
    // MET Norway post-processes ECMWF outside the Nordics: the same family, one voice.
    expect(new Set(bavaria.sources.filter(s => ['ecmwf-ifs', 'met-norway'].includes(s.id)).map(s => s.family)).size).toBe(1);
    const other = gazetteWeatherPlan({ name: 'Lyon', latitude: 45.76, longitude: 4.84, timeZone: 'Europe/Paris', elevation: null });
    expect(other.sources.map(s => s.id)).toEqual(['dwd-icon-eu', 'ecmwf-ifs', 'met-norway', 'gfs']);
  });

  it('applies admin choices and finds AllertaLiguria zones by municipality', () => {
    const settings = parseGazetteWeatherSettings({ sources: [{ id: 'met-norway', enabled: false, weight: 1 }, { id: 'ecmwf-ifs', enabled: true, weight: 2.5 }], alertZone: 'B' });
    const plan = gazetteWeatherPlan(TRIORA, settings);
    expect(plan.sources.find(s => s.id === 'met-norway')?.enabled).toBe(false);
    expect(plan.sources.find(s => s.id === 'ecmwf-ifs')?.baseWeight).toBe(2.5);
    expect(plan.alertZone).toBe('B');
    expect(liguriaAlertZoneFor('Triora, Imperia')).toBe('A');
    expect(liguriaAlertZoneFor('Sanremo')).toBe('A');
    expect(liguriaAlertZoneFor('Genova')).toBe('B');
    expect(liguriaAlertZoneFor('Home in Triora')).toBeNull();
    for (const bad of [{ sources: [{ id: 'nope', enabled: true, weight: 1 }] }, { sources: [{ id: 'gfs', enabled: true, weight: 9 }] }, { alertZone: 'F' }, { extra: true }, { automatic: 'yes' }]) {
      expect(() => parseGazetteWeatherSettings(bad)).toThrow();
    }
  });
});

describe('Daily Planet weather: combining forecasts (43.7)', () => {
  it('agreeing families give one value and higher confidence for the first days', () => {
    const forecast = combine([
      series('a', 'icon', [{ date: day(0), high: 12, low: 6, precipitationMm: 4, condition: 'RAIN', precipitationProbability: 80 }]),
      series('b', 'ecmwf', [{ date: day(0), high: 13, low: 5, precipitationMm: 5, condition: 'RAIN', precipitationProbability: 70 }]),
    ]);
    expect(forecast.days).toHaveLength(1);
    expect(forecast.days[0]).toMatchObject({ date: day(0), condition: 'RAIN', high: 12.5, low: 5.5, precipitationMm: 4.5, precipitationProbability: 80, disagreement: false, confidence: 'high' });
    expect(forecast.models).toHaveLength(2);
    expect(forecast.place).toEqual(PLACE);
  });

  it('shows a range and says so when independent families disagree, never one picked number', () => {
    const forecast = combine([
      series('icon-eu', 'icon', [{ date: day(0), high: 14, low: 8, precipitationMm: 8, condition: 'RAIN' }]),
      series('ecmwf', 'ecmwf', [{ date: day(0), high: 15, low: 8, precipitationMm: 22, condition: 'RAIN' }]),
    ]);
    expect(forecast.days[0]?.precipitationMm).toEqual({ min: 8, max: 22 });
    expect(forecast.days[0]?.disagreement).toBe(true);
    expect(forecast.days[0]?.note).toContain('Models disagree on accumulation: 8–22 mm.');
    expect(forecast.days[0]?.confidence).toBe('medium');
  });

  it('does not treat two sources of one model family as independent evidence', () => {
    const forecast = combine([
      series('icon-d2', 'dwd-icon', [{ date: day(0), high: 10, precipitationMm: 2 }]),
      series('icon-eu', 'dwd-icon', [{ date: day(0), high: 16, precipitationMm: 20 }]),
    ]);
    // One family: averaged, no range, but named as a single voice and never "high" confidence.
    expect(forecast.days[0]).toMatchObject({ high: 13, precipitationMm: 11, disagreement: false, confidence: 'medium' });
    expect(forecast.days[0]?.note).toContain('Only one model family');
  });

  it('marks days 4–7 as lower confidence and ends the week where no source covers a day', () => {
    const days = [0, 1, 2, 3, 4, 5].map(i => ({ date: day(i), high: 10 + i, low: 2, precipitationMm: 0, condition: 'CLEAR' as const }));
    const forecast = combine([series('a', 'icon', days), series('b', 'ecmwf', days.slice(0, 4))]);
    expect(forecast.days.map(d => d.date)).toEqual(days.map(d => d.date));
    expect(forecast.days.map(d => d.confidence)).toEqual(['high', 'high', 'medium', 'low', 'low', 'low']);
    // Day 7 has no source: not invented.
    expect(forecast.days.find(d => d.date === day(6))).toBeUndefined();
    expect(combine([]).days).toEqual([]);
    // Only the rest of today missing (MET Norway alone, Open-Meteo rate-limited): the week starts tomorrow.
    const fromTomorrow = combine([series('met', 'ecmwf', days.slice(1))]);
    expect(fromTomorrow.days.map(d => d.date)).toEqual(days.slice(1).map(d => d.date));
    expect(fromTomorrow.days[0]?.confidence).toBe('medium');
    // A gap in the middle still ends the week.
    expect(combine([series('a', 'icon', [days[0], days[2]].filter(d => d !== undefined))]).days.map(d => d.date)).toEqual([day(0)]);
  });

  it('names significant gusts and possible thunder from any family, and keeps a wet day wet', () => {
    const forecast = combine([
      series('icon-2i', 'icon-2i', [{ date: day(0), high: 15, low: 9, precipitationMm: 30, gustKmh: 85, condition: 'THUNDER', precipitationProbability: 90 }], 1.5),
      series('ecmwf', 'ecmwf', [{ date: day(0), high: 16, low: 9, precipitationMm: 26, gustKmh: 55, condition: 'RAIN' }]),
      series('met', 'ecmwf', [{ date: day(0), high: 16, low: 9, precipitationMm: 25, condition: 'CLOUDY' }]),
    ]);
    expect(forecast.days[0]?.gustKmh).toBe(85);
    expect(forecast.days[0]?.note).toContain('Gusts up to 85 km/h (ICON-2I)');
    // A gust spread is reported as "up to" and lowers confidence; it draws no disagreement box.
    expect(forecast.days[0]?.disagreement).toBe(false);
    expect(forecast.days[0]?.confidence).toBe('medium');
    expect(forecast.days[0]?.condition).toBe('THUNDER');
    const wet = combine([series('a', 'icon', [{ date: day(0), high: 9, precipitationMm: 6, precipitationProbability: 95, condition: 'CLOUDY' }]), series('b', 'ecmwf', [{ date: day(0), high: 9, precipitationMm: 6, condition: 'DRIZZLE' }])]);
    expect(wet.days[0]?.condition).toBe('DRIZZLE');
  });

  it('weights sources by lead bucket once verification moved them', () => {
    const forecast = combine([
      { ...series('good', 'icon', [{ date: day(0), high: 10 }]), weights: { short: 3 } },
      series('poor', 'ecmwf', [{ date: day(0), high: 12 }]),
    ]);
    expect(forecast.days[0]?.high).toBe(10.5);
  });
});

describe('Daily Planet weather: verification (43.7)', () => {
  const pairs = (sourceId: string, error: number, n = 6) => Array.from({ length: n }, (_, i) => ({ sourceId, lead: i % 2, forecastHigh: 10 + error, forecastLow: 2, observedHigh: 10, observedLow: 2 }));
  it('moves weights only with enough samples and peers, within bounds', () => {
    const skill = gazetteSourceSkill([...pairs('a', 1), ...pairs('b', 3), ...pairs('c', 0.5, 2)]);
    const a = skill.find(s => s.sourceId === 'a'); const b = skill.find(s => s.sourceId === 'b'); const c = skill.find(s => s.sourceId === 'c');
    expect(a).toMatchObject({ bucket: 'short', samples: 12 });
    expect(a?.factor).toBeGreaterThan(1);
    expect(b?.factor).toBeLessThan(1);
    expect(b?.factor).toBeGreaterThanOrEqual(0.5);
    // Too few samples: unchanged.
    expect(c?.factor).toBe(1);
    expect(gazetteSourceSkill(pairs('alone', 2)).every(s => s.factor === 1)).toBe(true);
  });
});

describe('Daily Planet weather: edition compatibility (43.7)', () => {
  const sections = defaultGazetteSections();
  it('still reads editions written before 43.7', () => {
    const old = sampleGazetteEdition('2026-11-14');
    const parsed = parseGazetteEdition(old, sections);
    const weather = parsed.sections.find(s => s.type === 'weather');
    expect(weather?.type === 'weather' && weather.locations.length).toBe(2);
    expect(weather && 'status' in weather ? weather.status : undefined).toBeUndefined();
  });

  it('accepts a summary-only weather section as unavailable and refuses places with a missing status', () => {
    const parsed = parseGazetteEdition({ version: 1, date: '2026-11-14', sections: [{ sectionId: 'weather', type: 'weather', summary: 'Mild.' }] }, sections);
    expect(parsed.sections[0]).toMatchObject({ status: 'unavailable', locations: [] });
    const old = sampleGazetteEdition('2026-11-14');
    const weather = old.sections.find(s => s.type === 'weather') as unknown as Record<string, unknown>;
    expect(() => parseGazetteEdition({ ...old, sections: [{ ...weather, status: 'no_location' }] }, sections)).toThrow();
  });

  it('round-trips the new forecast fields', () => {
    const forecast = combine([
      series('icon-eu', 'icon', [{ date: day(0), high: 14, low: 8, precipitationMm: 8, condition: 'RAIN', gustKmh: 40 }]),
      series('ecmwf', 'ecmwf', [{ date: day(0), high: 19, low: 8, precipitationMm: 22, condition: 'RAIN' }]),
    ]);
    const edition = { version: 1, date: TODAY, sections: [{ sectionId: 'weather', type: 'weather', summary: '', status: 'ok', generatedBy: 'vmn', locations: [forecast] }] };
    const parsed = parseGazetteEdition(JSON.parse(JSON.stringify(edition)), sections);
    const location = parsed.sections[0]?.type === 'weather' ? parsed.sections[0].locations[0] : undefined;
    expect(location?.days[0]).toMatchObject({ highRange: { min: 14, max: 19 }, confidence: 'medium' });
    expect(location?.models?.map(m => m.family)).toEqual(['icon', 'ecmwf']);
    expect(location?.place).toEqual(PLACE);
  });
});
