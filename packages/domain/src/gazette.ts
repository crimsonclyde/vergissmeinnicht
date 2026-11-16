import { DomainValidationError } from './errors.ts';
import { addDays, localDateAt, parseLocalDate, parseLocalTime, parseTimeZone, type LocalDate, type TimeZoneName } from './schedule.ts';
import { BIDI_CONTROLS, CONTROL_CHARS } from './text.ts';
import { WEATHER_CONDITIONS, type WeatherCondition } from './weather.ts';
import { parseGazetteWeatherSettings, type GazetteWeatherSettings } from './gazette-weather.ts';

/**
 * The Daily Planet (section 43): one published daily edition per Workspace and local date, made of
 * configurable sections. Sections are data: a stable id, a renderer type and presentation settings kept
 * in the Workspace's Gazette settings. Edition content is structured JSON validated here; it never holds
 * HTML. Adding a topic is a new section of an existing type, never a code change.
 */

/** Renderer types. A new renderer is a code change; a new topic is not. */
export const GAZETTE_SECTION_TYPES = ['weather', 'articles', 'watchlist', 'rich'] as const;
export type GazetteSectionType = (typeof GAZETTE_SECTION_TYPES)[number];

/** Bundled icon keys a section may use (the web maps them to its icon set). */
export const GAZETTE_ICONS = ['weather', 'chip', 'map', 'globe', 'leaf', 'tag', 'news', 'book', 'star', 'heart', 'home', 'flask', 'shield', 'music', 'film', 'ball', 'plane', 'coins'] as const;
export type GazetteIcon = (typeof GAZETTE_ICONS)[number];

export const GAZETTE_SEVERITIES = ['unknown', 'low', 'medium', 'high', 'critical'] as const;
export const GAZETTE_VERIFICATION = ['unverified', 'checking', 'not_affected', 'affected'] as const;
export const GAZETTE_WARNING_LEVELS = ['info', 'yellow', 'orange', 'red'] as const;
export const GAZETTE_RELEVANCE = ['low', 'normal', 'high'] as const;
export const GAZETTE_PRICE_CHANGES = ['new', 'down', 'up', 'same'] as const;
/** 43.7: `no_location` = the Workspace has no place set; `unavailable` = no source answered. Missing = `ok` (older editions). */
export const GAZETTE_WEATHER_STATUS = ['ok', 'no_location', 'unavailable'] as const;
export const GAZETTE_EDITION_STATES = ['DRAFT', 'PUBLISHED'] as const;
export type GazetteEditionState = (typeof GAZETTE_EDITION_STATES)[number];

export const GAZETTE_LIMITS = Object.freeze({
  sections: 24,
  articlesPerSection: 30,
  locations: 6,
  localNotices: 20,
  days: 10,
  sources: 6,
  watchItems: 40,
  tables: 6,
  tableColumns: 8,
  tableRows: 60,
  retentionMin: 1,
  retentionMax: 31,
  /** Stored edition JSON, bytes: bounded in the database as well. */
  contentBytes: 600_000,
});
export const DEFAULT_GAZETTE_RETENTION_DAYS = 7;
export const DEFAULT_GAZETTE_PUBLISH_TIME = '06:45';

export const GAZETTE_SOURCE_ROLES = ['forecast', 'warnings', 'observations', 'reference'] as const;
export interface GazetteSource {
  readonly name: string;
  readonly url: string | null;
  /** Weather (43.7): the forecast model behind a value, as the provider names it (e.g. `icon_d2`). */
  readonly model?: string;
  /** When VMN retrieved it (ISO 8601). */
  readonly retrievedAt?: string;
  readonly role?: (typeof GAZETTE_SOURCE_ROLES)[number];
}
export interface GazetteSectionDefinition {
  readonly id: string;
  readonly type: GazetteSectionType;
  readonly title: string;
  readonly subtitle: string;
  readonly icon: GazetteIcon;
  readonly enabled: boolean;
  /** BCP 47 primary language of the content, e.g. `it`. */
  readonly language: string;
  /** Headlines of this section may appear on the Dashboard card. */
  readonly dashboard: boolean;
  /** Folded unless a person opened it. */
  readonly collapsed: boolean;
  /** Free-form brief for whoever writes the edition (topics, focus); shown to editors and MCP clients, never rendered as HTML. */
  readonly brief: string;
  readonly sources: readonly GazetteSource[];
}
export interface GazetteSettings {
  readonly version: 1;
  readonly title: string;
  readonly retentionDays: number;
  readonly timeZone: TimeZoneName;
  readonly publishTime: string;
  readonly dashboardHeadlines: number;
  readonly images: boolean;
  readonly watchlist?: GazetteWatchSettings;
  /** 43.7: how VMN makes the forecast for the Workspace place. Missing = the defaults. */
  readonly weather?: GazetteWeatherSettings;
  readonly sections: readonly GazetteSectionDefinition[];
}

