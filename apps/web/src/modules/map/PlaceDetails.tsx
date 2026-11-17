import { useEffect, useRef, useState, type FormEvent } from 'react';
import { EMPTY_MAP_PERSONAL_STATE, type MapPlace, type MapPersonalState } from '@vergissmeinnicht/domain';
import { mapApi, mapPhotoUrl, messageFor } from '../../api.ts';
import { formatCalendarDate, t } from '../../i18n/index.ts';
import { UiIcon } from '../../ui-icons.tsx';
import { categoryIcon, coordinate, direction, pointLabel } from './map-view.ts';

export function PlaceGo({ place }: { place: MapPlace }) {
  const action = direction(place);
  return action ? <a className="button primary" href={action.url} rel="noopener noreferrer" target="_blank">{action.label}</a> : null;
}
export function AccessWarning({ place }: { place: MapPlace }) {
  const { details, sharedApproach } = place;
  const route = details.routeAccess || sharedApproach?.routeAccess;
  if (!details.hazards && !route && !details.buildingAccess) return null;
  return <div className="vmn-map-warning" role="note">
    {details.hazards && <p><strong>{t('map.reportedHazards')}</strong> · {details.hazards} · {details.conditionsCheckedOn ? formatCalendarDate(details.conditionsCheckedOn) : t('map.conditionsUnknown')}</p>}
    {route && <p><strong>{t('map.routeAccess')}</strong> · {route}</p>}
    {details.buildingAccess && <p><strong>{t('map.buildingAccess')}</strong> · {details.buildingAccess}</p>}
  </div>;
}

