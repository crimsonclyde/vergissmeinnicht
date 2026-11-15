import type { GazetteWeatherLogRepository } from '@vergissmeinnicht/application';
import { and, eq, gte, lt, lte, sql } from 'drizzle-orm';
import type { AppDatabase } from './connection.ts';
import { gazetteWeatherForecasts, gazetteWeatherObservations } from './schema.ts';

/** Forecast and observation rows of the Daily Planet's verification (43.7) are kept this long. */
export const GAZETTE_WEATHER_LOG_DAYS = 60;

export function createGazetteWeatherLogRepository(database: AppDatabase): GazetteWeatherLogRepository {
  const { db } = database;
  return {
    async recordForecasts(workspaceId, locationKey, issuedOn, rows, at) {
      if (rows.length === 0) return;
      db.transaction(tx => {
        for (const row of rows.slice(0, 200)) {
          tx.insert(gazetteWeatherForecasts).values({ workspaceId, locationKey, issuedOn, recordedAt: at, ...row })
            .onConflictDoUpdate({ target: [gazetteWeatherForecasts.workspaceId, gazetteWeatherForecasts.locationKey, gazetteWeatherForecasts.sourceId, gazetteWeatherForecasts.issuedOn, gazetteWeatherForecasts.targetDate], set: { high: row.high, low: row.low, precipitationMm: row.precipitationMm, lead: row.lead, recordedAt: at } }).run();
        }
      });
    },
    async recordObservation(workspaceId, locationKey, day, source, at) {
      const values = { high: day.high, low: day.low, precipitationMm: day.precipitationMm, station: day.station.name.slice(0, 80), distanceM: Math.min(100_000, Math.max(0, Math.round(day.station.distanceM))), elevationM: day.station.elevationM === null ? null : Math.round(day.station.elevationM), source, hours: Math.min(25, day.hours), recordedAt: at };
      db.insert(gazetteWeatherObservations).values({ workspaceId, locationKey, date: day.date, ...values })
        .onConflictDoUpdate({ target: [gazetteWeatherObservations.workspaceId, gazetteWeatherObservations.locationKey, gazetteWeatherObservations.date], set: values }).run();
    },
    async unobservedDates(workspaceId, locationKey, from, to) {
      const rows = db.selectDistinct({ date: gazetteWeatherForecasts.targetDate }).from(gazetteWeatherForecasts)
        .where(and(eq(gazetteWeatherForecasts.workspaceId, workspaceId), eq(gazetteWeatherForecasts.locationKey, locationKey), gte(gazetteWeatherForecasts.targetDate, from), lte(gazetteWeatherForecasts.targetDate, to),
          sql`not exists (select 1 from ${gazetteWeatherObservations} o where o.workspace_id = ${gazetteWeatherForecasts.workspaceId} and o.location_key = ${gazetteWeatherForecasts.locationKey} and o.date = ${gazetteWeatherForecasts.targetDate})`))
        .orderBy(gazetteWeatherForecasts.targetDate).all();
      return rows.map(row => row.date);
    },
    async pairs(workspaceId, locationKey, from) {
      return db.select({ sourceId: gazetteWeatherForecasts.sourceId, lead: gazetteWeatherForecasts.lead, forecastHigh: gazetteWeatherForecasts.high, forecastLow: gazetteWeatherForecasts.low, observedHigh: gazetteWeatherObservations.high, observedLow: gazetteWeatherObservations.low })
        .from(gazetteWeatherForecasts)
        .innerJoin(gazetteWeatherObservations, and(eq(gazetteWeatherObservations.workspaceId, gazetteWeatherForecasts.workspaceId), eq(gazetteWeatherObservations.locationKey, gazetteWeatherForecasts.locationKey), eq(gazetteWeatherObservations.date, gazetteWeatherForecasts.targetDate)))
        .where(and(eq(gazetteWeatherForecasts.workspaceId, workspaceId), eq(gazetteWeatherForecasts.locationKey, locationKey), gte(gazetteWeatherForecasts.targetDate, from))).all();
    },
    async observations(workspaceId, locationKey, from) {
      return db.select({ date: gazetteWeatherObservations.date, station: gazetteWeatherObservations.station, distanceM: gazetteWeatherObservations.distanceM, elevationM: gazetteWeatherObservations.elevationM })
        .from(gazetteWeatherObservations).where(and(eq(gazetteWeatherObservations.workspaceId, workspaceId), eq(gazetteWeatherObservations.locationKey, locationKey), gte(gazetteWeatherObservations.date, from))).orderBy(gazetteWeatherObservations.date).all();
    },
    async prune(before) {
      db.delete(gazetteWeatherForecasts).where(lt(gazetteWeatherForecasts.targetDate, before)).run();
      db.delete(gazetteWeatherObservations).where(lt(gazetteWeatherObservations.date, before)).run();
    },
  };
}
