import { t } from './i18n/index.ts';
import { UiIcon } from './ui-icons.tsx';

export interface Undoable {
  /** What just happened, e.g. "“Milk” removed." */
  readonly message: string;
  readonly undo: () => void;
}

/**
 * Says what was just done and offers to take it back. A polite live region, so screen readers
 * announce it; it stays until it is dismissed or replaced by the next action — no countdown to race.
 * Sticks to the bottom of the page above the phone bar, without covering the last entries.
 */
export function UndoNotice(props: { notice: Undoable | null; onDismiss: () => void }) {
  return (
    <div className="undo-notice" role="status" data-shown={props.notice !== null}>
      {props.notice !== null && (
        <>
          <span>{props.notice.message}</span>
          <span className="row">
            <button
              type="button"
              onClick={() => {
                props.notice?.undo();
                props.onDismiss();
              }}
            >
              <UiIcon name="undo" /> {t('common.undo')}
            </button>
            <button type="button" className="quiet icon-button" aria-label={t('common.dismiss')} onClick={props.onDismiss}>
              <UiIcon name="close" />
            </button>
          </span>
        </>
      )}
    </div>
  );
}
