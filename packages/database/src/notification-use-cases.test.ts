import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  NotAuthorizedError,
  NothingToConfirmError,
  NotificationDeliveryError,
  TELEGRAM_PAIRING_TTL_MS,
  TelegramUnavailableError,
  cancelTelegramPairing,
  configureTelegram,
  confirmTelegramPairing,
  disconnectTelegram,
  getNotificationProviders,
  getNotificationSettings,
  pollTelegramPairings,
  sanitizeChatLabel,
  setEmailReminders,
  startTelegramPairing,
  telegramReminderNotifier,
  testNotificationProvider,
  updateNotificationSettings,
  type EmailMessage,
  type NotificationDeps,
  type TelegramBotApi,
  type TelegramUpdate,
} from '@vergissmeinnicht/application';
import { createSecretBox, invitationTokens } from '@vergissmeinnicht/auth';
import { DomainValidationError, normalizeEmail, type User } from '@vergissmeinnicht/domain';
import { createNotificationPreferencesRepository } from './notification-preferences-repository.ts';
import { createNotificationProviderRepository, createTelegramRepository } from './notification-repositories.ts';
import { createTestDatabase } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ';
const OTHER_TOKEN = '987654321:BBHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ';

/** A fake Bot API: records calls (with the token they used) and serves queued updates. */
function fakeTelegram() {
  const calls: { method: string; token: string; chatId?: string; text?: string }[] = [];
  let updates: TelegramUpdate[] = [];
  let valid = new Set([TOKEN, OTHER_TOKEN]);
  const api: TelegramBotApi = {
    async getMe(token) {
      calls.push({ method: 'getMe', token });
      if (!valid.has(token)) throw new NotificationDeliveryError('telegram_invalid_token', false);
      return { username: token === TOKEN ? 'vmn_home_bot' : 'other_bot' };
    },
    async sendMessage(token, chatId, text) {
      calls.push({ method: 'sendMessage', token, chatId, text });
    },
    async getUpdates(token, offset) {
      calls.push({ method: 'getUpdates', token, text: String(offset) });
      const batch = updates.filter((update) => offset === null || update.updateId >= offset);
      return batch;
    },
  };
  return {
    api,
    calls,
    push: (list: TelegramUpdate[]) => void (updates = [...updates, ...list]),
    invalidate: (token: string) => void (valid = new Set([...valid].filter((t) => t !== token))),
  };
}

const start = (updateId: number, chatId: string, text: string, from = '@uma_t', chatType = 'private'): TelegramUpdate => ({ updateId, chatId, chatType, text, fromLabel: from });
const tokenOf = (url: string) => new URL(url).searchParams.get('start') ?? '';

