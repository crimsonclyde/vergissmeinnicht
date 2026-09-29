import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotificationDeliveryError, pollTelegramPairings, type TelegramBotApi, type TelegramUpdate } from '@vergissmeinnicht/application';
import { startTestApp } from './test-harness.ts';

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ';
const SECRET_PART = TOKEN.split(':')[1] ?? '';

function fakeTelegram() {
  const sent: { chatId: string; text: string }[] = [];
  let updates: TelegramUpdate[] = [];
  const api: TelegramBotApi = {
    async getMe(token) {
      if (token !== TOKEN) throw new NotificationDeliveryError('telegram_invalid_token', false);
      return { username: 'vmn_home_bot' };
    },
    async sendMessage(_token, chatId, text) {
      sent.push({ chatId, text });
    },
    async getUpdates(_token, offset) {
      return updates.filter((update) => offset === null || update.updateId >= offset);
    },
  };
  return { api, sent, push: (list: TelegramUpdate[]) => void (updates = [...updates, ...list]) };
}

describe('notification HTTP API (13.7, 13.8)', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let telegram: ReturnType<typeof fakeTelegram>;
  let user: string;
  const admin = () => t.admin;

  beforeEach(async () => {
    telegram = fakeTelegram();
    t = await startTestApp({ telegramApi: telegram.api, captureLogs: true });
    user = await t.invite('user@example.org', 'Uma');
  });
  afterEach(async () => t.close());

  it('lets only server admins configure providers, and never returns or logs the bot token', async () => {
    for (const [url, body] of [
      ['/api/admin/notifications/telegram', { enabled: true, botToken: TOKEN }],
      ['/api/admin/notifications/email', { enabled: false }],
      ['/api/admin/notifications/test', { provider: 'EMAIL' }],
    ] as const) {
      expect((await t.post(url, body, user)).statusCode).toBe(403);
      expect((await t.post(url, body)).statusCode).toBe(401);
      expect((await t.post(url, body, admin(), null)).statusCode).toBe(403); // missing Origin
    }
    expect((await t.get('/api/admin/notifications', user)).statusCode).toBe(403);

    const configured = await t.post('/api/admin/notifications/telegram', { enabled: true, botToken: TOKEN }, admin());
    expect(configured.json()).toEqual({
      providers: { email: { configured: true, enabled: true }, telegram: { enabled: true, configured: true, botName: 'vmn_home_bot' } },
    });
    const overview = await t.get('/api/admin/notifications', admin());
    const events = await t.get('/api/admin/security-events', admin());
    for (const text of [configured.body, overview.body, events.body, t.logs]) expect(text).not.toContain(SECRET_PART);
    // A token Telegram does not accept: a stable reason, nothing stored.
    const rejected = await t.post('/api/admin/notifications/telegram', { enabled: true, botToken: '555555555:ZZHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ' }, admin());
    expect(rejected.json()).toEqual({ error: 'provider_check_failed', reason: 'telegram_invalid_token' });
    expect((await t.post('/api/admin/notifications/telegram', { enabled: true, botToken: 'x', extra: 1 }, admin())).statusCode).toBe(400);
  });

  it('rate-limits provider tests', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await t.post('/api/admin/notifications/test', { provider: 'EMAIL' }, admin())).statusCode);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    expect(t.outbox.filter((message) => message.subject === 'VergissMeinNicht test notification').map((message) => message.to)).toEqual(
      Array(5).fill('admin@example.org'),
    );
  });

  it('lets people manage their own channels and connect Telegram with confirmation', async () => {
    const initial = (await t.get('/api/account/notifications', user)).json().settings;
    expect(initial).toEqual({
      reminderTime: '09:00',
      email: { available: true, enabled: true },
      telegram: { available: false, enabled: true, connected: null, pairing: null },
    });
    expect((await t.post('/api/account/notifications/telegram/pair', undefined, user)).json()).toEqual({ error: 'telegram_unavailable' });
    await t.post('/api/admin/notifications/telegram', { enabled: true, botToken: TOKEN }, admin());

    const updated = await t.post('/api/account/notifications', { reminderTime: '07:30', emailReminders: false }, user);
    expect(updated.json().settings).toMatchObject({ reminderTime: '07:30', email: { enabled: false } });
    for (const body of [{}, { reminderTime: '7:30' }, { reminderTime: '07:30', smtp: 'x' }]) {
      expect((await t.post('/api/account/notifications', body, user)).statusCode).toBe(400);
    }

    const pairing = (await t.post('/api/account/notifications/telegram/pair', undefined, user)).json();
    expect(pairing.url).toMatch(/^https:\/\/t\.me\/vmn_home_bot\?start=[A-Za-z0-9_-]{43}$/);
    const token = new URL(pairing.url).searchParams.get('start') ?? '';
    expect((await t.post('/api/account/notifications/telegram/confirm', undefined, user)).json()).toEqual({ error: 'nothing_to_confirm' });
    telegram.push([{ updateId: 1, chatId: '555', chatType: 'private', text: `/start ${token}`, fromLabel: '@uma_t' }]);
    // The server's poller (13.7) — run once here instead of waiting for the interval.
    await pollTelegramPairings(t.services.notifications);
    // Another account cannot confirm Uma's pairing.
    const bob = await t.invite('bob@example.org', 'Bob');
    expect((await t.post('/api/account/notifications/telegram/confirm', undefined, bob)).json()).toEqual({ error: 'nothing_to_confirm' });
    const confirmed = await t.post('/api/account/notifications/telegram/confirm', undefined, user);
    expect(confirmed.json().settings.telegram).toMatchObject({ connected: { label: '@uma_t' }, pairing: null });
    expect(confirmed.body).not.toMatch(/555|chatId/);
    expect(t.logs).not.toContain(token);
    const disconnected = await t.post('/api/account/notifications/telegram/disconnect', undefined, user);
    expect(disconnected.json().settings.telegram.connected).toBeNull();
  });
});
