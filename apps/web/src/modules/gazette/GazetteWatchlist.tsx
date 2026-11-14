import { useEffect, useId, useState, type FormEvent } from 'react';
import { GAZETTE_WATCH_CONDITIONS, type GazetteWatchCondition } from '@vergissmeinnicht/domain';
import { api, messageFor, type GazetteWatchFields, type GazetteWatchItemView } from '../../api.ts';
import { formatCalendarDate, t } from '../../i18n/index.ts';
import { Link, paths } from '../../router.tsx';
import { UiIcon } from '../../ui-icons.tsx';
import './gazette.css';

const EMPTY: GazetteWatchFields = { name: '', variant: '', condition: 'any', market: '', shop: '', url: null, currency: 'EUR', target: null, typical: null, notes: '', active: true };
const money = (value: number | null, currency: string) => value === null ? '–' : new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: value % 1 === 0 ? 0 : 2 }).format(value);
const amount = (text: string): number | null => { const value = Number(text.replace(',', '.')); return text.trim() === '' || !Number.isFinite(value) ? null : value; };

function Trend({ item }: { item: GazetteWatchItemView }) {
  const values = item.history.map(entry => entry.price);
  if (values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values), span = Math.max(1, max - min);
  const points = values.map((value, index) => `${((index / (values.length - 1)) * 90).toFixed(1)},${(4 + (1 - (value - min) / span) * 18).toFixed(1)}`).join(' ');
  const change = (values.at(-1) ?? 0) < (values.at(-2) ?? 0) ? 'down' : (values.at(-1) ?? 0) > (values.at(-2) ?? 0) ? 'up' : 'same';
  return <svg className={`gazette-spark gazette-spark-${change}`} viewBox="0 0 90 26" aria-hidden="true" focusable="false"><polyline points={points} /></svg>;
}

/** One form for a new and a changed item; fields beyond name and price wait behind "More". */
function ItemForm({ initial, onSave, onCancel, busy }: { initial: GazetteWatchFields; onSave: (fields: GazetteWatchFields) => void; onCancel: () => void; busy: boolean }) {
  const id = useId();
  const [fields, setFields] = useState(initial);
  const [target, setTarget] = useState(initial.target === null ? '' : String(initial.target));
  const [typical, setTypical] = useState(initial.typical === null ? '' : String(initial.typical));
  const [url, setUrl] = useState(initial.url ?? '');
  const submit = (event: FormEvent) => { event.preventDefault(); onSave({ ...fields, name: fields.name.trim(), target: amount(target), typical: amount(typical), url: url.trim() === '' ? null : url.trim(), currency: fields.currency.toUpperCase() }); };
  return (
    <form className="card gazette-admin-card gazette-watch-form" onSubmit={submit}>
      <fieldset disabled={busy} className="gazette-admin-grid">
        <label className="gazette-watch-form-name">{t('gazette.watchName')}<input id={`${id}-name`} value={fields.name} maxLength={120} required autoFocus onChange={event => setFields({ ...fields, name: event.target.value })} /></label>
        <label>{t('gazette.watchTarget')}<input inputMode="decimal" value={target} onChange={event => setTarget(event.target.value)} /></label>
        <label>{t('gazette.watchTypical')}<input inputMode="decimal" value={typical} onChange={event => setTypical(event.target.value)} /></label>
        <label>{t('gazette.watchCurrency')}<input value={fields.currency} maxLength={3} pattern="[A-Za-z]{3}" required onChange={event => setFields({ ...fields, currency: event.target.value })} /></label>
        <label>{t('gazette.watchVariant')}<input value={fields.variant} maxLength={120} onChange={event => setFields({ ...fields, variant: event.target.value })} /></label>
        <label>{t('gazette.watchCondition')}<select value={fields.condition} onChange={event => setFields({ ...fields, condition: event.target.value as GazetteWatchCondition })}>{GAZETTE_WATCH_CONDITIONS.map(condition => <option key={condition} value={condition}>{t(`gazette.watchConditionOption.${condition}`)}</option>)}</select></label>
        <label>{t('gazette.watchShop')}<input value={fields.shop} maxLength={80} onChange={event => setFields({ ...fields, shop: event.target.value })} /></label>
        <label>{t('gazette.watchMarket')}<input value={fields.market} maxLength={8} onChange={event => setFields({ ...fields, market: event.target.value })} /></label>
        <label className="gazette-watch-form-wide">{t('gazette.watchUrl')}<input type="url" inputMode="url" value={url} maxLength={2048} pattern="https://.*" placeholder="https://" onChange={event => setUrl(event.target.value)} /></label>
        <label className="gazette-watch-form-wide">{t('gazette.watchNotes')}<textarea rows={2} maxLength={1000} value={fields.notes} onChange={event => setFields({ ...fields, notes: event.target.value })} /></label>
      </fieldset>
      <div className="gazette-watch-form-actions">
        <button type="button" className="icon-button" aria-label={t('common.cancel')} title={t('common.cancel')} onClick={onCancel}><UiIcon name="close" /></button>
        <button type="submit" className="button primary" disabled={busy || fields.name.trim() === ''}><UiIcon name="save" /><span>{t('gazette.save')}</span></button>
      </div>
    </form>
  );
}

