import { NotificationDeliveryError, type TelegramBotApi, type TelegramUpdate } from '@vergissmeinnicht/application';
import { discard, outboundFetch, readBounded, type Fetch } from '@vergissmeinnicht/outbound';

/** The only host this adapter talks to (no user-supplied URLs: nothing to redirect elsewhere). */
const API_HOST = 'api.telegram.org';
const API_ORIGIN = `https://${API_HOST}`;
const BOT_TOKEN = /^\d{5,15}:[A-Za-z0-9_-]{30,64}$/;
/** Telegram's limit for one message. */
const MAX_TEXT = 4096;
const MAX_RESPONSE_BYTES = 1024 * 1024;


/**
 * Telegram Bot API over HTTPS (13.7). The bot token is part of the request URL, so neither URLs nor
 * underlying errors are ever logged or passed on: every failure becomes a `NotificationDeliveryError`
 * with a stable code (transient ones are retried by the dispatcher).
 */
export function createTelegramBotApi(options: { readonly fetch?: Fetch | undefined; readonly timeoutMs?: number } = {}): TelegramBotApi {
  const doFetch = options.fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;

  async function call<T>(token: string, method: string, body: object): Promise<T> {
    if (!BOT_TOKEN.test(token)) throw new NotificationDeliveryError('telegram_invalid_token', false);
    let response: Response;
    try {
      response = await outboundFetch(`${API_ORIGIN}/bot${token}/${method}`, {
        allow: [API_HOST],
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        timeoutMs,
        fetch: doFetch,
      });
    } catch {
      throw new NotificationDeliveryError('telegram_unreachable', true);
    }
    const refused = response.status === 401 || response.status === 404 ? new NotificationDeliveryError('telegram_invalid_token', false)
      : response.status === 403 ? new NotificationDeliveryError('telegram_blocked', false)
      : response.status === 429 ? new NotificationDeliveryError('telegram_rate_limited', true)
      : response.status >= 500 ? new NotificationDeliveryError('telegram_unavailable', true) : undefined;
    if (refused !== undefined) {
      await discard(response);
      throw refused;
    }
    let payload: { ok?: unknown; result?: unknown };
    try {
      // Streamed with a cap (45.10): an oversized answer is cut, not read whole first.
      payload = JSON.parse((await readBounded(response, MAX_RESPONSE_BYTES)).toString('utf8')) as typeof payload;
    } catch {
      throw new NotificationDeliveryError('telegram_bad_response', true);
    }
    if (!response.ok || payload.ok !== true) throw new NotificationDeliveryError('telegram_rejected', false);
    return payload.result as T;
  }

  return {
    async getMe(token) {
      const me = await call<{ username?: unknown }>(token, 'getMe', {});
      if (typeof me.username !== 'string' || !/^[A-Za-z0-9_]{3,64}$/.test(me.username)) throw new NotificationDeliveryError('telegram_bad_response', false);
      return { username: me.username };
    },

    async sendMessage(token, chatId, text) {
      // Plain text: no parse_mode, so nothing in a Procedure title is interpreted as markup.
      await call(token, 'sendMessage', { chat_id: chatId, text: [...text].slice(0, MAX_TEXT).join(''), link_preview_options: { is_disabled: true } });
    },

    async getUpdates(token, offset, limit) {
      const result = await call<unknown[]>(token, 'getUpdates', { ...(offset === null ? {} : { offset }), limit, timeout: 0, allowed_updates: ['message'] });
      if (!Array.isArray(result)) throw new NotificationDeliveryError('telegram_bad_response', true);
      return result.flatMap((raw): TelegramUpdate[] => {
        const update = raw as { update_id?: unknown; message?: { chat?: { id?: unknown; type?: unknown }; text?: unknown; from?: { username?: unknown; first_name?: unknown } } };
        if (typeof update.update_id !== 'number' || !Number.isSafeInteger(update.update_id)) return [];
        const chatId = update.message?.chat?.id;
        const from = update.message?.from;
        const label = typeof from?.username === 'string' ? `@${from.username}` : typeof from?.first_name === 'string' ? from.first_name : null;
        return [
          {
            updateId: update.update_id,
            chatId: typeof chatId === 'number' && Number.isSafeInteger(chatId) && chatId > 0 ? String(chatId) : null,
            chatType: typeof update.message?.chat?.type === 'string' ? update.message.chat.type : null,
            text: typeof update.message?.text === 'string' ? update.message.text.slice(0, 256) : null,
            fromLabel: label,
          },
        ];
      });
    },
  };
}
