import { useEffect, useId, useRef, useState } from 'react';
import type { CurrentUser } from './api.ts';
import { t } from './i18n/index.ts';
import { Link } from './router.tsx';

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
            <Link href="/account" onClick={close}>
              {t('menu.profile')}
            </Link>
            {props.user.serverAdmin && (
              <Link href="/admin" onClick={close}>
                {t('shell.serverAdmin')}
              </Link>
            )}
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
