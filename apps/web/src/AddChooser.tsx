import { useEffect, useId, useRef } from 'react';
import { t, type MessageKey } from './i18n/index.ts';
import { navigate, paths } from './router.tsx';
import { UiIcon, type UiIconName } from './ui-icons.tsx';

export interface CanAdd {
  readonly procedure: boolean;
  readonly reminder: boolean;
  readonly list: boolean;
  /** Documents is switched on in this Workspace and the person may add Documents (16.2). */
  readonly document: boolean;
}

interface Choice {
  readonly key: keyof CanAdd;
  readonly icon: UiIconName;
  readonly label: MessageKey;
  readonly hint: MessageKey;
  readonly href: (workspaceId: string) => string;
}

const CHOICES: readonly Choice[] = [
  { key: 'procedure', icon: 'procedures', label: 'add.procedure', hint: 'add.procedureHint', href: paths.newProcedure },
  { key: 'reminder', icon: 'reminders', label: 'add.reminder', hint: 'add.reminderHint', href: paths.newReminder },
  { key: 'list', icon: 'grocery', label: 'add.list', hint: 'add.listHint', href: paths.newList },
  { key: 'document', icon: 'documents', label: 'add.document', hint: 'add.documentHint', href: (workspaceId) => paths.newDocument(workspaceId) },
];

/** What the person may add here — only what they are allowed to create (UI only; the server decides). */
export const addChoices = (can: CanAdd): readonly Choice[] => CHOICES.filter((choice) => can[choice.key]);

const DESKTOP = '(min-width: 56.0625rem)';

/**
 * The Add button of Today (15.1): Procedure — reusable steps, Reminder — remember one thing, Grocery
 * list — quick shared shopping. Each choice opens its creation flow at once. A compact panel under the
 * button on desktop, a bottom sheet on phones; in both cases a modal dialog, so focus stays inside,
 * Escape closes it and focus returns to the button. Without anything to add, there is no button.
 */
export function AddChooser(props: { workspaceId: string; can: CanAdd }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const choices = addChoices(props.can);

  // A panel anchored to the button no longer fits once the layout changes: close it.
  useEffect(() => {
    const close = () => dialogRef.current?.close();
    window.addEventListener('resize', close);
    return () => window.removeEventListener('resize', close);
  }, []);

  if (choices.length === 0) return null;

  const open = () => {
    const dialog = dialogRef.current;
    const button = buttonRef.current;
    if (dialog === null || button === null) return;
    if (typeof window.matchMedia === 'function' && window.matchMedia(DESKTOP).matches) {
      // Under the button, aligned with its right edge (set through the CSSOM: no inline style attribute).
      const rect = button.getBoundingClientRect();
      dialog.style.top = `${rect.bottom + 6}px`;
      dialog.style.right = `${Math.max(8, document.documentElement.clientWidth - rect.right)}px`;
    } else {
      dialog.style.top = '';
      dialog.style.right = '';
    }
    dialog.showModal();
  };

  return (
    <>
      <button ref={buttonRef} type="button" className="primary add-button" aria-haspopup="dialog" onClick={open}>
        <UiIcon name="add" /> {t('add.button')}
      </button>
      <dialog
        ref={dialogRef}
        className="chooser"
        aria-labelledby={headingId}
        onClick={(event) => {
          // A click on the backdrop (the dialog element itself) closes it.
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        <div className="chooser-head">
          <h2 id={headingId}>{t('add.heading')}</h2>
          <button type="button" className="quiet icon-button" aria-label={t('common.close')} onClick={() => dialogRef.current?.close()}>
            <UiIcon name="close" />
          </button>
        </div>
        <ul className="plain-list chooser-list">
          {choices.map((choice) => (
            <li key={choice.key}>
              <button
                type="button"
                className="chooser-choice"
                onClick={() => {
                  dialogRef.current?.close();
                  navigate(choice.href(props.workspaceId));
                }}
              >
                <span className="item-icon">
                  <UiIcon name={choice.icon} size="1.5em" />
                </span>
                <span className="chooser-text">
                  <strong>{t(choice.label)}</strong>
                  <small className="muted">{t(choice.hint)}</small>
                </span>
                <UiIcon name="chevron" />
              </button>
            </li>
          ))}
        </ul>
      </dialog>
    </>
  );
}
