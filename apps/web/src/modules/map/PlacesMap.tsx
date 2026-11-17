import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { MAP_CATEGORIES, type MapApproach, type MapCategory, type MapPointFields, type MapPlace, type MapPlaceInput, type MapPoint, type MapTag } from '@vergissmeinnicht/domain';
import { api, mapApi, mapPhotoUrl, messageFor } from '../../api.ts';
import { t } from '../../i18n/index.ts';
import { UiIcon } from '../../ui-icons.tsx';
import type { Viewport } from './MapCanvas.tsx';
import { MapImport } from './MapImport.tsx';
import { AccessWarning, PlaceDetails, PlaceGo } from './PlaceDetails.tsx';
import { PlaceEditor } from './PlaceEditor.tsx';
import { categoryIcon, coordinate, editDraft, preferredPoint } from './map-view.ts';
import './places-map.css';

const MapCanvas = lazy(() => import('./MapCanvas.tsx').then(module => ({ default: module.MapCanvas })));
const START: Viewport = { center: [10, 47], zoom: 4 };
const unique = (entries: MapPlace[]) => [...new Map(entries.map(entry => [entry.id, entry])).values()];
type Screen = 'browse' | 'detail' | 'edit' | 'import';
interface Props { workspaceId: string; canEdit: boolean; canVisit: boolean; canManage: boolean }

function Taxonomy({ workspaceId, tags, changed }: { workspaceId: string; tags: MapTag[]; changed: () => void }) {
  const [editing, setEditing] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError('');
    try { await mapApi.tag(workspaceId, name, editing || undefined); setName(''); setEditing(''); changed(); }
    catch (issue) { setError(messageFor(issue)); }
    finally { setBusy(false); }
  }
  return <details className="card vmn-map-fold">
    <summary>{t('map.manageTags')}</summary>
    <form className="vmn-map-editor-fields" onSubmit={event => void save(event)}>
      <label>{t('map.tags')}<select value={editing} onChange={event => { setEditing(event.target.value); setName(tags.find(tag => tag.id === event.target.value)?.name ?? ''); }}>
        <option value="">{t('map.newTag')}</option>{tags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
      </select></label>
      <label>{t('map.name')}<input required maxLength={60} value={name} onChange={event => setName(event.target.value)} /></label>
      <button type="submit" disabled={busy || !name.trim()}>{t('map.saveTag')}</button>
    </form>
    {error && <p role="alert">{error}</p>}
  </details>;
}

function Thumbnail({ place, workspaceId }: { place: MapPlace; workspaceId: string }) {
  return <span className="vmn-map-place-icon">{place.coverId && !place.archived
    ? <img alt="" loading="lazy" src={mapPhotoUrl(workspaceId, place.id, place.coverId, 'cover', 'thumbnail')} />
    : <UiIcon name={categoryIcon[place.category]} />}</span>;
}
function PlaceRow({ place, workspaceId, selected, onSelect }: { place: MapPlace; workspaceId: string; selected: boolean; onSelect: () => void }) {
  const point = place.points.find(item => item.role === 'destination');
  const detail = place.details.hazards ? t('map.reportedHazards') : place.details.hours || place.tags[0]?.name
    || (!point ? t('map.unknownPin') : point.precision === 'approximate' ? t('map.precision.approximate') : place.details.approach);
  return <button className="vmn-map-place-row" type="button" aria-pressed={selected} onClick={onSelect}>
    <Thumbnail place={place} workspaceId={workspaceId} />
    <span><strong>{place.name}</strong><small>{[t(`map.category.${place.category}`), place.details.locality].filter(Boolean).join(' · ')}</small>
      {detail && <small>{detail}</small>}</span>
  </button>;
}

