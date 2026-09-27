import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Procedures } from './Procedures.tsx';
import { Runs } from './Runs.tsx';
import {
  api,
  messageFor,
  WORKSPACE_ROLES,
  type CurrentUser,
  type WorkspaceMember,
  type WorkspaceRole,
  type WorkspaceSummary,
} from './api.ts';

const ROLE_LABELS: Record<WorkspaceRole, string> = { GUEST: 'Guest', USER: 'User', EDITOR: 'Editor', ADMIN: 'Admin' };

function RoleSelect(props: { label: string; value: WorkspaceRole; disabled?: boolean; onChange: (role: WorkspaceRole) => void }) {
  return (
    <select
      aria-label={props.label}
      value={props.value}
      disabled={props.disabled}
      onChange={(e) => props.onChange(e.target.value as WorkspaceRole)}
    >
      {WORKSPACE_ROLES.map((role) => (
        <option key={role} value={role}>
          {ROLE_LABELS[role]}
        </option>
      ))}
    </select>
  );
}

function CreateWorkspace({ onCreated }: { onCreated: (workspace: WorkspaceSummary) => void }) {
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      onCreated(await api.createWorkspace(name));
      setName('');
    } catch (caught) {
      setMessage(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {message !== null && <p role="alert">{message}</p>}
      <label>
        New Workspace name
        <br />
        <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </label>{' '}
      <button type="submit" disabled={busy}>
        Create Workspace
      </button>
    </form>
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
    <form onSubmit={submit} aria-labelledby="add-member-heading">
      <h4 id="add-member-heading">Add member</h4>
      {message !== null && <p role="alert">{message}</p>}
      <label>
        Member email
        <br />
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>{' '}
      <RoleSelect label="Role for new member" value={role} onChange={setRole} />{' '}
      <button type="submit" disabled={busy}>
        Add
      </button>
    </form>
  );
}

function WorkspaceDetail({ id, currentUserId, onLeft }: { id: string; currentUserId: string; onLeft: () => void }) {
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  // Capabilities only adapt the UI; the server enforces them on every request.
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    api
      .workspace(id)
      .then(async (result) => {
        setWorkspace(result.workspace);
        setCapabilities(result.capabilities);
        setMembers(result.capabilities.includes('workspace.members.view') ? await api.members(id) : null);
      })
      .catch((caught: unknown) => {
        setWorkspace(null);
        setMessage(messageFor(caught));
      });
  }, [id]);
  useEffect(refresh, [refresh]);

  async function act(action: () => Promise<unknown>, leavesWorkspace = false) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      if (leavesWorkspace) onLeft();
      else refresh();
    } catch (caught) {
      setMessage(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  const canManage = capabilities.includes('workspace.members.manage');

  if (workspace === null) return message === null ? <p>Loading…</p> : <p role="alert">{message}</p>;
  return (
    <section aria-labelledby="workspace-heading">
      <h3 id="workspace-heading">{workspace.name}</h3>
      <p>Your role: {ROLE_LABELS[workspace.role]}</p>
      {message !== null && <p role="alert">{message}</p>}
      {capabilities.includes('procedure.view') && (
        <Procedures
          workspaceId={id}
          canEdit={capabilities.includes('procedure.edit')}
          canRestore={capabilities.includes('procedure.restore')}
          canStartRun={capabilities.includes('run.start')}
          onRunStarted={setOpenRunId}
        />
      )}
      {capabilities.includes('run.view') && <Runs workspaceId={id} openRunId={openRunId} onOpen={setOpenRunId} />}
      {members !== null && (
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
                  {member.status === 'DISABLED' && ' (disabled)'}
                </td>
                {canManage && <td>{member.email}</td>}
                <td>
                  {canManage ? (
                    <RoleSelect
                      label={`Role of ${member.displayName}`}
                      value={member.role}
                      disabled={busy}
                      onChange={(role) => void act(() => api.changeMemberRole(id, member.userId, role))}
                    />
                  ) : (
                    ROLE_LABELS[member.role]
                  )}
                </td>
                {canManage && (
                  <td>
                    {member.userId !== currentUserId && (
                      <button type="button" disabled={busy} onClick={() => void act(() => api.removeMember(id, member.userId))}>
                        Remove {member.displayName}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canManage && <AddMember workspaceId={id} onAdded={refresh} />}
      <p>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm('Leave this Workspace? An admin must add you again to regain access.')) {
              void act(() => api.leaveWorkspace(id), true);
            }
          }}
        >
          Leave Workspace
        </button>
      </p>
    </section>
  );
}

export function Workspaces({ user }: { user: CurrentUser }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.workspaces().then(setWorkspaces, (caught: unknown) => setMessage(messageFor(caught)));
  }, []);
  useEffect(refresh, [refresh]);

  return (
    <section aria-labelledby="workspaces-heading">
      <h2 id="workspaces-heading">Workspaces</h2>
      {message !== null && <p role="alert">{message}</p>}
      {workspaces === null ? (
        <p>Loading…</p>
      ) : workspaces.length === 0 ? (
        <p>You are not a member of any Workspace yet.</p>
      ) : (
        <ul aria-label="Your Workspaces">
          {workspaces.map((workspace) => (
            <li key={workspace.id}>
              <button type="button" aria-pressed={selected === workspace.id} onClick={() => setSelected(workspace.id)}>
                {workspace.name}
              </button>{' '}
              ({ROLE_LABELS[workspace.role]})
            </li>
          ))}
        </ul>
      )}
      {user.serverAdmin && (
        <CreateWorkspace
          onCreated={(workspace) => {
            setSelected(workspace.id);
            refresh();
          }}
        />
      )}
      {selected !== null && (
        <WorkspaceDetail
          key={selected}
          id={selected}
          currentUserId={user.id}
          onLeft={() => {
            setSelected(null);
            refresh();
          }}
        />
      )}
    </section>
  );
}
