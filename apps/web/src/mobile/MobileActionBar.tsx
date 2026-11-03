import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { UiIcon, type UiIconName } from '../ui-icons.tsx';
import { keyboardInset } from '../viewport-drift.ts';
import './mobile-action-bar.css';

// A modal can cover an already-focused editor after a breakpoint change. Only its bar is active.
const mountedBars: { element: HTMLElement; modal: boolean; update: () => void }[] = [];
const activeBar = () => mountedBars.findLast(entry => entry.modal) ?? mountedBars.at(-1);
function activateBar() {
  const active = activeBar();
  mountedBars.forEach(entry => { entry.element.hidden = entry !== active; });
  active?.update();
}

export interface MobileAction {
  id: string;
  label: string;
  icon: UiIconName;
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
  form?: string;
}
/** One active bar per focused phone workflow. Consumers supply authorized actions and save state. */
export function MobileActionBar({ label, actions, primary, withinDialog = false }: { label: string; actions: readonly MobileAction[]; primary?: MobileAction; withinDialog?: boolean }) {
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = bar.current;
    if (!element) return;
    const viewport = window.visualViewport;
    const root = document.documentElement;
    root.dataset.mobileActionBar='true';
    let frame = 0;
    const update = () => {
      frame = 0;
      if (activeBar()?.element !== element) return;
      const inset = viewport ? keyboardInset(window.innerHeight, viewport) : 0;
      root.style.setProperty('--mobile-action-bar-inset', `${Math.round(inset)}px`);
      root.style.setProperty('--mobile-action-bar-height', `${bar.current?.offsetHeight ?? 80}px`);
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    const observer = new ResizeObserver(schedule);
    if (bar.current) observer.observe(bar.current);
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    const entry = { element, modal: withinDialog, update: schedule };
    mountedBars.push(entry);
    activateBar();
    return () => {
      observer.disconnect();
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.cancelAnimationFrame(frame);
      mountedBars.splice(mountedBars.indexOf(entry), 1);
      if (mountedBars.length) activateBar();
      else {
        delete root.dataset.mobileActionBar;
        root.style.removeProperty('--mobile-action-bar-inset');
        root.style.removeProperty('--mobile-action-bar-height');
      }
    };
  }, [withinDialog]);
  const button = (action: MobileAction, emphasized = false) => <button key={action.id} type={action.type ?? 'button'} form={action.form} onClick={action.onClick} disabled={action.disabled} aria-label={action.label} title={action.label} className={emphasized ? 'primary' : 'quiet'}><UiIcon name={action.icon} size={24} /></button>;
  const navigation = <nav ref={bar} className="mobile-action-bar" aria-label={label}><div className="mobile-action-bar-secondary">{actions.map(action => button(action))}</div>{primary !== undefined && button(primary, true)}</nav>;
  return withinDialog ? navigation : createPortal(navigation, document.body);
}
