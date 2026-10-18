import { useEffect, useId, useRef, useState } from 'react';
import { api, imageThumbUrl, imageUrl, messageFor, type GalleryImage, type ImageUsage, type ImageUse } from './api.ts';
import { formatBytes } from './document-model.ts';
import { formatDateTime, t } from './i18n/index.ts';
import { Link, paths } from './router.tsx';
import { UiIcon } from './ui-icons.tsx';

/** Waits this long after typing before searching. */
const SEARCH_DELAY_MS = 250;

/** What a photo shows, for its accessible name: its last caption, else a neutral name. */
const photoName = (image: GalleryImage) => image.caption ?? t('gallery.untitled');

/**
 * The Workspace's photos as a grid of thumbnails with a search field (23.1): newest first, more on
 * demand. Tapping one calls `onPick`. Only people who may edit Procedures see it (the server checks).
 */
export function GalleryGrid(props: { workspaceId: string; onPick: (image: GalleryImage) => void; autoFocus?: boolean }) {
  const searchId = useId();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  /** The answer for `query`; a different query shows as loading until its answer arrives. */
  const [result, setResult] = useState<{ query: string; images: GalleryImage[]; next: string | null; message: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    api.gallery(props.workspaceId, { search: query }, controller.signal).then(
      (page) => setResult({ query, images: page.images, next: page.next, message: null }),
      (caught: unknown) => {
        if (!controller.signal.aborted) setResult({ query, images: [], next: null, message: messageFor(caught) });
      },
    );
    return () => controller.abort();
  }, [props.workspaceId, query]);

  const current = result?.query === query ? result : null;
  const images = current === null || current.message !== null ? null : current.images;
  const next = current?.next ?? null;
  const message = current?.message ?? null;

  async function loadMore() {
    if (next === null) return;
    setLoadingMore(true);
    try {
      const page = await api.gallery(props.workspaceId, { search: query, after: next });
      setResult((known) => (known === null || known.query !== query ? known : { ...known, images: [...known.images, ...page.images], next: page.next }));
    } catch (caught) {
      setResult((known) => (known === null ? known : { ...known, message: messageFor(caught) }));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="stack gallery">
      <p className="gallery-search">
        <label htmlFor={searchId} className="visually-hidden">
          {t('gallery.search')}
        </label>
        <input id={searchId} type="search" maxLength={100} value={search} placeholder={t('gallery.search')} autoFocus={props.autoFocus} onChange={(event) => setSearch(event.target.value)} />
      </p>
      {message !== null && <p role="alert">{message}</p>}
      {images === null && message === null && <p className="muted">{t('common.loading')}</p>}
      {images !== null && images.length === 0 && <p className="muted">{query === '' ? t('gallery.empty') : t('gallery.noMatch')}</p>}
      {images !== null && images.length > 0 && (
        <ul className="gallery-grid" aria-label={t('gallery.photos')}>
          {images.map((image) => (
            <li key={image.id}>
              <button type="button" className="gallery-tile" aria-label={photoName(image)} title={photoName(image)} onClick={() => props.onPick(image)}>
                <img src={imageThumbUrl(props.workspaceId, image.id)} alt="" loading="lazy" decoding="async" />
                {image.steps > 0 && (
                  <span className="gallery-badge" aria-hidden="true">
                    {image.steps}×
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {next !== null && (
        <button type="button" disabled={loadingMore} onClick={() => void loadMore()}>
          {t('gallery.more')}
        </button>
      )}
    </div>
  );
}

/** The Step editor's picker: the gallery in a dialog; picking a photo closes it. */
export function GalleryPicker(props: { workspaceId: string; onPick: (image: GalleryImage) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (element !== null && !element.open) element.showModal();
  }, []);
  return (
    <dialog ref={dialog} className="dialog gallery-dialog" aria-labelledby={headingId} onClose={props.onClose}>
      <div className="gallery-dialog-head">
        <h2 id={headingId}>{t('gallery.choose')}</h2>
        <button type="button" className="icon-button" aria-label={t('common.close')} title={t('common.close')} onClick={() => dialog.current?.close()}>
          <UiIcon name="close" />
        </button>
      </div>
      <GalleryGrid
        workspaceId={props.workspaceId}
        autoFocus
        onPick={(image) => {
          props.onPick(image);
          dialog.current?.close();
        }}
      />
    </dialog>
  );
}

/** One photo with where it is used (23.1); replacing it everywhere follows in 23.2. */
function PhotoDetails(props: { workspaceId: string; image: GalleryImage; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [uses, setUses] = useState<ImageUse[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element !== null && !element.open) element.showModal();
    api.imageUses(props.workspaceId, props.image.id).then(setUses, (caught: unknown) => setMessage(messageFor(caught)));
  }, [props.workspaceId, props.image.id]);
  const byProcedure = new Map<string, { title: string; steps: string[] }>();
  for (const use of uses ?? []) {
    const entry = byProcedure.get(use.procedureId) ?? { title: use.procedureTitle, steps: [] };
    entry.steps.push(use.stepTitle);
    byProcedure.set(use.procedureId, entry);
  }
  return (
    <dialog ref={dialog} className="dialog gallery-dialog" aria-labelledby={headingId} onClose={props.onClose}>
      <div className="gallery-dialog-head">
        <h2 id={headingId}>{photoName(props.image)}</h2>
        <button type="button" className="icon-button" aria-label={t('common.close')} title={t('common.close')} onClick={() => dialog.current?.close()}>
          <UiIcon name="close" />
        </button>
      </div>
      <img className="gallery-photo" src={imageUrl(props.workspaceId, props.image.id)} alt={photoName(props.image)} />
      <p className="muted">
        {t('gallery.facts', { width: props.image.width, height: props.image.height, size: formatBytes(props.image.bytes), date: formatDateTime(props.image.createdAt) })}
      </p>
      {message !== null && <p role="alert">{message}</p>}
      {uses !== null && uses.length === 0 && <p>{t('gallery.unused')}</p>}
      {uses !== null && uses.length > 0 && (
        <>
          <h3>{t('gallery.usedIn')}</h3>
          <ul className="gallery-uses">
            {[...byProcedure.entries()].map(([procedureId, entry]) => (
              <li key={procedureId}>
                <Link href={paths.procedure(props.workspaceId, procedureId)}>{entry.title}</Link>
                <span className="muted"> · {entry.steps.join(' · ')}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </dialog>
  );
}

/** *Procedures → Photos* (23.1): every photo of the Workspace, its storage and where each is used. */
export function PhotosPage(props: { workspaceId: string }) {
  const [usage, setUsage] = useState<ImageUsage | null>(null);
  const [open, setOpen] = useState<GalleryImage | null>(null);
  useEffect(() => {
    api.imageUsage(props.workspaceId).then(setUsage, () => setUsage(null));
  }, [props.workspaceId]);
  return (
    <section aria-labelledby="photos-heading" className="stack">
      <p>
        <Link href={paths.procedures(props.workspaceId)} className="back-link">
          <UiIcon name="back" /> {t('gallery.backToProcedures')}
        </Link>
      </p>
      <div className="page-header">
        <div>
          <h2 id="photos-heading">{t('gallery.heading')}</h2>
          {usage !== null && <p className="muted page-lead">{t('image.usage', { used: formatBytes(usage.usedBytes), limit: formatBytes(usage.limitBytes) })}</p>}
        </div>
      </div>
      <GalleryGrid workspaceId={props.workspaceId} onPick={setOpen} />
      {open !== null && <PhotoDetails key={open.id} workspaceId={props.workspaceId} image={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
