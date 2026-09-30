import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { NotificationProviders, NotificationSettings } from './api.ts';
import { TelegramProvider, telegramAdminState } from './AdminPage.tsx';
import { TelegramConnection, telegramStage, testFailureMessage } from './NotificationSettings.tsx';

const noop = () => undefined;

// ---- Server admin → Notification providers → Telegram

type Bot = NotificationProviders['telegram'];
const NO_BOT: Bot = { configured: false, enabled: false, botName: null };
const BOT_ON: Bot = { configured: true, enabled: true, botName: 'VergissMeinNichtBot' };
const BOT_OFF: Bot = { configured: true, enabled: false, botName: 'VergissMeinNichtBot' };

function admin(telegram: Bot, ownConnection: string | null | undefined): string {
  return renderToStaticMarkup(
    <TelegramProvider
      telegram={telegram}
      ownConnection={ownConnection}
      token=""
      enabled={telegram.enabled}
      busy={false}
      onToken={noop}
      onEnabled={noop}
      onSave={noop}
      onTest={noop}
      onRemove={noop}
    />,
  );
}

const testButton = (html: string) => /<button[^>]*>Send test message to my Telegram<\/button>/.exec(html)?.[0];

describe('Telegram provider (server admin)', () => {
  it('bot not configured: explains the server-wide scope, asks for the BotFather token, offers no test', () => {
    const html = admin(NO_BOT, null);
    expect(telegramAdminState(NO_BOT, null)).toBe('not-configured');
    expect(html).toContain('Configure the Telegram bot used by this VergissMeinNicht instance');
    expect(html).toContain('each user must connect their own Telegram account under Profile &amp; settings → Notifications');
    expect(html).toContain('No bot configured yet.');
    expect(html).toContain('Bot token');
    expect(html).toContain('@BotFather');
    expect(html).toContain('stored encrypted');
    expect(html).not.toContain('Bot connected');
    expect(html).not.toContain('Next step');
    expect(testButton(html)).toBeUndefined();
    // The only input is the token (password field); there is no destination chat to enter.
    expect(html.match(/<input/g)).toHaveLength(2);
    expect(html).toMatch(/<input type="password" autoComplete="off"/i);
  });

  it('bot configured, current admin not paired: shows the bot, the next step with a link, and a disabled test', () => {
    const html = admin(BOT_ON, null);
    expect(telegramAdminState(BOT_ON, null)).toBe('admin-not-paired');
    expect(html).toContain('Bot connected: @VergissMeinNichtBot');
    expect(html).toContain('Next step');
    expect(html).toContain('Telegram is available on this server. To receive reminders, open Profile &amp; settings → Notifications and connect your Telegram account.');
    expect(html).toMatch(/<a href="\/account#notifications"[^>]*>Go to my notification settings<\/a>/);
    const button = testButton(html);
    expect(button).toContain('disabled');
    expect(button).toContain('aria-describedby="telegram-test-hint"');
    expect(html).toContain('The test message goes to your personal Telegram chat, not to a server-wide chat.');
    expect(html).toContain('Leave empty to keep the current token.');
  });

  it('bot configured, current admin paired: names the admin’s chat and enables the test', () => {
    const html = admin(BOT_ON, '@ada');
    expect(telegramAdminState(BOT_ON, '@ada')).toBe('admin-paired');
    expect(html).toContain('Bot connected: @VergissMeinNichtBot');
    expect(html).toContain('Your own account is connected to Telegram as @ada');
    expect(html).not.toContain('Next step');
    expect(testButton(html)).not.toContain('disabled');
  });

  it('own connection unknown: still points to the next step, test stays usable (the server decides)', () => {
    const html = admin(BOT_ON, undefined);
    expect(telegramAdminState(BOT_ON, undefined)).toBe('admin-unknown');
    expect(html).toContain('Go to my notification settings');
    expect(testButton(html)).not.toContain('disabled');
  });

  it('bot configured but switched off: says so and does not invite pairing', () => {
    const html = admin(BOT_OFF, null);
    expect(telegramAdminState(BOT_OFF, null)).toBe('off');
    expect(html).toContain('switched off');
    expect(html).not.toContain('Next step');
  });

  it('a test to an admin without a chat explains the missing pairing instead of a generic failure', () => {
    expect(testFailureMessage('not_connected')).toBe(
      'Telegram bot configured successfully, but your account is not connected to Telegram yet. Connect Telegram under Profile & settings → Notifications before sending a test message.',
    );
    expect(testFailureMessage('something_new')).toBe('The test message could not be sent.');
    expect(testFailureMessage(undefined)).toBe('The test message could not be sent.');
  });
});

// ---- Profile & settings → Notifications → Telegram

