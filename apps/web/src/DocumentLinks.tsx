import { useCallback, useEffect, useId, useState } from 'react';
import { api, documentFileUrls, messageFor, type DocumentLink, type DocumentSummary, type LinkedRecord, type PersonRef, type ProcedureCard, type RunDocument, type RunDocumentRemoval, type RunLink, type RunState, type Schedule } from './api.ts';
import { ContactPicker } from './ContactPicker.tsx';
import { useContactsTool } from './contacts-tool.ts';
import { useDocumentsTool } from './documents-tool.ts';
import { linkedKind, linkedRecordText, runDocumentNote, typeLabel } from './document-model.ts';
import { FormDialog } from './FormDialog.tsx';
import { formatCalendarDate, formatDateTime, t } from './i18n/index.ts';
import { Link, paths } from './router.tsx';
import { ScheduleDialog } from './ScheduleDialog.tsx';
import { UiIcon } from './ui-icons.tsx';

/** Where a linked record can be opened, if it still can. Reminders have no page of their own: they are on the Reminders page. */
function hrefOf(workspaceId: string, record: LinkedRecord): string {
  if (record.type === 'document') return paths.document(workspaceId, record.id);
  if (record.type === 'procedure') return paths.procedure(workspaceId, record.id);
  if (record.type === 'contact') return paths.contact(workspaceId, record.id);
  if (record.type === 'maintenance') return paths.maintenanceRecord(workspaceId, record.id);
  if (record.type === 'run') return paths.run(workspaceId, record.id);
  return paths.reminders(workspaceId);
}

/** One Link as a line: what kind of record, its title (a link while it can be opened) and where it stands. */
function LinkLine(props: { workspaceId: string; link: DocumentLink; onRemove?: (() => void) | undefined }) {
  const { record } = props.link;
  const text = linkedRecordText(record);
  return (
    <li className="link-line">
      <span className="item-body">
        <span>
          <small className="muted">{linkedKind(record)}: </small>
          {text.open ? <Link href={hrefOf(props.workspaceId, record)}>{text.title}</Link> : <span>{text.title}</span>}
        </span>
        {text.note !== null && <small className="muted">{text.note}</small>}
      </span>
      {props.onRemove !== undefined && (
        <button type="button" className="quiet" aria-label={t('links.removeNamed', { name: text.title })} onClick={props.onRemove}>
          {t('links.remove')}
        </button>
      )}
    </li>
  );
}

/**
 * The Documents linked to a Procedure or a Schedule (16.5), folded away and only there when the
 * Documents tool is on and something is linked. A reference each: opening one goes to the Document,
 * which is authorised by itself.
 */
