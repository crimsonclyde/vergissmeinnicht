import { useEffect, useId, useRef, useState } from 'react';
import { ApiError, api, imageUrl, messageFor, type ImageUsage, type StepImageRef } from './api.ts';
import { formatBytes } from './document-model.ts';
import { formatNumber, hasMessage, t } from './i18n/index.ts';
import { decodeImage, encodeEdited, MAX_UPLOAD_BYTES, originalUpload } from './image-prep.ts';
import { PhotoEditor } from './PhotoEditor.tsx';
import { GalleryPicker } from './PhotoGallery.tsx';
import type { PhotoEdit } from './photo-edit.ts';
import { UiIcon } from './ui-icons.tsx';
import { offlineStore } from './offline/store.ts';

const MB = 1_000_000;
/** Megabytes for storage figures: one decimal below 10 MB. */
export const formatMegabytes = (bytes: number) => formatNumber(bytes / MB, bytes < 10 * MB ? 1 : 0);

/** User-facing text for a refused upload: the exact reason where there is one. */
export function imageErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code === 'image_rejected') {
    const key = `image.rejected.${String(error.details.reason)}`;
    if (hasMessage(key)) return t(key);
  }
  // One storage limit for the whole Workspace (16.4): the same words as for a Document.
  if (error instanceof ApiError && error.code === 'storage_full' && typeof error.details.usedBytes === 'number' && typeof error.details.limitBytes === 'number') {
    return t('error.storage_full_detail', { used: formatBytes(error.details.usedBytes), limit: formatBytes(error.details.limitBytes) });
  }
  return messageFor(error);
}

const VIEWER_STATE = 'vmnImageViewer';

/** Images of Runs already loaded in this page (Steps re-render often during execution). */
const runImages = new Map<string, Promise<Blob | null>>();

/** From the server (and kept on the device), else the device copy, else null. Images never change under an id. */
function loadForRun(userId: string, workspaceId: string, imageId: string): Promise<Blob | null> {
  const key = `${userId}:${workspaceId}:${imageId}`;
  const known = runImages.get(key);
  if (known !== undefined) return known;
  const loading = (async () => {
    try {
      const response = await fetch(imageUrl(workspaceId, imageId), { credentials: 'same-origin' });
      if (!response.ok) throw new Error(String(response.status));
      const blob = await response.blob();
      void offlineStore.saveImage(userId, workspaceId, imageId, blob);
      return blob;
    } catch {
      runImages.delete(key); // try the server again next time
      return (await offlineStore.loadImage(userId, workspaceId, imageId)) ?? null;
    }
  })();
  runImages.set(key, loading);
  return loading;
}

/**
 * The source of an image: the server, or — for Runs saved on this device — the offline copy. Images of
 * a Run are stored on the device while online, so they can be shown offline later.
 */
