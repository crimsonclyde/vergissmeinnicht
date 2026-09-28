import { useEffect, useId, useRef, useState } from 'react';
import type { CurrentUser } from './api.ts';
import { t, type MessageKey } from './i18n/index.ts';
import { Link } from './router.tsx';

/** Links of the menu. "Server admin" only for server admins (UI only — the server checks every admin request). */
export function menuLinks(user: Pick<CurrentUser, 'serverAdmin'>): { href: string; label: MessageKey }[] {
  return [{ href: '/account', label: 'menu.profile' }, ...(user.serverAdmin ? [{ href: '/admin', label: 'shell.serverAdmin' as const }] : [])];
}

/**
 * The menu button (☰) in the header: profile & settings, server administration (only for server
 * admins — the server still checks every request) and sign-out. A disclosure, not an ARIA menu:
 * the panel holds ordinary links and a button, reachable with Tab; Escape or a click outside closes it.
 */
export function UserMenu(props: { user: CurrentUser; onSignOut: () => void }) {
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
  const initial = [...props.user.displayName.trim()][0]?.toUpperCase() ?? '?';

  return (
    <div className="user-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="menu-button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t('menu.open')}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="avatar" aria-hidden="true">
          {initial}
        </span>
        <span aria-hidden="true">☰</span>
      </button>
      {open && (
        <div id={panelId} className="menu-panel">
          <p className="menu-identity">
            <strong>{props.user.displayName}</strong>
            <br />
            <small className="muted">{props.user.email}</small>
          </p>
          <nav aria-label={t('shell.accountNav')}>
            {menuLinks(props.user).map((link) => (
              <Link key={link.href} href={link.href} onClick={close}>
                {t(link.label)}
              </Link>
            ))}
          </nav>
          <button
            type="button"
            className="quiet"
            onClick={() => {
              close();
              props.onSignOut();
            }}
          >
            {t('shell.signOut')}
          </button>
        </div>
      )}
    </div>
  );
}
