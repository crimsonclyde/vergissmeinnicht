import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { JOURNAL_IMPORT_LIMITS, parseJournalMarkdown, type JournalContent, type JournalDraft } from '@vergissmeinnicht/domain';
import { api, attachmentUrl, messageFor, uploadJournalImage, type JournalOverview, type JournalView } from '../../api.ts';
import { formatCalendarDate, formatWeekdayLong, t } from '../../i18n/index.ts';
import { MarkdownEditor } from '../../markdown/MarkdownEditor.tsx';
import { WorkspaceReferences } from '../../markdown/WorkspaceReferences.tsx';
import { MobileActionBar } from '../../mobile/MobileActionBar.tsx';
import { useCompactLayout } from '../../mobile/useCompactLayout.ts';
import { moonAt } from '../../moon.ts';
import { navigate, paths, replaceEditorPath, setNavigationGuard } from '../../router.tsx';
import { UiIcon } from '../../ui-icons.tsx';
import { temperature } from '../../weather-view.ts';
import { JournalHome, type JournalFilters, type JournalLayout } from './JournalHome.tsx';
import { JournalImages, imageReference } from './JournalImages.tsx';
import { JournalReader } from './JournalReader.tsx';
import { localDate, notebookTone, weatherStamp } from './journal-view.ts';
import './journal.css';

type Mode = 'list' | 'read' | 'edit';
type PhoneScreen = 'title' | 'write' | 'details';

const contentOf = (entry: JournalView): JournalContent => ({ kind: entry.kind, version: entry.version, title: entry.title, date: entry.date, body: entry.body, collection: entry.collection ?? '', tags: entry.tags ?? [], pinned: entry.pinned ?? false });
const fresh = (): JournalContent => ({ kind: 'note', version: 2, title: '', date: null, body: '', collection: '', tags: [], pinned: false });
const ATTACHMENT = /^attachments\/([0-9a-f-]{36})\.(?:jpg|png)$/;

function readSetting<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try { const value = window.localStorage.getItem(key); return allowed.includes(value as T) ? value as T : fallback; } catch { return fallback; }
}
function writeSetting(key: string, value: string) { try { window.localStorage.setItem(key, value); } catch { /* per-device convenience only */ } }

/**
 * Notes (shared, `workspaceId`) and the personal Journal (no Workspace) — steps.md 27 and 40.
 * Markdown is the stored, imported and exported format; the visual editor is a view of it.
 */
