import { useRef, useState } from 'react';
import { api, ownAvatarUrl, type CurrentUser, type WorkspaceSummary } from './api.ts';
import { Avatar } from './Avatar.tsx';
import { t } from './i18n/index.ts';
import { prepareAvatar } from './image-prep.ts';
import { roleLabel } from './MembersPage.tsx';
import { usePreferences } from './preferences.tsx';
import { Link, paths } from './router.tsx';
import { imageErrorMessage } from './StepImage.tsx';
import { UiIcon } from './ui-icons.tsx';

/** The heading of Profile & settings (section 29): picture, name and email instead of a plain title. */
export function ProfileIdentity({ user, avatar }: { user: CurrentUser; avatar: string | null }) {
  return (
    <div className="settings-identity">
      <Avatar name={user.displayName} seed={user.id} src={avatar === null ? null : ownAvatarUrl(avatar)} size="medium" />
      <div>
        <h2>{t('account.heading')}</h2>
        <span className="muted">{t('account.identity', { name: user.displayName, email: user.email })}</span>
      </div>
    </div>
  );
}

/**
 * Profile & settings → Profile (section 29): the picture (add, change, remove) and the Workspaces the
 * person belongs to. The picture is cut to a square and re-encoded on the device first; the server
 * checks and re-encodes it again and keeps no metadata.
 */
export function ProfileSettings(props: { user: CurrentUser; avatar: string | null; onAvatarChanged: (version: string | null) => void; workspaces: readonly WorkspaceSummary[] | null }) {
  const { user, avatar } = props;
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'alert' | 'status'; text: string } | null>(null);
  const { workspacePreferences } = usePreferences();

  async function choose(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      const prepared = await prepareAvatar(file);
      if (prepared.kind === 'too_large') {
        setMessage({ kind: 'alert', text: t('error.image_too_large') });
        return;
      }
      props.onAvatarChanged(await api.uploadAvatar(prepared.blob));
      setMessage({ kind: 'status', text: t('profile.pictureSaved') });
    } catch (caught) {
      setMessage({ kind: 'alert', text: imageErrorMessage(caught) });
    } finally {
      setBusy(false);
      if (input.current !== null) input.current.value = '';
    }
  }

  async function remove() {
    setBusy(true);
    setMessage(null);
    try {
      await api.removeAvatar();
      props.onAvatarChanged(null);
      setMessage({ kind: 'status', text: t('profile.pictureRemoved') });
    } catch (caught) {
      setMessage({ kind: 'alert', text: imageErrorMessage(caught) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="card profile-card">
        <div className="profile-picture">
          <Avatar name={user.displayName} seed={user.id} src={avatar === null ? null : ownAvatarUrl(avatar)} size="large" />
          <div className="profile-picture-actions">
            <button type="button" className="icon-button" disabled={busy} aria-label={t(avatar === null ? 'profile.addPicture' : 'profile.changePicture')} title={t(avatar === null ? 'profile.addPicture' : 'profile.changePicture')} onClick={() => input.current?.click()}>
              <UiIcon name="camera" />
            </button>
            {avatar !== null && (
              <button type="button" className="icon-button" disabled={busy} aria-label={t('profile.removePicture')} title={t('profile.removePicture')} onClick={() => void remove()}>
                <UiIcon name="trash" />
              </button>
            )}
          </div>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) void choose(file);
            }}
          />
        </div>
        <div className="profile-name">
          <h3>{user.displayName}</h3>
          <p className="muted">{user.email}</p>
          <p>
            <small className="muted">{t('profile.pictureHint')}</small>
          </p>
          {message !== null && (
            <p role={message.kind} className={message.kind === 'status' ? 'muted' : undefined}>
              {message.text}
            </p>
          )}
        </div>
      </div>
      {props.workspaces !== null && props.workspaces.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t('profile.workspaces')}</h3>
          <ul className="profile-workspaces">
            {props.workspaces.map((workspace) => (
              <li key={workspace.id}>
                <Link href={paths.home(workspace.id)}>{workspace.name}</Link>
                {workspacePreferences.defaultWorkspaceId === workspace.id && (
                  <span className="profile-default" title={t('profile.opensFirst')}>
                    <UiIcon name="starFilled" />
                    <span className="visually-hidden">{t('profile.opensFirst')}</span>
                  </span>
                )}
                <span className="badge">{roleLabel(workspace.role)}</span>
                <Link href={paths.settings(workspace.id)} className="icon-button quiet" aria-label={t('profile.workspaceSettingsOf', { name: workspace.name })} title={t('menu.workspaceSettings')}>
                  <UiIcon name="settings" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
