import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, messageFor, type PendingInvitation } from './api.ts';
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
        Create a Workspace
      </h3>
      <p className="muted">You become its admin and can add members afterwards.</p>
      {message !== null && <p role="alert">{message}</p>}
      <label>
        New Workspace name
        <br />
        <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <button type="submit" className="primary" disabled={busy}>
        Create Workspace
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
      return result.delivery === 'sent'
        ? `Invitation sent to ${result.invitation.email}.`
        : `The invitation for ${result.invitation.email} was created, but the email could not be sent. Check the mail settings and invite again.`;
    });
  }

  return (
    <section className="card stack" aria-labelledby="invitations-heading">
      <h3 id="invitations-heading" style={{ marginTop: 0 }}>
        Invitations
      </h3>
      <p className="muted">New people join by invitation only. The link is emailed to them and is valid for a limited time.</p>
      {message !== null && <p role="alert">{message}</p>}
      {status !== null && <p role="status">{status}</p>}
      <form onSubmit={submit} className="stack">
        <label>
          Email address to invite
          <br />
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          <input type="checkbox" checked={grantsServerAdmin} onChange={(e) => setGrantsServerAdmin(e.target.checked)} /> Also make
          them a server admin
        </label>
        <button type="submit" className="primary" disabled={busy}>
          Send invitation
        </button>
      </form>
      {invitations === null ? (
        <p>Loading…</p>
      ) : invitations.length === 0 ? (
        <p className="muted">No pending invitations.</p>
      ) : (
        <table>
          <caption>Pending invitations</caption>
          <thead>
            <tr>
              <th scope="col">Email</th>
              <th scope="col">Expires</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {invitations.map((invitation) => (
              <tr key={invitation.id}>
                <td>
                  {invitation.email}
                  {invitation.grantsServerAdmin && <span className="muted"> (server admin)</span>}
                </td>
                <td>{new Date(invitation.expiresAt).toLocaleString()}</td>
                <td>
                  <button
                    type="button"
                    className="quiet"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await api.revokeInvitation(invitation.id);
                        return `Invitation for ${invitation.email} revoked.`;
                      })
                    }
                  >
                    Revoke invitation for {invitation.email}
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
          ? `A recovery link was emailed to ${email}. It is valid until ${new Date(result.recovery.expiresAt).toLocaleString()}.`
          : 'The recovery was created, but the email could not be sent.',
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
        Account recovery
      </h3>
      <p className="muted">
        For someone who forgot their password or lost their authenticator. The link goes to their own email address, never to you.
      </p>
      {message !== null && <p role="alert">{message}</p>}
      {status !== null && <p role="status">{status}</p>}
      <label>
        Account email
        <br />
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <div className="row">
        <label>
          <input type="checkbox" checked={resetPassword} onChange={(e) => setResetPassword(e.target.checked)} /> Reset password
        </label>
        <label>
          <input type="checkbox" checked={resetTotp} onChange={(e) => setResetTotp(e.target.checked)} /> Reset two-factor
          authentication
        </label>
      </div>
      <label>
        Your own password (to confirm it is you)
        <br />
        <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <label>
        Your authenticator code (only if you use two-factor authentication)
        <br />
        <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
      </label>
      <button type="submit" className="primary" disabled={busy || (!resetPassword && !resetTotp)}>
        Send recovery link
      </button>
    </form>
  );
}

export function AdminPage({ onWorkspacesChanged }: { onWorkspacesChanged: () => void }) {
  return (
    <>
      <div className="page-header">
        <h2>Server administration</h2>
      </div>
      <CreateWorkspace onCreated={onWorkspacesChanged} />
      <Invitations />
      <AccountRecovery />
    </>
  );
}
