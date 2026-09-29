import { DEFAULT_REMINDER_TIME, DomainValidationError, canAuthenticate, isActiveServerAdmin, parseLocalTime, type User } from '@vergissmeinnicht/domain';
import { emailTextsEn } from '../email-texts/en.ts';
import { NotAuthorizedError } from '../invitations/errors.ts';
import type { Clock } from '../ports/clock.ts';
import type { EmailSender } from '../ports/email-sender.ts';
import type { InvitationTokens } from '../ports/invitation-tokens.ts';
import type { SecretBox } from '../ports/mfa.ts';
import type { NotificationProviderRepository, TelegramBotApi, TelegramRepository } from '../ports/notifications.ts';
import { NotificationDeliveryError, type ReminderMessage, type ReminderNotifier } from '../ports/reminders.ts';
import type { NotificationPreferences, NotificationPreferencesRepository } from '../ports/schedule-repository.ts';
import { userActor } from '../user-actor.ts';

export interface NotificationDeps {
  readonly providers: NotificationProviderRepository;
  readonly preferences: NotificationPreferencesRepository;
  readonly telegram: TelegramRepository;
  readonly telegramApi: TelegramBotApi;
  readonly secretBox: SecretBox;
  readonly tokens: InvitationTokens;
  readonly email: EmailSender;
  /** SMTP is configured (always in production). */
  readonly emailConfigured: boolean;
  readonly clock: Clock;
}

/** A pairing link is usable this long. */
export const TELEGRAM_PAIRING_TTL_MS = 10 * 60_000;
/** The bot token is bound to its purpose as associated data: a sealed value copied elsewhere does not open. */
const TELEGRAM_SECRET_CONTEXT = 'notification-provider:TELEGRAM';
/** Bot API tokens look like `123456789:AA…` (id, colon, 35 URL-safe characters today). */
const BOT_TOKEN = /^\d{5,15}:[A-Za-z0-9_-]{30,64}$/;
const START_COMMAND = /^\/start ([A-Za-z0-9_-]{43})$/;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = Object.freeze({
  reminderTime: DEFAULT_REMINDER_TIME as NotificationPreferences['reminderTime'],
  emailReminders: true,
  telegramReminders: true,
});

async function preferencesOf(deps: Pick<NotificationDeps, 'preferences'>, user: User): Promise<NotificationPreferences> {
  return (await deps.preferences.find(user.id)) ?? DEFAULT_NOTIFICATION_PREFERENCES;
}

/** The stored bot token, opened for one use. Never returned to a client, never logged. */
async function telegramToken(deps: Pick<NotificationDeps, 'providers' | 'secretBox'>): Promise<string | undefined> {
  const sealed = await deps.providers.sealedSecret('TELEGRAM');
  return sealed === null ? undefined : deps.secretBox.open(sealed, TELEGRAM_SECRET_CONTEXT);
}

/** What Telegram tells about a chat is user-controlled: keep it short, visible and unspoofable. */
export function sanitizeChatLabel(label: string | null): string {
  const clean = [...(label ?? '').replace(/[\p{C}\p{Zl}\p{Zp}]/gu, '').trim()].slice(0, 64).join('');
  return clean === '' ? 'Telegram' : clean;
}

// ---- Reminder channels (13.6, 13.7)

/** Email reminders: the existing SMTP sender; on unless the server admin or the person turned them off. */
export function emailReminderNotifier(deps: Pick<NotificationDeps, 'providers' | 'preferences' | 'email' | 'emailConfigured'>): ReminderNotifier {
  return {
    channel: 'EMAIL',
    async enabledFor(user) {
      return deps.emailConfigured && (await deps.providers.get('EMAIL')).enabled && (await preferencesOf(deps, user)).emailReminders;
    },
    async send(user, message: ReminderMessage) {
      try {
        await deps.email.send({ to: user.email, subject: emailTextsEn.reminder.subject(message), text: emailTextsEn.reminder.body(message) });
      } catch {
        // The SMTP adapter's errors carry a reason code only; treat them as transient (server down, …).
        throw new NotificationDeliveryError('email_failed', true);
      }
    },
  };
}

