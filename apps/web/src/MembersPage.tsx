import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, messageFor, WORKSPACE_ROLES, type WorkspaceMember, type WorkspaceRole } from './api.ts';
import { navigate } from './router.tsx';
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
        <h2>{t('members.heading')}</h2>
        <span className="muted">
          {t('members.yourRole', { role: roleLabel(context.workspace.role), help: roleHelp(context.workspace.role) })}
        </span>
      </div>
      {message !== null && <p role="alert">{message}</p>}
      {!canView ? (
        <p className="muted">{t('members.guestsCannotSee')}</p>
      ) : members === null ? (
        <p>{t('common.loading')}</p>
      ) : (
        <div className="card">
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
      {context.capabilities.includes('workspace.settings.manage') && (
        <RenameWorkspace context={context} onRenamed={props.onWorkspacesChanged} />
      )}
      <div className="card stack">
        <h3 style={{ marginTop: 0 }}>{t('workspace.leaveHeading')}</h3>
        <p className="muted">{t('workspace.leaveHint')}</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm(t('workspace.leaveConfirm'))) {
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
          {t('workspace.leave')}
        </button>
      </div>
    </>
  );
}
