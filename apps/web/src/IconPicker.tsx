import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { ProcedureIcon } from './api.ts';
import { t } from './i18n/index.ts';
import { ICON_GLYPHS, ICON_GROUPS, iconLabel } from './procedure-icons.tsx';

/** A few common icons shown first (13.16); everything else is one "Browse all" or a search away. */
export const SUGGESTED_ICONS: readonly ProcedureIcon[] = ['checklist', 'home', 'shopping', 'cleaning', 'travel', 'power', 'security', 'work'];
const RECENT_KEY = 'vmn.recentIcons';
const RECENT_MAX = 6;

// Per-viewer convenience only (never required; storage may be unavailable, e.g. in private mode).
function recentIcons(): ProcedureIcon[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(stored) ? stored.filter((icon): icon is ProcedureIcon => typeof icon === 'string' && icon in ICON_GLYPHS).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function rememberIcon(icon: ProcedureIcon): void {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify([icon, ...recentIcons().filter((other) => other !== icon)].slice(0, RECENT_MAX)));
  } catch {
    /* ignore */
  }
}

/**
 * Icon choice for Procedures and Steps: a button showing the current icon opens a calm panel —
 * suggested and recently used icons, a search field, and "Browse all" for the complete catalog grouped
 * by topic (13.16). Each view shows every icon at most once, as one group of native radio buttons, so
 * arrow keys and screen readers work as usual. A pointer choice closes the panel; with the keyboard,
 * arrows move the choice and Enter or Escape closes (Enter never submits the surrounding form).
 */
export function IconPicker(props: {
  label: string;
  value: ProcedureIcon | null;
  allowNone: boolean;
  onChange: (icon: ProcedureIcon | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [browseAll, setBrowseAll] = useState(false);
  const [recent, setRecent] = useState<ProcedureIcon[]>([]);
  const [query, setQuery] = useState('');
  const name = useId();
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const openPanel = () => {
    setRecent(recentIcons());
    setBrowseAll(false);
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    setQuery('');
    buttonRef.current?.focus();
  };

  const choose = (icon: ProcedureIcon | null) => {
    if (icon !== null) rememberIcon(icon);
    props.onChange(icon);
  };

  const current = props.value === null ? t('icon.none') : iconLabel(props.value);
  const needle = query.trim().toLowerCase();
  const matches = (icon: ProcedureIcon, group: string) =>
    needle === '' || iconLabel(icon).toLowerCase().includes(needle) || icon.includes(needle) || group.toLowerCase().includes(needle);
  const groups = ICON_GROUPS.map((group) => ({ ...group, icons: group.icons.filter((icon) => matches(icon, t(group.name))) })).filter(
    (group) => group.icons.length > 0,
  );

  const suggested = [...SUGGESTED_ICONS, ...(props.value !== null && !SUGGESTED_ICONS.includes(props.value) && !recent.includes(props.value) ? [props.value] : [])];
  const quick = { suggested, recent: recent.filter((icon) => !suggested.includes(icon)) };

  const onPanelKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      close();
    }
  };

  const tile = (icon: ProcedureIcon | null) => {
    const label = icon === null ? t('icon.none') : iconLabel(icon);
    return (
      <label key={icon ?? 'none'} className="icon-tile" title={label} onPointerUp={() => setTimeout(close, 0)}>
        <input
          type="radio"
          className="visually-hidden"
          name={name}
          value={icon ?? ''}
          checked={props.value === icon}
          onChange={() => choose(icon)}
        />
        <span className="icon-tile-glyph" aria-hidden="true">
          {icon === null ? '∅' : ICON_GLYPHS[icon]}
        </span>
        <span className="icon-tile-label">{label}</span>
      </label>
    );
  };

  return (
    <div className="icon-picker">
      <button
        ref={buttonRef}
        type="button"
        className="icon-picker-button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t('iconPicker.choose', { label: props.label, icon: current })}
        onClick={() => (open ? close() : openPanel())}
      >
        <span className="icon-picker-glyph" aria-hidden="true">
          {props.value === null ? '∅' : ICON_GLYPHS[props.value]}
        </span>
        <span aria-hidden="true">
          {props.label}: {current}
        </span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div id={panelId} className="icon-panel" role="group" aria-label={props.label} onKeyDown={onPanelKey}>
          <div className="row">
            <input
              ref={searchRef}
              type="search"
              aria-label={t('iconPicker.search')}
              placeholder={t('iconPicker.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button type="button" className="quiet" onClick={close}>
              {t('iconPicker.close')}
            </button>
          </div>
          {needle === '' && !browseAll ? (
            <>
              {/* The quick view: suggestions, then recently used — the current icon is always among them. */}
              <fieldset className="icon-group">
                <legend>{t('iconPicker.suggested')}</legend>
                <div className="icon-grid">
                  {props.allowNone && tile(null)}
                  {quick.suggested.map((icon) => tile(icon))}
                </div>
              </fieldset>
              {quick.recent.length > 0 && (
                <fieldset className="icon-group">
                  <legend>{t('iconPicker.recent')}</legend>
                  <div className="icon-grid">{quick.recent.map((icon) => tile(icon))}</div>
                </fieldset>
              )}
              <button type="button" className="quiet" onClick={() => setBrowseAll(true)}>
                {t('iconPicker.browseAll', { count: ICON_GROUPS.reduce((sum, group) => sum + group.icons.length, 0) })}
              </button>
            </>
          ) : (
            <>
              {props.allowNone && needle === '' && <div className="icon-grid">{tile(null)}</div>}
              {groups.length === 0 && <p className="muted">{t('iconPicker.noMatch')}</p>}
              {groups.map((group) => (
                <fieldset key={group.name} className="icon-group">
                  <legend>{t(group.name)}</legend>
                  <div className="icon-grid">{group.icons.map((icon) => tile(icon))}</div>
                </fieldset>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
