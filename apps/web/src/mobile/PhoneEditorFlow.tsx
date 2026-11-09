import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { t } from '../i18n/index.ts';
import { useCompactLayout } from './useCompactLayout.ts';

/** Shared presentation mechanics only. A feature owns its draft, cancellation and server Save. */
export function usePhoneEditorFlow<Stage extends string>(options: {
  stages: readonly [Stage, ...Stage[]];
  busy: boolean;
  initialStage?: Stage;
  onReveal?: (field: HTMLElement) => void;
}) {
  const compact = useCompactLayout();
  const [stage, setStage] = useState<Stage>(options.initialStage ?? options.stages[0]);
  const [visited, setVisited] = useState<readonly Stage[]>([options.initialStage ?? options.stages[0]]);
  const form = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<HTMLElement | null>(null);
  const frame = useRef(0);
  const index = options.stages.indexOf(stage);
  useEffect(() => {
    if (compact && !pendingFocus.current) {
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView({ block: 'start' });
    }
  }, [compact, stage]);
  useEffect(() => () => window.cancelAnimationFrame(frame.current), []);
  function show(next: Stage) { setVisited(current => current.includes(next) ? current : [...current, next]); setStage(next); }
  function reveal(field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) {
    const name = field.closest<HTMLElement>('[data-editor-stage]')?.dataset.editorStage;
    const next = options.stages.find(candidate => candidate === name);
    if (next) show(next);
    options.onReveal?.(field);
    for (let parent = field.parentElement; parent && parent !== form.current; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
    }
    pendingFocus.current = field;
    window.cancelAnimationFrame(frame.current);
    frame.current = window.requestAnimationFrame(() => {
      field.focus(); pendingFocus.current = null; field.reportValidity();
    });
  }
  function next() {
    if (options.busy) return;
    const panel = Array.from(form.current?.querySelectorAll<HTMLElement>('[data-editor-stage]') ?? []).find(element => element.dataset.editorStage === stage);
    const invalid = panel?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input:invalid, select:invalid, textarea:invalid');
    if (invalid) { reveal(invalid); return; }
    const nextStage = options.stages[index + 1];
    if (nextStage) show(nextStage);
  }
  function back(onExit: () => void) {
    if (options.busy) return;
    const previous = options.stages[index - 1];
    if (previous) show(previous); else onExit();
  }
  function onInvalid(event: FormEvent) {
    if (!compact) return;
    const invalid = form.current?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input:invalid, select:invalid, textarea:invalid');
    if (invalid && invalid.getClientRects().length === 0) { event.preventDefault(); reveal(invalid); }
  }
  return { compact, stage, form, heading, next, back, onInvalid, index, count: options.stages.length, isLast: index === options.stages.length - 1, hasVisited: (value: Stage) => visited.includes(value) };
}

export function PhoneFlowHeading({ title, headingRef, index, count }: {
  title: string; headingRef: RefObject<HTMLHeadingElement | null>; index: number; count: number;
}) {
  return <header className="phone-flow-heading"><p className="muted" aria-live="polite">{t('mobile.stepOf', { number: index + 1, count })}</p><h2 ref={headingRef} tabIndex={-1}>{title}</h2></header>;
}
