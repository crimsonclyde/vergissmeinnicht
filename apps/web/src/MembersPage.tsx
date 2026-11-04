import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, memberAvatarUrl, messageFor, WORKSPACE_ROLES, type WorkspaceMember, type WorkspaceRole } from './api.ts';
import { Avatar } from './Avatar.tsx';
import { UiIcon } from './ui-icons.tsx';
import { WorkspaceLocationCard } from './WorkspaceLocation.tsx';
import { WorkspaceStorageCard } from './Storage.tsx';
import { TextRecognitionCard } from './TextRecognition.tsx';
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

export type WorkspaceSettingsPage = 'settings' | 'members' | 'plugins' | 'knots' | 'storage' | 'backup';

/**
 * The Workspace settings sections (15.1; icons and groups since section 29): Workspace (General,
 * Members), Tools (Plugins, Sharing links), Data (Storage, Backup). Capabilities only adapt the UI;
 * the server authorizes every request.
 */
export const workspaceSettingsSections = (workspaceId: string, capabilities: readonly string[], current: WorkspaceSettingsPage) => {
  const workspace = t('settings.group.workspace');
  const tools = t('settings.group.tools');
  const data = t('settings.group.data');
  return [
    { href: paths.settings(workspaceId), label: t('workspaceSettings.general'), current: current === 'settings', icon: 'settings' as const, group: workspace },
    { href: paths.members(workspaceId), label: t('members.heading'), current: current === 'members', icon: 'contacts' as const, group: workspace },
    // Workspace admins only: the on/off switches of every tool.
    ...(capabilities.includes('workspace.tools.manage') ? [{ href: paths.plugins(workspaceId), label: t('workspaceSettings.plugins'), current: current === 'plugins', icon: 'plugins' as const, group: tools }] : []),
    ...(capabilities.includes('knot.manage') ? [{ href: paths.knots(workspaceId), label: t('workspaceSettings.sharing'), current: current === 'knots', icon: 'share' as const, group: tools }] : []),
    // The shared storage limit and text recognition: those who manage the Workspace's settings.
    ...(capabilities.includes('workspace.settings.manage') ? [{ href: paths.storage(workspaceId), label: t('workspaceSettings.storage'), current: current === 'storage', icon: 'storage' as const, group: data }] : []),
    // Section 18: Workspace admins only (B1).
    ...(capabilities.includes('workspace.backup') ? [{ href: paths.backup(workspaceId), label: t('backup.heading'), current: current === 'backup', icon: 'backup' as const, group: data }] : []),
  ];
};

/** Workspace settings → Storage (section 29): the shared limit and, with Documents on, text recognition. */
export function WorkspaceStoragePage(props: { context: WorkspaceContext }) {
  const { context } = props;
  return (
    <>
      <WorkspaceStorageCard workspaceId={context.workspace.id} />
      {context.tools.includes('DOCUMENTS') && <TextRecognitionCard workspaceId={context.workspace.id} />}
    </>
  );
}

/** Workspace settings → General: the name (for those who manage settings), the location, the own role, leaving. */
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
      <WorkspaceLocationCard key={context.workspace.id} workspaceId={context.workspace.id} canManage={context.capabilities.includes('workspace.settings.manage')} />
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
      {message !== null && <p role="alert">{message}</p>}
      {!canView ? (
        <p className="muted">{t('members.guestsCannotSee')}</p>
      ) : members === null ? (
        <p>{t('common.loading')}</p>
      ) : (
        // Section 29: one row per person — picture, name (and email for admins), role, remove.
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t('members.heading')}</h3>
          <ul className="member-list" aria-label={t('members.heading')}>
            {members.map((member) => (
              <li key={member.userId}>
                <Avatar name={member.displayName} seed={member.userId} src={member.avatar == null ? null : memberAvatarUrl(workspaceId, member.userId, member.avatar)} size="medium" />
                <span className="member-who">
                  <strong>
                    {member.displayName}
                    {member.userId === props.currentUserId && <span className="muted">{t('members.you')}</span>}
                    {member.status === 'DISABLED' && <span className="muted">{t('members.disabled')}</span>}
                  </strong>
                  {canManage && member.email !== undefined && <small className="muted">{member.email}</small>}
                </span>
                {canManage ? (
                  <RoleSelect
                    label={t('members.roleOf', { name: member.displayName })}
                    value={member.role}
                    disabled={busy}
                    onChange={(role) => void act(() => api.changeMemberRole(workspaceId, member.userId, role))}
                  />
                ) : (
                  <span className="badge">{roleLabel(member.role)}</span>
                )}
                {canManage &&
                  (member.userId !== props.currentUserId ? (
                    <button type="button" className="icon-button quiet" disabled={busy} aria-label={t('members.remove', { name: member.displayName })} title={t('members.remove', { name: member.displayName })} onClick={() => void act(() => api.removeMember(workspaceId, member.userId))}>
                      <UiIcon name="trash" />
                    </button>
                  ) : (
                    <span className="member-action-spacer" aria-hidden="true" />
                  ))}
              </li>
            ))}
          </ul>
        </div>
      )}
      {canManage && <AddMember workspaceId={workspaceId} onAdded={refresh} />}
    </>
  );
}
