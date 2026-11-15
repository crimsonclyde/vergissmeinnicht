import { DomainValidationError } from './errors.ts';
import type { GazetteForecastDay, GazetteForecastPlace, GazetteLocationForecast, GazetteModelForecast, GazetteSource, GazetteWarning } from './gazette.ts';
import { LIGURIA_ALERT_ZONE_TOWNS } from './liguria-alert-zones.ts';
import { addDays, type LocalDate } from './schedule.ts';
import type { WeatherCondition, WeatherLocation } from './weather.ts';

/**
 * The Daily Planet's weather (43.7): one forecast for the Workspace's own place, made by VMN on the server
 * from several sources chosen for the region, compared rather than picked. Values are only ever what a
 * source said; where independent model families disagree the edition shows a range and says so.
 *
 * Independence: a "family" is the underlying model. Two sources of one family (ICON-D2 and ICON-EU, or
 * ECMWF IFS and MET Norway, which post-processes ECMWF outside the Nordics) count as one voice.
 */

export const GAZETTE_WEATHER_REGIONS = ['liguria', 'italy', 'germany', 'europe', 'global'] as const;
export type GazetteWeatherRegion = (typeof GAZETTE_WEATHER_REGIONS)[number];
export const LIGURIA_ALERT_ZONES = ['A', 'B', 'C', 'D', 'E'] as const;
export type LiguriaAlertZone = (typeof LIGURIA_ALERT_ZONES)[number];

export type GazetteWeatherProvider = 'open-meteo' | 'met-norway' | 'bright-sky' | 'allerta-liguria' | 'meteoalarm';
export interface GazetteWeatherSourceDefinition {
  readonly id: string;
  readonly provider: GazetteWeatherProvider;
  readonly role: 'forecast' | 'warnings';
  /** Provider model id (Open-Meteo `models=`), or a fixed label for other providers. */
  readonly model: string;
  readonly family: string;
  readonly label: string;
  /** Days the source forecasts at most (its own horizon; nothing past it is taken). */
  readonly days: number;
  readonly regions: readonly GazetteWeatherRegion[];
  readonly url: string;
  /** Starting weight before verification: regional high-resolution models lead the short range. */
  readonly weight: number;
}

const ALL: readonly GazetteWeatherRegion[] = GAZETTE_WEATHER_REGIONS;
/** Fixed in code: no endpoint or host is configurable (security.md, outbound connections). */
export const GAZETTE_WEATHER_SOURCES: readonly GazetteWeatherSourceDefinition[] = [
  { id: 'arpae-icon-2i', provider: 'open-meteo', role: 'forecast', model: 'italia_meteo_arpae_icon_2i', family: 'icon-2i', label: 'ItaliaMeteo ARPAE ICON-2I', days: 3, regions: ['liguria', 'italy'], url: 'https://open-meteo.com/en/docs/italia-meteo-arpae-api', weight: 1.5 },
  { id: 'dwd-icon-d2', provider: 'open-meteo', role: 'forecast', model: 'icon_d2', family: 'dwd-icon', label: 'DWD ICON-D2', days: 2, regions: ['germany'], url: 'https://open-meteo.com/en/docs/dwd-api', weight: 1.5 },
  { id: 'dwd-icon-eu', provider: 'open-meteo', role: 'forecast', model: 'icon_eu', family: 'dwd-icon', label: 'DWD ICON-EU', days: 5, regions: ['liguria', 'italy', 'germany', 'europe'], url: 'https://open-meteo.com/en/docs/dwd-api', weight: 1 },
  { id: 'dwd-mosmix', provider: 'bright-sky', role: 'forecast', model: 'mosmix', family: 'mosmix', label: 'DWD MOSMIX', days: 10, regions: ['germany'], url: 'https://www.dwd.de/EN/ourservices/met_application_mosmix/met_application_mosmix.html', weight: 1.25 },
  { id: 'ecmwf-ifs', provider: 'open-meteo', role: 'forecast', model: 'ecmwf_ifs025', family: 'ecmwf', label: 'ECMWF IFS', days: 15, regions: ALL, url: 'https://open-meteo.com/en/docs/ecmwf-api', weight: 1 },
  { id: 'met-norway', provider: 'met-norway', role: 'forecast', model: 'locationforecast', family: 'ecmwf', label: 'MET Norway', days: 9, regions: ALL, url: 'https://api.met.no/', weight: 1 },
  { id: 'gfs', provider: 'open-meteo', role: 'forecast', model: 'gfs_seamless', family: 'gfs', label: 'NOAA GFS', days: 16, regions: ['europe', 'global'], url: 'https://open-meteo.com/en/docs/gfs-api', weight: 0.75 },
  { id: 'dwd-warnings', provider: 'bright-sky', role: 'warnings', model: 'dwd-cap', family: 'dwd-warnings', label: 'DWD warnings', days: 3, regions: ['germany'], url: 'https://www.dwd.de/DE/wetter/warnungen/warnWetter_node.html', weight: 1 },
  { id: 'allerta-liguria', provider: 'allerta-liguria', role: 'warnings', model: 'allerta', family: 'allerta-liguria', label: 'AllertaLiguria (Regione Liguria / ARPAL)', days: 2, regions: ['liguria'], url: 'https://allertaliguria.regione.liguria.it/', weight: 1 },
  { id: 'meteoalarm-it', provider: 'meteoalarm', role: 'warnings', model: 'meteoalarm', family: 'meteoalarm', label: 'Meteoalarm (Aeronautica Militare)', days: 3, regions: ['liguria'], url: 'https://meteoalarm.org/en/live/region/IT', weight: 1 },
];
export type GazetteWeatherSourceId = string;