export default function PlacesMap({ workspaceId, canEdit, canVisit, canManage }: Props) {
  const [screen, setScreen] = useState<Screen>('browse');
  const [phone, setPhone] = useState<'map' | 'list'>('map');
  const [places, setPlaces] = useState<MapPlace[]>([]);
  const [markers, setMarkers] = useState<MapPlace[]>([]);
  const [tags, setTags] = useState<MapTag[]>([]);
  const [towns, setTowns] = useState<string[]>([]);
  const [approaches, setApproaches] = useState<Pick<MapApproach, 'id' | 'name'>[]>([]);
  const [sharedPoints, setSharedPoints] = useState<(MapPointFields & { id: string })[]>([]);
  const [selected, setSelected] = useState<MapPlace | null>(null);
  const [edit, setEdit] = useState<MapPlace | null>(null);
  const [search, setSearch] = useState('');
  const [locality, setLocality] = useState('');
  const [category, setCategory] = useState<MapCategory | ''>('');
  const [tag, setTag] = useState('');
  const [want, setWant] = useState(false);
  const [favorite, setFavorite] = useState(false);
  const [archived, setArchived] = useState(false);
  const [bounds, setBounds] = useState('');
  const [focus, setFocus] = useState<MapPoint | null>(null);
  const [view, setView] = useState<Viewport>(START);
  const [mapInitialized, setMapInitialized] = useState(false);
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [picking, setPicking] = useState(false);
  const [dropped, setDropped] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const townToCenter = useRef('');
  const saveRequest = useRef<{ fingerprint: string; id: string } | null>(null);
  const reload = () => { setOffset(0); setRefresh(value => value + 1); };
  const query = new URLSearchParams();
  if (search.trim()) query.set('search', search.trim());
  if (locality) query.set('town', locality);
  if (category) query.set('category', category);
  if (tag) query.set('tagId', tag);
  if (want) query.set('want', 'true');
  if (favorite) query.set('favorite', 'true');
  if (archived) query.set('archived', 'true');
  const filters = query.toString();
  const activeFilters = Number(Boolean(category)) + Number(Boolean(tag)) + Number(archived);
  const knownLocalities = towns;
  useEffect(() => {
    let active = true;
    void api.workspaceLocation(workspaceId).then(location => {
      if (active && location) setView({ center: [location.longitude, location.latitude], zoom: 12 });
    }).catch(() => {}).finally(() => { if (active) setMapInitialized(true); });
    return () => { active = false; };
  }, [workspaceId]);
  useEffect(() => {
    const controller = new AbortController();
    const parameters = new URLSearchParams(filters);
    if (offset) parameters.set('offset', String(offset));
    const timer = window.setTimeout(() => {
      void mapApi.browse(workspaceId, parameters, controller.signal).then(result => {
        if (controller.signal.aborted) return;
        setPlaces(current => offset ? unique([...current, ...result.places]) : result.places);
        const town = townToCenter.current;
        if (town) {
          const entry = result.places.find(place => place.details.locality === town && preferredPoint(place));
          const point = entry && preferredPoint(entry);
          if (point) { setPhone('map'); setFocus({ ...point }); }
          townToCenter.current = '';
        }
        setTags(result.tags); setTowns(result.towns); setApproaches(result.approaches); setSharedPoints(result.sharedPoints); setNextOffset(result.nextOffset); setLoaded(true);
      }, issue => { if (!controller.signal.aborted) { setError(messageFor(issue)); setLoaded(true); } });
    }, 120);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [workspaceId, filters, refresh, offset]);
  useEffect(() => {
    if (!bounds) return;
    const controller = new AbortController();
    const params = new URLSearchParams(filters);
    params.set('bounds', bounds);
    void mapApi.browse(workspaceId, params, controller.signal).then(result => {
      if (!controller.signal.aborted) setMarkers(result.places);
    }, issue => { if (!controller.signal.aborted) setError(messageFor(issue)); });
    return () => controller.abort();
  }, [workspaceId, bounds, filters, refresh]);
  function choose(place: MapPlace, fromPin: boolean) {
    setSelected(place);
    if (!fromPin) {
      const point = place.points.find(item => item.role === 'destination') ?? preferredPoint(place);
      if (point) setFocus({ ...point });
    }
  }
  function selectPin(id: string) {
    const place = markers.find(entry => entry.id === id);
    if (place) choose(place, true);
  }
  function showDetail(place: MapPlace) { setSelected(place); setScreen('detail'); setError(''); }
  function openEditor(place: MapPlace | null) {
    setEdit(place); setDropped(''); setError(''); setScreen('edit'); saveRequest.current = null;
  }
  function back() { setPicking(false); setError(''); setScreen('browse'); }
  function clear() {
    setSearch(''); setLocality(''); setCategory(''); setTag(''); setFavorite(false); setWant(false); setArchived(false); setOffset(0); setError('');
  }
  function centerTown(town: string) {
    setLocality(town); setSearch(''); setOffset(0);
    townToCenter.current = town;
  }
  async function saved(id: string, isArchived = false) {
    reload();
    try { showDetail(await mapApi.place(workspaceId, id, isArchived)); }
    catch (issue) { back(); setError(messageFor(issue)); }
  }
  async function save(draft: MapPlaceInput, existing: MapPlace | null, isArchived?: boolean) {
    setBusy(true); setError('');
    const fingerprint = JSON.stringify([draft, existing?.id, existing?.revision, isArchived]);
    if (saveRequest.current?.fingerprint !== fingerprint) saveRequest.current = { fingerprint, id: crypto.randomUUID() };
    try {
      const { id } = await mapApi.save(workspaceId, draft, saveRequest.current.id, existing ?? undefined, isArchived);
      await saved(id, isArchived ?? existing?.archived);
    } catch (issue) { setError(messageFor(issue)); }
    finally { setBusy(false); }
  }
  const editing = screen === 'edit';
  const browsing = screen === 'browse' || picking;
  return <section className="vmn-places-map">
    <header className="vmn-map-heading">
      <h1>{t('map.heading')}</h1>
      {screen === 'browse' && canEdit && <div className="vmn-map-actions">
        <button type="button" onClick={() => { setError(''); setScreen('import'); }}>{t('map.importPreview')}</button>
        <button type="button" className="primary" onClick={() => openEditor(null)}><UiIcon name="add" /> {t('map.add')}</button>
      </div>}
    </header>
    <div hidden={!browsing}>
      {picking ? <div className="vmn-map-actions"><p role="status">{t('map.pickInstruction')}</p>
        <button type="button" onClick={() => setPicking(false)}>{t('common.cancel')}</button></div> : <>
        <div className="vmn-map-toolbar">
          <label className="vmn-map-search"><UiIcon name="search" /><input type="search" value={search} placeholder={t('map.search')}
            aria-label={t('map.search')} maxLength={120} onChange={event => { setOffset(0); setSearch(event.target.value); setLocality(''); }} /></label>
          <label>{t('map.chooseTown')} <select value={locality} onChange={event => centerTown(event.target.value)}>
            <option value="">{t('map.allTowns')}</option>
            {locality && !knownLocalities.includes(locality) && <option value={locality}>{locality}</option>}
            {knownLocalities.map(town => <option key={town}>{town}</option>)}
          </select></label>
        </div>
        <div className="vmn-map-toolbar">
          {canVisit && <><button type="button" aria-pressed={want} onClick={() => { setOffset(0); setWant(!want); }}>{t('map.want')}</button>
            <button type="button" aria-pressed={favorite} onClick={() => { setOffset(0); setFavorite(!favorite); }}>{t('map.favorites')}</button></>}
          <details className="vmn-map-filters">
            <summary>{t('map.filters')}{activeFilters > 0 ? ' · ' + activeFilters : ''}</summary>
            <div className="card vmn-map-filter-panel">
              <label>{t('map.category')}<select value={category} onChange={event => { setOffset(0); setCategory(event.target.value as MapCategory | ''); }}>
                <option value="">{t('map.allCategories')}</option>{MAP_CATEGORIES.map(value => <option key={value} value={value}>{t(`map.category.${value}`)}</option>)}
              </select></label>
              <label>{t('map.tags')}<select value={tag} onChange={event => { setOffset(0); setTag(event.target.value); }}>
                <option value="">{t('map.allTags')}</option>{tags.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select></label>
              {canEdit && <label className="vmn-map-checkbox"><input type="checkbox" checked={archived} onChange={event => {
                setOffset(0); setArchived(event.target.checked); setSelected(null);
              }} /> {t('map.archived')}</label>}
              <button type="button" onClick={clear}>{t('map.clear')}</button>
            </div>
          </details>
        </div>
        <div className="vmn-map-phone">
          <button type="button" aria-pressed={phone === 'map'} onClick={() => setPhone('map')}>{t('map.navigation')}</button>
          <button type="button" aria-pressed={phone === 'list'} onClick={() => setPhone('list')}>{t('map.list')}</button>
        </div>
      </>}
      <div className="vmn-map-grid" data-phone={phone}>
        <div className="vmn-map-column">
          <Suspense fallback={<p>{t('map.loading')}</p>}>
            {mapInitialized && <MapCanvas places={markers} selected={selected?.id ?? ''} active={browsing && phone === 'map'} viewport={view}
              focus={focus} pick={picking} onSelect={selectPin} onDrop={(longitude, latitude) => {
                setDropped(coordinate({ longitude, latitude })); setPicking(false);
              }} onMove={(viewport, extents) => { setBounds(extents); setView(viewport); }} />}
          </Suspense>
          <div className="vmn-map-legend"><small>◆ {t('map.role.destination')}</small><small>◌ {t('map.precision.approximate')}</small>
            <small>▲ {t('map.role.trailhead')}</small><small>P {t('map.role.parking')}</small></div>
          {!picking && selected && (places.some(place => place.id === selected.id) || markers.some(place => place.id === selected.id)) && <article className="card vmn-map-pin-card">
            <button className="vmn-map-place-row" type="button" onClick={() => showDetail(selected)}>
              <Thumbnail place={selected} workspaceId={workspaceId} />
              <span><strong>{selected.name}</strong><small>{t(`map.category.${selected.category}`)}
                {selected.details.locality && ' · ' + selected.details.locality}</small>
                <small>{selected.details.hours || selected.details.approach || selected.sharedApproach?.name || selected.tags[0]?.name}</small></span>
            </button>
            {!selected.archived && <PlaceGo place={selected} />}
            <AccessWarning place={selected} />
          </article>}
        </div>
        {!picking && <section className="vmn-map-list" aria-label={t('map.savedPlaces')}>
          <h2>{t('map.savedPlaces')}</h2>
          {!loaded && <p role="status">{t('map.loading')}</p>}
          {loaded && !places.length && <div className="card vmn-map-fold">
            <p>{t(filters ? 'map.noResults' : 'map.empty')}</p>
            {filters && <button type="button" onClick={clear}>{t('map.clear')}</button>}
          </div>}
          {places.map(place => <PlaceRow place={place} workspaceId={workspaceId} key={place.id} selected={selected?.id === place.id} onSelect={() => {
            if (phone === 'list' || selected?.id === place.id || !place.points.length) showDetail(place);
            else choose(place, false);
          }} />)}
          {nextOffset !== null && <button type="button" onClick={() => setOffset(nextOffset)}>{t('map.more')}</button>}
        </section>}
      </div>
      {screen === 'browse' && canManage && <Taxonomy workspaceId={workspaceId} tags={tags} changed={reload} />}
    </div>
    {screen === 'detail' && selected && <PlaceDetails key={selected.id} place={selected} workspaceId={workspaceId} canEdit={canEdit} canVisit={canVisit} busy={busy}
      onBack={back} onEdit={() => openEditor(selected)} onPersonalChanged={reload}
      onArchive={() => { if (selected.archived || window.confirm(t('map.confirmArchive'))) void save(editDraft(selected), selected, !selected.archived); }} />}
    {editing && <PlaceEditor workspaceId={workspaceId} approaches={approaches} sharedPoints={sharedPoints} key={edit?.id ?? 'new'} existing={edit} tags={tags} picking={picking} dropped={dropped} busy={busy} error={error}
      onUseDrop={() => setDropped('')} onPick={() => { setPhone('map'); setPicking(true); }}
      onCancel={() => { if (edit) showDetail(edit); else back(); }}
      onSave={draft => void save(draft, edit)} />}
    {screen === 'import' && <MapImport workspaceId={workspaceId} onBack={back} onOpen={id => void saved(id)} />}
    {error && !editing && <p role="alert">{error}</p>}
  </section>;
}
