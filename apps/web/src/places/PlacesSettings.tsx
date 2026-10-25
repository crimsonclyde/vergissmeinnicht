import {
  PLACE_BLUR_MAX,
  PLACE_OVERLAY_MAX,
  PLACE_OVERLAY_MIN,
  PLACE_VIGNETTE_MAX,
  type PlaceBackground,
  type PlaceFocus,
  type PlacePreferences,
} from '@vergissmeinnicht/domain';
import { useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { messageFor, type WorkspaceSummary } from '../api.ts';
import { t, type MessageKey } from '../i18n/index.ts';
import { preparePlaceBackground } from '../image-prep.ts';
import { Link, paths } from '../router.tsx';
import { imageErrorMessage } from '../StepImage.tsx';
import { UiIcon, type UiIconName } from '../ui-icons.tsx';
import { placeLight } from './atmosphere.ts';
import { placeLook } from './look.ts';
import { PlaceBackdrop } from './PlaceBackdrop.tsx';
import { useSlowClock, useWorkspaceClock } from './PlaceScene.tsx';
import { usePlaceSettings } from './settings-store.ts';
import type { PlaceConfig } from './types.ts';

const BACKGROUNDS: readonly { value: PlaceBackground; icon: UiIconName; label: MessageKey }[] = [
  { value: 'illustration', icon: 'illustration', label: 'places.background.illustration' },
  { value: 'photo', icon: 'photo', label: 'places.background.photo' },
  { value: 'none', icon: 'noImage', label: 'places.background.none' },
];

const same = (a: PlacePreferences, b: PlacePreferences) => JSON.stringify(a) === JSON.stringify(b);
const clampPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

/**
 * Profile & settings → Places (section 30): the person's own look of the Workspace being used, only
 * while that Workspace shows a Places theme. It never changes the place (that is the theme, chosen in
 * Appearance), the Workspace, or anyone else's view. Changes are previewed first and kept only with Save;
 * Cancel returns to what is saved. The photo itself is stored as soon as it is uploaded (privately).
 */
export function PlacesSettings({ userId, workspace, config }: { userId: string; workspace: WorkspaceSummary | null; config: PlaceConfig | null }) {
  if (workspace === null || config === null) {
    return (
      <div className="card">
        <p>{t('places.notActive')}</p>
        <Link href={paths.account('appearance')}>{t('places.toAppearance')}</Link>
      </div>
    );
  }
  return <Editor key={`${userId}:${workspace.id}`} userId={userId} workspace={workspace} config={config} />;
}

function Editor({ userId, workspace, config }: { userId: string; workspace: WorkspaceSummary; config: PlaceConfig }) {
  const id = useId();
  const handle = usePlaceSettings(userId, workspace.id);
  const saved = handle.settings.preferences;
  const [draft, setDraft] = useState<PlacePreferences>(saved);
  const [frame, setFrame] = useState<'desktop' | 'mobile'>(() => (window.matchMedia?.('(max-width: 37.5rem)').matches ? 'mobile' : 'desktop'));
  const [busy, setBusy] = useState<'save' | 'upload' | 'reset' | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [message, setMessage] = useState<{ kind: 'alert' | 'status'; text: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const clock = useWorkspaceClock(workspace.id, true);
  const now = useSlowClock();

  // When the account answers (or after Save/Reset), an untouched draft follows the saved settings.
  // (Adjusted while rendering, as React recommends for state derived from a changed value.)
  const [base, setBase] = useState(saved);
  if (!same(base, saved)) {
    setBase(saved);
    setDraft((current) => (same(current, base) ? saved : current));
  }

  const dirty = !same(draft, saved);
  const photo = handle.settings.photo;
  const look = placeLook(config, { preferences: draft, photo }, workspace.id);
  const light = placeLight(now, clock, null);
  const focusKey = frame === 'mobile' ? 'focusMobile' : 'focusDesktop';
  const focus = frame === 'mobile' ? look.focusMobile : look.focusDesktop;
  const showsImage = look.background !== 'none';
  const change = (changes: Partial<PlacePreferences>) => {
    setMessage(null);
    setDraft((current) => ({ ...current, ...changes }));
  };
  const setFocus = (next: PlaceFocus) => change({ [focusKey]: { x: clampPercent(next.x), y: clampPercent(next.y) } } as Partial<PlacePreferences>);

  async function save() {
    setBusy('save');
    setMessage(null);
    try {
      await handle.save(draft);
      setMessage({ kind: 'status', text: t('places.saved') });
    } catch (caught) {
      // The previous settings stay as they were (on the account and on the page).
      setMessage({ kind: 'alert', text: messageFor(caught) });
    } finally {
      setBusy(null);
    }
  }

  async function upload(file: File) {
    setBusy('upload');
    setMessage(null);
    try {
      const prepared = await preparePlaceBackground(file);
      if (prepared.kind === 'too_large') {
        setMessage({ kind: 'alert', text: t('error.image_too_large') });
        return;
      }
      await handle.upload(prepared.blob);
      change({ background: 'photo', focusDesktop: null, focusMobile: null });
      setMessage({ kind: 'status', text: t('places.photoUploaded') });
    } catch (caught) {
      setMessage({ kind: 'alert', text: imageErrorMessage(caught) });
    } finally {
      setBusy(null);
      if (input.current !== null) input.current.value = '';
    }
  }

  async function removePhoto() {
    setBusy('upload');
    setMessage(null);
    try {
      await handle.removePhoto();
      if (draft.background === 'photo') change({ background: 'illustration', focusDesktop: null, focusMobile: null });
      setMessage({ kind: 'status', text: t('places.photoRemoved') });
    } catch (caught) {
      setMessage({ kind: 'alert', text: messageFor(caught) });
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    setBusy('reset');
    setMessage(null);
    try {
      const settings = await handle.reset();
      setDraft(settings.preferences);
      setBase(settings.preferences);
      setConfirmReset(false);
      setMessage({ kind: 'status', text: t('places.restored') });
    } catch (caught) {
      setMessage({ kind: 'alert', text: messageFor(caught) });
    } finally {
      setBusy(null);
    }
  }

  // Dragging the focal point in the preview (pointer), or moving it with the arrow keys.
  const preview = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const pointAt = (event: PointerEvent<HTMLDivElement>) => {
    const box = preview.current?.getBoundingClientRect();
    if (box === undefined || box.width === 0 || box.height === 0) return;
    setFocus({ x: ((event.clientX - box.left) / box.width) * 100, y: ((event.clientY - box.top) / box.height) * 100 });
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const stepSize = event.shiftKey ? 10 : 2;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-stepSize, 0], ArrowRight: [stepSize, 0], ArrowUp: [0, -stepSize], ArrowDown: [0, stepSize] };
    const move = moves[event.key];
    if (move === undefined) return;
    event.preventDefault();
    setFocus({ x: focus.x + move[0], y: focus.y + move[1] });
  };

  return (
    <div className="place-settings">
      <div className="card stack">
        <div className="place-photo-row">
          <h3 style={{ margin: 0 }}>{t(config.name)}</h3>
          <span className="muted">{t('places.lookOf', { name: workspace.name })}</span>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          {t('places.onlyYou')}
        </p>

        <div className="place-preview-wrap">
          <div className="place-frame-switch" role="group" aria-label={t('places.previewAs')}>
            {(['desktop', 'mobile'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className="icon-button quiet"
                aria-pressed={frame === value}
                aria-label={t(value === 'desktop' ? 'places.previewDesktop' : 'places.previewPhone')}
                title={t(value === 'desktop' ? 'places.previewDesktop' : 'places.previewPhone')}
                onClick={() => setFrame(value)}
              >
                <UiIcon name={value === 'desktop' ? 'desktop' : 'phone'} />
              </button>
            ))}
          </div>
          <div
            ref={preview}
            className="place-preview"
            data-frame={frame}
            onPointerDown={(event) => {
              if (!showsImage) return;
              dragging.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
              pointAt(event);
            }}
            onPointerMove={(event) => dragging.current && pointAt(event)}
            onPointerUp={() => (dragging.current = false)}
            onPointerCancel={() => (dragging.current = false)}
          >
            <PlaceBackdrop look={look} light={light} prominence="today" frame={frame} />
            <div className="place-preview-ui" aria-hidden="true">
              <span className="place-preview-title">{t('shell.today')}</span>
              <div className="place-preview-card">
                <strong>{t('places.previewCard')}</strong>
                <span className="place-preview-row">
                  <span className="place-preview-dot" />
                  {t('places.previewDue')}
                </span>
                <span className="place-preview-row">
                  <span className="place-preview-dot" data-done="true" />
                  <span className="muted">{t('places.previewDone')}</span>
                </span>
                <span className="place-preview-button">{t('places.previewStart')}</span>
              </div>
            </div>
            {showsImage && (
              <div
                className="place-focus"
                role="button"
                tabIndex={0}
                aria-label={t('places.focusPoint', { x: focus.x, y: focus.y })}
                title={t('places.focusHint')}
                style={{ left: `${focus.x}%`, top: `${focus.y}%` }}
                onKeyDown={onKey}
              />
            )}
          </div>
          {showsImage && (
            <div className="place-photo-row" style={{ justifyContent: 'center' }}>
              <small className="muted">{t('places.focusHint')}</small>
              <button
                type="button"
                className="icon-button quiet"
                aria-label={t('places.focusReset')}
                title={t('places.focusReset')}
                disabled={draft[focusKey] === null}
                onClick={() => change({ [focusKey]: null } as Partial<PlacePreferences>)}
              >
                <UiIcon name="focus" />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="card stack">
        <fieldset className="place-choices" aria-label={t('places.background')}>
          {BACKGROUNDS.map((option) => (
            <label key={option.value} className="place-choice">
              <input type="radio" name={`${id}-background`} value={option.value} checked={draft.background === option.value} onChange={() => change({ background: option.value })} />
              <UiIcon name={option.icon} size="1.6em" />
              <span>{t(option.label)}</span>
            </label>
          ))}
        </fieldset>

        {draft.background === 'photo' && (
          <div className="place-photo-row">
            <button type="button" className="icon-button" disabled={busy !== null} aria-label={t(photo === null ? 'places.addPhoto' : 'places.replacePhoto')} title={t(photo === null ? 'places.addPhoto' : 'places.replacePhoto')} onClick={() => input.current?.click()}>
              <UiIcon name={photo === null ? 'upload' : 'replace'} />
            </button>
            {photo !== null && (
              <button type="button" className="icon-button" disabled={busy !== null} aria-label={t('places.removePhoto')} title={t('places.removePhoto')} onClick={() => void removePhoto()}>
                <UiIcon name="trash" />
              </button>
            )}
            <small className="muted">{photo === null ? t('places.noPhotoYet') : t('places.photoPrivate')}</small>
            {busy === 'upload' && <span role="status">{t('places.uploading')}</span>}
          </div>
        )}
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) void upload(file);
          }}
        />

        <div className="place-sliders">
          <Slider icon="overlay" label={t('places.overlay')} value={look.overlay} min={PLACE_OVERLAY_MIN} max={PLACE_OVERLAY_MAX} unit="%" disabled={!showsImage} onChange={(value) => change({ overlay: value })} />
          <Slider icon="blur" label={t('places.blur')} value={look.blur} min={0} max={PLACE_BLUR_MAX} unit="px" disabled={!showsImage} onChange={(value) => change({ blur: value })} />
          <Slider icon="vignette" label={t('places.vignette')} value={look.vignette} min={0} max={PLACE_VIGNETTE_MAX} unit="%" onChange={(value) => change({ vignette: value })} />
          <label className="place-slider">
            <UiIcon name="atmosphere" />
            <span>{t('places.atmosphere')}</span>
            <input type="checkbox" className="switch" checked={draft.atmosphere} onChange={(event) => change({ atmosphere: event.target.checked })} />
          </label>
          <small className="muted">{t('places.atmosphereHint')}</small>
        </div>

        {message !== null && (
          <p role={message.kind} className={message.kind === 'status' ? 'muted' : undefined} style={{ margin: 0 }}>
            {message.text}
          </p>
        )}

        <div className="place-actions">
          <button type="button" className="primary" disabled={!dirty || busy !== null} onClick={() => void save()}>
            <UiIcon name="save" /> {t('places.save')}
          </button>
          <button type="button" disabled={!dirty || busy !== null} onClick={() => setDraft(saved)}>
            {t('common.cancel')}
          </button>
          <span className="spacer" />
          {confirmReset ? (
            <span className="place-photo-row" role="group" aria-label={t('places.restore')}>
              <span>{t('places.restoreConfirm')}</span>
              <button type="button" className="danger" disabled={busy !== null} onClick={() => void reset()}>
                {t('places.restore')}
              </button>
              <button type="button" className="quiet" onClick={() => setConfirmReset(false)}>
                {t('common.cancel')}
              </button>
            </span>
          ) : (
            <button type="button" className="icon-button quiet" aria-label={t('places.restore')} title={t('places.restore')} disabled={busy !== null} onClick={() => setConfirmReset(true)}>
              <UiIcon name="reset" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Slider(props: { icon: UiIconName; label: string; value: number; min: number; max: number; unit: string; disabled?: boolean; onChange: (value: number) => void }): ReactNode {
  const id = useId();
  return (
    <div className="place-slider">
      <UiIcon name={props.icon} />
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        type="range"
        min={props.min}
        max={props.max}
        step={1}
        value={props.value}
        disabled={props.disabled}
        aria-valuetext={`${props.value} ${props.unit}`}
        title={props.label}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
      <output htmlFor={id}>
        {props.value}
        {props.unit}
      </output>
    </div>
  );
}
