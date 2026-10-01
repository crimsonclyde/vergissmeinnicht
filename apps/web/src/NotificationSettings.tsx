import { useCallback, useEffect, useState } from 'react';
import { api, messageFor, type NotificationSettings as Settings } from './api.ts';
import { formatDateTime, formatWhen, hasMessage, t, type MessageKey } from './i18n/index.ts';

/** While connecting Telegram: how often the page asks whether the chat has pressed Start. */
const PAIRING_CHECK_MS = 3000;


/** Where a person is in connecting their own Telegram chat (the server learns the chat id from /start). */
export type TelegramStage = 'unavailable' | 'ready' | 'waiting' | 'claimed' | 'connected';

export function telegramStage(telegram: Settings['telegram']): TelegramStage {
  if (telegram.connected !== null) return 'connected';
  if (!telegram.available) return 'unavailable';
  if (telegram.pairing === null) return 'ready';
  return telegram.pairing.claimedBy === null ? 'waiting' : 'claimed';
}

/** The visible sequence; the stage decides which step is current. */
const PAIRING_STEPS: readonly MessageKey[] = ['notifications.stepConnect', 'notifications.stepStart', 'notifications.stepConfirm', 'notifications.stepConnected'];
const CURRENT_STEP: Partial<Record<TelegramStage, number>> = { ready: 0, waiting: 1, claimed: 2 };

/** Message for a failed test send (`reason` is a stable code from the server). */
export function testFailureMessage(reason: string | undefined): string {
  const key = `admin.testFailed.${reason ?? 'failed'}`;
  return hasMessage(key) ? t(key) : t('admin.testFailed.failed');
}

/**
 * Account → Notifications (13.8): the person's own reminder channels and default reminder time.
 * Provider-wide settings (the Telegram bot token) are for server admins only and never appear here.
 */
export function NotificationSettings(props: { serverAdmin: boolean }) {
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

  // Server admins can reuse the provider test, which sends to their own connected chat.
  async function sendTest() {
    setBusy(true);
    setMessage(null);
    setStatus(null);
    try {
      const result = await api.testNotificationProvider('TELEGRAM');
      setStatus(result.delivered ? t('admin.testTelegramSent') : testFailureMessage(result.reason));
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

      <TelegramConnection
        telegram={settings.telegram}
        pairingLink={pairingLink}
        busy={busy}
        serverAdmin={props.serverAdmin}
        onConnect={() => void connect()}
        onConfirm={() => void act(() => api.confirmTelegramPairing(), t('notifications.connected'))}
        onCancel={() => void act(() => api.cancelTelegramPairing())}
        onDisconnect={() => void act(() => api.disconnectTelegram(), t('notifications.disconnected'))}
        onReminders={(on) => void act(() => api.updateNotificationSettings({ telegramReminders: on }))}
        onTest={() => void sendTest()}
      />
    </section>
  );
}

/** Numbered steps with the current one marked in text (not colour alone) and for screen readers. */
function PairingSteps({ current }: { current: number }) {
  return (
    <ol className="pairing-steps" aria-label={t('notifications.stepsLabel')}>
      {PAIRING_STEPS.map((key, index) => (
        <li key={key} aria-current={index === current ? 'step' : undefined} className={index < current ? 'done' : index === current ? 'current' : undefined}>
          <span aria-hidden="true">{index < current ? '✓' : index === current ? '→' : '○'}</span> {t(key)}
          {index < current && <span className="visually-hidden"> {t('notifications.stepDone')}</span>}
        </li>
      ))}
    </ol>
  );
}

/**
 * The Telegram part of Account → Notifications for one stage: available → Connect Telegram → open the bot
 * and press Start → waiting → confirm here → connected. There is no chat id field: the server learns the
 * chat from the one-time /start link and only links it after the person confirms here.
 */
export function TelegramConnection(props: {
  telegram: Settings['telegram'];
  /** The t.me link, shown once right after Connect Telegram (never stored or fetched again). */
  pairingLink: string | null;
  busy: boolean;
  serverAdmin: boolean;
  onConnect: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onDisconnect: () => void;
  onReminders: (on: boolean) => void;
  onTest: () => void;
}) {
  const { telegram, busy } = props;
  const stage = telegramStage(telegram);
  const current = CURRENT_STEP[stage];
  return (
    <fieldset className="stack">
      <legend>{t('notifications.telegram')}</legend>
      {current !== undefined && <PairingSteps current={current} />}
      {stage === 'unavailable' ? (
        <p className="muted" style={{ margin: 0 }}>
          {t('notifications.telegramUnavailable')}
        </p>
      ) : stage === 'connected' && telegram.connected !== null ? (
        <div className="stack">
          <p style={{ margin: 0 }}>
            <span aria-hidden="true">✓ </span>
            {t('notifications.connectedAs', { label: telegram.connected.label, time: formatWhen(telegram.connected.connectedAt) })}
          </p>
          {!telegram.available && <p className="muted">{t('notifications.telegramPaused')}</p>}
          <label className="row" style={{ fontWeight: 400 }}>
            <input type="checkbox" checked={telegram.enabled} disabled={busy} onChange={(e) => props.onReminders(e.target.checked)} />
            {t('notifications.procedureReminders')}
          </label>
          <div className="row">
            {props.serverAdmin && telegram.available && (
              <button type="button" disabled={busy} onClick={props.onTest}>
                {t('admin.testTelegram')}
              </button>
            )}
            <button type="button" className="quiet" disabled={busy} onClick={props.onDisconnect}>
              {t('notifications.disconnect')}
            </button>
          </div>
        </div>
      ) : stage === 'claimed' && telegram.pairing !== null ? (
        <div className="stack" role="group" aria-label={t('notifications.confirmLabel')}>
          <p style={{ margin: 0 }}>
            <strong>{t('notifications.claimed', { label: telegram.pairing.claimedBy ?? '' })}</strong>
          </p>
          <p className="muted" style={{ margin: 0 }}>
            {t('notifications.claimedHint')}
          </p>
          <div className="row">
            <button type="button" className="primary" disabled={busy} onClick={props.onConfirm}>
              {t('notifications.confirm')}
            </button>
            <button type="button" disabled={busy} onClick={props.onCancel}>
              {t('notifications.notMine')}
            </button>
          </div>
        </div>
      ) : stage === 'waiting' && telegram.pairing !== null ? (
        <div className="stack">
          {props.pairingLink !== null ? (
            <>
              <p style={{ margin: 0 }}>{t('notifications.openBot')}</p>
              <p style={{ margin: 0 }}>
                <a href={props.pairingLink} target="_blank" rel="noopener noreferrer" className="button primary">
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
          <button type="button" className="quiet" disabled={busy} onClick={props.onCancel}>
            {t('common.cancel')}
          </button>
        </div>
      ) : (
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>
            {t('notifications.telegramHint')}
          </p>
          <button type="button" className="primary" disabled={busy} onClick={props.onConnect}>
            {t('notifications.connect')}
          </button>
        </div>
      )}
    </fieldset>
  );
}
