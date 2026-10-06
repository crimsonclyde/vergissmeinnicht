import { useEffect, useId, useState } from 'react';
import { api, messageFor, type TextRecognitionInfo } from './api.ts';
import { t } from './i18n/index.ts';

/**
 * Workspace settings → General, for Workspace admins while Documents is on (16.9, P5): text
 * recognition for the whole Workspace — on by default — and how many files are read, waiting or not
 * readable. Says plainly where the text is read (on this server) and what switching off does.
 */
export function TextRecognitionCard(props: { workspaceId: string }) {
  const { workspaceId } = props;
  const id = useId();
  const [info, setInfo] = useState<TextRecognitionInfo | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.textRecognition(workspaceId).then(setInfo, (caught: unknown) => setMessage(messageFor(caught)));
  }, [workspaceId]);

  async function set(enabled: boolean) {
    setBusy(true);
    setMessage(null);
    setStatus(null);
    try {
      setInfo(await api.setTextRecognition(workspaceId, enabled));
      setStatus(t(enabled ? 'textRecognition.saved' : 'textRecognition.savedOff'));
    } catch (caught) {
      setMessage(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack">
      <h3 style={{ marginTop: 0 }}>{t('textRecognition.heading')}</h3>
      <p className="muted" style={{ margin: 0 }}>
        {t('textRecognition.explain')}
      </p>
      {info !== null && (
        <>
          <label className="option-label tool-switch">
            <input type="checkbox" checked={info.enabled} disabled={busy} aria-describedby={`${id}-off`} onChange={(event) => void set(event.target.checked)} />
            <span>
              <strong>{t('textRecognition.enabled')}</strong>
              <br />
              <small id={`${id}-off`} className="muted">
                {t('textRecognition.offNote')}
              </small>
            </span>
          </label>
          <p className="muted" style={{ margin: 0 }}>
            {t('textRecognition.counts', {
              done: info.files.DONE,
              waiting: info.files.QUEUED + info.files.PROCESSING,
              failed: info.files.FAILED,
              na: info.files.NOT_APPLICABLE,
            })}
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
