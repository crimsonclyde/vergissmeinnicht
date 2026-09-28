import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { ProcedureIcon } from './api.ts';
import { t } from './i18n/index.ts';
import { ICON_GLYPHS, ICON_GROUPS, iconLabel } from './procedure-icons.tsx';

/**
 * Icon choice for Procedures and Steps: a button showing the current icon opens a panel with a search
 * field and large tiles grouped by topic. The tiles are one group of native radio buttons, so arrow
 * keys and screen readers work as usual. A pointer choice closes the panel; with the keyboard, arrows
 * move the choice and Enter or Escape closes (Enter never submits the surrounding form).
 */
export function IconPicker(props: {
  label: string;
  value: ProcedureIcon | null;
  allowNone: boolean;
  onChange: (icon: ProcedureIcon | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const name = useId();
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery('');
    buttonRef.current?.focus();
  };

  const current = props.value === null ? t('icon.none') : iconLabel(props.value);
  const needle = query.trim().toLowerCase();
  const matches = (icon: ProcedureIcon, group: string) =>
    needle === '' || iconLabel(icon).toLowerCase().includes(needle) || icon.includes(needle) || group.toLowerCase().includes(needle);
  const groups = ICON_GROUPS.map((group) => ({ ...group, icons: group.icons.filter((icon) => matches(icon, t(group.name))) })).filter(
    (group) => group.icons.length > 0,
  );

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
          onChange={() => props.onChange(icon)}
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
        onClick={() => (open ? close() : setOpen(true))}
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
          {props.allowNone && needle === '' && <div className="icon-grid">{tile(null)}</div>}
          {groups.length === 0 && <p className="muted">{t('iconPicker.noMatch')}</p>}
          {groups.map((group) => (
            <fieldset key={group.name} className="icon-group">
              <legend>{t(group.name)}</legend>
              <div className="icon-grid">{group.icons.map((icon) => tile(icon))}</div>
            </fieldset>
          ))}
        </div>
      )}
    </div>
  );
}
