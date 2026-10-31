import { useState } from 'react';
import { t } from '../i18n/index.ts';
import { destinations } from '../navigation.ts';
import { usePreferences } from '../preferences.tsx';
import { Link, paths, type Route } from '../router.tsx';
import { UiIcon } from '../ui-icons.tsx';
import { GuideArt, type GuideArtKind } from './GuideArt.tsx';
import { GuideDialog } from './GuideDialog.tsx';

const ART: Partial<Record<Route['page'], GuideArtKind>> = { workspace: 'procedures', procedures: 'procedures', reminders: 'reminders', lists: 'lists', calendar: 'calendar', bring: 'bring', journal: 'journal', documents: 'documents', contacts: 'contacts', maintenance: 'maintenance', equipment: 'equipment' };
export function GuideNavigation({ workspaceId, tools, page }: { workspaceId: string; tools: readonly string[]; page: Route['page'] }) {
  const { preferences } = usePreferences();
  const nav = destinations(workspaceId, tools, preferences.navigationOrder);
  const [open, setOpen] = useState(false);
  return <nav className="guide-navigation" aria-label={t('shell.tools')}>
    {nav.bar.filter(item => !item.pages.includes('more')).map(item => <Link key={item.href} href={item.href} aria-current={item.pages.includes(page) ? 'page' : undefined}><UiIcon name={item.icon} /><span>{item.label}</span></Link>)}
    <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><UiIcon name="grid" /><span>{t('guide.title')}</span></button>
    {open && <GuideDialog title={t('guide.title')} onClose={() => setOpen(false)}><div className="guide-destinations">
      {nav.side.map(item => <Link className="guide-destination" key={item.href} href={item.href} onClick={() => setOpen(false)} aria-current={item.pages.includes(page) ? 'page' : undefined}>
        <GuideArt kind={ART[item.pages[0] ?? 'workspace'] ?? 'procedures'} /><span className="guide-destination-caption"><UiIcon name={item.icon} /><strong>{item.label}</strong><UiIcon name="forward" /></span>
      </Link>)}
      {tools.includes('PROCEDURES') && <Link className="guide-history" href={paths.history(workspaceId)} onClick={() => setOpen(false)}><UiIcon name="history" />{t('shell.history')}</Link>}
      <Link className="guide-history" href={paths.more(workspaceId)} onClick={() => setOpen(false)}>{t('shell.more')}<UiIcon name="forward" /></Link>
    </div></GuideDialog>}
  </nav>;
}
