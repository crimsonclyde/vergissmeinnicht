import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { t } from '../i18n/index.ts';
import { isCurrent, type Navigation } from '../navigation.ts';
import { Link, type Route } from '../router.tsx';
import { UiIcon } from '../ui-icons.tsx';
import './navigation.css';

/**
 * The desktop menu bar (section 42): Dashboard, then one drop-down per family, like a menu bar on a Mac.
 * Disclosure buttons with plain links (not ARIA menus), so every entry stays an ordinary link. Once a menu
 * is open, pointing at a neighbour opens that one; arrows move between menus and entries; Escape closes.
 * Instruments are not here: they sit on the right as status items.
 */
export function MenuBar({ nav, page }: { nav: Navigation; page: Route['page'] }) {
  const groups = nav.groups.filter(group => group.id !== 'instruments');
  // Open on one page only: a page change (a link, Back) closes the menu.
  const [state, setState] = useState<{ index: number; page: Route['page'] } | null>(null);
  const open = state !== null && state.page === page ? state.index : null;
  const setOpen = (index: number | null) => setState(index === null ? null : { index, page });
  const root = useRef<HTMLElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  useEffect(() => {
    if (open === null) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setState(null); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const entries = (index: number) => Array.from(root.current?.querySelectorAll<HTMLAnchorElement>(`#${CSS.escape(`${id}-${index}`)} a`) ?? []);
  const focusEntry = (index: number, which: 'first' | 'last') => requestAnimationFrame(() => { const list = entries(index); (which === 'first' ? list[0] : list.at(-1))?.focus(); });
  const move = (from: number, step: number, keepOpen: boolean) => {
    const next = (from + step + groups.length) % groups.length;
    buttons.current[next]?.focus();
    if (keepOpen) setOpen(next);
  };
  const close = (index: number) => { setOpen(null); buttons.current[index]?.focus(); };

  function onButtonKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(index); focusEntry(index, event.key === 'ArrowDown' ? 'first' : 'last'); }
    else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); move(index, event.key === 'ArrowRight' ? 1 : -1, open !== null); }
    else if (event.key === 'Escape' && open !== null) { event.preventDefault(); close(index); }
  }
  function onPanelKey(event: KeyboardEvent<HTMLUListElement>, index: number) {
    const list = entries(index);
    const at = list.indexOf(document.activeElement as HTMLAnchorElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); list[(at + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus(); }
    else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + groups.length) % groups.length; setOpen(next); focusEntry(next, 'first'); }
    else if (event.key === 'Escape') { event.preventDefault(); close(index); }
    else if (event.key === 'Tab') setOpen(null);
  }

  return <nav ref={root} className="menu-bar" aria-label={t('shell.tools')}>
    <Link className="menu-bar-top" title={nav.today.label} href={nav.today.href} aria-current={nav.today.pages.includes(page) ? 'page' : undefined}><UiIcon name="today" /><span className="menu-bar-label">{nav.today.label}</span></Link>
    {groups.map((group, index) => <div key={group.id} className="menu-bar-group">
      <button
        type="button"
        ref={element => { buttons.current[index] = element; }}
        className="menu-bar-top"
        title={group.label}
        aria-expanded={open === index}
        aria-controls={`${id}-${index}`}
        data-current={isCurrent(group.items, page) || undefined}
        onClick={() => setOpen(open === index ? null : index)}
        onPointerEnter={event => { if (open !== null && open !== index && event.pointerType === 'mouse') setOpen(index); }}
        onKeyDown={event => onButtonKey(event, index)}
      >
        <UiIcon name={group.icon} /><span className="menu-bar-label">{group.label}</span><UiIcon name="expand" size="1em" />
      </button>
      <ul id={`${id}-${index}`} className="menu-bar-panel plain-list" hidden={open !== index} aria-label={group.label} onKeyDown={event => onPanelKey(event, index)}>
        {group.items.map(item => <li key={item.href}>
          <Link href={item.href} aria-current={item.pages.includes(page) ? 'page' : undefined} onClick={() => setOpen(null)}>
            <span className="menu-bar-icon"><UiIcon name={item.icon} /></span><span>{item.label}</span>
          </Link>
        </li>)}
      </ul>
    </div>)}
  </nav>;
}