/** Sources worth reading by hand that VMN does not fetch (no documented, permitted machine access). */
export const GAZETTE_WEATHER_REFERENCES: Readonly<Record<GazetteWeatherRegion, readonly GazetteSource[]>> = {
  liguria: [
    { name: 'ARPAL bulletin (meteorologist-reviewed)', url: 'https://allertaliguria.regione.liguria.it/bollettino_vigilanza_arpal.php', role: 'reference' },
    { name: 'Meteo 3R', url: 'https://www.meteo3r.it/', role: 'reference' },
    { name: 'ARPAL OMIRL (MOLOCH, observations)', url: 'https://omirl.regione.liguria.it/', role: 'reference' },
  ],
  italy: [{ name: 'Aeronautica Militare', url: 'https://www.meteoam.it/', role: 'reference' }],
  germany: [{ name: 'DWD', url: 'https://www.dwd.de/', role: 'reference' }],
  europe: [{ name: 'Meteoalarm', url: 'https://meteoalarm.org/', role: 'reference' }],
  global: [],
};

export interface GazetteWeatherSourceSetting { readonly id: GazetteWeatherSourceId; readonly enabled: boolean; readonly weight: number }
export interface GazetteWeatherSettings {
  /** VMN fills the weather section of every new edition from the Workspace place. */
  readonly automatic: boolean;
  /** Only sources an admin changed; the rest use their defaults. */
  readonly sources: readonly GazetteWeatherSourceSetting[];
  /** AllertaLiguria zone; `null` = taken from the place name when it is a Ligurian municipality. */
  readonly alertZone: LiguriaAlertZone | null;
  /** Adjust weights from verified errors against nearby official stations, where there are any. */
  readonly learn: boolean;
}
export const DEFAULT_GAZETTE_WEATHER_SETTINGS: GazetteWeatherSettings = { automatic: true, sources: [], alertZone: null, learn: true };
export const GAZETTE_WEATHER_WEIGHT_MAX = 3;

const refuse = (path: string): never => { throw new DomainValidationError(path, 'invalid_gazette', 'Invalid Gazette weather settings'); };

