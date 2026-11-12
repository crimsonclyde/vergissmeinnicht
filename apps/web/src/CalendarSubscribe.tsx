import { useEffect, useId, useRef, useState } from 'react';
import { api, messageFor, type CalendarFeedScope, type CalendarFeedView } from './api.ts';
import { formatRelative, t } from './i18n/index.ts';
import { UiIcon, type UiIconName } from './ui-icons.tsx';

const SCOPES = [
  { value: 'MINE', icon: 'profile', label: 'calendar.subscribe.MINE', hint: 'calendar.subscribe.MINEHint' },
  { value: 'ALL', icon: 'contacts', label: 'calendar.subscribe.ALL', hint: 'calendar.subscribe.ALLHint' },
] as const satisfies readonly { value: CalendarFeedScope; icon: UiIconName; label: string; hint: string }[];

/** `webcal:` opens the subscription in Apple Calendar (and most other calendar apps) on the device. */
export const webcalUrl = (url: string) => url.replace(/^https?:/, 'webcal:');
/** Google Calendar's own "add by URL" page, with the link filled in. */
export const googleCalendarUrl = (url: string) => `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcalUrl(url))}`;

/**
 * Subscribe to this Workspace's calendar from Apple Calendar, Google Calendar or another calendar app (39). The
 * person makes a private link for themselves; it is shown once (only its hash is stored), can be replaced by a new
 * one and turned off. Mine = what the person is responsible for plus shared entries; Everyone = the whole calendar.
 */
export function CalendarSubscribe(props: { workspaceId: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const scopeId = useId();
  const [feed, setFeed] = useState<CalendarFeedView | null | undefined>(undefined);
  const [scope, setScope] = useState<CalendarFeedScope>('MINE');
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog !== null && !dialog.open) dialog.showModal();
  }, []);
  useEffect(() => {
    api.calendarFeed(props.workspaceId).then(
      (loaded) => {
        setFeed(loaded);
        if (loaded !== null) setScope(loaded.scope);
      },
      (caught: unknown) => setMessage(messageFor(caught)),
    );
  }, [props.workspaceId]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    setStatus(null);
    try {
      await action();
    } catch (caught) {
      setMessage(messageFor(caught));
    } finally {
      setBusy(false);
    }
  };
  const create = () =>
    run(async () => {
      const created = await api.createCalendarFeed(props.workspaceId, scope);
      setFeed(created.feed);
      setUrl(created.url);
    });
  const chooseScope = (next: CalendarFeedScope) => {
    setScope(next);
    // An existing link keeps working; only what it includes changes.
    if (feed !== null && feed !== undefined && feed.scope !== next) void run(async () => setFeed(await api.calendarFeedScope(props.workspaceId, next)));
  };
  const turnOff = () =>
    run(async () => {
      await api.deleteCalendarFeed(props.workspaceId);
      setFeed(null);
      setUrl(null);
      setStatus(t('calendar.subscribe.offDone'));
    });
  const copy = () =>
    run(async () => {
      if (url === null) return;
      await navigator.clipboard.writeText(url);
      setStatus(t('calendar.subscribe.copied'));
    });

  return (
    <dialog ref={ref} className="dialog calendar-subscribe" aria-labelledby={headingId} onClose={props.onClose}>
      <div className="calendar-subscribe-head">
        <span className="calendar-subscribe-badge">
          <UiIcon name="subscribe" size="1.4em" />
        </span>
        <h2 id={headingId}>{t('calendar.subscribe.title')}</h2>
        <button type="button" className="icon-button quiet" aria-label={t('common.close')} title={t('common.close')} onClick={() => ref.current?.close()}>
          <UiIcon name="close" />
        </button>
      </div>
      {message !== null && <p role="alert">{message}</p>}
      {feed === undefined && message === null && <p role="status">{t('common.loading')}</p>}
      {feed !== undefined && (
        <>
          <div className="calendar-scope" role="radiogroup" aria-labelledby={scopeId}>
            <span id={scopeId} className="visually-hidden">
              {t('calendar.subscribe.scope')}
            </span>
            {SCOPES.map((option) => (
              <button key={option.value} type="button" role="radio" aria-checked={scope === option.value} disabled={busy} onClick={() => chooseScope(option.value)}>
                <UiIcon name={option.icon} />
                <span>
                  <strong>{t(option.label)}</strong>
                  <small>{t(option.hint)}</small>
                </span>
              </button>
            ))}
          </div>

          {url !== null ? (
            <>
              <div className="calendar-subscribe-apps">
                <a className="button primary" href={webcalUrl(url)}>
                  <UiIcon name="calendarAdd" />
                  <span>{t('calendar.subscribe.apple')}</span>
                  <UiIcon name="forward" />
                </a>
                <a className="button" href={googleCalendarUrl(url)} target="_blank" rel="noreferrer noopener">
                  <UiIcon name="calendarAdd" />
                  <span>{t('calendar.subscribe.google')}</span>
                  <UiIcon name="forward" />
                </a>
              </div>
              <div className="calendar-subscribe-link">
                <label className="visually-hidden" htmlFor={`${headingId}-url`}>
                  {t('calendar.subscribe.link')}
                </label>
                <input id={`${headingId}-url`} readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
                <button type="button" className="primary icon-button" aria-label={t('calendar.subscribe.copy')} title={t('calendar.subscribe.copy')} onClick={() => void copy()}>
                  <UiIcon name="paste" />
                </button>
              </div>
            </>
          ) : feed === null ? (
            <button type="button" className="primary calendar-subscribe-create" disabled={busy} onClick={() => void create()}>
              <UiIcon name="calendarAdd" />
              {t('calendar.subscribe.create')}
            </button>
          ) : (
            <p className="calendar-subscribe-note">{t('calendar.subscribe.shownOnce')}</p>
          )}

          <p className="calendar-subscribe-private">
            <UiIcon name="lock" />
            <span>{t('calendar.subscribe.private')}</span>
          </p>
          {status !== null && (
            <p role="status" className="calendar-subscribe-status">
              {status}
            </p>
          )}

          {feed !== null && (
            <div className="calendar-subscribe-foot">
              <small>{feed.lastUsedAt === null ? t('calendar.subscribe.neverUsed') : t('calendar.subscribe.lastUsed', { when: formatRelative(feed.lastUsedAt) })}</small>
              <button type="button" className="icon-button" aria-label={t('calendar.subscribe.renew')} title={t('calendar.subscribe.renew')} disabled={busy} onClick={() => void create()}>
                <UiIcon name="reset" />
              </button>
              <button type="button" className="icon-button calendar-subscribe-off" aria-label={t('calendar.subscribe.off')} title={t('calendar.subscribe.off')} disabled={busy} onClick={() => void turnOff()}>
                <UiIcon name="unsubscribe" />
              </button>
            </div>
          )}
        </>
      )}
    </dialog>
  );
}
