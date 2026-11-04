import { useState, type CSSProperties } from 'react';
import { DEFAULT_GUIDE_PREFERENCES, GUIDE_CARD_STYLES, GUIDE_LAYOUTS, type GuideCardStyle, type GuideLayout, type GuidePreferences, type GuidePreferencesChange } from '@vergissmeinnicht/domain';
import { messageFor } from './api.ts';
import { GUIDE_CARD_ART } from './guide/card-art.ts';
import { t, type MessageKey } from './i18n/index.ts';
import { usePreferences } from './preferences.tsx';
import { canonicalThemeMode } from './theme.ts';
import { ThemeOptions } from './ThemeOptions.tsx';
import { UiIcon } from './ui-icons.tsx';
import { WeatherSettings } from './WeatherSettings.tsx';
import type { WorkspaceContext } from './workspace-context.ts';

const LOOK_TABS = ['background', 'theme', 'weather', 'navigation'] as const;
type LookTab = (typeof LOOK_TABS)[number];

const TAB_LABEL = { background: 'look.background', theme: 'look.theme', weather: 'look.weather', navigation: 'look.navigation' } as const satisfies Record<LookTab, MessageKey>;
const CARD_STYLE_LABEL = { glass: 'guide.glass', starfield: 'guide.starfield', forest: 'guide.forest', water: 'guide.water', hearth: 'guide.hearth' } as const satisfies Record<GuideCardStyle, MessageKey>;
const LAYOUT_LABEL = { guide: 'guide.modern', classic: 'guide.classic' } as const satisfies Record<GuideLayout, MessageKey>;

/**
 * A tab's draft of this Workspace's Guide presentation. Edits stay local until Save; Cancel returns to the saved
 * value. Saving sends only the keys that tab owns, and the server keeps the others.
 */
function useGuideDraft(workspaceId: string) {
  const { workspacePreferences, workspacePreferencesSettled, setWorkspaceGuide } = usePreferences();
  const saved = workspacePreferences.guides[workspaceId] ?? DEFAULT_GUIDE_PREFERENCES;
  const [draft, setDraft] = useState<GuidePreferences>(saved);
  const [source, setSource] = useState<GuidePreferences>(saved);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // The draft follows the saved value whenever it changes: the first load, or a save made from this page.
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

/** Card style, card background opacity and decorative images of the Galactic Guide, for this Workspace. */
function BackgroundSettings({ workspaceId }: { workspaceId: string }) {
  const { draft, setDraft, locked, message, done, save, cancel } = useGuideDraft(workspaceId);
  return (
    <form
      className="stack look-form"
      onSubmit={(event) => {
        event.preventDefault();
        save({ cardStyle: draft.cardStyle, cardOpacity: draft.cardOpacity, images: draft.images });
      }}
    >
      <fieldset disabled={locked}>
        <legend>{t('look.background')}</legend>
        <p className="muted">{t('guide.settingsHint')}</p>
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
          <button
            type="button"
            onClick={() => setDraft({ ...draft, cardStyle: DEFAULT_GUIDE_PREFERENCES.cardStyle, cardOpacity: DEFAULT_GUIDE_PREFERENCES.cardOpacity, images: DEFAULT_GUIDE_PREFERENCES.images })}
          >
            {t('guide.reset')}
          </button>
        </div>
      </fieldset>
      {message !== null && <p role="alert">{message}</p>}
      {done && <p role="status">{t('guide.saved')}</p>}
    </form>
  );
}

/** The theme of this Workspace and whether it is the default Workspace; each pick is saved at once. */
function ThemeSettings({ context }: { context: WorkspaceContext }) {
  const { preferences, workspacePreferences, setWorkspaceTheme, setDefaultWorkspace } = usePreferences();
  const [message, setMessage] = useState<string | null>(null);
  const failed = (caught: unknown) => setMessage(messageFor(caught));
  const { id, name } = context.workspace;
  const isDefault = workspacePreferences.defaultWorkspaceId === id;
  const defaultLabel = t(isDefault ? 'appearance.isDefault' : 'appearance.makeDefault', { name });
  return (
    <>
      {message !== null && <p role="alert">{message}</p>}
      <p>
        <button
          type="button"
          className="quiet"
          aria-pressed={isDefault}
          onClick={() => {
            setMessage(null);
            setDefaultWorkspace(isDefault ? null : id).catch(failed);
          }}
        >
          <UiIcon name={isDefault ? 'starFilled' : 'star'} size="1.2em" /> {defaultLabel}
        </button>
      </p>
      <fieldset>
        <legend>{t('appearance.themeFor', { name })}</legend>
        <ThemeOptions
          name={`theme-${id}`}
          current={canonicalThemeMode(workspacePreferences.themes[id] ?? preferences.theme)}
          onPick={(value) => {
            setMessage(null);
            setWorkspaceTheme(id, value).catch(failed);
          }}
        />
      </fieldset>
    </>
  );
}

/** Where the navigation sits for this Workspace: the top bar of the Galactic Guide or the sidebar. */
function NavigationSettings({ workspaceId }: { workspaceId: string }) {
  const { draft, setDraft, locked, message, done, save, cancel } = useGuideDraft(workspaceId);
  return (
    <form
      className="stack look-form"
      onSubmit={(event) => {
        event.preventDefault();
        save({ layout: draft.layout });
      }}
    >
      <fieldset disabled={locked}>
        <legend>{t('look.navigation')}</legend>
        <p className="muted">{t('look.navigationHint')}</p>
        {GUIDE_LAYOUTS.map((layout) => (
          <label key={layout} className="check-label">
            <input type="radio" name="guide-layout" value={layout} checked={draft.layout === layout} onChange={() => setDraft({ ...draft, layout })} />
            {t(LAYOUT_LABEL[layout])}
          </label>
        ))}
        <div className="row">
          <button type="submit" className="primary">
            {t('guide.save')}
          </button>
          <button type="button" onClick={cancel}>
            {t('common.cancel')}
          </button>
          <button type="button" onClick={() => setDraft({ ...draft, layout: DEFAULT_GUIDE_PREFERENCES.layout })}>
            {t('guide.reset')}
          </button>
        </div>
      </fieldset>
      {message !== null && <p role="alert">{message}</p>}
      {done && <p role="status">{t('guide.saved')}</p>}
    </form>
  );
}

/**
 * The Look and layout page of one Workspace (section 28): background, theme, weather and navigation.
 * Only the open tab is mounted, so an unsaved draft on Background or Navigation is discarded when the tab changes.
 */
export function WorkspaceLookSettings({ context }: { context: WorkspaceContext }) {
  const [tab, setTab] = useState<LookTab>('background');
  const id = context.workspace.id;
  return (
    <>
      <p className="muted">{t('look.hint')}</p>
      <div className="segmented" role="group" aria-label={t('look.tabs')}>
        {LOOK_TABS.map((key) => (
          <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)}>
            {t(TAB_LABEL[key])}
          </button>
        ))}
      </div>
      {tab === 'background' && <BackgroundSettings workspaceId={id} />}
      {tab === 'theme' && <ThemeSettings context={context} />}
      {tab === 'weather' && <WeatherSettings />}
      {tab === 'navigation' && <NavigationSettings workspaceId={id} />}
    </>
  );
}
