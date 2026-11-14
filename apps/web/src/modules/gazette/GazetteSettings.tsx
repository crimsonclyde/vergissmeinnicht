import { useEffect, useId, useState, type FormEvent } from 'react';
import { GAZETTE_ICONS, GAZETTE_LIMITS, GAZETTE_SECTION_TYPES, type GazetteIcon, type GazetteSectionDefinition, type GazetteSectionType } from '@vergissmeinnicht/domain';
import { api, messageFor, type GazetteSettings as Settings } from '../../api.ts';
import { t } from '../../i18n/index.ts';
import { Link, paths } from '../../router.tsx';
import { UiIcon } from '../../ui-icons.tsx';
import { gazetteIcon } from './GazettePage.tsx';
import './gazette.css';

function timeZones(): string[] {
  try { return Intl.supportedValuesOf('timeZone'); } catch { return ['UTC']; }
}
const slug = (title: string, taken: readonly string[]) => {
  const base = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'section';
  let id = base; for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
};

/**
 * Gazette settings (43.3), Workspace admins only: the edition's name, how long editions are kept, its time
 * zone, and the sections: order, names, what shows on the Dashboard, what starts folded. A section's id
 * never changes, so a rename keeps every edition that refers to it. Nothing is saved before Save.
 */
export function GazetteSettings({ workspaceId }: { workspaceId: string }) {
  const id = useId();
  const [stored, setStored] = useState<{ settings: Settings; revision: number } | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ title: string; type: GazetteSectionType }>({ title: '', type: 'articles' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    api.gazetteSettings(workspaceId).then(loaded => { if (live) { setStored(loaded); setDraft(loaded.settings); } }, (caught: unknown) => { if (live) setMessage({ kind: 'error', text: messageFor(caught) }); });
    return () => { live = false; };
  }, [workspaceId]);

  if (draft === null || stored === null) return <section className="gazette-page" aria-busy={message === null}>{message ? <p role="alert">{message.text}</p> : <p className="muted">{t('common.loading')}</p>}</section>;

  const change = (next: Partial<Settings>) => { setDraft({ ...draft, ...next }); setMessage(null); };
  const sections = draft.sections;
  const changeSection = (sectionId: string, next: Partial<GazetteSectionDefinition>) => change({ sections: sections.map(section => section.id === sectionId ? { ...section, ...next } : section) });
  const move = (index: number, by: -1 | 1) => {
    const list = [...sections]; const target = index + by;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target] as GazetteSectionDefinition, list[index] as GazetteSectionDefinition];
    change({ sections: list });
  };
  const add = () => {
    const title = adding.title.trim();
    if (title === '' || sections.length >= GAZETTE_LIMITS.sections) return;
    const sectionId = slug(title, sections.map(section => section.id));
    change({ sections: [...sections, { id: sectionId, type: adding.type, title, subtitle: '', icon: adding.type === 'weather' ? 'weather' : adding.type === 'watchlist' ? 'tag' : 'news', enabled: true, language: 'en', dashboard: adding.type === 'articles', collapsed: false, brief: '', sources: [] }] });
    setAdding({ title: '', type: 'articles' }); setOpen(sectionId);
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(stored.settings);
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage(null);
    try {
      const saved = await api.saveGazetteSettings(workspaceId, draft, stored.revision);
      setStored(saved); setDraft(saved.settings); setMessage({ kind: 'ok', text: t('gazette.settingsSaved') });
    } catch (caught) { setMessage({ kind: 'error', text: messageFor(caught) }); } finally { setBusy(false); }
  };

  return (
    <form className="gazette-page gazette-admin" onSubmit={event => void save(event)} aria-labelledby={`${id}-title`}>
      <header className="gazette-admin-head">
        <Link href={paths.gazette(workspaceId)} className="icon-button" aria-label={t('gazette.backToEdition')} title={t('gazette.backToEdition')}><UiIcon name="back" /></Link>
        <div><p className="gazette-admin-eyebrow"><UiIcon name="gazette" size="1em" />{draft.title}</p><h1 id={`${id}-title`}>{t('gazette.settings')}</h1></div>
        <button type="submit" className="button primary gazette-admin-save" disabled={busy || !dirty}><UiIcon name="save" /><span>{t('gazette.save')}</span></button>
      </header>
      {message && <p role={message.kind === 'error' ? 'alert' : 'status'} className={message.kind === 'error' ? 'gazette-chip gazette-chip-warn' : 'gazette-chip gazette-chip-good'}>{message.text}</p>}

      <fieldset className="card gazette-admin-card" disabled={busy}>
        <legend>{t('gazette.editionSettings')}</legend>
        <div className="gazette-admin-grid">
          <label>{t('gazette.titleLabel')}<input value={draft.title} maxLength={80} required onChange={event => change({ title: event.target.value })} /></label>
          <label>{t('gazette.retention')}<span className="gazette-admin-unit"><input type="number" inputMode="numeric" min={GAZETTE_LIMITS.retentionMin} max={GAZETTE_LIMITS.retentionMax} value={draft.retentionDays} onChange={event => change({ retentionDays: Math.max(GAZETTE_LIMITS.retentionMin, Math.min(GAZETTE_LIMITS.retentionMax, Number(event.target.value) || 1)) })} /><span>{t('gazette.days')}</span></span></label>
          <label>{t('gazette.timeZone')}<select value={draft.timeZone} onChange={event => change({ timeZone: event.target.value as Settings['timeZone'] })}>{[...new Set([draft.timeZone, ...timeZones()])].map(zone => <option key={zone} value={zone}>{zone}</option>)}</select></label>
          <label>{t('gazette.dashboardHeadlines')}<input type="number" inputMode="numeric" min={0} max={8} value={draft.dashboardHeadlines} onChange={event => change({ dashboardHeadlines: Math.max(0, Math.min(8, Number(event.target.value) || 0)) })} /></label>
        </div>
        <p className="muted gazette-admin-note">{t('gazette.retentionNote')}</p>
      </fieldset>

      <fieldset className="card gazette-admin-card" disabled={busy}>
        <legend>{t('gazette.sectionsHeading')}</legend>
        <ol className="plain-list gazette-admin-sections">
          {sections.map((section, index) => {
            const expanded = open === section.id;
            return (
              <li key={section.id} className={section.enabled ? 'gazette-admin-section' : 'gazette-admin-section gazette-admin-off'}>
                <div className="gazette-admin-row">
                  <span className="gazette-section-icon"><UiIcon name={gazetteIcon(section.icon)} /></span>
                  <span className="gazette-admin-name"><b>{section.title}</b><small className="muted">{t(`gazette.type.${section.type}`)}{section.enabled ? '' : ` · ${t('gazette.hidden')}`}</small></span>
                  <button type="button" className="icon-button" aria-pressed={section.enabled} aria-label={t(section.enabled ? 'gazette.hideSection' : 'gazette.showSection', { title: section.title })} title={t(section.enabled ? 'gazette.hideSection' : 'gazette.showSection', { title: section.title })} onClick={() => changeSection(section.id, { enabled: !section.enabled })}><UiIcon name={section.enabled ? 'gazetteShown' : 'gazetteHidden'} /></button>
                  <button type="button" className="icon-button" disabled={index === 0} aria-label={t('gazette.moveUp', { title: section.title })} title={t('gazette.moveUp', { title: section.title })} onClick={() => move(index, -1)}><UiIcon name="moveUp" /></button>
                  <button type="button" className="icon-button" disabled={index === sections.length - 1} aria-label={t('gazette.moveDown', { title: section.title })} title={t('gazette.moveDown', { title: section.title })} onClick={() => move(index, 1)}><UiIcon name="moveDown" /></button>
                  <button type="button" className="icon-button" aria-expanded={expanded} aria-controls={`${id}-${section.id}`} aria-label={t('gazette.editSection', { title: section.title })} title={t('gazette.editSection', { title: section.title })} onClick={() => setOpen(expanded ? null : section.id)}><UiIcon name="edit" /></button>
                </div>
                {expanded && (
                  <div id={`${id}-${section.id}`} className="gazette-admin-detail">
                    <div className="gazette-admin-grid">
                      <label>{t('gazette.sectionTitle')}<input value={section.title} maxLength={60} required onChange={event => changeSection(section.id, { title: event.target.value })} /></label>
                      <label>{t('gazette.sectionSubtitle')}<input value={section.subtitle} maxLength={120} onChange={event => changeSection(section.id, { subtitle: event.target.value })} /></label>
                      <label>{t('gazette.sectionLanguage')}<input value={section.language} maxLength={6} pattern="[a-z]{2,3}(-[A-Z]{2})?" onChange={event => changeSection(section.id, { language: event.target.value })} /></label>
                    </div>
                    <div className="gazette-admin-icons" role="radiogroup" aria-label={t('gazette.sectionIcon')}>
                      {GAZETTE_ICONS.map((icon: GazetteIcon) => (
                        <button key={icon} type="button" role="radio" aria-checked={section.icon === icon} aria-label={icon} className={section.icon === icon ? 'icon-button gazette-admin-icon-on' : 'icon-button'} onClick={() => changeSection(section.id, { icon })}><UiIcon name={gazetteIcon(icon)} /></button>
                      ))}
                    </div>
                    <label className="row"><input type="checkbox" checked={section.dashboard} onChange={event => changeSection(section.id, { dashboard: event.target.checked })} />{t('gazette.onDashboard')}</label>
                    <label className="row"><input type="checkbox" checked={section.collapsed} onChange={event => changeSection(section.id, { collapsed: event.target.checked })} />{t('gazette.startFolded')}</label>
                    <label>{t('gazette.sectionBrief')}<textarea rows={3} maxLength={2000} value={section.brief} onChange={event => changeSection(section.id, { brief: event.target.value })} /></label>
                    <p className="muted gazette-admin-note">{t('gazette.sectionIdNote', { id: section.id })}</p>
                    <button type="button" className="icon-button gazette-admin-remove" aria-label={t('gazette.removeSection', { title: section.title })} title={t('gazette.removeSection', { title: section.title })} onClick={() => { change({ sections: sections.filter(each => each.id !== section.id) }); setOpen(null); }}><UiIcon name="trash" /></button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        <div className="gazette-admin-add">
          <label className="gazette-admin-add-title">{t('gazette.newSection')}<input value={adding.title} maxLength={60} placeholder={t('gazette.newSectionPlaceholder')} onChange={event => setAdding({ ...adding, title: event.target.value })} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} /></label>
          <label>{t('gazette.sectionType')}<select value={adding.type} onChange={event => setAdding({ ...adding, type: event.target.value as GazetteSectionType })}>{GAZETTE_SECTION_TYPES.map(type => <option key={type} value={type}>{t(`gazette.type.${type}`)}</option>)}</select></label>
          <button type="button" className="icon-button gazette-admin-add-button" disabled={adding.title.trim() === '' || sections.length >= GAZETTE_LIMITS.sections} aria-label={t('gazette.addSection')} title={t('gazette.addSection')} onClick={add}><UiIcon name="add" /></button>
        </div>
      </fieldset>
    </form>
  );
}
