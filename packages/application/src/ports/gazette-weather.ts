import type { GazetteSourceDay, GazetteWarning, LiguriaAlertZone } from '@vergissmeinnicht/domain';

export interface GazettePlaceQuery {
  readonly latitude: number;
  readonly longitude: number;
  readonly elevation: number | null;
  readonly timeZone: string;
}

/** A DWD station used by MOSMIX or for observations, as the provider names it. */
export interface GazetteStation { readonly name: string; readonly distanceM: number; readonly elevationM: number | null }

export interface GazetteObservedDay {
  readonly date: string;
  readonly high: number | null;
  readonly low: number | null;
  readonly precipitationMm: number | null;
  readonly station: GazetteStation;
  /** Hours the day's values are made of; a day with too few is not used. */
  readonly hours: number;
}

/**
 * The extra sources of the Daily Planet's weather (43.7). Endpoints are fixed in the adapters; every
 * method throws `WeatherProviderError` with a stable reason and never returns invented values.
 */
export interface GazetteWeatherSourcesPort {
  /** Several Open-Meteo models in one request: each model's own days only (nothing filled from a blend). */
  openMeteoModels(query: GazettePlaceQuery, models: readonly string[], days: number): Promise<Record<string, GazetteSourceDay[]>>;
  /** DWD MOSMIX for the nearest MOSMIX station, as daily values in the place's time zone. */
  mosmix(query: GazettePlaceQuery, from: string, days: number): Promise<{ readonly station: GazetteStation; readonly days: GazetteSourceDay[] }>;
  /** Official DWD warnings for the point. */
  dwdWarnings(query: GazettePlaceQuery): Promise<GazetteWarning[]>;
  /** Official DWD station observations for one local day (for verification only). */
  dwdObservations(query: GazettePlaceQuery, date: string): Promise<GazetteObservedDay | null>;
  /** AllertaLiguria's current message for one zone: level and phenomena, as published. */
  allertaLiguria(zone: LiguriaAlertZone): Promise<GazetteWarning[]>;
  /** Meteoalarm awareness for an Italian region (Aeronautica Militare); yellow and above only. */
  meteoalarmItaly(region: string): Promise<GazetteWarning[]>;
}

export interface GazetteWeatherForecastRow {
  readonly sourceId: string;
  readonly targetDate: string;
  readonly lead: number;
  readonly high: number | null;
  readonly low: number | null;
  readonly precipitationMm: number | null;
}

/** What VMN forecast and what was observed, per Workspace and place, for verification (43.7). */
export interface GazetteWeatherLogRepository {
  recordForecasts(workspaceId: string, locationKey: string, issuedOn: string, rows: readonly GazetteWeatherForecastRow[], at: Date): Promise<void>;
  recordObservation(workspaceId: string, locationKey: string, day: GazetteObservedDay, source: string, at: Date): Promise<void>;
  /** Dates in the window that have forecasts but no observation yet. */
  unobservedDates(workspaceId: string, locationKey: string, from: string, to: string): Promise<string[]>;
  pairs(workspaceId: string, locationKey: string, from: string): Promise<{ readonly sourceId: string; readonly lead: number; readonly forecastHigh: number | null; readonly forecastLow: number | null; readonly observedHigh: number | null; readonly observedLow: number | null }[]>;
  observations(workspaceId: string, locationKey: string, from: string): Promise<{ readonly date: string; readonly station: string; readonly distanceM: number; readonly elevationM: number | null }[]>;
  /** Retention: rows older than the date go. */
  prune(before: string): Promise<void>;
}
