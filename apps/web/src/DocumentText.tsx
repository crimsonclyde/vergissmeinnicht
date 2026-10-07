import { useCallback, useEffect, useId, useState } from 'react';
import { api, type DocumentFile, type FileTextInfo } from './api.ts';
import { failureText } from './DocumentFields.tsx';
import { joinedText, textSourceLine } from './document-model.ts';
import { formatDateTime, t } from './i18n/index.ts';

/** As many characters as the server keeps of a correction (`MAX_CORRECTION_CHARS`). */
const MAX_TEXT_LENGTH = 200_000;

/**
 * The text of one file, folded under the file (16.13): what was read — page by page, with its
 * source — or a person's correction of it. Everyone who sees the Document reads it and can copy it;
 * those who may change the Document correct it, or type in what could not be read (handwriting).
 * The text is loaded only when the section is opened, and always rendered as plain text.
 */
export function DocumentText(props: { workspaceId: string; file: DocumentFile; canManage: boolean }) {
  const { workspaceId, file, canManage } = props;
  const id = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<FileTextInfo | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api.documentFileText(workspaceId, file.id).then(
        (loaded) => {
          setText(loaded);
          setMessage(null);
        },
        (caught: unknown) => setMessage(failureText(caught)),
      ),
    [workspaceId, file.id],
  );
  // Loaded when opened, and again when the file's text state changes (reading finished, Retry).
  useEffect(() => {
    if (open) void load();
  }, [open, load, file.text]);

  const change = (action: Promise<FileTextInfo>, done: string) => {
    setBusy(true);
    action
      .then(
        (updated) => {
          setText(updated);
          setDraft(null);
          setMessage(null);
          setStatus(done);
        },
        (caught: unknown) => {
          setMessage(failureText(caught));
          void load(); // someone else may have changed it meanwhile: show what it is now
        },
      )
      .finally(() => setBusy(false));
  };

  const copy = (current: FileTextInfo) => {
    if (navigator.clipboard === undefined) {
      setMessage(t('documents.text.copyFailed'));
      return;
    }
    navigator.clipboard.writeText(joinedText(current)).then(
      () => setStatus(t('documents.text.copied')),
      () => setMessage(t('documents.text.copyFailed')),
    );
  };

  const source = text === null ? null : textSourceLine(text);
  const reading = file.text === 'QUEUED' || file.text === 'PROCESSING';

  return (
    <details className="more-actions document-text" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{text?.corrected != null ? t('documents.text.headingCorrected') : t('documents.text.heading')}</summary>
      {text === null ? (
        message === null ? <p>{t('common.loading')}</p> : <p role="alert">{message}</p>
      ) : draft !== null ? (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            change(api.correctDocumentText(workspaceId, file.id, draft, text.revision), t('documents.text.saved', { name: file.name }));
          }}
        >
          <div className="field">
            <label htmlFor={`${id}-text`}>{t('documents.text.editLabel', { name: file.name })}</label>
            <textarea id={`${id}-text`} className="document-text-edit" rows={12} maxLength={MAX_TEXT_LENGTH} value={draft} onChange={(event) => setDraft(event.target.value)} aria-describedby={`${id}-hint`} />
            <small id={`${id}-hint`} className="muted">
              {t('documents.text.editHint')}
            </small>
          </div>
          {message !== null && <p role="alert">{message}</p>}
          <div className="row">
            <button type="submit" className="primary" disabled={busy}>
              {t('documents.text.save')}
            </button>
            <button type="button" disabled={busy} onClick={() => setDraft(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      ) : (
        <div className="stack">
          {(source !== null || text.corrected !== null) && (
            <p className="muted document-text-source">
              {text.corrected !== null ? t('documents.text.correctedBy', { name: text.corrected.by, when: formatDateTime(text.corrected.at) }) : source}
            </p>
          )}
          {text.pages.length === 0 ? (
            <p className="muted">{reading && text.corrected === null ? t('documents.text.notYet') : t('documents.text.empty')}</p>
          ) : (
            <div className="document-text-pages" tabIndex={0} role="region" aria-label={t('documents.text.regionLabel', { name: file.name })}>
              {text.pages.map((page, index) => (
                <section key={index} className="document-text-page">
                  {text.pages.length > 1 && <h5 className="document-text-page-title">{t('documents.text.page', { n: index + 1 })}</h5>}
                  <p className="document-text-body">{page}</p>
                </section>
              ))}
            </div>
          )}
          {text.truncated && <p className="muted">{t('documents.text.truncated')}</p>}
          {message !== null && <p role="alert">{message}</p>}
          <div className="row">
            {text.pages.length > 0 && (
              <button type="button" onClick={() => copy(text)}>
                {t('documents.text.copy')}
              </button>
            )}
            {canManage && (
              <button type="button" aria-label={t('documents.text.editNamed', { name: file.name })} onClick={() => setDraft(joinedText(text))}>
                {t('documents.text.edit')}
              </button>
            )}
            {canManage && text.corrected !== null && (
              <button
                type="button"
                className="quiet"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(t('documents.text.restoreConfirm', { name: file.name }))) return;
                  change(api.restoreDocumentText(workspaceId, file.id, text.revision), t('documents.text.restored', { name: file.name }));
                }}
              >
                {t('documents.text.restore')}
              </button>
            )}
          </div>
        </div>
      )}
      <p role="status" className="visually-hidden">
        {status ?? ''}
      </p>
    </details>
  );
}
