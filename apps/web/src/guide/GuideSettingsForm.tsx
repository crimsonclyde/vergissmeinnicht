import { useState, type CSSProperties } from 'react';
import { DEFAULT_GUIDE_PREFERENCES, GUIDE_CARD_STYLES, GUIDE_LAYOUTS, type GuideCardStyle, type GuideLayout, type GuidePreferences, type GuidePreferencesChange } from '@vergissmeinnicht/domain';
import { messageFor } from '../api.ts';
import { t, type MessageKey } from '../i18n/index.ts';
import { usePreferences } from '../preferences.tsx';
import { GUIDE_CARD_ART } from './card-art.ts';

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
      <fieldset disabled={locked}>
        <legend>{legend}</legend>
        <p className="muted">{t('guide.settingsHint')}</p>
        <p className="muted">{t('guide.layoutHint')}</p>
        {GUIDE_LAYOUTS.map((layout) => (
          <label key={layout} className="check-label">
            <input type="radio" name="guide-layout" value={layout} checked={draft.layout === layout} onChange={() => setDraft({ ...draft, layout })} />
            {t(LAYOUT_LABEL[layout])}
          </label>
        ))}
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
        <label>
          {t('guide.opacity')} · {draft.cardOpacity}%
          <input type="range" min={0} max={100} step={1} value={draft.cardOpacity} onChange={(event) => setDraft({ ...draft, cardOpacity: Number(event.target.value) })} />
        </label>
        <label className="check-label">
          <input type="checkbox" checked={draft.images} onChange={(event) => setDraft({ ...draft, images: event.target.checked })} />
          {t('guide.images')}
        </label>
        <div className="guide-card-preview" data-card-style={draft.cardStyle} style={{ '--guide-card-opacity': `${draft.cardOpacity}%`, '--guide-card-art': GUIDE_CARD_ART[draft.cardStyle] } as CSSProperties}>
          <span>{t('guide.preview')}</span>
        </div>
        <div className="row">
          <button type="submit" className="primary">
            {t('guide.save')}
          </button>
          <button type="button" onClick={cancel}>
            {t('common.cancel')}
          </button>
          <button type="button" onClick={() => setDraft(DEFAULT_GUIDE_PREFERENCES)}>
            {t('guide.reset')}
          </button>
        </div>
      </fieldset>
      {message !== null && <p role="alert">{message}</p>}
      {done && <p role="status">{t('guide.saved')}</p>}
    </form>
  );
}