type Telegram = NotificationSettings['telegram'];
const IN_TEN_MINUTES = new Date(Date.now() + 600_000).toISOString();
const UNAVAILABLE: Telegram = { available: false, enabled: true, connected: null, pairing: null };
const READY: Telegram = { available: true, enabled: true, connected: null, pairing: null };
const WAITING: Telegram = { ...READY, pairing: { expiresAt: IN_TEN_MINUTES, claimedBy: null } };
const CLAIMED: Telegram = { ...READY, pairing: { expiresAt: IN_TEN_MINUTES, claimedBy: '@ada' } };
const CONNECTED: Telegram = { ...READY, connected: { label: '@ada', connectedAt: new Date().toISOString() } };

function account(telegram: Telegram, options: { link?: string; serverAdmin?: boolean } = {}): string {
  return renderToStaticMarkup(
    <TelegramConnection
      telegram={telegram}
      pairingLink={options.link ?? null}
      busy={false}
      serverAdmin={options.serverAdmin ?? false}
      onConnect={noop}
      onConfirm={noop}
      onCancel={noop}
      onDisconnect={noop}
      onReminders={noop}
      onTest={noop}
    />,
  );
}

const currentStep = (html: string) => /<li aria-current="step"[^>]*>(.*?)<\/li>/.exec(html)?.[1];

describe('Telegram connection (account)', () => {
  it('bot not configured on the server: says so, nothing to connect', () => {
    const html = account(UNAVAILABLE);
    expect(telegramStage(UNAVAILABLE)).toBe('unavailable');
    expect(html).toContain('Telegram is not set up on this server.');
    expect(html).not.toContain('Connect Telegram</button>');
    expect(currentStep(html)).toBeUndefined();
  });

  it('available: shows the whole sequence with “Connect Telegram” as the current step', () => {
    const html = account(READY);
    expect(telegramStage(READY)).toBe('ready');
    expect(html).toContain('Telegram is available on this server.');
    for (const step of ['Connect Telegram', 'Open Telegram and press Start', 'Come back here and confirm the chat', 'Connected — reminders arrive in Telegram']) {
      expect(html).toContain(step);
    }
    expect(currentStep(html)).toContain('Connect Telegram');
    expect(html).toMatch(/<button[^>]*>Connect Telegram<\/button>/);
    // No chat ID is ever typed in: the server learns the chat during pairing.
    expect(html).toContain('no chat ID needed');
    expect(html).not.toContain('<input');
  });

  it('pairing pending: link to the bot (once), waiting for Telegram, earlier step marked done', () => {
    const link = 'https://t.me/VergissMeinNichtBot?start=abc';
    const html = account(WAITING, { link });
    expect(telegramStage(WAITING)).toBe('waiting');
    expect(currentStep(html)).toContain('Open Telegram and press Start');
    expect(html).toContain('✓');
    expect(html).toContain('(done)');
    expect(html).toContain(`href="${link.replace('&', '&amp;')}"`);
    expect(html).toContain('Open Telegram</a>');
    expect(html).toContain('Waiting for Telegram…');
    // In another tab (or after a reload) the one-time link is not shown again.
    const again = account(WAITING);
    expect(again).not.toContain('t.me');
    expect(again).toContain('A connection is being set up in another window.');
  });

  it('pairing claimed but not confirmed: asks to confirm the named chat, or “Not me”', () => {
    const html = account(CLAIMED);
    expect(telegramStage(CLAIMED)).toBe('claimed');
    expect(currentStep(html)).toContain('Come back here and confirm the chat');
    expect(html).toContain('The Telegram chat “@ada” pressed Start and wants to receive your reminders.');
    expect(html).toMatch(/<button[^>]*>Confirm<\/button>/);
    expect(html).toMatch(/<button[^>]*>Not me<\/button>/);
  });

  it('pairing confirmed: shows the safe label, reminders switch and Disconnect; no steps any more', () => {
    const html = account(CONNECTED);
    expect(telegramStage(CONNECTED)).toBe('connected');
    expect(html).toContain('Connected to Telegram as @ada');
    expect(html).toContain('Procedure reminders');
    expect(html).toMatch(/<button[^>]*>Disconnect Telegram<\/button>/);
    expect(currentStep(html)).toBeUndefined();
    // Only server admins get the test (it reuses the admin test, which sends to one's own chat).
    expect(html).not.toContain('Send test message to my Telegram');
    expect(account(CONNECTED, { serverAdmin: true })).toContain('Send test message to my Telegram');
  });

  it('Telegram disconnected: back to “Connect Telegram”', () => {
    const html = account({ ...CONNECTED, connected: null });
    expect(currentStep(html)).toContain('Connect Telegram');
    expect(html).not.toContain('Connected to Telegram as');
  });

  it('connected while the server switched Telegram off: stays connected, says nothing is sent', () => {
    const html = account({ ...CONNECTED, available: false }, { serverAdmin: true });
    expect(html).toContain('Connected to Telegram as @ada');
    expect(html).toContain('switched off on this server');
    expect(html).not.toContain('Send test message to my Telegram');
  });
});
