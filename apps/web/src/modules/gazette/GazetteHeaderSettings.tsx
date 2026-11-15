import { useEffect, useState, type FormEvent } from 'react';
import { GAZETTE_HEADER_MODES, MAX_GAZETTE_HEADER_IMAGES } from '@vergissmeinnicht/domain';
import { api, gazetteHeaderUrl, messageFor, type GazetteEditionSummaryView, type GazetteHeaderSettings as Header, type GazetteHeaderView } from '../../api.ts';
import { formatCalendarDate, t } from '../../i18n/index.ts';
import { UiIcon } from '../../ui-icons.tsx';

export function GazetteHeaderSettings({ workspaceId }: { workspaceId: string }) {
  const [stored, setStored] = useState<GazetteHeaderView | null>(null);
  const [draft, setDraft] = useState<Header | null>(null);
  const [editions, setEditions] = useState<GazetteEditionSummaryView[]>([]);
  const [date, setDate] = useState('');
  const [override, setOverride] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const apply = (saved: GazetteHeaderView) => { setStored(saved); setDraft(saved.settings); };
  useEffect(() => {
    let live = true;
    Promise.all([api.gazetteHeader(workspaceId), api.gazetteEditions(workspaceId)])
      .then(([settings, archive]) => {
        if (live) { apply(settings); setEditions(archive.editions.filter(edition => edition.state === 'PUBLISHED')); }
      }, (caught: unknown) => { if (live) setMessage({ error: true, text: messageFor(caught) }); });
    return () => { live = false; };
  }, [workspaceId]);

  async function run(action: () => Promise<void>) {
    setBusy(true); setMessage(null);
    try { await action(); setMessage({ error: false, text: t('gazette.settingsSaved') }); }
    catch (caught) { setMessage({ error: true, text: messageFor(caught) }); }
    finally { setBusy(false); }
  }

  if (stored === null || draft === null) return <p role={message ? 'alert' : 'status'}>{message?.text ?? t('common.loading')}</p>;
  const dirty = JSON.stringify(stored.settings) !== JSON.stringify(draft);
  const mode = (value: Header['mode']) => setDraft({ ...draft, mode: value, fixed: value === 'fixed' ? draft.fixed ?? draft.images[0]?.id ?? null : draft.fixed });
  function reorder(index: number, offset: -1 | 1) {
    if (draft === null) return;
    const images = [...draft.images];
    const next = index + offset;
    const first = images[index], second = images[next];
    if (!first || !second) return;
    images[index] = second; images[next] = first;
    setDraft({ ...draft, images });
  }
  function upload(file: File | undefined, replace?: string) {
    if (!file || stored === null) return;
    void run(async () => apply(await api.uploadGazetteHeader(workspaceId, file, stored.revision, replace)));
  }
  function saveOverride(event: FormEvent) {
    event.preventDefault();
    const edition = editions.find(item => item.date === date);
    if (!edition) return;
    void run(async () => {
      await api.overrideGazetteHeader(workspaceId, date, override || null, edition.revision);
      const rows = await api.gazetteEditions(workspaceId);
      setEditions(rows.editions.filter(item => item.state === 'PUBLISHED'));
    });
  }
  return (
    <section className="card gazette-admin-card gazette-header-editor" aria-label={t('gazette.headerSettings')}>
      <h2>{t('gazette.headerSettings')}</h2>
      <p className="muted">{t('gazette.headerHelp')}</p>
      {message && <p role={message.error ? 'alert' : 'status'}>{message.text}</p>}
      <fieldset disabled={busy} className="gazette-admin-card">
        <legend>{t('gazette.headerRotation')}</legend>
        <div className="gazette-admin-grid">
          <label>{t('gazette.headerRotation')}<select value={draft.mode} onChange={event => mode(event.target.value as Header['mode'])}>
            {GAZETTE_HEADER_MODES.map(value => <option key={value} value={value} disabled={value !== 'default' && draft.images.length === 0}>{t(`gazette.headerMode.${value}`)}</option>)}
          </select></label>
          {draft.mode === 'fixed' && <label>{t('gazette.headerFixed')}<select value={draft.fixed ?? ''} onChange={event => setDraft({ ...draft, fixed: event.target.value })}>{draft.images.map(({ id }, index) => <option key={id} value={id}>{t('gazette.headerPhoto', { number: index + 1 })}</option>)}</select></label>}
        </div>
        <ul className="plain-list gazette-header-list">
          {draft.images.map((image, index) => {
            const name = t('gazette.headerPhoto', { number: index + 1 });
            return <li key={image.id}>
              {/* Click or tap the photo to put its focal point there; the sliders fine-tune it. */}
              <button type="button" className="gazette-header-focus" aria-label={t('gazette.headerFocusHere', { name })} title={t('gazette.headerFocusHere', { name })}
                onClick={event => { const box = event.currentTarget.getBoundingClientRect(); if (box.width === 0 || box.height === 0) return; const x = Math.round(Math.min(100, Math.max(0, ((event.clientX - box.left) / box.width) * 100))); const y = Math.round(Math.min(100, Math.max(0, ((event.clientY - box.top) / box.height) * 100))); setDraft({ ...draft, images: draft.images.map(item => item.id === image.id ? { ...item, x, y } : item) }); }}>
                <img src={gazetteHeaderUrl(workspaceId, image.id)} alt={name} style={{ objectPosition: `${image.x}% ${image.y}%` }} />
                <span className="gazette-header-shade" aria-hidden="true" />
                <span className="gazette-header-dot" aria-hidden="true" style={{ left: `${image.x}%`, top: `${image.y}%` }} />
              </button>
              <div className="gazette-admin-grid">
                {(['x', 'y'] as const).map(axis => <label key={axis}>{t(`gazette.headerFocus.${axis}`)}<input type="range" min="0" max="100" value={image[axis]} onChange={event => setDraft({ ...draft, images: draft.images.map(item => item.id === image.id ? { ...item, [axis]: Number(event.target.value) } : item) })} /></label>)}
              </div>
              <div className="gazette-header-actions">
                <button type="button" className="icon-button" disabled={index === 0} aria-label={t('gazette.moveUp', { title: name })} title={t('gazette.moveUp', { title: name })} onClick={() => reorder(index, -1)}><UiIcon name="moveUp" /></button>
                <button type="button" className="icon-button" disabled={index === draft.images.length - 1} aria-label={t('gazette.moveDown', { title: name })} title={t('gazette.moveDown', { title: name })} onClick={() => reorder(index, 1)}><UiIcon name="moveDown" /></button>
                <label className={dirty ? 'button icon-button is-disabled' : 'button icon-button'} title={t('gazette.headerReplace', { name })}>
                  <UiIcon name="replace" /><span className="visually-hidden">{t('gazette.headerReplace', { name })}</span>
                  <input className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" disabled={dirty} onChange={event => { upload(event.target.files?.[0], image.id); event.target.value = ''; }} />
                </label>
                {deleting !== image.id && <button type="button" className="icon-button" disabled={dirty} aria-label={t('gazette.headerDelete', { name })} title={t('gazette.headerDelete', { name })} onClick={() => setDeleting(image.id)}><UiIcon name="trash" /></button>}
              </div>
              {deleting === image.id && <div className="gazette-header-actions">
                <p>{t('gazette.headerConfirmDelete')}</p>
                <button type="button" className="button" onClick={() => setDeleting(null)}>{t('common.cancel')}</button>
                <button type="button" className="button" disabled={dirty} onClick={() => void run(async () => { apply(await api.deleteGazetteHeader(workspaceId, image.id, stored.revision)); setDeleting(null); })}>{t('gazette.headerDelete', { name })}</button>
              </div>}
            </li>;
          })}
        </ul>
        <label>{t('gazette.headerUpload')}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={dirty || draft.images.length >= MAX_GAZETTE_HEADER_IMAGES} onChange={event => { upload(event.target.files?.[0]); event.target.value = ''; }} /></label>
        <button type="button" className="button primary" disabled={!dirty} onClick={() => void run(async () => apply(await api.saveGazetteHeader(workspaceId, draft, stored.revision)))}>{t('gazette.headerSave')}</button>
      </fieldset>
      {editions.length > 0 && <form onSubmit={saveOverride}>
        <fieldset disabled={busy || dirty} className="gazette-admin-card">
          <legend>{t('gazette.headerOverride')}</legend>
          <div className="gazette-admin-grid">
            <label>{t('gazette.headerEdition')}<select value={date} onChange={event => { setDate(event.target.value); setOverride(''); }}>
              <option value="">{t('gazette.headerChooseEdition')}</option>
              {editions.map(edition => <option key={edition.id} value={edition.date}>{formatCalendarDate(edition.date)}</option>)}
            </select></label>
            <label>{t('gazette.headerFixed')}<select value={override} onChange={event => setOverride(event.target.value)}>
              <option value="">{t('gazette.headerMode.default')}</option>
              {stored.settings.images.map(({ id }, index) => <option key={id} value={id}>{t('gazette.headerPhoto', { number: index + 1 })}</option>)}
            </select></label>
          </div>
          <button type="submit" className="button" disabled={!date}>{t('gazette.headerApply')}</button>
        </fieldset>
      </form>}
    </section>
  );
}
