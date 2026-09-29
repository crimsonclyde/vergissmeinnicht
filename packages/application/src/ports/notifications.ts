import type { Actor, UserId } from '@vergissmeinnicht/domain';
import type { NotificationChannel } from './reminders.ts';

/** Server-wide state of one provider. Never contains the provider credential itself. */
export interface ProviderState {
  readonly enabled: boolean;
  /** A credential is stored (Telegram bot token); email is configured through the environment. */
  readonly hasSecret: boolean;
  /** Non-secret display value, e.g. the Telegram bot's user name for pairing links. */
  readonly publicLabel: string | null;
}

/**
 * Provider configuration (13.7, 13.10). Credentials are stored only sealed (AES-256-GCM with
 * DATA_ENCRYPTION_KEY) and are read back only by the infrastructure that uses them.
 */
export interface NotificationProviderRepository {
  get(provider: NotificationChannel): Promise<ProviderState>;
  /** The sealed credential — for the provider adapter only, never for any response. */
  sealedSecret(provider: NotificationChannel): Promise<string | null>;
  /**
   * In one IMMEDIATE transaction: re-checks that the actor is an ACTIVE server admin, stores the
   * change (`sealedSecret` undefined = keep, null = remove) and records NOTIFICATION_PROVIDER_CHANGED
   * (without the credential). Returns false (nothing written) if not allowed.
   */
  save(
    provider: NotificationChannel,
    change: { readonly enabled: boolean; readonly sealedSecret?: string | null; readonly publicLabel?: string | null },
    at: Date,
    actor: Actor & { readonly kind: 'user' },
  ): Promise<boolean>;
  /** Telegram `getUpdates` offset (the next update id to fetch). */
  pollOffset(): Promise<number | null>;
  savePollOffset(offset: number): Promise<void>;
}

export interface TelegramLink {
  readonly chatId: string;
  readonly chatLabel: string;
  readonly connectedAt: Date;
}

export interface TelegramPairing {
  readonly id: string;
  readonly expiresAt: Date;
  /** Set once someone sent /start with the token: which chat wants to connect (to be confirmed). */
  readonly claimedBy: string | null;
}

/**
 * Telegram chats connected to accounts and the one-time pairings that connect them (13.7). A chat
 * id is an address for reminders, never a VMN credential.
 */
export interface TelegramRepository {
  link(userId: UserId): Promise<TelegramLink | undefined>;
  /** Replaces the user's open pairings with a new one (only the token's hash is stored). */
  createPairing(input: { readonly userId: UserId; readonly tokenHash: string; readonly at: Date; readonly expiresAt: Date }): Promise<TelegramPairing>;
  /** The user's newest open pairing (not expired, completed or cancelled). */
  openPairing(userId: UserId, now: Date): Promise<TelegramPairing | undefined>;
  /** Whether any pairing is open — only then does the server poll Telegram. */
  anyOpenPairing(now: Date): Promise<boolean>;
  /**
   * Atomically claims an open, unclaimed pairing by its token hash for a chat. False for unknown,
   * expired, already claimed, completed or cancelled pairings (one-time).
   */
  claimPairing(input: { readonly tokenHash: string; readonly chatId: string; readonly chatLabel: string; readonly at: Date }): Promise<boolean>;
  /**
   * The signed-in owner confirms a claimed, unexpired pairing: in one transaction the chat becomes
   * the user's Telegram link (replacing an earlier one), the pairing is completed and
   * TELEGRAM_CONNECTED is recorded. Undefined if there is nothing to confirm.
   */
  confirmPairing(userId: UserId, pairingId: string, at: Date, actor: Actor & { readonly kind: 'user' }): Promise<TelegramLink | undefined>;
  cancelPairings(userId: UserId, at: Date): Promise<void>;
  /** Removes the link and records TELEGRAM_DISCONNECTED; false if none existed. */
  disconnect(userId: UserId, at: Date, actor: Actor & { readonly kind: 'user' }): Promise<boolean>;
}

/** An incoming bot update, reduced to what pairing needs. */
export interface TelegramUpdate {
  readonly updateId: number;
  readonly chatId: string | null;
  readonly chatType: string | null;
  readonly text: string | null;
  /** `@username` or the first name of the sender, for the user to recognise the chat. */
  readonly fromLabel: string | null;
}

/**
 * The Telegram Bot API (infrastructure: HTTPS to api.telegram.org only). The token is passed per
 * call and never logged; failures are `NotificationDeliveryError`s with stable codes.
 */
export interface TelegramBotApi {
  getMe(token: string): Promise<{ readonly username: string }>;
  sendMessage(token: string, chatId: string, text: string): Promise<void>;
  getUpdates(token: string, offset: number | null, limit: number): Promise<TelegramUpdate[]>;
}
