import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, messageFor, WORKSPACE_ROLES, type WorkspaceMember, type WorkspaceRole } from './api.ts';
import { navigate } from './router.tsx';
import type { WorkspaceContext } from './workspace-context.ts';

export const ROLE_LABELS: Record<WorkspaceRole, string> = { GUEST: 'Guest', USER: 'User', EDITOR: 'Editor', ADMIN: 'Admin' };

const ROLE_HELP: Record<WorkspaceRole, string> = {
  GUEST: 'can read Procedures and Runs',
  USER: 'can also start and execute Runs',
  EDITOR: 'can also create and edit Procedures',
  ADMIN: 'can also manage members and settings',
};

function RoleSelect(props: { label: string; value: WorkspaceRole; disabled?: boolean; onChange: (role: WorkspaceRole) => void }) {
  return (
    <select aria-label={props.label} value={props.value} disabled={props.disabled} onChange={(e) => props.onChange(e.target.value as WorkspaceRole)}>
      {WORKSPACE_ROLES.map((role) => (
        <option key={role} value={role}>
          {ROLE_LABELS[role]}
        </option>
      ))}
    </select>
  );
}

function AddMember({ workspaceId, onAdded }: { workspaceId: string; onAdded: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('USER');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await api.addMember(workspaceId, email, role);
      setEmail('');
      onAdded();
    } catch (caught) {
      setMessage(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card stack" aria-labelledby="add-member-heading">
      <h3 id="add-member-heading" style={{ marginTop: 0 }}>
        Add member
      </h3>
      <p className="muted">The person needs an account first. A server admin invites new people.</p>
      {message !== null && <p role="alert">{message}</p>}
      <div className="row">
        <label>
          Member email
          <br />
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Role
          <br />
          <RoleSelect label="Role for new member" value={role} onChange={setRole} />
        </label>
      </div>
      <p className="muted">
        {ROLE_LABELS[role]} {ROLE_HELP[role]}.
      </p>
      <button type="submit" className="primary" disabled={busy}>
        Add
      </button>
    </form>
  );
}

function RenameWorkspace({ context, onRenamed }: { context: WorkspaceContext; onRenamed: () => void }) {
  const [name, setName] = useState(context.workspace.name);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    try {
      await api.renameWorkspace(context.workspace.id, name);
      onRenamed();
      setMessage('Saved.');
    } catch (caught) {
      setMessage(messageFor(caught));
    }
  }

  return (
    <form onSubmit={submit} className="card stack">
      <h3 style={{ marginTop: 0 }}>Workspace name</h3>
      {message !== null && <p role="status">{message}</p>}
      <label>
        Name
        <br />
        <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <button type="submit">Rename Workspace</button>
    </form>
  );
}

/** Members of the Workspace; management controls only for members who manage it (the server decides). */
export function MembersPage(props: { context: WorkspaceContext; currentUserId: string; onWorkspacesChanged: () => void }) {
  const { context } = props;
  const workspaceId = context.workspace.id;
  const canView = context.capabilities.includes('workspace.members.view');
  const canManage = context.capabilities.includes('workspace.members.manage');
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    if (!canView) return;
    api.members(workspaceId).then(setMembers, (caught: unknown) => setMessage(messageFor(caught)));
  }, [workspaceId, canView]);
  useEffect(refresh, [refresh]);

  async function act(action: () => Promise<unknown>, after: () => void = refresh) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      after();
    } catch (caught) {
      setMessage(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <h2>Members</h2>
        <span className="muted">
          Your role: {ROLE_LABELS[context.workspace.role]} — {ROLE_HELP[context.workspace.role]}
        </span>
      </div>
      {message !== null && <p role="alert">{message}</p>}
      {!canView ? (
        <p className="muted">Guests cannot see the member list.</p>
      ) : members === null ? (
        <p>Loading…</p>
      ) : (
        <div className="card">
          <table>
            <caption>Members</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                {canManage && <th scope="col">Email</th>}
                <th scope="col">Role</th>
                {canManage && <th scope="col">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.userId}>
                  <td>
                    {member.displayName}
                    {member.userId === props.currentUserId && <span className="muted"> (you)</span>}
                    {member.status === 'DISABLED' && ' (disabled)'}
                  </td>
                  {canManage && <td>{member.email}</td>}
                  <td>
                    {canManage ? (
                      <RoleSelect
                        label={`Role of ${member.displayName}`}
                        value={member.role}
                        disabled={busy}
                        onChange={(role) => void act(() => api.changeMemberRole(workspaceId, member.userId, role))}
                      />
                    ) : (
                      ROLE_LABELS[member.role]
                    )}
                  </td>
                  {canManage && (
                    <td>
                      {member.userId !== props.currentUserId && (
                        <button type="button" className="quiet" disabled={busy} onClick={() => void act(() => api.removeMember(workspaceId, member.userId))}>
                          Remove {member.displayName}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canManage && <AddMember workspaceId={workspaceId} onAdded={refresh} />}
      {context.capabilities.includes('workspace.settings.manage') && (
        <RenameWorkspace context={context} onRenamed={props.onWorkspacesChanged} />
      )}
      <div className="card stack">
        <h3 style={{ marginTop: 0 }}>Leave this Workspace</h3>
        <p className="muted">An admin must add you again to regain access. The last admin cannot leave.</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm('Leave this Workspace? An admin must add you again to regain access.')) {
              void act(
                () => api.leaveWorkspace(workspaceId),
                () => {
                  props.onWorkspacesChanged();
                  navigate('/', { replace: true });
                },
              );
            }
          }}
        >
          Leave Workspace
        </button>
      </div>
    </>
  );
}
