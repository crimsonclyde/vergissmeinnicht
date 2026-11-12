import { useState, type CSSProperties } from 'react';
import { journalMarkdown, markdownOutline, type JournalContent, type JournalRevision } from '@vergissmeinnicht/domain';
import { api, attachmentUrl, messageFor, type JournalView } from '../../api.ts';
import { formatCalendarDate, formatDateTime, formatMonthParts, formatRelative, formatWeekdayLong, t } from '../../i18n/index.ts';
import { Markdown } from '../../markdown/Markdown.tsx';
import { MobileActionBar } from '../../mobile/MobileActionBar.tsx';
import { MoreMenu } from '../../MoreMenu.tsx';
import { UiIcon } from '../../ui-icons.tsx';
import { notebookTone, summaryOf } from './journal-view.ts';

const ATTACHMENT = /^attachments\/([0-9a-f-]{36})\.(?:jpg|png)$/;

/** A note as a page to read (40 A). Editing is one tap away; nothing here changes the Markdown source. */
export function JournalReader(props: {
  workspaceId: string | undefined;
  entry: JournalView;
  canWrite: boolean;
  compact: boolean;
  busy: boolean;
  onBack: () => void;
  onHome: () => void;
  onEdit: () => void;
  onRestore: (content: JournalContent) => void;
  onSave: (change: { pinned?: boolean; archived?: boolean }) => void;
  onMessage: (text: string) => void;
}) {
  const { entry, workspaceId } = props;
  const [history, setHistory] = useState<JournalRevision[] | null>(null);
  const [historyMore, setHistoryMore] = useState(false);
  const [copied, setCopied] = useState(false);
  const summary = summaryOf(entry);
  const outline = entry.version === 2 ? markdownOutline(entry.body) : [];
  const resolveImage = (path: string) => { const match = ATTACHMENT.exec(path); return match ? attachmentUrl(workspaceId, match[1] ?? '') : undefined; };
  const base = `/api${workspaceId ? '/workspaces/' + encodeURIComponent(workspaceId) + '/journal' : '/account/journal'}`;
  const content: JournalContent = { kind: entry.kind, version: entry.version, title: entry.title, date: entry.date, body: entry.body, collection: entry.collection ?? '', tags: entry.tags ?? [], pinned: entry.pinned ?? false };

  function loadHistory(before?: number) {
    void api.journalHistory(workspaceId, entry.id, before).then(result => {
      setHistory(previous => before === undefined ? result.revisions : [...(previous ?? []), ...result.revisions]);
      setHistoryMore(result.revisions.length === 30);
    }, error => props.onMessage(messageFor(error)));
  }
  function download() { const link = document.createElement('a'); link.href = `${base}/${entry.id}/export`; link.download = ''; document.body.append(link); link.click(); link.remove(); }
  function copy() {
    void navigator.clipboard?.writeText(journalMarkdown(content)).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2500); }, () => props.onMessage(t('journal.copyFailed')));
  }
  const toggleHistory = () => { if (history === null) loadHistory(); else setHistory(null); };
  const pinLabel = t(entry.pinned ? 'journal.unpin' : 'journal.pin');

  const more = <MoreMenu label={t('journal.moreActions')} items={[
    { label: t('journal.export'), onSelect: download },
    { label: t('journal.copyMarkdown'), onSelect: copy },
    ...(props.canWrite ? [{ label: t(entry.archived ? 'journal.restore' : 'journal.archive'), onSelect: () => props.onSave({ archived: !entry.archived }) }] : []),
  ]} />;

  return <>
    <div className="nb-reader-bar">
      {!props.compact && <button type="button" className="nb-round" aria-label={t('journal.cancel')} title={t('journal.cancel')} disabled={props.busy} onClick={props.onBack}><UiIcon name="previous" /></button>}
      <p className="nb-eyebrow">{workspaceId === undefined ? <><UiIcon name="lock" />{t('journal.eyebrowPrivate')}</> : t('journal.eyebrowShared')}{entry.archived && <> · {t('journal.archivedLabel')}</>}</p>
      <div className="nb-head-actions">
        {!props.compact && props.canWrite && <button type="button" className="nb-round" aria-pressed={entry.pinned ?? false} aria-label={pinLabel} title={pinLabel} disabled={props.busy} onClick={() => props.onSave({ pinned: !entry.pinned })}><UiIcon name={entry.pinned ? 'pinned' : 'pin'} /></button>}
        {!props.compact && <button type="button" className="nb-round" aria-expanded={history !== null} aria-label={t('journal.history')} title={t('journal.history')} onClick={toggleHistory}><UiIcon name="history" /></button>}
        {more}
        {!props.compact && props.canWrite && <button type="button" className="primary" disabled={props.busy} onClick={props.onEdit}><UiIcon name="edit" />{t('journal.edit')}</button>}
      </div>
    </div>
    <p className="journal-status" role="status">{copied ? t('journal.copied') : ''}</p>
    <div className="nb-layout">
      <article className="nb-page" aria-labelledby="nb-page-title">
        <div className="nb-page-body">
          {((entry.collection ?? '') !== '' || (entry.tags ?? []).length > 0) && <div className="nb-labels">
            {(entry.collection ?? '') !== '' && <span className="nb-label" style={{ '--nb-tone': notebookTone(entry.collection ?? '') } as CSSProperties}><span className="nb-swatch" aria-hidden="true" />{entry.collection}</span>}
            {(entry.tags ?? []).map(tag => <span key={tag} className="nb-label">#{tag}</span>)}
          </div>}
          <h1 id="nb-page-title" className="nb-page-title">{entry.title}</h1>
          <p className="nb-page-meta">
            {entry.date && <time dateTime={entry.date}><UiIcon name="calendar" /> {formatCalendarDate(entry.date)}</time>}
            <span title={formatDateTime(entry.updatedAt)}>{t('journal.editedBy', { name: entry.updatedBy, when: formatRelative(entry.updatedAt) })}</span>
          </p>
          <hr className="nb-rule" />
          <div className="nb-prose">
            {entry.version === 1 ? <p className="journal-note">{entry.body}</p> : <Markdown source={entry.body} resolveImage={resolveImage} resolveOriginal={path => resolveImage(path)?.replace(/\/preview$/, '/original')} />}
          </div>
        </div>
      </article>
      <aside className="nb-aside" aria-label={t('journal.aboutEntry')}>
        {(entry.date !== null || summary.tasks.total > 0) && <section className="nb-panel">
          {entry.date !== null && <div className="nb-day"><span className="nb-day-big" aria-hidden="true">{Number(entry.date.slice(8))}</span><span className="nb-day-words"><strong>{formatWeekdayLong(entry.date)}</strong><small>{(() => { const parts = formatMonthParts(entry.date.slice(0, 7)); return `${parts.month} ${parts.year}`; })()}</small></span></div>}
          {summary.tasks.total > 0 && <>
            <h2 className="nb-panel-title">{t('journal.checklist')}</h2>
            <div className="nb-progress" aria-hidden="true"><span style={{ width: `${Math.round(100 * summary.tasks.done / summary.tasks.total)}%` }} /></div>
            <span className="nb-tasks" data-complete={summary.tasks.done === summary.tasks.total}><UiIcon name="checklist" />{t('journal.tasks', { done: summary.tasks.done, total: summary.tasks.total })}</span>
          </>}
        </section>}
        {outline.length > 1 && <nav className="nb-panel" aria-labelledby="nb-outline-title">
          <h2 id="nb-outline-title" className="nb-panel-title">{t('journal.outline')}</h2>
          <ol className="nb-outline">{outline.map(item => <li key={item.anchor}><a href={'#' + item.anchor}>{item.text}</a></li>)}</ol>
        </nav>}
        {history !== null && <section className="nb-panel" aria-labelledby="nb-history-title">
          <h2 id="nb-history-title" className="nb-panel-title">{t('journal.history')}</h2>
          {history.length === 0 ? <p className="muted">{t('journal.noHistory')}</p> : <ol className="nb-history">{history.map(revision => <li key={revision.revision}><details>
            <summary><span>v{revision.revision} · {revision.by}</span><small className="muted">{formatDateTime(revision.at)}</small></summary>
            <pre className="journal-note">{revision.content.body}</pre>
            {props.canWrite && <button type="button" onClick={() => props.onRestore(revision.content)}>{t('journal.useRevision')}</button>}
          </details></li>)}</ol>}
          {historyMore && <button type="button" onClick={() => loadHistory(history.at(-1)?.revision)}>{t('journal.more')}</button>}
        </section>}
      </aside>
    </div>
    {props.compact && <MobileActionBar label={t('journal.readActions')}
      actions={[
        { id: 'home', label: t('journal.home'), icon: 'today', disabled: props.busy, onClick: props.onHome },
        { id: 'back', label: t('journal.cancel'), icon: 'back', disabled: props.busy, onClick: props.onBack },
        ...(props.canWrite ? [{ id: 'pin', label: pinLabel, icon: entry.pinned ? 'pinned' as const : 'pin' as const, disabled: props.busy, onClick: () => props.onSave({ pinned: !entry.pinned }) }] : []),
        { id: 'history', label: t('journal.history'), icon: 'history', onClick: toggleHistory },
      ]}
      {...(props.canWrite ? { primary: { id: 'edit', label: t('journal.edit'), icon: 'edit' as const, disabled: props.busy, onClick: props.onEdit } } : {})}
    />}
  </>;
}
