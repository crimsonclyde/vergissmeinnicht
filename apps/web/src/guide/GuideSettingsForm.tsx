import { useState, type CSSProperties } from 'react';
import { DEFAULT_GUIDE_PREFERENCES, GUIDE_CARD_STYLES, GUIDE_LAYOUTS, type GuideCardStyle, type GuideLayout, type GuidePreferences, type GuidePreferencesChange } from '@vergissmeinnicht/domain';
import { messageFor } from '../api.ts';
import { t, type MessageKey } from '../i18n/index.ts';
import { usePreferences } from '../preferences.tsx';
import { GUIDE_CARD_ART } from './card-art.ts';
import { UiIcon } from '../ui-icons.tsx';

const CARD_STYLE_LABEL = { glass: 'guide.glass', starfield: 'guide.starfield', forest: 'guide.forest', water: 'guide.water', hearth: 'guide.hearth' } as const satisfies Record<GuideCardStyle, MessageKey>;
const LAYOUT_LABEL = { guide: 'guide.modern', classic: 'guide.classic' } as const satisfies Record<GuideLayout, MessageKey>;

/**
 * A form's draft of one Workspace's Guide presentation. Edits stay local until Save; Cancel returns to the saved
 * value. Saving sends every key the form shows.
 */
function useGuideDraft(workspaceId: string) {
  const { workspacePreferences, workspacePreferencesSettled, setWorkspaceGuide } = usePreferences();
  const saved = workspacePreferences.guides[workspaceId] ?? DEFAULT_GUIDE_PREFERENCES;
  const [draft, setDraft] = useState<GuidePreferences>(saved);
  const [source, setSource] = useState<GuidePreferences>(saved);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // The draft follows the saved value whenever it changes: the first load, or a save made from this form.
  if (source !== saved) {
    setSource(saved);
    setDraft(saved);
  }
  const save = (changes: GuidePreferencesChange) => {
    setBusy(true);
    setMessage(null);
    setDone(false);
    void setWorkspaceGuide(workspaceId, changes)
      .then(
        () => setDone(true),
        (caught: unknown) => setMessage(messageFor(caught)),
      )
      .finally(() => setBusy(false));
  };
  const cancel = () => {
    setDraft(saved);
    setMessage(null);
    setDone(false);
  };
  return { draft, setDraft, locked: busy || !workspacePreferencesSettled, message, done, save, cancel };
}

/**
 * The Galactic Guide presentation of one Workspace, for this person: the layout (top bar or sidebar), the card
 * background style and opacity, and decorative images. Set on the account Appearance page for the Workspace picked there.
 */
export function GuideSettingsForm({ workspaceId, legend }: { workspaceId: string; legend: string }) {
  const { draft, setDraft, locked, message, done, save, cancel } = useGuideDraft(workspaceId);
  return (
    <form
      className="stack guide-form"
      onSubmit={(event) => {
        event.preventDefault();
        save({ layout: draft.layout, cardStyle: draft.cardStyle, cardOpacity: draft.cardOpacity, images: draft.images });
      }}
    >
      <fieldset disabled={locked} aria-label={legend}>
        <legend><UiIcon name="layout" /> {t('appearance.cards')}</legend>
        <div className="appearance-heading">
          <div className="appearance-layout-options" role="group" aria-label={t('guide.layoutHint')}>
            {GUIDE_LAYOUTS.map((layout) => (
              <label key={layout} className="appearance-layout-option" title={t(LAYOUT_LABEL[layout])}>
                <input type="radio" name="guide-layout" aria-label={t(LAYOUT_LABEL[layout])} value={layout} checked={draft.layout === layout} onChange={() => setDraft({ ...draft, layout })} />
                <UiIcon name={layout === 'guide' ? 'navigationTop' : 'navigationSide'} size={24} />
                <span>{t(layout === 'guide' ? 'appearance.navigationTop' : 'appearance.navigationSide')}</span>
              </label>
            ))}
          </div>
          <details className="appearance-help">
            <summary aria-label={t('appearance.cardsHelp')} title={t('appearance.cardsHelp')}><UiIcon name="info" /></summary>
            <p>{t('guide.settingsHint')}</p>
          </details>
        </div>
        <label>
          {t('guide.style')}
          <select
            aria-label={t('guide.style')}
            value={draft.cardStyle}
            onChange={(event) => setDraft({ ...draft, cardStyle: GUIDE_CARD_STYLES.find((style) => style === event.target.value) ?? DEFAULT_GUIDE_PREFERENCES.cardStyle })}
          >
            {GUIDE_CARD_STYLES.map((style) => (
              <option key={style} value={style}>
                {t(CARD_STYLE_LABEL[style])}
              </option>
            ))}
          </select>
        </label>
        <label className="appearance-opacity">
          <span><UiIcon name="contrast" /> {t('appearance.opacity')} <span className="appearance-opacity-value">{draft.cardOpacity}%</span></span>
          <input aria-label={t('guide.opacity')} type="range" min={0} max={100} step={1} value={draft.cardOpacity} onChange={(event) => setDraft({ ...draft, cardOpacity: Number(event.target.value) })} />
        </label>
        <div className="appearance-illustration-row">
          <label className="check-label">
            <input type="checkbox" aria-label={t('guide.images')} checked={draft.images} onChange={(event) => setDraft({ ...draft, images: event.target.checked })} />
            <UiIcon name="photo" /> <span title={t('guide.images')}>{t('appearance.illustrations')}</span>
          </label>
          <div className="guide-card-preview appearance-card-preview" role="img" aria-label={t('guide.preview')} data-card-style={draft.cardStyle} style={{ '--guide-card-opacity': `${draft.cardOpacity}%`, '--guide-card-art': GUIDE_CARD_ART[draft.cardStyle] } as CSSProperties}>
            <UiIcon name="layout" size={28} />
          </div>
        </div>
        <div className="appearance-actions">
          <button type="submit" className="primary icon-button appearance-icon-action" aria-label={t('guide.save')} title={t('guide.save')}>
            <UiIcon name="save" size={24} />
          </button>
          <button type="button" className="quiet icon-button appearance-icon-action" aria-label={t('common.cancel')} title={t('common.cancel')} onClick={cancel}>
            <UiIcon name="close" size={24} />
          </button>
          <button type="button" className="quiet icon-button appearance-icon-action" aria-label={t('guide.reset')} title={t('guide.reset')} onClick={() => setDraft(DEFAULT_GUIDE_PREFERENCES)}>
            <UiIcon name="reset" size={24} />
          </button>
        </div>
      </fieldset>
      {message !== null && <p role="alert">{message}</p>}
      {done && <p role="status">{t('guide.saved')}</p>}
    </form>
  );
}
