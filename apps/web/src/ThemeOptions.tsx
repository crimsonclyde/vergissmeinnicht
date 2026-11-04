import type { CSSProperties } from 'react';
import { placeForTheme } from './places/registry.ts';
import { t } from './i18n/index.ts';
import { THEME_MODES, type ThemeMode } from './theme.ts';
import { UiIcon } from './ui-icons.tsx';

/** A small picture of a theme: page, a card, the main button and the brand colour. */
function ThemeSwatch({ mode }: { mode: string }) {
  // A Places country paints its swatch from the registry: its own palette and a corner of its artwork.
  const place = placeForTheme(mode);
  const style =
    place === null
      ? undefined
      : ({
          '--swatch-bg': place.light.tokens.bg,
          '--swatch-surface': place.light.tokens.surface,
          '--swatch-border': place.light.tokens.border,
          '--swatch-text': place.light.tokens['text-muted'],
          '--swatch-accent': place.light.tokens.accent,
          '--swatch-art': `url("${place.artwork.day.wideSmall}")`,
        } as CSSProperties);
  return (
    <span className="theme-swatch" data-swatch={mode} data-place={place?.id} style={style} aria-hidden="true">
      <span className="theme-swatch-card">
        <span className="theme-swatch-line" />
        <span className="theme-swatch-line theme-swatch-short" />
        <span className="theme-swatch-button" />
      </span>
    </span>
  );
}

/** The fixed themes first, then the Places countries as their own group. */
const THEME_GROUPS = [
  {
    key: 'base',
    modes: THEME_MODES.filter((mode) => placeForTheme(mode) === null),
  },
  {
    key: 'places',
    modes: THEME_MODES.filter((mode) => placeForTheme(mode) !== null),
  },
] as const;

/** The theme options as radio buttons with swatches; `onPick` saves the chosen theme. */
export function ThemeOptions({ name, current, onPick }: { name: string; current: ThemeMode; onPick: (value: ThemeMode) => void }) {
  return (
    <>
      {THEME_GROUPS.map(({ key, modes }) => (
        <div key={key} className="theme-group">
          {key === 'places' && (
            <p className="theme-group-head" title={t('appearance.placesHint')}>
              <UiIcon name="places" size="1.2em" />
              <strong>{t('appearance.places')}</strong>
            </p>
          )}
          <div className="theme-options">
            {modes.map((value) => (
              <label key={value} className="theme-option" title={t(`appearance.${value}Hint`)}>
                <input type="radio" name={name} value={value} checked={current === value} onChange={() => onPick(value)} />
                <ThemeSwatch mode={value} />
                <span className="theme-option-text">
                  <strong>{t(`appearance.${value}`)}</strong>
                </span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
