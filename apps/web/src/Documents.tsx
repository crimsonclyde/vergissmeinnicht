import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ApiError, api, documentExportUrl, documentFileUrls, type ExportSize, type DocumentDetail, type DocumentFile, type DocumentFilterValues, type DocumentFolder, type DocumentListing, type DocumentSummary, type DocumentTypes, type TrashEntry } from './api.ts';
import { DocumentFormFields, DocumentTypesDialog, FileChooser, FolderSelect, UploadList, failureText, useUploads } from './DocumentFields.tsx';
import {
  EMPTY_FORM,
  NO_FILTERS,
  SORT_CHOICES,
  childFolders,
  cleared,
  dateLine,
  exportQuery,
  fieldsOf,
  filterChips,
  filterOptions,
  filtersFromSearch,
  filtersToSearch,
  folderContents,
  folderLabel,
  folderPath,
  folderTree,
  formOf,
  formatBytes,
  isFiltering,
  listLine,
  listingParams,
  moveTargets,
  moved,
  previewNote,
  purgeTotals,
  restoreMessage,
  sortedDateLine,
  spansFolders,
  titleFromFileName,
  typeLabel,
  typeOptions,
  type DocumentFilters,
  type DocumentForm,
} from './document-model.ts';
import { FormDialog } from './FormDialog.tsx';
import { clearHandOver, handOver, handedOver } from './handoff.ts';
import { formatCalendarDate, formatDateTime, t } from './i18n/index.ts';
import { MoreMenu } from './MoreMenu.tsx';
import { Link, navigate, paths, setNavigationGuard, type Route } from './router.tsx';
import { UiIcon } from './ui-icons.tsx';
import { UndoNotice, type Undoable } from './UndoNotice.tsx';

type DocumentsRoute = Extract<Route, { page: 'documents' }>;

/** Other members' changes appear without reloading (polling, as Lists and Today do). */
const REFRESH_MS = 30_000;
/** While previews are still being made, look again sooner. */
const PREVIEW_REFRESH_MS = 3_000;
/** Preview pages of a PDF shown at first, and added with each "Show more pages" (reads count against the request limit). */
const PAGES_PER_STEP = 5;

/** Typing in the search field asks the server once the typing pauses. */
const SEARCH_DELAY_MS = 300;
/** A search carried from a Folder to "all folders". */
const FILTERS = 'document-filters';
const VIEW_KEY = 'vmn.documentsView';
type ListView = 'LIST' | 'GRID';

/** List or grid: remembered per viewer in this browser (a convenience, nothing else). */
function storedView(): ListView {
  try {
    if (window.localStorage.getItem(VIEW_KEY) === 'GRID') return 'GRID';
  } catch {
    /* fall through to the default */
  }
  return 'LIST';
}

/**
 * Export (16.4): says how much the ZIP will hold before anything is downloaded — or why it cannot be
 * made (too large, one already running) — and then starts the download. Open to everyone who can see
 * Documents, guests included.
 */
function ExportDialog(props: { workspaceId: string; title: string; scope: string; onClose: () => void }) {
  const [size, setSize] = useState<ExportSize | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    api.checkDocumentExport(props.workspaceId, props.scope).then(setSize, (caught: unknown) => {
      const details = caught instanceof ApiError && caught.code === 'export_too_large' ? caught.details : null;
      setProblem(
        details !== null && typeof details.files === 'number' && typeof details.bytes === 'number' && typeof details.maxFiles === 'number' && typeof details.maxBytes === 'number'
          ? t('documents.export.tooLarge', { files: details.files, size: formatBytes(details.bytes), maxFiles: details.maxFiles, maxSize: formatBytes(details.maxBytes) })
          : failureText(caught),
      );
    });
  }, [props.workspaceId, props.scope]);
  return (
    <FormDialog
      title={props.title}
      submitLabel={t('documents.export.download')}
      submitDisabled={size === null || size.documents === 0}
      onClose={props.onClose}
      onSubmit={() => {
        // A plain download: the browser saves the ZIP while the server sends it.
        const link = document.createElement('a');
        link.href = documentExportUrl(props.workspaceId, props.scope);
        link.download = '';
        document.body.append(link);
        link.click();
        link.remove();
      }}
    >
      {problem !== null ? (
        <p role="alert" style={{ margin: 0 }}>
          {problem}
        </p>
      ) : size === null ? (
        <p style={{ margin: 0 }}>{t('common.loading')}</p>
      ) : (
        <p style={{ margin: 0 }}>{size.documents === 0 ? t('documents.export.nothing') : t('documents.export.size', { count: size.documents, files: size.files, size: formatBytes(size.bytes) })}</p>
      )}
      <p className="muted" style={{ margin: 0 }}>
        {t('documents.export.what')}
      </p>
      <p className="muted" style={{ margin: 0 }}>
        {t('documents.export.notice')}
      </p>
    </FormDialog>
  );
}

/** Something moved to Trash a moment ago: the page that follows offers Undo. */
const TRASHED = 'trashed-document-item';
interface Trashed {
  readonly workspaceId: string;
  readonly kind: 'folder' | 'document';
  readonly id: string;
  readonly name: string;
}

function useRefresh(load: () => void, everyMs: number) {
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') load();
    };
    const timer = window.setInterval(refresh, everyMs);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load, everyMs]);
}

const isNotFound = (caught: unknown) => caught instanceof ApiError && caught.status === 404;

/** "Documents › Water › 2026": where this is, each part a link. */
function Breadcrumbs(props: { workspaceId: string; folders: readonly DocumentFolder[]; folderId: string | null; last?: string }) {
  const path = folderPath(props.folders, props.folderId);
  return (
    <nav aria-label={t('documents.breadcrumbs')} className="breadcrumbs">
      <ol>
        <li>
          <Link href={paths.documents(props.workspaceId)}>{t('shell.documents')}</Link>
        </li>
        {path.map((folder, index) => (
          <li key={folder.id}>
            {index === path.length - 1 && props.last === undefined ? <span aria-current="page">{folder.name}</span> : <Link href={paths.documents(props.workspaceId, folder.id)}>{folder.name}</Link>}
          </li>
        ))}
        {props.last !== undefined && (
          <li>
            <span aria-current="page">{props.last}</span>
          </li>
        )}
      </ol>
    </nav>
  );
}

