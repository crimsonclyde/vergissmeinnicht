import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, messageFor, type PendingInvitation } from './api.ts';
import { formatDateTime, t } from './i18n/index.ts';
import { navigate, paths } from './router.tsx';

/** Server administration: Workspaces, invitations, account recovery. The server checks the admin flag. */
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
                <td>
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

export function AdminPage({ onWorkspacesChanged }: { onWorkspacesChanged: () => void }) {
  return (
    <>
      <div className="page-header">
        <h2>{t('admin.heading')}</h2>
      </div>
      <CreateWorkspace onCreated={onWorkspacesChanged} />
      <Invitations />
      <AccountRecovery />
    </>
  );
}
