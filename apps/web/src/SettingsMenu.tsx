import { useEffect, useId, useRef, useState } from 'react';
import type { CurrentUser } from './api.ts';
import { t, type MessageKey } from './i18n/index.ts';
import { Link, paths } from './router.tsx';
import { UiIcon, type UiIconName } from './ui-icons.tsx';

export interface SettingsLink {
  readonly href: string;
  readonly label: MessageKey;
  readonly icon: UiIconName;
  /** A short remark next to the entry (e.g. "Admin only"). */
  readonly note?: MessageKey;
}

/**
 * The entries of the Settings menu (15.1): Profile & settings for everyone, Workspace settings while a
 * Workspace is open, Server admin only for server admins. UI only — the server authorizes every request.
 */
export function settingsLinks(user: Pick<CurrentUser, 'serverAdmin'>, workspaceId: string | null): SettingsLink[] {
  return [
    { href: paths.account('notifications'), label: 'menu.profile', icon: 'profile' },
    ...(workspaceId === null ? [] : [{ href: paths.settings(workspaceId), label: 'menu.workspaceSettings' as const, icon: 'settings' as const }]),
    ...(user.serverAdmin ? [{ href: paths.admin('workspaces'), label: 'shell.serverAdmin' as const, icon: 'server' as const, note: 'menu.adminOnly' as const }] : []),
  ];
}

/**
 * The one Settings entry: at the bottom of the sidebar on desktop, a button in the header on phones.
 * A disclosure, not an ARIA menu: the panel holds ordinary links and a button, reachable with Tab;
 * Escape or a click outside closes it and focus returns to the button.
 */
export function SettingsMenu(props: { user: CurrentUser; workspaceId: string | null; currentPath: string; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className="settings-menu" ref={rootRef}>
      <button ref={buttonRef} type="button" className="settings-button" aria-expanded={open} aria-controls={panelId} aria-label={t('menu.open')} onClick={() => setOpen((value) => !value)}>
        <UiIcon name="settings" />
        <span className="settings-label" aria-hidden="true">
          {t('menu.settings')}
        </span>
      </button>
      {open && (
        <div id={panelId} className="menu-panel">
          <p className="menu-identity">
            <strong>{props.user.displayName}</strong>
            <br />
            <small className="muted">{props.user.email}</small>
          </p>
          <nav aria-label={t('menu.settings')}>
            {settingsLinks(props.user, props.workspaceId).map((link) => (
              <Link key={link.href} href={link.href} onClick={close} aria-current={props.currentPath.startsWith(link.href) ? 'page' : undefined}>
                <UiIcon name={link.icon} />
                {t(link.label)}
                {link.note !== undefined && <span className="menu-note">{t(link.note)}</span>}
              </Link>
            ))}
          </nav>
          <button
            type="button"
            className="menu-separated"
            onClick={() => {
              close();
              props.onSignOut();
            }}
          >
            <UiIcon name="signOut" />
            {t('shell.signOut')}
          </button>
        </div>
      )}
    </div>
  );
}