/** The whole Folder tree, folded away until asked for: an indented list of links (works at 320 px). */
function FolderTree(props: { workspaceId: string; folders: readonly DocumentFolder[]; current: string | null }) {
  const entries = folderTree(props.folders);
  if (entries.length < 2) return null;
  return (
    <details className="folder-tree">
      <summary>{t('documents.allFolders', { count: entries.length })}</summary>
      <ul className="plain-list">
        {entries.map(({ folder, depth }) => (
          <li key={folder.id} data-depth={Math.min(depth, 6)}>
            <Link href={paths.documents(props.workspaceId, folder.id)} aria-current={folder.id === props.current ? 'page' : undefined}>
              <UiIcon name="folder" /> {folder.name}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Search, order, list or grid, and the filters (folded away until used) — everything that decides
 * which Documents the list shows. The server applies all of it; this only collects the choices.
 */
function FindBar(props: {
  workspaceId: string;
  folder: DocumentFolder | null;
  folders: readonly DocumentFolder[];
  filters: DocumentFilters;
  text: string;
  onText: (text: string) => void;
  onChange: (filters: DocumentFilters) => void;
  view: ListView;
  onView: (view: ListView) => void;
}) {
  const { workspaceId, folder, folders, filters } = props;
  const id = useId();
  const routeFolderId = folder?.id ?? null;
  const [types, setTypes] = useState<DocumentTypes | null>(null);
  const [values, setValues] = useState<DocumentFilterValues | null>(null);
  const chips = filterChips(filters, routeFolderId, folders, types);
  const [open, setOpen] = useState(chips.length > 0);
  // What the filters offer is only fetched once they are looked at (or in use).
  useEffect(() => {
    if (!open) return;
    void api.documentFilterValues(workspaceId).then(setValues, () => undefined);
    void api.documentTypes(workspaceId).then(setTypes, () => undefined);
  }, [open, workspaceId]);
  const options = filterOptions(values, filters);
  const set = (change: Partial<DocumentFilters>) => props.onChange({ ...filters, ...change });
  return (
    <div className="document-find">
      <form
        className="document-find-row"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          set({ q: props.text });
        }}
      >
        <div className="field document-search">
          <label htmlFor={`${id}-q`}>{folder === null ? t('documents.find.search') : t('documents.find.searchIn', { name: folder.name })}</label>
          <input id={`${id}-q`} type="search" maxLength={100} value={props.text} placeholder={t('documents.find.placeholder')} enterKeyHint="search" autoComplete="off" onChange={(event) => props.onText(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-sort`}>{t('documents.find.sort')}</label>
          <select
            id={`${id}-sort`}
            value={`${filters.sort}:${filters.dir}`}
            onChange={(event) => {
              const choice = SORT_CHOICES.find((each) => each.value === event.target.value);
              if (choice !== undefined) set({ sort: choice.sort, dir: choice.dir });
            }}
          >
            {SORT_CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {t(`documents.find.sort.${choice.sort}.${choice.dir}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="row home-filter" role="group" aria-label={t('documents.find.view')}>
          {(['LIST', 'GRID'] as const).map((value) => (
            <button key={value} type="button" className="quiet" aria-pressed={props.view === value} onClick={() => props.onView(value)}>
              {t(`documents.find.view.${value}`)}
            </button>
          ))}
        </div>
      </form>

      <details className="calendar-filter-box" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>{chips.length > 0 ? t('documents.find.filtersActive', { count: chips.length }) : t('documents.find.filters')}</summary>
        <div className="calendar-filters document-filters">
          {folder === null && (
            <div className="field">
              <label htmlFor={`${id}-f0`}>{t('documents.field.folder')}</label>
              <select id={`${id}-f0`} value={filters.folder} onChange={(event) => set({ folder: event.target.value, subfolders: event.target.value !== '' && event.target.value !== 'top' && filters.subfolders })}>
                <option value="">{t('documents.find.folderAll')}</option>
                <option value="top">{t('documents.find.folderNone')}</option>
                {folderTree(folders).map(({ folder: each, depth }) => (
                  <option key={each.id} value={each.id}>
                    {`${'  '.repeat(depth)}${each.name}`}
                  </option>
                ))}
              </select>
            </div>
          )}
          {(folder !== null || (filters.folder !== '' && filters.folder !== 'top')) && (
            <fieldset>
              <label>
                <input type="checkbox" checked={filters.subfolders} onChange={(event) => set({ subfolders: event.target.checked })} />
                {t('documents.find.subfolders')}
              </label>
            </fieldset>
          )}
          <div className="field">
            <label htmlFor={`${id}-f1`}>{t('documents.field.type')}</label>
            <select id={`${id}-f1`} value={filters.type} onChange={(event) => set({ type: event.target.value })}>
              <option value="">{t('documents.find.any')}</option>
              {/* Retired types are offered too: old Documents still have them. */}
              {(types === null ? [] : typeOptions({ builtIn: types.builtIn, custom: types.custom.map((type) => ({ ...type, retired: false })) }, null)).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${id}-f2`}>{t('documents.field.year')}</label>
            <select id={`${id}-f2`} value={filters.year} onChange={(event) => set({ year: event.target.value })}>
              <option value="">{t('documents.find.any')}</option>
              {options.years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${id}-f3`}>{t('documents.find.tag')}</label>
            {/* Choosing adds the tag; each chosen tag is a chip below. */}
            <select id={`${id}-f3`} value="" disabled={options.tags.length === 0 || filters.tags.length >= 10} onChange={(event) => event.target.value !== '' && set({ tags: [...filters.tags, event.target.value] })}>
              <option value="">{options.tags.length === 0 ? t('documents.find.noTags') : t('documents.find.addTag')}</option>
              {options.tags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${id}-f4`}>{t('documents.find.uploader')}</label>
            <select id={`${id}-f4`} value={filters.uploader} onChange={(event) => set({ uploader: event.target.value })}>
              <option value="">{t('documents.find.anyone')}</option>
              {options.uploaders.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </details>

      {chips.length > 0 && (
        <ul className="plain-list document-chips" aria-label={t('documents.find.active')}>
          {chips.map((chip) => (
            <li key={chip.key}>
              <button type="button" className="filter-chip" aria-label={t('documents.find.removeFilter', { name: chip.label })} onClick={() => props.onChange(chip.without)}>
                {chip.label} <UiIcon name="close" size="1em" />
              </button>
            </li>
          ))}
          <li>
            <button type="button" className="quiet" onClick={() => props.onChange(cleared(filters))}>
              {t('documents.find.clear')}
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

/** The Documents of a listing as a list or as a grid of thumbnails — both of plain links, each naming its Document. */
function DocumentList(props: {
  workspaceId: string;
  documents: readonly DocumentSummary[];
  view: ListView;
  sort: DocumentFilters['sort'];
  place: (document: DocumentSummary) => string | null;
  selecting: boolean;
  selected: readonly string[];
  onSelect: (selected: readonly string[]) => void;
}) {
  const { workspaceId, view, selected } = props;
  return (
    <ul className={view === 'GRID' ? 'plain-list document-grid' : 'plain-list'}>
      {props.documents.map((each) => (
        <li key={each.id} className={props.selecting ? 'select-row' : undefined}>
          {props.selecting && (
            <input
              type="checkbox"
              aria-label={t('documents.selectNamed', { title: each.title })}
              checked={selected.includes(each.id)}
              onChange={(event) => props.onSelect(event.target.checked ? [...selected, each.id] : selected.filter((id) => id !== each.id))}
            />
          )}
          {view === 'GRID' ? (
            <Link href={paths.document(workspaceId, each.id)} className="card document-tile">
              <span className="document-tile-picture">
                {each.cover?.hasThumbnail === true ? (
                  <img src={documentFileUrls.thumbnail(workspaceId, each.cover.fileId)} alt={t('documents.find.thumbnailAlt', { title: each.title })} loading="lazy" decoding="async" />
                ) : (
                  <UiIcon name="documents" size="2.5em" />
                )}
              </span>
              {/* The title is always written out: the picture alone never tells two Documents apart. */}
              <strong>{each.title}</strong>
              <small className="muted">{sortedDateLine(each, props.sort)}</small>
            </Link>
          ) : (
            <Link href={paths.document(workspaceId, each.id)} className="card link-card">
              <span className="document-thumb">{each.cover?.hasThumbnail === true ? <img src={documentFileUrls.thumbnail(workspaceId, each.cover.fileId)} alt="" loading="lazy" decoding="async" /> : <UiIcon name="documents" size="1.75em" />}</span>
              <span className="item-body">
                <strong>{each.title}</strong>
                <small className="muted">{listLine(each, props.sort, props.place(each))}</small>
              </span>
              <UiIcon name="chevron" />
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * A Folder (or the top level): its sub-folders, and the Documents — searched, filtered, sorted and
 * paged by the server (16.3). At the top level the list is every Document of the Workspace, newest
 * upload first ("Recently added"); in a Folder it is that Folder, with its sub-folders when asked.
 */
function FolderView(props: { workspaceId: string; folderId: string | null; canManage: boolean }) {
  const { workspaceId, folderId, canManage } = props;
  const [folders, setFolders] = useState<readonly DocumentFolder[] | null>(null);
  const [filters, setFilters] = useState<DocumentFilters>(() => handedOver<DocumentFilters>(FILTERS) ?? filtersFromSearch(window.location.search));
  const [text, setText] = useState(filters.q);
  /** The Documents shown, and the question (`query`) they answer. */
  const [listing, setListing] = useState<(DocumentListing & { readonly query: string }) | null>(null);
  /** More than the first page is shown: the list is then not refreshed behind the reader's back. */
  const [extended, setExtended] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [fetchingMore, setFetchingMore] = useState(false);
  const [view, setView] = useState<ListView>(storedView);
  const [types, setTypes] = useState<DocumentTypes | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [dialog, setDialog] = useState<'new-folder' | 'rename' | 'move' | 'delete' | 'types' | 'move-documents' | 'export' | 'export-selected' | null>(null);
  const [name, setName] = useState('');
  const [target, setTarget] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  /** Answers arrive in any order: only the one to the latest question counts. */
  const asked = useRef(0);
  useEffect(() => clearHandOver(FILTERS), []);

  const loadFolders = useCallback(() => {
    api.documentFolders(workspaceId).then(
      (loaded) => {
        setFolders(loaded);
        setMessage(null);
      },
      (caught: unknown) => setMessage(failureText(caught)),
    );
  }, [workspaceId]);
  useEffect(loadFolders, [loadFolders]);

  const query = listingParams(filters, folderId, null);
  const loadDocuments = useCallback(() => {
    const mine = ++asked.current;
    api.documents(workspaceId, query).then(
      (loaded) => {
        if (mine !== asked.current) return;
        setListing({ ...loaded, query });
        setExtended(false);
        setFetchingMore(false);
        setFailed(null);
        setMissing(false);
      },
      (caught: unknown) => {
        if (mine !== asked.current) return;
        // The Folder of this page is gone; a Folder that was only chosen as a filter is dropped from the filters instead.
        if (isNotFound(caught) && folderId !== null) setMissing(true);
        else if (isNotFound(caught) && caught instanceof ApiError && caught.code === 'folder_not_found') setFilters((current) => ({ ...current, folder: '', subfolders: false }));
        else setFailed(failureText(caught));
      },
    );
  }, [workspaceId, query, folderId]);
  useEffect(loadDocuments, [loadDocuments]);
  useRefresh(
    useCallback(() => {
      loadFolders();
      if (!extended) loadDocuments();
    }, [loadFolders, loadDocuments, extended]),
    REFRESH_MS,
  );
  const loadTypes = useCallback(() => void api.documentTypes(workspaceId).then(setTypes, () => undefined), [workspaceId]);

  // The search and filters live in the address, so Back from a Document returns to the same list.
  useEffect(() => {
    const address = `${window.location.pathname}${filtersToSearch(filters)}`;
    if (address !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, '', address);
  }, [filters]);
  // Typing searches once it pauses (Enter searches at once).
  useEffect(() => {
    if (text.trim() === filters.q.trim()) return;
    const timer = window.setTimeout(() => setFilters((current) => ({ ...current, q: text })), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [text, filters.q]);
  const apply = (next: DocumentFilters) => {
    setText(next.q);
    setFilters(next);
  };
  const chooseView = (next: ListView) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* the choice then lasts until the page is left */
    }
  };
  const showMore = () => {
    if (listing?.nextCursor == null) return;
    const mine = asked.current;
    setFetchingMore(true);
    api.documents(workspaceId, listingParams(filters, folderId, listing.nextCursor)).then(
      (more) => {
        if (mine !== asked.current) return;
        const known = new Set(listing.documents.map((each) => each.id));
        setListing({ ...listing, documents: [...listing.documents, ...more.documents.filter((each) => !known.has(each.id))], nextCursor: more.nextCursor });
        setExtended(true);
        setFetchingMore(false);
      },
      (caught: unknown) => {
        if (mine !== asked.current) return;
        setFetchingMore(false);
        setMessage(failureText(caught));
      },
    );
  };

  // Arriving here right after moving something to Trash: offer Undo.
  const [trashed, setTrashed] = useState(() => {
    const handed = handedOver<Trashed>(TRASHED);
    return handed?.workspaceId === workspaceId ? handed : null;
  });
  useEffect(() => clearHandOver(TRASHED), []);
  const reload = () => {
    loadFolders();
    loadDocuments();
  };
  const notice: Undoable | null =
    trashed === null
      ? null
      : {
          message: t(trashed.kind === 'folder' ? 'documents.folderTrashed' : 'documents.documentTrashed', { name: trashed.name }),
          undo: () =>
            void (trashed.kind === 'folder' ? api.restoreDocumentFolder(workspaceId, trashed.id) : api.restoreDocument(workspaceId, trashed.id)).then(
              (outcome) => {
                setStatus(restoreMessage(trashed.name, outcome));
                reload();
              },
              (caught: unknown) => setMessage(failureText(caught)),
            ),
        };

  if (missing || (folders !== null && folderId !== null && !folders.some((each) => each.id === folderId))) {
    return (
      <p role="alert">
        {t('documents.folderGone')} <Link href={paths.documents(workspaceId)}>{t('documents.backToDocuments')}</Link>
      </p>
    );
  }
  if (folders === null) return message === null ? <p>{t('common.loading')}</p> : <p role="alert">{message}</p>;

  const folder = folderId === null ? null : (folders.find((each) => each.id === folderId) ?? null);
  const subFolders = childFolders(folders, folderId);
  const contents = folder === null ? { folders: 0, documents: 0 } : folderContents(folders, folder.id);
  const open = (which: NonNullable<typeof dialog>) => {
    setName(which === 'rename' ? (folder?.name ?? '') : '');
    setTarget(which === 'move' ? (folder?.parentId ?? null) : folderId);
    if (which === 'types') loadTypes();
    setDialog(which);
  };
  const close = () => setDialog(null);
  const narrowed = isFiltering(filters);
  /** The list on screen still answers an earlier question, or more of it is on its way. */
  const busy = fetchingMore || (listing !== null && listing.query !== query);
  const shown = listing?.documents ?? [];
  /** Nothing at all in this Workspace's Documents (top level) or in this Folder — as opposed to "nothing matches". */
  const nothingHere = !narrowed && listing !== null && shown.length === 0 && subFolders.length === 0;
  const filtered = filterChips(filters, folderId, folders, null).length > 0;
  const several = spansFolders(filters, folderId);
  const heading = narrowed ? t('documents.find.results') : folder !== null ? t('documents.documents') : filters.sort === NO_FILTERS.sort && filters.dir === NO_FILTERS.dir ? t('documents.find.recent') : t('documents.find.all');

  return (
    <section aria-labelledby="documents-heading">
      {folder !== null && <Breadcrumbs workspaceId={workspaceId} folders={folders} folderId={folderId} />}
      <div className="page-header page-header-tool">
        <div>
          <h2 id="documents-heading">{folder === null ? t('shell.documents') : folder.name}</h2>
          {folder === null && <p className="muted page-lead">{t('documents.lead')}</p>}
        </div>
        <div className="row">
          {canManage && (
            <button type="button" className="primary" onClick={() => navigate(paths.newDocument(workspaceId, folderId))}>
              <UiIcon name="add" /> {t('documents.add')}
            </button>
          )}
          {canManage && (
            <button type="button" onClick={() => open('new-folder')}>
              <UiIcon name="folder" /> {t('documents.newFolder')}
            </button>
          )}
          <MoreMenu
            label={folder === null ? t('documents.moreActions') : t('documents.folderActions', { name: folder.name })}
            items={[
              ...(canManage && folder !== null ? [{ label: t('documents.rename'), onSelect: () => open('rename') }, { label: t('documents.move'), onSelect: () => open('move') }] : []),
              ...(canManage && shown.length > 0 ? [{ label: selecting ? t('documents.stopSelecting') : t('documents.select'), onSelect: () => (setSelecting(!selecting), setSelected([])) }] : []),
              // Everyone who can see Documents can export them — guests too.
              ...(nothingHere ? [] : [{ label: t(folder === null ? 'documents.export.all' : 'documents.export.folder'), onSelect: () => open('export') }]),
              ...(canManage ? [{ label: t('documents.types.manage'), onSelect: () => open('types') }, { label: t('documents.trash.open'), onSelect: () => navigate(paths.documentTrash(workspaceId)) }] : []),
              ...(canManage && folder !== null ? [{ label: t('documents.deleteFolder'), danger: true, onSelect: () => open('delete') }] : []),
            ]}
          />
        </div>
      </div>
      {message !== null && <p role="alert">{message}</p>}
      {status !== null && (
        <p role="status" className="card calm">
          {status}
        </p>
      )}
      <FolderTree workspaceId={workspaceId} folders={folders} current={folderId} />

      {nothingHere && <p className="card calm">{t(folder === null ? (canManage ? 'documents.noneHint' : 'documents.none') : 'documents.emptyFolder')}</p>}

      {/* While searching or filtering, the results come first; the sub-folders return when the filters are cleared. */}
      {subFolders.length > 0 && !narrowed && (
        <>
          <h3 className="section-label">{t('documents.folders')}</h3>
          <ul className="plain-list">
            {subFolders.map((each) => {
              const inside = folderContents(folders, each.id);
              return (
                <li key={each.id}>
                  <Link href={paths.documents(workspaceId, each.id)} className="card link-card">
                    <span className="item-icon">
                      <UiIcon name="folder" size="1.5em" />
                    </span>
                    <span className="item-body">
                      <strong>{each.name}</strong>
                      <small className="muted">{[inside.folders > 0 ? t('documents.folderCount', { count: inside.folders }) : null, t('documents.documentCount', { count: inside.documents })].filter((part) => part !== null).join(' · ')}</small>
                    </span>
                    <UiIcon name="chevron" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {!nothingHere && (
        <>
          <h3 className="section-label" id="document-list-heading">
            {heading}
          </h3>
          <FindBar workspaceId={workspaceId} folder={folder} folders={folders} filters={filters} text={text} onText={setText} onChange={apply} view={view} onView={chooseView} />
          {failed !== null ? (
            <div role="alert" className="card calm stack">
              <p style={{ margin: 0 }}>{t('documents.find.failed', { reason: failed })}</p>
              <div className="row">
                <button type="button" onClick={loadDocuments}>
                  {t('documents.find.retry')}
                </button>
                {narrowed && (
                  <button type="button" className="quiet" onClick={() => apply(cleared(filters))}>
                    {t('documents.find.clear')}
                  </button>
                )}
              </div>
            </div>
          ) : listing === null ? (
            <p>{t('common.loading')}</p>
          ) : (
            <div aria-busy={busy}>
              {/* Said aloud whenever the list changes: how many there are, and of what. */}
              <p role="status" className="muted document-count">
                {shown.length === 0
                  ? t(narrowed ? 'documents.find.noMatch' : folder === null ? 'documents.none' : 'documents.find.noneDirectly')
                  : listing.total !== null && listing.total > shown.length
                    ? t('documents.find.shownOf', { shown: shown.length, count: listing.total })
                    : t(narrowed ? 'documents.find.matchCount' : 'documents.documentCount', { count: shown.length })}
              </p>
              {shown.length === 0 && narrowed && (
                <div className="row">
                  {/* With filters in use, "Clear filters" is right above, beside them. */}
                  {!filtered && (
                    <button type="button" onClick={() => apply(cleared(filters))}>
                      {t('documents.find.clearSearch')}
                    </button>
                  )}
                  {folder !== null && (
                    <button
                      type="button"
                      className="quiet"
                      onClick={() => {
                        handOver(FILTERS, { ...filters, subfolders: false } satisfies DocumentFilters);
                        navigate(paths.documents(workspaceId));
                      }}
                    >
                      {t('documents.find.everywhere')}
                    </button>
                  )}
                </div>
              )}
              {selecting && shown.length > 0 && (
                <div className="row select-bar">
                  <span role="status">{t('documents.selected', { count: selected.length })}</span>
                  <button type="button" disabled={selected.length === 0} onClick={() => open('move-documents')}>
                    {t('documents.moveSelected')}
                  </button>
                  <button type="button" disabled={selected.length === 0} onClick={() => open('export-selected')}>
                    {t('documents.export.selected')}
                  </button>
                  <button type="button" className="quiet" onClick={() => (setSelecting(false), setSelected([]))}>
                    {t('documents.stopSelecting')}
                  </button>
                </div>
              )}
              <DocumentList
                workspaceId={workspaceId}
                documents={shown}
                view={view}
                sort={filters.sort}
                place={(each) => (several ? folderLabel(folders, each.folderId) : null)}
                selecting={selecting}
                selected={selected}
                onSelect={setSelected}
              />
              {listing.nextCursor !== null && (
                <button type="button" disabled={busy} onClick={showMore}>
                  {t('documents.find.showMore')}
                </button>
              )}
            </div>
          )}
        </>
      )}

      <UndoNotice notice={notice} onDismiss={() => setTrashed(null)} />

      {dialog === 'new-folder' && (
        <FormDialog
          title={folder === null ? t('documents.newFolder') : t('documents.newFolderIn', { name: folder.name })}
          submitLabel={t('documents.createFolder')}
          onClose={close}
          onSubmit={async () => {
            await api.createDocumentFolder(workspaceId, name, folderId);
            reload();
          }}
        >
          <div className="field">
            <label htmlFor="folder-name">{t('documents.folderName')}</label>
            <input id="folder-name" required maxLength={80} value={name} placeholder={t('documents.folderNamePlaceholder')} onChange={(event) => setName(event.target.value)} />
          </div>
        </FormDialog>
      )}
      {dialog === 'rename' && folder !== null && (
        <FormDialog
          title={t('documents.renameFolder', { name: folder.name })}
          submitLabel={t('documents.rename')}
          onClose={close}
          onSubmit={async () => {
            await api.renameDocumentFolder(workspaceId, folder, name);
            reload();
          }}
        >
          <div className="field">
            <label htmlFor="folder-rename">{t('documents.folderName')}</label>
            <input id="folder-rename" required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
          </div>
        </FormDialog>
      )}
      {dialog === 'move' && folder !== null && (
        <FormDialog
          title={t('documents.moveFolder', { name: folder.name })}
          submitLabel={t('documents.move')}
          onClose={close}
          onSubmit={async () => {
            await api.moveDocumentFolder(workspaceId, folder, target);
            reload();
          }}
        >
          <p className="muted" style={{ margin: 0 }}>
            {t('documents.moveFolderHint')}
          </p>
          <FolderSelect folders={folders} value={target} onChange={setTarget} label={t('documents.moveTo')} only={moveTargets(folders, folder.id).map((entry) => entry.folder.id)} />
        </FormDialog>
      )}
      {dialog === 'delete' && folder !== null && (
        <FormDialog
          title={t('documents.deleteFolderHeading', { name: folder.name })}
          submitLabel={t('documents.moveToTrash')}
          danger
          onClose={close}
          onSubmit={async () => {
            await api.deleteDocumentFolder(workspaceId, folder.id);
            handOver(TRASHED, { workspaceId, kind: 'folder', id: folder.id, name: folder.name } satisfies Trashed);
            navigate(paths.documents(workspaceId, folder.parentId), { replace: true });
          }}
        >
          <p style={{ margin: 0 }}>{t('documents.deleteFolderText', { folders: contents.folders, documents: contents.documents })}</p>
          <p className="muted" style={{ margin: 0 }}>
            {t('documents.trashKeeps')}
          </p>
        </FormDialog>
      )}
      {dialog === 'move-documents' && (
        <FormDialog
          title={t('documents.moveDocuments', { count: selected.length })}
          submitLabel={t('documents.move')}
          onClose={close}
          onSubmit={async () => {
            await api.moveDocuments(workspaceId, selected, target);
            setSelecting(false);
            setSelected([]);
            reload();
          }}
        >
          <FolderSelect folders={folders} value={target} onChange={setTarget} label={t('documents.moveTo')} />
        </FormDialog>
      )}
      {dialog === 'types' && types !== null && <DocumentTypesDialog workspaceId={workspaceId} types={types} onChanged={loadTypes} onClose={close} />}
      {dialog === 'export' && <ExportDialog workspaceId={workspaceId} title={folder === null ? t('documents.export.allHeading') : t('documents.export.folderHeading', { name: folder.name })} scope={exportQuery({ folderId })} onClose={close} />}
      {dialog === 'export-selected' && <ExportDialog workspaceId={workspaceId} title={t('documents.export.selectedHeading', { count: selected.length })} scope={exportQuery({ documentIds: selected })} onClose={close} />}
    </section>
  );
}

/**
 * Adding a Document: choose files, a title (proposed from the first file), the Folder — and Save. Type,
 * dates, notes and tags are behind "More details". The files are uploaded at once but are only kept
 * when Save makes them a Document; nothing is stored as a draft, and the page says so.
 */
function NewDocument(props: { workspaceId: string; folderId: string | null }) {
  const { workspaceId } = props;
  const uploads = useUploads(workspaceId);
  const [folders, setFolders] = useState<readonly DocumentFolder[]>([]);
  const [types, setTypes] = useState<DocumentTypes | null>(null);
  const [folderId, setFolderId] = useState(props.folderId);
  const [form, setForm] = useState<DocumentForm>(EMPTY_FORM);
  const [titleTouched, setTitleTouched] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saved = useRef(false);

  useEffect(() => {
    void api.documentFolders(workspaceId).then(setFolders, (caught: unknown) => setMessage(failureText(caught)));
    void api.documentTypes(workspaceId).then(setTypes, () => undefined);
  }, [workspaceId]);

  // The title follows the first file until the person writes their own.
  const firstName = uploads.items[0]?.file.name;
  const shown: DocumentForm = titleTouched ? form : { ...form, title: firstName === undefined ? '' : titleFromFileName(firstName) };

  // Leaving with files chosen would drop them: ask first (also when closing the tab).
  const pending = uploads.items.length > 0;
  useEffect(() => {
    if (!pending) return;
    setNavigationGuard(() => saved.current || window.confirm(t('documents.upload.leaveConfirm')));
    const warn = (event: BeforeUnloadEvent) => {
      if (!saved.current) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      setNavigationGuard(null);
      window.removeEventListener('beforeunload', warn);
    };
  }, [pending]);

  const done = uploads.items.filter((item) => item.status === 'done');
  const failed = uploads.items.filter((item) => item.status === 'failed').length;
  const running = uploads.items.some((item) => item.status === 'uploading' || item.status === 'waiting');

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const created = await api.createDocument(workspaceId, folderId, fieldsOf(shown), done.flatMap((item) => (item.uploaded === null ? [] : [item.uploaded.id])));
      saved.current = true;
      navigate(paths.document(workspaceId, created.id), { replace: true, force: true });
    } catch (caught) {
      setMessage(failureText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="new-document-heading">
      <p className="back-row">
        <Link href={paths.documents(workspaceId, props.folderId)} className="back-link">
          <UiIcon name="back" /> {t('documents.backToDocuments')}
        </Link>
      </p>
      <div className="page-header">
        <h2 id="new-document-heading">{t('documents.addHeading')}</h2>
      </div>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <p className="callout">{t('documents.upload.metadataNotice')}</p>
        <FileChooser label={uploads.items.length === 0 ? t('documents.upload.choose') : t('documents.upload.chooseMore')} onFiles={uploads.add} />
        <UploadList uploads={uploads} />
        {uploads.items.length > 1 && <p className="muted">{t('documents.upload.oneDocument', { count: uploads.items.length })}</p>}
        <div className="card stack">
          <DocumentFormFields
            form={shown}
            types={types}
            currentType={null}
            folded
            onChange={(next) => {
              if (next.title !== shown.title) setTitleTouched(true);
              setForm(next);
            }}
          />
          <FolderSelect folders={folders} value={folderId} onChange={setFolderId} label={t('documents.field.folder')} />
        </div>
        {message !== null && <p role="alert">{message}</p>}
        {failed > 0 && <p className="muted">{t('documents.upload.failedNote', { count: failed })}</p>}
        <p className="muted">{t('documents.upload.notSavedYet')}</p>
        <div className="row">
          <button type="submit" className="primary" disabled={busy || running || done.length === 0 || shown.title.trim() === ''}>
            <UiIcon name="save" /> {t('documents.save')}
          </button>
          <button type="button" onClick={() => navigate(paths.documents(workspaceId, props.folderId))}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </section>
  );
}

/** One file of a Document: its preview pages (or why there are none) and the download of the original. */
function PageCard(props: { workspaceId: string; file: DocumentFile; index: number; total: number; onOpen: (src: string, label: string) => void; actions: React.ReactNode }) {
  const { workspaceId, file } = props;
  const [shown, setShown] = useState(PAGES_PER_STEP);
  const note = previewNote(file);
  const label = t('documents.pages.label', { n: props.index + 1, total: props.total, name: file.name });
  const visible = Math.min(file.preview.pages, shown);
  return (
    <li className="card document-page">
      <h4 className="document-page-title">{label}</h4>
      {note !== null ? (
        <p className="document-no-preview">
          <UiIcon name="documents" size="1.5em" /> {note}
        </p>
      ) : (
        <>
          <div className="document-previews">
            {Array.from({ length: visible }, (_, page) => {
              const src = documentFileUrls.page(workspaceId, file.id, page + 1);
              const alt = file.format === 'PDF' ? t('documents.preview.altPdf', { name: file.name, page: page + 1 }) : t('documents.preview.alt', { name: file.name });
              return (
                <button key={page} type="button" className="document-preview-open" aria-label={t('documents.preview.open', { name: alt })} onClick={() => props.onOpen(src, alt)}>
                  <img src={src} alt={alt} loading="lazy" decoding="async" />
                </button>
              );
            })}
          </div>
          <p className="muted document-preview-caption">
            {t('documents.preview.caption')}
            {file.pageCount !== null && file.pageCount > 1 && ` ${t('documents.preview.pdfPages', { shown: visible, total: file.pageCount })}`}
            {file.preview.state === 'PENDING' && ` ${t('documents.preview.morePending')}`}
            {file.preview.state === 'PARTIAL' && ` ${t('documents.preview.storageFull')}`}
            {file.pageCount !== null && file.pageCount > 500 && ` ${t('documents.preview.pageLimit')}`}
          </p>
          {file.preview.pages > visible && (
            <button type="button" onClick={() => setShown(shown + PAGES_PER_STEP)}>
              {t('documents.preview.showMore', { count: Math.min(PAGES_PER_STEP, file.preview.pages - visible) })}
            </button>
          )}
        </>
      )}
      {file.activeContent && <p className="muted">{t('documents.preview.activeContent')}</p>}
      <div className="row document-page-actions">
        <a className="button" href={documentFileUrls.original(workspaceId, file.id)} download aria-label={t('documents.downloadNamed', { name: file.name })}>
          <UiIcon name="download" /> {t('documents.downloadOriginal')}
        </a>
        <small className="muted">
          {file.format} · {formatBytes(file.bytes)}
        </small>
        {props.actions}
      </div>
    </li>
  );
}

/** One Document: its facts, its pages in order, previews and downloads; editing for those who may. */
function DocumentPage(props: { workspaceId: string; documentId: string; canManage: boolean }) {
  const { workspaceId, documentId, canManage } = props;
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [folders, setFolders] = useState<readonly DocumentFolder[]>([]);
  const [types, setTypes] = useState<DocumentTypes | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [dialog, setDialog] = useState<'edit' | 'move' | null>(null);
  const [form, setForm] = useState<DocumentForm>(EMPTY_FORM);
  const [target, setTarget] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ src: string; label: string } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const viewerRef = useRef<HTMLDialogElement>(null);
  const viewerHeading = useId();
  const adding = useUploads(workspaceId);

  const load = useCallback(() => {
    api.document(workspaceId, documentId).then(
      (loaded) => {
        setDoc(loaded);
        setMissing(false);
      },
      (caught: unknown) => {
        if (isNotFound(caught)) setMissing(true);
        else setMessage(failureText(caught));
      },
    );
  }, [workspaceId, documentId]);
  useEffect(load, [load]);
  useEffect(() => {
    void api.documentFolders(workspaceId).then(setFolders, () => undefined);
  }, [workspaceId]);
  const preparing = doc?.pages.some((page) => page.preview.state === 'PENDING') === true;
  useRefresh(load, preparing ? PREVIEW_REFRESH_MS : REFRESH_MS);

  useEffect(() => {
    if (viewer !== null && viewerRef.current?.open === false) viewerRef.current.showModal();
  }, [viewer]);

  // Pages added here are saved as soon as they are uploaded: each finished file is appended to the Document.
  const finished = adding.items.filter((item) => item.status === 'done' && item.uploaded !== null);
  const appending = useRef(false);
  useEffect(() => {
    const next = finished[0];
    if (doc === null || next?.uploaded == null || appending.current) return;
    appending.current = true;
    api.setDocumentFiles(workspaceId, doc.id, [...doc.pages.map((page) => page.id), next.uploaded.id], doc.revision).then(
      (updated) => {
        setDoc(updated);
        adding.remove(next.key);
        setStatus(t('documents.pages.added', { name: next.file.name }));
      },
      (caught: unknown) => {
        setMessage(failureText(caught));
        adding.remove(next.key);
        load();
      },
    ).finally(() => {
      appending.current = false;
    });
  }, [adding, doc, finished, load, workspaceId]);

  if (missing) {
    return (
      <p role="alert">
        {t('documents.documentGone')} <Link href={paths.documents(workspaceId)}>{t('documents.backToDocuments')}</Link>
      </p>
    );
  }
  if (doc === null) return message === null ? <p>{t('common.loading')}</p> : <p role="alert">{message}</p>;

  const change = (action: Promise<DocumentDetail>, done?: string) =>
    void action.then(
      (updated) => {
        setDoc(updated);
        setMessage(null);
        if (done !== undefined) setStatus(done);
      },
      (caught: unknown) => {
        setMessage(failureText(caught));
        load(); // show what the Document is now (someone else may have changed it)
      },
    );
  const reorder = (index: number, delta: number) => {
    const order = moved(doc.pages, index, delta);
    change(api.setDocumentFiles(workspaceId, doc.id, order.map((page) => page.id), doc.revision), t('documents.pages.moved', { name: doc.pages[index]?.name ?? '', n: index + delta + 1 }));
  };
  const removePage = (page: DocumentFile) => {
    if (!window.confirm(t('documents.pages.removeConfirm', { name: page.name }))) return;
    change(api.setDocumentFiles(workspaceId, doc.id, doc.pages.filter((each) => each.id !== page.id).map((each) => each.id), doc.revision), t('documents.pages.removed', { name: page.name }));
  };
  const downloadAll = () => {
    // One download per original, a moment apart (browsers ask once whether several downloads are allowed).
    doc.pages.forEach((page, index) => {
      window.setTimeout(() => {
        const link = document.createElement('a');
        link.href = documentFileUrls.original(workspaceId, page.id);
        link.download = '';
        document.body.append(link);
        link.click();
        link.remove();
      }, index * 400);
    });
  };
  const type = typeLabel(doc.type);

  return (
    <section aria-labelledby="document-heading">
      <Breadcrumbs workspaceId={workspaceId} folders={folders} folderId={doc.folderId} last={doc.title} />
      <div className="page-header page-header-tool">
        <h2 id="document-heading">{doc.title}</h2>
        <div className="row">
          {doc.pages.length > 1 && (
            <button type="button" onClick={downloadAll}>
              <UiIcon name="download" /> {t('documents.downloadAll', { count: doc.pages.length })}
            </button>
          )}
          <MoreMenu
            label={t('documents.documentActions', { title: doc.title })}
            items={
              canManage
                ? [
                    {
                      label: t('documents.editDetails'),
                      onSelect: () => {
                        setForm(formOf(doc));
                        void api.documentTypes(workspaceId).then(setTypes, () => undefined);
                        setDialog('edit');
                      },
                    },
                    {
                      label: t('documents.move'),
                      onSelect: () => {
                        setTarget(doc.folderId);
                        setDialog('move');
                      },
                    },
                    {
                      label: t('documents.moveToTrash'),
                      danger: true,
                      onSelect: () =>
                        void api.deleteDocument(workspaceId, doc.id).then(
                          () => {
                            handOver(TRASHED, { workspaceId, kind: 'document', id: doc.id, name: doc.title } satisfies Trashed);
                            navigate(paths.documents(workspaceId, doc.folderId), { replace: true });
                          },
                          (caught: unknown) => setMessage(failureText(caught)),
                        ),
                    },
                  ]
                : []
            }
          />
        </div>
      </div>
      {message !== null && <p role="alert">{message}</p>}
      <p role="status" className="visually-hidden">
        {status ?? ''}
      </p>

      <dl className="card card-facts document-facts">
        {type !== null && (
          <div>
            <dt>{t('documents.field.type')}</dt>
            <dd>{type}</dd>
          </div>
        )}
        {doc.documentDate !== null && (
          <div>
            <dt>{t('documents.field.documentDate')}</dt>
            <dd>{formatCalendarDate(doc.documentDate)}</dd>
          </div>
        )}
        {doc.year !== null && (
          <div>
            <dt>{t('documents.field.year')}</dt>
            <dd>{doc.year}</dd>
          </div>
        )}
        <div>
          <dt>{t('documents.field.folder')}</dt>
          <dd>{folderLabel(folders, doc.folderId)}</dd>
        </div>
        {doc.tags.length > 0 && (
          <div>
            <dt>{t('documents.field.tags')}</dt>
            <dd>{doc.tags.join(', ')}</dd>
          </div>
        )}
        {doc.notes !== '' && (
          <div>
            <dt>{t('documents.field.notes')}</dt>
            <dd className="document-notes">{doc.notes}</dd>
          </div>
        )}
        <div>
          <dt>{t('documents.uploaded')}</dt>
          <dd>{t('documents.byAt', { name: doc.uploadedBy, when: formatDateTime(doc.uploadedAt) })}</dd>
        </div>
        {doc.modifiedAt !== doc.uploadedAt && (
          <div>
            <dt>{t('documents.modified')}</dt>
            <dd>{t('documents.byAt', { name: doc.modifiedBy, when: formatDateTime(doc.modifiedAt) })}</dd>
          </div>
        )}
      </dl>

      <h3 className="section-label">{t('documents.pages.heading', { count: doc.pages.length })}</h3>
      <ol className="plain-list">
        {doc.pages.map((page, index) => (
          <PageCard
            key={page.id}
            workspaceId={workspaceId}
            file={page}
            index={index}
            total={doc.pages.length}
            onOpen={(src, label) => setViewer({ src, label })}
            actions={
              canManage && doc.pages.length > 1 ? (
                <>
                  <button type="button" className="quiet" disabled={index === 0} aria-label={t('documents.pages.moveUpNamed', { name: page.name })} onClick={() => reorder(index, -1)}>
                    {t('documents.pages.moveUp')}
                  </button>
                  <button type="button" className="quiet" disabled={index === doc.pages.length - 1} aria-label={t('documents.pages.moveDownNamed', { name: page.name })} onClick={() => reorder(index, 1)}>
                    {t('documents.pages.moveDown')}
                  </button>
                  <button type="button" className="quiet danger-text" aria-label={t('documents.pages.removeNamed', { name: page.name })} onClick={() => removePage(page)}>
                    {t('documents.pages.remove')}
                  </button>
                </>
              ) : null
            }
          />
        ))}
      </ol>
      {canManage && doc.pages.length < 50 && (
        <div className="stack">
          <h3 className="section-label">{t('documents.pages.addHeading')}</h3>
          <FileChooser label={t('documents.pages.add')} onFiles={adding.add} />
          <UploadList uploads={adding} />
        </div>
      )}
      <p className="muted">{dateLine(doc)}</p>

      {viewer !== null && (
        <dialog ref={viewerRef} className="image-viewer document-viewer" aria-labelledby={viewerHeading} onClose={() => setViewer(null)}>
          <form method="dialog" className="image-viewer-bar">
            <p id={viewerHeading}>{viewer.label}</p>
            <button type="submit" className="primary">
              {t('common.close')}
            </button>
          </form>
          {/* Full size, scrollable in both directions inside the viewer: small print can be read without downloading. */}
          <div className="document-viewer-scroll" tabIndex={0} role="group" aria-label={t('documents.preview.zoomed')}>
            <img src={viewer.src} alt={viewer.label} />
          </div>
        </dialog>
      )}
      {dialog === 'edit' && (
        <FormDialog
          title={t('documents.editDetails')}
          submitLabel={t('documents.saveChanges')}
          onClose={() => setDialog(null)}
          onSubmit={async () => {
            // On a conflict the Document is loaded again, so the next attempt builds on what it is now.
            setDoc(
              await api.updateDocument(workspaceId, doc.id, fieldsOf(form), doc.revision).catch((caught: unknown) => {
                load();
                throw caught;
              }),
            );
          }}
        >
          <DocumentFormFields form={form} onChange={setForm} types={types} currentType={doc.type} folded={false} />
        </FormDialog>
      )}
      {dialog === 'move' && (
        <FormDialog
          title={t('documents.moveDocument', { title: doc.title })}
          submitLabel={t('documents.move')}
          onClose={() => setDialog(null)}
          onSubmit={async () => {
            await api.moveDocuments(workspaceId, [doc.id], target);
            load();
          }}
        >
          <FolderSelect folders={folders} value={target} onChange={setTarget} label={t('documents.moveTo')} />
        </FormDialog>
      )}
    </section>
  );
}

/** What is asked before something is deleted for good: how much, that it cannot be undone, what stays, and that backups are another matter. */
function PurgeDialog(props: { workspaceId: string; entries: readonly TrashEntry[] | 'all'; totals: { folders: number; documents: number; files: number }; onClose: () => void; onPurged: (message: string) => void }) {
  const { totals } = props;
  return (
    <FormDialog
      title={props.entries === 'all' ? t('documents.purge.allHeading') : props.entries.length === 1 ? t('documents.purge.oneHeading', { name: props.entries[0]?.name ?? '' }) : t('documents.purge.someHeading', { count: props.entries.length })}
      submitLabel={t('documents.purge.confirm')}
      danger
      onClose={props.onClose}
      onSubmit={async () => {
        const purged = await api.purgeDocumentTrash(props.workspaceId, props.entries === 'all' ? 'all' : props.entries.map((entry) => ({ kind: entry.kind, id: entry.id })));
        props.onPurged(t('documents.purge.done', purged));
      }}
    >
      <p style={{ margin: 0 }}>
        <strong>{t('documents.purge.what', totals)}</strong>
      </p>
      <p style={{ margin: 0 }}>{t('documents.purge.cannotUndo')}</p>
      <p className="muted" style={{ margin: 0 }}>
        {t('documents.purge.kept')}
      </p>
      <p className="muted" style={{ margin: 0 }}>
        {t('documents.purge.backups')}
      </p>
    </FormDialog>
  );
}

/**
 * What is in Trash, with Restore. A trashed Folder can be opened to restore only a part of it. A
 * Workspace admin (`canPurge`) can also delete entries for good — one, several chosen, or all of it.
 */
function TrashList(props: { workspaceId: string; within: string | null; canPurge: boolean; onChanged: (message: string) => void; version: number }) {
  const { workspaceId, within, canPurge } = props;
  const [entries, setEntries] = useState<readonly TrashEntry[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [opened, setOpened] = useState<readonly string[]>([]);
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const [purging, setPurging] = useState<readonly TrashEntry[] | 'all' | null>(null);
  const load = useCallback(() => {
    api.documentTrash(workspaceId, within).then(
      (loaded) => {
        setEntries(loaded);
        setChosen((current) => current.filter((id) => loaded.some((entry) => entry.id === id)));
      },
      (caught: unknown) => setMessage(failureText(caught)),
    );
  }, [workspaceId, within]);
  useEffect(load, [load, props.version]);
  if (message !== null) return <p role="alert">{message}</p>;
  if (entries === null) return <p>{t('common.loading')}</p>;
  if (entries.length === 0) return <p className={within === null ? 'card calm' : 'muted'}>{t(within === null ? 'documents.trash.empty' : 'documents.trash.emptyFolder')}</p>;
  const top = within === null;
  const picked = entries.filter((entry) => chosen.includes(entry.id));
  return (
    <>
      {canPurge && top && (
        <div className="row select-bar">
          <button type="button" className="danger" onClick={() => setPurging('all')}>
            <UiIcon name="trash" /> {t('documents.purge.all')}
          </button>
          <button type="button" disabled={picked.length === 0} onClick={() => setPurging(picked)}>
            {picked.length === 0 ? t('documents.purge.selectedNone') : t('documents.purge.selected', { count: picked.length })}
          </button>
        </div>
      )}
      <ul className="plain-list trash-list">
        {entries.map((entry) => {
          const expanded = opened.includes(entry.id);
          return (
            <li key={entry.id} className="card">
              <div className="trash-entry">
                {canPurge && top && (
                  <input
                    type="checkbox"
                    aria-label={t('documents.purge.choose', { name: entry.name })}
                    checked={chosen.includes(entry.id)}
                    onChange={(event) => setChosen(event.target.checked ? [...chosen, entry.id] : chosen.filter((id) => id !== entry.id))}
                  />
                )}
                <span className="item-icon">
                  <UiIcon name={entry.kind === 'folder' ? 'folder' : 'documents'} size="1.5em" />
                </span>
                <span className="item-body">
                  <strong>{entry.name}</strong>
                  <small className="muted">
                    {t(entry.kind === 'folder' ? 'documents.trash.folder' : 'documents.trash.document')} · {entry.location.length === 0 ? t('documents.topLevel') : entry.location.join(' / ')}
                    {entry.kind === 'folder' && ` · ${t('documents.trash.contents', { folders: entry.folders, documents: entry.documents })}`}
                  </small>
                  <small className="muted">{t('documents.trash.deletedBy', { name: entry.deletedBy, when: formatDateTime(entry.deletedAt) })}</small>
                </span>
              </div>
              <div className="row">
                <button
                  type="button"
                  aria-label={t('documents.trash.restoreNamed', { name: entry.name })}
                  onClick={() =>
                    void (entry.kind === 'folder' ? api.restoreDocumentFolder(workspaceId, entry.id) : api.restoreDocument(workspaceId, entry.id)).then(
                      (outcome) => props.onChanged(restoreMessage(entry.name, outcome)),
                      (caught: unknown) => setMessage(failureText(caught)),
                    )
                  }
                >
                  <UiIcon name="undo" /> {t('documents.trash.restore')}
                </button>
                {entry.kind === 'folder' && entry.folders + entry.documents > 0 && (
                  <button type="button" className="quiet" aria-expanded={expanded} onClick={() => setOpened(expanded ? opened.filter((id) => id !== entry.id) : [...opened, entry.id])}>
                    {t(expanded ? 'documents.trash.hideContents' : 'documents.trash.showContents')}
                  </button>
                )}
                {canPurge && (
                  <button type="button" className="quiet danger-text" aria-label={t('documents.purge.oneNamed', { name: entry.name })} onClick={() => setPurging([entry])}>
                    {t('documents.purge.one')}
                  </button>
                )}
              </div>
              {expanded && <TrashList workspaceId={workspaceId} within={entry.id} canPurge={canPurge} onChanged={props.onChanged} version={props.version} />}
            </li>
          );
        })}
      </ul>
      {purging !== null && (
        <PurgeDialog workspaceId={workspaceId} entries={purging} totals={purgeTotals(purging === 'all' ? entries : purging)} onClose={() => setPurging(null)} onPurged={props.onChanged} />
      )}
    </>
  );
}

function Trash(props: { workspaceId: string; canPurge: boolean }) {
  const [status, setStatus] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  return (
    <section aria-labelledby="trash-heading">
      <p className="back-row">
        <Link href={paths.documents(props.workspaceId)} className="back-link">
          <UiIcon name="back" /> {t('documents.backToDocuments')}
        </Link>
      </p>
      <div className="page-header page-header-tool">
        <div>
          <h2 id="trash-heading">{t('documents.trash.heading')}</h2>
          <p className="muted page-lead">{t(props.canPurge ? 'documents.trash.leadAdmin' : 'documents.trash.lead')}</p>
        </div>
      </div>
      {status !== null && (
        <p role="status" className="card calm">
          {status}
        </p>
      )}
      <TrashList
        workspaceId={props.workspaceId}
        within={null}
        canPurge={props.canPurge}
        version={version}
        onChanged={(message) => {
          setStatus(message);
          setVersion((current) => current + 1);
        }}
      />
    </section>
  );
}

/**
 * The Documents tool (16.2): Folders and Documents of the Workspace. Everyone in the Workspace reads,
 * previews and downloads; `canManage` (USER and above) adds, edits, moves and deletes to Trash. The
 * controls shown follow that — the server decides on every request.
 */
export function Documents(props: { workspaceId: string; route: DocumentsRoute; canManage: boolean; canPurge: boolean }) {
  const { workspaceId, route, canManage } = props;
  const readOnly = (
    <p role="alert">
      {t('documents.manageOnly')} <Link href={paths.documents(workspaceId)}>{t('documents.backToDocuments')}</Link>
    </p>
  );
  if (route.view === 'document' && route.documentId !== null) return <DocumentPage workspaceId={workspaceId} documentId={route.documentId} canManage={canManage} />;
  if (route.view === 'new') return canManage ? <NewDocument workspaceId={workspaceId} folderId={route.folderId} /> : readOnly;
  if (route.view === 'trash') return canManage ? <Trash workspaceId={workspaceId} canPurge={props.canPurge} /> : readOnly;
  // One instance per place: search and filters start afresh in every Folder (and come back from the address).
  return <FolderView key={route.folderId ?? 'top'} workspaceId={workspaceId} folderId={route.folderId} canManage={canManage} />;
}
