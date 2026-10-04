import { useEffect, useState } from 'react';
import { api, messageFor, type OccurrenceHistoryEntry, type Schedule } from './api.ts';
import { formatDateTime, t } from './i18n/index.ts';
import { Link, paths } from './router.tsx';

/** Read-only canonical Occurrence history, reachable independently of Calendar or Reminders navigation. */
export function ScheduleHistory({ workspaceId, scheduleId }: { workspaceId: string; scheduleId: string }) {
  const [value, setValue] = useState<{ schedule: Schedule; occurrences: OccurrenceHistoryEntry[] } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void api.scheduleHistory(workspaceId, scheduleId).then((loaded) => { if (current) setValue(loaded); }, (caught: unknown) => { if (current) setMessage(messageFor(caught)); });
    return () => { current = false; };
  }, [workspaceId, scheduleId]);
  return <section className="stack"><Link href={paths.home(workspaceId)}>{t('shell.today')}</Link>
    {message !== null && <p role="alert">{message}</p>}
    {value === null ? message === null && <p>{t('common.loading')}</p> : <><h2>{value.schedule.title}</h2><h3>{t('progress.occurrenceHistory')}</h3><ul className="plain-list">{value.occurrences.map((item) => <li key={item.id} className="card stack"><strong>{item.dueDate}</strong><span>{t(`occurrenceStatus.${item.state}`)}</span>{item.closed !== null && <span>{formatDateTime(item.closed.at)} · {item.closed.by}</span>}{item.run !== null && <Link href={paths.run(workspaceId, item.run.id)}>{t('shell.history')}</Link>}</li>)}</ul></>}
  </section>;
}
