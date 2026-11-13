import { useEffect, useId, useRef, useState, type TouchEvent } from 'react';
import { t } from '../i18n/index.ts';
import { isCurrent, type Navigation } from '../navigation.ts';
import { placeForTheme } from '../places/registry.ts';
import { Link, type Route } from '../router.tsx';
import { useThemeMode } from '../theme.ts';
import { UiIcon } from '../ui-icons.tsx';
import './navigation.css';

/** How far a finger has to travel before a swipe opens or closes the drawer (CSS pixels). */
const SWIPE = 40;

/**
 * The phone navigation (section 42): Dashboard, the person's two favourite tools and "All tools". "All
 * tools", or a swipe up from the bar, slides up a drawer with every tool in the same families as the desktop
 * menus. The drawer is a native modal dialog: focus stays inside, Escape closes it and focus returns to the
 * button. A swipe down, a tap outside or picking a tool closes it too. Places keeps its floating dock look.
 */
export function PhoneNavigation({ nav, page }: { nav: Navigation; page: Route['page'] }) {
  const [mode] = useThemeMode();
  const places = placeForTheme(mode) !== null;
  // Open on one page only: a tool chosen from the drawer changes the page, and the drawer closes with it.
  const [openOn, setOpenOn] = useState<Route['page'] | null>(null);
  const open = openOn === page;
  const setOpen = (value: boolean) => setOpenOn(value ? page : null);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const start = useRef<number | null>(null);
  const [drag, setDrag] = useState(0);
  const heading = useId();

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  const begin = (event: TouchEvent) => { start.current = event.touches[0]?.clientY ?? null; };
  const barMove = (event: TouchEvent) => {
    const y = event.touches[0]?.clientY;
    if (start.current !== null && y !== undefined && start.current - y > SWIPE) { start.current = null; setOpen(true); }
  };
  const sheetMove = (event: TouchEvent) => {
    const y = event.touches[0]?.clientY;
    if (start.current !== null && y !== undefined) setDrag(Math.max(0, y - start.current));
  };
  const sheetEnd = () => { if (drag > SWIPE * 2) setOpen(false); start.current = null; setDrag(0); };
  const inDrawer = isCurrent(nav.groups.flatMap(group => group.items), page) && !isCurrent(nav.bar, page);

  return <><nav aria-label={t('shell.tools')} className={places ? 'tab-bar places-dock' : 'tab-bar'} onTouchStart={begin} onTouchMove={barMove}>
    {nav.bar.map(item => <Link key={item.href} href={item.href} aria-current={item.pages.includes(page) ? 'page' : undefined}><UiIcon name={item.icon} size="1.4em" /><span>{item.label}</span></Link>)}
    <button type="button" ref={opener} className="tab-bar-tools" aria-haspopup="dialog" aria-expanded={open} data-current={inDrawer || undefined} onClick={() => setOpen(true)}>
      <UiIcon name="grid" size="1.4em" /><span>{t('navigation.allTools')}</span>
    </button>
  </nav>
    <dialog
      ref={dialog}
      className="tool-drawer"
      aria-labelledby={heading}
      onClose={() => { setOpen(false); opener.current?.focus(); }}
      onClick={event => { if (event.target === dialog.current) setOpen(false); }}
    >
      <div className="tool-drawer-sheet" style={drag > 0 ? { transform: `translateY(${drag}px)` } : undefined} onTouchStart={begin} onTouchMove={sheetMove} onTouchEnd={sheetEnd}>
        <div className="tool-drawer-head">
          <span className="tool-drawer-handle" aria-hidden="true" />
          <h2 id={heading} className="visually-hidden">{t('navigation.allTools')}</h2>
          <button type="button" className="quiet icon-button" aria-label={t('common.close')} title={t('navigation.drawerHint')} onClick={() => setOpen(false)}><UiIcon name="close" /></button>
        </div>
        {nav.groups.map(group => <section key={group.id} className="tool-drawer-group" aria-labelledby={`${heading}-${group.id}`}>
          <h3 id={`${heading}-${group.id}`}>{group.label}</h3>
          <ul className="plain-list">
            {group.items.map(item => <li key={item.href}><Link href={item.href} aria-current={item.pages.includes(page) ? 'page' : undefined} onClick={() => setOpen(false)}>
              <span className="tool-drawer-icon"><UiIcon name={item.icon} size="1.35em" /></span><span>{item.label}</span>
            </Link></li>)}
          </ul>
        </section>)}
      </div>
    </dialog>
  </>;
}
