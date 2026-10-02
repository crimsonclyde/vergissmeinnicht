import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { api, messageFor, type DocumentFileFormat, type StorageInfo, type WorkspaceStorage } from './api.ts';
import { formatBytes } from './document-model.ts';
import { t } from './i18n/index.ts';
import { STORAGE_GB_RANGE, bytesToGigabytes, gigabytesToBytes, storageLines, storageSummary } from './storage-model.ts';

/** How full, in words and as a meter, then what uses it — by tool. Trash is always named: it counts. */
function StorageUsage(props: { storage: StorageInfo; label: string }) {
  const summary = storageSummary(props.storage);
  return (
    <>
      <p style={{ margin: 0 }}>
        <strong>{summary.text}</strong>
        {summary.full && ` ${t('storage.full')}`}
      </p>
      <progress className="storage-meter" max={100} value={summary.percent} aria-label={props.label} />
      <dl className="storage-lines">
        {storageLines(props.storage).map((line) => (
          <div key={line.key}>
            <dt>{line.label}</dt>
            <dd>{line.value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

/**
 * Workspace settings → General, for Workspace admins (16.4): what the Workspace stores, by tool, and
 * its own limit — at or below what the server admin allows, never above. Lowering it deletes nothing.
 */
export function WorkspaceStorageCard(props: { workspaceId: string }) {
  const { workspaceId } = props;
  const id = useId();
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [limit, setLimit] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const show = useCallback((loaded: StorageInfo) => {
    setStorage(loaded);
    setLimit(loaded.ownLimitBytes === null ? '' : bytesToGigabytes(loaded.ownLimitBytes));
  }, []);
  useEffect(() => {
    api.workspaceStorage(workspaceId).then(show, (caught: unknown) => setMessage(messageFor(caught)));
  }, [workspaceId, show]);

  async function save(bytes: number | null) {
    setBusy(true);
    setMessage(null);
    setStatus(null);
    try {
      const saved = await api.setWorkspaceStorageLimit(workspaceId, bytes);
      show(saved);
      setStatus(bytes === null ? t('storage.limitRemoved', { limit: formatBytes(saved.limitBytes) }) : t('storage.limitSaved', { limit: formatBytes(saved.limitBytes) }));
    } catch (caught) {
      setMessage(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const bytes = gigabytesToBytes(limit);
    if (bytes === null) setMessage(t('error.invalid_storage_limit'));
    else void save(bytes);
  }

  return (
    <div className="card stack">
      <h3 style={{ marginTop: 0 }}>{t('storage.heading')}</h3>
      {storage === null ? (
        message === null && <p>{t('common.loading')}</p>
      ) : (
        <>
          <StorageUsage storage={storage} label={t('storage.meter')} />
          <p className="muted" style={{ margin: 0 }}>
            {t('storage.explain', { ceiling: formatBytes(storage.ceilingBytes) })}
          </p>
          <form className="row storage-form" onSubmit={submit}>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor={`${id}-limit`}>{t('storage.ownLimit')}</label>
              <input
                id={`${id}-limit`}
                type="number"
                inputMode="decimal"
                min={STORAGE_GB_RANGE.min}
                max={Number(bytesToGigabytes(storage.ceilingBytes))}
                step={STORAGE_GB_RANGE.step}
                required
                value={limit}
                placeholder={bytesToGigabytes(storage.ceilingBytes)}
                aria-describedby={`${id}-hint`}
                onChange={(event) => setLimit(event.target.value)}
                style={{ width: '8rem' }}
              />
            </div>
            <button type="submit" disabled={busy}>
              {t('storage.saveLimit')}
            </button>
            {storage.ownLimitBytes !== null && (
              <button type="button" className="quiet" disabled={busy} onClick={() => void save(null)}>
                {t('storage.removeLimit')}
              </button>
            )}
          </form>
          <p id={`${id}-hint`} className="muted" style={{ margin: 0 }}>
            {t('storage.ownLimitHint')}
          </p>
        </>
      )}
      {message !== null && <p role="alert">{message}</p>}
      <p role="status" style={{ margin: 0 }}>
        {status ?? ''}
      </p>
    </div>
  );
}

/** One Workspace in the server admin's list: its usage by tool and the ceiling the admin sets. */
function CeilingRow(props: { workspace: WorkspaceStorage; onSaved: (name: string, bytes: number) => void; onFailed: (message: string) => void }) {
  const { workspace } = props;
  const id = useId();
  const [ceiling, setCeiling] = useState(bytesToGigabytes(workspace.ceilingBytes));
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const bytes = gigabytesToBytes(ceiling);
    if (bytes === null) return props.onFailed(t('error.invalid_storage_ceiling'));
    setBusy(true);
    try {
      await api.setStorageCeiling(workspace.id, bytes);
      props.onSaved(workspace.name, bytes);
    } catch (caught) {
      props.onFailed(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="stack storage-workspace">
      <h4 style={{ margin: 0 }}>{workspace.name}</h4>
      <StorageUsage storage={workspace} label={t('admin.storage.meter', { name: workspace.name })} />
      {workspace.ownLimitBytes !== null && (
        <p className="muted" style={{ margin: 0 }}>
          {t('admin.storage.ownLimit', { limit: formatBytes(workspace.ownLimitBytes) })}
        </p>
      )}
      <form className="row storage-form" onSubmit={(event) => void submit(event)}>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor={`${id}-ceiling`}>{t('admin.storage.ceiling', { name: workspace.name })}</label>
          <input
            id={`${id}-ceiling`}
            type="number"
            inputMode="decimal"
            min={STORAGE_GB_RANGE.min}
            max={STORAGE_GB_RANGE.max}
            step={STORAGE_GB_RANGE.step}
            required
            value={ceiling}
            onChange={(event) => setCeiling(event.target.value)}
            style={{ width: '8rem' }}
          />
        </div>
        <button type="submit" disabled={busy}>
          {t('storage.saveLimit')}
        </button>
      </form>
    </li>
  );
}

/**
 * Server admin → Server & storage (16.4): every Workspace with what it stores and the ceiling. A
 * ceiling is a usage limit — nothing is reserved on the disk — and lowering it deletes nothing.
 */
export function AdminStorage() {
  const [storage, setStorage] = useState<WorkspaceStorage[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const load = useCallback(() => {
    api.adminStorage().then(setStorage, (caught: unknown) => setMessage(messageFor(caught)));
  }, []);
  useEffect(load, [load]);
  return (
    <section className="card stack" aria-labelledby="storage-heading">
      <h3 id="storage-heading" style={{ marginTop: 0 }}>
        {t('admin.storage.heading')}
      </h3>
      <p className="muted" style={{ margin: 0 }}>
        {t('admin.storage.intro')}
      </p>
      {message !== null && <p role="alert">{message}</p>}
      <p role="status" style={{ margin: 0 }}>
        {status ?? ''}
      </p>
      <ul className="plain-list stack">
        {storage?.map((workspace) => (
          <CeilingRow
            key={`${workspace.id}:${workspace.ceilingBytes}`}
            workspace={workspace}
            onSaved={(name, bytes) => {
              setMessage(null);
              setStatus(t('admin.storage.saved', { name, limit: formatBytes(bytes) }));
              load();
            }}
            onFailed={(text) => {
              setStatus(null);
              setMessage(text);
            }}
          />
        ))}
      </ul>
    </section>
  );
}

const FORMATS: readonly DocumentFileFormat[] = ['PDF', 'JPEG', 'PNG', 'HEIC'];
const MB = 1_000_000;

/**
 * Server admin → Server & storage (16.4): the largest file a Document may hold and the accepted
 * formats. Both apply to new uploads only — what is stored stays readable.
 */
export function DocumentFileSettings() {
  const id = useId();
  const [maxMb, setMaxMb] = useState('');
  const [formats, setFormats] = useState<readonly DocumentFileFormat[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.instanceSettings().then(
      (settings) => {
        setMaxMb(String(settings.documentMaxFileBytes / MB));
        setFormats(settings.documentFormats);
      },
      (caught: unknown) => setMessage(messageFor(caught)),
    );
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (formats === null) return;
    setBusy(true);
    setMessage(null);
    setStatus(null);
    try {
      const saved = await api.updateInstanceSettings({ documentMaxFileBytes: Math.round(Number(maxMb)) * MB, documentFormats: formats });
      setMaxMb(String(saved.documentMaxFileBytes / MB));
      setFormats(saved.documentFormats);
      setStatus(t('admin.files.saved', { size: formatBytes(saved.documentMaxFileBytes), formats: saved.documentFormats.join(', ') }));
    } catch (caught) {
      setMessage(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card stack" aria-labelledby="document-files-heading">
      <h3 id="document-files-heading" style={{ marginTop: 0 }}>
        {t('admin.files.heading')}
      </h3>
      <p className="muted" style={{ margin: 0 }}>
        {t('admin.files.intro')}
      </p>
      <form className="stack" onSubmit={(event) => void save(event)}>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor={`${id}-size`}>{t('admin.files.maxSize')}</label>
          <input id={`${id}-size`} type="number" inputMode="numeric" min={1} max={100} step={1} required disabled={formats === null} value={maxMb} onChange={(event) => setMaxMb(event.target.value)} style={{ width: '8rem' }} />
        </div>
        <fieldset className="plain-fieldset">
          <legend>{t('admin.files.formats')}</legend>
          <div className="row">
            {FORMATS.map((format) => (
              <label key={format} className="option-label">
                <input
                  type="checkbox"
                  disabled={formats === null}
                  checked={formats?.includes(format) === true}
                  onChange={(event) => setFormats(FORMATS.filter((each) => (each === format ? event.target.checked : formats?.includes(each) === true)))}
                />
                {format}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <button type="submit" disabled={busy || formats === null || formats.length === 0}>
            {t('admin.files.save')}
          </button>
        </div>
      </form>
      {message !== null && <p role="alert">{message}</p>}
      <p role="status" style={{ margin: 0 }}>
        {status ?? ''}
      </p>
    </section>
  );
}
