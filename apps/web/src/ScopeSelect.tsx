import { t } from './i18n/index.ts';
import { HOME_FILTERS, type HomeFilter } from './home-filter.ts';

/** The Today scope (All / Mine / Shared) as a dropdown, styled like the Workspace select. */
export function ScopeSelect({ filter, onChoose }: { filter: HomeFilter; onChoose: (next: HomeFilter) => void }) {
  return (
    <label className="workspace-select scope-select">
      <select aria-label={t('home.filter')} value={filter} onChange={(event) => onChoose(event.target.value as HomeFilter)}>
        {HOME_FILTERS.map((value) => (
          <option key={value} value={value}>
            {t(`home.filter.short.${value}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