function Coordinates({ place, close }: { place: MapPlace; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState('');
  useEffect(() => { ref.current?.showModal(); }, []);
  async function copy(point: string, code: HTMLElement | null) {
    try {
      await navigator.clipboard.writeText(point);
      setStatus(t('map.copied'));
    } catch {
      if (code) {
        const range = document.createRange();
        range.selectNodeContents(code);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      }
      setStatus(t('map.copyFallback'));
    }
  }
  return <dialog className="vmn-map-dialog" ref={ref} onClose={close} aria-labelledby="vmn-map-coordinate-heading">
    <h3 id="vmn-map-coordinate-heading">{t('map.coordinates')}</h3>
    <p>{t('map.latLon')}</p>
    {place.points.map(point => <div className="vmn-map-point-row" key={point.id + ':' + point.role}>
      <span><strong>{pointLabel(point)} · {point.label}</strong><br /><code>{coordinate(point)}</code><br />{t(`map.precision.${point.precision}`)}</span>
      <button type="button" onClick={event => void copy(coordinate(point), event.currentTarget.previousElementSibling?.querySelector('code') ?? null)}>{t('map.copy')}</button>
    </div>)}
    <p role="status">{status}</p>
    <button type="button" onClick={() => ref.current?.close()}>{t('common.close')}</button>
  </dialog>;
}

function PersonalVisits({ workspaceId, id, changed }: { workspaceId: string; id: string; changed: () => void }) {
  const [state, setState] = useState<MapPersonalState>(EMPTY_MAP_PERSONAL_STATE);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [rating, setRating] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const photoInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    void mapApi.personal(workspaceId, id).then(result => {
      if (active) { setState(result); setLoaded(true); }
    }, issue => { if (active) setError(messageFor(issue)); });
    return () => { active = false; };
  }, [id, workspaceId]);
  async function flags(favorite: boolean, want: boolean) {
    setError(''); setBusy(true);
    try { setState(await mapApi.setPersonal(workspaceId, id, favorite, want)); changed(); }
    catch (issue) { setError(messageFor(issue)); }
    finally { setBusy(false); }
  }
  async function visit(event: FormEvent) {
    event.preventDefault();
    setError(''); setBusy(true);
    try {
      const photoIds: string[] = [];
      for (const photo of photos) photoIds.push((await mapApi.upload(workspaceId, photo, 'visit')).id);
      setState(await mapApi.visit(workspaceId, id, { date: date || null, note, rating: rating ? Number(rating) : null, photoIds }));
      setPhotos([]);
      if (photoInput.current) photoInput.current.value = '';
      setDate(''); setNote(''); setRating('');
    } catch (issue) { setError(messageFor(issue)); }
    finally { setBusy(false); }
  }
  return <details className="card vmn-map-fold">
    <summary>{t('map.myVisit')}{state.visits.length > 0 ? ' · ' + t('map.visited') : ''}</summary>
    {error && <p role="alert">{error}</p>}
    {loaded && <>
      <div className="vmn-map-actions">
        <button type="button" aria-pressed={state.want} disabled={busy} onClick={() => void flags(state.favorite, !state.want)}>{t('map.want')}</button>
        <button type="button" aria-pressed={state.favorite} disabled={busy} onClick={() => void flags(!state.favorite, state.want)}>{t('map.favorite')}</button>
      </div>
      <form className="vmn-map-editor-fields" onSubmit={event => void visit(event)}>
        <div className="vmn-map-two">
          <label>{t('map.visitDate')}<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
          <label>{t('map.rating')}<select value={rating} onChange={event => setRating(event.target.value)}>
            <option value="">{t('map.unrated')}</option>{[1, 2, 3, 4, 5].map(value => <option key={value}>{value}</option>)}
          </select></label>
        </div>
        <label>{t('map.note')}<textarea value={note} maxLength={4000} onChange={event => setNote(event.target.value)} /></label>
        <label>{t('map.visitPhotos')}<input ref={photoInput} type="file" accept="image/jpeg,image/png" multiple disabled={busy} onChange={event => {
          const selection = Array.from(event.target.files ?? []);
          if (selection.length > 6) { setError(t('map.photoLimit')); event.target.value = ''; setPhotos([]); }
          else { setError(''); setPhotos(selection); }
        }} /></label>
        <button className="button" type="submit" disabled={busy}>{t('map.recordVisit')}</button>
      </form>
      {state.visits.length > 0 && <ul className="vmn-map-visits">{state.visits.map(item => <li key={item.id}>
        <strong>{item.date ? formatCalendarDate(item.date) : t('map.visitedUnknown')}</strong>
        {item.rating !== null && <span> · {t('map.rated', { rating: item.rating })}</span>}
        {item.note && <p>{item.note}</p>}
        {item.photoIds.length > 0 && <div className="vmn-map-actions">{item.photoIds.map(photo => <a key={photo}
          href={mapPhotoUrl(workspaceId, id, photo, 'visit', 'preview')} target="_blank" rel="noopener noreferrer" aria-label={t('map.openPhoto')}>
          <img className="vmn-map-visit-photo" alt="" src={mapPhotoUrl(workspaceId, id, photo, 'visit', 'thumbnail')} loading="lazy" />
        </a>)}</div>}
      </li>)}</ul>}
    </>}
  </details>;
}