export interface GazetteSecurityNote {
  readonly package: string;
  readonly identifier: string;
  readonly advisoryUrl: string | null;
  readonly severity: (typeof GAZETTE_SEVERITIES)[number];
  readonly relevance: string;
  readonly verification: (typeof GAZETTE_VERIFICATION)[number];
  readonly remediationPrompt: string;
}
export interface GazetteArticle {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly url: string;
  readonly source: string;
  readonly publishedAt: string;
  readonly language: string | null;
  readonly topic: string | null;
  readonly relevance: (typeof GAZETTE_RELEVANCE)[number];
  readonly security: GazetteSecurityNote | null;
}
export interface GazetteRange { readonly min: number; readonly max: number }
export interface GazetteForecastDay {
  readonly date: LocalDate;
  readonly condition: WeatherCondition;
  readonly high: number | null;
  readonly low: number | null;
  /** One value when sources agree, a range when they do not; never invented. */
  readonly precipitationMm: number | GazetteRange | null;
  readonly windKmh: number | null;
  readonly gustKmh: number | null;
  readonly disagreement: boolean;
  /** 43.7, optional: the spread across independent model families when they disagree. */
  readonly highRange?: GazetteRange;
  readonly lowRange?: GazetteRange;
  /** Highest chance of precipitation in %, where a source gives one. */
  readonly precipitationProbability?: number | null;
  /** How far the sources agree and how far ahead the day is; days 4–7 are never `high`. */
  readonly confidence?: (typeof GAZETTE_CONFIDENCE)[number];
  /** One plain sentence such as "Models disagree on accumulation: 8–22 mm." */
  readonly note?: string;
}
export const GAZETTE_CONFIDENCE = ['high', 'medium', 'low'] as const;
export interface GazetteComparison {
  readonly metric: 'precipitation' | 'high' | 'low' | 'wind';
  readonly rows: readonly { readonly source: string; readonly values: readonly (number | null)[] }[];
}
export interface GazetteWarning {
  readonly level: (typeof GAZETTE_WARNING_LEVELS)[number];
  readonly text: string;
  readonly source: string;
  readonly url: string | null;
  readonly date: LocalDate | null;
  readonly onset?: string | null;
  readonly expires?: string | null;
  /** Short hazard key from the issuer (`thunderstorm`, `rain`, `wind`, `hydro`, `snow`, `frost`, …). */
  readonly kind?: string;
}
/** The exact place a forecast was made for (43.7): kept with the edition, so an archived edition keeps its place. */
export interface GazetteForecastPlace { readonly latitude: number; readonly longitude: number; readonly elevation: number | null; readonly timeZone: string }
export interface GazetteModelDay {
  readonly date: LocalDate;
  readonly high: number | null;
  readonly low: number | null;
  readonly precipitationMm: number | null;
  readonly gustKmh: number | null;
  readonly condition: WeatherCondition;
}
/** One source's own days, as retrieved (43.7): shown in the comparison, never merged silently. */
export interface GazetteModelForecast {
  readonly source: string;
  readonly model: string;
  /** Sources sharing a family share an underlying model and count as one voice. */
  readonly family: string;
  readonly retrievedAt: string;
  readonly weight: number;
  readonly days: readonly GazetteModelDay[];
}
export interface GazetteLocationForecast {
  readonly name: string;
  readonly region: string;
  readonly days: readonly GazetteForecastDay[];
  readonly comparison: GazetteComparison | null;
  readonly warnings: readonly GazetteWarning[];
  readonly sources: readonly GazetteSource[];
  readonly fetchedAt: string | null;
  readonly note: string;
  readonly place?: GazetteForecastPlace;
  readonly models?: readonly GazetteModelForecast[];
}
export interface GazetteWatchItem {
  readonly id: string;
  readonly name: string;
  readonly variant: string;
  readonly condition: 'new' | 'refurbished' | 'used';
  readonly market: string;
  readonly shop: string;
  readonly url: string | null;
  readonly currency: string;
  readonly price: number | null;
  readonly typical: number | null;
  readonly target: number | null;
  readonly change: (typeof GAZETTE_PRICE_CHANGES)[number] | null;
  readonly discountThreshold?: number | null;
  /** True when `price` was verified at `checkedAt`; false keeps the last verified observation, labelled as such. */
  readonly verified: boolean;
  readonly checkedAt: string | null;
  readonly history: readonly number[];
}
export interface GazetteTable { readonly caption: string; readonly columns: readonly string[]; readonly rows: readonly (readonly string[])[] }

interface SectionBase { readonly sectionId: string; readonly summary: string }
export type GazetteSectionContent =
  | (SectionBase & { readonly type: 'articles'; readonly items: readonly GazetteArticle[] })
  | (SectionBase & { readonly type: 'weather'; readonly locations: readonly GazetteLocationForecast[]; readonly status?: (typeof GAZETTE_WEATHER_STATUS)[number]; readonly generatedBy?: 'vmn' | 'client' })
  | (SectionBase & { readonly type: 'watchlist'; readonly items: readonly GazetteWatchItem[] })
  | (SectionBase & { readonly type: 'rich'; readonly body: string; readonly tables: readonly GazetteTable[] });

export interface GazetteLocalNotice {
  readonly kind: 'civil_protection' | 'road_closure';
  readonly place: string;
  readonly text: string;
  readonly source: string;
  readonly url: string;
  readonly checkedAt: string;
}

export interface GazetteEditionContent {
  readonly version: 1;
  readonly date: LocalDate;
  readonly title: string;
  /** One line for the Dashboard card. */
  readonly greeting: string;
  /** Markdown, no HTML. */
  readonly intro: string;
  readonly sections: readonly GazetteSectionContent[];
  readonly localNotices?: readonly GazetteLocalNotice[];
}

export interface GazetteEditionSummary {
  readonly id: string;
  readonly date: LocalDate;
  readonly state: GazetteEditionState;
  readonly title: string;
  readonly revision: number;
  readonly publishedAt: Date | null;
  readonly updatedAt: Date;
  readonly updatedBy: string;
}
export interface GazetteEdition extends GazetteEditionSummary { readonly content: GazetteEditionContent; readonly header?: import('./gazette-header.ts').GazetteHeaderImage | null }

// ---------------------------------------------------------------------------------------------------
// Validation helpers. Errors carry a path (`sections[2].items[0].url`) and never echo input.

const fail = (path: string, code = 'invalid_gazette'): never => { throw new DomainValidationError(path, code, 'Invalid Gazette content'); };

