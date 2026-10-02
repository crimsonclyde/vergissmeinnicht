import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, messageFor, WORKSPACE_ROLES, type WorkspaceMember, type WorkspaceRole } from './api.ts';
import { WorkspaceStorageCard } from './Storage.tsx';
import { navigate, paths } from './router.tsx';
import type { WorkspaceContext } from './workspace-context.ts';
import { t } from './i18n/index.ts';

export const roleLabel = (role: WorkspaceRole): string => t(`role.${role}`);
const roleHelp = (role: WorkspaceRole): string => t(`roleHelp.${role}`);

function RoleSelect(props: { label: string; value: WorkspaceRole; disabled?: boolean; onChange: (role: WorkspaceRole) => void }) {
  return (
    <select aria-label={props.label} value={props.value} disabled={props.disabled} onChange={(e) => props.onChange(e.target.value as WorkspaceRole)}>
      {WORKSPACE_ROLES.map((role) => (
        <option key={role} value={role}>
          {roleLabel(role)}
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
        {t('members.addHeading')}
      </h3>
      <p className="muted">{t('members.addHint')}</p>
      {message !== null && <p role="alert">{message}</p>}
      <div className="row">
        <label>
          {t('members.email')}
          <br />
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          {t('members.role')}
          <br />
          <RoleSelect label={t('members.roleForNew')} value={role} onChange={setRole} />
        </label>
      </div>
      <p className="muted">{t('members.roleExplained', { role: roleLabel(role), help: roleHelp(role) })}</p>
      <button type="submit" className="primary" disabled={busy}>
        {t('members.add')}
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
      setMessage(t('workspace.saved'));
    } catch (caught) {
      setMessage(messageFor(caught));
    }
  }

  return (
    <form onSubmit={submit} className="card stack">
      <h3 style={{ marginTop: 0 }}>{t('workspace.nameHeading')}</h3>
      {message !== null && <p role="status">{message}</p>}
      <label>
        {t('workspace.name')}
        <br />
        <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <button type="submit">{t('workspace.rename')}</button>
    </form>
  );
}

/** Capabilities only adapt the UI; the server authorizes every request. */
export const workspaceSettingsSections = (workspaceId: string, capabilities: readonly string[], current: 'settings' | 'members' | 'knots') => [
  { href: paths.settings(workspaceId), label: t('workspaceSettings.general'), current: current === 'settings' },
  { href: paths.members(workspaceId), label: t('members.heading'), current: current === 'members' },
  ...(capabilities.includes('knot.manage') ? [{ href: paths.knots(workspaceId), label: t('workspaceSettings.sharing'), current: current === 'knots' }] : []),
];

/** Workspace settings → General: the name (for those who manage settings), the own role, leaving. */
/**
 * The optional tools of the Workspace (16.2), for Workspace admins: a tool switched on appears for every
 * member; switched off it is hidden for everyone and its content is kept. There is no personal hiding.
 */
function WorkspaceTools(props: { context: WorkspaceContext; onChanged: () => void }) {
  const { context } = props;
  const [status, setStatus] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Shown at once; put back if the server refuses.
  const [on, setOn] = useState<readonly string[]>(context.tools);
  const tools = [
    { tool: 'DOCUMENTS', name: t('tools.documents'), hint: t('tools.documentsHint') },
    { tool: 'CONTACTS', name: t('tools.contacts'), hint: t('tools.contactsHint') },
    { tool: 'MAINTENANCE', name: t('tools.maintenance'), hint: t('tools.maintenanceHint') },
  ];
  async function set(tool: string, name: string, enabled: boolean) {
    const before = on;
    setBusy(true);
    setMessage(null);
    setOn(enabled ? [...on, tool] : on.filter((each) => each !== tool));
    try {
      await api.setWorkspaceTool(context.workspace.id, tool, enabled);
      setStatus(t(enabled ? 'tools.on' : 'tools.off', { tool: name }));
      props.onChanged();
    } catch (caught) {
      setOn(before);
      setStatus(null);
      setMessage(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card stack">
      <h3 style={{ marginTop: 0 }}>{t('tools.heading')}</h3>
      <p className="muted" style={{ margin: 0 }}>
        {t('tools.hint')}
      </p>
      {message !== null && <p role="alert">{message}</p>}
      {tools.map(({ tool, name, hint }) => (
        <label key={tool} className="option-label tool-switch">
          <input type="checkbox" checked={on.includes(tool)} disabled={busy} aria-describedby={`tool-${tool}-hint`} onChange={(event) => void set(tool, name, event.target.checked)} />
          <span>
            <strong>{name}</strong>
            <br />
            <small id={`tool-${tool}-hint`} className="muted">
              {hint}
            </small>
          </span>
        </label>
      ))}
      <p role="status" style={{ margin: 0 }}>
        {status ?? ''}
      </p>
    </div>
  );
}

export function WorkspaceGeneral(props: { context: WorkspaceContext; onWorkspacesChanged: () => void }) {
  const { context } = props;
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function leave() {
    if (!window.confirm(t('workspace.leaveConfirm'))) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.leaveWorkspace(context.workspace.id);
      props.onWorkspacesChanged();
      navigate('/', { replace: true });
    } catch (caught) {
      setMessage(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {message !== null && <p role="alert">{message}</p>}
      {context.capabilities.includes('workspace.settings.manage') ? (
        <RenameWorkspace context={context} onRenamed={props.onWorkspacesChanged} />
      ) : (
        <div className="card stack">
          <h3 style={{ marginTop: 0 }}>{t('workspace.nameHeading')}</h3>
          <p style={{ margin: 0 }}>{context.workspace.name}</p>
        </div>
      )}
      {context.capabilities.includes('workspace.tools.manage') && <WorkspaceTools context={context} onChanged={props.onWorkspacesChanged} />}
      {context.capabilities.includes('workspace.settings.manage') && <WorkspaceStorageCard workspaceId={context.workspace.id} />}
      <div className="card stack">
        <h3 style={{ marginTop: 0 }}>{t('workspaceSettings.roleHeading')}</h3>
        <p style={{ margin: 0 }}>{t('members.yourRole', { role: roleLabel(context.workspace.role), help: roleHelp(context.workspace.role) })}</p>
      </div>
      <div className="card stack">
        <h3 style={{ marginTop: 0 }}>{t('workspace.leaveHeading')}</h3>
        <p className="muted">{t('workspace.leaveHint')}</p>
        <div>
          <button type="button" className="danger" disabled={busy} onClick={() => void leave()}>
            {t('workspace.leave')}
          </button>
        </div>
      </div>
    </>
  );
}

/** Workspace settings → Members; management controls only for members who manage it (the server decides). */
export function MembersPage(props: { context: WorkspaceContext; currentUserId: string }) {
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

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      refresh();
    } catch (caught) {
      setMessage(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        {t('members.yourRole', { role: roleLabel(context.workspace.role), help: roleHelp(context.workspace.role) })}
      </p>
      {message !== null && <p role="alert">{message}</p>}
      {!canView ? (
        <p className="muted">{t('members.guestsCannotSee')}</p>
      ) : members === null ? (
        <p>{t('common.loading')}</p>
      ) : (
        <div className="card table-wrap">
          <table>
            <caption>{t('members.heading')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('members.column.name')}</th>
                {canManage && <th scope="col">{t('members.column.email')}</th>}
                <th scope="col">{t('members.column.role')}</th>
                {canManage && <th scope="col">{t('members.column.actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.userId}>
                  <td>
                    {member.displayName}
                    {member.userId === props.currentUserId && <span className="muted">{t('members.you')}</span>}
                    {member.status === 'DISABLED' && t('members.disabled')}
                  </td>
                  {canManage && <td>{member.email}</td>}
                  <td>
                    {canManage ? (
                      <RoleSelect
                        label={t('members.roleOf', { name: member.displayName })}
                        value={member.role}
                        disabled={busy}
                        onChange={(role) => void act(() => api.changeMemberRole(workspaceId, member.userId, role))}
                      />
                    ) : (
                      roleLabel(member.role)
                    )}
                  </td>
                  {canManage && (
                    <td>
                      {member.userId !== props.currentUserId && (
                        <button type="button" className="quiet" disabled={busy} onClick={() => void act(() => api.removeMember(workspaceId, member.userId))}>
                          {t('members.remove', { name: member.displayName })}
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
    </>
  );
}
