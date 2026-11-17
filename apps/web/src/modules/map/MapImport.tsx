import { useState, type FormEvent } from 'react';
import { parseMapPlace, type MapPlaceInput } from '@vergissmeinnicht/domain';
import { mapApi, messageFor } from '../../api.ts';
import { t } from '../../i18n/index.ts';
import { coordinate } from './map-view.ts';

interface Preview {
  place: MapPlaceInput; matches: { id: string; name: string; exact: boolean }[]; unresolved: boolean;
  operationId: string; include: boolean; savedId?: string; error?: string;
}

function drafts(raw: string): unknown[] {
  const value: unknown = JSON.parse(raw);
  const items = Array.isArray(value) ? value : value && typeof value === 'object' && 'items' in value ? value.items : [value];
  if (!Array.isArray(items) || items.length < 1 || items.length > 12) throw new SyntaxError();
  return items.map((item: unknown) => item && typeof item === 'object' && 'place' in item ? item.place : item);
}

export function MapImport({ workspaceId, onBack, onOpen }: { workspaceId: string; onBack: () => void; onOpen: (id: string) => void }) {
  const [raw, setRaw] = useState('');
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function review(event: FormEvent) {
    event.preventDefault();
    setError(''); setPreviews([]); setBusy(true);
    try {
      const entries = drafts(raw).map(parseMapPlace);
      const next = await Promise.all(entries.map(async place => {
        const result = await mapApi.preview(workspaceId, place);
        const ids = [...(result.exact ? [result.exact] : []), ...result.possible].slice(0, 6);
        const matches = await Promise.all(ids.map(async id => ({ id, name: (await mapApi.place(workspaceId, id)).name, exact: id === result.exact })));
        return { place, matches, unresolved: result.unresolved, operationId: crypto.randomUUID(), include: matches.length === 0 };
      }));
      setPreviews(next);
    } catch (issue) { setError(issue instanceof SyntaxError ? t('map.importInvalid') : messageFor(issue)); }
    finally { setBusy(false); }
  }

  async function save() {
    setBusy(true);
    let savedCount = 0;
    const pending = previews.filter(item => item.include && !item.savedId && item.matches.length === 0);
    for (const preview of pending) {
      try {
        const saved = await mapApi.save(workspaceId, preview.place, preview.operationId, undefined, undefined, true);
        const verified = await mapApi.place(workspaceId, saved.id);
        setPreviews(current => current.map(item => item.operationId === preview.operationId ? { ...item, savedId: verified.id, error: '' } : item));
        savedCount += 1;
      } catch (issue) {
        setPreviews(current => current.map(item => item.operationId === preview.operationId ? { ...item, error: messageFor(issue) } : item));
      }
    }
    setError(t('map.importCounts', { saved: savedCount, pending: pending.length - savedCount }));
    setBusy(false);
  }

  return <section className="card vmn-map-editor">
    <div><button type="button" disabled={busy} onClick={onBack}>{t('map.back')}</button></div>
    <h2>{t('map.importPreview')}</h2>
    <p>{t('map.importHelp')}</p>
    <form className="vmn-map-editor-fields" onSubmit={event => void review(event)}>
      <label>{t('map.importPayload')}<textarea rows={7} maxLength={120000} value={raw} disabled={busy} onChange={event => {
        setRaw(event.target.value); setPreviews([]); setError('');
      }} autoFocus /></label>
      <button className="button" disabled={busy || !raw.trim()}>{t('map.reviewImport')}</button>
    </form>
    {error && <p role="status">{error}</p>}
    {previews.map(preview => <article className="card vmn-map-fold" key={preview.operationId}>
      <h3>{preview.place.name}</h3>
      <p>{[t(`map.category.${preview.place.category}`), preview.place.details.locality].filter(Boolean).join(' · ')}</p>
      {preview.unresolved && <p>{t('map.unresolvedHelp')}</p>}
      {!preview.place.points.length && <p>{t('map.unknownPin')}</p>}
      {!preview.place.details.conditionsCheckedOn && <p>{t('map.conditionsUnknown')}</p>}
      {preview.place.points.map((point, index) => <p key={index}>
        {t(`map.role.${point.role}`)} · {point.newPoint ? coordinate(point.newPoint) + ' · ' + t(`map.precision.${point.newPoint.precision}`) : t('map.existingPoint')}
        {point.preferred && ' · ' + t('map.preferred')}{point.newPoint?.provenance && ' · ' + point.newPoint.provenance}
      </p>)}
      {preview.place.details.sources.map((source, index) => <p key={index}><a href={source.url} rel="noopener noreferrer" target="_blank">
        {source.title || source.publisher || t('map.sourceLink')}</a>{source.supports && ' · ' + source.supports}</p>)}
      {preview.error && <p role="alert">{preview.error}</p>}
      {preview.savedId && <button type="button" disabled={busy} onClick={() => { if (preview.savedId) onOpen(preview.savedId); }}>{t('map.openSaved')}</button>}
      {preview.matches.length > 0 && <>
        <p>{t('map.reviewMatches')}</p>
        {preview.matches.map(match => <button type="button" disabled={busy} key={match.id} onClick={() => onOpen(match.id)}>
          {match.name} · {t(match.exact ? 'map.exactMatch' : 'map.possibleMatch')}
        </button>)}
      </>}
      {!preview.savedId && preview.matches.length === 0 && <label className="vmn-map-checkbox"><input type="checkbox" checked={preview.include} disabled={busy}
        onChange={event => {
          const include = event.target.checked;
          setPreviews(current => current.map(item => item.operationId === preview.operationId ? { ...item, include } : item));
        }} /> {t('map.includeImport')}</label>}
    </article>)}
    {previews.some(item => item.include && !item.savedId) && <button className="primary" type="button" disabled={busy} onClick={() => void save()}>{t('map.saveReviewed')}</button>}
  </section>;
}