function record(value: unknown, path: string, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(path);
  const row = value as Record<string, unknown>;
  for (const key of Object.keys(row)) if (!required.includes(key) && !optional.includes(key)) fail(`${path}.${key}`, 'gazette_unknown_field');
  for (const key of required) if (!Object.hasOwn(row, key)) fail(`${path}.${key}`, 'gazette_missing_field');
  return row;
}
function str(value: unknown, path: string, max: number, options: { multiline?: boolean; required?: boolean } = {}): string {
  if (value === undefined || value === null) return options.required ? fail(path, 'gazette_missing_field') : '';
  if (typeof value !== 'string' || [...value].length > max || BIDI_CONTROLS.test(value)) return fail(path);
  const checked = options.multiline ? value.replace(/\r\n?/g, '\n') : value;
  if (CONTROL_CHARS.test(options.multiline ? checked.replace(/[\n\t]/g, '') : checked)) return fail(path);
  const result = options.multiline ? checked.trim() : checked.trim().normalize('NFC');
  if (options.required && !result) fail(path, 'gazette_missing_field');
  return result;
}
/** Markdown text: no raw HTML tags. The renderer never interprets HTML; refusing it keeps payloads honest. */
function markdown(value: unknown, path: string, max: number): string {
  const text = str(value, path, max, { multiline: true });
  // Anything a browser would start a tag, comment or declaration with (`<` then a letter, `/`, `!` or `?`). One
  // linear scan: no nested quantifiers, so no slow backtracking on hostile input.
  if (/<[a-z/!?]/i.test(text)) fail(path, 'gazette_html_not_allowed');
  return text;
}
function list(value: unknown, path: string, max: number, min = 0): unknown[] {
  if (value === undefined) return min > 0 ? fail(path, 'gazette_missing_field') : [];
  if (!Array.isArray(value) || value.length < min || value.length > max) return fail(path, 'gazette_list_size');
  return value;
}
function oneOf<T extends string>(value: unknown, path: string, allowed: readonly T[], fallback?: T): T {
  if (value === undefined && fallback !== undefined) return fallback;
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : fail(path);
}
function bool(value: unknown, path: string, fallback?: boolean): boolean {
  if (value === undefined && fallback !== undefined) return fallback;
  return typeof value === 'boolean' ? value : fail(path);
}
function num(value: unknown, path: string, min: number, max: number, nullable = true): number | null {
  if ((value === null || value === undefined) && nullable) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return fail(path);
  return Math.round(value * 100) / 100;
}
/** https only (http for sources that have nothing else would leak the reader's IP over plain text). */
export function gazetteUrl(value: unknown, path: string, required = false): string | null {
  if ((value === null || value === undefined || value === '') && !required) return null;
  if (typeof value !== 'string' || value.length > 2048 || /\s/.test(value)) return fail(path, 'gazette_invalid_url');
  // No URL parser here (the domain has no runtime library): a strict pattern instead. https only, a dotted
  // host name, no user info, no backslashes or control characters.
  const match = /^https:\/\/([^/?#]+)([/?#][^\s]*)?$/i.exec(value);
  const authority = match?.[1] ?? '';
  if (!match || value.includes('\\') || CONTROL_CHARS.test(value) || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?$/i.test(authority)) return fail(path, 'gazette_invalid_url');
  return value;
}
function utf8Length(text: string): number {
  let bytes = 0;
  for (const char of text) { const code = char.codePointAt(0) ?? 0; bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4; }
  return bytes;
}
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ARTICLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const LANGUAGE = /^[a-z]{2,3}(-[A-Z]{2})?$/;
function sectionId(value: unknown, path: string): string {
  return typeof value === 'string' && ID.test(value) ? value : fail(path, 'gazette_invalid_id');
}
function language(value: unknown, path: string, nullable = false): string | null {
  if ((value === undefined || value === null) && nullable) return null;
  return typeof value === 'string' && LANGUAGE.test(value) ? value : fail(path);
}
function instant(value: unknown, path: string, nullable = false): string | null {
  if ((value === undefined || value === null) && nullable) return null;
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) return fail(path, 'gazette_invalid_time');
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? fail(path, 'gazette_invalid_time') : at.toISOString();
}
function localDate(value: unknown, path: string): LocalDate {
  try { return parseLocalDate(typeof value === 'string' ? value : ''); } catch { return fail(path, 'gazette_invalid_date'); }
}
function sources(value: unknown, path: string, max: number = GAZETTE_LIMITS.sources): GazetteSource[] {
  return list(value, path, max).map((item, i) => {
    const row = record(item, `${path}[${i}]`, ['name'], ['url', 'model', 'retrievedAt', 'role']);
    const model = row['model'] === undefined ? undefined : str(row['model'], `${path}[${i}].model`, 60);
    const retrievedAt = row['retrievedAt'] === undefined || row['retrievedAt'] === null ? undefined : instant(row['retrievedAt'], `${path}[${i}].retrievedAt`) as string;
    return {
      name: str(row['name'], `${path}[${i}].name`, 80, { required: true }), url: gazetteUrl(row['url'], `${path}[${i}].url`),
      ...(model ? { model } : {}), ...(retrievedAt ? { retrievedAt } : {}),
      ...(row['role'] === undefined ? {} : { role: oneOf(row['role'], `${path}[${i}].role`, GAZETTE_SOURCE_ROLES) }),
    };
  });
}

// ---------------------------------------------------------------------------------------------------
// Settings

/** The weather brief since 43.7: VMN writes the forecast; a client only adds a short summary. */
export const GAZETTE_WEATHER_BRIEF = 'VMN fills this section on the server from the Workspace location, comparing several sources and official warnings. Write only a short summary from get_gazette_weather; never add places, values or warnings yourself.';
/** The brief every Workspace got before 43.7; migration 0081 replaces exactly this text. */
export const GAZETTE_WEATHER_BRIEF_V1 = 'Triora (Imperia, Liguria) and Göggenhofen (Bavaria): seven days, up to three sources compared, disagreements as ranges, official warnings (ARPAL for Liguria). Name every source; never invent values.';

export function defaultGazetteSections(): GazetteSectionDefinition[] {
  const section = (id: string, type: GazetteSectionType, title: string, subtitle: string, icon: GazetteIcon, language: string, brief: string): GazetteSectionDefinition =>
    ({ id, type, title, subtitle, icon, enabled: true, language, dashboard: type !== 'weather', collapsed: false, brief, sources: [] });
  return [
    section('weather', 'weather', 'Weather', 'Seven days, compared across sources', 'weather', 'en', GAZETTE_WEATHER_BRIEF),
    section('it-open-source', 'articles', 'IT & Open Source', 'Linux, self-hosting, containers, privacy, security', 'chip', 'en', 'Linux, open source, AI, self-hosting, containers, privacy and software security. Mark possible VMN relevance only after checking the actual dependencies.'),
    section('liguria', 'articles', 'Notizie dalla Liguria', 'Triora, Valle Argentina, Imperia, Sanremo', 'map', 'it', 'Triora, Valle Argentina, Imperia, Sanremo, Liguria and important Italian national news. In Italian.'),
    section('europe-world', 'articles', 'Europe & World', 'Europe first, the world in brief', 'globe', 'en', 'Brief, source-backed coverage with Europe as the focus, plus important international developments.'),
    section('good-news', 'articles', 'Good News', 'Verified constructive developments', 'leaf', 'en', 'Verified constructive developments in science, conservation, technology, medicine or society.'),
    section('watchlist', 'watchlist', 'Watchlist', 'Reference prices and checked offers', 'tag', 'en', 'Use structured products and keep exact variants. For a reference-only product supply its reference and omit the live price, change and checked time. Record live prices only when verified for the specified market and variant.'),
  ];
}

export function defaultGazetteSettings(timeZone: TimeZoneName | null): GazetteSettings {
  return { version: 1, title: 'The Daily Planet', retentionDays: DEFAULT_GAZETTE_RETENTION_DAYS, timeZone: timeZone ?? ('UTC' as TimeZoneName), publishTime: DEFAULT_GAZETTE_PUBLISH_TIME, dashboardHeadlines: 4, images: true, sections: defaultGazetteSections() };
}

export function parseGazetteSettings(value: unknown): GazetteSettings {
  const row = record(value, 'settings', ['version', 'title', 'retentionDays', 'timeZone', 'publishTime', 'dashboardHeadlines', 'images', 'sections'], ['watchlist', 'weather']);
  if (row['version'] !== 1) fail('settings.version');
  const retention = row['retentionDays'];
  if (!Number.isInteger(retention) || Number(retention) < GAZETTE_LIMITS.retentionMin || Number(retention) > GAZETTE_LIMITS.retentionMax) fail('settings.retentionDays');
  let timeZone: TimeZoneName;
  try { timeZone = parseTimeZone(typeof row['timeZone'] === 'string' ? row['timeZone'] : ''); } catch { return fail('settings.timeZone'); }
  let publishTime: string;
  try { publishTime = parseLocalTime(typeof row['publishTime'] === 'string' ? row['publishTime'] : '', 'publishTime'); } catch { return fail('settings.publishTime'); }
  const headlines = row['dashboardHeadlines'];
  if (!Number.isInteger(headlines) || Number(headlines) < 0 || Number(headlines) > 6) fail('settings.dashboardHeadlines');
  const ids = new Set<string>();
  const sections = list(row['sections'], 'settings.sections', GAZETTE_LIMITS.sections).map((item, i): GazetteSectionDefinition => {
    const path = `settings.sections[${i}]`;
    const s = record(item, path, ['id', 'type', 'title'], ['subtitle', 'icon', 'enabled', 'language', 'dashboard', 'collapsed', 'brief', 'sources']);
    const id = sectionId(s['id'], `${path}.id`);
    if (ids.has(id)) fail(`${path}.id`, 'gazette_duplicate_id');
    ids.add(id);
    return {
      id, type: oneOf(s['type'], `${path}.type`, GAZETTE_SECTION_TYPES), title: str(s['title'], `${path}.title`, 60, { required: true }),
      subtitle: str(s['subtitle'], `${path}.subtitle`, 120), icon: oneOf(s['icon'], `${path}.icon`, GAZETTE_ICONS, 'news'),
      enabled: bool(s['enabled'], `${path}.enabled`, true), language: language(s['language'] ?? 'en', `${path}.language`) as string,
      dashboard: bool(s['dashboard'], `${path}.dashboard`, true), collapsed: bool(s['collapsed'], `${path}.collapsed`, false),
      brief: str(s['brief'], `${path}.brief`, 1000, { multiline: true }), sources: sources(s['sources'], `${path}.sources`, 20),
    };
  });
  return { version: 1, title: str(row['title'], 'settings.title', 60, { required: true }), retentionDays: Number(retention), timeZone, publishTime, dashboardHeadlines: Number(headlines), images: bool(row['images'], 'settings.images'), sections, ...(row['watchlist'] === undefined ? {} : { watchlist: parseWatchSettings(row['watchlist']) }), ...(row['weather'] === undefined ? {} : { weather: parseGazetteWeatherSettings(row['weather']) }) };
}

// ---------------------------------------------------------------------------------------------------
// Edition content

function article(value: unknown, path: string): GazetteArticle {
  const row = record(value, path, ['id', 'title', 'url', 'source', 'publishedAt'], ['summary', 'language', 'topic', 'relevance', 'security']);
  const id = typeof row['id'] === 'string' && ARTICLE_ID.test(row['id']) ? row['id'] : fail(`${path}.id`, 'gazette_invalid_id');
  let security: GazetteSecurityNote | null = null;
  if (row['security'] !== undefined && row['security'] !== null) {
    const s = record(row['security'], `${path}.security`, ['identifier', 'severity', 'verification'], ['package', 'advisoryUrl', 'relevance', 'remediationPrompt']);
    const identifier = typeof s['identifier'] === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(s['identifier']) ? s['identifier'] : fail(`${path}.security.identifier`);
    security = {
      package: str(s['package'], `${path}.security.package`, 120), identifier, advisoryUrl: gazetteUrl(s['advisoryUrl'], `${path}.security.advisoryUrl`),
      severity: oneOf(s['severity'], `${path}.security.severity`, GAZETTE_SEVERITIES), relevance: str(s['relevance'], `${path}.security.relevance`, 400, { multiline: true }),
      verification: oneOf(s['verification'], `${path}.security.verification`, GAZETTE_VERIFICATION), remediationPrompt: str(s['remediationPrompt'], `${path}.security.remediationPrompt`, 4000, { multiline: true }),
    };
  }
  return {
    id, title: str(row['title'], `${path}.title`, 200, { required: true }), summary: markdown(row['summary'], `${path}.summary`, 1500),
    url: gazetteUrl(row['url'], `${path}.url`, true) as string, source: str(row['source'], `${path}.source`, 80, { required: true }),
    publishedAt: instant(row['publishedAt'], `${path}.publishedAt`) as string, language: language(row['language'], `${path}.language`, true),
    topic: str(row['topic'], `${path}.topic`, 40) || null, relevance: oneOf(row['relevance'], `${path}.relevance`, GAZETTE_RELEVANCE, 'normal'), security,
  };
}

function forecastDay(value: unknown, path: string): GazetteForecastDay {
  const row = record(value, path, ['date', 'condition'], ['high', 'low', 'precipitationMm', 'windKmh', 'gustKmh', 'disagreement', 'highRange', 'lowRange', 'precipitationProbability', 'confidence', 'note']);
  let precipitation: number | GazetteRange | null;
  const raw = row['precipitationMm'];
  if (raw && typeof raw === 'object') {
    const range = record(raw, `${path}.precipitationMm`, ['min', 'max']);
    const min = num(range['min'], `${path}.precipitationMm.min`, 0, 2000, false) as number; const max = num(range['max'], `${path}.precipitationMm.max`, 0, 2000, false) as number;
    if (min > max) fail(`${path}.precipitationMm`);
    precipitation = min === max ? min : { min, max };
  } else precipitation = num(raw, `${path}.precipitationMm`, 0, 2000);
  const high = num(row['high'], `${path}.high`, -90, 60); const low = num(row['low'], `${path}.low`, -90, 60);
  if (high !== null && low !== null && low > high) fail(`${path}.low`);
  return {
    date: localDate(row['date'], `${path}.date`), condition: oneOf(row['condition'], `${path}.condition`, WEATHER_CONDITIONS), high, low, precipitationMm: precipitation,
    windKmh: num(row['windKmh'], `${path}.windKmh`, 0, 500), gustKmh: num(row['gustKmh'], `${path}.gustKmh`, 0, 500),
    disagreement: bool(row['disagreement'], `${path}.disagreement`, typeof precipitation === 'object' && precipitation !== null),
    ...optionalRange(row['highRange'], `${path}.highRange`, 'highRange'), ...optionalRange(row['lowRange'], `${path}.lowRange`, 'lowRange'),
    ...(row['precipitationProbability'] === undefined ? {} : { precipitationProbability: num(row['precipitationProbability'], `${path}.precipitationProbability`, 0, 100) }),
    ...(row['confidence'] === undefined ? {} : { confidence: oneOf(row['confidence'], `${path}.confidence`, GAZETTE_CONFIDENCE) }),
    ...(row['note'] === undefined ? {} : { note: str(row['note'], `${path}.note`, 200) }),
  };
}

function optionalRange<K extends string>(value: unknown, path: string, key: K): { [P in K]?: GazetteRange } {
  if (value === undefined || value === null) return {};
  const range = record(value, path, ['min', 'max']);
  const min = num(range['min'], `${path}.min`, -90, 60, false) as number; const max = num(range['max'], `${path}.max`, -90, 60, false) as number;
  if (min > max) fail(path);
  return { [key]: { min, max } } as { [P in K]?: GazetteRange };
}

function modelForecast(value: unknown, path: string, dates: ReadonlySet<string>): GazetteModelForecast {
  const row = record(value, path, ['source', 'model', 'family', 'retrievedAt', 'days'], ['weight']);
  const days = list(row['days'], `${path}.days`, GAZETTE_LIMITS.days).map((item, i): GazetteModelDay => {
    const p = `${path}.days[${i}]`; const d = record(item, p, ['date', 'condition'], ['high', 'low', 'precipitationMm', 'gustKmh']);
    const date = localDate(d['date'], `${p}.date`);
    if (!dates.has(date)) fail(`${p}.date`, 'gazette_unknown_day');
    return { date, condition: oneOf(d['condition'], `${p}.condition`, WEATHER_CONDITIONS), high: num(d['high'], `${p}.high`, -90, 60), low: num(d['low'], `${p}.low`, -90, 60), precipitationMm: num(d['precipitationMm'], `${p}.precipitationMm`, 0, 2000), gustKmh: num(d['gustKmh'], `${p}.gustKmh`, 0, 500) };
  });
  const id = (v: unknown, p: string) => typeof v === 'string' && /^[a-z0-9][a-z0-9_.-]{0,59}$/.test(v) ? v : fail(p);
  return { source: str(row['source'], `${path}.source`, 80, { required: true }), model: id(row['model'], `${path}.model`), family: id(row['family'], `${path}.family`), retrievedAt: instant(row['retrievedAt'], `${path}.retrievedAt`) as string, weight: num(row['weight'], `${path}.weight`, 0, 10) ?? 1, days };
}

function location(value: unknown, path: string): GazetteLocationForecast {
  const row = record(value, path, ['name', 'days', 'sources'], ['region', 'comparison', 'warnings', 'fetchedAt', 'note', 'place', 'models']);
  const days = list(row['days'], `${path}.days`, GAZETTE_LIMITS.days, 1).map((day, i) => forecastDay(day, `${path}.days[${i}]`));
  for (let i = 1; i < days.length; i++) if ((days[i] as GazetteForecastDay).date <= (days[i - 1] as GazetteForecastDay).date) fail(`${path}.days[${i}].date`, 'gazette_days_out_of_order');
  let comparison: GazetteComparison | null = null;
  if (row['comparison'] !== undefined && row['comparison'] !== null) {
    const c = record(row['comparison'], `${path}.comparison`, ['metric', 'rows']);
    comparison = {
      metric: oneOf(c['metric'], `${path}.comparison.metric`, ['precipitation', 'high', 'low', 'wind'] as const),
      rows: list(c['rows'], `${path}.comparison.rows`, 6, 2).map((r, i) => {
        const cr = record(r, `${path}.comparison.rows[${i}]`, ['source', 'values']);
        const values = list(cr['values'], `${path}.comparison.rows[${i}].values`, days.length, days.length).map((v, j) => num(v, `${path}.comparison.rows[${i}].values[${j}]`, -500, 2000));
        return { source: str(cr['source'], `${path}.comparison.rows[${i}].source`, 80, { required: true }), values };
      }),
    };
  }
  const warnings = list(row['warnings'], `${path}.warnings`, 10).map((w, i) => {
    const p = `${path}.warnings[${i}]`; const wr = record(w, p, ['level', 'text', 'source'], ['url', 'date', 'onset', 'expires', 'kind']);
    return {
      level: oneOf(wr['level'], `${p}.level`, GAZETTE_WARNING_LEVELS), text: str(wr['text'], `${p}.text`, 300, { required: true }), source: str(wr['source'], `${p}.source`, 80, { required: true }), url: gazetteUrl(wr['url'], `${p}.url`), date: wr['date'] === undefined || wr['date'] === null ? null : localDate(wr['date'], `${p}.date`),
      ...(wr['onset'] === undefined ? {} : { onset: instant(wr['onset'], `${p}.onset`, true) }), ...(wr['expires'] === undefined ? {} : { expires: instant(wr['expires'], `${p}.expires`, true) }),
      ...(wr['kind'] === undefined ? {} : { kind: typeof wr['kind'] === 'string' && /^[a-z][a-z-]{0,23}$/.test(wr['kind']) ? wr['kind'] : fail(`${p}.kind`) }),
    };
  });
  const named = sources(row['sources'], `${path}.sources`, 12);
  if (named.length === 0) fail(`${path}.sources`, 'gazette_source_required');
  let place: GazetteForecastPlace | undefined;
  if (row['place'] !== undefined && row['place'] !== null) {
    const pl = record(row['place'], `${path}.place`, ['latitude', 'longitude', 'timeZone'], ['elevation']);
    let timeZone: string;
    try { timeZone = parseTimeZone(typeof pl['timeZone'] === 'string' ? pl['timeZone'] : ''); } catch { return fail(`${path}.place.timeZone`); }
    place = { latitude: num(pl['latitude'], `${path}.place.latitude`, -90, 90, false) as number, longitude: num(pl['longitude'], `${path}.place.longitude`, -180, 180, false) as number, elevation: num(pl['elevation'], `${path}.place.elevation`, -500, 9000), timeZone };
  }
  const dates = new Set(days.map(day => day.date));
  const models = row['models'] === undefined ? undefined : list(row['models'], `${path}.models`, 8).map((m, i) => modelForecast(m, `${path}.models[${i}]`, dates));
  return {
    name: str(row['name'], `${path}.name`, 80, { required: true }), region: str(row['region'], `${path}.region`, 120), days, comparison, warnings, sources: named,
    fetchedAt: instant(row['fetchedAt'], `${path}.fetchedAt`, true), note: str(row['note'], `${path}.note`, 300),
    ...(place ? { place } : {}), ...(models ? { models } : {}),
  };
}

function watchItem(value: unknown, path: string): GazetteWatchItem {
  const row = record(value, path, ['id', 'name', 'currency'], ['change', 'verified', 'discountThreshold', 'variant', 'condition', 'market', 'shop', 'url', 'price', 'typical', 'target', 'checkedAt', 'history']);
  const currency = typeof row['currency'] === 'string' && /^[A-Z]{3}$/.test(row['currency']) ? row['currency'] : fail(`${path}.currency`);
  const verified = bool(row['verified'], `${path}.verified`, false);
  const checkedAt = instant(row['checkedAt'], `${path}.checkedAt`, true);
  const price = num(row['price'], `${path}.price`, 0, 10_000_000);
  if (price !== null && checkedAt === null) fail(`${path}.checkedAt`, 'gazette_missing_field');
  return {
    id: typeof row['id'] === 'string' && ARTICLE_ID.test(row['id']) ? row['id'] : fail(`${path}.id`, 'gazette_invalid_id'),
    name: str(row['name'], `${path}.name`, 120, { required: true }), variant: str(row['variant'], `${path}.variant`, 120),
    condition: oneOf(row['condition'], `${path}.condition`, ['new', 'refurbished', 'used'] as const, 'new'),
    market: str(row['market'], `${path}.market`, 8), shop: str(row['shop'], `${path}.shop`, 80), url: gazetteUrl(row['url'], `${path}.url`), currency,
    price, typical: num(row['typical'], `${path}.typical`, 0, 10_000_000), target: num(row['target'], `${path}.target`, 0, 10_000_000),
    change: row['change'] == null ? null : oneOf(row['change'], `${path}.change`, GAZETTE_PRICE_CHANGES), verified, checkedAt,
    ...(row['discountThreshold'] === undefined ? {} : { discountThreshold: num(row['discountThreshold'], `${path}.discountThreshold`, 2, 100) }),
    history: list(row['history'], `${path}.history`, 90).map((v, i) => num(v, `${path}.history[${i}]`, 0, 10_000_000, false) as number),
  };
}

function table(value: unknown, path: string): GazetteTable {
  const row = record(value, path, ['columns', 'rows'], ['caption']);
  const columns = list(row['columns'], `${path}.columns`, GAZETTE_LIMITS.tableColumns, 1).map((c, i) => str(c, `${path}.columns[${i}]`, 60));
  const rows = list(row['rows'], `${path}.rows`, GAZETTE_LIMITS.tableRows).map((r, i) => list(r, `${path}.rows[${i}]`, columns.length, columns.length).map((c, j) => str(c, `${path}.rows[${i}][${j}]`, 200)));
  return { caption: str(row['caption'], `${path}.caption`, 160), columns, rows };
}

/**
 * Validates a complete edition against the Workspace's section definitions: every section must name a
 * configured section of the same type (unknown ids and types are refused, never guessed); article ids and
 * source URLs are unique within the edition (one story, one place).
 */
export function parseGazetteEdition(value: unknown, definitions: readonly GazetteSectionDefinition[]): GazetteEditionContent {
  const row = record(value, 'edition', ['version', 'date', 'sections'], ['title', 'greeting', 'intro', 'localNotices']);
  if (row['version'] !== 1) fail('edition.version', 'gazette_unsupported_version');
  const byId = new Map(definitions.map(d => [d.id, d]));
  const seenSections = new Set<string>(); const seenArticles = new Set<string>(); const seenUrls = new Set<string>();
  const sections = list(row['sections'], 'edition.sections', GAZETTE_LIMITS.sections, 1).map((item, i): GazetteSectionContent => {
    const path = `edition.sections[${i}]`;
    const head = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : fail(path);
    const id = sectionId(head['sectionId'], `${path}.sectionId`);
    const definition = byId.get(id) ?? fail(`${path}.sectionId`, 'gazette_unknown_section');
    if (seenSections.has(id)) fail(`${path}.sectionId`, 'gazette_duplicate_section');
    seenSections.add(id);
    const type = oneOf(head['type'], `${path}.type`, GAZETTE_SECTION_TYPES);
    if (type !== definition.type) fail(`${path}.type`, 'gazette_section_type_mismatch');
    switch (type) {
      case 'articles': {
        const s = record(item, path, ['sectionId', 'type', 'items'], ['summary']);
        const items = list(s['items'], `${path}.items`, GAZETTE_LIMITS.articlesPerSection).map((a, j) => {
          const parsed = article(a, `${path}.items[${j}]`);
          if (seenArticles.has(parsed.id)) fail(`${path}.items[${j}].id`, 'gazette_duplicate_article');
          if (seenUrls.has(parsed.url)) fail(`${path}.items[${j}].url`, 'gazette_duplicate_article');
          seenArticles.add(parsed.id); seenUrls.add(parsed.url);
          return parsed;
        });
        return { sectionId: id, type, summary: markdown(s['summary'], `${path}.summary`, 1500), items };
      }
      case 'weather': {
        const s = record(item, path, ['sectionId', 'type'], ['locations', 'summary', 'status', 'generatedBy']);
        let status = s['status'] === undefined ? undefined : oneOf(s['status'], `${path}.status`, GAZETTE_WEATHER_STATUS);
        // 43.7: a client may send only the summary (VMN fills the places). Without places the section says so
        // (`unavailable`) instead of looking like an empty forecast; with places it cannot claim to have none.
        const locations = list(s['locations'], `${path}.locations`, GAZETTE_LIMITS.locations).map((l, j) => location(l, `${path}.locations[${j}]`));
        if (locations.length === 0 && (status === undefined || status === 'ok')) status = 'unavailable';
        if (status !== undefined && status !== 'ok' && locations.length > 0) fail(`${path}.locations`, 'gazette_list_size');
        return {
          sectionId: id, type, summary: markdown(s['summary'], `${path}.summary`, 1500), locations,
          ...(status === undefined ? {} : { status }), ...(s['generatedBy'] === undefined ? {} : { generatedBy: oneOf(s['generatedBy'], `${path}.generatedBy`, ['vmn', 'client'] as const) }),
        };
      }
      case 'watchlist': {
        const s = record(item, path, ['sectionId', 'type', 'items'], ['summary']);
        return { sectionId: id, type, summary: markdown(s['summary'], `${path}.summary`, 1500), items: list(s['items'], `${path}.items`, GAZETTE_LIMITS.watchItems).map((w, j) => watchItem(w, `${path}.items[${j}]`)) };
      }
      case 'rich': {
        const s = record(item, path, ['sectionId', 'type', 'body'], ['summary', 'tables']);
        return { sectionId: id, type, summary: markdown(s['summary'], `${path}.summary`, 1500), body: markdown(s['body'], `${path}.body`, 20_000), tables: list(s['tables'], `${path}.tables`, GAZETTE_LIMITS.tables).map((t, j) => table(t, `${path}.tables[${j}]`)) };
      }
    }
  });
  const localNotices = list(row['localNotices'], 'edition.localNotices', GAZETTE_LIMITS.localNotices).map((value, i): GazetteLocalNotice => {
    const path = `edition.localNotices[${i}]`;
    const notice = record(value, path, ['kind', 'place', 'text', 'source', 'url', 'checkedAt']);
    return {
      kind: oneOf(notice['kind'], `${path}.kind`, ['civil_protection', 'road_closure'] as const),
      place: str(notice['place'], `${path}.place`, 120, { required: true }),
      text: str(notice['text'], `${path}.text`, 500, { required: true }),
      source: str(notice['source'], `${path}.source`, 80, { required: true }),
      url: gazetteUrl(notice['url'], `${path}.url`, true) as string,
      checkedAt: instant(notice['checkedAt'], `${path}.checkedAt`) as string,
    };
  });
  const content: GazetteEditionContent = {
    version: 1, date: localDate(row['date'], 'edition.date'), title: str(row['title'], 'edition.title', 80),
    greeting: str(row['greeting'], 'edition.greeting', 200), intro: markdown(row['intro'], 'edition.intro', 4000), sections,
    ...(localNotices.length > 0 ? { localNotices } : {}),
  };
  if (utf8Length(JSON.stringify(content)) > GAZETTE_LIMITS.contentBytes) fail('edition', 'gazette_too_large');
  return content;
}

// ---------------------------------------------------------------------------------------------------
// Dates and retention

export function gazetteToday(settings: Pick<GazetteSettings, 'timeZone'>, now: Date): LocalDate {
  return localDateAt(now, settings.timeZone);
}
/** The oldest date kept: today and the `retentionDays - 1` days before it. */
export function gazetteOldestKept(settings: Pick<GazetteSettings, 'timeZone' | 'retentionDays'>, now: Date): LocalDate {
  return addDays(gazetteToday(settings, now), -(settings.retentionDays - 1));
}
/** Editions may be written for any kept day and for tomorrow (prepared the evening before), nothing else. */
export function assertGazetteDateWritable(settings: Pick<GazetteSettings, 'timeZone' | 'retentionDays'>, date: LocalDate, now: Date): void {
  if (date < gazetteOldestKept(settings, now) || date > addDays(gazetteToday(settings, now), 1)) fail('edition.date', 'gazette_date_out_of_range');
}

/** The sections a reader sees: in the settings' order, enabled only, unknown or removed ones dropped. */
export function visibleGazetteSections(content: GazetteEditionContent, settings: GazetteSettings): { readonly definition: GazetteSectionDefinition; readonly content: GazetteSectionContent }[] {
  const byId = new Map(content.sections.map(s => [s.sectionId, s]));
  return settings.sections.flatMap(definition => {
    const section = byId.get(definition.id);
    return definition.enabled && section && section.type === definition.type ? [{ definition, content: section }] : [];
  });
}

export interface GazettePreview {
  readonly id: string;
  readonly date: LocalDate;
  readonly isToday: boolean;
  readonly title: string;
  readonly masthead: string;
  readonly intro: string;
  readonly header: NonNullable<GazetteEdition['header']> | null;
  readonly greeting: string;
  readonly publishedAt: Date | null;
  readonly sectionCount: number;
  readonly headlines: readonly { readonly sectionId: string; readonly section: string; readonly title: string }[];
  /** Only for today's edition: an older forecast is never shown as current. */
  readonly weather: readonly { readonly name: string; readonly condition: WeatherCondition; readonly high: number | null; readonly low: number | null }[];
  readonly priceDrops: number;
}

/** The compact Dashboard projection: no full articles, no comparison tables. */
export const DEFAULT_GAZETTE_DISCOUNT_THRESHOLD = 15;

/** The signed change from the stated reference, not from a previous day's price. */
export function gazettePriceChange(item: Pick<GazetteWatchItem, 'verified' | 'price' | 'typical'>): number | null {
  if (!item.verified || item.price === null || item.typical === null || item.typical === 0) return null;
  return ((item.price - item.typical) / item.typical) * 100;
}

export function gazetteSignificantDiscount(item: GazetteWatchItem, threshold = DEFAULT_GAZETTE_DISCOUNT_THRESHOLD): boolean {
  const change = gazettePriceChange(item);
  return change !== null && change <= -(item.discountThreshold ?? threshold) + 1e-9;
}

export function gazettePreview(edition: GazetteEdition, settings: GazetteSettings, today: LocalDate): GazettePreview {
  const sections = visibleGazetteSections(edition.content, settings);
  const isToday = edition.date === today;
  const headlines: { sectionId: string; section: string; title: string }[] = [];
  const queues = sections.filter(s => s.definition.dashboard && s.content.type === 'articles').map(s => ({ s, items: s.content.type === 'articles' ? [...s.content.items].sort((a, b) => (b.relevance === 'high' ? 1 : 0) - (a.relevance === 'high' ? 1 : 0)) : [] }));
  // Round-robin: one headline per section before a second from any section.
  for (let round = 0; headlines.length < settings.dashboardHeadlines && queues.some(q => q.items.length > round); round++) {
    for (const q of queues) {
      const item = q.items[round];
      if (item && headlines.length < settings.dashboardHeadlines) headlines.push({ sectionId: q.s.definition.id, section: q.s.definition.title, title: item.title });
    }
  }
  const weather = isToday ? sections.flatMap(s => s.content.type === 'weather' ? s.content.locations.flatMap(l => {
    const day = l.days.find(d => d.date === today);
    return day ? [{ name: l.name, condition: day.condition, high: day.high, low: day.low }] : [];
  }) : []).slice(0, 2) : [];
  const priceDrops = sections.reduce((n, s) => n + (s.content.type === 'watchlist' && s.definition.dashboard ? s.content.items.filter(i => gazetteSignificantDiscount(i, settings.watchlist?.discountThreshold)).length : 0), 0);
  return {
    id: edition.id,
    date: edition.date,
    isToday,
    title: edition.title,
    masthead: settings.title,
    intro: edition.content.intro,
    header: edition.header ?? null,
    greeting: isToday ? edition.content.greeting : '',
    publishedAt: edition.publishedAt,
    sectionCount: sections.length,
    headlines,
    weather,
    priceDrops,
  };
}

/** Placeholder definitions matching an edition's own sections: checks a stored edition's shape (restore) without its Workspace settings. */
export function gazetteSectionsOf(value: unknown): GazetteSectionDefinition[] {
  const sections = value && typeof value === 'object' && Array.isArray((value as { sections?: unknown }).sections) ? (value as { sections: unknown[] }).sections : [];
  return sections.flatMap(section => {
    const s = section as { sectionId?: unknown; type?: unknown } | null;
    return s && typeof s.sectionId === 'string' && typeof s.type === 'string' && (GAZETTE_SECTION_TYPES as readonly string[]).includes(s.type)
      ? [{ id: s.sectionId, type: s.type as GazetteSectionType, title: s.sectionId, subtitle: '', icon: 'news' as const, enabled: true, language: 'en', dashboard: true, collapsed: false, brief: '', sources: [] }] : [];
  });
}

/* ---- Persistent watchlist (43.3) ---------------------------------------------------------------
 * What the Workspace watches, independent of editions: retention never touches it. Each item keeps a
 * short price history from observations an import (or a person) records; an edition's watchlist
 * section is a snapshot written by the import. Prices are only ever what someone observed, with the
 * time and source — never inferred. */

export const GAZETTE_WATCH_CONDITIONS = ['any', 'new', 'refurbished', 'used'] as const;
export type GazetteWatchCondition = (typeof GAZETTE_WATCH_CONDITIONS)[number];
export const GAZETTE_WATCH_LIMITS = Object.freeze({ items: 100, pricesPerItem: 90, observationsPerCall: 50 });

export interface GazetteWatchFields {
  readonly name: string;
  readonly variant: string;
  readonly condition: GazetteWatchCondition;
  readonly market: string;
  readonly shop: string;
  readonly url: string | null;
  readonly currency: string;
  readonly target: number | null;
  readonly typical: number | null;
  readonly notes: string;
  readonly active: boolean;
  readonly discountThreshold?: number | null;
}

export interface GazettePriceObservationInput {
  readonly itemId: string;
  readonly price: number;
  readonly verified: boolean;
  readonly checkedAt: string;
  readonly source: string;
  readonly url: string | null;
  /** 43.7: delivery cost shown with the offer (0 = free); `null` = not known. */
  readonly shipping: number | null;
  /** 43.7: whether the price includes VAT as shown; `null` = not stated. */
  readonly vatIncluded: boolean | null;
}

/** What an offer costs delivered: price plus shipping when the offer showed it (43.7). */
export const gazetteOfferTotal = (price: { readonly price: number; readonly shipping?: number | null }) => Math.round((price.price + (price.shipping ?? 0)) * 100) / 100;

export function parseGazetteWatchFields(value: unknown): GazetteWatchFields {
  const row = record(value, 'item', ['name', 'currency'], ['variant', 'condition', 'market', 'shop', 'url', 'target', 'typical', 'notes', 'active', 'discountThreshold']);
  return {
    name: str(row['name'], 'item.name', 120, { required: true }),
    variant: str(row['variant'], 'item.variant', 120),
    condition: oneOf(row['condition'], 'item.condition', GAZETTE_WATCH_CONDITIONS, 'any'),
    market: str(row['market'], 'item.market', 8),
    shop: str(row['shop'], 'item.shop', 80),
    url: gazetteUrl(row['url'], 'item.url'),
    currency: typeof row['currency'] === 'string' && /^[A-Z]{3}$/.test(row['currency']) ? row['currency'] : fail('item.currency'),
    target: num(row['target'], 'item.target', 0, 10_000_000),
    typical: num(row['typical'], 'item.typical', 0, 10_000_000),
    notes: str(row['notes'], 'item.notes', 1000, { multiline: true }),
    active: bool(row['active'], 'item.active', true),
    ...(row['discountThreshold'] === undefined ? {} : { discountThreshold: num(row['discountThreshold'], 'item.discountThreshold', 2, 100) }),
  };
}

/** A batch of observed prices; an observation without the time it was checked is refused. */
export function parseGazettePriceObservations(value: unknown, now: Date): GazettePriceObservationInput[] {
  const items = list(value, 'observations', GAZETTE_WATCH_LIMITS.observationsPerCall, 1);
  return items.map((entry, index) => {
    const path = `observations[${index}]`;
    const row = record(entry, path, ['itemId', 'price', 'checkedAt'], ['verified', 'source', 'url', 'shipping', 'vatIncluded']);
    const checkedAt = instant(row['checkedAt'], `${path}.checkedAt`) as string;
    if (Date.parse(checkedAt) > now.getTime() + 5 * 60_000) fail(`${path}.checkedAt`, 'gazette_invalid_time');
    return {
      itemId: typeof row['itemId'] === 'string' && /^[0-9a-f-]{36}$/.test(row['itemId']) ? row['itemId'] : fail(`${path}.itemId`, 'gazette_invalid_id'),
      price: num(row['price'], `${path}.price`, 0, 10_000_000, false) as number,
      verified: bool(row['verified'], `${path}.verified`, false),
      checkedAt,
      source: str(row['source'], `${path}.source`, 80),
      url: gazetteUrl(row['url'], `${path}.url`),
      shipping: num(row['shipping'], `${path}.shipping`, 0, 100_000),
      vatIncluded: row['vatIncluded'] === undefined || row['vatIncluded'] === null ? null : bool(row['vatIncluded'], `${path}.vatIncluded`),
    };
  });
}

export interface GazetteWatchPrice {
  readonly price: number; readonly verified: boolean; readonly checkedAt: string; readonly source: string; readonly url: string | null;
  /** 43.7, optional for older clients and packages: shipping (0 = free, null = not known) and VAT as shown. */
  readonly shipping?: number | null; readonly vatIncluded?: boolean | null;
}
export interface GazetteWatchItemView extends GazetteWatchFields {
  readonly id: string;
  readonly revision: number;
  readonly updatedAt: string;
  /** The newest observation, if any. */
  readonly latest: GazetteWatchPrice | null;
  readonly lowestVerified?: GazetteWatchPrice | null;
  /** Oldest first, at most `pricesPerItem`. */
  readonly history: readonly GazetteWatchPrice[];
}

export interface GazetteWatchSettings {
  readonly wishlistUrl: string | null;
  readonly minimumEur: number;
  readonly discountThreshold: number;
}

export const DEFAULT_GAZETTE_WATCH_SETTINGS: GazetteWatchSettings = {
  wishlistUrl: null, minimumEur: 20, discountThreshold: DEFAULT_GAZETTE_DISCOUNT_THRESHOLD,
};

function parseWatchSettings(value: unknown): GazetteWatchSettings {
  const path = 'settings.watchlist';
  const row = record(value, path, [], ['wishlistUrl', 'minimumEur', 'discountThreshold']);
  const url = gazetteUrl(row['wishlistUrl'], `${path}.wishlistUrl`);
  const wishlist = url?.match(/^https:\/\/(?:www\.)?amazon\.de\/hz\/wishlist\/ls\/([A-Z0-9]{1,40})(?:[?#].*)?$/i);
  if (url !== null && !wishlist) fail(`${path}.wishlistUrl`, 'gazette_invalid_url');
  return {
    wishlistUrl: wishlist ? `https://www.amazon.de/hz/wishlist/ls/${wishlist[1]}` : null,
    minimumEur: num(row['minimumEur'], `${path}.minimumEur`, 0, 10_000_000) ?? DEFAULT_GAZETTE_WATCH_SETTINGS.minimumEur,
    discountThreshold: num(row['discountThreshold'], `${path}.discountThreshold`, 2, 100) ?? DEFAULT_GAZETTE_WATCH_SETTINGS.discountThreshold,
  };
}

/** Identify an exact Amazon.de listing variant, independent of its title and tracking parameters. */
export function gazetteAmazonAsin(url: string | null): string | null {
  return url?.match(/^https:\/\/(?:www\.)?amazon\.de\/(?:[^/?#]+\/)?(?:dp|gp\/product)\/([a-z0-9]{10})(?:[/?#]|$)/i)?.[1]?.toUpperCase() ?? null;
}

export function parseGazetteWatchImport(value: unknown): GazetteWatchFields[] {
  return list(value, 'items', 50, 1).map(entry => {
    const fields = parseGazetteWatchFields(entry);
    if (fields.currency !== 'EUR') fail('item.currency');
    const asin = gazetteAmazonAsin(fields.url);
    return { ...fields, active: true, url: asin === null ? fields.url : `https://www.amazon.de/dp/${asin}` };
  });
}