/** Telegram reminders: only with an enabled provider, a stored token, a connected chat and the person's consent. */
export function telegramReminderNotifier(deps: Pick<NotificationDeps, 'providers' | 'preferences' | 'telegram' | 'telegramApi' | 'secretBox'>): ReminderNotifier {
  return {
    channel: 'TELEGRAM',
    async enabledFor(user) {
      const provider = await deps.providers.get('TELEGRAM');
      if (!provider.enabled || !provider.hasSecret) return false;
      return (await preferencesOf(deps, user)).telegramReminders && (await deps.telegram.link(user.id)) !== undefined;
    },
    async send(user, message) {
      const token = await telegramToken(deps);
      const link = await deps.telegram.link(user.id);
      if (token === undefined) throw new NotificationDeliveryError('telegram_not_configured', false);
      if (link === undefined) throw new NotificationDeliveryError('telegram_not_connected', false);
      await deps.telegramApi.sendMessage(token, link.chatId, `${emailTextsEn.reminder.subject(message)}\n\n${emailTextsEn.reminder.body(message)}`);
    },
  };
}

// ---- Server admin: provider configuration (13.7, 13.10)

function requireServerAdmin(actor: User): void {
  if (!isActiveServerAdmin(actor)) throw new NotAuthorizedError();
}

export interface ProvidersOverview {
  readonly email: { readonly configured: boolean; readonly enabled: boolean };
  readonly telegram: { readonly enabled: boolean; readonly configured: boolean; readonly botName: string | null };
}

export async function getNotificationProviders(deps: NotificationDeps, input: { readonly actor: User }): Promise<ProvidersOverview> {
  requireServerAdmin(input.actor);
  const [email, telegram] = [await deps.providers.get('EMAIL'), await deps.providers.get('TELEGRAM')];
  return {
    email: { configured: deps.emailConfigured, enabled: email.enabled },
    telegram: { enabled: telegram.enabled, configured: telegram.hasSecret, botName: telegram.publicLabel },
  };
}

export async function setEmailReminders(deps: NotificationDeps, input: { readonly actor: User; readonly enabled: boolean }): Promise<ProvidersOverview> {
  requireServerAdmin(input.actor);
  if (!(await deps.providers.save('EMAIL', { enabled: input.enabled }, deps.clock.now(), userActor(input.actor)))) throw new NotAuthorizedError();
  return getNotificationProviders(deps, input);
}

/**
 * Configures the Telegram provider. A new bot token is checked with Telegram (getMe) before it is
 * stored — sealed; it is never returned. `botToken: null` removes it (and disables the provider).
 */
export async function configureTelegram(
  deps: NotificationDeps,
  input: { readonly actor: User; readonly enabled: boolean; readonly botToken?: string | null | undefined },
): Promise<ProvidersOverview> {
  requireServerAdmin(input.actor);
  let sealedSecret: string | null | undefined;
  let publicLabel: string | null | undefined;
  if (input.botToken === null) {
    sealedSecret = null;
    publicLabel = null;
  } else if (input.botToken !== undefined) {
    const token = input.botToken.trim();
    if (!BOT_TOKEN.test(token)) throw new DomainValidationError('botToken', 'invalid_bot_token', 'This is not a Telegram bot token');
    const me = await deps.telegramApi.getMe(token);
    sealedSecret = deps.secretBox.seal(token, TELEGRAM_SECRET_CONTEXT);
    publicLabel = me.username;
  }
  const hasSecret = sealedSecret === undefined ? (await deps.providers.get('TELEGRAM')).hasSecret : sealedSecret !== null;
  const change = {
    enabled: input.enabled && hasSecret,
    ...(sealedSecret === undefined ? {} : { sealedSecret }),
    ...(publicLabel === undefined ? {} : { publicLabel }),
  };
  if (!(await deps.providers.save('TELEGRAM', change, deps.clock.now(), userActor(input.actor)))) throw new NotAuthorizedError();
  return getNotificationProviders(deps, input);
}

/**
 * Checks a provider with a real message to the acting admin (their own email address / connected
 * Telegram chat) — never to an address given in the request.
 */
