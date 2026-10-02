import { t } from './i18n/index.ts';
import { Link, paths } from './router.tsx';
import { UiIcon, type UiIconName } from './ui-icons.tsx';

/**
 * The tools that do not fit the phone bottom bar (15.1): Reminders, Calendar, the completed history —
 * and the optional tools the Workspace has switched on (16.2), which never get a bottom-bar place.
 */
export function MorePage({ workspaceId, tools }: { workspaceId: string; tools: readonly string[] }) {
  const links: { href: string; icon: UiIconName; label: string; hint: string }[] = [
    ...(tools.includes('DOCUMENTS') ? [{ href: paths.documents(workspaceId), icon: 'documents' as const, label: t('shell.documents'), hint: t('more.documentsHint') }] : []),
    ...(tools.includes('CONTACTS') ? [{ href: paths.contacts(workspaceId), icon: 'contacts' as const, label: t('shell.contacts'), hint: t('more.contactsHint') }] : []),
    ...(tools.includes('MAINTENANCE') ? [{ href: paths.maintenance(workspaceId), icon: 'maintenance' as const, label: t('shell.maintenance'), hint: t('more.maintenanceHint') }] : []),
    { href: paths.reminders(workspaceId), icon: 'reminders', label: t('shell.reminders'), hint: t('more.remindersHint') },
    { href: paths.calendar(workspaceId), icon: 'calendar', label: t('shell.calendar'), hint: t('more.calendarHint') },
    { href: paths.history(workspaceId), icon: 'history', label: t('shell.history'), hint: t('more.historyHint') },
  ];
  return (
    <section aria-labelledby="more-heading">
      <div className="page-header">
        <h2 id="more-heading">{t('shell.more')}</h2>
      </div>
      <ul className="plain-list">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="card link-card">
              <span className="item-icon">
                <UiIcon name={link.icon} size="1.5em" />
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
  );
}