export function JournalPage({ workspaceId, canWrite, creating = false, entryId, homeHref }: { workspaceId?: string; canWrite: boolean; creating?: boolean; entryId?: string; homeHref?: string }) {
  const compact = useCompactLayout();
  const personal = workspaceId === undefined;
  const formId = useId(); const panelId = useId();
  const titleInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const layoutKey = `vmn.journal.layout.${personal ? 'private' : 'shared'}`;

  const [consent, setConsent] = useState<boolean | null>(personal ? null : true);
  const [mode, setMode] = useState<Mode>(creating ? 'edit' : entryId !== undefined ? 'read' : 'list');
  const [phoneScreen, setPhoneScreen] = useState<PhoneScreen>(creating ? 'title' : 'write');
  const [editorStarted, setEditorStarted] = useState(false);
  const [loadingEntry, setLoadingEntry] = useState(entryId !== undefined);
  const [entries, setEntries] = useState<JournalView[] | null>(null);
  const [overview, setOverview] = useState<JournalOverview | null>(null);
  const [overviewVersion, setOverviewVersion] = useState(0);
  const [entry, setEntry] = useState<JournalView | null>(null);
  const [draft, setDraft] = useState<JournalContent | null>(null);
  const [original, setOriginal] = useState('');
  const [recovery, setRecovery] = useState<JournalDraft | null>(null);
  const [imageVersion, setImageVersion] = useState(0);
  const [layout, setLayout] = useState<JournalLayout>(() => readSetting(layoutKey, personal ? ['timeline', 'cards', 'list'] : ['cards', 'list'], personal ? 'timeline' : 'cards'));
  const [filters, setFiltersState] = useState<JournalFilters>({ search: '', collection: undefined, tag: undefined, sort: 'updated', archived: false, month: localDate().slice(0, 7) });
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [autosave, setAutosave] = useState(() => readSetting('vmn.journal.autosave', ['on', 'off'], 'off') === 'on');
  const [editorKey, setEditorKey] = useState(0);
  const [sourceMode, setSourceMode] = useState(false);

  const isEditing = mode === 'edit' && draft !== null && canWrite;
  const activeScreen: PhoneScreen = compact ? phoneScreen : 'write';
  useEffect(() => { window.dispatchEvent(new CustomEvent('vmn-journal-editing', { detail: isEditing })); return () => { window.dispatchEvent(new CustomEvent('vmn-journal-editing', { detail: false })); }; }, [isEditing]);
  const dirty = draft !== null && JSON.stringify(draft) !== original;
  const current = useRef({ draft, entry, busy, dirty });
  useLayoutEffect(() => { current.current = { draft, entry, busy, dirty }; }, [draft, entry, busy, dirty]);
  const leave = useCallback(() => !dirty || window.confirm(t('journal.unsaved')), [dirty]);
  // The navigation guard asks about unsaved changes, once.
  const goHome = () => { if (!busy) navigate(homeHref ?? (workspaceId ? paths.home(workspaceId) : '/')); };
  const libraryPath = workspaceId ? paths.journal(workspaceId) : paths.account('journal');
  const entryPath = (id: string) => workspaceId ? paths.note(workspaceId, id) : paths.journalEntry(id);

  useEffect(() => {
    setNavigationGuard(leave);
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => { setNavigationGuard(null); window.removeEventListener('beforeunload', warn); };
  }, [leave, dirty]);

  // Private Journal: the per-account notice comes first.
  useEffect(() => { if (!personal) return; let active = true; api.journalPrivacy().then(result => { if (active) setConsent(result.acknowledged); }, error => { if (active) setMessage(messageFor(error)); }); return () => { active = false; }; }, [personal]);

  // A deep link opens the entry to read.
  useEffect(() => {
    if (!entryId || consent !== true) return;
    let active = true;
    api.journalEntry(workspaceId, entryId).then(result => { if (active) showEntry(result, 'read'); }, error => { if (active) setMessage(messageFor(error)); }).finally(() => { if (active) setLoadingEntry(false); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per deep link
  }, [workspaceId, entryId, consent]);

  // Live search: settle for a moment before asking the server.
  useEffect(() => { const timer = window.setTimeout(() => { setQuery(filters.search.trim()); }, 300); return () => window.clearTimeout(timer); }, [filters.search]);

  const timeline = personal && layout === 'timeline';
  const listOptions = timeline
    ? { month: filters.month, sort: 'date' as const }
    : { collection: filters.collection, tag: filters.tag, sort: filters.sort };
  const listKey = JSON.stringify([workspaceId, timeline ? '' : query, timeline ? false : filters.archived, offset, listOptions]);
  const reload = useCallback(async () => {
    const [q, archived, page, options] = JSON.parse(listKey).slice(1) as [string, boolean, number, typeof listOptions];
    const result = await api.journal(workspaceId, q, archived, page, options);
    setEntries(result.entries); setMore(result.more);
  }, [workspaceId, listKey]);
  useEffect(() => {
    if (consent !== true) return;
    let active = true;
    const [q, archived, page, options] = JSON.parse(listKey).slice(1) as [string, boolean, number, typeof listOptions];
    api.journal(workspaceId, q, archived, page, options).then(result => { if (active) { setEntries(result.entries); setMore(result.more); } }, error => { if (active) setMessage(messageFor(error)); });
    return () => { active = false; };
  }, [consent, workspaceId, listKey]);
  useEffect(() => {
    if (consent !== true) return;
    let active = true;
    api.journalOverview(workspaceId).then(result => { if (active) setOverview(result); }, () => { if (active) setOverview(null); });
    return () => { active = false; };
  }, [consent, workspaceId, overviewVersion]);

  useEffect(() => {
    if (consent !== true || !canWrite) return;
    let active = true;
    api.journalDraft(workspaceId).then(result => { if (active) { setRecovery(result.draft); if (creating && result.draft === null) startEditing(fresh(), null); } }, error => { if (active) setMessage(messageFor(error)); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per library
  }, [consent, canWrite, creating, workspaceId]);

  const refresh = useCallback(async () => { setOverviewVersion(value => value + 1); await reload().catch(error => setMessage(messageFor(error))); }, [reload]);
  const resolveImage = (path: string) => { const match = ATTACHMENT.exec(path); return match ? attachmentUrl(workspaceId, match[1] ?? '') : undefined; };
  async function uploadFile(file: File) { try { const fileRef = imageReference(await uploadJournalImage(workspaceId, file)); setImageVersion(value => value + 1); return fileRef; } catch (error) { setMessage(messageFor(error)); throw error; } }
  function change(next: JournalContent) { setDraft(next); setStatus(''); setMessage(null); }

  function showEntry(result: JournalView, next: Mode) {
    setEntry(result); const content = contentOf(result); setDraft(content); setOriginal(JSON.stringify(content));
    setEditorKey(value => value + 1); setStatus(''); setMode(next); setPhoneScreen('write');
    replaceEditorPath(entryPath(result.id)); window.scrollTo({ top: 0 });
  }
  function startEditing(content: JournalContent, base: JournalView | null) {
    setEntry(base); setDraft(content); setOriginal(JSON.stringify(content)); setEditorKey(value => value + 1); setStatus('');
    setMode('edit'); setPhoneScreen(compact && base === null ? 'title' : 'write');
    if (!compact && base === null) window.requestAnimationFrame(() => titleInput.current?.focus());
  }
  async function open(id: string) {
    if (!id || !leave()) return;
    setBusy(true); setMessage(null);
    try { showEntry(await api.journalEntry(workspaceId, id), 'read'); } catch (error) { setMessage(messageFor(error)); } finally { setBusy(false); }
  }
  function toList() {
    if (busy || !leave()) return;
    replaceEditorPath(libraryPath); setDraft(null); setEntry(null); setStatus(''); setMode('list');
  }
  function closeEditor() {
    if (busy || !leave()) return;
    if (entry !== null) { showEntry(entry, 'read'); return; }
    toList();
  }

  const save = useCallback(async (archive?: boolean) => {
    const state = current.current; if (state.draft === null || state.busy) return;
    setBusy(true); setMessage(null); setStatus(t('journal.saving'));
    try {
      const result = await api.saveJournal(workspaceId, state.entry?.id, state.draft, state.entry?.revision ?? 0, archive ?? state.entry?.archived ?? false);
      setEntry(result); replaceEditorPath(entryPath(result.id));
      const next = contentOf(result); const unchanged = JSON.stringify(current.current.draft) === JSON.stringify(state.draft);
      if (unchanged) setDraft(next);
      setOriginal(JSON.stringify(next)); setRecovery(null);
      setStatus(t(unchanged ? 'journal.saved' : 'journal.unsavedStatus'));
      await refresh();
    } catch (error) { setMessage(messageFor(error)); setStatus(t('journal.unsavedStatus')); setAutosave(false); } finally { setBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- paths only depend on workspaceId
  }, [workspaceId, refresh]);

  // Reading view: pin and archive save the entry as it is, with only that flag changed.
  async function quickSave(change: { pinned?: boolean; archived?: boolean }) {
    if (entry === null || busy) return;
    setBusy(true); setMessage(null);
    try {
      const result = await api.saveJournal(workspaceId, entry.id, { ...contentOf(entry), ...(change.pinned === undefined ? {} : { pinned: change.pinned }) }, entry.revision, change.archived ?? entry.archived);
      showEntry(result, 'read'); setStatus(t('journal.saved')); await refresh();
    } catch (error) { setMessage(messageFor(error)); } finally { setBusy(false); }
  }

  useEffect(() => {
    if (recovery !== null || !dirty || busy || draft === null || draft.title.trim() === '' || consent !== true || !canWrite || mode !== 'edit') return;
    let active = true;
    const timer = window.setTimeout(() => {
      if (autosave) { void save(); return; }
      void api.saveJournalDraft(workspaceId, { entryId: entry?.id ?? null, expectedRevision: entry?.revision ?? 0, content: draft, archived: entry?.archived ?? false }).then(() => { if (active) setStatus(t('journal.draftSaved')); }, error => { if (active) setMessage(messageFor(error)); });
    }, 1500);
    return () => { active = false; window.clearTimeout(timer); };
  }, [recovery, dirty, busy, draft, entry, consent, canWrite, autosave, save, workspaceId, mode]);

  async function recover() {
    if (!recovery || !leave()) return;
    setBusy(true);
    try {
      let target: JournalView | null = null;
      if (recovery.entryId !== null) target = await api.journalEntry(workspaceId, recovery.entryId);
      if (target && target.revision !== recovery.expectedRevision) { setMessage(t('error.journal_conflict')); setAutosave(false); }
      setEntry(target ? { ...target, revision: recovery.expectedRevision } : null);
      if (target) replaceEditorPath(entryPath(target.id));
      setMode('edit'); setPhoneScreen('write'); setDraft(recovery.content); setOriginal(''); setEditorKey(value => value + 1); setRecovery(null);
    } catch (error) { setMessage(messageFor(error)); } finally { setBusy(false); }
  }
  function discardRecovery() {
    void api.saveJournalDraft(workspaceId, null).then(() => { setRecovery(null); if (creating && draft === null) startEditing(fresh(), null); }, error => setMessage(messageFor(error)));
  }

  /** "Today's page": open today's entry, or start one dated today with the weather and moon as a Markdown line. */
  async function todayPage() {
    const today = localDate();
    const existing = overview?.dated.find(item => item.date === today);
    if (existing !== undefined) { await open(existing.id); return; }
    if (!leave()) return;
    setBusy(true);
    const stamp = await dayStamp();
    setBusy(false);
    startEditing({ ...fresh(), title: `${formatWeekdayLong(today)}, ${formatCalendarDate(today)}`, date: today, body: stamp }, null);
    if (compact) setPhoneScreen('write');
  }
  async function stampDraft() {
    if (draft === null) return;
    const stamp = await dayStamp();
    if (stamp === '') { setStatus(t('journal.stampUnavailable')); return; }
    change({ ...draft, body: stamp + draft.body }); setEditorKey(value => value + 1);
  }

  async function importFiles(files: FileList | null) {
    if (files === null || files.length === 0) return;
    const chosen = [...files].slice(0, JOURNAL_IMPORT_LIMITS.files);
    setBusy(true); setMessage(null); setStatus(t('journal.importing'));
    const failed: string[] = []; let imported = 0;
    for (const file of chosen) {
      try {
        if (file.size > JOURNAL_IMPORT_LIMITS.bytes) throw new Error('too large');
        const content = parseJournalMarkdown(await file.text(), file.name);
        await api.saveJournal(workspaceId, undefined, content, 0, false);
        imported++;
      } catch { failed.push(file.name); }
    }
    if (importInput.current) importInput.current.value = '';
    setBusy(false);
    setStatus(t('journal.imported', { count: imported }));
    if (failed.length > 0 || files.length > chosen.length) setMessage(t('journal.importFailed', { names: [...failed, ...[...files].slice(chosen.length).map(file => file.name)].join(', ') }));
    setOffset(0); await refresh();
  }

  const updateFilters = (changeSet: Partial<JournalFilters>) => { setFiltersState(previous => ({ ...previous, ...changeSet })); setOffset(0); };
  const changeLayout = (next: JournalLayout) => { setLayout(next); writeSetting(layoutKey, next); setOffset(0); };
  const toggleAutosave = (value: boolean) => { setAutosave(value); writeSetting('vmn.journal.autosave', value ? 'on' : 'off'); };

  if (loadingEntry && consent === true) return <p role="status">{t('journal.loading')}</p>;
  if (consent !== true) return <section className="nb stack" aria-labelledby={panelId + 'notice'}>
    <div className="nb-panel">
      <p className="nb-eyebrow"><UiIcon name="lock" />{t('journal.eyebrowPrivate')}</p>
      <h2 id={panelId + 'notice'} className="nb-page-title">{t('journal.noticeTitle')}</h2>
      {message && <p role="alert">{message}</p>}
      {consent === null ? <p>{t('journal.loading')}</p> : <><p>{t('journal.noticeOwnership')}</p><p>{t('journal.noticeAdmin')}</p>
        <div><button type="button" className="primary" disabled={busy} onClick={() => { setBusy(true); void api.acknowledgeJournal().then(() => setConsent(true), error => setMessage(messageFor(error))).finally(() => setBusy(false)); }}>{t('journal.agree')}</button></div></>}
    </div>
  </section>;

  const notice = <>
    {message && <p role="alert">{message}</p>}
    {recovery && <div className="nb-panel nb-recovery" role="group" aria-label={t('journal.recoveryTitle')}>
      <p className="nb-panel-title">{t('journal.recoveryTitle')}</p>
      <div className="row wrap"><button type="button" className="primary" disabled={busy} onClick={() => void recover()}>{t('journal.recover')}</button><button type="button" disabled={busy} onClick={discardRecovery}>{t('journal.discardDraft')}</button></div>
    </div>}
  </>;
  const importer = <input ref={importInput} type="file" hidden multiple accept=".md,.markdown,.txt,text/markdown,text/plain" aria-label={t('journal.import')} onChange={event => void importFiles(event.target.files)} />;

  // ---- Reading ------------------------------------------------------------------------------
  if (mode === 'read' && entry !== null) return <section className="nb journal" data-editing="false" aria-label={entry.title}>
    {notice}
    <JournalReader workspaceId={workspaceId} entry={entry} canWrite={canWrite} compact={compact} busy={busy}
      onBack={toList} onHome={goHome} onMessage={setMessage}
      onEdit={() => startEditing(contentOf(entry), entry)}
      onRestore={content => { startEditing(contentOf(entry), entry); setDraft(content); }}
      onSave={change => void quickSave(change)} />
    {status && <p className="visually-hidden" role="status">{status}</p>}
  </section>;

  // ---- Library / timeline -------------------------------------------------------------------
  if (!isEditing || draft === null) return <section className="nb journal" data-editing="false" aria-label={t(personal ? 'journal.privateHeading' : 'journal.heading')}>
    {importer}
    <p className="journal-status" role="status">{status}</p>
    <JournalHome workspaceId={workspaceId} canWrite={canWrite && recovery === null} busy={busy} entries={entries} overview={overview} more={more} offset={offset}
      layout={layout} filters={filters} notice={notice}
      onLayout={changeLayout} onFilters={updateFilters} onPage={setOffset} onOpen={id => void open(id)}
      onNew={() => startEditing(fresh(), null)} onToday={() => void todayPage()} onImport={() => importInput.current?.click()} />
  </section>;

  // ---- Editing ------------------------------------------------------------------------------
  const notebooks = (overview?.collections ?? []).map(item => item.name).filter(name => name !== '');
  const fileTools = draft.version === 2 ? <>
    {workspaceId && <WorkspaceReferences workspaceId={workspaceId} onInsert={text => { change({ ...draft, body: draft.body + '\n\n' + text }); setEditorKey(value => value + 1); }} />}
    <JournalImages initiallyOpen={!compact} refreshVersion={imageVersion} workspaceId={workspaceId} onError={setMessage} onInsert={text => { change({ ...draft, body: draft.body + text }); setEditorKey(value => value + 1); }} />
  </> : null;
  const details = <div className="nb-details">
    <label>{t('journal.optionalDate')}<input type="date" value={draft.date ?? ''} required={draft.version === 1} onChange={event => change({ ...draft, date: event.target.value || null })} /></label>
    <div className="nb-details-group">
      <label>{t('journal.collection')}<input list={panelId + 'collections'} value={draft.collection ?? ''} maxLength={80} onChange={event => change({ ...draft, collection: event.target.value })} /></label>
      {notebooks.length > 0 && <div className="nb-chips" role="group" aria-label={t('journal.pickNotebook')}>
        {notebooks.slice(0, 8).map(name => <button key={name} type="button" className="nb-chip" style={{ '--nb-tone': notebookTone(name) } as CSSProperties} aria-pressed={draft.collection === name} onClick={() => change({ ...draft, collection: draft.collection === name ? '' : name })}><span className="nb-swatch" aria-hidden="true" />{name}</button>)}
      </div>}
      <datalist id={panelId + 'collections'}>{notebooks.map(name => <option key={name} value={name} />)}</datalist>
    </div>
    <TagInput tags={draft.tags ?? []} suggestions={(overview?.tags ?? []).map(item => item.name)} onChange={tags => change({ ...draft, tags })} />
    <label className="nb-switch"><input type="checkbox" checked={draft.pinned ?? false} onChange={event => change({ ...draft, pinned: event.target.checked })} />{t('journal.pinned')}</label>
    <label className="nb-switch"><input type="checkbox" checked={autosave} onChange={event => toggleAutosave(event.target.checked)} />{t('journal.autosave')}</label>
    {personal && draft.version === 2 && <button type="button" className="nb-stamp-button" onClick={() => void stampDraft()}><UiIcon name="weatherPartlyCloudy" />{t('journal.stamp')}</button>}
    {entry && <button type="button" onClick={() => void save(!entry.archived)}><UiIcon name="archive" />{t(entry.archived ? 'journal.restore' : 'journal.archive')}</button>}
  </div>;

  const editor = draft.version === 1
    ? <><p>{t('journal.legacy')}</p><label>{t('journal.body')}<textarea value={draft.body} maxLength={50000} onChange={event => change({ ...draft, body: event.target.value })} /></label><button type="button" onClick={() => { change({ ...draft, version: 2, body: draft.body.replace(/([\\`*_{}[\]<>()#+.!|~-])/g, '\\$1') }); setEditorKey(value => value + 1); }}>{t('journal.convert')}</button></>
    : <MarkdownEditor visualOnly={compact} sourceMode={sourceMode} onSourceModeChange={setSourceMode} key={editorKey} resolveImage={resolveImage} upload={uploadFile} value={draft.body} onChange={body => change({ ...draft, body })} />;

  function advance() {
    if (busy || recovery !== null) return;
    if (activeScreen === 'title') { if (!titleInput.current?.reportValidity()) return; setEditorStarted(true); setPhoneScreen('write'); }
    else setPhoneScreen('details');
    window.scrollTo({ top: 0 });
  }

  return <section className="nb journal" data-editing="true" data-staged={compact} aria-label={t('journal.editing')}>
    <h1 className="visually-hidden">{t('journal.editing')}</h1>
    {compact ? null : <div className="nb-edit-bar">
      <button type="button" className="nb-round" aria-label={t('journal.cancelEditing')} title={t('journal.cancelEditing')} disabled={busy} onClick={closeEditor}><UiIcon name="close" /></button>
      <p className="nb-eyebrow">{t(personal ? 'journal.editingPrivate' : 'journal.editingShared')}</p>
      <p className="journal-status" role="status">{status || (dirty ? t('journal.unsavedStatus') : '')}</p>
      <div className="nb-head-actions">
        <button type="button" className="nb-round" aria-label={t('journal.home')} title={t('journal.home')} disabled={busy} onClick={goHome}><UiIcon name="today" /></button>
        <button type="submit" form={formId} className="primary" disabled={busy || recovery !== null}><UiIcon name="save" />{t('journal.save')}</button>
      </div>
    </div>}
    {compact && <p className="journal-status" role="status">{status || (dirty ? t('journal.unsavedStatus') : '')}</p>}
    {notice}
    <form id={formId} className="journal-editor" onInvalidCapture={event => { const target = event.target as HTMLElement; const panel = target.closest<HTMLElement>('[data-editor-screen]'); const next = panel?.dataset.editorScreen as PhoneScreen | undefined; if (compact && next && next !== activeScreen) { event.preventDefault(); setPhoneScreen(next); window.requestAnimationFrame(() => target.focus()); } }}
      onSubmit={event => { event.preventDefault(); if (compact && activeScreen !== 'details') { advance(); return; } void save(); }}>
      <fieldset disabled={busy || recovery !== null}>
        {compact ? <>
          <p className="journal-phone-step" aria-live="polite">{t('journal.stepOf', { step: activeScreen === 'title' ? 1 : activeScreen === 'write' ? 2 : 3 })}</p>
          <section className="stack journal-screen journal-title-screen" data-editor-screen="title" aria-label={t('journal.titleScreen')} hidden={activeScreen !== 'title'}>
            <h2>{t('journal.phoneTitle')}</h2>
            <label><span className="visually-hidden">{t('journal.title')}</span><input placeholder={t('journal.titlePlaceholder')} ref={titleInput} name="entryTitle" value={draft.title} required maxLength={160} enterKeyHint="next" onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); advance(); } }} onChange={event => change({ ...draft, title: event.target.value })} /></label>
          </section>
          <section className="stack journal-screen nb-editor" data-editor-screen="write" aria-label={t('journal.writeScreen')} hidden={activeScreen !== 'write'}>
            <h2 className="nb-page-title">{draft.title || t('journal.phoneWrite')}</h2>
            {(editorStarted || activeScreen === 'write') && editor}
          </section>
          <section className="stack journal-screen journal-details" data-editor-screen="details" aria-label={t('journal.detailsScreen')} hidden={activeScreen !== 'details'}>
            <h2>{t('journal.phoneDetails')}</h2>
            {details}
            {fileTools && <details className="journal-phone-files"><summary>{t('journal.filesScreen')}</summary><div className="stack">{fileTools}</div></details>}
          </section>
        </> : <div className="nb-layout nb-editor">
          <div className="nb-page"><div className="nb-editor-sheet" data-editor-screen="write">
            <label><span className="visually-hidden">{t('journal.title')}</span><input ref={titleInput} className="nb-title-input" name="entryTitle" placeholder={t('journal.titlePlaceholder')} value={draft.title} required maxLength={160} onChange={event => change({ ...draft, title: event.target.value })} /></label>
            {editor}
          </div></div>
          <aside className="nb-aside" aria-label={t('journal.details')}>
            <section className="nb-panel" data-editor-screen="write"><h2 className="nb-panel-title">{t('journal.details')}</h2>{details}</section>
            {fileTools && <section className="nb-panel"><h2 className="nb-panel-title">{t('journal.filesScreen')}</h2>{fileTools}</section>}
          </aside>
        </div>}
      </fieldset>
    </form>
    {compact && <MobileActionBar label={t('journal.phoneActions')}
      actions={[
        { id: 'home', label: t('journal.home'), icon: 'today', disabled: busy, onClick: goHome },
        { id: 'back', label: t(activeScreen === 'title' ? 'journal.cancel' : 'journal.backShort'), icon: 'back', disabled: busy, onClick: () => { if (activeScreen === 'title') closeEditor(); else setPhoneScreen(activeScreen === 'details' ? 'write' : 'title'); } },
        { id: 'cancel', label: t('journal.cancelEditing'), icon: 'close', disabled: busy, onClick: closeEditor },
      ]}
      primary={activeScreen === 'details' ? { id: 'save', label: t('journal.save'), icon: 'save', type: 'submit', form: formId, disabled: busy || recovery !== null } : { id: 'next', label: t('journal.next'), icon: 'forward', disabled: busy || recovery !== null, onClick: advance }}
    />}
  </section>;
}

/** Weather (only when the person set up their own) and the moon phase, as one Markdown line. */
async function dayStamp(): Promise<string> {
  const moon = t(`moon.phase.${moonAt(new Date(), null).phase}`);
  try {
    const result = await api.myForecast(1);
    if (result.forecast === null) return weatherStamp([moon]);
    const now = result.forecast.current;
    const condition = now?.condition ?? result.forecast.days[0]?.condition;
    return weatherStamp([condition ? t(`weather.condition.${condition}`) : null, temperature(now?.temperature ?? result.forecast.days[0]?.max, result.unit), result.location.name, moon]);
  } catch { return weatherStamp([moon]); }
}

/** Tags as chips: Enter, comma or leaving the field adds one; each chip removes itself. */
function TagInput({ tags, suggestions, onChange }: { tags: readonly string[]; suggestions: readonly string[]; onChange: (tags: string[]) => void }) {
  const id = useId();
  const [text, setText] = useState('');
  const add = (value: string) => {
    const next = value.split(',').map(tag => tag.trim().replace(/^#/, '')).filter(tag => tag !== '' && [...tag].length <= 32);
    if (next.length > 0) onChange([...new Set([...tags, ...next])].slice(0, 10));
    setText('');
  };
  return <div className="nb-details-group">
    <label htmlFor={id} className="nb-field-label">{t('journal.tags')}</label>
    <div className="nb-tag-input">
      {tags.map(tag => <button key={tag} type="button" className="nb-chip" aria-label={t('journal.removeTag', { tag })} title={t('journal.removeTag', { tag })} onClick={() => onChange(tags.filter(item => item !== tag))}>#{tag}<UiIcon name="close" size="1em" /></button>)}
      {tags.length < 10 && <input id={id} list={id + 'list'} value={text} maxLength={340} placeholder={t('journal.addTag')} enterKeyHint="done"
        onChange={event => { if (event.target.value.includes(',')) add(event.target.value); else setText(event.target.value); }}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(text); } else if (event.key === 'Backspace' && text === '' && tags.length > 0) onChange(tags.slice(0, -1)); }}
        onBlur={() => add(text)} />}
      <datalist id={id + 'list'}>{suggestions.filter(item => !tags.includes(item)).slice(0, 30).map(item => <option key={item} value={item} />)}</datalist>
    </div>
  </div>;
}
