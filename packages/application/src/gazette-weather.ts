import {
  DEFAULT_GAZETTE_WEATHER_SETTINGS, GAZETTE_SKILL_BUCKETS, addDays, adjustForElevation, combineGazetteForecast, gazettePrecipitationMm, gazetteSourceSkill, gazetteToday, gazetteWeatherPlan, weatherLocationKey,
  type GazetteEditionContent, type GazetteLocationForecast, type GazetteSectionContent, type GazetteSettings, type GazetteSkillBucket, type GazetteSource, type GazetteSourceDay, type GazetteSourceSeries,
  type GazetteWarning, type GazetteWeatherPlan, type LocalDate, type WeatherLocation, type WorkspaceId,
} from '@vergissmeinnicht/domain';
import type { Clock } from './ports/clock.ts';
import type { GazetteObservedDay, GazettePlaceQuery, GazetteWeatherLogRepository, GazetteWeatherSourcesPort } from './ports/gazette-weather.ts';
import { WeatherProviderError, type ServerWeatherSettingsRepository } from './ports/weather.ts';
import type { WorkspaceRepository } from './ports/workspace-repository.ts';
import type { WeatherService } from './weather/use-cases.ts';

/**
 * The Daily Planet's weather (43.7): VMN makes the forecast for the Workspace's own place on the server.
 * The place is the Workspace location (the same one members may opt into for their weather), never a
 * client's or a person's position. Sources are chosen per region, fetched in parallel through a shared
 * cache, compared by model family and stored with the edition, so an archived edition keeps its place
 * and its numbers even after the Workspace moves.
 */
export interface GazetteWeatherDeps {
  readonly sources: GazetteWeatherSourcesPort;
  readonly log: GazetteWeatherLogRepository;
  readonly weather: WeatherService;
  readonly serverWeather: ServerWeatherSettingsRepository;
  readonly workspaces: WorkspaceRepository;
  readonly clock: Clock;
}

export type GazetteWeatherResult =
  | { readonly status: 'ok'; readonly location: GazetteLocationForecast; readonly plan: GazetteWeatherPlan; readonly failed: readonly string[] }
  | { readonly status: 'unavailable'; readonly plan: GazetteWeatherPlan | null; readonly failed: readonly string[]; readonly reason: 'sources' | 'weather_off' }
  | { readonly status: 'no_location' };

/** Days a forecast has; days past it are not shown. */
export const GAZETTE_FORECAST_DAYS = 7;
/** Verification: only stations this close and at a similar height stand for the place. */
export const VERIFY_MAX_DISTANCE_M = 25_000;
export const VERIFY_MAX_ELEVATION_GAP_M = 300;
const VERIFY_WINDOW_DAYS = 45;
const OBSERVATIONS_PER_BUILD = 3;

const REGION_NAMES: Record<string, string> = { liguria: 'Liguria, Italy', italy: 'Italy', germany: 'Germany', europe: '', global: '' };

// ---------------------------------------------------------------------------------------------------
// A shared cache in front of the sources: one upstream request per key at a time, fresh for a while,
// a stale copy (≤ 3 h) when a source fails, and a ceiling on upstream calls per source and 10 minutes.

const TTL_MS = { forecast: 30 * 60_000, warnings: 10 * 60_000, observations: 12 * 60 * 60_000 } as const;
const STALE_MS = 3 * 60 * 60_000;
const BUDGET = { windowMs: 10 * 60_000, calls: 30 } as const;

