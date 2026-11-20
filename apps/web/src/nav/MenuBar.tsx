import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { t } from '../i18n/index.ts';
import { isCurrent, type Navigation } from '../navigation.ts';
import { Link, type Route } from '../router.tsx';
import { UiIcon, type UiIconName } from '../ui-icons.tsx';
import './navigation.css';

/**
 * One drop-down of the top bar (46): a disclosure button with plain links (not an ARIA menu), so every
 * entry stays an ordinary link. ↓/↑ enter the list and move through it, Escape returns to the button, Tab,
 * a click outside or a page change closes it.
 */
export function MenuDropdown({ icon, label, buttonLabel, current, page, className, children }: {
  icon: UiIconName | null;
  label: string;
  /** What the button shows when it differs from its name (the Workspace's name). */
  buttonLabel?: string;
  current: boolean;
  page: Route['page'];
  className?: string;
  children: (close: () => void) => ReactNode;
}) {
  // Open on one page only: a page change (a link, Back) closes the menu.
  const [openOn, setOpenOn] = useState<Route['page'] | null>(null);
  const open = openOn === page;
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpenOn(null); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const entries = () => Array.from(root.current?.querySelectorAll<HTMLAnchorElement>(`#${CSS.escape(id)} a`) ?? []);
  const focusEntry = (which: 'first' | 'last') => requestAnimationFrame(() => { const list = entries(); (which === 'first' ? list[0] : list.at(-1))?.focus(); });
  const close = () => setOpenOn(null);

  function onButtonKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpenOn(page); focusEntry(event.key === 'ArrowDown' ? 'first' : 'last'); }
    else if (event.key === 'Escape' && open) { event.preventDefault(); close(); }
  }
  function onPanelKey(event: KeyboardEvent<HTMLDivElement>) {
    const list = entries();
    const at = list.indexOf(document.activeElement as HTMLAnchorElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); list[(at + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus(); }
    else if (event.key === 'Escape') { event.preventDefault(); close(); button.current?.focus(); }
    else if (event.key === 'Tab') close();
  }

  return <div ref={root} className={`menu-bar-group ${className ?? ''}`}>
    <button
      type="button"
      ref={button}
      className="menu-bar-top"
      title={label}
      aria-label={buttonLabel === undefined ? undefined : label}
      aria-expanded={open}
      aria-controls={id}
      data-current={current || undefined}
      onClick={() => setOpenOn(open ? null : page)}
      onKeyDown={onButtonKey}
    >
      {icon !== null && <UiIcon name={icon} />}<span className="menu-bar-label">{buttonLabel ?? label}</span><UiIcon name="expand" size="1em" />
    </button>
    <div id={id} className="menu-bar-panel" hidden={!open} onKeyDown={onPanelKey}>
      {children(close)}
    </div>
  </div>;
}

/**
 * The top bar's tools (46): Dashboard, News (The Daily Planet, when on) and one **All tools** drop-down
 * holding every other tool in its family (Plan, Shop & cook, House). Weather and the time are status
 * items beside it (GuideGlance).
 */
export function MenuBar({ nav, page }: { nav: Navigation; page: Route['page'] }) {
  const groups = nav.groups.filter(group => group.id !== 'instruments');
  const link = (item: Navigation['today']) => <Link className="menu-bar-top" title={item.label} href={item.href} aria-current={item.pages.includes(page) ? 'page' : undefined}>
    <UiIcon name={item.icon} /><span className="menu-bar-label">{item.label}</span>
  </Link>;
  return <nav className="menu-bar" aria-label={t('shell.tools')}>
    {link(nav.today)}
    {nav.news && link(nav.news)}
    {groups.length > 0 && <MenuDropdown icon="grid" label={t('navigation.allTools')} current={groups.some(group => isCurrent(group.items, page))} page={page} className="menu-bar-all">
      {close => <div className="menu-bar-families">
        {groups.map(group => <div key={group.id} className="menu-bar-family" role="group" aria-labelledby={`menu-family-${group.id}`}>
          <span id={`menu-family-${group.id}`} className="menu-bar-caption"><UiIcon name={group.icon} size="1em" /> {group.label}</span>
          <ul className="plain-list" aria-label={group.label}>
            {group.items.map(item => <li key={item.href}>
              <Link href={item.href} aria-current={item.pages.includes(page) ? 'page' : undefined} onClick={close}>
                <span className="menu-bar-icon"><UiIcon name={item.icon} /></span><span>{item.label}</span>
              </Link>
            </li>)}
          </ul>
        </div>)}
      </div>}
    </MenuDropdown>}
  </nav>;
}
