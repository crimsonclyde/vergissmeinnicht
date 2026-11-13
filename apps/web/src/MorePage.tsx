import { t, type MessageKey } from './i18n/index.ts';
import { navigation } from './navigation.ts';
import { usePreferences } from './preferences.tsx';
import { Link } from './router.tsx';
import { UiIcon } from './ui-icons.tsx';
import './area.css';

/** One muted line per destination, by the page it opens. */
const HINTS: Partial<Record<string, MessageKey>> = {
  procedures: 'tools.proceduresHint',
  reminders: 'more.remindersHint',
  calendar: 'more.calendarHint',
  history: 'more.historyHint',
  lists: 'more.listsHint',
  recipes: 'recipes.hint',
  bring: 'bring.hint',
  equipment: 'tools.equipmentHint',
  maintenance: 'more.maintenanceHint',
  documents: 'more.documentsHint',
  contacts: 'more.contactsHint',
  journal: 'journal.toolHint',
};

/**
 * All tools as a page (section 42): the same families as the desktop menu bar and the phone drawer, in the
 * person's order. The drawer is the usual way in; this page keeps the old /more address working.
 */
export function MorePage({ workspaceId, tools }: { workspaceId: string; tools: readonly string[] }) {
  const { preferences } = usePreferences();
  const nav = navigation(workspaceId, tools, preferences.navigationOrder);
  return (
    <section aria-labelledby="more-heading" className="area">
      <header className="area-head">
        <div className="area-title">
          <p className="area-eyebrow">
            <UiIcon name="grid" /> {t('more.eyebrow')}
          </p>
          <h2 id="more-heading" className="area-heading">
            {t('navigation.allTools')}
          </h2>
        </div>
      </header>
      {nav.groups.map((group) => (
        <section key={group.id} aria-labelledby={`more-${group.id}`}>
          <h3 id={`more-${group.id}`} className="area-group">
            {group.label}
          </h3>
          <ul className="plain-list area-rows">
            {group.items.map((item) => {
              const hint = HINTS[item.pages[0] ?? ''];
              return (
                <li key={item.href}>
                  <Link href={item.href} className="area-row">
                    <span className="area-row-icon">
                      <UiIcon name={item.icon} size="1.35em" />
                    </span>
                    <span className="item-body">
                      <strong>{item.label}</strong>
                      {hint !== undefined && <small className="muted">{t(hint)}</small>}
                    </span>
                    <UiIcon name="chevron" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </section>
  );
}