export async function testNotificationProvider(
  deps: NotificationDeps,
  input: { readonly actor: User; readonly provider: 'EMAIL' | 'TELEGRAM' },
): Promise<{ readonly delivered: boolean; readonly botName?: string; readonly reason?: string }> {
  requireServerAdmin(input.actor);
  const text = emailTextsEn.providerTest;
  if (input.provider === 'EMAIL') {
    if (!deps.emailConfigured) return { delivered: false, reason: 'not_configured' };
    try {
      await deps.email.send({ to: input.actor.email, subject: text.subject, text: text.body({ provider: 'email' }) });
      return { delivered: true };
    } catch {
      return { delivered: false, reason: 'email_failed' };
    }
  }
  const token = await telegramToken(deps);
  if (token === undefined) return { delivered: false, reason: 'not_configured' };
  try {
    const me = await deps.telegramApi.getMe(token);
    const link = await deps.telegram.link(input.actor.id);
    if (link === undefined) return { delivered: false, botName: me.username, reason: 'not_connected' };
    await deps.telegramApi.sendMessage(token, link.chatId, `${text.subject}\n\n${text.body({ provider: 'Telegram' })}`);
    return { delivered: true, botName: me.username };
  } catch (error) {
    return { delivered: false, reason: error instanceof NotificationDeliveryError ? error.code : 'telegram_failed' };
  }
}

// ---- A person's own notification settings (13.8)

export interface NotificationSettingsView {
  readonly reminderTime: string;
  readonly email: { readonly available: boolean; readonly enabled: boolean };
  readonly telegram: {
    readonly available: boolean;
    readonly enabled: boolean;
    readonly connected: { readonly label: string; readonly connectedAt: Date } | null;
    /** An open pairing: when it expires and, once a chat sent /start, which chat asks to connect. */
    readonly pairing: { readonly expiresAt: Date; readonly claimedBy: string | null } | null;
  };
}

function requireActive(user: User): void {
  if (!canAuthenticate(user)) throw new NotAuthorizedError();
}

export async function getNotificationSettings(deps: NotificationDeps, input: { readonly user: User }): Promise<NotificationSettingsView> {
  requireActive(input.user);
  const preferences = await preferencesOf(deps, input.user);
  const email = await deps.providers.get('EMAIL');
  const telegram = await deps.providers.get('TELEGRAM');
  const link = await deps.telegram.link(input.user.id);
  const pairing = await deps.telegram.openPairing(input.user.id, deps.clock.now());
  return {
    reminderTime: preferences.reminderTime,
    email: { available: deps.emailConfigured && email.enabled, enabled: preferences.emailReminders },
    telegram: {
      available: telegram.enabled && telegram.hasSecret && telegram.publicLabel !== null,
      enabled: preferences.telegramReminders,
      connected: link === undefined ? null : { label: link.chatLabel, connectedAt: link.connectedAt },
      pairing: pairing === undefined ? null : { expiresAt: pairing.expiresAt, claimedBy: pairing.claimedBy },
    },
  };
}

export async function updateNotificationSettings(
  deps: NotificationDeps,
  input: {
    readonly user: User;
    readonly changes: { readonly reminderTime?: string | undefined; readonly emailReminders?: boolean | undefined; readonly telegramReminders?: boolean | undefined };
  },
): Promise<NotificationSettingsView> {
  requireActive(input.user);
  const current = await preferencesOf(deps, input.user);
  const next: NotificationPreferences = {
    reminderTime: input.changes.reminderTime === undefined ? current.reminderTime : parseLocalTime(input.changes.reminderTime, 'reminderTime'),
    emailReminders: input.changes.emailReminders ?? current.emailReminders,
    telegramReminders: input.changes.telegramReminders ?? current.telegramReminders,
  };
  await deps.preferences.save(input.user.id, next, deps.clock.now());
  return getNotificationSettings(deps, input);
}

/**
 * Starts connecting a Telegram chat (13.7): a 256-bit one-time token, valid 10 minutes, stored only
 * as a hash. The user opens the returned `t.me` link and sends /start; the chat is connected only
 * after the user confirms it here, signed in — a leaked link alone connects nothing.
 */
