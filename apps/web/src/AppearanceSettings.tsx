import { useState, type CSSProperties } from 'react';
import { placeForTheme } from './places/registry.ts';
import { messageFor, type WorkspaceSummary } from './api.ts';
import { t } from './i18n/index.ts';
import { usePreferences } from './preferences.tsx';
import { THEME_MODES, canonicalThemeMode, isThemeMode } from './theme.ts';
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

/**
 * Theme choice, saved to the account (Step 8.7) so it follows the user to every device; and per
 * Workspace (section 28): the Workspace that opens first, and a theme that replaces the default there.
 */
export function AppearanceSettings({ workspaces = null }: { workspaces?: readonly WorkspaceSummary[] | null }) {
  const { preferences, update, workspacePreferences, setWorkspaceTheme, setDefaultWorkspace } = usePreferences();
  const [message, setMessage] = useState<string | null>(null);
  const failed = (caught: unknown) => setMessage(messageFor(caught));
  return (
    <>
      {message !== null && <p role="alert">{message}</p>}
      <fieldset>
        <legend>{t('appearance.legend')}</legend>
        <p className="muted" style={{ marginTop: 0 }}>
          {t('appearance.savedToAccount')}
        </p>
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
                  <input
                    type="radio"
                    name="theme"
                    value={value}
                    checked={canonicalThemeMode(preferences.theme) === value}
                    onChange={() => {
                      setMessage(null);
                      update({ theme: value }).catch(failed);
                    }}
                  />
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
      </fieldset>
      {workspaces !== null && workspaces.length > 0 && (
        <section className="workspace-looks" aria-labelledby="workspace-looks-heading">
          <h3 id="workspace-looks-heading">{t('appearance.workspaces')}</h3>
          <p className="muted">{t('appearance.workspacesHint')}</p>
          <ul className="workspace-look-list">
            {workspaces.map((workspace) => {
              const own = workspacePreferences.themes[workspace.id] ?? null;
              const isDefault = workspacePreferences.defaultWorkspaceId === workspace.id;
              const name = workspace.name;
              return (
                <li key={workspace.id} className="workspace-look">
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
                  <ThemeSwatch mode={canonicalThemeMode(own ?? preferences.theme)} mini />
                  <strong className="workspace-look-name">{name}</strong>
                  <select
                    aria-label={t('appearance.themeFor', { name })}
                    value={own === null ? '' : canonicalThemeMode(own)}
                    onChange={(event) => {
                      setMessage(null);
                      const value = event.target.value;
                      setWorkspaceTheme(workspace.id, isThemeMode(value) ? value : null).catch(failed);
                    }}
                  >
                    <option value="">
                      {t('appearance.useDefault', {
                        theme: t(`appearance.${canonicalThemeMode(preferences.theme)}`),
                      })}
                    </option>
                    {THEME_MODES.map((value) => (
                      <option key={value} value={value}>
                        {t(`appearance.${value}`)}
                      </option>
                    ))}
                  </select>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
