import { useCallback, useEffect, useState } from 'react';
import { api, messageFor, type NotificationSettings as Settings } from './api.ts';
import { formatDateTime, formatWhen, t } from './i18n/index.ts';

/** While connecting Telegram: how often the page asks whether the chat has pressed Start. */
const PAIRING_CHECK_MS = 3000;

/**
 * Account → Notifications (13.8): the person's own reminder channels and default reminder time.
 * Provider-wide settings (the Telegram bot token) are for server admins only and never appear here.
 */
export function NotificationSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [pairingLink, setPairingLink] = useState<string | null>(null);
  const [reminderTime, setReminderTime] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const show = useCallback((next: Settings) => {
    setSettings(next);
    setReminderTime(next.reminderTime);
    if (next.telegram.pairing === null) setPairingLink(null);
  }, []);

  useEffect(() => {
    api.notificationSettings().then(show, (caught: unknown) => setMessage(messageFor(caught)));
  }, [show]);

  // Waiting for /start in Telegram: check until a chat claimed the link (or it expired).
  const waiting = settings?.telegram.pairing !== null && settings?.telegram.pairing?.claimedBy === null;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      api.notificationSettings().then(show, () => undefined);
    }, PAIRING_CHECK_MS);
    return () => clearInterval(timer);
  }, [waiting, show]);

  async function act(action: () => Promise<Settings>, done?: string) {
    setBusy(true);
    setMessage(null);
    setStatus(null);
    try {
      show(await action());
      if (done !== undefined) setStatus(done);
    } catch (caught) {
      setMessage(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    setBusy(true);
    setMessage(null);
    setStatus(null);
    try {
      const pairing = await api.startTelegramPairing();
      setPairingLink(pairing.url);
      show(await api.notificationSettings());
    } catch (caught) {
      setMessage(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  if (settings === null) {
    return (
      <section aria-labelledby="notifications-heading">
        <h3 id="notifications-heading" style={{ marginTop: 0 }}>
          {t('notifications.heading')}
        </h3>
        {message !== null ? <p role="alert">{message}</p> : <p>{t('common.loading')}</p>}
      </section>
    );
  }
  const { telegram } = settings;
  return (
    <section aria-labelledby="notifications-heading" className="stack">
      <h3 id="notifications-heading" style={{ marginTop: 0 }}>
        {t('notifications.heading')}
      </h3>
      <p className="muted" style={{ margin: 0 }}>
        {t('notifications.intro')}
      </p>
      {message !== null && <p role="alert">{message}</p>}
      {status !== null && <p role="status">{status}</p>}

      <form
        className="row"
        onSubmit={(event) => {
          event.preventDefault();
          void act(() => api.updateNotificationSettings({ reminderTime }), t('notifications.saved'));
        }}
      >
        <label>
          {t('notifications.reminderTime')}
          <br />
          <input type="time" required value={reminderTime} onChange={(e) => setReminderTime(e.target.value)} />
        </label>
        <button type="submit" disabled={busy || reminderTime === settings.reminderTime} style={{ alignSelf: 'flex-end' }}>
          {t('notifications.saveTime')}
        </button>
      </form>
      <small className="muted">{t('notifications.reminderTimeHint')}</small>

      <fieldset>
        <legend>{t('notifications.email')}</legend>
        {settings.email.available ? (
          <label className="row" style={{ fontWeight: 400 }}>
            <input
              type="checkbox"
              checked={settings.email.enabled}
              disabled={busy}
              onChange={(e) => void act(() => api.updateNotificationSettings({ emailReminders: e.target.checked }))}
            />
            {t('notifications.procedureReminders')}
          </label>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            {t('notifications.emailOff')}
          </p>
        )}
      </fieldset>

      <fieldset>
        <legend>{t('notifications.telegram')}</legend>
        {!telegram.available && telegram.connected === null ? (
          <p className="muted" style={{ margin: 0 }}>
            {t('notifications.telegramUnavailable')}
          </p>
        ) : telegram.connected !== null ? (
          <div className="stack">
            <p style={{ margin: 0 }}>{t('notifications.connectedAs', { label: telegram.connected.label, time: formatWhen(telegram.connected.connectedAt) })}</p>
            {!telegram.available && <p className="muted">{t('notifications.telegramPaused')}</p>}
            <label className="row" style={{ fontWeight: 400 }}>
              <input
                type="checkbox"
                checked={telegram.enabled}
                disabled={busy}
                onChange={(e) => void act(() => api.updateNotificationSettings({ telegramReminders: e.target.checked }))}
              />
              {t('notifications.procedureReminders')}
            </label>
            <button type="button" className="quiet" disabled={busy} onClick={() => void act(() => api.disconnectTelegram(), t('notifications.disconnected'))}>
              {t('notifications.disconnect')}
            </button>
          </div>
        ) : telegram.pairing !== null && telegram.pairing.claimedBy !== null ? (
          <div className="stack" role="group" aria-label={t('notifications.confirmLabel')}>
            <p style={{ margin: 0 }}>
              <strong>{t('notifications.claimed', { label: telegram.pairing.claimedBy })}</strong>
            </p>
            <p className="muted" style={{ margin: 0 }}>
              {t('notifications.claimedHint')}
            </p>
            <div className="row">
              <button type="button" className="primary" disabled={busy} onClick={() => void act(() => api.confirmTelegramPairing(), t('notifications.connected'))}>
                {t('notifications.confirm')}
              </button>
              <button type="button" disabled={busy} onClick={() => void act(() => api.cancelTelegramPairing())}>
                {t('notifications.notMine')}
              </button>
            </div>
          </div>
        ) : telegram.pairing !== null ? (
          <div className="stack">
            {pairingLink !== null ? (
              <>
                <p style={{ margin: 0 }}>{t('notifications.openBot')}</p>
                <p style={{ margin: 0 }}>
                  <a href={pairingLink} target="_blank" rel="noopener noreferrer" className="button primary">
                    {t('notifications.openTelegram')}
                  </a>
                </p>
              </>
            ) : (
              <p style={{ margin: 0 }}>{t('notifications.linkShownOnce')}</p>
            )}
            <p className="muted" role="status" style={{ margin: 0 }}>
              {t('notifications.waiting', { time: formatDateTime(telegram.pairing.expiresAt) })}
            </p>
            <button type="button" className="quiet" disabled={busy} onClick={() => void act(() => api.cancelTelegramPairing())}>
              {t('common.cancel')}
            </button>
          </div>
        ) : (
          <div className="stack">
            <p className="muted" style={{ margin: 0 }}>
              {t('notifications.telegramHint')}
            </p>
            <button type="button" disabled={busy} onClick={() => void connect()}>
              {t('notifications.connect')}
            </button>
          </div>
        )}
      </fieldset>
    </section>
  );
}
