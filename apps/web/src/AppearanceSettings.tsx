import { GuideAppearance } from './guide/GuideAppearance.tsx';
import { useState, type CSSProperties } from 'react';
import { placeForTheme } from './places/registry.ts';
import { messageFor, type WorkspaceSummary } from './api.ts';
import { t } from './i18n/index.ts';
import { usePreferences } from './preferences.tsx';
import { THEME_MODES, canonicalThemeMode, type ThemeMode } from './theme.ts';
import { UiIcon } from './ui-icons.tsx';

/** A small picture of a theme: page, a card, the main button and the brand colour. */
function ThemeSwatch({ mode, mini = false }: { mode: string; mini?: boolean }) {
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
    <span
      className={mini ? 'theme-swatch theme-swatch-mini' : 'theme-swatch'}
      data-swatch={mode}
      data-place={place?.id}
      style={style}
      aria-hidden="true"
    >
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
function ThemeOptions({ name, current, onPick }: { name: string; current: ThemeMode; onPick: (value: ThemeMode) => void }) {
  return (
    <>
      {THEME_GROUPS.map(({ key, modes }) => (
        <div key={key} className="theme-group">
          {key === 'places' && (
            <p className="theme-group-head">
              <UiIcon name="places" size="1.2em" />
              <strong>{t('appearance.places')}</strong>
              <small className="muted">{t('appearance.placesHint')}</small>
            </p>
          )}
          <div className="theme-options">
            {modes.map((value) => (
              <label key={value} className="theme-option">
                <input type="radio" name={name} value={value} checked={current === value} onChange={() => onPick(value)} />
                <ThemeSwatch mode={value} />
                <span className="theme-option-text">
                  <strong>{t(`appearance.${value}`)}</strong>
                  <small className="muted">{t(`appearance.${value}Hint`)}</small>
                </span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * Theme choice, saved to the account (Step 8.7) so it follows the user to every device. Per Workspace
 * (section 28) the person picks the Workspace first, then that Workspace's theme. The account theme is
 * offered directly only when the account has no Workspace to theme.
 */
export function AppearanceSettings({ workspaces = null }: { workspaces?: readonly WorkspaceSummary[] | null }) {
  const { preferences, update, workspacePreferences, setWorkspaceTheme, setDefaultWorkspace } = usePreferences();
  const [message, setMessage] = useState<string | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const failed = (caught: unknown) => setMessage(messageFor(caught));
  const list = workspaces ?? [];
  const selected = list.find((workspace) => workspace.id === pickedId) ?? list[0] ?? null;
  return (
    <>
      {message !== null && <p role="alert">{message}</p>}
      <GuideAppearance />
      {workspaces !== null && workspaces.length === 0 && (
        <fieldset>
          <legend>{t('appearance.legend')}</legend>
          <p className="muted" style={{ marginTop: 0 }}>
            {t('appearance.savedToAccount')}
          </p>
          <ThemeOptions
            name="theme"
            current={canonicalThemeMode(preferences.theme)}
            onPick={(value) => {
              setMessage(null);
              update({ theme: value }).catch(failed);
            }}
          />
        </fieldset>
      )}
      {selected !== null && (
        <section className="workspace-looks" aria-labelledby="workspace-looks-heading">
          <h3 id="workspace-looks-heading">{t('appearance.workspaces')}</h3>
          <p className="muted">{t('appearance.workspacesHint')}</p>
          <ul className="workspace-look-list">
            {list.map((workspace) => {
              const effective = canonicalThemeMode(workspacePreferences.themes[workspace.id] ?? preferences.theme);
              const isDefault = workspacePreferences.defaultWorkspaceId === workspace.id;
              const isSelected = workspace.id === selected.id;
              const name = workspace.name;
              return (
                <li key={workspace.id} className={isSelected ? 'workspace-look workspace-look-selected' : 'workspace-look'}>
                  <button
                    type="button"
                    className="workspace-look-pick"
                    aria-pressed={isSelected}
                    onClick={() => {
                      setMessage(null);
                      setPickedId(workspace.id);
                    }}
                  >
                    <ThemeSwatch mode={effective} mini />
                    <span className="workspace-look-name">{name}</span>
                    <small className="muted">{t(`appearance.${effective}`)}</small>
                  </button>
                  <button
                    type="button"
                    className="icon-button quiet workspace-look-star"
                    aria-pressed={isDefault}
                    aria-label={t(isDefault ? 'appearance.isDefault' : 'appearance.makeDefault', { name })}
                    title={t(isDefault ? 'appearance.isDefault' : 'appearance.makeDefault', { name })}
                    onClick={() => {
                      setMessage(null);
                      setDefaultWorkspace(isDefault ? null : workspace.id).catch(failed);
                    }}
                  >
                    <UiIcon name={isDefault ? 'starFilled' : 'star'} size="1.5em" />
                  </button>
                </li>
              );
            })}
          </ul>
          <fieldset className="workspace-look-themes">
            <legend>{t('appearance.themeFor', { name: selected.name })}</legend>
            <ThemeOptions
              name={`theme-${selected.id}`}
              current={canonicalThemeMode(workspacePreferences.themes[selected.id] ?? preferences.theme)}
              onPick={(value) => {
                setMessage(null);
                setWorkspaceTheme(selected.id, value).catch(failed);
              }}
            />
          </fieldset>
        </section>
      )}
    </>
  );
}