export function LinkedDocuments(props: { workspaceId: string; target: { type: 'procedure' | 'schedule'; id: string } }) {
  const tool = useDocumentsTool();
  const { workspaceId } = props;
  const { type, id } = props.target;
  const [links, setLinks] = useState<readonly DocumentLink[]>([]);
  useEffect(() => {
    if (!tool.enabled) return;
    let current = true;
    // A failure here is not worth a message: the page works without this list.
    api.linkedDocuments(workspaceId, { type, id }).then(
      (loaded) => current && setLinks(loaded),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [tool.enabled, workspaceId, type, id]);
  if (!tool.enabled || links.length === 0) return null;
  return (
    <details className="more-actions linked-documents">
      <summary>{t('links.documents', { count: links.length })}</summary>
      <ul className="plain-list">
        {links.map((link) => (
          <LinkLine key={link.id} workspaceId={workspaceId} link={link} />
        ))}
      </ul>
    </details>
  );
}

/** Finds one Document by searching titles, notes and tags — the search the Documents page uses. */
export function DocumentPicker(props: { workspaceId: string; exclude: readonly string[]; value: string; onChange: (id: string) => void }) {
  const id = useId();
  const [text, setText] = useState('');
  const [found, setFound] = useState<readonly DocumentSummary[] | null>(null);
  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(text.trim() === '' ? {} : { q: text.trim() });
      api.documents(props.workspaceId, params.toString()).then(
        (page) => current && setFound(page.documents),
        () => current && setFound([]),
      );
    }, 250);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [props.workspaceId, text]);
  const options = (found ?? []).filter((each) => !props.exclude.includes(each.id));
  return (
    <>
      <div className="field">
        <label htmlFor={`${id}-q`}>{t('links.pick.search')}</label>
        <input id={`${id}-q`} type="search" maxLength={100} value={text} onChange={(event) => setText(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-doc`}>{t('links.pick.document')}</label>
        <select id={`${id}-doc`} required value={props.value} onChange={(event) => props.onChange(event.target.value)}>
          <option value="">{found === null ? t('common.loading') : options.length === 0 ? t('links.pick.none') : t('links.pick.choose')}</option>
          {options.map((each) => (
            <option key={each.id} value={each.id}>
              {each.title}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

/**
 * The Document versions an execution keeps (16.5): for each, what the Document was when it was
 * linked — title, details and files of then — and a note when the Document has changed or is gone
 * since. Folded away below the Steps (open on a finished execution that keeps something); nothing
 * about the execution itself changes.
 */
export function RunDocuments(props: { workspaceId: string; runId: string; runState: RunState }) {
  const tool = useDocumentsTool();
  const { workspaceId, runId } = props;
  const [documents, setDocuments] = useState<readonly RunDocument[] | null>(null);
  const [removals, setRemovals] = useState<readonly RunDocumentRemoval[]>([]);
  const [removing, setRemoving] = useState<RunDocument | null>(null);
  const [reason, setReason] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [choice, setChoice] = useState('');
  const load = useCallback(() => {
    api.runDocuments(workspaceId, runId).then(
      (loaded) => {
        setDocuments(loaded.documents);
        setRemovals(loaded.removals);
      },
      () => setDocuments([]),
    );
  }, [workspaceId, runId]);
  useEffect(() => {
    if (tool.enabled) load();
  }, [tool.enabled, load]);
  if (!tool.enabled || documents === null) return null;
  if (documents.length === 0 && removals.length === 0 && !tool.canManage) return null;
  return (
    <details className="more-actions run-documents" open={(documents.length > 0 || removals.length > 0) && props.runState !== 'ACTIVE'}>
      <summary>{t('links.run.heading', { count: documents.length })}</summary>
      <div className="stack">
      {message !== null && <p role="alert">{message}</p>}
      <p role="status" className="visually-hidden">
        {status ?? ''}
      </p>
      {documents.length === 0 && removals.length === 0 && <p className="muted">{t('links.run.none')}</p>}
      <ul className="plain-list">
        {documents.map((document) => {
          const note = runDocumentNote(document.source);
          const type = document.type === null ? null : document.type.kind === 'custom' ? document.type.name : typeLabel({ kind: 'builtin', key: document.type.key });
          return (
            <li key={document.id} className="card stack">
              <div>
                <strong>{document.title}</strong>
                <br />
                <small className="muted">
                  {[type, document.documentDate === null ? null : t('documents.documentDateOn', { date: formatCalendarDate(document.documentDate) }), document.tags.join(', ')].filter((part) => part !== null && part !== '').join(' · ')}
                </small>
              </div>
              <p className="muted" style={{ margin: 0 }}>
                {t('links.run.version', { when: formatDateTime(document.linkedAt), name: document.linkedBy })}
              </p>
              {note !== null && (
                <p role="note" style={{ margin: 0 }}>
                  {note}{' '}
                  {document.source === 'changed' && <Link href={paths.document(workspaceId, document.sourceDocumentId)}>{t('links.run.openCurrent')}</Link>}
                </p>
              )}
              {note === null && (
                <p style={{ margin: 0 }}>
                  <Link href={paths.document(workspaceId, document.sourceDocumentId)}>{t('links.run.openDocument')}</Link>
                </p>
              )}
              {document.notes !== '' && <p className="document-notes">{document.notes}</p>}
              <ul className="plain-list run-document-files">
                {document.files.map((file, index) => (
                  <li key={file.id} className="row">
                    {file.preview.pages > 0 && <img className="run-document-thumb" src={documentFileUrls.thumbnail(workspaceId, file.id)} alt="" loading="lazy" decoding="async" />}
                    <a className="button" href={documentFileUrls.original(workspaceId, file.id)} download aria-label={t('documents.downloadNamed', { name: file.name })}>
                      <UiIcon name="download" /> {t('links.run.page', { n: index + 1, name: file.name })}
                    </a>
                  </li>
                ))}
              </ul>
              {tool.canRemoveKept && props.runState !== 'ACTIVE' && (
                <div>
                  <button type="button" className="quiet danger-text" aria-label={t('links.run.removeKeptNamed', { name: document.title })} onClick={() => (setReason(''), setUnderstood(false), setRemoving(document))}>
                    {t('links.run.removeKept')}
                  </button>
                </div>
              )}
              {tool.canManage && props.runState === 'ACTIVE' && (
                <div>
                  <button
                    type="button"
                    className="quiet danger-text"
                    aria-label={t('links.removeNamed', { name: document.title })}
                    onClick={() =>
                      void api.unlinkRunDocument(workspaceId, runId, document.id).then(
                        () => {
                          setStatus(t('links.run.removed', { title: document.title }));
                          load();
                        },
                        (caught: unknown) => setMessage(messageFor(caught)),
                      )
                    }
                  >
                    {t('links.remove')}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {/* What was removed from this execution stays noted for good: who, when and why — nothing of the document. */}
      {removals.length > 0 && (
        <ul className="plain-list" aria-label={t('links.run.removedList')}>
          {removals.map((removal) => (
            <li key={removal.id} className="card removal-note">
              <strong>{t('links.run.removedTitle')}</strong>
              <span>{t('links.run.removedBy', { when: formatDateTime(removal.removedAt), name: removal.removedBy })}</span>
              <span className="document-notes">{t('links.run.removedReason', { reason: removal.reason })}</span>
              <small className="muted">{t('links.run.removedWas', { count: removal.files, when: formatDateTime(removal.linkedAt), name: removal.linkedBy })}</small>
            </li>
          ))}
        </ul>
      )}
      {removing !== null && (
        <FormDialog
          title={t('links.run.removeKeptHeading', { name: removing.title })}
          submitLabel={t('links.run.removeKeptConfirm')}
          danger
          submitDisabled={reason.trim() === '' || !understood}
          onClose={() => setRemoving(null)}
          onSubmit={async () => {
            await api.removeKeptRunDocument(workspaceId, runId, removing.id, reason);
            setStatus(t('links.run.removedStatus'));
            load();
          }}
        >
          <p style={{ margin: 0 }}>{t('links.run.removeKeptWhat')}</p>
          <p className="muted" style={{ margin: 0 }}>
            {t('links.run.removeKeptKeeps')}
          </p>
          <p className="muted" style={{ margin: 0 }}>
            {t('links.run.removeKeptBackups')}
          </p>
          <div className="field">
            <label htmlFor={`remove-kept-reason-${runId}`}>{t('links.run.removeKeptReason')}</label>
            <textarea id={`remove-kept-reason-${runId}`} required rows={3} maxLength={500} value={reason} aria-describedby={`remove-kept-hint-${runId}`} onChange={(event) => setReason(event.target.value)} />
            <small id={`remove-kept-hint-${runId}`} className="muted">
              {t('links.run.removeKeptReasonHint')}
            </small>
          </div>
          <label className="option-label">
            <input type="checkbox" required checked={understood} onChange={(event) => setUnderstood(event.target.checked)} />
            <span>{t('links.run.removeKeptUnderstood')}</span>
          </label>
        </FormDialog>
      )}
      {tool.canManage && (
        <div>
          <button type="button" onClick={() => (setChoice(''), setLinking(true))}>
            <UiIcon name="documents" /> {t('links.run.add')}
          </button>
        </div>
      )}
      {linking && (
        <FormDialog
          title={t('links.run.addHeading')}
          submitLabel={t('links.run.addConfirm')}
          submitDisabled={choice === ''}
          onClose={() => setLinking(false)}
          onSubmit={async () => {
            const kept = await api.linkRunDocument(workspaceId, runId, choice);
            setStatus(t('links.run.added', { title: kept.title }));
            load();
          }}
        >
          <p className="muted" style={{ margin: 0 }}>
            {t(props.runState === 'ACTIVE' ? 'links.run.addHint' : 'links.run.addHintFinished')}
          </p>
          <DocumentPicker workspaceId={workspaceId} exclude={documents.filter((each) => each.source !== 'gone').map((each) => each.sourceDocumentId)} value={choice} onChange={setChoice} />
        </FormDialog>
      )}
      </div>
    </details>
  );
}

type LinkKind = 'procedure' | 'schedule' | 'document' | 'contact';

/** "Link to…": choose what kind of record, then which one of this Workspace. */
function LinkDialog(props: { workspaceId: string; documentId: string; linked: readonly DocumentLink[]; onClose: () => void; onLinked: (title: string) => void }) {
  const { workspaceId } = props;
  const contactsTool = useContactsTool();
  const id = useId();
  const [kind, setKind] = useState<LinkKind>('procedure');
  const [procedures, setProcedures] = useState<readonly ProcedureCard[] | null>(null);
  const [schedules, setSchedules] = useState<readonly Schedule[] | null>(null);
  const [choice, setChoice] = useState('');
  useEffect(() => {
    void api.procedures(workspaceId).then(setProcedures, () => setProcedures([]));
    void api.schedules(workspaceId).then(setSchedules, () => setSchedules([]));
  }, [workspaceId]);
  const taken = (type: LinkKind): string[] => props.linked.filter((link) => link.record.type === type).map((link) => link.record.id);
  const options =
    kind === 'procedure'
      ? (procedures ?? []).filter((each) => !taken('procedure').includes(each.id)).map((each) => ({ id: each.id, label: each.title }))
      : (schedules ?? [])
          .filter((each) => each.state !== 'ENDED' && !taken('schedule').includes(each.id))
          .map((each) => ({ id: each.id, label: `${each.kind === 'REMINDER' ? each.title : (each.procedure?.title ?? '')} — ${formatCalendarDate(each.date)}` }));
  const loading = kind === 'procedure' ? procedures === null : kind === 'schedule' ? schedules === null : false;
  return (
    <FormDialog
      title={t('links.addHeading')}
      submitLabel={t('links.addConfirm')}
      submitDisabled={choice === ''}
      onClose={props.onClose}
      onSubmit={async () => {
        const link = await api.addDocumentLink(workspaceId, props.documentId, { type: kind, id: choice });
        props.onLinked(link.record.title ?? '');
      }}
    >
      <p className="muted" style={{ margin: 0 }}>
        {t('links.addHint')}
      </p>
      <div className="field">
        <label htmlFor={`${id}-kind`}>{t('links.pick.kind')}</label>
        <select id={`${id}-kind`} value={kind} onChange={(event) => (setKind(event.target.value as LinkKind), setChoice(''))}>
          <option value="procedure">{t('links.kind.procedure')}</option>
          <option value="schedule">{t('links.kind.schedule')}</option>
          <option value="document">{t('links.kind.document')}</option>
          {contactsTool.enabled && <option value="contact">{t('links.kind.contact')}</option>}
        </select>
      </div>
      {kind === 'document' ? (
        <DocumentPicker workspaceId={workspaceId} exclude={[props.documentId, ...taken('document')]} value={choice} onChange={setChoice} />
      ) : kind === 'contact' ? (
        <ContactPicker workspaceId={workspaceId} exclude={taken('contact')} value={choice} onChange={setChoice} />
      ) : (
        <div className="field">
          <label htmlFor={`${id}-record`}>{t(kind === 'procedure' ? 'links.pick.procedure' : 'links.pick.schedule')}</label>
          <select id={`${id}-record`} required value={choice} onChange={(event) => setChoice(event.target.value)}>
            <option value="">{loading ? t('common.loading') : options.length === 0 ? t('links.pick.none') : t('links.pick.choose')}</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </FormDialog>
  );
}

/**
 * "Remind me…" (16.5, H13): the person chooses between a Reminder of its own and scheduling an
 * existing Procedure, then reviews date and notifications in the usual schedule dialog. Nothing is
 * taken from the Document but a proposed title; nothing is created before that dialog is confirmed.
 * The result is an ordinary Schedule, linked to the Document.
 */
export function RemindDialog(props: { workspaceId: string; suggestedTitle: string; heading?: string; link: (scheduleId: string) => Promise<unknown>; onClose: () => void; onDone: (title: string) => void }) {
  const { workspaceId } = props;
  const id = useId();
  const [kind, setKind] = useState<'REMINDER' | 'PROCEDURE'>('REMINDER');
  const [procedures, setProcedures] = useState<readonly ProcedureCard[] | null>(null);
  const [procedureId, setProcedureId] = useState('');
  const [members, setMembers] = useState<readonly PersonRef[] | null>(null);
  const [scheduling, setScheduling] = useState(false);
  useEffect(() => {
    void api.procedures(workspaceId).then(setProcedures, () => setProcedures([]));
    // Guests cannot list members; then nobody is offered as responsible.
    void api.members(workspaceId).then(
      (loaded) => setMembers(loaded.map((member) => ({ id: member.userId, name: member.displayName }))),
      () => setMembers(null),
    );
  }, [workspaceId]);
  const procedure = procedures?.find((each) => each.id === procedureId);
  if (scheduling) {
    return (
      <ScheduleDialog
        kind={kind}
        {...(kind === 'PROCEDURE' ? { title: procedure?.title ?? '' } : { suggestedTitle: props.suggestedTitle.slice(0, 120) })}
        members={members}
        onClose={props.onClose}
        onSubmit={async (input) => {
          const schedule = await api.createSchedule(workspaceId, kind === 'PROCEDURE' ? { ...input, procedureId } : input);
          await props.link(schedule.id);
          props.onDone(kind === 'PROCEDURE' ? (procedure?.title ?? '') : schedule.title);
        }}
      />
    );
  }
  return (
    <FormDialog
      title={props.heading ?? t('links.remind.heading')}
      submitLabel={t('links.remind.next')}
      submitDisabled={kind === 'PROCEDURE' && procedureId === ''}
      onClose={props.onClose}
      // "Next" opens the schedule dialog in this one's place: this dialog is not closed, it is replaced.
      onSubmit={() => {
        setScheduling(true);
        return new Promise<void>(() => undefined);
      }}
    >
      <fieldset className="stack plain-fieldset">
        <legend>{t('links.remind.question')}</legend>
        <label className="option-label">
          <input type="radio" name={`${id}-kind`} checked={kind === 'REMINDER'} onChange={() => setKind('REMINDER')} />
          <span>
            <strong>{t('links.remind.reminder')}</strong>
            <br />
            <small className="muted">{t('links.remind.reminderHint')}</small>
          </span>
        </label>
        <label className="option-label">
          <input type="radio" name={`${id}-kind`} checked={kind === 'PROCEDURE'} onChange={() => setKind('PROCEDURE')} />
          <span>
            <strong>{t('links.remind.procedure')}</strong>
            <br />
            <small className="muted">{t('links.remind.procedureHint')}</small>
          </span>
        </label>
      </fieldset>
      {kind === 'PROCEDURE' && (
        <div className="field">
          <label htmlFor={`${id}-procedure`}>{t('links.pick.procedure')}</label>
          <select id={`${id}-procedure`} required value={procedureId} onChange={(event) => setProcedureId(event.target.value)}>
            <option value="">{procedures === null ? t('common.loading') : procedures.length === 0 ? t('links.pick.none') : t('links.pick.choose')}</option>
            {(procedures ?? []).map((each) => (
              <option key={each.id} value={each.id}>
                {each.title}
              </option>
            ))}
          </select>
        </div>
      )}
      <p className="muted" style={{ margin: 0 }}>
        {t('links.remind.review')}
      </p>
    </FormDialog>
  );
}

/**
 * On a Document: what it is linked to — Procedures, Reminders, scheduled Procedures, related
 * Documents — and the executions that keep a version of it; for those who manage Documents, "Link
 * to…", "Remind me…" and removing a Link (never the record at its other end).
 */
export function DocumentLinksSection(props: { workspaceId: string; documentId: string; documentTitle: string; canManage: boolean; canSchedule: boolean }) {
  const { workspaceId, documentId } = props;
  const [links, setLinks] = useState<readonly DocumentLink[]>([]);
  const [runs, setRuns] = useState<readonly RunLink[]>([]);
  const [dialog, setDialog] = useState<'link' | 'remind' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const load = useCallback(() => {
    api.documentLinks(workspaceId, documentId).then(
      (loaded) => {
        setLinks(loaded.links);
        setRuns(loaded.runs);
      },
      () => undefined,
    );
  }, [workspaceId, documentId]);
  useEffect(load, [load]);
  if (!props.canManage && links.length === 0 && runs.length === 0) return null;
  return (
    <section className="stack" aria-labelledby="document-links-heading">
      <h3 className="section-label" id="document-links-heading">
        {t('links.heading')}
      </h3>
      {message !== null && <p role="alert">{message}</p>}
      {status !== null && (
        <p role="status" className="card calm">
          {status}
        </p>
      )}
      {links.length === 0 && runs.length === 0 && <p className="muted">{t('links.none')}</p>}
      {(links.length > 0 || runs.length > 0) && (
        <ul className="plain-list card">
          {links.map((link) => (
            <LinkLine
              key={link.id}
              workspaceId={workspaceId}
              link={link}
              onRemove={
                props.canManage
                  ? () =>
                      void api.removeDocumentLink(workspaceId, link.id).then(
                        () => {
                          setStatus(t('links.removed', { name: linkedRecordText(link.record).title }));
                          load();
                        },
                        (caught: unknown) => setMessage(messageFor(caught)),
                      )
                  : undefined
              }
            />
          ))}
          {runs.map((run) => (
            <li key={run.id} className="link-line">
              <span className="item-body">
                <span>
                  <small className="muted">{t('links.kind.run')}: </small>
                  <Link href={paths.run(workspaceId, run.runId)}>{run.title}</Link>
                </span>
                <small className="muted">
                  {t('links.run.version', { when: formatDateTime(run.linkedAt), name: run.linkedBy })}
                  {run.changedSince && ` ${t('links.run.keepsOlder')}`}
                </small>
              </span>
            </li>
          ))}
        </ul>
      )}
      {props.canManage && (
        <div className="row">
          <button type="button" onClick={() => setDialog('link')}>
            {t('links.add')}
          </button>
          {props.canSchedule && (
            <button type="button" onClick={() => setDialog('remind')}>
              {t('links.remind.button')}
            </button>
          )}
        </div>
      )}
      {dialog === 'link' && (
        <LinkDialog
          workspaceId={workspaceId}
          documentId={documentId}
          linked={links}
          onClose={() => setDialog(null)}
          onLinked={(title) => {
            setStatus(t('links.added', { name: title }));
            load();
          }}
        />
      )}
      {dialog === 'remind' && (
        <RemindDialog
          workspaceId={workspaceId}
          suggestedTitle={props.documentTitle}
          link={(scheduleId) => api.addDocumentLink(workspaceId, documentId, { type: 'schedule', id: scheduleId })}
          onClose={() => setDialog(null)}
          onDone={(title) => {
            setStatus(t('links.remind.done', { name: title }));
            load();
          }}
        />
      )}
    </section>
  );
}
