import { WeatherAdmin } from './WeatherAdmin.tsx';
import { HistoricalIdentities, RestoreFromBackup, RestoreLimitSettings } from './WorkspaceRestore.tsx';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, messageFor, type AccountInfo, type NotificationProviders as NotificationProvidersInfo, type PendingInvitation, type SecurityLogEntry } from './api.ts';
import { formatDateTime, hasMessage, t } from './i18n/index.ts';
import { testFailureMessage } from './NotificationSettings.tsx';
import { ADMIN_SECTIONS, Link, navigate, paths, type AdminSection } from './router.tsx';
import { SettingsLayout } from './SettingsLayout.tsx';
import { announceFooterHidden } from './SourceFooter.tsx';
import { AdminStorage, DocumentFileSettings } from './Storage.tsx';

/** Server administration: Workspaces, invitations, accounts, account recovery. The server checks the admin flag. */
function CreateWorkspace({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const workspace = await api.createWorkspace(name);
      onCreated();
      navigate(paths.members(workspace.id));
    } catch (caught) {
      setMessage(messageFor(caught));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card stack" aria-labelledby="create-workspace-heading">
      <h3 id="create-workspace-heading" style={{ marginTop: 0 }}>
        {t('admin.createHeading')}
      </h3>
      <p className="muted">{t('admin.createHint')}</p>
      {message !== null && <p role="alert">{message}</p>}
      <label>
        {t('admin.newName')}
        <br />
        <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <button type="submit" className="primary" disabled={busy}>
        {t('admin.create')}
      </button>
    </form>
  );
}

