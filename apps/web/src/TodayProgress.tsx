import type { TodayProgress } from './api.ts';
import { formatDateTime, t } from './i18n/index.ts';
import { Link, paths } from './router.tsx';

export function TodayProgressCard({ progress }: { progress: TodayProgress }) {
  const counts = [
    { label: t('progress.occurrencesToday'), value: progress.completedOccurrencesToday },
    { label: t('progress.runsWeek'), value: progress.completedRunsThisWeek },
    { label: t('progress.active'), value: progress.activeRuns },
    { label: t('progress.due'), value: progress.dueToday },
  ].filter((item) => item.value !== null);
  if (counts.length === 0) return null;
  return <section className="card progress-card stack" aria-labelledby="progress-heading">
    <h3 id="progress-heading">{t('progress.heading')}</h3>
    <p className="muted">{t(`home.filter.${progress.filter}`)} · {t('progress.boundaries', { from: progress.weekFrom, to: progress.weekTo })}</p>
    <dl className="progress-counts">{counts.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>

  </section>;
}

export function RecentCompletions({ workspaceId, progress }: { workspaceId: string; progress: TodayProgress }) {
  if (progress.recentlyCompleted.length === 0) return null;
  return <section className="card progress-card stack" aria-labelledby="recent-progress-heading">
    <h3 id="recent-progress-heading">{t('progress.recent')}</h3>
    <ul className="plain-list">{progress.recentlyCompleted.slice(0, 3).map((item) => <li key={`${item.type}:${item.id}`} className="progress-item">
      <Link href={item.type === 'run' ? paths.run(workspaceId, item.id) : paths.scheduleHistory(workspaceId, item.scheduleId ?? '')}>{item.title}</Link>
      <time className="muted" dateTime={item.completedAt}>{formatDateTime(item.completedAt)}</time>
    </li>)}</ul>
  </section>;
}
