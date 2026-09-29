import { describe, expect, it } from 'vitest';
import { NotificationDeliveryError } from '@vergissmeinnicht/application';
import { createTelegramBotApi } from './telegram-bot-api.ts';

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ';

function fakeFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const requests: { url: string; init: RequestInit }[] = [];
  const doFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} });
    return respond(String(url), init ?? {});
  }) as typeof fetch;
  return { doFetch, requests };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function failure(promise: Promise<unknown>): Promise<NotificationDeliveryError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(NotificationDeliveryError);
    // Neither the token nor the URL ever travel in an error.
    expect(`${(error as Error).message} ${(error as Error).stack ?? ''} ${JSON.stringify(error)}`).not.toContain(TOKEN.split(':')[1]);
    return error as NotificationDeliveryError;
  }
  throw new Error('expected a failure');
}

describe('Telegram Bot API adapter (13.7)', () => {
  it('talks only to api.telegram.org, as JSON POST, without following redirects', async () => {
    const { doFetch, requests } = fakeFetch(() => json({ ok: true, result: { username: 'vmn_home_bot' } }));
    const api = createTelegramBotApi({ fetch: doFetch });
    expect(await api.getMe(TOKEN)).toEqual({ username: 'vmn_home_bot' });
    expect(requests[0]?.url).toBe(`https://api.telegram.org/bot${TOKEN}/getMe`);
    expect(requests[0]?.init).toMatchObject({ method: 'POST', redirect: 'error' });
  });

  it('sends plain text (no parse mode), bounded to Telegram’s limit', async () => {
    const { doFetch, requests } = fakeFetch(() => json({ ok: true, result: {} }));
    await createTelegramBotApi({ fetch: doFetch }).sendMessage(TOKEN, '555', `<b>${'x'.repeat(5000)}</b>`);
    const body = JSON.parse(String(requests[0]?.init.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty('parse_mode');
    expect(body.chat_id).toBe('555');
    expect([...(body.text as string)]).toHaveLength(4096);
  });

  it('maps failures to stable codes, transient or not', async () => {
    const cases: [Response | 'throw', string, boolean][] = [
      ['throw', 'telegram_unreachable', true],
      [json({ ok: false }, 401), 'telegram_invalid_token', false],
      [json({ ok: false }, 403), 'telegram_blocked', false],
      [json({ ok: false }, 429), 'telegram_rate_limited', true],
      [json({ ok: false }, 502), 'telegram_unavailable', true],
      [json({ ok: false, description: 'chat not found' }, 400), 'telegram_rejected', false],
      [new Response('not json'), 'telegram_bad_response', true],
    ];
    for (const [response, code, transient] of cases) {
      const { doFetch } = fakeFetch(() => {
        if (response === 'throw') throw new TypeError(`fetch failed for https://api.telegram.org/bot${TOKEN}/sendMessage`);
        return response;
      });
      const error = await failure(createTelegramBotApi({ fetch: doFetch }).sendMessage(TOKEN, '555', 'hi'));
      expect({ code: error.code, transient: error.transient }).toEqual({ code, transient });
    }
  });

  it('refuses malformed tokens before any request', async () => {
    const { doFetch, requests } = fakeFetch(() => json({ ok: true, result: {} }));
    const error = await failure(createTelegramBotApi({ fetch: doFetch }).getMe('../../evil'));
    expect(error.code).toBe('telegram_invalid_token');
    expect(requests).toEqual([]);
  });

  it('reduces updates to what pairing needs', async () => {
    const { doFetch } = fakeFetch(() =>
      json({
        ok: true,
        result: [
          { update_id: 7, message: { chat: { id: 555, type: 'private' }, text: '/start abc', from: { username: 'uma_t', first_name: 'Uma' } } },
          { update_id: 8, message: { chat: { id: -100, type: 'group' }, text: 'x', from: { first_name: 'Eve' } } },
          { update_id: 'bad' },
          { update_id: 9 },
        ],
      }),
    );
    expect(await createTelegramBotApi({ fetch: doFetch }).getUpdates(TOKEN, null, 100)).toEqual([
      { updateId: 7, chatId: '555', chatType: 'private', text: '/start abc', fromLabel: '@uma_t' },
      { updateId: 8, chatId: null, chatType: 'group', text: 'x', fromLabel: 'Eve' },
      { updateId: 9, chatId: null, chatType: null, text: null, fromLabel: null },
    ]);
  });
});