export function cachedGazetteWeatherSources(port: GazetteWeatherSourcesPort, clock: Clock): GazetteWeatherSourcesPort {
  const cache = new Map<string, { at: number; value: unknown }>();
  const inflight = new Map<string, Promise<unknown>>();
  const calls = new Map<string, number[]>();
  const run = async <T>(method: keyof GazetteWeatherSourcesPort, ttl: number, args: readonly unknown[], call: () => Promise<T>): Promise<T> => {
    const key = `${method}|${JSON.stringify(args)}`;
    const now = clock.now().getTime();
    const hit = cache.get(key);
    if (hit && now - hit.at < ttl) return hit.value as T;
    const running = inflight.get(key);
    if (running) return running as Promise<T>;
    const recent = (calls.get(method) ?? []).filter(at => now - at < BUDGET.windowMs);
    if (recent.length >= BUDGET.calls) {
      if (hit && now - hit.at < STALE_MS) return hit.value as T;
      throw new WeatherProviderError('rate_limited');
    }
    calls.set(method, [...recent, now]);
    const promise = call().then(value => {
      cache.delete(key); cache.set(key, { at: clock.now().getTime(), value });
      while (cache.size > 300) cache.delete(cache.keys().next().value as string);
      return value;
    }, (error: unknown) => {
      if (hit && clock.now().getTime() - hit.at < STALE_MS) return hit.value as T;
      throw error;
    }).finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  };
  return {
    openMeteoModels: (q, models, days) => run('openMeteoModels', TTL_MS.forecast, [q, models, days], () => port.openMeteoModels(q, models, days)),
    mosmix: (q, from, days) => run('mosmix', TTL_MS.forecast, [q, from, days], () => port.mosmix(q, from, days)),
    dwdWarnings: q => run('dwdWarnings', TTL_MS.warnings, [q], () => port.dwdWarnings(q)),
    dwdObservations: (q, date) => run('dwdObservations', TTL_MS.observations, [q, date], () => port.dwdObservations(q, date)),
    allertaLiguria: zone => run('allertaLiguria', TTL_MS.warnings, [zone], () => port.allertaLiguria(zone)),
    meteoalarmItaly: region => run('meteoalarmItaly', TTL_MS.warnings, [region], () => port.meteoalarmItaly(region)),
  };
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

/**
 * The forecast for one edition date. `from` is the edition's date (tomorrow's edition, prepared the
 * evening before, starts tomorrow). Never throws for a source failure: what failed is named instead.
 */
export async function buildGazetteWeather(deps: GazetteWeatherDeps, workspaceId: WorkspaceId, settings: GazetteSettings, from: LocalDate): Promise<GazetteWeatherResult> {
  const workspace = await deps.workspaces.findById(workspaceId);
  const place = workspace?.location ?? null;
  if (place === null) return { status: 'no_location' };
  const weatherSettings = settings.weather ?? DEFAULT_GAZETTE_WEATHER_SETTINGS;
  const plan = gazetteWeatherPlan(place, weatherSettings);
  const server = await deps.serverWeather.get();
  if (!server.enabled) return { status: 'unavailable', plan, failed: [], reason: 'weather_off' };
  const now = deps.clock.now();
  const query: GazettePlaceQuery = { latitude: place.latitude, longitude: place.longitude, elevation: place.elevation, timeZone: place.timeZone };
  const localToday = gazetteToday({ timeZone: place.timeZone as GazetteSettings['timeZone'] }, now);
  const offset = Math.max(0, daysBetween(localToday, from));
  const enabled = plan.sources.filter(source => source.enabled);
  const allowed = (provider: string) => provider === 'open-meteo' ? server.allowed.includes('OPEN_METEO') : provider === 'met-norway' ? server.allowed.includes('MET_NORWAY') : true;
  const failed: string[] = [];
  const skill = weatherSettings.learn ? await skillFactors(deps, workspaceId, place, from) : new Map<string, Partial<Record<GazetteSkillBucket, number>>>();
  const retrievedAt = now.toISOString();
  const series: GazetteSourceSeries[] = [];
  const add = (id: string, days: GazetteSourceDay[], note?: string) => {
    const source = enabled.find(item => item.id === id);
    if (!source || days.length === 0) return;
    const factors = skill.get(id) ?? {};
    const weights = Object.fromEntries(Object.entries(factors).map(([bucket, factor]) => [bucket, source.baseWeight * (factor ?? 1)]));
    series.push({ id, label: source.label, model: source.model, family: source.family, url: source.url, retrievedAt, weight: source.baseWeight, ...(Object.keys(weights).length > 0 ? { weights } : {}), days: days.filter(day => day.date >= from), ...(note ? { note } : {}) });
  };

  const openMeteo = enabled.filter(source => source.provider === 'open-meteo' && source.role === 'forecast');
  const tasks: Promise<void>[] = [];
  if (openMeteo.length > 0) {
    if (!allowed('open-meteo')) failed.push('Open-Meteo (off on this server)');
    else tasks.push(deps.sources.openMeteoModels(query, openMeteo.map(source => source.model), offset + GAZETTE_FORECAST_DAYS).then(
      result => { for (const source of openMeteo) { const days = result[source.model] ?? []; if (days.length === 0) failed.push(source.label); else add(source.id, days); } },
      () => { failed.push(...openMeteo.map(source => source.label)); },
    ));
  }
  if (enabled.some(source => source.id === 'met-norway')) {
    if (!allowed('met-norway')) failed.push('MET Norway (off on this server)');
    else tasks.push(deps.weather.forecast('MET_NORWAY', query).then(({ entry }) => {
      add('met-norway', entry.forecast.days.filter(day => day.partial !== true).map(day => ({ date: day.date, ...(day.max === undefined ? {} : { high: day.max }), ...(day.min === undefined ? {} : { low: day.min }), ...(day.precipitationSum === undefined ? {} : { precipitationMm: day.precipitationSum }), ...(day.windSpeedMax === undefined ? {} : { windKmh: day.windSpeedMax }), ...(day.condition === undefined ? {} : { condition: day.condition }) })));
    }, () => { failed.push('MET Norway'); }));
  }
  if (enabled.some(source => source.id === 'dwd-mosmix')) {
    tasks.push(deps.sources.mosmix(query, from, GAZETTE_FORECAST_DAYS).then(({ station, days }) => {
      // MOSMIX is a station forecast: moved to the place's height when the two differ noticeably.
      const gap = place.elevation !== null && station.elevationM !== null ? place.elevation - station.elevationM : 0;
      const shifted = Math.abs(gap) >= 50 && place.elevation !== null && station.elevationM !== null
        ? days.map(day => ({ ...day, ...(day.high === undefined ? {} : { high: adjustForElevation(day.high, station.elevationM as number, place.elevation as number) }), ...(day.low === undefined ? {} : { low: adjustForElevation(day.low, station.elevationM as number, place.elevation as number) }) }))
        : days;
      add('dwd-mosmix', shifted, `station ${station.name}, ${Math.round(station.distanceM / 1000)} km${station.elevationM === null ? '' : `, ${Math.round(station.elevationM)} m`}${shifted === days ? '' : `; temperatures moved to ${place.elevation} m`}`);
    }, () => { failed.push('DWD MOSMIX'); }));
  }
  const warnings: GazetteWarning[] = [];
  const warningSources: GazetteSource[] = [];
  const warn = (id: string, call: () => Promise<GazetteWarning[]>) => {
    const source = enabled.find(item => item.id === id);
    if (!source) return;
    tasks.push(call().then(list => { warnings.push(...list); warningSources.push({ name: source.label, url: source.url, retrievedAt, role: 'warnings' }); }, () => { failed.push(source.label); }));
  };
  warn('dwd-warnings', () => deps.sources.dwdWarnings(query));
  warn('meteoalarm-it', () => deps.sources.meteoalarmItaly('Liguria'));
  if (plan.alertZone !== null) warn('allerta-liguria', () => deps.sources.allertaLiguria(plan.alertZone as NonNullable<GazetteWeatherPlan['alertZone']>));
  await Promise.all(tasks);

  if (series.length === 0) return { status: 'unavailable', plan, failed, reason: 'sources' };
  const location = combineGazetteForecast({
    name: place.name, region: REGION_NAMES[plan.region] ?? '', today: from,
    place: { latitude: place.latitude, longitude: place.longitude, elevation: place.elevation, timeZone: place.timeZone },
    series, warnings: warnings.filter(w => w.date === null || w.date >= from), warningSources, references: plan.references, fetchedAt: retrievedAt, failed, days: GAZETTE_FORECAST_DAYS,
  });
  if (location.days.length === 0) return { status: 'unavailable', plan, failed, reason: 'sources' };
  await record(deps, workspaceId, place, from, series, now);
  return { status: 'ok', location, plan, failed };
}

async function record(deps: GazetteWeatherDeps, workspaceId: WorkspaceId, place: WeatherLocation, issuedOn: LocalDate, series: readonly GazetteSourceSeries[], now: Date) {
  const key = weatherLocationKey(place);
  const rows = series.flatMap(s => s.days.map(day => ({ sourceId: s.id, targetDate: day.date, lead: daysBetween(issuedOn, day.date), high: day.high ?? null, low: day.low ?? null, precipitationMm: gazettePrecipitationMm(day.precipitationMm) ?? null }))).filter(row => row.lead >= 0 && row.lead < 10);
  try { await deps.log.recordForecasts(workspaceId, key, issuedOn, rows, now); } catch { /* verification is optional: the forecast still stands */ }
}

/**
 * Verification (43.7): observed highs and lows of a nearby official station against what each source
 * forecast. Only DWD stations (Bright Sky) for now; a station too far away or at a different height
 * is not used. A few missing days are fetched per build — the cache and this bound keep it gentle.
 */
async function skillFactors(deps: GazetteWeatherDeps, workspaceId: WorkspaceId, place: WeatherLocation, from: LocalDate) {
  const key = weatherLocationKey(place);
  const since = addDays(from, -VERIFY_WINDOW_DAYS);
  const plan = gazetteWeatherPlan(place);
  try {
    if (plan.region === 'germany') {
      const missing = (await deps.log.unobservedDates(workspaceId, key, since, addDays(from, -1))).slice(-OBSERVATIONS_PER_BUILD);
      for (const date of missing) {
        let day: GazetteObservedDay | null = null;
        try { day = await deps.sources.dwdObservations({ latitude: place.latitude, longitude: place.longitude, elevation: place.elevation, timeZone: place.timeZone }, date); } catch { break; }
        if (day === null || day.station.distanceM > VERIFY_MAX_DISTANCE_M) continue;
        const gap = place.elevation !== null && day.station.elevationM !== null ? place.elevation - day.station.elevationM : 0;
        if (Math.abs(gap) > VERIFY_MAX_ELEVATION_GAP_M) continue;
        const move = (value: number | null) => value === null || gap === 0 || day.station.elevationM === null || place.elevation === null ? value : adjustForElevation(value, day.station.elevationM, place.elevation);
        await deps.log.recordObservation(workspaceId, key, { ...day, high: move(day.high), low: move(day.low) }, 'DWD (Bright Sky)', deps.clock.now());
      }
    }
    const skills = gazetteSourceSkill(await deps.log.pairs(workspaceId, key, since));
    const result = new Map<string, Partial<Record<GazetteSkillBucket, number>>>();
    for (const row of skills) if (row.factor !== 1) result.set(row.sourceId, { ...result.get(row.sourceId), [row.bucket]: row.factor });
    return result;
  } catch {
    return new Map<string, Partial<Record<GazetteSkillBucket, number>>>();
  }
}

/** The verification table for settings and MCP: per source and lead bucket, never more than was measured. */
export async function gazetteWeatherVerification(deps: GazetteWeatherDeps, workspaceId: WorkspaceId, place: WeatherLocation, today: LocalDate) {
  const key = weatherLocationKey(place);
  const since = addDays(today, -VERIFY_WINDOW_DAYS);
  const [pairs, stations] = await Promise.all([deps.log.pairs(workspaceId, key, since), deps.log.observations(workspaceId, key, since)]);
  return { since, buckets: GAZETTE_SKILL_BUCKETS.map(b => b.id), skills: gazetteSourceSkill(pairs), observedDays: stations.length, stations: [...new Map(stations.map(s => [s.station, s])).values()].slice(0, 5) };
}

/** The weather section VMN writes into an edition: the client's summary kept, everything else from the server. */
export function gazetteWeatherSection(sectionId: string, summary: string, result: GazetteWeatherResult): GazetteSectionContent {
  if (result.status === 'ok') return { sectionId, type: 'weather', summary, locations: [result.location], status: 'ok', generatedBy: 'vmn' };
  return { sectionId, type: 'weather', summary, locations: [], status: result.status, generatedBy: 'vmn' };
}

/**
 * Puts VMN's forecast into every enabled weather section of an edition (43.7). Today's and tomorrow's
 * editions get a fresh forecast; an older date keeps what its published edition already holds, so a
 * republished archive never gets a forecast for a day that has passed.
 */
export async function withGazetteWeather(deps: GazetteWeatherDeps | undefined, input: {
  readonly workspaceId: WorkspaceId; readonly settings: GazetteSettings; readonly content: GazetteEditionContent;
  readonly existing: GazetteEditionContent | undefined; readonly now: Date;
}): Promise<GazetteEditionContent> {
  const { settings, content } = input;
  if (deps === undefined || (settings.weather ?? DEFAULT_GAZETTE_WEATHER_SETTINGS).automatic === false) return content;
  const definitions = settings.sections.filter(section => section.type === 'weather' && section.enabled);
  if (definitions.length === 0) return content;
  const today = gazetteToday(settings, input.now);
  const fresh = content.date >= today;
  const result = fresh ? await buildGazetteWeather(deps, input.workspaceId, settings, content.date) : null;
  const sections = [...content.sections];
  for (const definition of definitions) {
    const index = sections.findIndex(section => section.sectionId === definition.id);
    const summary = index >= 0 ? sections[index]?.summary ?? '' : '';
    const kept = input.existing?.sections.find(section => section.sectionId === definition.id && section.type === 'weather');
    const next = result !== null ? gazetteWeatherSection(definition.id, summary, result) : kept ? { ...kept, summary } : gazetteWeatherSection(definition.id, summary, { status: 'unavailable', plan: null, failed: [], reason: 'sources' });
    if (index >= 0) sections[index] = next; else sections.push(next);
  }
  return { ...content, sections };
}