function Invitations() {
  const [invitations, setInvitations] = useState<PendingInvitation[] | null>(null);
  const [email, setEmail] = useState('');
  const [grantsServerAdmin, setGrantsServerAdmin] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    api.invitations().then(setInvitations, (caught: unknown) => setMessage(messageFor(caught)));
  }, []);
  useEffect(refresh, [refresh]);

  async function act(action: () => Promise<string>) {
    setBusy(true);
    setMessage(null);
    setStatus(null);
    try {
      setStatus(await action());
      refresh();
    } catch (caught) {
      setMessage(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void act(async () => {
      const result = await api.invite(email, grantsServerAdmin);
      setEmail('');
      setGrantsServerAdmin(false);
      return t(result.delivery === 'sent' ? 'admin.invitationSent' : 'admin.invitationNotSent', { email: result.invitation.email });
    });
  }

  return (
    <section className="card stack" aria-labelledby="invitations-heading">
      <h3 id="invitations-heading" style={{ marginTop: 0 }}>
        {t('admin.invitationsHeading')}
      </h3>
      <p className="muted">{t('admin.invitationsHint')}</p>
      {message !== null && <p role="alert">{message}</p>}
      {status !== null && <p role="status">{status}</p>}
      <form onSubmit={submit} className="stack">
        <label>
          {t('admin.inviteEmail')}
          <br />
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          <input type="checkbox" checked={grantsServerAdmin} onChange={(e) => setGrantsServerAdmin(e.target.checked)} />{' '}
          {t('admin.alsoServerAdmin')}
        </label>
        <button type="submit" className="primary" disabled={busy}>
          {t('admin.sendInvitation')}
        </button>
      </form>
      {invitations === null ? (
        <p>{t('common.loading')}</p>
      ) : invitations.length === 0 ? (
        <p className="muted">{t('admin.noInvitations')}</p>
      ) : (
        <table>
          <caption>{t('admin.pendingInvitations')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('admin.column.email')}</th>
              <th scope="col">{t('admin.column.expires')}</th>
              <th scope="col">{t('admin.column.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {invitations.map((invitation) => (
              <tr key={invitation.id}>
                <td>
                  {invitation.email}
                  {invitation.grantsServerAdmin && <span className="muted">{t('admin.serverAdminMark')}</span>}
                </td>
                <td>{formatDateTime(invitation.expiresAt)}</td>
                <td className="row">
                  <button
                    type="button"
                    className="quiet"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        // A new invitation supersedes the old link.
                        const result = await api.invite(invitation.email, invitation.grantsServerAdmin);
                        return t(result.delivery === 'sent' ? 'admin.invitationSent' : 'admin.invitationNotSent', {
                          email: invitation.email,
                        });
                      })
                    }
                  >
                    {t('admin.resendInvitation', { email: invitation.email })}
                  </button>
                  <button
                    type="button"
                    className="quiet"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await api.revokeInvitation(invitation.id);
                        return t('admin.invitationRevoked', { email: invitation.email });
                      })
                    }
                  >
                    {t('admin.revokeInvitation', { email: invitation.email })}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Accounts({ currentUserId }: { currentUserId: string }) {
  const [accounts, setAccounts] = useState<AccountInfo[] | null>(null);
  const [selected, setSelected] = useState<AccountInfo | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    api.accounts().then(setAccounts, (caught: unknown) => setMessage(messageFor(caught)));
  }, []);
  useEffect(refresh, [refresh]);

  function choose(account: AccountInfo) {
    setSelected(account);
    setMessage(null);
    setStatus(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (selected === null) return;
    const next = selected.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    setBusy(true);
    setMessage(null);
    try {
      await api.setAccountStatus(selected.id, { status: next, password, ...(code.trim() === '' ? {} : { code: code.trim() }) });
      setStatus(t(next === 'DISABLED' ? 'admin.accountDisabled' : 'admin.accountEnabled', { name: selected.displayName }));
      setSelected(null);
      refresh();
    } catch (caught) {
      const workspaces = caught instanceof ApiError && Array.isArray(caught.details.workspaces) ? (caught.details.workspaces as { name: string }[]) : [];
      setMessage(
        workspaces.length > 0
          ? `${messageFor(caught)} ${t('admin.soleAdminOf', { names: workspaces.map((workspace) => workspace.name).join(', ') })}`
          : messageFor(caught),
      );
    } finally {
      setPassword('');
      setCode('');
      setBusy(false);
    }
  }

  return (
    <section className="card stack" aria-labelledby="accounts-heading">
      <h3 id="accounts-heading" style={{ marginTop: 0 }}>
        {t('admin.accountsHeading')}
      </h3>
      <p className="muted">{t('admin.accountsHint')}</p>
      {message !== null && <p role="alert">{message}</p>}
      {status !== null && <p role="status">{status}</p>}
      {accounts === null ? (
        <p>{t('common.loading')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <caption>{t('admin.accountsCaption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('admin.column.name')}</th>
                <th scope="col">{t('admin.column.email')}</th>
                <th scope="col">{t('admin.column.status')}</th>
                <th scope="col">{t('admin.column.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id}>
                  <td>
                    {account.displayName}
                    {account.id === currentUserId && <span className="muted">{t('admin.youMark')}</span>}
                    {account.serverAdmin && <span className="muted">{t('admin.serverAdminMark')}</span>}
                  </td>
                  <td>{account.email}</td>
                  <td>
                    {t(`admin.status.${account.status}`)}
                    {account.totpEnabled && <span className="muted">{t('admin.twoFactorMark')}</span>}
                  </td>
                  <td>
                    {account.id !== currentUserId && (
                      <button type="button" className="quiet" disabled={busy} onClick={() => choose(account)}>
                        {t(account.status === 'ACTIVE' ? 'admin.disableAccount' : 'admin.enableAccount', { name: account.displayName })}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected !== null && (
        <form onSubmit={submit} className="stack" aria-labelledby="account-status-confirm">
          <p id="account-status-confirm">
            <strong>
              {t(selected.status === 'ACTIVE' ? 'admin.confirmDisable' : 'admin.confirmEnable', {
                name: selected.displayName,
                email: selected.email,
              })}
            </strong>
          </p>
          <label>
            {t('admin.ownPassword')}
            <br />
            <input
              type="password"
              autoComplete="current-password"
              required
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label>
            {t('admin.ownCode')}
            <br />
            <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <div className="row">
            <button type="submit" className="primary" disabled={busy}>
              {t('admin.confirmStatus')}
            </button>
            <button type="button" className="quiet" disabled={busy} onClick={() => setSelected(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/** Readable event name; unknown (future) types are shown as stored. */
const eventName = (type: string) => {
  const key = `securityEvent.${type}`;
  return hasMessage(key) ? t(key) : type;
};

function SecurityLog() {
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [userId, setUserId] = useState('');
  const [events, setEvents] = useState<SecurityLogEntry[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.accounts().then(setAccounts, () => setAccounts([]));
  }, []);
  useEffect(() => {
    let active = true;
    api.securityLog(userId === '' ? {} : { userId }).then(
      (page) => {
        if (!active) return;
        setEvents(page.events);
        setNextCursor(page.nextCursor);
      },
      (caught: unknown) => active && setMessage(messageFor(caught)),
    );
    return () => {
      active = false;
    };
  }, [userId]);

  async function more() {
    if (nextCursor === null) return;
    setBusy(true);
    try {
      const page = await api.securityLog({ before: nextCursor, ...(userId === '' ? {} : { userId }) });
      setEvents((current) => [...(current ?? []), ...page.events]);
      setNextCursor(page.nextCursor);
    } catch (caught) {
      setMessage(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack" aria-labelledby="security-log-heading">
      <h3 id="security-log-heading" style={{ marginTop: 0 }}>
        {t('admin.logHeading')}
      </h3>
      <p className="muted">{t('admin.logHint')}</p>
      <label>
        {t('admin.logFilter')}
        <br />
        <select
          value={userId}
          onChange={(e) => {
            setEvents(null);
            setMessage(null);
            setUserId(e.target.value);
          }}
        >
          <option value="">{t('admin.logAllAccounts')}</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.displayName} ({account.email})
            </option>
          ))}
        </select>
      </label>
      {message !== null && <p role="alert">{message}</p>}
      {events === null ? (
        message === null && <p>{t('common.loading')}</p>
      ) : events.length === 0 ? (
        <p className="muted">{t('admin.logEmpty')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <caption>{t('admin.logCaption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('admin.column.time')}</th>
                <th scope="col">{t('admin.column.event')}</th>
                <th scope="col">{t('admin.column.by')}</th>
                <th scope="col">{t('admin.column.about')}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>
                    <time dateTime={event.at}>{formatDateTime(event.at)}</time>
                  </td>
                  <td>{eventName(event.type)}</td>
                  <td>{event.actor}</td>
                  <td>{event.subjectEmail ?? event.subjectType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {nextCursor !== null && (
        <button type="button" className="quiet" disabled={busy} onClick={() => void more()}>
          {t('common.showMore')}
        </button>
      )}
    </section>
  );
}

/** Settings of this server: the footer can be hidden (it stays in the HTML); the size of Recent on Home. */
function ServerSettings() {
  const [footerHidden, setFooterHidden] = useState<boolean | null>(null);
  const [recentLimit, setRecentLimit] = useState('');
  const [savedRecentLimit, setSavedRecentLimit] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    api.instanceSettings().then(
      (settings) => {
        setFooterHidden(settings.footerHidden);
        setSavedRecentLimit(settings.recentProceduresLimit);
        setRecentLimit(String(settings.recentProceduresLimit));
      },
      (caught: unknown) => setMessage(messageFor(caught)),
    );
  }, []);

  async function saveRecentLimit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    setStatus(null);
    try {
      const saved = await api.updateInstanceSettings({ recentProceduresLimit: Number(recentLimit) });
      setSavedRecentLimit(saved.recentProceduresLimit);
      setRecentLimit(String(saved.recentProceduresLimit));
      setStatus(saved.recentProceduresLimit === 0 ? t('admin.recentHidden') : t('admin.recentSaved', { count: saved.recentProceduresLimit }));
    } catch (caught) {
      setMessage(messageFor(caught));
    }
  }

  async function change(hidden: boolean) {
    const previous = footerHidden;
    setFooterHidden(hidden);
    setMessage(null);
    setStatus(null);
    try {
      const saved = await api.updateInstanceSettings({ footerHidden: hidden });
      setFooterHidden(saved.footerHidden);
      setStatus(t(saved.footerHidden ? 'admin.footerHidden' : 'admin.footerShown'));
      // The footer of this page follows at once.
      announceFooterHidden(saved.footerHidden);
    } catch (caught) {
      setFooterHidden(previous);
      setMessage(messageFor(caught));
    }
  }

  return (
    <section className="card stack" aria-labelledby="server-settings-heading">
      <h3 id="server-settings-heading" style={{ marginTop: 0 }}>
        {t('admin.serverHeading')}
      </h3>
      {message !== null && <p role="alert">{message}</p>}
      {status !== null && <p role="status">{status}</p>}
      <label className="row" style={{ fontWeight: 400 }}>
        <input
          type="checkbox"
          disabled={footerHidden === null}
          checked={footerHidden === true}
          onChange={(e) => void change(e.target.checked)}
          aria-describedby="hide-footer-hint"
        />
        {t('admin.hideFooter')}
      </label>
      <p id="hide-footer-hint" className="muted" style={{ margin: 0 }}>
        {t('admin.hideFooterHint')}
      </p>
      <form className="row" onSubmit={(event) => void saveRecentLimit(event)}>
        <label>
          {t('admin.recentLimit')}
          <br />
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={20}
            required
            disabled={savedRecentLimit === null}
            value={recentLimit}
            onChange={(e) => setRecentLimit(e.target.value)}
            aria-describedby="recent-limit-hint"
            style={{ width: '6rem' }}
          />
        </label>
        <button type="submit" disabled={savedRecentLimit === null || recentLimit === String(savedRecentLimit)} style={{ alignSelf: 'flex-end' }}>
          {t('admin.saveRecentLimit')}
        </button>
      </form>
      <p id="recent-limit-hint" className="muted" style={{ margin: 0 }}>
        {t('admin.recentLimitHint')}
      </p>
    </section>
  );
}

/** What the Telegram provider section shows (see `TelegramProvider`). */
export type TelegramAdminState = 'not-configured' | 'off' | 'admin-not-paired' | 'admin-paired' | 'admin-unknown';

export function telegramAdminState(telegram: NotificationProvidersInfo['telegram'], ownConnection: string | null | undefined): TelegramAdminState {
  if (!telegram.configured) return 'not-configured';
  if (!telegram.enabled) return 'off';
  if (ownConnection === undefined) return 'admin-unknown';
  return ownConnection === null ? 'admin-not-paired' : 'admin-paired';
}

/**
 * Telegram is set up in two stages: here, once, the bot for the whole server (its token); then every
 * person — this admin included — connects their own chat under Profile & settings → Notifications.
 * This section says so, so a saved token does not look like the end of the setup. No chat id is
 * entered anywhere: the server learns it during pairing. The token is never read back.
 */
export function TelegramProvider(props: {
  telegram: NotificationProvidersInfo['telegram'];
  /** The signed-in admin's own chat label; `null` = not connected, `undefined` = unknown. */
  ownConnection: string | null | undefined;
  token: string;
  enabled: boolean;
  busy: boolean;
  onToken: (token: string) => void;
  onEnabled: (enabled: boolean) => void;
  onSave: () => void;
  onTest: () => void;
  onRemove: () => void;
}) {
  const { telegram, busy } = props;
  const state = telegramAdminState(telegram, props.ownConnection);
  const notPaired = props.ownConnection === null;
  return (
    <fieldset className="stack">
      <legend>{t('admin.providerTelegram')}</legend>
      <p style={{ margin: 0 }}>{t('admin.telegramIntro')}</p>
      {telegram.configured ? (
        <p style={{ margin: 0 }}>
          <strong>
            <span aria-hidden="true">✓ </span>
            {t('admin.telegramBot', { bot: telegram.botName ?? '' })}
          </strong>{' '}
          {t(telegram.enabled ? 'admin.telegramStateOn' : 'admin.telegramStateOff')}
        </p>
      ) : (
        <p style={{ margin: 0 }}>{t('admin.telegramNotConfigured')}</p>
      )}
      {(state === 'admin-not-paired' || state === 'admin-unknown') && (
        <section className="callout stack" aria-labelledby="telegram-next-heading">
          <h4 id="telegram-next-heading" style={{ margin: 0 }}>
            {t('admin.telegramNextHeading')}
          </h4>
          <p style={{ margin: 0 }}>{t('admin.telegramNext')}</p>
          <p style={{ margin: 0 }}>
            <Link href={paths.account('notifications')} className="button primary">
              {t('admin.telegramGoToSettings')}
            </Link>
          </p>
        </section>
      )}
      {state === 'admin-paired' && (
        <p style={{ margin: 0 }}>{t('admin.telegramYouConnected', { label: props.ownConnection ?? '' })}</p>
      )}
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          props.onSave();
        }}
      >
        <label>
          {t('admin.telegramToken')}
          <br />
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={props.token}
            onChange={(e) => props.onToken(e.target.value)}
            aria-describedby="telegram-token-hint"
            required={!telegram.configured}
          />
        </label>
        <small id="telegram-token-hint" className="muted" style={{ display: 'block' }}>
          {t('admin.telegramTokenHint')}
          {telegram.configured && ` ${t('admin.telegramTokenKeep')}`}
        </small>
        <label className="row" style={{ fontWeight: 400 }}>
          <input type="checkbox" checked={props.enabled} onChange={(e) => props.onEnabled(e.target.checked)} />
          {t('admin.telegramEnabled')}
        </label>
        <div className="row">
          <button type="submit" className="primary" disabled={busy}>
            {t('admin.telegramSave')}
          </button>
          {telegram.configured && (
            <>
              <button type="button" disabled={busy || notPaired} aria-describedby={notPaired ? 'telegram-test-hint' : undefined} onClick={props.onTest}>
                {t('admin.testTelegram')}
              </button>
              <button type="button" className="quiet" disabled={busy} onClick={props.onRemove}>
                {t('admin.telegramRemove')}
              </button>
            </>
          )}
        </div>
        {telegram.configured && notPaired && (
          <small id="telegram-test-hint" className="muted" style={{ display: 'block' }}>
            {t('admin.telegramTestNeedsPairing')}
          </small>
        )}
      </form>
    </fieldset>
  );
}

/**
 * Notification providers (13.7, 13.10): email (configured through the server environment) and the
 * optional Telegram bot. The bot token can be replaced or removed, never read back.
 */
function NotificationProviders() {
  const [providers, setProviders] = useState<NotificationProvidersInfo | null>(null);
  const [token, setToken] = useState('');
  const [telegramEnabled, setTelegramEnabled] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The signed-in admin's own Telegram chat (label only): the test message goes there. `undefined` = unknown.
  const [ownTelegram, setOwnTelegram] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    api.notificationProviders().then(
      (loaded) => {
        setProviders(loaded);
        setTelegramEnabled(loaded.telegram.enabled || !loaded.telegram.configured);
      },
      (caught: unknown) => setMessage(messageFor(caught)),
    );
    api.notificationSettings().then(
      (own) => setOwnTelegram(own.telegram.connected?.label ?? null),
      () => setOwnTelegram(undefined),
    );
  }, []);

  async function act(action: () => Promise<NotificationProvidersInfo>, done: string) {
    setBusy(true);
    setMessage(null);
    setStatus(null);
    try {
      const next = await action();
      setProviders(next);
      setTelegramEnabled(next.telegram.enabled);
      setStatus(done);
    } catch (caught) {
      setMessage(messageFor(caught));
    } finally {
      setToken('');
      setBusy(false);
    }
  }

  async function test(provider: 'EMAIL' | 'TELEGRAM') {
    setBusy(true);
    setMessage(null);
    setStatus(null);
    try {
      const result = await api.testNotificationProvider(provider);
      if (result.reason === 'not_connected') setOwnTelegram(null);
      setStatus(result.delivered ? t(provider === 'EMAIL' ? 'admin.testEmailSent' : 'admin.testTelegramSent') : testFailureMessage(result.reason));
    } catch (caught) {
      setMessage(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack" aria-labelledby="providers-heading">
      <h3 id="providers-heading" style={{ marginTop: 0 }}>
        {t('admin.providersHeading')}
      </h3>
      <p className="muted" style={{ margin: 0 }}>
        {t('admin.providersHint')}
      </p>
      {message !== null && <p role="alert">{message}</p>}
      {status !== null && <p role="status">{status}</p>}
      {providers === null ? (
        <p>{t('common.loading')}</p>
      ) : (
        <>
          <fieldset className="stack">
            <legend>{t('admin.providerEmail')}</legend>
            <p style={{ margin: 0 }}>{t(providers.email.configured ? 'admin.emailConfigured' : 'admin.emailNotConfigured')}</p>
            <label className="row" style={{ fontWeight: 400 }}>
              <input
                type="checkbox"
                checked={providers.email.enabled}
                disabled={busy}
                onChange={(e) => void act(() => api.setEmailReminders(e.target.checked), t(e.target.checked ? 'admin.emailOn' : 'admin.emailOff'))}
              />
              {t('admin.emailReminders')}
            </label>
            <button type="button" disabled={busy || !providers.email.configured} onClick={() => void test('EMAIL')}>
              {t('admin.testEmail')}
            </button>
          </fieldset>
          <TelegramProvider
            telegram={providers.telegram}
            ownConnection={ownTelegram}
            token={token}
            enabled={telegramEnabled}
            busy={busy}
            onToken={setToken}
            onEnabled={setTelegramEnabled}
            onSave={() =>
              void act(
                () => api.configureTelegram({ enabled: telegramEnabled, ...(token.trim() === '' ? {} : { botToken: token.trim() }) }),
                t('admin.telegramSaved'),
              )
            }
            onTest={() => void test('TELEGRAM')}
            onRemove={() => {
              if (window.confirm(t('admin.telegramRemoveConfirm'))) void act(() => api.configureTelegram({ enabled: false, botToken: null }), t('admin.telegramRemoved'));
            }}
          />
        </>
      )}
    </section>
  );
}

function AccountRecovery() {
  const [email, setEmail] = useState('');
  const [resetPassword, setResetPassword] = useState(true);
  const [resetTotp, setResetTotp] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setStatus(null);
    try {
      const result = await api.startRecovery({
        email,
        resetPassword,
        resetTotp,
        password,
        ...(code.trim() === '' ? {} : { code: code.trim() }),
      });
      setStatus(
        result.delivery === 'sent'
          ? t('admin.recoverySent', { email, time: formatDateTime(result.recovery.expiresAt) })
          : t('admin.recoveryNotSent'),
      );
      setEmail('');
    } catch (caught) {
      setMessage(messageFor(caught));
    } finally {
      setPassword('');
      setCode('');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card stack" aria-labelledby="recovery-admin-heading">
      <h3 id="recovery-admin-heading" style={{ marginTop: 0 }}>
        {t('admin.recoveryHeading')}
      </h3>
      <p className="muted">{t('admin.recoveryHint')}</p>
      {message !== null && <p role="alert">{message}</p>}
      {status !== null && <p role="status">{status}</p>}
      <label>
        {t('admin.accountEmail')}
        <br />
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <div className="row">
        <label>
          <input type="checkbox" checked={resetPassword} onChange={(e) => setResetPassword(e.target.checked)} /> {t('admin.resetPassword')}
        </label>
        <label>
          <input type="checkbox" checked={resetTotp} onChange={(e) => setResetTotp(e.target.checked)} /> {t('admin.resetTotp')}
        </label>
      </div>
      <label>
        {t('admin.ownPassword')}
        <br />
        <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <label>
        {t('admin.ownCode')}
        <br />
        <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
      </label>
      <button type="submit" className="primary" disabled={busy || (!resetPassword && !resetTotp)}>
        {t('admin.sendRecovery')}
      </button>
    </form>
  );
}

/** Server admin (15.1): one named section at a time. The server checks the admin flag on every request. */
export function AdminPage({ section, currentUserId, onWorkspacesChanged }: { section: AdminSection; currentUserId: string; onWorkspacesChanged: () => void }) {
  return (
    <SettingsLayout
      title={t('admin.heading')}
      navLabel={t('admin.heading')}
      sections={ADMIN_SECTIONS.map((value) => ({ href: paths.admin(value), label: t(`admin.section.${value}`), current: value === section }))}
    >
      {section === 'workspaces' && (
        <>
          <CreateWorkspace onCreated={onWorkspacesChanged} />
          <RestoreFromBackup onRestored={onWorkspacesChanged} />
        </>
      )}
      {section === 'invitations' && <Invitations />}
      {section === 'accounts' && (
        <>
          <Accounts currentUserId={currentUserId} />
          <AccountRecovery />
          <HistoricalIdentities />
        </>
      )}
      {section === 'notifications' && <NotificationProviders />}
      {section === 'weather' && <WeatherAdmin />}
      {section === 'server' && (
        <>
          <ServerSettings />
          <AdminStorage />
          <DocumentFileSettings />
          <RestoreLimitSettings />
        </>
      )}
      {section === 'log' && <SecurityLog />}
    </SettingsLayout>
  );
}
