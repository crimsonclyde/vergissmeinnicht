import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { api, messageFor, type DeletedProcedure, type Procedure, type ProcedureCard, type ProcedureDetail } from './api.ts';
import { LinkedContacts } from './Contacts.tsx';
import { LinkedDocuments } from './DocumentLinks.tsx';
import { History } from './History.tsx';
import { formatCalendarDate, formatDateTime, formatRelative, t } from './i18n/index.ts';
import { KnotShare } from './Knots.tsx';
import { MoreMenu, type MoreMenuItem } from './MoreMenu.tsx';
import { StepMarks } from './StepMarks.tsx';
import { AppIcon } from './procedure-icons.tsx';
import { archiveFileName, downloadBlob, downloadJson, exportFileName, isArchive, MAX_ARCHIVE_BYTES, readImportFile } from './procedure-files.ts';
import { Link, navigate, paths } from './router.tsx';
import { StepImage } from './StepImage.tsx';
import { todayIn } from './schedule-dates.ts';
import { StartControl } from './StartProcedure.tsx';
import { UiIcon } from './ui-icons.tsx';

type Panel = 'share' | 'history';
/** `#share` / `#history` after a Procedure's address opens that panel (from the list's ⋯ menu, or a link). */
const panelOf = (hash: string): Panel | undefined => (hash === '#share' || hash === '#history' ? (hash.slice(1) as Panel) : undefined);

/** One line of facts on a card: scheduled/due, active executions, last completion (13.16). */
function CardFacts({ card }: { card: ProcedureCard }) {
  const facts: { text: string; urgent?: boolean }[] = [];
  if (card.nextOccurrence !== null) {
    const today = todayIn(card.nextOccurrence.timeZone);
    const date = formatCalendarDate(card.nextOccurrence.date);
    if (card.nextOccurrence.date < today) facts.push({ text: t('procedures.overdue', { date }), urgent: true });
    else if (card.nextOccurrence.date === today) facts.push({ text: t('procedures.dueToday'), urgent: true });
    else facts.push({ text: t('procedures.scheduledFor', { date }) });
  }
  if (card.active.length > 0) facts.push({ text: t('procedures.activeCount', { count: card.active.length }) });
  if (card.lastCompletedAt !== null) facts.push({ text: t('procedures.lastCompleted', { ago: formatRelative(card.lastCompletedAt) }) });
  if (facts.length === 0) return null;
  return (
    <small className="card-facts">
      {facts.map((fact, index) => (
        <span key={fact.text} className={fact.urgent === true ? 'state-text-PENDING' : 'muted'}>
          {index > 0 && ' · '}
          {fact.urgent === true && <span aria-hidden="true">! </span>}
          {fact.text}
        </span>
      ))}
    </small>
  );
}

/** Every tag used in the Workspace, sorted for the filter. */
const allTags = (procedures: readonly Procedure[]) =>
  [...new Set(procedures.flatMap((procedure) => procedure.tags))].sort((a, b) => a.localeCompare(b));