interface Props {
  place: MapPlace; workspaceId: string; canEdit: boolean; canVisit: boolean; busy: boolean;
  onBack: () => void; onEdit: () => void; onArchive: () => void; onPersonalChanged: () => void;
}
export function PlaceDetails({ place, workspaceId, canEdit, canVisit, busy, onBack, onEdit, onArchive, onPersonalChanged }: Props) {
  const [coordinates, setCoordinates] = useState(false);
  const { details, sharedApproach } = place;
  const approach = details.approach || sharedApproach?.description;
  const walkMinutes = details.walkMinutes ?? sharedApproach?.walkMinutes ?? null;
  const walkMeters = details.walkMeters ?? sharedApproach?.walkMeters ?? null;
  const terrain = details.terrain || sharedApproach?.terrain;
  const routeAccess = details.routeAccess || sharedApproach?.routeAccess;
  const accessCheckedOn = details.conditionsCheckedOn || sharedApproach?.checkedOn;
  return <section className="vmn-map-detail">
    <div><button type="button" onClick={onBack} autoFocus>{t('map.back')}</button></div>
    <div className="card vmn-map-hero">
      <div className="vmn-map-illustration">{place.coverId && !place.archived
        ? <img alt="" src={mapPhotoUrl(workspaceId, place.id, place.coverId, 'cover', 'preview')} />
        : <UiIcon name={categoryIcon[place.category]} />}</div>
      <div>
        <p className="muted">{[t(`map.category.${place.category}`), details.locality].filter(Boolean).join(' · ')}</p>
        <h2>{place.name}</h2>
        {details.description && <p>{details.description}</p>}
        {place.tags.length > 0 && <ul className="vmn-map-chips">{place.tags.map(tag => <li key={tag.id}>{tag.name}</li>)}</ul>}
        <div className="vmn-map-actions">
          {!place.archived && <PlaceGo place={place} />}
          {place.points.length > 0 && <button type="button" onClick={() => setCoordinates(true)}>{t('map.coordinates')}</button>}
          {canEdit && <button type="button" disabled={busy} onClick={onEdit}>{t('map.edit')}</button>}
          {canEdit && <button type="button" disabled={busy} onClick={onArchive}>{t(place.archived ? 'map.restore' : 'map.archive')}</button>}
        </div>
      </div>
    </div>
    <AccessWarning place={place} />
    <details className="card vmn-map-fold">
      <summary>{t('map.gettingThere')}</summary>
      {!place.points.some(point => point.role === 'destination') && <p>{t('map.unknownPin')}</p>}
      {place.points.map(point => <p key={point.id + ':' + point.role}>{pointLabel(point)} · {point.label}
        {point.precision === 'approximate' ? ' · ' + t('map.precision.approximate') : ''}{point.provenance && ' · ' + point.provenance}</p>)}
      {details.address && <p>{details.address}</p>}
      {sharedApproach && <p><strong>{sharedApproach.name}</strong></p>}
      {approach && <p>{approach}</p>}
      {walkMinutes !== null && <p>{t('map.walkTime', { minutes: walkMinutes })}</p>}
      {walkMeters !== null && <p>{t('map.walkDistance', { meters: walkMeters })}</p>}
      {terrain && <p>{terrain}</p>}
    </details>
    {(details.website || details.hours) && <details className="card vmn-map-fold"><summary>{t('map.practical')}</summary>
      {details.website && <p><a href={details.website} rel="noopener noreferrer" target="_blank">{t('map.website')}</a></p>}
      {details.hours && <p>{details.hours} · {details.hoursCheckedOn ? formatCalendarDate(details.hoursCheckedOn) : t('map.conditionsUnknown')}</p>}
    </details>}
    {(routeAccess || details.buildingAccess || details.hazards || approach) && <details className="card vmn-map-fold"><summary>{t('map.access')}</summary>
      <p><strong>{t('map.routeAccess')}</strong> · {routeAccess || t('map.unknown')}</p>
      <p><strong>{t('map.buildingAccess')}</strong> · {details.buildingAccess || t('map.unknown')}</p>
      {details.hazards && <p>{details.hazards}</p>}
      <p>{accessCheckedOn ? formatCalendarDate(accessCheckedOn) : t('map.conditionsUnknown')}</p>
    </details>}
    {(details.originalUrl || details.sources.length > 0 || sharedApproach?.sourceUrl) && <details className="card vmn-map-fold"><summary>{t('map.sources')}</summary>
      {details.originalUrl && <p><a href={details.originalUrl} rel="noopener noreferrer" target="_blank">{t('map.originalLink')}</a></p>}
      {sharedApproach?.sourceUrl && <p><a href={sharedApproach.sourceUrl} rel="noopener noreferrer" target="_blank">{sharedApproach.name} · {t('map.sourceLink')}</a></p>}
      {details.sources.map((source, index) => <div key={source.url + index}>
        <a href={source.url} rel="noopener noreferrer" target="_blank">{source.title || source.publisher || t('map.sourceLink')}</a>
        <p>{[source.supports, source.checkedOn ? formatCalendarDate(source.checkedOn) : ''].filter(Boolean).join(' · ')}</p>
      </div>)}
    </details>}
    {canVisit && !place.archived && <PersonalVisits key={place.id} workspaceId={workspaceId} id={place.id} changed={onPersonalChanged} />}
    {coordinates && <Coordinates place={place} close={() => setCoordinates(false)} />}
  </section>;
}
