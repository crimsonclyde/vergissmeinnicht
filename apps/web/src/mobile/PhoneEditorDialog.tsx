import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { messageFor } from '../api.ts';
import { setNavigationGuard } from '../router.tsx';
import { t } from '../i18n/index.ts';
import { MobileActionBar } from './MobileActionBar.tsx';
import { PhoneFlowHeading, usePhoneEditorFlow } from './PhoneEditorFlow.tsx';
import './phone-editor-dialog.css';

/** Shared modal presentation; the feature owns fields, revisions, mutations and dirty state. */
export function PhoneEditorDialog({ title, stages, submitLabel, dirty, submitDisabled = false, onSubmit, onClose, children }: {
  title: string; stages: readonly [{ id: string; title: string }, ...{ id: string; title: string }[]];
  submitLabel: string; dirty: boolean; submitDisabled?: boolean; onSubmit: () => Promise<void>; onClose: () => void;
  children: (stage: string | undefined) => ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const formId = useId(), titleId = useId();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const ids = stages.map(item => item.id) as [string, ...string[]];
  const { compact, stage, form, heading, index, count, isLast, next, back, onInvalid } = usePhoneEditorFlow({ stages: ids, busy });
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    if (!dirty && !busy) return;
    setNavigationGuard(() => !busy && (!dirty || window.confirm(t('mobile.discardChanges'))));
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => { setNavigationGuard(null); window.removeEventListener('beforeunload', warn); };
  }, [dirty, busy]);
  function cancel() {
    if (busy || (dirty && !window.confirm(t('mobile.discardChanges')))) return;
    dialog.current?.close();
  }
  async function submit() {
    if (busy) return;
    if (compact && !isLast) { next(); return; }
    if (submitDisabled) return;
    setBusy(true); setMessage(null);
    try { await onSubmit(); dialog.current?.close(); }
    catch (caught) { setMessage(caught instanceof Error && caught.name === 'Error' ? caught.message : messageFor(caught)); }
    finally { setBusy(false); }
  }
  return createPortal(<dialog ref={dialog} className="dialog phone-editor-dialog" data-compact={compact} aria-labelledby={titleId}
    onClose={onClose} onCancel={event => { event.preventDefault(); cancel(); }}>
    <form id={formId} ref={form} className="stack" onInvalidCapture={onInvalid} onSubmit={event => { event.preventDefault(); void submit(); }}>
      <h2 id={titleId}>{title}</h2>
      {compact && <PhoneFlowHeading title={stages[index]?.title ?? title} headingRef={heading} index={index} count={count} />}
      {message !== null && <p role="alert">{message}</p>}
      <fieldset disabled={busy} className="stack">{children(compact ? stage : undefined)}</fieldset>
      {!compact && <div className="row dialog-actions"><button className="primary" type="submit" disabled={busy || submitDisabled}>{submitLabel}</button><button type="button" disabled={busy} onClick={cancel}>{t('common.cancel')}</button></div>}
    </form>
    {compact && <MobileActionBar withinDialog label={title} actions={[
      { id:'back', label:t('common.back'), icon:'back', disabled:busy, onClick:() => back(cancel) },
      { id:'cancel', label:t('common.cancel'), icon:'close', disabled:busy, onClick:cancel },
    ]} primary={isLast ? {id:'save',label:submitLabel,icon:'save',type:'submit',form:formId,disabled:busy || submitDisabled} : {id:'next',label:t('common.next'),icon:'forward',disabled:busy,onClick:next}} />}
  </dialog>, document.body);
}
