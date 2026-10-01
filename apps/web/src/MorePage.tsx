import { t } from './i18n/index.ts';
import { Link, paths } from './router.tsx';
import { UiIcon, type UiIconName } from './ui-icons.tsx';

/** The tools that do not fit the phone bottom bar (15.1): Reminders, Calendar and the completed history. */
export function MorePage({ workspaceId }: { workspaceId: string }) {
  const links: { href: string; icon: UiIconName; label: string; hint: string }[] = [
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
