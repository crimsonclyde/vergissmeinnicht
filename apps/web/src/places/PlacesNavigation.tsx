import { useEffect, useId, useRef, useState } from 'react';
import { t } from '../i18n/index.ts';
import { Link, type Route } from '../router.tsx';
import { useThemeMode } from '../theme.ts';
import { UiIcon, type UiIconName } from '../ui-icons.tsx';
import { placeForTheme } from './registry.ts';

type Destination = { readonly href: string; readonly label: string; readonly icon: UiIconName; readonly pages: readonly Route['page'][] };
/** The same enabled destinations, presented as one dock and one disclosure in Places. */
export function PlacesNavigation({ items, all, page }: { items: readonly Destination[]; all: readonly Destination[]; page: Route['page'] }) {
  const [mode] = useThemeMode();
  const places = placeForTheme(mode) !== null;
  const [open, setOpen] = useState(false);
  const id = useId(); const root = useRef<HTMLElement>(null); const more = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); more.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <nav ref={root} aria-label={t('shell.tools')} className={places ? 'tab-bar places-dock' : 'tab-bar'}>
    {items.map(item => places && item.pages.includes('more') ? <button key={item.href} type="button" ref={more} aria-expanded={open} aria-controls={id} aria-current={item.pages.includes(page) ? 'page' : undefined} onClick={() => setOpen(!open)}><UiIcon name="grid" size="1.4em" /><span>{item.label}</span></button> : <Link key={item.href} href={item.href} aria-current={item.pages.includes(page) ? 'page' : undefined} onClick={() => setOpen(false)}><UiIcon name={item.icon} size="1.4em" /><span>{item.label}</span></Link>)}
    {places && open && <div id={id} className="places-tools"><div className="places-tools-heading"><strong>{t('shell.tools')}</strong><button type="button" className="quiet icon-button" aria-label={t('common.close')} onClick={() => { setOpen(false); more.current?.focus(); }}><UiIcon name="close" /></button></div><div className="places-tool-grid">{all.map(item => <Link key={item.href} href={item.href} onClick={() => setOpen(false)} aria-current={item.pages.includes(page) ? 'page' : undefined}><UiIcon name={item.icon} /><span>{item.label}</span></Link>)}</div><Link className="places-all-tools" href={items.find(item => item.pages.includes('more'))?.href ?? '/'} onClick={() => setOpen(false)}>{t('shell.more')} <UiIcon name="forward" /></Link></div>}
  </nav>;
}