function useImageSource(workspaceId: string, imageId: string, offlineUserId: string | undefined): { src: string | null; missing: boolean } {
  const key = `${offlineUserId ?? ''}:${workspaceId}:${imageId}`;
  const [loaded, setLoaded] = useState<{ key: string; src: string | null } | null>(null);
  useEffect(() => {
    if (offlineUserId === undefined) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    void loadForRun(offlineUserId, workspaceId, imageId).then((blob) => {
      if (cancelled) return;
      objectUrl = blob === null ? null : URL.createObjectURL(blob);
      setLoaded({ key, src: objectUrl });
    });
    return () => {
      cancelled = true;
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [key, workspaceId, imageId, offlineUserId]);
  if (offlineUserId === undefined) return { src: imageUrl(workspaceId, imageId), missing: false };
  if (loaded?.key !== key) return { src: null, missing: false };
  return { src: loaded.src, missing: loaded.src === null };
}

/**
 * A Step's photo: a thumbnail with its caption (the caption is also the alternative text); tapping it
 * opens the photo full-screen. `offlineUserId`: keep a copy on this device (Run execution).
 */
export function StepImage(props: { workspaceId: string; image: StepImageRef; offlineUserId?: string | undefined }) {
  const { src, missing } = useImageSource(props.workspaceId, props.image.id, props.offlineUserId);
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  // Back closes the viewer (phones): opening adds a history entry for the same page, and going back
  // closes the dialog; closing it otherwise (Escape, button) removes that entry again.
  useEffect(() => {
    const onBack = () => {
      if (dialog.current?.open === true) dialog.current.close();
    };
    window.addEventListener('popstate', onBack);
    return () => window.removeEventListener('popstate', onBack);
  }, []);
  const openViewer = () => {
    dialog.current?.showModal();
    window.history.pushState({ [VIEWER_STATE]: true }, '', window.location.href);
  };
  const onViewerClosed = () => {
    if ((window.history.state as Record<string, unknown> | null)?.[VIEWER_STATE] === true) window.history.back();
  };
  if (missing) {
    return (
      <figure className="step-image">
        <p className="step-image-missing">{t('image.notOffline')}</p>
        <figcaption>{props.image.caption}</figcaption>
      </figure>
    );
  }
  return (
    <figure className="step-image">
      <button type="button" className="step-image-open" onClick={openViewer} aria-label={t('image.open', { caption: props.image.caption === '' ? t('image.noCaption') : props.image.caption })}>
        {src !== null && <img src={src} alt={props.image.caption === '' ? t('image.noCaption') : props.image.caption} loading="lazy" decoding="async" />}
      </button>
      <figcaption>{props.image.caption}</figcaption>
      <dialog ref={dialog} className="image-viewer" aria-labelledby={headingId} onClose={onViewerClosed}>
        <form method="dialog" className="image-viewer-bar">
          <p id={headingId}>{props.image.caption}</p>
          <button type="submit" className="primary">
            {t('image.close')}
          </button>
        </form>
        {src !== null && <img src={src} alt={props.image.caption === '' ? t('image.noCaption') : props.image.caption} />}
      </dialog>
    </figure>
  );
}

/**
 * Editor field for a Step's photo (14.3): take or choose a photo, a required caption, replace or
 * remove it. Uploads happen right away; the Step only refers to the image once the Procedure is saved.
 */
export function StepImageField(props: {
  workspaceId: string;
  number: string;
  image: StepImageRef | null;
  onChange: (image: StepImageRef | null) => void;
  onUsage: (usage: ImageUsage) => void;
  /** Shown next to the caption field (e.g. "Please describe what the photo shows."). */
  captionError?: string | undefined;
}) {
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** The photo open in the crop-and-turn editor (23.3), before anything is uploaded. */
  const [editing, setEditing] = useState<HTMLImageElement | null>(null);
  /** The Workspace's photos are open to pick one (23.1): no upload, no new storage. */
  const [picking, setPicking] = useState(false);
  const captionId = useId();

  const resetInputs = () => {
    if (camera.current !== null) camera.current.value = '';
    if (library.current !== null) library.current.value = '';
  };

  async function upload(blob: Blob) {
    const uploaded = await api.uploadImage(props.workspaceId, blob, props.image?.id);
    props.onUsage(uploaded.usage);
    props.onChange({ id: uploaded.image.id, caption: props.image?.caption ?? '' });
  }

  /** A new photo opens in the editor; one the browser cannot read is sent as it is (the server explains). */
  async function choose(file: File | undefined) {
    if (file === undefined) return;
    setMessage(null);
    let image: HTMLImageElement;
    try {
      image = await decodeImage(file);
    } catch {
      setBusy(true);
      try {
        const original = originalUpload(file);
        if (original.kind === 'too_large') {
          setMessage(t('image.rejected.too_large', { max: formatMegabytes(MAX_UPLOAD_BYTES) }));
          return;
        }
        await upload(original.blob);
      } catch (caught) {
        setMessage(imageErrorMessage(caught));
      } finally {
        setBusy(false);
        resetInputs();
      }
      return;
    }
    resetInputs();
    setEditing(image);
  }

  /** Editing a stored photo starts from the stored JPEG and saves a new image; Runs keep the old one. */
  async function editCurrent() {
    if (props.image === null) return;
    setMessage(null);
    setBusy(true);
    try {
      const response = await fetch(imageUrl(props.workspaceId, props.image.id), { credentials: 'same-origin' });
      if (!response.ok) throw new Error(String(response.status));
      setEditing(await decodeImage(await response.blob()));
    } catch {
      setMessage(t('photoEditor.loadFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function finishEditing(edit: PhotoEdit) {
    if (editing === null) return;
    setBusy(true);
    setMessage(null);
    try {
      const blob = await encodeEdited(editing, edit);
      if (blob === null) {
        setMessage(t('image.rejected.unreadable'));
        return;
      }
      await upload(blob);
    } catch (caught) {
      setMessage(imageErrorMessage(caught));
    } finally {
      setBusy(false);
      setEditing(null);
    }
  }

  return (
    <div className="stack step-image-field">
      {message !== null && <p role="alert">{message}</p>}
      {props.image !== null && <StepImage workspaceId={props.workspaceId} image={props.image} />}
      {props.image !== null && (
        <p>
          <label htmlFor={captionId}>{t('image.caption', { number: props.number })}</label>
          <br />
          <input
            id={captionId}
            required
            maxLength={200}
            value={props.image.caption}
            placeholder={t('image.captionPlaceholder')}
            aria-describedby={props.captionError === undefined ? `${captionId}-hint` : `${captionId}-error ${captionId}-hint`}
            aria-invalid={props.captionError !== undefined}
            onChange={(e) => props.onChange({ id: props.image?.id ?? '', caption: e.target.value })}
          />
          <br />
          {props.captionError !== undefined && (
            <span id={`${captionId}-error`} className="field-error">
              {props.captionError}
            </span>
          )}
          <small id={`${captionId}-hint`} className="muted">
            {t('image.captionHint')}
          </small>
        </p>
      )}
      <div className="row">
        {/* `capture` opens the camera on phones; the second input picks from the library or files. */}
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void choose(e.target.files?.[0])} />
        <input ref={library} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" hidden onChange={(e) => void choose(e.target.files?.[0])} />
        <button type="button" disabled={busy} onClick={() => camera.current?.click()}>
          {props.image === null ? t('image.takePhoto') : t('image.retakePhoto')}
        </button>
        <button type="button" disabled={busy} onClick={() => library.current?.click()}>
          {props.image === null ? t('image.choosePhoto') : t('image.replacePhoto')}
        </button>
        <button type="button" className="icon-button" aria-label={t('image.fromGallery')} title={t('image.fromGallery')} disabled={busy} onClick={() => setPicking(true)}>
          <UiIcon name="photo" />
        </button>
        {props.image !== null && (
          <button type="button" className="icon-button" aria-label={t('image.editPhoto')} title={t('image.editPhoto')} disabled={busy} onClick={() => void editCurrent()}>
            <UiIcon name="crop" />
          </button>
        )}
        {props.image !== null && (
          <button type="button" className="quiet" disabled={busy} onClick={() => props.onChange(null)}>
            {t('image.remove')}
          </button>
        )}
        {busy && <span className="muted">{t('image.uploading')}</span>}
      </div>
      {picking && (
        <GalleryPicker
          workspaceId={props.workspaceId}
          onClose={() => setPicking(false)}
          onPick={(image) => {
            setMessage(null);
            props.onChange({ id: image.id, caption: image.caption ?? props.image?.caption ?? '' });
          }}
        />
      )}
      {editing !== null && <PhotoEditor image={editing} busy={busy} onDone={(edit) => void finishEditing(edit)} onCancel={() => setEditing(null)} />}
    </div>
  );
}
