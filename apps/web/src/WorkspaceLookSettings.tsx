import { useState } from 'react';
import { messageFor } from './api.ts';
import { t, type MessageKey } from './i18n/index.ts';
import { usePreferences } from './preferences.tsx';
import { canonicalThemeMode } from './theme.ts';
import { ThemeOptions } from './ThemeOptions.tsx';
import { UiIcon } from './ui-icons.tsx';
import { WeatherSettings } from './WeatherSettings.tsx';
import type { WorkspaceContext } from './workspace-context.ts';

const LOOK_TABS = ['theme', 'weather'] as const;
type LookTab = (typeof LOOK_TABS)[number];

const TAB_LABEL = { theme: 'look.theme', weather: 'look.weather' } as const satisfies Record<LookTab, MessageKey>;

/** The theme of this Workspace and whether it is the default Workspace; each pick is saved at once. */
function ThemeSettings({ context }: { context: WorkspaceContext }) {
  const { preferences, workspacePreferences, setWorkspaceTheme, setDefaultWorkspace } = usePreferences();
  const [message, setMessage] = useState<string | null>(null);
  const failed = (caught: unknown) => setMessage(messageFor(caught));
  const { id, name } = context.workspace;
  const isDefault = workspacePreferences.defaultWorkspaceId === id;
  const defaultLabel = t(isDefault ? 'appearance.isDefault' : 'appearance.makeDefault', { name });
  return (
    <>
      {message !== null && <p role="alert">{message}</p>}
      <p>
        <button
          type="button"
          className="quiet"
          aria-pressed={isDefault}
          onClick={() => {
            setMessage(null);
            setDefaultWorkspace(isDefault ? null : id).catch(failed);
          }}
        >
          <UiIcon name={isDefault ? 'starFilled' : 'star'} size="1.2em" /> {defaultLabel}
        </button>
      </p>
      <fieldset>
        <legend>{t('appearance.themeFor', { name })}</legend>
        <ThemeOptions
          name={`theme-${id}`}
          current={canonicalThemeMode(workspacePreferences.themes[id] ?? preferences.theme)}
          onPick={(value) => {
            setMessage(null);
            setWorkspaceTheme(id, value).catch(failed);
          }}
        />
      </fieldset>
    </>
  );
}

/**
 * The Look and layout page of one Workspace (section 28): theme and weather. The Guide layout and card settings are
 * set on the account Appearance page. Only the open tab is mounted.
 */
export function WorkspaceLookSettings({ context }: { context: WorkspaceContext }) {
  const [tab, setTab] = useState<LookTab>('theme');
  return (
    <>
      <p className="muted">{t('look.hint')}</p>
      <div className="segmented" role="group" aria-label={t('look.tabs')}>
        {LOOK_TABS.map((key) => (
          <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)}>
            {t(TAB_LABEL[key])}
          </button>
        ))}
      </div>
      {tab === 'theme' && <ThemeSettings context={context} />}
      {tab === 'weather' && <WeatherSettings />}
    </>
  );
}
