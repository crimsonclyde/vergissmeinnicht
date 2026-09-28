import { useEffect, useRef, useState } from 'react';
import { t } from './i18n/index.ts';

/**
 * Two-step confirmation for critical Steps (Step 8.7), for people who cannot press and hold: the
 * first activation asks, the second ("Yes, done") confirms; Cancel or Escape goes back. Works the
 * same with pointer, touch, keyboard and switch access. UX protection only — the server validates.
 */
export function TapToConfirm(props: { label: string; disabled?: boolean; onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (asking) confirmRef.current?.focus();
    else if (returnFocus.current) startRef.current?.focus();
    returnFocus.current = false;
  }, [asking]);

  const cancel = () => {
    returnFocus.current = true;
    setAsking(false);
  };

  if (!asking) {
    return (
      <button
        ref={startRef}
        type="button"
        className="done-action"
        disabled={props.disabled}
        aria-label={t('tapConfirm.name', { title: props.label })}
        onClick={() => setAsking(true)}
      >
        {t('step.doneShort')}
      </button>
    );
  }
  return (
    <span
      className="row tap-confirm"
      role="group"
      aria-label={t('tapConfirm.question', { title: props.label })}
      onKeyDown={(event) => {
        if (event.key === 'Escape') cancel();
      }}
    >
      <strong aria-hidden="true">{t('tapConfirm.questionShort')}</strong>
      <button ref={confirmRef} type="button" className="done-action" disabled={props.disabled} onClick={props.onConfirm}>
        {t('tapConfirm.yes')}
      </button>
      <button type="button" disabled={props.disabled} onClick={cancel}>
        {t('common.cancel')}
      </button>
    </span>
  );
}
