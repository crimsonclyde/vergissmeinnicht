import { DEFAULT_SERVER_WEATHER, type ServerWeatherSettingsRepository, type WeatherSettingsRepository } from '@vergissmeinnicht/application';
import { DEFAULT_WEATHER_SETTINGS, OPEN_METEO_MODEL_IDS, WEATHER_PROVIDERS, WEATHER_PROVIDER_CHOICES, type OpenMeteoModelId, type WeatherProviderChoice, type WeatherProviderId } from '@vergissmeinnicht/domain';
import { eq } from 'drizzle-orm';
import { IMMEDIATE } from './actor-guard.ts';
import type { AppDatabase } from './connection.ts';
import { recordSecurityEvent } from './security-events.ts';
import { serverWeatherSettings, userWeatherSettings, users } from './schema.ts';

/** A person's weather settings (19.4) — only ever read and written for that person. */
export function createWeatherSettingsRepository({ db }: Pick<AppDatabase, 'db'>): WeatherSettingsRepository {
  return {
    async find(userId) {
      const row = db.select().from(userWeatherSettings).where(eq(userWeatherSettings.userId, userId)).get();
      if (row === undefined) return undefined;
      const location =
        row.placeName === null || row.latitude === null || row.longitude === null || row.timeZone === null
          ? null
          : { name: row.placeName, latitude: row.latitude, longitude: row.longitude, timeZone: row.timeZone, elevation: row.elevation };
      // Values from an older or newer version that this one does not know fall back to the defaults.
      return {
        location,
        provider: (WEATHER_PROVIDER_CHOICES as readonly string[]).includes(row.provider) ? (row.provider as WeatherProviderChoice) : DEFAULT_WEATHER_SETTINGS.provider,
        model: (OPEN_METEO_MODEL_IDS as readonly string[]).includes(row.model) ? (row.model as OpenMeteoModelId) : DEFAULT_WEATHER_SETTINGS.model,
        fallback: row.fallback,
        unit: row.unit === 'F' ? 'F' : 'C',
        showTomorrow: row.showTomorrow,
      };
    },

    async save(userId, settings, at) {
      const values = {
        placeName: settings.location?.name ?? null,
        latitude: settings.location?.latitude ?? null,
        longitude: settings.location?.longitude ?? null,
        timeZone: settings.location?.timeZone ?? null,
        elevation: settings.location?.elevation ?? null,
        provider: settings.provider,
        model: settings.model,
        fallback: settings.fallback,
        unit: settings.unit,
        showTomorrow: settings.showTomorrow,
        updatedAt: at,
      };
      db.insert(userWeatherSettings).values({ userId, ...values }).onConflictDoUpdate({ target: userWeatherSettings.userId, set: values }).run();
    },
  };
}

/** The server's weather settings (19.4): changed only by an ACTIVE server admin, re-checked in the transaction, audited. */
export function createServerWeatherSettingsRepository({ db }: Pick<AppDatabase, 'db'>): ServerWeatherSettingsRepository {
  return {
    async get() {
      const row = db.select().from(serverWeatherSettings).where(eq(serverWeatherSettings.id, 1)).get();
      if (row === undefined) return DEFAULT_SERVER_WEATHER;
      const allowed = row.allowed.split(',').filter((id): id is WeatherProviderId => (WEATHER_PROVIDERS as readonly string[]).includes(id));
      return { enabled: row.enabled, allowed, metContact: row.metContact };
    },

    async save(settings, at, actor) {
      return db.transaction((tx) => {
        const admin = tx.select({ status: users.status, serverAdmin: users.serverAdmin }).from(users).where(eq(users.id, actor.userId)).get();
        if (admin?.status !== 'ACTIVE' || !admin.serverAdmin) return false;
        const values = { enabled: settings.enabled, allowed: settings.allowed.join(','), metContact: settings.metContact, updatedAt: at, updatedByUserId: actor.userId };
        tx.insert(serverWeatherSettings).values({ id: 1, ...values }).onConflictDoUpdate({ target: serverWeatherSettings.id, set: values }).run();
        recordSecurityEvent(tx, {
          type: 'WEATHER_SETTINGS_CHANGED',
          actor,
          subjectType: 'instance',
          subjectId: 'weather',
          occurredAt: at,
          // The contact itself is not repeated in the log — only whether one is set.
          metadata: { enabled: settings.enabled, allowed: settings.allowed.join(','), metContactSet: settings.metContact !== null },
        });
        return true;
      }, IMMEDIATE);
    },
  };
}
