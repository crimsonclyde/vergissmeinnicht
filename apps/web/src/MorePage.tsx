import { t, type MessageKey } from './i18n/index.ts';
import { destinations } from './navigation.ts';
import { usePreferences } from './preferences.tsx';
import { Link, paths } from './router.tsx';
import { UiIcon, type UiIconName } from './ui-icons.tsx';
import './area.css';

/**
 * The tools that do not fit the phone bottom bar (15.1): Reminders, Calendar, the completed history —
 * and all enabled tools in the person's saved order, plus completed history.
 */
export function MorePage({ workspaceId, tools }: { workspaceId: string; tools: readonly string[] }) {
  const { preferences } = usePreferences();
  let links: { href: string; icon: UiIconName; label: string; hint: string }[] = [
    ...(tools.includes('BRING') ? [{ href: paths.bring(workspaceId), icon: 'forward' as const, label: t('bring.heading'), hint: t('bring.hint') }] : []),
    ...(tools.includes('JOURNAL') ? [{ href: paths.journal(workspaceId), icon: 'notebook' as const, label: t('journal.heading'), hint: t('journal.toolHint') }] : []),
    ...(tools.includes('DOCUMENTS') ? [{ href: paths.documents(workspaceId), icon: 'documents' as const, label: t('shell.documents'), hint: t('more.documentsHint') }] : []),
    ...(tools.includes('CONTACTS') ? [{ href: paths.contacts(workspaceId), icon: 'contacts' as const, label: t('shell.contacts'), hint: t('more.contactsHint') }] : []),
    ...(tools.includes('EQUIPMENT') ? [{href:paths.equipment(workspaceId),icon:'equipment' as const,label:t('shell.equipment'),hint:t('tools.equipmentHint')}]:[]),
    ...(tools.includes('MAINTENANCE') ? [{ href: paths.maintenance(workspaceId), icon: 'maintenance' as const, label: t('shell.maintenance'), hint: t('more.maintenanceHint') }] : []),
    ...(tools.includes('REMINDERS') ? [{ href: paths.reminders(workspaceId), icon: 'reminders' as const, label: t('shell.reminders'), hint: t('more.remindersHint') }] : []),
    ...(tools.includes('CALENDAR') ? [{ href: paths.calendar(workspaceId), icon: 'calendar' as const, label: t('shell.calendar'), hint: t('more.calendarHint') }] : []),
    ...(tools.includes('PROCEDURES') ? [{ href: paths.history(workspaceId), icon: 'history' as const, label: t('shell.history'), hint: t('more.historyHint') }] : []),
  ];
  if (preferences.navigationOrder !== null) {
    const hints: Record<string, MessageKey> = { bring: 'bring.hint', procedures: 'tools.proceduresHint', lists: 'more.listsHint', reminders: 'more.remindersHint', calendar: 'more.calendarHint', journal: 'journal.toolHint', documents: 'more.documentsHint', contacts: 'more.contactsHint', maintenance: 'more.maintenanceHint', equipment: 'tools.equipmentHint' };
    const history = links.filter(link => link.href === paths.history(workspaceId));
    links = [...destinations(workspaceId, tools, preferences.navigationOrder).side.slice(1).map(item => ({ ...item, hint: t(hints[item.pages[0] ?? ''] ?? 'tools.proceduresHint') })), ...history];
  }
  // One row style (41): a tinted icon tile, the name over one muted line, a chevron. Tools first; the
  // completed history apart, as the one entry that looks back instead of ahead.
  const isHistory = (link: { href: string }) => link.href === paths.history(workspaceId);
  const groups = [
    { id: 'more-tools', label: t('more.groupTools'), links: links.filter((link) => !isHistory(link)) },
    { id: 'more-history', label: t('more.groupHistory'), links: links.filter(isHistory) },
  ].filter((group) => group.links.length > 0);
  return (
    <section aria-labelledby="more-heading" className="area">
      <header className="area-head">
        <div className="area-title">
          <p className="area-eyebrow">
            <UiIcon name="more" /> {t('more.eyebrow')}
          </p>
          <h2 id="more-heading" className="area-heading">
            {t('shell.more')}
          </h2>
        </div>
      </header>
      {groups.map((group) => (
        <section key={group.id} aria-labelledby={group.id}>
          <h3 id={group.id} className="area-group">
            {group.label}
          </h3>
          <ul className="plain-list area-rows">
            {group.links.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="area-row">
                  <span className="area-row-icon">
                    <UiIcon name={link.icon} size="1.35em" />
                  </span>
                  <span className="item-body">
                    <strong>{link.label}</strong>
                    <small className="muted">{link.hint}</small>
                  </span>
                  <UiIcon name="chevron" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
