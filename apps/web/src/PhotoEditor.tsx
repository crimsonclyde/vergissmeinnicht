import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { formatNumber, t } from './i18n/index.ts';
import { fittedSize } from './image-prep.ts';
import { clampLight, clampStraighten, drawEdited, frameSize, lightFilter, MAX_LIGHT_PERCENT, MAX_STRAIGHTEN_DEGREES, moveCrop, NO_EDIT, resizeCrop, turn, type Corner, type Crop, type PhotoEdit } from './photo-edit.ts';
import { UiIcon } from './ui-icons.tsx';

/** Preview resolution: enough for a sharp screen image without drawing 48 MP on every change. */
const PREVIEW_MAX_EDGE = 1200;
/** Keyboard step for moving or resizing the crop, as a fraction of the photo. */
const KEY_STEP = 0.02;
const CORNERS: readonly Corner[] = ['nw', 'ne', 'sw', 'se'];

/** Which value the one slider changes (23.7): straightening, brightness or contrast. */
type Adjusting = 'straighten' | 'brightness' | 'contrast';
const ADJUSTMENTS: readonly { readonly key: Adjusting; readonly icon: 'straighten' | 'brightness' | 'contrast' }[] = [
  { key: 'straighten', icon: 'straighten' },
  { key: 'brightness', icon: 'brightness' },
  { key: 'contrast', icon: 'contrast' },
];

type Drag = { readonly kind: 'move' | Corner; readonly pointerId: number; readonly startX: number; readonly startY: number; readonly start: Crop };

/**
 * Crop and rotate a photo before it is uploaded (steps.md 23.3): quarter turns, straightening by a
 * few degrees, a crop frame with corner handles (also by keyboard), Reset, Cancel and Done. Done opens
 * focused so an unchanged photo costs one tap. All drawing happens on this device; the result goes
 * through the normal upload, which the server checks and re-encodes.
 */
