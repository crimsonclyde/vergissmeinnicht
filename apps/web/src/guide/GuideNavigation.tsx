import { useState } from 'react';
import { t } from '../i18n/index.ts';
import { destinations } from '../navigation.ts';
import { usePreferences } from '../preferences.tsx';
import { Link, paths, type Route } from '../router.tsx';
import { UiIcon } from '../ui-icons.tsx';
import { GuideDialog } from './GuideDialog.tsx';

export function GuideNavigation({ workspaceId, tools, page }: { workspaceId: string; tools: readonly string[]; page: Route['page'] }) {
  const { preferences } = usePreferences();
  const nav = destinations(workspaceId, tools, preferences.navigationOrder);
  const [open, setOpen] = useState(false);
  return <nav className="guide-navigation" aria-label={t('shell.tools')}>
    {nav.bar.filter(item => !item.pages.includes('more')).map(item => <Link key={item.href} href={item.href} aria-current={item.pages.includes(page) ? 'page' : undefined}><UiIcon name={item.icon} /><span>{item.label}</span></Link>)}
    <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><UiIcon name="grid" /><span>{t('guide.title')}</span></button>
    {open && <GuideDialog title={t('guide.title')} onClose={() => setOpen(false)}><div className="guide-destinations">
      {nav.side.map(item => <Link className="guide-destination" key={item.href} href={item.href} onClick={() => setOpen(false)} aria-current={item.pages.includes(page) ? 'page' : undefined}>
        <UiIcon name={item.icon} /><span>{item.label}</span>
      </Link>)}
      {tools.includes('PROCEDURES') && <Link className="guide-destination" href={paths.history(workspaceId)} onClick={() => setOpen(false)} aria-current={page === 'history' ? 'page' : undefined}><UiIcon name="history" /><span>{t('shell.history')}</span></Link>}
      <Link className="guide-destination" href={paths.more(workspaceId)} onClick={() => setOpen(false)} aria-current={page === 'more' ? 'page' : undefined}><UiIcon name="grid" /><span>{t('shell.more')}</span></Link>
    </div></GuideDialog>}
  </nav>;
}
