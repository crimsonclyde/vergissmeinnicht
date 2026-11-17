import { useEffect, useState, type FormEvent } from 'react';
import { api, messageFor, type MapDownloadArea, type MapDownloadStatus } from './api.ts';
import { formatDateTime, t } from './i18n/index.ts';

const TRIORA: MapDownloadArea = { name: 'Triora, Italy', latitude: 43.99252, longitude: 7.76624, radiusKm: 100 };
export function MapDataAdmin() {
  const [status, setStatus] = useState<MapDownloadStatus | null>(null);
  const [area, setArea] = useState<MapDownloadArea>(TRIORA);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Omit<MapDownloadArea, 'radiusKm'>[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const job = status?.job;
  const downloading = job?.state === 'downloading';
  useEffect(() => {
    let active = true;
    api.mapData().then(value => {
      if (active) { setStatus(value); if (value.installed) setArea(value.installed.area); }
    }, (e: unknown) => { if (active) setError(messageFor(e)); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!downloading) return;
    let active = true;
    const timer = setInterval(() => {
      api.mapData().then(value => { if (active) { setStatus(value); setError(null); } }, (e: unknown) => { if (active) setError(messageFor(e)); });
    }, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [downloading]);
  async function find(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try { setResults((await api.mapDataPlaces(search)).places); }
    catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  }
  async function download(next: MapDownloadArea) {
    setBusy(true); setError(null);
    try { const value = await api.downloadMap(next, status?.installed?.id ?? null); setStatus({ ...value, available: true }); }
    catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  }
  async function cancel() {
    setBusy(true); setError(null);
    try { const value = await api.cancelMapDownload(); setStatus({ ...value, available: true }); }
    catch (e) { setError(messageFor(e)); } finally { setBusy(false); }
  }
  const installed = status?.installed;
  const sameArea = installed && installed.area.latitude === area.latitude && installed.area.longitude === area.longitude && installed.area.radiusKm === area.radiusKm;
  return <section className="card stack" aria-labelledby="map-data-heading">
    <h3 id="map-data-heading">{t('mapData.heading')}</h3>
    <p>{t('mapData.lead')}</p>
    {error && <p role="alert">{error}</p>}
    {!status ? <p>{t('common.loading')}</p> : !status.available ? <p>{t('mapData.unavailable')}</p> : <>
      {installed ? <section className="stack" aria-labelledby="map-data-current">
        <h4 id="map-data-current">{t('mapData.current')}</h4>
        <strong>{t('mapData.selection', { name: installed.area.name, radius: installed.area.radiusKm })}</strong>
        <p className="muted">{t('mapData.build', { date: `${installed.build.slice(0, 4)}-${installed.build.slice(4, 6)}-${installed.build.slice(6)}` })}</p>
        <p className="muted">{t('mapData.installedAt', { date: formatDateTime(installed.installedAt) })}</p>
      </section> : <p>{t('mapData.none')}</p>}
      {job?.state === 'downloading' && <div className="stack">
        <p role="status">{t('mapData.progress', { name: job.area.name, percent: job.percent })}</p>
        <progress max={100} value={job.percent} aria-label={t('mapData.progress', { name: job.area.name, percent: job.percent })} />
        <p className="muted">{t('mapData.background')}</p>
        <button type="button" disabled={busy} onClick={() => void cancel()}>{t('mapData.cancel')}</button>
      </div>}
      {status.job?.state === 'failed' && <p role="alert">{t('mapData.failed')}</p>}
      {status.job?.state === 'cancelled' && <p role="status">{t('mapData.cancelled')}</p>}
      {status.job?.state === 'installed' && <p role="status">{t('mapData.success')}</p>}
      <details className="option-group">
        <summary>{t('mapData.chooseTown')}</summary>
      <form className="stack" onSubmit={find}>
        <label htmlFor="map-town-search">{t('mapData.search')}</label>
        <input id="map-town-search" type="search" minLength={2} maxLength={100} required value={search} onChange={e => setSearch(e.target.value)} disabled={busy || downloading} />
        <button type="submit" disabled={busy || downloading}>{t('mapData.find')}</button>
      </form>
      {results && <fieldset disabled={busy || downloading}>
        <legend>{t('mapData.results')}</legend>
        {results.length === 0 && <p>{t('mapData.noResults')}</p>}
        {results.map((place, index) => <label className="row" key={index}>
          <input type="radio" name="map-area" checked={area.latitude === place.latitude && area.longitude === place.longitude}
            onChange={() => setArea({ ...place, radiusKm: area.radiusKm })} />{place.name}
        </label>)}
      </fieldset>}
      <button type="button" className="quiet" disabled={busy || downloading} onClick={() => setArea({ ...TRIORA, radiusKm: area.radiusKm })}>{t('mapData.triora')}</button>
      </details>
      <p><strong>{t('mapData.selection', { name: area.name, radius: area.radiusKm })}</strong></p>
      <label htmlFor="map-area-radius">{t('mapData.radius')}</label>
      <div><select id="map-area-radius" value={area.radiusKm} disabled={busy || downloading} onChange={e => setArea({ ...area, radiusKm: Number(e.target.value) })}>
        {[10, 25, 50, 100, 200].map(radius => <option value={radius} key={radius}>{t('mapData.km', { radius })}</option>)}
      </select></div>
      <details className="option-group">
        <summary>{t('mapData.details')}</summary>
        <p className="muted">{t('mapData.sizeHint')}</p>
        <p className="muted">{t('mapData.privacy')}</p>
      </details>
      <button type="button" className="primary" disabled={busy || downloading} onClick={() => void download(area)}>
        {t(!installed ? 'mapData.download' : sameArea ? 'mapData.update' : 'mapData.replace')}
      </button>
    </>}
  </section>;
}
