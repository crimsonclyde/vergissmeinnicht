import { useEffect, useId, useRef, useState } from 'react';
import { ApiError, api, isNetworkError, messageFor, type DocumentFile, type DocumentFolder, type DocumentTypeView, type DocumentTypes } from './api.ts';
import { ACCEPTED_FILES, folderTree, formatBytes, moved, typeOptions, withDocumentDate, type DocumentForm } from './document-model.ts';
import { hasMessage, t } from './i18n/index.ts';
import { UiIcon } from './ui-icons.tsx';

/** Why an upload or a change was refused, in words: the server's reason for a refused file, else its error message. */
export function failureText(caught: unknown): string {
  if (isNetworkError(caught)) return t('documents.offline');
  if (caught instanceof ApiError && caught.code === 'file_rejected') {
    const key = `documents.rejected.${String(caught.details.reason)}`;
    if (hasMessage(key)) return t(key);
  }
  if (caught instanceof ApiError && caught.code === 'storage_full' && typeof caught.details.usedBytes === 'number' && typeof caught.details.limitBytes === 'number') {
    return t('error.storage_full_detail', { used: formatBytes(caught.details.usedBytes), limit: formatBytes(caught.details.limitBytes) });
  }
  return messageFor(caught);
}

/** A choice of Folder: every Folder in tree order, indented, plus the top level. `exclude` leaves some out (a Folder cannot go into itself). */
export function FolderSelect(props: { folders: readonly DocumentFolder[]; value: string | null; onChange: (folderId: string | null) => void; label: string; only?: readonly string[] }) {
  const id = useId();
  const entries = folderTree(props.folders).filter((entry) => props.only === undefined || props.only.includes(entry.folder.id));
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <select id={id} value={props.value ?? ''} onChange={(event) => props.onChange(event.target.value === '' ? null : event.target.value)}>
        <option value="">{t('documents.topLevel')}</option>
        {entries.map(({ folder, depth }) => (
          <option key={folder.id} value={folder.id}>
            {`${'  '.repeat(depth)}${folder.name}`}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * The fields of a Document. Only the title is required; type, dates, notes and tags sit behind "More
 * details" when `folded` (creating), so adding a Document stays light.
 */
export function DocumentFormFields(props: { form: DocumentForm; onChange: (form: DocumentForm) => void; types: DocumentTypes | null; currentType: DocumentTypeView | null; folded: boolean }) {
  const id = useId();
  const { form } = props;
  const [yearTouched, setYearTouched] = useState(form.year !== '');
  const details = (
    <div className="stack">
      <div className="field">
        <label htmlFor={`${id}-type`}>{t('documents.field.type')}</label>
        <select id={`${id}-type`} value={form.type} onChange={(event) => props.onChange({ ...form, type: event.target.value })}>
          <option value="">{t('documents.type.none')}</option>
          {(props.types === null ? [] : typeOptions(props.types, props.currentType)).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="document-dates">
        <div className="field">
          <label htmlFor={`${id}-date`}>{t('documents.field.documentDate')}</label>
          <input id={`${id}-date`} type="date" min="1900-01-01" max="2200-12-31" value={form.documentDate} aria-describedby={`${id}-date-hint`} onChange={(event) => props.onChange(withDocumentDate(form, event.target.value, yearTouched))} />
          <small id={`${id}-date-hint`} className="muted">
            {t('documents.field.documentDateHint')}
          </small>
        </div>
        <div className="field">
          <label htmlFor={`${id}-year`}>{t('documents.field.year')}</label>
          <input
            id={`${id}-year`}
            inputMode="numeric"
            maxLength={4}
            value={form.year}
            aria-describedby={`${id}-year-hint`}
            onChange={(event) => {
              setYearTouched(true);
              props.onChange({ ...form, year: event.target.value.replace(/\D/g, '') });
            }}
          />
          <small id={`${id}-year-hint`} className="muted">
            {t('documents.field.yearHint')}
          </small>
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${id}-tags`}>{t('documents.field.tags')}</label>
        <input id={`${id}-tags`} value={form.tags} maxLength={400} placeholder={t('documents.field.tagsPlaceholder')} autoCapitalize="none" onChange={(event) => props.onChange({ ...form, tags: event.target.value })} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-notes`}>{t('documents.field.notes')}</label>
        <textarea id={`${id}-notes`} rows={4} maxLength={4000} value={form.notes} onChange={(event) => props.onChange({ ...form, notes: event.target.value })} />
      </div>
    </div>
  );
  return (
    <>
      <div className="field">
        <label htmlFor={`${id}-title`}>{t('documents.field.title')}</label>
        <input id={`${id}-title`} required maxLength={200} value={form.title} onChange={(event) => props.onChange({ ...form, title: event.target.value })} />
      </div>
      {props.folded ? (
        <details className="more-details">
          <summary>{t('documents.moreDetails')}</summary>
          {details}
        </details>
      ) : (
        details
      )}
    </>
  );
}

/** One file being added: waiting, on its way, stored on the server (provisionally), or refused. */
export interface UploadItem {
  readonly key: string;
  readonly file: File;
  readonly status: 'waiting' | 'uploading' | 'done' | 'failed';
  readonly progress: number;
  readonly error: string | null;
  readonly uploaded: DocumentFile | null;
}

/** At most this many files are sent at once (the server allows three per person). */
const PARALLEL_UPLOADS = 2;
let nextKey = 0;

/**
 * Uploads chosen files one after the other, each by itself: one failing does not affect the others,
 * and `retry` sends only that one again. The files are provisional on the server until the caller
 * makes them part of a Document; nothing here claims they are saved.
 */
export function useUploads(workspaceId: string) {
  const [items, setItems] = useState<readonly UploadItem[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  const patch = (key: string, change: Partial<UploadItem>) => setItems((current) => current.map((item) => (item.key === key ? { ...item, ...change } : item)));

  // Starts waiting files while a slot is free. What is running is tracked beside the state (a file shows
  // as "uploading" with its first progress report), so this effect only talks to the network.
  const running = useRef(new Set<string>());
  useEffect(() => {
    for (const item of items) {
      if (item.status !== 'waiting' || running.current.has(item.key) || running.current.size >= PARALLEL_UPLOADS) continue;
      const controller = new AbortController();
      controllers.current.set(item.key, controller);
      running.current.add(item.key);
      const finish = (change: Partial<UploadItem>) => {
        running.current.delete(item.key);
        patch(item.key, change);
      };
      api.uploadDocumentFile(workspaceId, item.file, item.file.name, { signal: controller.signal, onProgress: (progress) => patch(item.key, { status: 'uploading', progress }) }).then(
        (uploaded) => finish({ status: 'done', progress: 1, uploaded }),
        (caught: unknown) => {
          if (caught instanceof DOMException && caught.name === 'AbortError') return void running.current.delete(item.key);
          finish({ status: 'failed', error: failureText(caught) });
        },
      );
    }
  }, [items, workspaceId]);

  // Leaving the page stops what is still being sent.
  useEffect(() => {
    const running = controllers.current;
    return () => {
      for (const controller of running.values()) controller.abort();
    };
  }, []);

  return {
    items,
    add: (files: readonly File[]) => setItems((current) => [...current, ...files.map((file): UploadItem => ({ key: `upload-${nextKey++}`, file, status: 'waiting', progress: 0, error: null, uploaded: null }))]),
    retry: (key: string) => patch(key, { status: 'waiting', progress: 0, error: null }),
    remove: (key: string) => {
      controllers.current.get(key)?.abort();
      setItems((current) => current.filter((item) => item.key !== key));
    },
    move: (index: number, delta: number) => setItems((current) => moved(current, index, delta)),
    clear: () => setItems([]),
  };
}

/** Buttons to choose files (or take a photo on a phone) and a place to drop them. */
export function FileChooser(props: { onFiles: (files: File[]) => void; label: string }) {
  const filesRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const take = (list: FileList | null) => {
    if (list !== null && list.length > 0) props.onFiles([...list]);
  };
  return (
    <div
      className="file-drop"
      data-over={over}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        take(event.dataTransfer.files);
      }}
    >
      <div className="row">
        <button type="button" className="primary" onClick={() => filesRef.current?.click()}>
          <UiIcon name="upload" /> {props.label}
        </button>
        <button type="button" className="only-phone" onClick={() => cameraRef.current?.click()}>
          <UiIcon name="photo" /> {t('documents.upload.camera')}
        </button>
      </div>
      <p className="muted only-desktop">{t('documents.upload.dropHint')}</p>
      <p className="muted">{t('documents.upload.formats')}</p>
      {/* The inputs are operated through the buttons above; they reset after each choice so the same file can be chosen again. */}
      <input
        ref={filesRef}
        type="file"
        hidden
        multiple
        accept={ACCEPTED_FILES}
        onChange={(event) => {
          take(event.target.files);
          event.target.value = '';
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        hidden
        accept="image/*"
        capture="environment"
        onChange={(event) => {
          take(event.target.files);
          event.target.value = '';
        }}
      />
    </div>
  );
}

/** The files being added, in the order they will have as pages: progress, failure with Retry, reorder, remove. */
export function UploadList(props: { uploads: ReturnType<typeof useUploads> }) {
  const { items } = props.uploads;
  if (items.length === 0) return null;
  return (
    <ol className="plain-list upload-list" aria-label={t('documents.upload.files')}>
      {items.map((item, index) => (
        <li key={item.key} className="card upload-item" data-status={item.status}>
          <div className="upload-main">
            <strong className="upload-name">{item.file.name}</strong>
            <small className="muted">
              {t('documents.upload.position', { n: index + 1 })} · {formatBytes(item.file.size)}
            </small>
            {item.status === 'done' && (
              <span className="upload-state">
                <UiIcon name="check" /> {t('documents.upload.done')}
              </span>
            )}
            {(item.status === 'uploading' || item.status === 'waiting') && (
              <label className="upload-progress">
                <span>{item.status === 'waiting' ? t('documents.upload.waiting') : t('documents.upload.uploading', { percent: Math.round(item.progress * 100) })}</span>
                <progress max={1} value={item.progress} />
              </label>
            )}
            {item.status === 'failed' && (
              <p role="alert" className="field-error">
                {item.error}
              </p>
            )}
          </div>
          <div className="row upload-actions">
            {item.status === 'failed' && (
              <button type="button" onClick={() => props.uploads.retry(item.key)}>
                {t('documents.upload.retry')}
              </button>
            )}
            {items.length > 1 && (
              <>
                <button type="button" className="quiet" disabled={index === 0} aria-label={t('documents.pages.moveUpNamed', { name: item.file.name })} onClick={() => props.uploads.move(index, -1)}>
                  {t('documents.pages.moveUp')}
                </button>
                <button type="button" className="quiet" disabled={index === items.length - 1} aria-label={t('documents.pages.moveDownNamed', { name: item.file.name })} onClick={() => props.uploads.move(index, 1)}>
                  {t('documents.pages.moveDown')}
                </button>
              </>
            )}
            <button type="button" className="quiet" aria-label={t('documents.upload.removeNamed', { name: item.file.name })} onClick={() => props.uploads.remove(item.key)}>
              {item.status === 'uploading' || item.status === 'waiting' ? t('common.cancel') : t('documents.upload.remove')}
            </button>
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * Manage the Workspace's own document types: add, rename, retire. Built-in types are not listed — they
 * cannot be changed. A retired type stays on the Documents that have it and is no longer offered.
 */
export function DocumentTypesDialog(props: { workspaceId: string; types: DocumentTypes; onChanged: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog !== null && !dialog.open) dialog.showModal();
  }, []);
  const run = (action: Promise<unknown>, after?: () => void) =>
    void action.then(
      () => {
        setMessage(null);
        after?.();
        props.onChanged();
      },
      (caught: unknown) => setMessage(failureText(caught)),
    );
  const live = props.types.custom.filter((type) => !type.retired);
  return (
    <dialog ref={ref} className="dialog" aria-labelledby={headingId} onClose={props.onClose}>
      <div className="stack">
        <h2 id={headingId} style={{ margin: 0 }}>
          {t('documents.types.heading')}
        </h2>
        <p className="muted" style={{ margin: 0 }}>
          {t('documents.types.hint')}
        </p>
        {message !== null && <p role="alert">{message}</p>}
        {live.length === 0 ? (
          <p className="muted">{t('documents.types.none')}</p>
        ) : (
          <ul className="plain-list type-list">
            {live.map((type) => (
              <li key={type.id} className="row">
                {renaming?.id === type.id ? (
                  <>
                    <input aria-label={t('documents.types.nameOf', { name: type.name })} maxLength={60} value={renaming.name} onChange={(event) => setRenaming({ id: type.id, name: event.target.value })} />
                    <button type="button" onClick={() => run(api.renameDocumentType(props.workspaceId, type.id, renaming.name), () => setRenaming(null))}>
                      {t('documents.types.saveName')}
                    </button>
                  </>
                ) : (
                  <>
                    <span className="type-name">{type.name}</span>
                    <button type="button" className="quiet" aria-label={t('documents.types.renameNamed', { name: type.name })} onClick={() => setRenaming({ id: type.id, name: type.name })}>
                      {t('documents.rename')}
                    </button>
                    <button type="button" className="quiet" aria-label={t('documents.types.retireNamed', { name: type.name })} onClick={() => run(api.retireDocumentType(props.workspaceId, type.id))}>
                      {t('documents.types.retire')}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <form
          className="row type-add"
          onSubmit={(event) => {
            event.preventDefault();
            run(api.createDocumentType(props.workspaceId, name), () => setName(''));
          }}
        >
          <div className="field">
            <label htmlFor={`${headingId}-new`}>{t('documents.types.newName')}</label>
            <input id={`${headingId}-new`} required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <button type="submit">{t('documents.types.add')}</button>
        </form>
        <div className="row dialog-actions">
          <button type="button" className="primary" onClick={() => ref.current?.close()}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </dialog>
  );
}
