import { useState } from 'react';
import { mapApi, messageFor, type MapAddressCandidate } from '../../api.ts';
import { t } from '../../i18n/index.ts';

export function AddressLookup({ workspaceId, seed, onChoose }: {
  workspaceId: string; seed: string; onChoose: (candidate: MapAddressCandidate) => void;
}) {
  const [edited, setEdited] = useState<string | null>(null);
  const query = edited ?? seed.slice(0, 360);
  const [results, setResults] = useState<{ query: string; candidates: MapAddressCandidate[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [chosen, setChosen] = useState(false);
  async function find() {
    if (busy || query.trim().length < 3) return;
    setBusy(true); setError(''); setResults(null); setChosen(false);
    try { setResults({ query, candidates: await mapApi.addressSearch(workspaceId, query) }); }
    catch (cause) { setError(messageFor(cause)); }
    finally { setBusy(false); }
  }
  return <section className="vmn-map-address" aria-label={t('map.addressSearch')}>
    <p className="muted">{t('map.addressPrivacy')}</p>
    <label>{t('map.addressSearch')}<input value={query} maxLength={360} onChange={event => setEdited(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void find(); } }} /></label>
    <button type="button" disabled={busy || query.trim().length < 3} onClick={() => void find()}>{t(busy ? 'map.addressSearching' : 'map.addressFind')}</button>
    {chosen && <p role="status">{t('map.addressChosen')}</p>}
    {error && <p role="alert">{error}</p>}
    {results?.query === query && <div aria-live="polite">
      {results.candidates.length === 0 && <p>{t('map.addressNoResults')}</p>}
      <ul className="vmn-map-address-results">{results.candidates.map((candidate, index) => <li key={index}>
        <p>{candidate.label || t('map.addressResult')} · {candidate.latitude}, {candidate.longitude}</p>
        <p>{t(candidate.approximate ? 'map.precision.approximate' : 'map.precision.exact')}</p>
        <a href={candidate.sourceUrl} target="_blank" rel="noreferrer">© OpenStreetMap</a>{' '}
        <button type="button" onClick={() => { onChoose(candidate); setChosen(true); }}>{t('map.addressUse')}</button>
      </li>)}</ul>
    </div>}
  </section>;
}
