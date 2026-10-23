import { useEffect, useId, useState, type FormEvent } from 'react';
import type { WeatherLocation } from '@vergissmeinnicht/domain';
import { api, messageFor, type PlaceResult } from './api.ts';
import { t } from './i18n/index.ts';
import { browserTimeZone } from './schedule-dates.ts';

/** Shared optional metadata: no device lookup, search only on an explicit action. */
export function WorkspaceLocationCard({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) {
  const id = useId();
  const [saved, setSaved] = useState<WeatherLocation | null | undefined>(undefined);
  const [enabled, setEnabled] = useState(false);
  const [name, setName] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [timeZone, setTimeZone] = useState(browserTimeZone);
  const [elevation, setElevation] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<PlaceResult[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState(false);
  const [busy, setBusy] = useState(false);
  const choose = (place: WeatherLocation) => {
    setName(place.name); setLatitude(String(place.latitude)); setLongitude(String(place.longitude)); setTimeZone(place.timeZone); setElevation(place.elevation); setPlaces(null); setNotice(false);
  };
  useEffect(() => {
    let active = true;
    api.workspaceLocation(workspaceId).then((place) => {
      if (!active) return;
      setSaved(place); setEnabled(place !== null);
      if (place !== null) { setName(place.name); setLatitude(String(place.latitude)); setLongitude(String(place.longitude)); setTimeZone(place.timeZone); setElevation(place.elevation); }
    }, (caught: unknown) => { if (active) setMessage(messageFor(caught)); });
    return () => { active = false; };
  }, [workspaceId]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (saved === undefined) return;
    setBusy(true); setMessage(null); setNotice(false);
    try {
      const place = enabled ? { name, latitude: Number(latitude), longitude: Number(longitude), timeZone, elevation } : null;
      const result = await api.saveWorkspaceLocation(workspaceId, place, saved);
      setSaved(result); if (result !== null) choose(result); setNotice(true);
      window.dispatchEvent(new Event('vmn-location-changed'));
    } catch (caught) { setMessage(messageFor(caught)); }
    finally { setBusy(false); }
  }
  return <section className="card stack" aria-labelledby={`${id}-heading`}>
    <h3 id={`${id}-heading`}>{t('workspace.locationHeading')}</h3>
    <p className="muted">{t('workspace.locationPrivacy')}</p>
    {message !== null && <p role="alert">{message}</p>}
    {saved === undefined ? (message === null ? <p>{t('common.loading')}</p> : null) : canManage ? <form className="stack" onSubmit={(event) => void save(event)}>
      <fieldset disabled={busy} className="stack">
        <label className="row"><input type="checkbox" checked={enabled} onChange={(event) => { setEnabled(event.target.checked); setNotice(false); }} />{t('workspace.locationEnable')}</label>
        {enabled && <>
          <label htmlFor={`${id}-search`}>{t('weather.search')}</label>
          <div className="row"><input id={`${id}-search`} value={query} maxLength={80} onChange={(event) => setQuery(event.target.value)} /><button type="button" disabled={query.trim().length < 2} onClick={() => {
            setMessage(null); void api.searchPlaces(query, 'en').then(setPlaces, () => setMessage(t('workspace.locationSearchUnavailable')));
          }}>{t('weather.searchButton')}</button></div>
          {places !== null && <ul className="plain-list">{places.map((place, index) => <li key={index}><button type="button" className="quiet" onClick={() => choose(place)}>{place.name} · {place.context}</button></li>)}{places.length === 0 && <li>{t('weather.noResults')}</li>}</ul>}
          <label htmlFor={`${id}-name`}>{t('weather.name')}</label>
          <input id={`${id}-name`} value={name} maxLength={120} required onChange={(event) => { setName(event.target.value); setNotice(false); }} />
          <div className="weather-coordinates">
            <label>{t('weather.latitude')}<input type="number" value={latitude} required min={-90} max={90} step="any" onChange={(event) => { setLatitude(event.target.value); setNotice(false); }} /></label>
            <label>{t('weather.longitude')}<input type="number" value={longitude} required min={-180} max={180} step="any" onChange={(event) => { setLongitude(event.target.value); setNotice(false); }} /></label>
          </div>
          <label>{t('weather.elevation')}<input type="number" value={elevation ?? ''} min={-500} max={9000} step={1} onChange={(event) => { setElevation(event.target.value === '' ? null : Number(event.target.value)); setNotice(false); }} /></label>
          <label htmlFor={`${id}-zone`}>{t('weather.timeZone')}</label>
          <input id={`${id}-zone`} value={timeZone} required maxLength={64} onChange={(event) => { setTimeZone(event.target.value); setNotice(false); }} />
        </>}
        <button type="submit" className="primary">{t('workspace.locationSave')}</button>
      </fieldset>
      <p role="status">{notice ? t('workspace.locationSaved') : ''}</p>
    </form> : <p>{saved?.name ?? t('workspace.locationNone')}</p>}
  </section>;
}
