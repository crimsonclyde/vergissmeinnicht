import { useEffect, useId, useRef, type ReactNode } from 'react';
import { t } from '../i18n/index.ts';
import { UiIcon } from '../ui-icons.tsx';

/** Native modal supplies focus containment and Escape; return focus to the original opener. */
export function GuideDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    const opener = document.activeElement;
    dialog.current?.showModal();
    return () => { if (opener instanceof HTMLElement && opener.isConnected) opener.focus(); };
  }, []);
  return <dialog ref={dialog} className="dialog guide-dialog" aria-labelledby={heading} onClose={onClose}>
    <div className="guide-dialog-heading"><h2 id={heading}>{title}</h2><button type="button" className="quiet icon-button" aria-label={t('common.close')} onClick={() => dialog.current?.close()}><UiIcon name="close" /></button></div>
    {children}
  </dialog>;
}
