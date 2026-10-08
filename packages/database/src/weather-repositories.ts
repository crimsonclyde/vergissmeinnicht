import { randomUUID } from 'node:crypto';
import { DEFAULT_SERVER_WEATHER, type CredentialScope, type ServerWeatherSettingsRepository, type StoredWeatherCredential, type WeatherCredentialRepository, type WeatherSettingsRepository } from '@vergissmeinnicht/application';
import { DEFAULT_WEATHER_SETTINGS, OPEN_METEO_MODEL_IDS, WEATHER_PROVIDERS, WEATHER_PROVIDER_CHOICES, type OpenMeteoModelId, type UserId, type WeatherProviderChoice, type WeatherProviderId } from '@vergissmeinnicht/domain';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { IMMEDIATE } from './actor-guard.ts';
import type { AppDatabase } from './connection.ts';
import { recordSecurityEvent } from './security-events.ts';
import { serverWeatherSettings, userWeatherSettings, users, weatherCredentials } from './schema.ts';

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

const scopeWhere = (scope: CredentialScope) => (scope.kind === 'SERVER' ? and(eq(weatherCredentials.scope, 'SERVER'), isNull(weatherCredentials.userId)) : and(eq(weatherCredentials.scope, 'USER'), eq(weatherCredentials.userId, scope.userId)));

function credentialOf(row: typeof weatherCredentials.$inferSelect): StoredWeatherCredential {
  return {
    id: row.id,
    scope: row.scope === 'SERVER' || row.userId === null ? { kind: 'SERVER' } : { kind: 'USER', userId: row.userId as UserId },
    provider: row.provider === 'METEOMATICS' ? 'METEOMATICS' : 'OPENWEATHER',
    sealed: row.sealed,
    availableToUsers: row.availableToUsers,
    dailyBudget: row.dailyBudget,
    usedToday: row.usedToday,
    usageDay: row.usageDay,
    lastTest: row.lastTestAt === null || row.lastTestOk === null ? null : { at: row.lastTestAt, ok: row.lastTestOk },
    updatedAt: row.updatedAt,
  };
}

/**
 * Weather provider credentials (19.4b). A server-wide credential is changed only by an ACTIVE server
 * admin (re-checked in the transaction); a personal one only for its owner — the scope comes from the
 * signed-in user, never from a request. Every change is a security event without the value.
 */
export function createWeatherCredentialRepository({ db }: Pick<AppDatabase, 'db'>): WeatherCredentialRepository {
  const allowed = (tx: Pick<typeof db, 'select'>, scope: CredentialScope, actorId: string) => {
    const user = tx.select({ status: users.status, serverAdmin: users.serverAdmin }).from(users).where(eq(users.id, actorId)).get();
    if (user?.status !== 'ACTIVE') return false;
    return scope.kind === 'SERVER' ? user.serverAdmin : scope.userId === actorId;
  };
  return {
    async find(scope, provider) {
      const row = db.select().from(weatherCredentials).where(and(scopeWhere(scope), eq(weatherCredentials.provider, provider))).get();
      return row === undefined ? undefined : credentialOf(row);
    },

    async list(scope) {
      return db.select().from(weatherCredentials).where(scopeWhere(scope)).all().map(credentialOf);
    },

    async save(input, actor) {
      return db.transaction((tx) => {
        if (!allowed(tx, input.scope, actor.userId)) return false;
        const existing = tx.select().from(weatherCredentials).where(and(scopeWhere(input.scope), eq(weatherCredentials.provider, input.provider))).get();
        const availableToUsers = input.scope.kind === 'SERVER' && input.availableToUsers;
        let action: 'SET' | 'REPLACED' | 'SETTINGS';
        if (existing === undefined) {
          if (input.sealed === undefined) return false;
          tx.insert(weatherCredentials)
            .values({
              id: randomUUID(),
              scope: input.scope.kind,
              userId: input.scope.kind === 'USER' ? input.scope.userId : null,
              provider: input.provider,
              sealed: input.sealed,
              availableToUsers,
              dailyBudget: input.dailyBudget,
              usageDay: input.usedToday === undefined ? null : input.at.toISOString().slice(0, 10),
              usedToday: input.usedToday ?? 0,
              lastTestAt: input.usedToday === undefined ? null : input.at,
              lastTestOk: input.usedToday === undefined ? null : true,
              createdAt: input.at,
              updatedAt: input.at,
            })
            .run();
          action = 'SET';
        } else {
          tx.update(weatherCredentials)
            .set({
              ...(input.sealed === undefined ? {} : { sealed: input.sealed, lastTestAt: input.at, lastTestOk: true }),
              ...(input.usedToday === undefined ? {} : { usedToday: existing.usageDay === input.at.toISOString().slice(0, 10) ? existing.usedToday + input.usedToday : input.usedToday, usageDay: input.at.toISOString().slice(0, 10) }),
              availableToUsers,
              dailyBudget: input.dailyBudget,
              updatedAt: input.at,
            })
            .where(eq(weatherCredentials.id, existing.id))
            .run();
          action = input.sealed === undefined ? 'SETTINGS' : 'REPLACED';
        }
        recordSecurityEvent(tx, {
          type: 'WEATHER_CREDENTIAL_CHANGED',
          actor,
          subjectType: input.scope.kind === 'SERVER' ? 'instance' : 'user',
          subjectId: input.scope.kind === 'SERVER' ? 'weather' : input.scope.userId,
          occurredAt: input.at,
          metadata: { scope: input.scope.kind, provider: input.provider, action, dailyBudget: input.dailyBudget, availableToUsers },
        });
        return true;
      }, IMMEDIATE);
    },

    async remove(scope, provider, at, actor) {
      return db.transaction((tx) => {
        if (!allowed(tx, scope, actor.userId)) return false;
        const removed = tx.delete(weatherCredentials).where(and(scopeWhere(scope), eq(weatherCredentials.provider, provider))).run().changes;
        if (removed === 0) return false;
        recordSecurityEvent(tx, {
          type: 'WEATHER_CREDENTIAL_CHANGED',
          actor,
          subjectType: scope.kind === 'SERVER' ? 'instance' : 'user',
          subjectId: scope.kind === 'SERVER' ? 'weather' : scope.userId,
          occurredAt: at,
          metadata: { scope: scope.kind, provider, action: 'REMOVED' },
        });
        return true;
      }, IMMEDIATE);
    },

    async consume(id, day, count) {
      // One statement: a new day starts at `count`, otherwise adds `count` only while it stays within the budget.
      const changed = db
        .update(weatherCredentials)
        .set({ usedToday: sql`case when ${weatherCredentials.usageDay} = ${day} then ${weatherCredentials.usedToday} + ${count} else ${count} end`, usageDay: day })
        .where(
          and(
            eq(weatherCredentials.id, id),
            sql`(case when ${weatherCredentials.usageDay} = ${day} then ${weatherCredentials.usedToday} else 0 end) + ${count} <= ${weatherCredentials.dailyBudget}`,
          ),
        )
        .run().changes;
      return changed === 1;
    },

    async recordTest(id, ok, at) {
      db.update(weatherCredentials).set({ lastTestAt: at, lastTestOk: ok }).where(eq(weatherCredentials.id, id)).run();
    },
  };
}
