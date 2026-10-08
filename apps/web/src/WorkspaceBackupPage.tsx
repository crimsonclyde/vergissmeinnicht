import { useCallback, useEffect, useState } from 'react';
import { api, messageFor, type BackupJob } from './api.ts';
import { formatBytes } from './document-model.ts';
import { formatDateTime, t, type MessageKey } from './i18n/index.ts';
import { UiIcon } from './ui-icons.tsx';

/** While a backup is being made the page looks again this often. */
const POLL_MS = 2_000;

const active = (job: BackupJob) => job.state === 'QUEUED' || job.state === 'RUNNING';

/**
 * Workspace settings → Backup (section 18a, Workspace admins): make a backup of the whole Workspace in the
 * background, follow its progress, download it while it is kept (24 hours) or delete it earlier. Restoring
 * is done by a server admin into a new Workspace.
 */
export function WorkspaceBackupPage({ workspaceId }: { workspaceId: string }) {
  const [jobs, setJobs] = useState<readonly BackupJob[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api.workspaceBackups(workspaceId).then(setJobs, (caught: unknown) => setMessage(messageFor(caught)));
  }, [workspaceId]);
  useEffect(load, [load]);
  const running = jobs?.some(active) === true;
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, load]);

  const act = (action: () => Promise<unknown>) => {
    setBusy(true);
    setMessage(null);
    action().then(
      () => {
        setBusy(false);
        load();
      },
      (caught: unknown) => {
        setBusy(false);
        setMessage(messageFor(caught));
        load();
      },
    );
  };

  return (
    <section className="card stack workspace-backup" aria-labelledby="backup-heading">
      <h3 id="backup-heading">{t('backup.heading')}</h3>
      <p className="muted">{t('backup.lead')}</p>
      <ul className="muted backup-facts">
        <li>{t('backup.contains')}</li>
        <li>{t('backup.notContains')}</li>
        <li>{t('backup.restore')}</li>
      </ul>
      <p className="backup-warning">
        <UiIcon name="warning" /> {t('backup.protect')}
      </p>
      {message !== null && <p role="alert">{message}</p>}
      <button type="button" className="primary" disabled={busy || running} onClick={() => act(() => api.createWorkspaceBackup(workspaceId))}>
        {t(running ? 'backup.making' : 'backup.create')}
      </button>
      {jobs === null ? (
        <p>{t('common.loading')}</p>
      ) : jobs.length === 0 ? (
        <p className="muted">{t('backup.none')}</p>
      ) : (
        <ul className="plain-list backup-jobs" aria-label={t('backup.list')}>
          {jobs.map((job) => (
            <li key={job.id} className="backup-job">
              <div>
                <strong>{t(`backup.state.${job.state}` as MessageKey)}</strong> <small className="muted">· {formatDateTime(job.createdAt)}</small>
              </div>
              {active(job) && (
                <>
                  <span className="progress item-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.progressTotal === 0 ? 0 : Math.round((job.progressDone / job.progressTotal) * 100)} aria-label={t('backup.progress')}>
                    <span style={{ width: `${job.progressTotal === 0 ? 2 : Math.round((job.progressDone / job.progressTotal) * 100)}%` }} />
                  </span>
                  <small className="muted">{job.phase === 'archive' ? t('backup.phase.archive', { done: formatBytes(job.progressDone), total: formatBytes(job.progressTotal) }) : t('backup.phase.collect')}</small>
                </>
              )}
              {job.state === 'READY' && job.sizeBytes !== null && (
                <>
                  <small className="muted">{t('backup.ready', { size: formatBytes(job.sizeBytes), until: job.expiresAt === null ? '' : formatDateTime(job.expiresAt) })}</small>
                  <div className="row">
                    <a className="button primary" href={api.workspaceBackupDownloadUrl(workspaceId, job.id)} download>
                      <UiIcon name="download" /> {t('backup.download')}
                    </a>
                    <button type="button" className="quiet" disabled={busy} onClick={() => act(() => api.cancelWorkspaceBackup(workspaceId, job.id))}>
                      {t('backup.deleteNow')}
                    </button>
                  </div>
                </>
              )}
              {active(job) && (
                <button type="button" className="quiet" disabled={busy} onClick={() => act(() => api.cancelWorkspaceBackup(workspaceId, job.id))}>
                  {t('backup.cancel')}
                </button>
              )}
              {job.state === 'FAILED' && <small className="muted">{t(`backup.error.${job.errorCode ?? 'failed'}` as MessageKey)}</small>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