export async function startTelegramPairing(deps: NotificationDeps, input: { readonly user: User }): Promise<{ readonly url: string; readonly expiresAt: Date }> {
  requireActive(input.user);
  const provider = await deps.providers.get('TELEGRAM');
  if (!provider.enabled || !provider.hasSecret || provider.publicLabel === null) throw new TelegramUnavailableError();
  const { token, hash } = deps.tokens.generate();
  const now = deps.clock.now();
  const pairing = await deps.telegram.createPairing({ userId: input.user.id, tokenHash: hash, at: now, expiresAt: new Date(now.getTime() + TELEGRAM_PAIRING_TTL_MS) });
  return { url: `https://t.me/${encodeURIComponent(provider.publicLabel)}?start=${token}`, expiresAt: pairing.expiresAt };
}

export async function confirmTelegramPairing(deps: NotificationDeps, input: { readonly user: User }): Promise<NotificationSettingsView> {
  requireActive(input.user);
  const now = deps.clock.now();
  const pairing = await deps.telegram.openPairing(input.user.id, now);
  if (pairing === undefined || pairing.claimedBy === null) throw new NothingToConfirmError();
  const link = await deps.telegram.confirmPairing(input.user.id, pairing.id, now, userActor(input.user));
  if (link === undefined) throw new NothingToConfirmError();
  const token = await telegramToken(deps);
  if (token !== undefined) {
    // Best effort: tell the chat it is connected. Failure changes nothing.
    await deps.telegramApi.sendMessage(token, link.chatId, 'Connected to VergissMeinNicht. Reminders of Procedures you schedule will arrive here.').catch(() => undefined);
  }
  return getNotificationSettings(deps, input);
}

export async function cancelTelegramPairing(deps: NotificationDeps, input: { readonly user: User }): Promise<NotificationSettingsView> {
  requireActive(input.user);
  await deps.telegram.cancelPairings(input.user.id, deps.clock.now());
  return getNotificationSettings(deps, input);
}

export async function disconnectTelegram(deps: NotificationDeps, input: { readonly user: User }): Promise<NotificationSettingsView> {
  requireActive(input.user);
  await deps.telegram.disconnect(input.user.id, deps.clock.now(), userActor(input.user));
  return getNotificationSettings(deps, input);
}

/**
 * Polls the bot for /start messages while a pairing is open (13.7) — no webhook, so it also works
 * behind a VPN. Only `/start <token>` in a private chat is acted on; everything else is ignored.
 * Each update is handled once (stored offset); a claimed pairing still needs the owner's
 * confirmation in VMN.
 */
export async function pollTelegramPairings(deps: NotificationDeps): Promise<{ readonly claimed: number }> {
  const now = deps.clock.now();
  if (!(await deps.telegram.anyOpenPairing(now))) return { claimed: 0 };
  const provider = await deps.providers.get('TELEGRAM');
  const token = provider.enabled ? await telegramToken(deps) : undefined;
  if (token === undefined) return { claimed: 0 };
  const updates = await deps.telegramApi.getUpdates(token, await deps.providers.pollOffset(), 100);
  let claimed = 0;
  for (const update of updates) {
    const match = update.text === null ? null : START_COMMAND.exec(update.text.trim());
    const hash = match?.[1] === undefined ? undefined : deps.tokens.hash(match[1]);
    if (hash !== undefined && update.chatType === 'private' && update.chatId !== null) {
      const ok = await deps.telegram.claimPairing({ tokenHash: hash, chatId: update.chatId, chatLabel: sanitizeChatLabel(update.fromLabel), at: now });
      if (ok) claimed++;
      const reply = ok
        ? 'Almost done: go back to VergissMeinNicht and confirm this chat under Profile & settings → Notifications.'
        : 'This connection link is not valid (any more). Start again in VergissMeinNicht under Profile & settings → Notifications.';
      await deps.telegramApi.sendMessage(token, update.chatId, reply).catch(() => undefined);
    }
  }
  const last = updates.at(-1);
  if (last !== undefined) await deps.providers.savePollOffset(last.updateId + 1);
  return { claimed };
}

/** Telegram is not enabled/configured on this server. */
export class TelegramUnavailableError extends Error {
  constructor() {
    super('Telegram is not available on this server');
    this.name = 'TelegramUnavailableError';
  }
}

/** No chat has claimed the pairing yet (or it expired). */
export class NothingToConfirmError extends Error {
  constructor() {
    super('No Telegram chat is waiting for confirmation');
    this.name = 'NothingToConfirmError';
  }
}
