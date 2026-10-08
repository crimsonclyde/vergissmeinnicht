import type { OpenMeteoModelId, WeatherDay, WeatherProviderId } from '@vergissmeinnicht/domain';
import type { CompareResult, ModelChoice } from './api.ts';

export interface SourceChoice {
  readonly provider: WeatherProviderId;
  readonly model?: OpenMeteoModelId;
}

export const sourceKey = (source: { provider: WeatherProviderId; model?: OpenMeteoModelId | null }) => `${source.provider}:${source.model ?? ''}`;

type Shown = Extract<CompareResult, { forecast: object }>;
const hasForecast = (result: CompareResult): result is Shown => result.state === 'fresh' || result.state === 'cached';

/** Every date at least one source forecasts, in order — no source is cut to the shortest horizon. */
export function compareDates(results: readonly CompareResult[]): string[] {
  return [...new Set(results.filter(hasForecast).flatMap((result) => result.forecast.days.map((day) => day.date)))].sort();
}

/** The source's day, or `undefined` when it has no forecast for that date. */
export const dayOf = (result: CompareResult, date: string): WeatherDay | undefined => (hasForecast(result) ? result.forecast.days.find((day) => day.date === date) : undefined);

type Field = 'max' | 'min' | 'precipitationSum' | 'precipitationProbabilityMax' | 'windSpeedMax';

/**
 * The range of a value across the sources that have it — lowest and highest, how many gave it and how many
 * did not. Never an average or a "best" value: the differences are what the comparison is for.
 */
export function spread(results: readonly CompareResult[], date: string, field: Field): { readonly low: number; readonly high: number; readonly given: number; readonly missing: number } | null {
  const days = results.map((result) => dayOf(result, date)).filter((day): day is WeatherDay => day !== undefined);
  const values = days.flatMap((day) => (day[field] === undefined ? [] : [day[field]]));
  if (values.length === 0) return null;
  return { low: Math.min(...values), high: Math.max(...values), given: values.length, missing: days.length - values.length };
}

/**
 * What is ticked when the comparison opens: Open-Meteo's automatic choice, the most detailed regional model
 * covering the place, and MET Norway — free sources only; paid ones are always the person's choice.
 */
export function defaultSources(providers: readonly WeatherProviderId[], models: readonly ModelChoice[]): SourceChoice[] {
  const result: SourceChoice[] = [];
  if (providers.includes('OPEN_METEO')) {
    result.push({ provider: 'OPEN_METEO', model: 'best_match' });
    const regional = models.find((model) => model.id !== 'best_match' && model.days !== null && model.days >= 2);
    if (regional !== undefined) result.push({ provider: 'OPEN_METEO', model: regional.id });
  }
  if (providers.includes('MET_NORWAY')) result.push({ provider: 'MET_NORWAY' });
  return result;
}

/** Paid requests a "fetch now" would use, per provider (Meteomatics: 2 queries per source). */
export function paidCost(results: readonly CompareResult[]): Partial<Record<WeatherProviderId, number>> {
  const cost: Partial<Record<WeatherProviderId, number>> = {};
  for (const result of results) {
    if (!result.paid || result.state === 'fresh' || (result.state === 'failed' && result.reason !== 'budget_reached')) continue;
    cost[result.provider] = (cost[result.provider] ?? 0) + result.queries;
  }
  return cost;
}
