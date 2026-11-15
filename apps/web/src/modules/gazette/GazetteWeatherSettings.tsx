import { useEffect, useState } from 'react';
import { DEFAULT_GAZETTE_WEATHER_SETTINGS, GAZETTE_WEATHER_WEIGHT_MAX, LIGURIA_ALERT_ZONES, gazetteWeatherPlan, type GazetteWeatherSettings as WeatherSettings, type LiguriaAlertZone } from '@vergissmeinnicht/domain';
import { api, messageFor, type GazetteWeatherView } from '../../api.ts';
import { formatNumber, t } from '../../i18n/index.ts';
import { Link, paths } from '../../router.tsx';
import { UiIcon } from '../../ui-icons.tsx';

/**
 * The Daily Planet's weather settings (43.7), part of the Gazette settings form: the place is the
 * Workspace location (shown, changed only where it lives); sources can be switched off or weighted;
 * Liguria's alert zone can be set when the place name is not a municipality.
 */
export function GazetteWeatherSettings({ workspaceId, value, onChange }: { workspaceId: string; value: WeatherSettings | undefined; onChange: (next: WeatherSettings) => void }) {
  const [view, setView] = useState<GazetteWeatherView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.gazetteWeather(workspaceId).then(loaded => { if (live) setView(loaded); }, (caught: unknown) => { if (live) setError(messageFor(caught)); });
    return () => { live = false; };
  }, [workspaceId]);
  const settings = value ?? DEFAULT_GAZETTE_WEATHER_SETTINGS;
  const place = view?.place ?? null;
  const plan = place === null ? null : gazetteWeatherPlan(place, settings);
  const setSource = (id: string, next: { enabled?: boolean; weight?: number }) => {
    const current = plan?.sources.find(source => source.id === id);
    if (!current) return;
    const others = settings.sources.filter(source => source.id !== id);
    onChange({ ...settings, sources: [...others, { id, enabled: next.enabled ?? current.enabled, weight: next.weight ?? current.baseWeight }] });
  };
  const skill = (id: string) => view?.verification?.skills.filter(row => row.sourceId === id && row.samples > 0) ?? [];

  return (
    <fieldset className="card gazette-admin-card gazette-weather-settings">
      <legend>{t('gazette.weatherSettings')}</legend>
      {error && <p role="alert" className="gazette-chip gazette-chip-warn">{error}</p>}
      <div className="gazette-weather-place">
        <UiIcon name="place" />
        {view === null ? <span className="muted">{t('common.loading')}</span> : place === null
          ? <span>{t('gazette.weatherNoLocation')}</span>
          : <span><b>{place.name}</b><small className="muted">{[`${formatNumber(place.latitude, 2)}, ${formatNumber(place.longitude, 2)}`, place.elevation === null ? '' : `${formatNumber(place.elevation)} m`, place.timeZone, plan ? t(`gazette.region.${plan.region}`) : ''].filter(Boolean).join(' · ')}</small></span>}
        <Link href={paths.members(workspaceId)} className="icon-button" aria-label={t('gazette.changeLocation')} title={t('gazette.changeLocation')}><UiIcon name="edit" /></Link>
      </div>
      <label className="row"><input type="checkbox" checked={settings.automatic} onChange={event => onChange({ ...settings, automatic: event.target.checked })} />{t('gazette.weatherAutomatic')}</label>
      {plan !== null && settings.automatic && <>
        <ul className="plain-list gazette-weather-sources">
          {plan.sources.map(source => (
            <li key={source.id} className={source.enabled ? undefined : 'gazette-admin-off'}>
              <button type="button" className="icon-button" aria-pressed={source.enabled} aria-label={t(source.enabled ? 'gazette.sourceOff' : 'gazette.sourceOn', { name: source.label })} title={t(source.enabled ? 'gazette.sourceOff' : 'gazette.sourceOn', { name: source.label })} onClick={() => setSource(source.id, { enabled: !source.enabled })}><UiIcon name={source.enabled ? 'gazetteShown' : 'gazetteHidden'} /></button>
              <span className="gazette-admin-name">
                <b>{source.label}</b>
                <small className="muted">{t(source.role === 'warnings' ? 'gazette.roleWarnings' : 'gazette.roleForecast')} · {t('gazette.family', { family: source.family })}{source.role === 'forecast' ? ` · ${t('gazette.horizon', { count: source.days })}` : ''}
                  {skill(source.id).map(row => ` · ${t(`gazette.bucket.${row.bucket}`)} ${row.maeC === null ? '–' : `±${formatNumber(row.maeC, 1)} °C`} (${row.samples})`).join('')}</small>
              </span>
              {source.role === 'forecast' && <label className="gazette-weight">
                <span className="visually-hidden">{t('gazette.weight', { name: source.label })}</span>
                <input type="range" min="0.25" max={GAZETTE_WEATHER_WEIGHT_MAX} step="0.25" value={source.baseWeight} disabled={!source.enabled} aria-label={t('gazette.weight', { name: source.label })} onChange={event => setSource(source.id, { weight: Number(event.target.value) })} />
                <output>×{formatNumber(source.baseWeight, 2)}</output>
              </label>}
            </li>
          ))}
        </ul>
        {plan.region === 'liguria' && <label>{t('gazette.alertZone')}
          <select value={settings.alertZone ?? ''} onChange={event => onChange({ ...settings, alertZone: event.target.value === '' ? null : event.target.value as LiguriaAlertZone })}>
            <option value="">{t('gazette.alertZoneAuto', { zone: plan.alertZone ?? '–' })}</option>
            {LIGURIA_ALERT_ZONES.map(zone => <option key={zone} value={zone}>{t('gazette.alertZoneOption', { zone })}</option>)}
          </select>
        </label>}
        <label className="row"><input type="checkbox" checked={settings.learn} onChange={event => onChange({ ...settings, learn: event.target.checked })} />{t('gazette.weatherLearn')}</label>
        <p className="muted gazette-admin-note">{view?.verification && view.verification.observedDays > 0
          ? t('gazette.verifiedWith', { count: view.verification.observedDays, stations: view.verification.stations.map(s => `${s.station} (${formatNumber(s.distanceM / 1000, 0)} km)`).join(', ') })
          : t(plan.region === 'germany' ? 'gazette.verifyPending' : 'gazette.verifyNone')}</p>
      </>}
    </fieldset>
  );
}