function ProcedureView({ detail, workspaceId }: { detail: ProcedureDetail; workspaceId: string }) {
  return (
    <>
      <div className="card stack">
        <h2 id="procedure-title" style={{ margin: 0 }}>
          <AppIcon name={detail.icon} /> {detail.title}
        </h2>
        {/* Plain text: React escapes it; line breaks are preserved by CSS only. */}
        {detail.description !== '' && <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{detail.description}</p>}
        {detail.tags.length > 0 && <p className="muted" style={{ margin: 0 }}>{t('procedure.tags', { tags: detail.tags.join(', ') })}</p>}
      </div>
      {detail.sections.every((section) => section.steps.length === 0) && <p className="muted">{t('procedure.noSteps')}</p>}
      {detail.sections.map((section) => (
        <section key={section.id} aria-label={t('procedure.sectionLabel', { title: section.title })} className="card">
          <h3 style={{ marginTop: 0 }}>{section.title}</h3>
          {section.description !== '' && <p style={{ whiteSpace: 'pre-wrap' }}>{section.description}</p>}
          <ol>
            {section.steps.map((step) => (
              <li key={step.id} style={{ marginBottom: '0.5rem' }}>
                {step.icon !== null && (
                  <>
                    <AppIcon name={step.icon} />{' '}
                  </>
                )}
                <strong>{step.title}</strong>
                <StepMarks required={step.required} critical={step.critical} />
                {step.description !== '' && <p style={{ whiteSpace: 'pre-wrap' }}>{step.description}</p>}
                {step.image != null && <StepImage workspaceId={workspaceId} image={step.image} />}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}

type Mode = { kind: 'list' } | { kind: 'deleted' } | { kind: 'deletedView'; id: string } | { kind: 'view'; id: string; panel?: Panel };

/**
 * The Procedures tool: the reusable definitions of the Workspace — browse, open, start or schedule, and
 * (for editors) create and change them in the builder (15.2). Capabilities only adapt the UI; the
 * server authorizes every request.
 */
export function Procedures(props: {
  workspaceId: string;
  /** From the URL (also a Knot link's target): this Procedure is open. */
  openProcedureId: string | null;
  canManageKnots: boolean;
  canEdit: boolean;
  canRestore: boolean;
  canStartRun: boolean;
  canSchedule: boolean;
  /** Opens an execution (after Start, or Continue existing). */
  onOpenRun: (runId: string) => void;
}) {
  const { workspaceId, canEdit, canRestore, canStartRun, canSchedule, onOpenRun } = props;
  const [procedures, setProcedures] = useState<ProcedureCard[] | null>(null);
  const [recent, setRecent] = useState<readonly ProcedureCard[]>([]);
  const importRef = useRef<HTMLInputElement>(null);
  const [deleted, setDeleted] = useState<DeletedProcedure[] | null>(null);
  const [detail, setDetail] = useState<ProcedureDetail | null>(null);
  const [mode, setMode] = useState<Mode>(() => {
    if (props.openProcedureId === null) return { kind: 'list' };
    const panel = panelOf(window.location.hash);
    return { kind: 'view', id: props.openProcedureId, ...(panel === undefined ? {} : { panel }) };
  });
  const [message, setMessage] = useState<string | null>(null);
  // Per view only (not stored); '' = all tags.
  const [tagFilter, setTagFilter] = useState('');
  const [deletedDetail, setDeletedDetail] = useState<ProcedureDetail | null>(null);

  const refresh = useCallback(() => {
    api.procedures(workspaceId).then(setProcedures, (caught: unknown) => setMessage(messageFor(caught)));
    // Recently used Procedures of this person (13.13); an extra — the list works without it.
    api.home(workspaceId).then(
      (home) => setRecent(home.recent),
      () => undefined,
    );
  }, [workspaceId]);
  useEffect(refresh, [refresh]);

  const openedId = mode.kind === 'view' ? mode.id : null;
  useEffect(() => {
    if (openedId === null) return;
    let active = true;
    api.procedure(workspaceId, openedId).then(
      (loaded) => active && setDetail(loaded),
      (caught: unknown) => {
        if (!active) return;
        setMessage(messageFor(caught));
        setMode({ kind: 'list' });
      },
    );
    return () => {
      active = false;
    };
  }, [workspaceId, openedId]);

  const shown = detail !== null && detail.id === openedId ? detail : null;
  const toList = () => navigate(paths.procedures(workspaceId));

  /** Opens a Procedure at its own address (so Back and links work), optionally with a panel. */
  function open(id: string, panel?: Panel) {
    if (id === openedId) {
      setMode({ kind: 'view', id, ...(panel === undefined ? {} : { panel }) });
      return;
    }
    navigate(`${paths.procedure(workspaceId, id)}${panel === undefined ? '' : `#${panel}`}`);
  }

  async function togglePin(id: string, pinned: boolean) {
    setMessage(null);
    // Instant feedback; the list is reloaded from the server afterwards.
    setProcedures((current) => current?.map((card) => (card.id === id ? { ...card, pinned } : card)) ?? null);
    try {
      await api.pinProcedure(workspaceId, id, pinned);
    } catch (caught) {
      setMessage(messageFor(caught));
    }
    refresh();
  }

  const pinnedNow = (id: string) => procedures?.find((card) => card.id === id)?.pinned === true;

  /** Secondary actions of a Procedure (13.15): only those the person may use. */
  function moreItems(procedure: Pick<Procedure, 'id' | 'title'>, inView: boolean): MoreMenuItem[] {
    const pinned = pinnedNow(procedure.id);
    return [
      ...(canEdit ? [{ label: t('procedure.edit'), onSelect: () => navigate(paths.editProcedure(workspaceId, procedure.id)) }] : []),
      // Personal, instant, never part of the Workspace history (13.12).
      { label: t(pinned ? 'procedures.unpinShort' : 'procedures.pinShort'), onSelect: () => void togglePin(procedure.id, !pinned) },
      ...(canEdit ? [{ label: t('procedure.duplicate'), onSelect: () => void runAction(() => api.duplicateProcedure(workspaceId, procedure.id)) }] : []),
      { label: t('procedure.export'), onSelect: () => void exportProcedure(procedure) },
      { label: t('procedure.exportArchive'), onSelect: () => void exportArchive(procedure) },
      ...(props.canManageKnots ? [{ label: t('procedure.share'), onSelect: () => open(procedure.id, 'share') }] : []),
      ...(inView ? [] : [{ label: t('procedure.history'), onSelect: () => open(procedure.id, 'history') }]),
      ...(canEdit ? [{ label: t('procedure.delete'), onSelect: () => void remove(procedure), danger: true }] : []),
    ];
  }

  /** Runs an action; if it yields a new Procedure (import, duplicate, restore), opens it. */
  async function runAction(action: () => Promise<ProcedureDetail | undefined>) {
    setMessage(null);
    try {
      const result = await action();
      if (result !== undefined) navigate(paths.procedure(workspaceId, result.id));
    } catch (caught) {
      setMessage(messageFor(caught));
    }
  }

  async function exportProcedure(procedure: Pick<Procedure, 'id' | 'title'>) {
    await runAction(async () => {
      downloadJson(await api.exportProcedure(workspaceId, procedure.id), exportFileName(procedure.title));
      return undefined;
    });
  }

  async function exportArchive(procedure: Pick<Procedure, 'id' | 'title'>) {
    await runAction(async () => {
      downloadBlob(await api.exportProcedureArchive(workspaceId, procedure.id), archiveFileName(procedure.title));
      return undefined;
    });
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file === undefined) return;
    if (await isArchive(file)) {
      if (file.size > MAX_ARCHIVE_BYTES) {
        setMessage(t('error.invalid_archive'));
        return;
      }
      await runAction(() => api.importProcedureArchive(workspaceId, file));
      return;
    }
    const read = await readImportFile(file);
    if (!read.ok) {
      setMessage(read.message);
      return;
    }
    await runAction(() => api.importProcedure(workspaceId, read.document));
  }

  function viewDeleted(id: string) {
    setMessage(null);
    setDeletedDetail(null);
    setMode({ kind: 'deletedView', id });
    api.deletedProcedure(workspaceId, id).then(setDeletedDetail, (caught: unknown) => {
      setMessage(messageFor(caught));
      setMode({ kind: 'deleted' });
    });
  }

  function showDeleted() {
    setMessage(null);
    setDeleted(null);
    setMode({ kind: 'deleted' });
    api.deletedProcedures(workspaceId).then(setDeleted, (caught: unknown) => setMessage(messageFor(caught)));
  }

  async function remove(procedure: Pick<Procedure, 'id' | 'title'>) {
    if (!window.confirm(t('procedure.deleteConfirm', { title: procedure.title }))) return;
    setMessage(null);
    try {
      await api.deleteProcedure(workspaceId, procedure.id);
      if (openedId !== null) toList();
    } catch (caught) {
      setMessage(messageFor(caught));
    }
    refresh();
  }

  const manageItems: MoreMenuItem[] = [
    ...(canEdit ? [{ label: t('procedures.import'), onSelect: () => importRef.current?.click() }] : []),
    { label: t('shell.history'), onSelect: () => navigate(paths.history(workspaceId)) },
    ...(canRestore ? [{ label: t('procedures.showDeleted'), onSelect: showDeleted }] : []),
  ];
  const visible = procedures?.filter((procedure) => tagFilter === '' || procedure.tags.includes(tagFilter)) ?? [];

  return (
    <section aria-labelledby="procedures-heading">
      <div className="page-header page-header-tool">
        <div>
          <h2 id="procedures-heading">{t('procedures.heading')}</h2>
          {mode.kind === 'list' && <p className="muted page-lead">{t('procedures.lead')}</p>}
        </div>
        {mode.kind === 'list' && (
          <div className="row">
            {canEdit && (
              <button type="button" className="primary" onClick={() => navigate(paths.newProcedure(workspaceId))}>
                <UiIcon name="add" /> {t('procedures.new')}
              </button>
            )}
            <MoreMenu label={t('procedures.manage')} items={manageItems} />
          </div>
        )}
      </div>
      {/* Opened from the Manage menu; not a visible control of its own. */}
      {canEdit && (
        <input ref={importRef} type="file" accept="application/json,.json,application/zip,.zip" className="visually-hidden" tabIndex={-1} aria-label={t('procedures.import')} onChange={(e) => void importFile(e)} />
      )}
      {message !== null && <p role="alert">{message}</p>}

      {mode.kind === 'view' && shown !== null && (
        <article aria-labelledby="procedure-title">
          <p className="back-row">
            <Link href={paths.procedures(workspaceId)} className="back-link">
              <UiIcon name="back" /> {t('procedures.back')}
            </Link>
          </p>
          <div className="row procedure-actions">
            <StartControl workspaceId={workspaceId} procedure={shown} canStart={canStartRun} canSchedule={canSchedule} onOpenRun={onOpenRun} onScheduled={refresh} />
            {canEdit && (
              <Link href={paths.editProcedure(workspaceId, shown.id)} className="button">
                {t('procedure.edit')}
              </Link>
            )}
            <MoreMenu label={t('procedure.moreFor', { title: shown.title })} items={moreItems(shown, true).filter((item) => item.label !== t('procedure.edit'))} />
          </div>
          {mode.panel === 'share' && props.canManageKnots && (
            <div className="card">
              <KnotShare
                key={shown.id}
                workspaceId={workspaceId}
                target={{ type: 'PROCEDURE', id: shown.id }}
                defaultLabel={shown.title}
                initiallyOpen
                onDone={() => setMode({ kind: 'view', id: shown.id })}
              />
            </div>
          )}
          <ProcedureView detail={shown} workspaceId={workspaceId} />
          <LinkedDocuments workspaceId={workspaceId} target={{ type: 'procedure', id: shown.id }} />
          <LinkedContacts workspaceId={workspaceId} procedureId={shown.id} />
          {/* History is one click away, not competing with the Procedure itself. */}
          <details className="more-actions" open={mode.panel === 'history'}>
            <summary>{t('procedure.history')}</summary>
            <History key={`${shown.id}-${shown.revision}`} label={t('procedure.historyLabel')} load={(after) => api.procedureHistory(workspaceId, shown.id, after)} />
          </details>
        </article>
      )}

      {mode.kind === 'view' && shown === null && message === null && <p>{t('common.loading')}</p>}

      {mode.kind === 'deleted' && (
        <section aria-labelledby="deleted-heading" className="card stack">
          <h3 id="deleted-heading" style={{ marginTop: 0 }}>
            {t('procedures.deletedHeading')}
          </h3>
          {deleted === null ? (
            <p>{t('common.loading')}</p>
          ) : deleted.length === 0 ? (
            <p>{t('procedures.noneDeleted')}</p>
          ) : (
            <ul aria-label={t('procedures.deletedHeading')}>
              {deleted.map((procedure) => (
                <li key={procedure.id}>
                  <AppIcon name={procedure.icon} /> {procedure.title}
                  {t('procedures.deletedBy', { name: procedure.deletedBy, time: formatDateTime(procedure.deletedAt) })}{' '}
                  <button type="button" className="quiet" onClick={() => viewDeleted(procedure.id)}>
                    {t('procedures.viewDeleted', { title: procedure.title })}
                  </button>
                  <button type="button" onClick={() => void runAction(() => api.restoreProcedure(workspaceId, procedure.id))}>
                    {t('procedures.restore', { title: procedure.title })}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div>
            <button type="button" onClick={() => setMode({ kind: 'list' })}>
              {t('procedures.back')}
            </button>
          </div>
        </section>
      )}

      {mode.kind === 'deletedView' && (
        <article aria-labelledby="procedure-title">
          <p className="back-row">
            <button type="button" className="link-like back-link" onClick={showDeleted}>
              <UiIcon name="back" /> {t('procedures.backToDeleted')}
            </button>
          </p>
          {deletedDetail === null || deletedDetail.id !== mode.id ? (
            <p>{t('common.loading')}</p>
          ) : (
            <>
              <p role="note" className="card">
                {t('procedures.deletedNote')}
              </p>
              <ProcedureView detail={deletedDetail} workspaceId={workspaceId} />
              <p className="row">
                <button type="button" className="primary" onClick={() => void runAction(() => api.restoreProcedure(workspaceId, deletedDetail.id))}>
                  {t('procedures.restore', { title: deletedDetail.title })}
                </button>
              </p>
            </>
          )}
        </article>
      )}

      {mode.kind === 'list' && (
        <>
          {recent.length > 0 && (
            <nav aria-label={t('procedures.recent')} className="quiet-links recent-links">
              <span className="muted">{t('procedures.recent')}</span>
              {recent.map((card) => (
                <Link key={card.id} href={paths.procedure(workspaceId, card.id)}>
                  <AppIcon name={card.icon} decorative /> {card.title}
                </Link>
              ))}
            </nav>
          )}
          {procedures !== null && allTags(procedures).length > 0 && (
            <p className="row tag-filter">
              <label htmlFor="procedure-tag-filter">{t('procedures.filterByTag')}</label>
              <select id="procedure-tag-filter" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
                <option value="">{t('procedures.allTags')}</option>
                {allTags(procedures).map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            </p>
          )}
          {procedures === null ? (
            <p>{t('common.loading')}</p>
          ) : procedures.length === 0 ? (
            <p className="card calm">{t(canEdit ? 'procedures.noneHint' : 'procedures.none')}</p>
          ) : (
            <ul aria-label={t('procedures.heading')} className="plain-list">
              {visible.map((procedure) => (
                <li key={procedure.id} className="card item-card">
                  <div className="item-main">
                    <span className="item-icon">
                      <AppIcon name={procedure.icon} decorative />
                    </span>
                    <div className="item-body">
                      <span className="item-title">
                        <Link href={paths.procedure(workspaceId, procedure.id)} className="procedure-link">
                          {procedure.title}
                        </Link>
                        {procedure.pinned && (
                          <span className="pin-mark" role="img" aria-label={t('procedures.pinnedHint')} title={t('procedures.pinnedHint')}>
                            ★
                          </span>
                        )}
                      </span>
                      <CardFacts card={procedure} />
                    </div>
                    <div className="item-actions">
                      <StartControl workspaceId={workspaceId} procedure={procedure} canStart={canStartRun} canSchedule={canSchedule} onOpenRun={onOpenRun} onScheduled={refresh} />
                      <MoreMenu label={t('procedure.moreFor', { title: procedure.title })} items={moreItems(procedure, false)} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