describe('notification providers and Telegram pairing (13.7, 13.8)', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let deps: NotificationDeps;
  let telegram: ReturnType<typeof fakeTelegram>;
  let outbox: EmailMessage[];
  let now: Date;
  let admin: User;
  let uma: User;
  let bob: User;

  const configure = () => configureTelegram(deps, { actor: admin, enabled: true, botToken: TOKEN });

  beforeEach(async () => {
    database = createTestDatabase();
    now = new Date('2026-09-29T10:00:00Z');
    telegram = fakeTelegram();
    outbox = [];
    const users = createUserRepository(database);
    admin = await users.create({ email: normalizeEmail('admin@example.org'), displayName: 'Ada', emailVerified: true, status: 'ACTIVE', serverAdmin: true });
    uma = await users.create({ email: normalizeEmail('uma@example.org'), displayName: 'Uma', emailVerified: true, status: 'ACTIVE', serverAdmin: false });
    bob = await users.create({ email: normalizeEmail('bob@example.org'), displayName: 'Bob', emailVerified: true, status: 'ACTIVE', serverAdmin: false });
    deps = {
      providers: createNotificationProviderRepository(database),
      preferences: createNotificationPreferencesRepository(database),
      telegram: createTelegramRepository(database),
      telegramApi: telegram.api,
      secretBox: createSecretBox('a-test-data-encryption-key-of-enough-length'),
      tokens: invitationTokens,
      email: { send: async (message) => void outbox.push(message) },
      emailConfigured: true,
      clock: { now: () => now },
    };
  });
  afterEach(() => database.dispose());

  describe('server-admin configuration', () => {
    it('stores a verified bot token sealed and never returns it', async () => {
      const overview = await configure();
      expect(overview).toEqual({ email: { configured: true, enabled: true }, telegram: { enabled: true, configured: true, botName: 'vmn_home_bot' } });
      expect(JSON.stringify(overview)).not.toContain(TOKEN);
      const stored = database.sqlite.prepare("SELECT sealed_secret AS sealed FROM notification_providers WHERE provider = 'TELEGRAM'").get() as { sealed: string };
      expect(stored.sealed).toMatch(/^v1\./);
      expect(stored.sealed).not.toContain(TOKEN.split(':')[1]);
      // The security log names the change, never the credential.
      const event = database.sqlite.prepare("SELECT metadata FROM security_events WHERE type = 'NOTIFICATION_PROVIDER_CHANGED'").get() as { metadata: string };
      expect(JSON.parse(event.metadata)).toEqual({ enabled: true, credential: 'replaced' });
      expect(event.metadata).not.toContain(TOKEN);
    });

    it('rejects malformed and unverifiable tokens without storing anything', async () => {
      await expect(configureTelegram(deps, { actor: admin, enabled: true, botToken: 'not a token' })).rejects.toBeInstanceOf(DomainValidationError);
      telegram.invalidate(TOKEN);
      await expect(configure()).rejects.toBeInstanceOf(NotificationDeliveryError);
      expect((await getNotificationProviders(deps, { actor: admin })).telegram).toEqual({ enabled: false, configured: false, botName: null });
    });

    it('is for ACTIVE server admins only', async () => {
      await expect(configureTelegram(deps, { actor: uma, enabled: true, botToken: TOKEN })).rejects.toBeInstanceOf(NotAuthorizedError);
      await expect(getNotificationProviders(deps, { actor: uma })).rejects.toBeInstanceOf(NotAuthorizedError);
      await expect(setEmailReminders(deps, { actor: uma, enabled: false })).rejects.toBeInstanceOf(NotAuthorizedError);
      await expect(testNotificationProvider(deps, { actor: uma, provider: 'EMAIL' })).rejects.toBeInstanceOf(NotAuthorizedError);
      await expect(configureTelegram(deps, { actor: { ...admin, status: 'DISABLED' }, enabled: true, botToken: TOKEN })).rejects.toBeInstanceOf(NotAuthorizedError);
      expect(telegram.calls).toEqual([]);
    });

    it('removes the token (and disables Telegram), keeps it when only toggling, cannot enable without it', async () => {
      await configure();
      expect((await configureTelegram(deps, { actor: admin, enabled: false })).telegram).toEqual({ enabled: false, configured: true, botName: 'vmn_home_bot' });
      expect((await configureTelegram(deps, { actor: admin, enabled: true, botToken: null })).telegram).toEqual({ enabled: false, configured: false, botName: null });
    });

    it('sends test messages only to the acting admin', async () => {
      expect(await testNotificationProvider(deps, { actor: admin, provider: 'EMAIL' })).toEqual({ delivered: true });
      expect(outbox.map((message) => message.to)).toEqual(['admin@example.org']);
      expect(await testNotificationProvider(deps, { actor: admin, provider: 'TELEGRAM' })).toEqual({ delivered: false, reason: 'not_configured' });
      await configure();
      expect(await testNotificationProvider(deps, { actor: admin, provider: 'TELEGRAM' })).toEqual({ delivered: false, botName: 'vmn_home_bot', reason: 'not_connected' });
    });
  });

  describe('pairing a Telegram chat', () => {
    beforeEach(configure);

    it('connects a chat only after the signed-in user confirms it', async () => {
      const { url, expiresAt } = await startTelegramPairing(deps, { user: uma });
      expect(url).toMatch(/^https:\/\/t\.me\/vmn_home_bot\?start=[A-Za-z0-9_-]{43}$/);
      expect(expiresAt).toEqual(new Date(now.getTime() + TELEGRAM_PAIRING_TTL_MS));
      // Only the hash is stored.
      const row = database.sqlite.prepare('SELECT token_hash AS hash FROM telegram_pairings').get() as { hash: string };
      expect(row.hash).not.toBe(tokenOf(url));
      expect(row.hash).toHaveLength(64);

      await expect(confirmTelegramPairing(deps, { user: uma })).rejects.toBeInstanceOf(NothingToConfirmError);
      telegram.push([start(10, '555', `/start ${tokenOf(url)}`)]);
      expect(await pollTelegramPairings(deps)).toEqual({ claimed: 1 });
      expect((await getNotificationSettings(deps, { user: uma })).telegram).toMatchObject({ connected: null, pairing: { claimedBy: '@uma_t' } });

      const settings = await confirmTelegramPairing(deps, { user: uma });
      expect(settings.telegram).toMatchObject({ connected: { label: '@uma_t' }, pairing: null });
      expect(database.sqlite.prepare('SELECT chat_id AS chat FROM telegram_links WHERE user_id = ?').get(uma.id)).toEqual({ chat: '555' });
      expect(telegram.calls.filter((c) => c.method === 'sendMessage').map((c) => c.chatId)).toEqual(['555', '555']);
    });

    it('uses a pairing token once, never after it expired, and only in private chats', async () => {
      const first = await startTelegramPairing(deps, { user: uma });
      telegram.push([start(1, '777', `/start ${tokenOf(first.url)}`, '@group', 'group')]);
      expect(await pollTelegramPairings(deps)).toEqual({ claimed: 0 });
      telegram.push([start(2, '555', `/start ${tokenOf(first.url)}`), start(3, '666', `/start ${tokenOf(first.url)}`, '@mallory')]);
      expect(await pollTelegramPairings(deps)).toEqual({ claimed: 1 });
      expect((await getNotificationSettings(deps, { user: uma })).telegram.pairing?.claimedBy).toBe('@uma_t');

      const second = await startTelegramPairing(deps, { user: bob });
      now = new Date(now.getTime() + TELEGRAM_PAIRING_TTL_MS + 1000);
      telegram.push([start(4, '888', `/start ${tokenOf(second.url)}`)]);
      expect(await pollTelegramPairings(deps)).toEqual({ claimed: 0 });
      await expect(confirmTelegramPairing(deps, { user: uma })).rejects.toBeInstanceOf(NothingToConfirmError);
    });

    it('never lets one account confirm or take over another account’s pairing', async () => {
      const umas = await startTelegramPairing(deps, { user: uma });
      telegram.push([start(1, '555', `/start ${tokenOf(umas.url)}`)]);
      await pollTelegramPairings(deps);
      await expect(confirmTelegramPairing(deps, { user: bob })).rejects.toBeInstanceOf(NothingToConfirmError);
      expect(await deps.telegram.link(bob.id)).toBeUndefined();
      // A new pairing replaces the open one: the old link stops working.
      const again = await startTelegramPairing(deps, { user: uma });
      telegram.push([start(2, '999', `/start ${tokenOf(umas.url)}`)]);
      expect(await pollTelegramPairings(deps)).toEqual({ claimed: 0 });
      expect((await getNotificationSettings(deps, { user: uma })).telegram.pairing?.claimedBy).toBeNull();
      await cancelTelegramPairing(deps, { user: uma });
      telegram.push([start(3, '555', `/start ${tokenOf(again.url)}`)]);
      expect(await pollTelegramPairings(deps)).toEqual({ claimed: 0 });
    });

    it('handles each update once and does not poll without an open pairing', async () => {
      await pollTelegramPairings(deps);
      expect(telegram.calls.filter((c) => c.method === 'getUpdates')).toEqual([]);
      const { url } = await startTelegramPairing(deps, { user: uma });
      telegram.push([start(41, '555', 'hello'), start(42, '555', `/start ${tokenOf(url)}`)]);
      await pollTelegramPairings(deps);
      await pollTelegramPairings(deps);
      expect(telegram.calls.filter((c) => c.method === 'getUpdates').map((c) => c.text)).toEqual(['null', '43']);
    });

    it('disconnects, and stops Telegram reminders', async () => {
      const { url } = await startTelegramPairing(deps, { user: uma });
      telegram.push([start(1, '555', `/start ${tokenOf(url)}`)]);
      await pollTelegramPairings(deps);
      await confirmTelegramPairing(deps, { user: uma });
      const notifier = telegramReminderNotifier(deps);
      expect(await notifier.enabledFor(uma)).toBe(true);
      await updateNotificationSettings(deps, { user: uma, changes: { telegramReminders: false } });
      expect(await notifier.enabledFor(uma)).toBe(false);
      await updateNotificationSettings(deps, { user: uma, changes: { telegramReminders: true } });
      expect((await disconnectTelegram(deps, { user: uma })).telegram.connected).toBeNull();
      expect(await notifier.enabledFor(uma)).toBe(false);
      const types = database.sqlite.prepare("SELECT type FROM security_events WHERE type LIKE 'TELEGRAM_%' ORDER BY rowid").all();
      expect(types).toEqual([{ type: 'TELEGRAM_CONNECTED' }, { type: 'TELEGRAM_DISCONNECTED' }]);
    });

    it('refuses to start pairing while Telegram is disabled', async () => {
      await configureTelegram(deps, { actor: admin, enabled: false });
      await expect(startTelegramPairing(deps, { user: uma })).rejects.toBeInstanceOf(TelegramUnavailableError);
      expect((await getNotificationSettings(deps, { user: uma })).telegram.available).toBe(false);
    });
  });

  it('keeps a person’s reminder settings and validates the default reminder time', async () => {
    expect(await getNotificationSettings(deps, { user: uma })).toMatchObject({ reminderTime: '09:00', email: { available: true, enabled: true } });
    expect(await updateNotificationSettings(deps, { user: uma, changes: { reminderTime: '07:15', emailReminders: false } })).toMatchObject({
      reminderTime: '07:15',
      email: { enabled: false },
    });
    await expect(updateNotificationSettings(deps, { user: uma, changes: { reminderTime: '7:15' } })).rejects.toBeInstanceOf(DomainValidationError);
    await setEmailReminders(deps, { actor: admin, enabled: false });
    expect((await getNotificationSettings(deps, { user: uma })).email.available).toBe(false);
  });

  it('shows chat names safely', () => {
    expect(sanitizeChatLabel('@uma_t')).toBe('@uma_t');
    expect(sanitizeChatLabel('Eve‮mallory')).toBe('Evemallory');
    expect(sanitizeChatLabel('x'.repeat(100))).toHaveLength(64);
    expect(sanitizeChatLabel(null)).toBe('Telegram');
    expect(sanitizeChatLabel('\u0000​')).toBe('Telegram');
  });
});