export function PhotoEditor(props: { image: HTMLImageElement; busy?: boolean; onDone: (edit: PhotoEdit) => void; onCancel: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const done = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const sliderId = useId();
  const cropHintId = useId();
  const [edit, setEdit] = useState<PhotoEdit>(NO_EDIT);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [adjusting, setAdjusting] = useState<Adjusting>('straighten');
  const [stageBox, setStageBox] = useState<{ width: number; height: number } | null>(null);
  const source = { width: props.image.naturalWidth, height: props.image.naturalHeight };
  const frame = frameSize(source.width, source.height, edit.quarterTurns);

  useEffect(() => {
    const element = dialog.current;
    if (element !== null && !element.open) element.showModal();
    done.current?.focus();
  }, []);

  // The stage's free space decides the preview's on-screen size (the photo fits inside it).
  useLayoutEffect(() => {
    const element = stage.current;
    if (element === null) return;
    // clientWidth/Height include the padding, which keeps the corner handles on screen.
    const measure = () => {
      const style = getComputedStyle(element);
      const width = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const height = element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      setStageBox({ width: Math.max(1, width), height: Math.max(1, height) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Redraw the whole turned and straightened photo; the crop is drawn on top as an element.
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (element == null || context == null) return;
    const size = fittedSize(frame.width, frame.height, PREVIEW_MAX_EDGE);
    element.width = size.width;
    element.height = size.height;
    // The whole frame: no crop, scaled from frame pixels to preview pixels.
    drawEdited(context, props.image, source, edit, size, true);
    // Only turning and straightening change the preview; moving the crop does not redraw.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.image, edit.quarterTurns, edit.straighten]);

  const shown =
    stageBox === null
      ? null
      : (() => {
          const scale = Math.min(stageBox.width / frame.width, stageBox.height / frame.height);
          return { width: Math.max(1, Math.floor(frame.width * scale)), height: Math.max(1, Math.floor(frame.height * scale)) };
        })();

  const setCrop = (crop: Crop) => setEdit((current) => ({ ...current, crop }));

  const startDrag = (kind: Drag['kind']) => (event: PointerEvent<HTMLElement>) => {
    if (props.busy === true) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ kind, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, start: edit.crop });
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (drag === null || event.pointerId !== drag.pointerId || shown === null) return;
    const dx = (event.clientX - drag.startX) / shown.width;
    const dy = (event.clientY - drag.startY) / shown.height;
    setCrop(drag.kind === 'move' ? moveCrop(drag.start, dx, dy, frame) : resizeCrop(drag.start, drag.kind, dx, dy, frame));
  };
  const endDrag = (event: PointerEvent<HTMLElement>) => {
    if (drag !== null && event.pointerId === drag.pointerId) setDrag(null);
  };

  const onCropKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, [number, number]> = { ArrowLeft: [-KEY_STEP, 0], ArrowRight: [KEY_STEP, 0], ArrowUp: [0, -KEY_STEP], ArrowDown: [0, KEY_STEP] };
    const delta = step[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    // Shift + arrows resize from the bottom-right corner; arrows alone move the frame.
    setCrop(event.shiftKey ? resizeCrop(edit.crop, 'se', delta[0], delta[1], frame) : moveCrop(edit.crop, delta[0], delta[1], frame));
  };

  const { crop } = edit;
  const percent = (value: number) => `${value * 100}%`;
  return (
    <dialog
      ref={dialog}
      className="image-viewer photo-editor"
      aria-labelledby={headingId}
      onCancel={(event) => {
        event.preventDefault();
        if (props.busy !== true) props.onCancel();
      }}
    >
      <div className="image-viewer-bar">
        <button type="button" className="icon-button" aria-label={t('photoEditor.cancel')} title={t('photoEditor.cancel')} disabled={props.busy} onClick={props.onCancel}>
          <UiIcon name="close" />
        </button>
        <h2 id={headingId}>{t('photoEditor.title')}</h2>
        <button ref={done} type="button" className="primary" disabled={props.busy} onClick={() => props.onDone(edit)}>
          <UiIcon name="check" /> {t('photoEditor.done')}
        </button>
      </div>
      <div ref={stage} className="photo-editor-stage">
        <div
          className="photo-editor-photo"
          style={shown === null ? { visibility: 'hidden' } : { width: shown.width, height: shown.height }}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <canvas ref={canvas} aria-hidden="true" style={{ filter: lightFilter(edit) }} />
          <div
            className="photo-editor-crop"
            role="group"
            tabIndex={0}
            aria-label={t('photoEditor.crop')}
            aria-describedby={cropHintId}
            style={{ left: percent(crop.x), top: percent(crop.y), width: percent(crop.width), height: percent(crop.height) }}
            onPointerDown={startDrag('move')}
            onKeyDown={onCropKey}
          >
            {CORNERS.map((corner) => (
              <span key={corner} className={`photo-editor-handle photo-editor-handle-${corner}`} aria-hidden="true" onPointerDown={startDrag(corner)} />
            ))}
          </div>
        </div>
      </div>
      <p id={cropHintId} className="visually-hidden">
        {t('photoEditor.cropHint')}
      </p>
      <div className="photo-editor-tools">
        <div className="row icon-group">
          <button type="button" className="icon-button" aria-label={t('photoEditor.turnLeft')} title={t('photoEditor.turnLeft')} disabled={props.busy} onClick={() => setEdit((current) => turn(current, -1))}>
            <UiIcon name="turnLeft" />
          </button>
          <button type="button" className="icon-button" aria-label={t('photoEditor.turnRight')} title={t('photoEditor.turnRight')} disabled={props.busy} onClick={() => setEdit((current) => turn(current, 1))}>
            <UiIcon name="turnRight" />
          </button>
        </div>
        <div className="row icon-group" role="group" aria-label={t('photoEditor.adjust')}>
          {ADJUSTMENTS.map((choice) => (
            <button
              key={choice.key}
              type="button"
              className="icon-button"
              aria-pressed={adjusting === choice.key}
              aria-label={t(`photoEditor.${choice.key}`)}
              title={t(`photoEditor.${choice.key}`)}
              disabled={props.busy}
              onClick={() => setAdjusting(choice.key)}
            >
              <UiIcon name={choice.icon} />
            </button>
          ))}
        </div>
        <label htmlFor={sliderId} className="photo-editor-straighten">
          <span>{t(`photoEditor.${adjusting}`)}</span>
          {adjusting === 'straighten' ? (
            <input
              id={sliderId}
              type="range"
              min={-MAX_STRAIGHTEN_DEGREES}
              max={MAX_STRAIGHTEN_DEGREES}
              step={0.5}
              value={edit.straighten}
              disabled={props.busy}
              aria-valuetext={t('photoEditor.degrees', { value: formatNumber(edit.straighten, 1) })}
              onChange={(event) => {
                const straighten = clampStraighten(Number(event.target.value));
                setEdit((current) => ({ ...current, straighten }));
              }}
            />
          ) : (
            <input
              id={sliderId}
              key={adjusting}
              type="range"
              min={-MAX_LIGHT_PERCENT}
              max={MAX_LIGHT_PERCENT}
              step={1}
              value={edit[adjusting]}
              disabled={props.busy}
              aria-valuetext={t('photoEditor.percent', { value: formatSigned(edit[adjusting]) })}
              onChange={(event) => {
                const value = clampLight(Number(event.target.value));
                setEdit((current) => ({ ...current, [adjusting]: value }));
              }}
            />
          )}
          <output aria-hidden="true">{adjusting === 'straighten' ? `${formatNumber(edit.straighten, 1)}°` : `${formatSigned(edit[adjusting])} %`}</output>
        </label>
        <button type="button" className="icon-button" aria-label={t('photoEditor.reset')} title={t('photoEditor.reset')} disabled={props.busy} onClick={() => setEdit(NO_EDIT)}>
          <UiIcon name="reset" />
        </button>
      </div>
    </dialog>
  );
}

/** +12 / −5 / 0 for the light sliders. */
const formatSigned = (value: number) => (value > 0 ? `+${formatNumber(value, 0)}` : value < 0 ? `−${formatNumber(-value, 0)}` : '0');