/**
 * The Gazette's persistent watchlist (43.3). It outlives editions: retention never touches it. Everyone
 * with the tool reads it; editors and admins add, change, archive and note a price they checked.
 */
export function GazetteWatchlist({ workspaceId, canEdit }: { workspaceId: string; canEdit: boolean }) {
  const [items, setItems] = useState<GazetteWatchItemView[] | null>(null);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [pricing, setPricing] = useState<{ id: string; value: string } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.gazetteWatchlist(workspaceId).then(setItems, (caught: unknown) => setError(messageFor(caught)));
  useEffect(() => {
    let live = true;
    api.gazetteWatchlist(workspaceId).then(result => { if (live) setItems(result); }, (caught: unknown) => { if (live) setError(messageFor(caught)); });
    return () => { live = false; };
  }, [workspaceId]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await action(); await load(); return true; } catch (caught) { setError(messageFor(caught)); return false; } finally { setBusy(false); }
  };
  const fieldsOf = (item: GazetteWatchItemView): GazetteWatchFields => ({ name: item.name, variant: item.variant, condition: item.condition, market: item.market, shop: item.shop, url: item.url, currency: item.currency, target: item.target, typical: item.typical, notes: item.notes, active: item.active });

  const shown = (items ?? []).filter(item => showArchived || item.active);
  const archived = (items ?? []).filter(item => !item.active).length;

  return (
    <section className="gazette-page gazette-admin" aria-labelledby="gazette-watch-title">
      <header className="gazette-admin-head">
        <Link href={paths.gazette(workspaceId)} className="icon-button" aria-label={t('gazette.backToEdition')} title={t('gazette.backToEdition')}><UiIcon name="back" /></Link>
        <div><p className="gazette-admin-eyebrow"><UiIcon name="gazette" size="1em" />{t('gazette.masthead')}</p><h1 id="gazette-watch-title">{t('gazette.watchlist')}</h1></div>
        {canEdit && editing !== 'new' && <button type="button" className="button primary gazette-admin-save" onClick={() => setEditing('new')}><UiIcon name="add" /><span>{t('gazette.watchAdd')}</span></button>}
      </header>
      <p className="muted gazette-admin-note">{t('gazette.watchNote')}</p>
      {error && <p role="alert" className="gazette-chip gazette-chip-warn">{error}</p>}
      {editing === 'new' && <ItemForm initial={EMPTY} busy={busy} onCancel={() => setEditing(null)} onSave={fields => void run(() => api.createGazetteWatchItem(workspaceId, fields)).then(ok => { if (ok) setEditing(null); })} />}
      {items === null && error === null && <p className="muted" aria-busy="true">{t('common.loading')}</p>}
      {items !== null && items.length === 0 && editing !== 'new' && <div className="card gazette-empty"><UiIcon name="tag" size="2em" /><p>{t('gazette.watchEmpty')}</p></div>}
      <ul className="plain-list gazette-watch">
        {shown.map(item => editing === item.id ? (
          <li key={item.id}><ItemForm initial={fieldsOf(item)} busy={busy} onCancel={() => setEditing(null)} onSave={fields => void run(() => api.updateGazetteWatchItem(workspaceId, item.id, fields, item.revision)).then(ok => { if (ok) setEditing(null); })} /></li>
        ) : (
          <li key={item.id} className={item.active ? 'card gazette-watch-item gazette-watch-manage' : 'card gazette-watch-item gazette-watch-manage gazette-admin-off'}>
            <span className="gazette-watch-thumb" aria-hidden="true"><UiIcon name="tag" /></span>
            <span className="gazette-watch-name">
              <b>{item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer">{item.name}</a> : item.name}</b>
              <small className="muted">{[item.variant, item.condition === 'any' ? '' : t(`gazette.watchConditionOption.${item.condition}`), item.market, item.shop, item.active ? '' : t('gazette.watchArchived')].filter(Boolean).join(' · ')}</small>
            </span>
            <Trend item={item} />
            <span className="gazette-watch-price">
              <b className={item.latest?.verified ? undefined : 'muted'}>{money(item.latest?.price ?? null, item.currency)}</b>
              <small className="muted">{item.latest ? t('gazette.lastVerified', { date: formatCalendarDate(item.latest.checkedAt.slice(0, 10)) }) : t('gazette.watchNoPrice')}{item.target !== null && ` · ${t('gazette.target', { price: money(item.target, item.currency) })}`}</small>
            </span>
            {canEdit && (
              <span className="gazette-watch-actions">
                {pricing?.id === item.id ? (
                  <form className="gazette-watch-price-form" onSubmit={event => { event.preventDefault(); const value = amount(pricing.value); if (value !== null) void run(() => api.recordGazettePrice(workspaceId, item.id, value, item.shop)).then(ok => { if (ok) setPricing(null); }); }}>
                    <input inputMode="decimal" aria-label={t('gazette.watchPriceFor', { name: item.name })} value={pricing.value} autoFocus onChange={event => setPricing({ id: item.id, value: event.target.value })} />
                    <button type="submit" className="icon-button" disabled={busy || amount(pricing.value) === null} aria-label={t('gazette.watchPriceSave')} title={t('gazette.watchPriceSave')}><UiIcon name="check" /></button>
                  </form>
                ) : (
                  <button type="button" className="icon-button" disabled={!item.active} aria-label={t('gazette.watchPriceFor', { name: item.name })} title={t('gazette.watchPrice')} onClick={() => setPricing({ id: item.id, value: '' })}><UiIcon name="gazettePrice" /></button>
                )}
                <button type="button" className="icon-button" aria-label={t('gazette.watchEdit', { name: item.name })} title={t('gazette.watchEditShort')} onClick={() => { setPricing(null); setEditing(item.id); }}><UiIcon name="edit" /></button>
                <button type="button" className="icon-button" disabled={busy} aria-label={t(item.active ? 'gazette.watchArchive' : 'gazette.watchRestore', { name: item.name })} title={t(item.active ? 'gazette.watchArchiveShort' : 'gazette.watchRestoreShort')} onClick={() => void run(() => api.updateGazetteWatchItem(workspaceId, item.id, { ...fieldsOf(item), active: !item.active }, item.revision))}><UiIcon name={item.active ? 'archive' : 'unarchive'} /></button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {archived > 0 && <button type="button" className="quiet gazette-watch-toggle" aria-pressed={showArchived} onClick={() => setShowArchived(!showArchived)}><UiIcon name="archive" size="1em" />{showArchived ? t('gazette.watchHideArchived') : t('gazette.watchShowArchived', { count: archived })}</button>}
    </section>
  );
}