export function parseGazetteWeatherSettings(value: unknown): GazetteWeatherSettings {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return refuse('settings.weather');
  const { automatic, sources, alertZone, learn, ...extra } = value as Record<string, unknown>;
  if (Object.keys(extra).length > 0) refuse(`settings.weather.${Object.keys(extra)[0]}`);
  if (automatic !== undefined && typeof automatic !== 'boolean') refuse('settings.weather.automatic');
  if (learn !== undefined && typeof learn !== 'boolean') refuse('settings.weather.learn');
  if (alertZone !== undefined && alertZone !== null && !(LIGURIA_ALERT_ZONES as readonly unknown[]).includes(alertZone)) refuse('settings.weather.alertZone');
  const list = sources === undefined ? [] : Array.isArray(sources) && sources.length <= GAZETTE_WEATHER_SOURCES.length ? sources : refuse('settings.weather.sources');
  const seen = new Set<string>();
  const parsed = list.map((item: unknown, i): GazetteWeatherSourceSetting => {
    const path = `settings.weather.sources[${i}]`;
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return refuse(path);
    const { id, enabled, weight, ...rest } = item as Record<string, unknown>;
    if (Object.keys(rest).length > 0 || typeof id !== 'string' || !GAZETTE_WEATHER_SOURCES.some(source => source.id === id) || seen.has(id)) return refuse(`${path}.id`);
    if (typeof enabled !== 'boolean') return refuse(`${path}.enabled`);
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0.25 || weight > GAZETTE_WEATHER_WEIGHT_MAX) return refuse(`${path}.weight`);
    seen.add(id);
    return { id, enabled, weight: Math.round(weight * 100) / 100 };
  });
  return { automatic: automatic === undefined ? true : automatic === true, sources: parsed, alertZone: (alertZone ?? null) as LiguriaAlertZone | null, learn: learn === undefined ? true : learn === true };
}

/** Which source set fits a place. Coordinates and time zone together: a box alone would put Nice in Liguria. */
export function gazetteWeatherRegion(place: Pick<WeatherLocation, 'latitude' | 'longitude' | 'timeZone'>): GazetteWeatherRegion {
  const { latitude: lat, longitude: lon, timeZone } = place;
  if (timeZone === 'Europe/Rome' && lat >= 43.75 && lat <= 44.68 && lon >= 7.49 && lon <= 10.07) return 'liguria';
  if (timeZone === 'Europe/Rome' && lat >= 35.4 && lat <= 47.1 && lon >= 6.6 && lon <= 18.6) return 'italy';
  if (timeZone === 'Europe/Berlin' && lat >= 47.27 && lat <= 55.06 && lon >= 5.86 && lon <= 15.05) return 'germany';
  if (timeZone.startsWith('Europe/')) return 'europe';
  return 'global';
}

