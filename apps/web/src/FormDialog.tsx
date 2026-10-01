import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { messageFor } from './api.ts';
import { t } from './i18n/index.ts';

/**
 * A small modal form (skip, move, assign, rename, …). The native dialog traps focus, closes on Escape
 * and gives focus back to what opened it. `danger` marks a destructive submit so it does not look like
 * an ordinary primary action. An error keeps the dialog open with everything that was entered.
 */
export function FormDialog(props: {
  title: string;
  submitLabel: string;
  danger?: boolean;
  /** Disables the submit button (e.g. while what was entered cannot be used). */
  submitDisabled?: boolean;
  onSubmit: () => Promise<void> | void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog !== null && !dialog.open) dialog.showModal();
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await props.onSubmit();
      ref.current?.close();
    } catch (caught) {
      // A plain Error carries a message written for the person (e.g. "Choose an execution").
      setMessage(caught instanceof Error && caught.name === 'Error' ? caught.message : messageFor(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog ref={ref} className="dialog" aria-labelledby={headingId} onClose={props.onClose}>
      <form onSubmit={(event) => void submit(event)} className="stack">
        <h2 id={headingId} style={{ margin: 0 }}>
          {props.title}
        </h2>
        {message !== null && <p role="alert">{message}</p>}
        {props.children}
        <div className="row dialog-actions">
          <button type="submit" className={props.danger === true ? 'danger' : 'primary'} disabled={busy || props.submitDisabled === true}>
            {props.submitLabel}
          </button>
          <button type="button" onClick={() => ref.current?.close()}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
