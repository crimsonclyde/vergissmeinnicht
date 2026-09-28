import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, messageFor, type AccountInfo, type PendingInvitation, type SecurityLogEntry } from './api.ts';
import { formatDateTime, hasMessage, t } from './i18n/index.ts';
import { navigate, paths } from './router.tsx';

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

export function AdminPage({ currentUserId, onWorkspacesChanged }: { currentUserId: string; onWorkspacesChanged: () => void }) {
  return (
    <>
      <div className="page-header">
        <h2>{t('admin.heading')}</h2>
      </div>
      <CreateWorkspace onCreated={onWorkspacesChanged} />
      <Invitations />
      <Accounts currentUserId={currentUserId} />
      <AccountRecovery />
      <SecurityLog />
    </>
  );
}