const townKey = (name: string) => name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’`]/g, '').replace(/[^a-z0-9]+/gi, ' ').trim().toUpperCase();
/** The AllertaLiguria zone of a Ligurian municipality named like the Workspace place ("Triora", "Triora, Imperia"). */
export function liguriaAlertZoneFor(placeName: string): LiguriaAlertZone | null {
  const first = townKey(placeName.split(',')[0] ?? '');
  for (const zone of LIGURIA_ALERT_ZONES) if (LIGURIA_ALERT_ZONE_TOWNS[zone].some(town => townKey(town) === first)) return zone;
  return null;
}

export interface GazetteWeatherPlanSource extends GazetteWeatherSourceDefinition { readonly enabled: boolean; readonly baseWeight: number }
export interface GazetteWeatherPlan {
  readonly region: GazetteWeatherRegion;
  readonly sources: readonly GazetteWeatherPlanSource[];
  readonly alertZone: LiguriaAlertZone | null;
  readonly references: readonly GazetteSource[];
}

export function gazetteWeatherPlan(place: WeatherLocation, settings: GazetteWeatherSettings = DEFAULT_GAZETTE_WEATHER_SETTINGS): GazetteWeatherPlan {
  const region = gazetteWeatherRegion(place);
  const sources = GAZETTE_WEATHER_SOURCES.filter(source => source.regions.includes(region)).map(source => {
    const own = settings.sources.find(item => item.id === source.id);
    return { ...source, enabled: own?.enabled ?? true, baseWeight: own?.weight ?? source.weight };
  });
  const alertZone = region === 'liguria' ? settings.alertZone ?? liguriaAlertZoneFor(place.name) : null;
  return { region, sources, alertZone, references: GAZETTE_WEATHER_REFERENCES[region] };
}

// ---------------------------------------------------------------------------------------------------
// Combining sources

export interface GazetteSourceDay {
  readonly date: string;
  readonly high?: number;
  readonly low?: number;
  readonly precipitationMm?: number;
  readonly precipitationProbability?: number;
  readonly windKmh?: number;
  readonly gustKmh?: number;
  readonly condition?: WeatherCondition;
}
export interface GazetteSourceSeries {
  readonly id: GazetteWeatherSourceId;
  readonly label: string;
  readonly model: string;
  readonly family: string;
  readonly url: string;
  readonly retrievedAt: string;
  /** Base weight × verified skill factor. */
  readonly weight: number;
  /** Per lead bucket, when verification moved it; otherwise `weight`. */
  readonly weights?: Partial<Record<GazetteSkillBucket, number>>;
  readonly days: readonly GazetteSourceDay[];
  /** E.g. "station Mering, 7 km, 508 m; temperatures adjusted to 520 m". */
  readonly note?: string;
}
export interface GazetteCombineInput {
  readonly name: string;
  readonly region: string;
  readonly place: GazetteForecastPlace;
  readonly today: LocalDate;
  readonly series: readonly GazetteSourceSeries[];
  readonly warnings: readonly GazetteWarning[];
  readonly warningSources: readonly GazetteSource[];
  readonly references: readonly GazetteSource[];
  readonly fetchedAt: string;
  readonly failed: readonly string[];
  readonly days?: number;
}

/** Thresholds where a difference between model families becomes worth showing (°C, mm, km/h). */
export const GAZETTE_DISAGREEMENT = Object.freeze({ temperature: 3, precipitationMm: 2, precipitationRatio: 0.5, gustKmh: 25, significantGustKmh: 60 });
const SEVERITY: readonly WeatherCondition[] = ['UNKNOWN', 'CLEAR', 'PARTLY_CLOUDY', 'CLOUDY', 'FOG', 'DRIZZLE', 'SHOWERS', 'RAIN', 'SLEET', 'SNOW', 'THUNDER'];
const WET: readonly WeatherCondition[] = ['DRIZZLE', 'SHOWERS', 'RAIN', 'SLEET', 'SNOW', 'THUNDER'];
const round = (value: number, digits = 1) => { const f = 10 ** digits; return Math.round(value * f) / f; };

interface FamilyValue { readonly family: string; readonly weight: number; readonly value: number; readonly labels: readonly string[] }
const weightAt = (s: GazetteSourceSeries, lead: number) => s.weights?.[gazetteSkillBucket(lead)] ?? s.weight;
function byFamily(series: readonly { s: GazetteSourceSeries; d: GazetteSourceDay }[], pick: (d: GazetteSourceDay) => number | undefined, lead: number): FamilyValue[] {
  const groups = new Map<string, { sum: number; weights: number; max: number; labels: string[] }>();
  for (const { s, d } of series) {
    const w = weightAt(s, lead);
    const value = pick(d); if (value === undefined || w <= 0) continue;
    const g = groups.get(s.family) ?? { sum: 0, weights: 0, max: 0, labels: [] };
    g.sum += value * w; g.weights += w; g.max = Math.max(g.max, w); g.labels.push(s.label);
    groups.set(s.family, g);
  }
  return [...groups].map(([family, g]) => ({ family, weight: g.max, value: g.sum / g.weights, labels: g.labels }));
}
const weighted = (values: readonly FamilyValue[]) => values.reduce((sum, v) => sum + v.value * v.weight, 0) / values.reduce((sum, v) => sum + v.weight, 0);
const spread = (values: readonly FamilyValue[]) => ({ min: Math.min(...values.map(v => v.value)), max: Math.max(...values.map(v => v.value)) });

/**
 * One day from every source that covers it. Nothing is filled in: a day no source covers ends the week
 * (a first day no source covers in full, such as the rest of today from MET Norway alone, is skipped
 * instead), and a value no source gives stays `null`.
 */
export function combineGazetteForecast(input: GazetteCombineInput): GazetteLocationForecast {
  const length = Math.min(input.days ?? 7, 10);
  const days: GazetteForecastDay[] = [];
  for (let lead = 0; lead < length; lead++) {
    const date = addDays(input.today, lead);
    const covering = input.series.flatMap(s => { const d = s.days.find(day => day.date === date); return d && (d.high !== undefined || d.low !== undefined || d.precipitationMm !== undefined) ? [{ s, d }] : []; });
    if (covering.length === 0) { if (days.length === 0 && lead === 0) continue; break; }
    const highs = byFamily(covering, d => d.high, lead), lows = byFamily(covering, d => d.low, lead), rain = byFamily(covering, d => d.precipitationMm, lead);
    const probability = byFamily(covering, d => d.precipitationProbability, lead), wind = byFamily(covering, d => d.windKmh, lead), gusts = byFamily(covering, d => d.gustKmh, lead);
    const families = new Set(covering.map(c => c.s.family)).size;
    const notes: string[] = [];
    let disagreement = false;
    const temperature = (values: FamilyValue[]) => {
      if (values.length === 0) return { value: null, range: undefined };
      const r = spread(values);
      const wide = values.length > 1 && r.max - r.min > GAZETTE_DISAGREEMENT.temperature;
      if (wide) disagreement = true;
      return { value: round(weighted(values), lead >= 3 ? 0 : 1), range: wide ? { min: round(r.min, 0), max: round(r.max, 0) } : undefined };
    };
    const high = temperature(highs), low = temperature(lows);
    let precipitation: GazetteForecastDay['precipitationMm'] = null;
    if (rain.length > 0) {
      const r = spread(rain);
      if (rain.length > 1 && r.max >= 1 && r.max - r.min > Math.max(GAZETTE_DISAGREEMENT.precipitationMm, GAZETTE_DISAGREEMENT.precipitationRatio * r.max)) {
        disagreement = true;
        precipitation = { min: round(r.min, 0), max: round(r.max, 0) };
        if (precipitation.min === precipitation.max) precipitation = precipitation.min;
        else notes.push(`Models disagree on accumulation: ${precipitation.min}–${precipitation.max} mm.`);
      } else precipitation = round(weighted(rain), r.max < 10 ? 1 : 0);
    }
    if (high.range) notes.push(`Highs differ between models: ${high.range.min}–${high.range.max} °C.`);
    if (low.range) notes.push(`Lows differ between models: ${low.range.min}–${low.range.max} °C.`);
    // Gusts: the strongest family is reported ("up to"): an underestimate is the costly mistake.
    const gust = gusts.length === 0 ? null : round(Math.max(...gusts.map(g => g.value)), 0);
    // Gust spread lowers confidence but marks no range: "up to" already reports the worst case.
    let gustsDiffer = false;
    if (gusts.length > 1) { const r = spread(gusts); gustsDiffer = r.max - r.min > GAZETTE_DISAGREEMENT.gustKmh && r.max >= GAZETTE_DISAGREEMENT.significantGustKmh; }
    if (gust !== null && gust >= GAZETTE_DISAGREEMENT.significantGustKmh) notes.push(`Gusts up to ${gust} km/h (${gusts.find(g => round(g.value, 0) === gust)?.labels.join(', ') ?? ''}).`);
    // Condition: a weighted vote of the families; a tie goes to the more severe. Thunder from any family is named.
    const votes = new Map<WeatherCondition, number>();
    for (const family of new Set(covering.map(c => c.s.family))) {
      const members = covering.filter(c => c.s.family === family && c.d.condition !== undefined && c.d.condition !== 'UNKNOWN');
      const strongest = members.sort((a, b) => weightAt(b.s, lead) - weightAt(a.s, lead))[0];
      if (strongest?.d.condition) votes.set(strongest.d.condition, (votes.get(strongest.d.condition) ?? 0) + weightAt(strongest.s, lead));
    }
    let condition = [...votes].sort((a, b) => b[1] - a[1] || SEVERITY.indexOf(b[0]) - SEVERITY.indexOf(a[0]))[0]?.[0] ?? 'UNKNOWN';
    // A dry symbol over a wet day misleads: when the sources together expect rain, the wettest symbol a source gave wins.
    const wet = rain.length > 0 && weighted(rain) >= 1 && (probability.length === 0 || Math.max(...probability.map(p => p.value)) >= 50);
    if (wet && !WET.includes(condition)) {
      const given = covering.map(c => c.d.condition).filter((c): c is WeatherCondition => c !== undefined && WET.includes(c) && c !== 'THUNDER');
      const best = given.sort((x, y) => given.filter(g => g === y).length - given.filter(g => g === x).length)[0];
      if (best) condition = best;
    }
    const thunder = covering.filter(c => c.d.condition === 'THUNDER').map(c => c.s.label);
    if (condition !== 'THUNDER' && thunder.length > 0) notes.push(`Thunderstorms possible (${thunder.join(', ')}).`);
    if (families === 1) notes.push(`Only one model family covers this day (${covering.map(c => c.s.label).join(', ')}): read it as a single forecast.`);
    const confidence: GazetteForecastDay['confidence'] = lead >= 3 ? 'low' : disagreement || gustsDiffer || families === 1 ? 'medium' : lead === 2 ? 'medium' : 'high';
    days.push({
      date, condition, high: high.value, low: low.value !== null && high.value !== null && low.value > high.value ? high.value : low.value, precipitationMm: precipitation,
      windKmh: wind.length === 0 ? null : round(weighted(wind), 0), gustKmh: gust, disagreement,
      ...(high.range ? { highRange: high.range } : {}), ...(low.range ? { lowRange: low.range } : {}),
      precipitationProbability: probability.length === 0 ? null : Math.round(Math.max(...probability.map(p => p.value))),
      confidence, ...(notes.length > 0 ? { note: notes.join(' ').slice(0, 200) } : {}),
    });
  }
  const used = input.series.filter(s => s.days.some(d => days.some(day => day.date === d.date)));
  const models: GazetteModelForecast[] = used.slice(0, 8).map(s => ({
    source: s.label, model: s.model, family: s.family, retrievedAt: s.retrievedAt, weight: round(s.weight, 2),
    days: days.flatMap(day => { const d = s.days.find(x => x.date === day.date); return d ? [{ date: day.date, condition: d.condition ?? 'UNKNOWN', high: d.high === undefined ? null : round(d.high), low: d.low === undefined ? null : round(d.low), precipitationMm: d.precipitationMm === undefined ? null : round(d.precipitationMm), gustKmh: d.gustKmh === undefined ? null : round(d.gustKmh, 0) }] : []; }),
  }));
  const sources: GazetteSource[] = [
    ...used.map(s => ({ name: s.label, url: s.url, model: s.model, retrievedAt: s.retrievedAt, role: 'forecast' as const })),
    ...input.warningSources, ...input.references,
  ].slice(0, 12);
  const notes = [...used.flatMap(s => s.note ? [`${s.label}: ${s.note}`] : []), ...(input.failed.length > 0 ? [`Unavailable now: ${input.failed.join(', ')}.`] : [])];
  return {
    name: input.name, region: input.region, days, comparison: null, warnings: [...input.warnings].sort((a, b) => GAZETTE_WARNING_ORDER.indexOf(b.level) - GAZETTE_WARNING_ORDER.indexOf(a.level)).slice(0, 10),
    sources, fetchedAt: input.fetchedAt, note: notes.join(' · ').slice(0, 300), place: input.place, models,
  };
}
const GAZETTE_WARNING_ORDER = ['info', 'yellow', 'orange', 'red'] as const;

// ---------------------------------------------------------------------------------------------------
// Verification against observations

/** Lead time buckets for skill: the best source differs between the short range and the week. */
export const GAZETTE_SKILL_BUCKETS = [{ id: 'short', from: 0, to: 1 }, { id: 'medium', from: 2, to: 3 }, { id: 'long', from: 4, to: 9 }] as const;
export type GazetteSkillBucket = (typeof GAZETTE_SKILL_BUCKETS)[number]['id'];
export const GAZETTE_SKILL_MIN_SAMPLES = 5;
export const gazetteSkillBucket = (lead: number): GazetteSkillBucket => GAZETTE_SKILL_BUCKETS.find(b => lead >= b.from && lead <= b.to)?.id ?? 'long';

export interface GazetteVerificationPair { readonly sourceId: string; readonly lead: number; readonly forecastHigh: number | null; readonly forecastLow: number | null; readonly observedHigh: number | null; readonly observedLow: number | null }
export interface GazetteSourceSkill { readonly sourceId: string; readonly bucket: GazetteSkillBucket; readonly samples: number; readonly maeC: number | null; readonly factor: number }

/**
 * Mean absolute error of daily highs and lows per source and lead bucket. A factor other than 1 needs at
 * least `GAZETTE_SKILL_MIN_SAMPLES` pairs for that source and for at least one other source in the bucket;
 * it compares a source with the median of its peers and stays within 0.5–1.5, so one bad week never
 * silences a source.
 */
export function gazetteSourceSkill(pairs: readonly GazetteVerificationPair[]): GazetteSourceSkill[] {
  const groups = new Map<string, { sourceId: string; bucket: GazetteSkillBucket; errors: number[] }>();
  for (const pair of pairs) {
    const bucket = gazetteSkillBucket(pair.lead);
    const key = `${pair.sourceId}|${bucket}`;
    const g = groups.get(key) ?? { sourceId: pair.sourceId, bucket, errors: [] };
    if (pair.forecastHigh !== null && pair.observedHigh !== null) g.errors.push(Math.abs(pair.forecastHigh - pair.observedHigh));
    if (pair.forecastLow !== null && pair.observedLow !== null) g.errors.push(Math.abs(pair.forecastLow - pair.observedLow));
    groups.set(key, g);
  }
  const rows = [...groups.values()].map(g => ({ ...g, samples: g.errors.length, mae: g.errors.length === 0 ? null : g.errors.reduce((a, b) => a + b, 0) / g.errors.length }));
  return rows.map(row => {
    const peers = rows.filter(r => r.bucket === row.bucket && r.samples >= GAZETTE_SKILL_MIN_SAMPLES && r.mae !== null).map(r => r.mae as number).sort((a, b) => a - b);
    const median = peers.length === 0 ? null : peers.length % 2 ? peers[(peers.length - 1) / 2] as number : ((peers[peers.length / 2 - 1] as number) + (peers[peers.length / 2] as number)) / 2;
    const factor = row.samples >= GAZETTE_SKILL_MIN_SAMPLES && peers.length >= 2 && row.mae !== null && median !== null ? Math.min(1.5, Math.max(0.5, median / Math.max(row.mae, 0.3))) : 1;
    return { sourceId: row.sourceId, bucket: row.bucket, samples: row.samples, maeC: row.mae === null ? null : round(row.mae, 2), factor: round(factor, 2) };
  });
}

/** Standard atmosphere lapse rate: a station's temperature moved to the place's elevation (°C per metre). */
export const LAPSE_RATE_C_PER_M = 0.0065;
export const adjustForElevation = (value: number, fromM: number, toM: number) => round(value - (toM - fromM) * LAPSE_RATE_C_PER_M);
