import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { api, messageFor, type HistoricalIdentity, type RestoreJob } from './api.ts';
import { formatBytes } from './document-model.ts';
import { FormDialog } from './FormDialog.tsx';
import { formatDateTime, t, type MessageKey } from './i18n/index.ts';
import { Link, paths } from './router.tsx';
import { UiIcon } from './ui-icons.tsx';

/** While a restore is checked or restored the page looks again this often. */
const POLL_MS = 2_000;

/** The record types shown in the preview, in this order (the package has more; these are what people recognise). */
export const PREVIEW_COUNTS = [
  'procedures',
  'runs',
  'schedules',
  'occurrences',
  'lists',
  'list_items',
  'document_folders',
  'documents',
  'document_files',
  'step_images',
  'contacts',
  'maintenance_records',
  'equipment_records',
  'links',
  'audit_events',
] as const;

const working = (job: RestoreJob) => job.state === 'QUEUED' || job.state === 'RUNNING';
const waiting = (job: RestoreJob) => job.state === 'READY' && job.phase === 'validated';
const restored = (job: RestoreJob) => job.state === 'READY' && job.phase === 'restored';
const restoring = (job: RestoreJob) => working(job) && job.phase?.startsWith('restore') === true;

/** What a job is doing, for the status line (announced to screen readers). */
export function restoreStatus(job: RestoreJob): string {
  if (job.state === 'FAILED') return t(`restore.error.${job.errorCode ?? 'failed'}` as MessageKey);
  if (job.state === 'CANCELLED') return t('restore.state.cancelled');
  if (job.state === 'EXPIRED') return t('restore.state.expired');
  if (restored(job)) return t('restore.state.restored');
  if (waiting(job)) return t('restore.state.validated');
  if (restoring(job)) return t('restore.state.restoring');
  if (job.phase === 'upload') return t('restore.state.uploading');
  return t('restore.state.validating');
}

/** Progress of a running step, as a percentage — or null when the step has no measure. */
function percent(job: RestoreJob): number | null {
  return job.progressTotal > 0 ? Math.min(100, Math.round((job.progressDone / job.progressTotal) * 100)) : null;
}

function Progress({ value, label, text }: { value: number | null; label: string; text: string }) {
  return (
    <div className="stack restore-progress">
      <span className="progress item-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined} aria-valuetext={text}>
        <span style={{ width: `${value ?? 2}%` }} />
      </span>
      <small className="muted">{text}</small>
    </div>
  );
}

/**
 * Server admin → Workspaces → Restore from backup (section 18c). Upload a `.vmnbackup`, follow the check, read
 * what it contains, confirm — and the server creates a **new** Workspace. Nothing is overwritten, nobody is
 * invited, nothing is sent. Every rule is enforced by the server; this page only shows and asks.
 */
