import type { TodayProgress } from './api.ts';
import { formatWhen, t } from './i18n/index.ts';
import { Link, paths } from './router.tsx';
import { UiIcon } from './ui-icons.tsx';

/** Progress (17.2, compact since 19.1; off by default): a few numbers in one row, the counting rules behind Details. */
export function ProgressCard({ progress }: { progress: TodayProgress }) {
  const counts = [
    { label: t('progress.doneToday'), value: progress.completedOccurrencesToday },
    { label: t('progress.thisWeek'), value: progress.completedRunsThisWeek },
    { label: t('progress.active'), value: progress.activeRuns },
  ].filter((item): item is { label: string; value: number } => item.value !== null && item.value > 0);
  if (counts.length === 0) return null;
  return (
    <section className="card today-card" aria-labelledby="today-card-progress" data-card="progress">
      <h3 id="today-card-progress" className="today-card-title">
        <UiIcon name="history" />
        <span>{t('progress.heading')}</span>
      </h3>
      <dl className="progress-counts">
        {counts.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
      <details className="today-details">
        <summary>{t('progress.details')}</summary>
        <p className="muted">{t('progress.boundaries', { from: progress.weekFrom, to: progress.weekTo })}</p>
      </details>
    </section>
  );
}

/** Recently completed (17.2, compact since 19.1): what was finished within the window, newest first. */
export function RecentCard({ workspaceId, items }: { workspaceId: string; items: TodayProgress['recentlyCompleted'] }) {
  if (items.length === 0) return null;
  return (
    <section className="card today-card" aria-labelledby="today-card-recent" data-card="recent">
      <h3 id="today-card-recent" className="today-card-title">
        <UiIcon name="check" />
        <span>{t('progress.recent')}</span>
      </h3>
      <ul className="plain-list today-rows" aria-labelledby="today-card-recent">
        {items.map((item) => (
          <li key={`${item.type}:${item.id}`}>
            <Link href={item.type === 'run' ? paths.run(workspaceId, item.id) : paths.scheduleHistory(workspaceId, item.scheduleId ?? '')} className="today-row">
              <span className="today-row-title">{item.title}</span>
              <small className="muted">
                <time dateTime={item.completedAt}>{formatWhen(item.completedAt)}</time>
              </small>
              <UiIcon name="forward" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
