import { useCallback, useEffect, useState } from 'react';
import { api, type DocumentDetail, type DocumentSuggestion } from './api.ts';
import { RemindDialog } from './DocumentLinks.tsx';
import { acceptedFields, suggestionSource, suggestionText } from './document-model.ts';
import { t } from './i18n/index.ts';
import { failureText } from './DocumentFields.tsx';
import { todayIn, browserTimeZone } from './schedule-dates.ts';

/**
 * Suggestions from a Document's recognised text (16.9 task 5), for those who may change it. Each one
 * says where it was read and is accepted or dismissed by itself; nothing is applied otherwise.
 * Accepting is an ordinary change of the Document (with its revision, so someone else's change is
 * never overwritten); a payment due date leads into "Remind me…", where date and notifications are
 * reviewed before anything is created.
 */
export function DocumentSuggestions(props: { workspaceId: string; document: DocumentDetail; canSchedule: boolean; onChanged: (document: DocumentDetail | null) => void }) {
  const { workspaceId, document } = props;
  const [suggestions, setSuggestions] = useState<readonly DocumentSuggestion[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reminding, setReminding] = useState<DocumentSuggestion | null>(null);
  const today = todayIn(browserTimeZone());

  const load = useCallback(() => {
    api.documentSuggestions(workspaceId, document.id).then(setSuggestions, () => setSuggestions([]));
  }, [workspaceId, document.id]);
  // Again whenever the Document changes (what it already says is no longer suggested) or a file's text is read.
  const texts = document.pages.map((page) => page.text ?? '').join();
  useEffect(load, [load, document.revision, texts]);

  async function accept(suggestion: DocumentSuggestion) {
    const fields = acceptedFields(document, suggestion);
    if (fields === undefined) return;
    setBusy(true);
    setMessage(null);
    try {
      const updated = await api.updateDocument(workspaceId, document.id, fields, document.revision);
      setStatus(t('documents.suggest.accepted', { text: suggestionText(suggestion) }));
      props.onChanged(updated);
    } catch (caught) {
      setMessage(failureText(caught));
      props.onChanged(null);
    } finally {
      setBusy(false);
    }
  }

  async function dismiss(suggestion: DocumentSuggestion) {
    setBusy(true);
    setMessage(null);
    try {
      await api.dismissSuggestion(workspaceId, document.id, suggestion);
      setStatus(t('documents.suggest.dismissed', { text: suggestionText(suggestion) }));
      load();
    } catch (caught) {
      setMessage(failureText(caught));
    } finally {
      setBusy(false);
    }
  }

  if (suggestions.length === 0 && status === null && message === null) return null;
  return (
    <section className="card stack document-suggestions" aria-labelledby="document-suggestions-heading">
      <h3 id="document-suggestions-heading" style={{ marginTop: 0 }}>
        {t('documents.suggest.heading')}
      </h3>
      <p className="muted" style={{ margin: 0 }}>
        {t('documents.suggest.intro')}
      </p>
      <ul className="plain-list stack">
        {suggestions.map((suggestion) => {
          const text = suggestionText(suggestion);
          const past = suggestion.field === 'dueDate' && suggestion.value < today;
          return (
            <li key={`${suggestion.field}:${suggestion.value}`} className="document-suggestion">
              <strong>{text}</strong>
              {/* What was read, as printed: plain text, never markup. */}
              <small className="muted">
                {suggestionSource(suggestion, document.pages.length)} “{suggestion.excerpt}”
              </small>
              <span className="row">
                {suggestion.field === 'dueDate' ? (
                  past ? (
                    <small className="muted">{t('documents.suggest.past')}</small>
                  ) : (
                    props.canSchedule && (
                      <button type="button" disabled={busy} onClick={() => setReminding(suggestion)}>
                        {t('documents.suggest.remind')}
                      </button>
                    )
                  )
                ) : (
                  <button type="button" disabled={busy} aria-label={t('documents.suggest.acceptNamed', { text })} onClick={() => void accept(suggestion)}>
                    {suggestion.field === 'amount' || suggestion.field === 'supplier' ? t('documents.suggest.acceptNotes') : t('documents.suggest.accept')}
                  </button>
                )}
                <button type="button" className="quiet" disabled={busy} aria-label={t('documents.suggest.dismissNamed', { text })} onClick={() => void dismiss(suggestion)}>
                  {t('documents.suggest.dismiss')}
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      {message !== null && <p role="alert">{message}</p>}
      <p role="status" style={{ margin: 0 }}>
        {status ?? ''}
      </p>
      {reminding !== null && (
        <RemindDialog
          workspaceId={workspaceId}
          suggestedTitle={t('documents.suggest.remindTitle', { title: document.title })}
          suggestedDate={reminding.value}
          link={(scheduleId) => api.addDocumentLink(workspaceId, document.id, { type: 'schedule', id: scheduleId })}
          onClose={() => setReminding(null)}
          onDone={(title) => {
            setReminding(null);
            setStatus(t('links.remind.done', { name: title }));
            props.onChanged(null);
          }}
        />
      )}
    </section>
  );
}
