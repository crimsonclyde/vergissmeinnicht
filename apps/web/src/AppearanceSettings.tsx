import { useEffect, useState } from 'react';
import type { WeatherLocation } from '@vergissmeinnicht/domain';
import { ApiError, api, messageFor, type WorkspaceSummary, type WorkspaceWeatherStatus } from './api.ts';
import { GuideSettingsForm } from './guide/GuideSettingsForm.tsx';
import { t } from './i18n/index.ts';
import { usePreferences } from './preferences.tsx';
import { Link, paths } from './router.tsx';
import { canonicalThemeMode } from './theme.ts';
import { ThemeOptions } from './ThemeOptions.tsx';
import { UiIcon } from './ui-icons.tsx';
import './appearance-settings.css';

/**
 * Account Appearance. With no Workspace, one account theme is set here. With Workspaces, one tab per Workspace holds
 * that Workspace's theme, its interface (navigation position, card background, opacity and images) and whether your
 * weather there uses the Workspace's shared location. Every choice is yours alone (section 28).
 */
export function AppearanceSettings({ workspaces = null }: { workspaces?: readonly WorkspaceSummary[] | null }) {
  const { preferences, update } = usePreferences();
  const [message, setMessage] = useState<string | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const failed = (caught: unknown) => setMessage(messageFor(caught));
  const picked = workspaces?.find((workspace) => workspace.id === pickedId) ?? workspaces?.[0] ?? null;
  return (
    <>
      {message !== null && <p role="alert">{message}</p>}
      {workspaces !== null && workspaces.length === 0 && (
        <fieldset title={t('appearance.savedToAccount')}>
          <legend>{t('appearance.legend')}</legend>
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
      {workspaces !== null && picked !== null && (
        <section className="interface-settings" aria-labelledby="interface-heading">
          <div className="appearance-heading">
            <h3 id="interface-heading">{t('appearance.pickWorkspace')}</h3>
            <details className="appearance-help">
              <summary aria-label={t('appearance.interface')} title={t('appearance.interface')}><UiIcon name="info" /></summary>
              <p>{t('appearance.interfaceHint')}</p>
            </details>
          </div>
          <div className="segmented appearance-workspaces" role="group" aria-label={t('appearance.pickWorkspace')}>
            {workspaces.map((workspace) => (
              <button key={workspace.id} type="button" aria-pressed={workspace.id === picked.id} onClick={() => setPickedId(workspace.id)}>
                {workspace.name}
              </button>
            ))}
          </div>
          <WorkspaceTheme key={`theme-${picked.id}`} workspaceId={picked.id} name={picked.name} />
          <GuideSettingsForm key={picked.id} workspaceId={picked.id} legend={t('appearance.interfaceFor', { name: picked.name })} />
          <WorkspaceWeather key={`weather-${picked.id}`} workspaceId={picked.id} name={picked.name} />
        </section>
      )}
    </>
  );
}

/** The theme of this Workspace and whether it is the default Workspace; each pick is saved at once. */
function WorkspaceTheme({ workspaceId, name }: { workspaceId: string; name: string }) {
  const { preferences, workspacePreferences, setWorkspaceTheme, setDefaultWorkspace } = usePreferences();
  const [message, setMessage] = useState<string | null>(null);
  const failed = (caught: unknown) => setMessage(messageFor(caught));
  const isDefault = workspacePreferences.defaultWorkspaceId === workspaceId;
  const defaultLabel = t(isDefault ? 'appearance.isDefault' : 'appearance.makeDefault', { name });
  return (
    <>
      {message !== null && <p role="alert">{message}</p>}
      <div className="appearance-heading">
        <h4><UiIcon name="appearance" /> {t('appearance.theme')}</h4>
        <button
          type="button"
          className="quiet icon-button appearance-icon-action"
          aria-label={defaultLabel}
          title={defaultLabel}
          aria-pressed={isDefault}
          onClick={() => {
            setMessage(null);
            setDefaultWorkspace(isDefault ? null : workspaceId).catch(failed);
          }}
        >
          <UiIcon name={isDefault ? 'starFilled' : 'star'} size={24} />
        </button>
      </div>
      <fieldset className="appearance-themes">
        <legend className="visually-hidden">{t('appearance.themeFor', { name })}</legend>
        <ThemeOptions
          name={`theme-${workspaceId}`}
          current={canonicalThemeMode(workspacePreferences.themes[workspaceId] ?? preferences.theme)}
          onPick={(value) => {
            setMessage(null);
            setWorkspaceTheme(workspaceId, value).catch(failed);
          }}
        />
      </fieldset>
    </>
  );
}

/**
 * Whether your weather in this Workspace uses the Workspace's shared location, and which place is used. Your own
 * place, provider and forecast are on the Weather page under Profile & settings.
 */
function WorkspaceWeather({ workspaceId, name }: { workspaceId: string; name: string }) {
  const [status, setStatus] = useState<WorkspaceWeatherStatus | null>(null);
  const [used, setUsed] = useState<WeatherLocation | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [off, setOff] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    api.myWeather(workspaceId).then(
      (found) => {
        if (!active) return;
        setStatus(found.workspaces.find((entry) => entry.id === workspaceId) ?? null);
        setUsed(found.settings.location);
        setLoaded(true);
      },
      (caught: unknown) => {
        if (!active) return;
        if (caught instanceof ApiError && caught.code === 'weather_off') setOff(true);
        else setMessage(messageFor(caught));
      },
    );
    return () => {
      active = false;
    };
  }, [workspaceId]);
  if (off) return <p className="muted">{t('weather.off')}</p>;
  if (!loaded) return message === null ? <p>{t('common.loading')}</p> : <p role="alert">{message}</p>;
  if (status === null) return null;
  const toggle = (enabled: boolean) => {
    setSaving(true);
    setMessage(null);
    api.setWorkspaceWeatherLocation(workspaceId, enabled).then(
      (result) => {
        setStatus(result.workspaces.find((entry) => entry.id === workspaceId) ?? status);
        setUsed(result.settings.location);
        window.dispatchEvent(new Event('vmn-location-changed'));
      },
      (caught: unknown) => setMessage(messageFor(caught)),
    ).finally(() => setSaving(false));
  };
  return (
    <fieldset className="appearance-weather" aria-label={t('appearance.weatherFor', { name })}>
      <legend><UiIcon name="weatherPartlyCloudy" /> {t('weather.heading')}</legend>
      {message !== null && <p role="alert">{message}</p>}
      <div className="appearance-weather-row">
        <label className="check-label" title={t(status.hasLocation ? 'weather.workspaceLocationHint' : 'weather.workspaces.noLocationHint')}>
          <input type="checkbox" aria-label={t('weather.useWorkspaceLocation')} checked={status.enabled} disabled={saving || !status.hasLocation} onChange={(event) => toggle(event.target.checked)} />
          <UiIcon name="place" /> <span>{t('appearance.workspaceLocation')}</span>
        </label>
        <Link className="button quiet icon-button appearance-icon-action" href={paths.account('weather')} aria-label={t('weather.forecastSettings')} title={t('weather.forecastSettings')}><UiIcon name="settings" size={24} /></Link>
      </div>
      {!status.hasLocation && <p className="muted">{t('weather.workspaces.noLocation')}</p>}
      <p className="appearance-location-value" title={t('weather.workspaces.used')}>
        {used === null ? <span className="muted">{t('weather.noPlace')}</span> : <span>{used.name}</span>}
      </p>
    </fieldset>
  );
}
