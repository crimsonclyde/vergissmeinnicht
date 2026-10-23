import { useCallback, useEffect, useId, useState } from 'react';
import type { JournalContent } from '@vergissmeinnicht/domain';
import { api, messageFor, type JournalView } from '../../api.ts';
import { formatCalendarDate, formatDateTime, t } from '../../i18n/index.ts';
import { browserTimeZone, todayIn } from '../../schedule-dates.ts';
import { Link, paths, setNavigationGuard } from '../../router.tsx';
import { ENTRY_RENDERERS } from './entry-types.tsx';

const contentOf = (entry: JournalView): JournalContent => ({ kind: entry.kind, version: entry.version, title: entry.title, date: entry.date, body: entry.body });
export function JournalPage({ workspaceId, canWrite }: { workspaceId?: string; canWrite: boolean }) {
  const heading = useId();
  const [entries, setEntries] = useState<JournalView[] | null>(null);
  const [entry, setEntry] = useState<JournalView | null>(null);
  const [draft, setDraft] = useState<JournalContent | null>(null);
  const [original, setOriginal] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [archived, setArchived] = useState(false);
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = draft !== null && JSON.stringify(draft) !== original;
  const leave = useCallback(() => !dirty || window.confirm(t('journal.unsaved')), [dirty]);
  useEffect(() => {
    setNavigationGuard(leave);
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => { setNavigationGuard(null); window.removeEventListener('beforeunload', warn); };
  }, [leave, dirty]);
  useEffect(() => {
    let active = true;
    api.journal(workspaceId, query, archived, offset).then((result) => { if (active) { setEntries(result.entries); setMore(result.more); } }, (caught: unknown) => { if (active) setMessage(messageFor(caught)); });
    return () => { active = false; };
  }, [workspaceId, query, archived, offset]);
  async function open(id: string) {
    if (!leave()) return;
    setBusy(true); setMessage(null); setSaved(false);
    try { const result = await api.journalEntry(workspaceId, id); setEntry(result); const content = contentOf(result); setDraft(content); setOriginal(JSON.stringify(content)); }
    catch (caught) { setMessage(messageFor(caught)); }
    finally { setBusy(false); }
  }
  async function save(archive = entry?.archived ?? false) {
    if (draft === null) return;
    setBusy(true); setMessage(null); setSaved(false);
    try {
      const result = await api.saveJournal(workspaceId, entry?.id, draft, entry?.revision ?? 0, archive);
      setEntry(result); setDraft(contentOf(result)); setOriginal(JSON.stringify(contentOf(result))); setSaved(true);
      const list = await api.journal(workspaceId, query, archived, offset); setEntries(list.entries); setMore(list.more);
    } catch (caught) { setMessage(messageFor(caught)); }
    finally { setBusy(false); }
  }
  return <section className="stack journal" aria-labelledby={heading}>
    <div className="page-header"><h2 id={heading}>{t(workspaceId === undefined ? 'journal.privateHeading' : 'journal.heading')}</h2></div>
    <p className="muted">{t(workspaceId === undefined ? 'journal.privateHint' : 'journal.sharedHint')}</p>
    {workspaceId !== undefined && <Link href={paths.account('journal')}>{t('journal.privateLink')}</Link>}
    {message !== null && <p role="alert">{message}</p>}
    <p role="status">{saved ? t('journal.saved') : ''}</p>
    {draft !== null ? <div className="card stack journal-editor">
      <button type="button" className="quiet" disabled={busy} onClick={() => { if (leave()) { setDraft(null); setEntry(null); setSaved(false); } }}>{t('journal.cancel')}</button>
      {canWrite ? <form className="stack" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <fieldset className="stack" disabled={busy}>
          <label>{t('journal.title')}<input value={draft.title} maxLength={160} required onChange={(event) => { setDraft({ ...draft, title: event.target.value }); setSaved(false); }} /></label>
          <label>{t('journal.date')}<input type="date" value={draft.date} required onChange={(event) => { setDraft({ ...draft, date: event.target.value }); setSaved(false); }} /></label>
          {(() => { const Fields = ENTRY_RENDERERS[draft.kind]; return <Fields value={draft} onChange={(next) => { setDraft(next); setSaved(false); }} />; })()}
          <div className="row wrap"><button type="submit" className="primary">{t('journal.save')}</button>{entry !== null && <button type="button" onClick={() => void save(!entry.archived)}>{t(entry.archived ? 'journal.restore' : 'journal.archive')}</button>}</div>
        </fieldset>
      </form> : <><h3>{draft.title}</h3><time dateTime={draft.date}>{formatCalendarDate(draft.date)}</time><p className="journal-note">{draft.body}</p></>}
      {entry !== null && <small className="muted">{t('journal.attribution', { name: entry.updatedBy, date: formatDateTime(entry.updatedAt) })}</small>}
    </div> : <>
      {canWrite && <button type="button" className="primary" onClick={() => { const content: JournalContent = { kind: 'note', version: 1, title: '', date: todayIn(browserTimeZone()), body: '' }; setEntry(null); setDraft(content); setOriginal(JSON.stringify(content)); setMessage(null); setSaved(false); }}>{t('journal.new')}</button>}
      <form className="row wrap" onSubmit={(event) => { event.preventDefault(); setQuery(search); setOffset(0); }}><label>{t('journal.search')}<input value={search} maxLength={120} onChange={(event) => setSearch(event.target.value)} /></label><button type="submit">{t('journal.searchButton')}</button></form>
      <label className="row"><input type="checkbox" checked={archived} onChange={(event) => { setArchived(event.target.checked); setOffset(0); }} />{t('journal.archived')}</label>
      {entries === null ? <p>{message === null ? t('journal.loading') : ''}</p> : entries.length === 0 ? <p className="muted">{t('journal.empty')}</p> : <ul className="plain-list stack">{entries.map((item) => <li key={item.id}><button type="button" className="card link-card" disabled={busy} onClick={() => void open(item.id)}><span className="item-body"><strong>{item.title}</strong><small>{formatCalendarDate(item.date)}</small></span></button></li>)}</ul>}
      <div className="row wrap">{offset > 0 && <button type="button" onClick={() => setOffset(Math.max(0, offset - 30))}>{t('journal.previous')}</button>}{more && <button type="button" onClick={() => setOffset(offset + 30)}>{t('journal.more')}</button>}</div>
    </>}
  </section>;
}
