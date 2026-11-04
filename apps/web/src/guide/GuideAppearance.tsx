import { DEFAULT_GUIDE_PREFERENCES, GUIDE_CARD_STYLES, type GuideCardStyle } from '@vergissmeinnicht/domain';
import { useState, type CSSProperties } from 'react';
import { messageFor } from '../api.ts';
import { t, type MessageKey } from '../i18n/index.ts';
import { usePreferences } from '../preferences.tsx';
import { GUIDE_CARD_ART } from './card-art.ts';

const CARD_STYLE_LABEL = { glass: 'guide.glass', starfield: 'guide.starfield', forest: 'guide.forest', water: 'guide.water', hearth: 'guide.hearth' } as const satisfies Record<GuideCardStyle, MessageKey>;

export function GuideAppearance() {
  const { preferences, preferencesSettled, update } = usePreferences();
  const [draft, setDraft] = useState(preferences.guide);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Synchronize a late initial load only while the user has not started editing.
  const [source, setSource] = useState(preferences.guide);
  if (source !== preferences.guide) { setSource(preferences.guide); setDraft(preferences.guide); }
  return <form className="stack guide-appearance" onSubmit={event => { event.preventDefault(); setBusy(true); setMessage(null); setSaved(false); void update({ guide: draft }).then(() => setSaved(true), caught => setMessage(messageFor(caught))).finally(() => setBusy(false)); }}>
    <fieldset disabled={busy || !preferencesSettled}><legend>{t('guide.appearance')}</legend><p className="muted">{t('guide.settingsHint')}</p>
      <label>{t('guide.layout')}<select aria-label={t('guide.layout')} value={draft.layout} onChange={event => setDraft({ ...draft, layout: event.target.value === 'classic' ? 'classic' : 'guide' })}><option value="guide">{t('guide.modern')}</option><option value="classic">{t('guide.classic')}</option></select></label>
      <label>{t('guide.style')}<select aria-label={t('guide.style')} value={draft.cardStyle} onChange={event => setDraft({ ...draft, cardStyle: GUIDE_CARD_STYLES.find(style => style === event.target.value) ?? 'glass' })}>{GUIDE_CARD_STYLES.map(style => <option key={style} value={style}>{t(CARD_STYLE_LABEL[style])}</option>)}</select></label>
      <label>{t('guide.opacity')} · {draft.cardOpacity}%<input type="range" min={0} max={100} step={1} value={draft.cardOpacity} onChange={event => setDraft({ ...draft, cardOpacity: Number(event.target.value) })} /></label>
      <label className="check-label"><input type="checkbox" checked={draft.images} onChange={event => setDraft({ ...draft, images: event.target.checked })} />{t('guide.images')}</label>
      <div className="guide-card-preview" data-card-style={draft.cardStyle} style={{ '--guide-card-opacity': `${draft.cardOpacity}%`, '--guide-card-art': GUIDE_CARD_ART[draft.cardStyle] } as CSSProperties}><span>{t('guide.preview')}</span></div>
      <div className="row"><button type="submit" className="primary">{t('guide.save')}</button><button type="button" onClick={() => { setDraft(preferences.guide); setMessage(null); setSaved(false); }}>{t('common.cancel')}</button><button type="button" onClick={() => setDraft(DEFAULT_GUIDE_PREFERENCES)}>{t('guide.reset')}</button></div>
    </fieldset>
    {message !== null && <p role="alert">{message}</p>}{saved && <p role="status">{t('guide.saved')}</p>}
  </form>;
}
