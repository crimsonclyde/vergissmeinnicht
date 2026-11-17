import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { MAP_CATEGORIES, MAP_POINT_ROLES, type MapApproach, type MapPointFields, type MapPlace, type MapPlaceDetails, type MapPlaceInput, type MapPointRole, type MapSource, type MapTag } from '@vergissmeinnicht/domain';
import { mapApi, mapPhotoUrl, messageFor } from '../../api.ts';
import { t } from '../../i18n/index.ts';
import { setNavigationGuard } from '../../router.tsx';
import { coordinate, editDraft, parsePair } from './map-view.ts';

interface Props {
  approaches: Pick<MapApproach, 'id' | 'name'>[]; sharedPoints: (MapPointFields & { id: string })[];
  workspaceId: string; existing: MapPlace | null; tags: MapTag[]; busy: boolean; error: string; picking: boolean;
  dropped: string; onPick: () => void; onUseDrop: () => void; onCancel: () => void;
  onSave: (draft: MapPlaceInput) => void;
}
type DetailsText = { [K in keyof MapPlaceDetails]: MapPlaceDetails[K] extends string ? K : never }[keyof MapPlaceDetails];

export function PlaceEditor(props: Props) {
  const { existing, tags, picking } = props;
  const [initial] = useState(() => editDraft(existing));
  const [draft, setDraft] = useState<MapPlaceInput>(() => ({ ...initial, name: existing ? initial.name : '' }));
  const [coord, setCoord] = useState('');
  const [method, setMethod] = useState<'none' | 'coordinates' | 'link'>(existing?.details.originalUrl ? 'link' : 'none');
  const [role, setRole] = useState<MapPointRole>('destination');
  const [approximate, setApproximate] = useState(false);
  const [issue, setIssue] = useState('');
  const [createdApproach, setCreatedApproach] = useState<Pick<MapApproach, 'id' | 'name'> | null>(null);
  const [approachName, setApproachName] = useState('');
  const [sharedPointId, setSharedPointId] = useState('');
  const [sharedRole, setSharedRole] = useState<'trailhead' | 'parking'>('trailhead');
  const [uploading, setUploading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const leave = useCallback(() => !dirty || window.confirm(t('journal.unsaved')), [dirty]);
  useEffect(() => {
    setNavigationGuard(leave);
    const unload = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', unload);
    return () => { setNavigationGuard(null); window.removeEventListener('beforeunload', unload); };
  }, [dirty, leave]);
  const text = (field: DetailsText, label: string, type = 'text', maxLength = 240) =>
    <label>{label}<input type={type} maxLength={maxLength} value={draft.details[field]} onChange={event =>
      setDraft({ ...draft, details: { ...draft.details, [field]: event.target.value } })} /></label>;
  const setPreferred = (index: number) => {
    setDirty(true);
    setDraft({ ...draft, points: draft.points.map((point, i) => ({ ...point, preferred: i === index })) });
  };
  function submit(event: FormEvent) {
    event.preventDefault();
    if (uploading || props.busy) return;
    setIssue('');
    const position = method === 'coordinates' && (props.dropped || coord) ? parsePair(props.dropped || coord) : null;
    if (method === 'coordinates' && (props.dropped || coord) && !position) { setIssue(t('map.badPair')); return; }
    const points = position ? [...draft.points, { role, preferred: draft.points.length === 0, newPoint: {
      ...position, label: role === 'destination' ? draft.name : t(`map.role.${role}`),
      precision: approximate ? 'approximate' as const : 'exact' as const, provenance: '',
    } }] : draft.points;
    props.onSave({ ...draft, points, details: { ...draft.details, sources: draft.details.sources.filter(source => source.url.trim()) } });
  }
  const firstSource = draft.details.sources[0];
  const changeSource = (index: number, field: keyof MapSource, value: string) => {
    setDraft({ ...draft, details: { ...draft.details, sources: draft.details.sources.map((source, i) => i === index ? { ...source, [field]: value } : source) } });
  };
  async function saveApproach() {
    setUploading(true); setIssue('');
    try {
      const { approach, walkMinutes, walkMeters, routeAccess, terrain, conditionsCheckedOn } = draft.details;
      const result = await mapApi.approach(props.workspaceId, { name: approachName, description: approach, walkMinutes, walkMeters,
        routeAccess, terrain, checkedOn: conditionsCheckedOn, sourceUrl: firstSource?.url ?? '' });
      setCreatedApproach(result); setDraft(current => ({ ...current, approachId: result.id }));
      setApproachName('');
    } catch (error) { setIssue(messageFor(error)); }
    finally { setUploading(false); }
  }
  const approaches = createdApproach && !props.approaches.some(item => item.id === createdApproach.id) ? [...props.approaches, createdApproach] : props.approaches;

  return <form className="card vmn-map-editor" hidden={picking} onChange={() => setDirty(true)} onSubmit={submit}>
    <h2>{t(existing ? 'map.edit' : 'map.add')}</h2>
    <label>{t('map.name')}<input value={draft.name} required maxLength={120} onChange={event => setDraft({ ...draft, name: event.target.value })} autoFocus /></label>
    <div className="vmn-map-two">
      <label>{t('map.category')}<select value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value as MapPlace['category'] })}>
        {MAP_CATEGORIES.map(category => <option key={category} value={category}>{t(`map.category.${category}`)}</option>)}
      </select></label>
      {text('locality', t('map.locality'), 'text', 120)}
    </div>
    <div className="vmn-map-editor-fields">
      {existing?.coverId && draft.coverId === existing.coverId && !existing.archived && <img className="vmn-map-editor-cover"
        alt="" src={mapPhotoUrl(props.workspaceId, existing.id, existing.coverId, 'cover', 'preview')} />}
      <label>{t('map.cover')}<input type="file" accept="image/jpeg,image/png" disabled={uploading || props.busy} onChange={async event => {
        const file = event.currentTarget.files?.item(0);
        if (!file) return;
        setUploading(true); setIssue('');
        try { const image = await mapApi.upload(props.workspaceId, file, 'cover'); setDraft(current => ({ ...current, coverId: image.id })); }
        catch (error) { setIssue(messageFor(error)); }
        finally { setUploading(false); }
      }} /></label>
      {draft.coverId && <button type="button" disabled={uploading} onClick={() => { setDirty(true); setDraft({ ...draft, coverId: null }); }}>{t('image.remove')}</button>}
    </div>
    {tags.length > 0 && <fieldset className="vmn-map-tags"><legend>{t('map.tags')}</legend>
      {tags.map(tag => <label className="vmn-map-checkbox" key={tag.id}><input type="checkbox" checked={draft.tagIds.includes(tag.id)}
        onChange={event => setDraft({ ...draft, tagIds: event.target.checked ? [...draft.tagIds, tag.id] : draft.tagIds.filter(id => id !== tag.id) })} /> {tag.name}</label>)}
    </fieldset>}
    {draft.points.map((point, index) => {
      const original = existing?.points.find(entry => entry.id === point.pointId && entry.role === point.role) ?? props.sharedPoints.find(entry => entry.id === point.pointId);
      return <div className="vmn-map-point-row" key={point.pointId + ':' + point.role}>
        <span>{original?.label || t(`map.role.${point.role}`)} {original && <code>{coordinate(original)}</code>}</span>
        <button type="button" aria-pressed={point.preferred} onClick={() => setPreferred(index)}>{t('map.preferred')}</button>
        <button type="button" onClick={() => { setDirty(true); setDraft({ ...draft, points: draft.points.filter((_, i) => i !== index) }); }}>{t('documents.upload.remove')}</button>
      </div>;
    })}
    <div className="vmn-map-two">
      <label>{t('map.locationMethod')}<select value={props.dropped ? 'coordinates' : method} onChange={event => {
        props.onUseDrop(); setMethod(event.target.value as typeof method);
      }}>
        <option value="none">{t('map.locationLater')}</option>
        <option value="coordinates">{t('map.coordinates')}</option>
        <option value="link">{t('map.originalLink')}</option>
      </select></label>
      <button type="button" onClick={() => { setMethod('coordinates'); setDirty(true); props.onPick(); }}>{t('map.dropPin')}</button>
    </div>
    {(method === 'coordinates' || props.dropped) && <div className="vmn-map-two">
      <label>{t('map.latLon')}<input value={props.dropped || coord} inputMode="text" placeholder="44.00166, 7.71564"
        onChange={event => { props.onUseDrop(); setCoord(event.target.value); }} /></label>
      <label>{t('map.pointRole')}<select value={role} onChange={event => setRole(event.target.value as MapPointRole)}>
        {MAP_POINT_ROLES.map(value => <option key={value} value={value}>{t(`map.role.${value}`)}</option>)}
      </select></label>
      <label className="vmn-map-checkbox"><input type="checkbox" checked={approximate} onChange={event => setApproximate(event.target.checked)} /> {t('map.precision.approximate')}</label>
    </div>}
    {props.sharedPoints.length > 0 && <details><summary>{t('map.reusePoint')}</summary>
      <div className="vmn-map-two">
        <label>{t('map.existingPoint')}<select value={sharedPointId} onChange={event => setSharedPointId(event.target.value)}>
          <option value="">{t('map.choosePoint')}</option>
          {props.sharedPoints.map(point => <option key={point.id} value={point.id}>{point.label} · {coordinate(point)}</option>)}
        </select></label>
        <label>{t('map.pointRole')}<select value={sharedRole} onChange={event => setSharedRole(event.target.value as 'trailhead' | 'parking')}>
          <option value="trailhead">{t('map.role.trailhead')}</option><option value="parking">{t('map.role.parking')}</option>
        </select></label>
        <button type="button" disabled={!sharedPointId || draft.points.length >= 12 || draft.points.some(point => point.pointId === sharedPointId && point.role === sharedRole)}
          onClick={() => { setDirty(true); setDraft({ ...draft, points: [...draft.points, { pointId: sharedPointId, role: sharedRole, preferred: draft.points.length === 0 }] }); setSharedPointId(''); }}>{t('map.usePoint')}</button>
      </div>
    </details>}
    {method === 'link' && <>{text('originalUrl', t('map.originalLink'), 'url', 2048)}<p className="muted">{t('map.unresolvedHelp')}</p></>}
    <details>
      <summary>{t('map.secondaryFields')}</summary>
      <div className="vmn-map-editor-fields">
        {text('description', t('map.description'), 'text', 1600)}
        <div className="vmn-map-two">{text('address', t('map.address'))}{text('website', t('map.website'), 'url', 2048)}</div>
        <div className="vmn-map-two">{text('hours', t('map.hours'), 'text', 320)}{text('hoursCheckedOn', t('map.checkedOn'), 'date', 10)}</div>
        <label>{t('map.sharedApproach')}<select value={draft.approachId ?? ''} onChange={event => setDraft({ ...draft, approachId: event.target.value || null })}>
          <option value="">{t('map.noSharedApproach')}</option>
          {approaches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        {text('approach', t('map.approach'), 'text', 1600)}
        <div className="vmn-map-two">
          <label>{t('map.walkMinutes')}<input type="number" min={1} max={1440} value={draft.details.walkMinutes ?? ''} onChange={event =>
            setDraft({ ...draft, details: { ...draft.details, walkMinutes: event.target.value ? Number(event.target.value) : null } })} /></label>
          <label>{t('map.walkMeters')}<input type="number" min={1} max={100000} value={draft.details.walkMeters ?? ''} onChange={event =>
            setDraft({ ...draft, details: { ...draft.details, walkMeters: event.target.value ? Number(event.target.value) : null } })} /></label>
        </div>
        {text('terrain', t('map.terrain'), 'text', 320)}
        {text('routeAccess', t('map.routeAccess'), 'text', 600)}
        {text('buildingAccess', t('map.buildingAccess'), 'text', 600)}
        {text('hazards', t('map.hazards'), 'text', 1000)}
        {text('conditionsCheckedOn', t('map.checkedOn'), 'date', 10)}
        <details>
          <summary>{t('map.createSharedApproach')}</summary>
          <p>{t('map.sharedApproachHint')}</p>
          <div className="vmn-map-two">
            <label>{t('map.approachName')}<input maxLength={120} value={approachName} onChange={event => setApproachName(event.target.value)} /></label>
            <button type="button" disabled={uploading || !approachName.trim()} onClick={() => void saveApproach()}>{t('map.saveSharedApproach')}</button>
          </div>
        </details>
        <details>
          <summary>{t('map.sources')}</summary>
          {draft.details.sources.map((source, index) => <fieldset className="vmn-map-editor-fields" key={index}>
            <legend>{t('map.sourceNumber', { number: index + 1 })}</legend>
            <label>{t('map.sourceLink')}<input type="url" maxLength={2048} value={source.url} onChange={event => changeSource(index, 'url', event.target.value)} /></label>
            <div className="vmn-map-two">
              <label>{t('map.sourceTitle')}<input maxLength={160} value={source.title} onChange={event => changeSource(index, 'title', event.target.value)} /></label>
              <label>{t('map.sourcePublisher')}<input maxLength={120} value={source.publisher} onChange={event => changeSource(index, 'publisher', event.target.value)} /></label>
            </div>
            <label>{t('map.checkedOn')}<input type="date" value={source.checkedOn} onChange={event => changeSource(index, 'checkedOn', event.target.value)} /></label>
            <label>{t('map.sourceSupports')}<textarea maxLength={500} value={source.supports} onChange={event => changeSource(index, 'supports', event.target.value)} /></label>
            <button type="button" onClick={() => {
              setDirty(true);
              setDraft({ ...draft, details: { ...draft.details, sources: draft.details.sources.filter((_, i) => i !== index) } });
            }}>{t('links.remove')}</button>
          </fieldset>)}
          {draft.details.sources.length < 12 && <button type="button" onClick={() => {
            setDraft({ ...draft, details: { ...draft.details, sources: [...draft.details.sources, { url: '', title: '', publisher: '', checkedOn: '', supports: '' }] } });
          }}>{t('map.addSource')}</button>}
        </details>
      </div>
    </details>
    {(issue || props.error) && <p role="alert">{issue || props.error}</p>}
    <div className="vmn-map-actions">
      <button type="button" onClick={() => { if (leave()) props.onCancel(); }} disabled={props.busy || uploading}>{t('common.cancel')}</button>
      <button type="submit" className="primary" disabled={props.busy || uploading || !draft.name.trim()}>{t('map.save')}</button>
    </div>
  </form>;
}