export function RestoreFromBackup({ onRestored }: { onRestored: () => void }) {
  const fileId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [limit, setLimit] = useState<number | null>(null);
  const [upload, setUpload] = useState<{ loaded: number; total: number } | null>(null);
  const [job, setJob] = useState<RestoreJob | null>(null);
  const [recent, setRecent] = useState<readonly RestoreJob[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const announcedRestore = useRef<string | null>(null);

  const loadRecent = useCallback(() => {
    api.workspaceRestores().then(setRecent, () => undefined);
  }, []);
  useEffect(() => {
    loadRecent();
    api.instanceSettings().then(
      (settings) => setLimit(settings.workspaceRestoreMaxBytes),
      () => undefined,
    );
    return () => abort.current?.abort();
  }, [loadRecent]);

  // Follow the job while the server works on it.
  const jobId = job?.id;
  const following = job !== null && working(job);
  useEffect(() => {
    if (jobId === undefined || !following) return;
    const timer = window.setInterval(() => {
      api.workspaceRestore(jobId).then(setJob, (caught: unknown) => setMessage(messageFor(caught)));
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [jobId, following]);

  // A result (preview, success, failure) gets the focus once, so keyboard and screen-reader users land on it.
  const phase = job === null ? null : `${job.id}:${job.state}:${job.phase ?? ''}`;
  useEffect(() => {
    if (job === null || working(job)) return;
    resultHeading.current?.focus();
    if (restored(job) && announcedRestore.current !== job.id) {
      announcedRestore.current = job.id;
      loadRecent();
      onRestored();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the phase changes
  }, [phase]);

  async function start(event: FormEvent) {
    event.preventDefault();
    if (file === null) return;
    setMessage(null);
    setJob(null);
    const controller = new AbortController();
    abort.current = controller;
    setUpload({ loaded: 0, total: file.size });
    try {
      const created = await api.uploadWorkspaceRestore(file, { signal: controller.signal, onProgress: (loaded, total) => setUpload({ loaded, total }) });
      setJob(created);
      loadRecent();
    } catch (caught) {
      setMessage(caught instanceof DOMException && caught.name === 'AbortError' ? t('restore.uploadCancelled') : messageFor(caught));
      loadRecent();
    } finally {
      setUpload(null);
      abort.current = null;
    }
  }

  const act = async (action: () => Promise<RestoreJob>) => {
    setBusy(true);
    setMessage(null);
    try {
      setJob(await action());
      loadRecent();
    } catch (caught) {
      setMessage(messageFor(caught));
    } finally {
      setBusy(false);
    }
  };

  const preview = job?.preview ?? null;
  const open = recent.filter((each) => each.id !== job?.id && (working(each) || waiting(each)));

  return (
    <section className="card stack workspace-restore" aria-labelledby="restore-heading">
      <h3 id="restore-heading" style={{ marginTop: 0 }}>
        {t('restore.heading')}
      </h3>
      <p className="muted">{t('restore.lead')}</p>
      <ul className="muted backup-facts">
        <li>{t('restore.newOnly')}</li>
        <li>{t('restore.people')}</li>
        <li>{t('restore.schedules')}</li>
        <li>{t('restore.notIncluded')}</li>
      </ul>
      <p className="backup-warning">
        <UiIcon name="warning" /> {t('restore.untrusted')}
      </p>

      {upload === null && (job === null || !working(job)) && (
        <form className="stack" onSubmit={(event) => void start(event)}>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor={fileId}>{t('restore.file')}</label>
            <input id={fileId} type="file" accept=".vmnbackup,application/zip" aria-describedby={`${fileId}-hint`} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            <small id={`${fileId}-hint`} className="muted">
              {limit === null ? t('restore.fileHint') : t('restore.fileHintLimit', { size: formatBytes(limit) })}
            </small>
          </div>
          <div>
            <button type="submit" className="primary" disabled={file === null}>
              <UiIcon name="upload" /> {t('restore.upload')}
            </button>
          </div>
        </form>
      )}

      {upload !== null && (
        <div className="stack">
          <Progress value={upload.total > 0 ? Math.round((upload.loaded / upload.total) * 100) : null} label={t('restore.uploadProgress')} text={t('restore.uploaded', { done: formatBytes(upload.loaded), total: formatBytes(upload.total) })} />
          <div>
            <button type="button" onClick={() => abort.current?.abort()}>
              {t('restore.cancelUpload')}
            </button>
          </div>
        </div>
      )}

      {message !== null && <p role="alert">{message}</p>}
      <p role="status" className="visually-hidden">
        {upload !== null ? t('restore.state.uploading') : job === null ? '' : restoreStatus(job)}
      </p>

      {job !== null && working(job) && (
        <div className="stack">
          <p style={{ margin: 0 }}>
            <strong>{restoreStatus(job)}</strong>
          </p>
          <Progress
            value={percent(job)}
            label={t(restoring(job) ? 'restore.restoreProgress' : 'restore.checkProgress')}
            text={job.phase?.endsWith('-extract') === true ? t('restore.phase.extract', { done: formatBytes(job.progressDone), total: formatBytes(job.progressTotal) }) : job.phase?.endsWith('-inspect') === true || job.phase?.endsWith('-files') === true ? t('restore.phase.files', { done: job.progressDone, total: job.progressTotal }) : t(restoring(job) ? 'restore.phase.records' : 'restore.phase.check')}
          />
          {!restoring(job) && (
            <div>
              <button type="button" className="quiet" disabled={busy} onClick={() => void act(() => api.cancelWorkspaceRestore(job.id))}>
                {t('restore.discard')}
              </button>
            </div>
          )}
        </div>
      )}

      {job !== null && !working(job) && !waiting(job) && !restored(job) && (
        <div className="stack">
          <h4 ref={resultHeading} tabIndex={-1} style={{ margin: 0 }}>
            {restoreStatus(job)}
          </h4>
        </div>
      )}

      {job !== null && restored(job) && job.workspaceId !== null && (
        <div className="stack restore-done">
          <h4 ref={resultHeading} tabIndex={-1} style={{ margin: 0 }}>
            <UiIcon name="check" /> {t('restore.done', { name: preview?.workspaceName ?? '' })}
          </h4>
          <p style={{ margin: 0 }}>{t('restore.doneNext')}</p>
          <div className="row">
            <Link className="button primary" href={paths.home(job.workspaceId)}>
              {t('restore.open', { name: preview?.workspaceName ?? '' })}
            </Link>
            <Link className="button" href={paths.members(job.workspaceId)}>
              {t('restore.openMembers')}
            </Link>
          </div>
        </div>
      )}

      {job !== null && preview !== null && (waiting(job) || restored(job)) && (
        <div className="stack restore-preview">
          {waiting(job) && (
            <h4 ref={resultHeading} tabIndex={-1} style={{ margin: 0 }}>
              {t('restore.previewHeading')}
            </h4>
          )}
          <dl className="restore-facts">
            <dt>{t('restore.fact.name')}</dt>
            <dd>{preview.workspaceName}</dd>
            <dt>{t('restore.fact.created')}</dt>
            <dd>{formatDateTime(preview.createdAt)}</dd>
            <dt>{t('restore.fact.version')}</dt>
            <dd>{t('restore.compatible', { version: preview.sourceAppVersion })}</dd>
            <dt>{t('restore.fact.size')}</dt>
            <dd>{t('restore.size', { package: formatBytes(preview.packageBytes), content: formatBytes(preview.contentBytes) })}</dd>
            <dt>{t('restore.fact.storage')}</dt>
            <dd>{t('restore.storage', { used: formatBytes(preview.storage.used), limit: formatBytes(preview.storage.limit) })}</dd>
          </dl>

          <h5 style={{ margin: 0 }}>{t('restore.countsHeading')}</h5>
          <ul className="restore-counts">
            {PREVIEW_COUNTS.filter((name) => (preview.counts[name] ?? 0) > 0).map((name) => (
              <li key={name}>
                <strong>{preview.counts[name]}</strong> {t(`restore.count.${name}` as MessageKey)}
              </li>
            ))}
          </ul>

          <h5 style={{ margin: 0 }}>{t('restore.attention')}</h5>
          <ul className="backup-facts">
            <li>{t('restore.warn.identities', { count: preview.persons })}</li>
            {preview.schedulesPaused > 0 && <li>{t('restore.warn.paused', { count: preview.schedulesPaused })}</li>}
            {preview.assignmentsCleared > 0 && <li>{t('restore.warn.assignments', { count: preview.assignmentsCleared })}</li>}
            <li>{t('restore.warn.personal')}</li>
            {preview.warnings.map((warning) => (
              <li key={warning}>{t(`restore.warning.${warning}` as MessageKey)}</li>
            ))}
          </ul>

          <h5 style={{ margin: 0 }}>{t('restore.membersHeading')}</h5>
          <p className="muted" style={{ margin: 0 }}>
            {t('restore.membersHint')}
          </p>
          <ul className="plain-list restore-members">
            {preview.previousMembers.map((member, index) => (
              <li key={`${member.email ?? ''}-${index}`}>
                <strong>{member.displayName}</strong> <span className="muted">· {t(`role.${member.role}` as MessageKey)}</span>
                {member.email !== null && <span className="restore-email">{member.email}</span>}
              </li>
            ))}
          </ul>

          {waiting(job) && (
            <div className="row">
              <button type="button" className="primary" disabled={busy} onClick={() => setConfirming(true)}>
                {t('restore.confirm')}
              </button>
              <button type="button" className="quiet" disabled={busy} onClick={() => void act(() => api.cancelWorkspaceRestore(job.id))}>
                {t('restore.discard')}
              </button>
            </div>
          )}
          {waiting(job) && job.expiresAt !== null && <small className="muted">{t('restore.until', { until: formatDateTime(job.expiresAt) })}</small>}
        </div>
      )}

      {confirming && job !== null && preview !== null && (
        <FormDialog
          title={t('restore.confirmTitle', { name: preview.workspaceName })}
          submitLabel={t('restore.confirmSubmit')}
          onClose={() => setConfirming(false)}
          onSubmit={async () => {
            setJob(await api.confirmWorkspaceRestore(job.id));
            loadRecent();
          }}
        >
          <p style={{ margin: 0 }}>{t('restore.confirmText')}</p>
        </FormDialog>
      )}

      {open.length > 0 && (
        <div className="stack">
          <h4 style={{ margin: 0 }}>{t('restore.openHeading')}</h4>
          <ul className="plain-list backup-jobs">
            {open.map((each) => (
              <li key={each.id}>
                <span>
                  {each.preview?.workspaceName ?? t('restore.unnamed')} <small className="muted">· {formatDateTime(each.createdAt)} · {restoreStatus(each)}</small>
                </span>
                <div>
                  <button type="button" onClick={() => setJob(each)}>
                    {t('restore.show')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/**
 * Server admin → Accounts → Historical identities (section 18c): people from restored history — a name and where
 * it came from. They are no accounts: no sign-in, no invitation, no recovery, no activation. Read only.
 */
export function HistoricalIdentities() {
  const [data, setData] = useState<{ total: number; identities: readonly HistoricalIdentity[] } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    api.historicalIdentities().then(setData, (caught: unknown) => setMessage(messageFor(caught)));
  }, []);
  return (
    <section className="card stack" aria-labelledby="historical-heading">
      <h3 id="historical-heading" style={{ marginTop: 0 }}>
        {t('historical.heading')}
      </h3>
      <p className="muted" style={{ margin: 0 }}>
        {t('historical.lead')}
      </p>
      {message !== null && <p role="alert">{message}</p>}
      {data === null ? (
        message === null && <p>{t('common.loading')}</p>
      ) : data.total === 0 ? (
        <p className="muted">{t('historical.none')}</p>
      ) : (
        <>
          <ul className="plain-list historical-list" aria-label={t('historical.heading')}>
            {data.identities.map((identity) => (
              <li key={identity.id}>
                <strong>{identity.displayName}</strong> <span className="badge">{t('historical.badge')}</span>
                <small className="muted">{identity.origin === null ? t('historical.unknownOrigin') : t('historical.origin', { workspace: identity.origin.workspaceName, date: formatDateTime(identity.origin.restoredAt) })}</small>
              </li>
            ))}
          </ul>
          {data.total > data.identities.length && <small className="muted">{t('historical.more', { shown: data.identities.length, total: data.total })}</small>}
        </>
      )}
    </section>
  );
}

const GB = 1_000_000_000;

/**
 * Server admin → Server & storage (18c): the largest backup a restore accepts (D4: 20 GB by default; 0.1 to
 * 1000 GB, checked again by the server and the database). Applies to uploads that start after the change.
 */
export function RestoreLimitSettings() {
  const id = useId();
  const [gb, setGb] = useState('');
  const [saved, setSaved] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    api.instanceSettings().then(
      (settings) => {
        setSaved(settings.workspaceRestoreMaxBytes);
        setGb(String(settings.workspaceRestoreMaxBytes / GB));
      },
      (caught: unknown) => setMessage(messageFor(caught)),
    );
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    setStatus(null);
    try {
      const settings = await api.updateInstanceSettings({ workspaceRestoreMaxBytes: Math.round(Number(gb) * 10) * (GB / 10) });
      setSaved(settings.workspaceRestoreMaxBytes);
      setGb(String(settings.workspaceRestoreMaxBytes / GB));
      setStatus(t('admin.restoreLimit.saved', { size: formatBytes(settings.workspaceRestoreMaxBytes) }));
    } catch (caught) {
      setMessage(messageFor(caught));
    }
  }
  return (
    <section className="card stack" aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`} style={{ marginTop: 0 }}>
        {t('admin.restoreLimit.heading')}
      </h3>
      <p className="muted" style={{ margin: 0 }}>
        {t('admin.restoreLimit.intro')}
      </p>
      <form className="row" onSubmit={(event) => void save(event)}>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor={`${id}-gb`}>{t('admin.restoreLimit.label')}</label>
          <input id={`${id}-gb`} type="number" inputMode="decimal" min={0.1} max={1000} step={0.1} required disabled={saved === null} value={gb} onChange={(event) => setGb(event.target.value)} style={{ width: '8rem' }} />
        </div>
        <button type="submit" disabled={saved === null || gb === String(saved / GB)} style={{ alignSelf: 'flex-end' }}>
          {t('admin.restoreLimit.save')}
        </button>
      </form>
      {message !== null && <p role="alert">{message}</p>}
      <p role="status" style={{ margin: 0 }}>
        {status ?? ''}
      </p>
    </section>
  );
}
