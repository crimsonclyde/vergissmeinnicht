import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  api,
  messageFor,
  type DeletedProcedure,
  type Procedure,
  type ProcedureCard,
  type ProcedureContent,
  type ProcedureDetail,
} from './api.ts';
import { History } from './History.tsx';
import { formatCalendarDate, formatDateTime, formatRelative, t } from './i18n/index.ts';
import { KnotShare } from './Knots.tsx';
import { MoreMenu, type MoreMenuItem } from './MoreMenu.tsx';
import { StepMarks } from './StepMarks.tsx';
import { Icon } from './procedure-icons.tsx';
import { downloadJson, exportFileName, readImportFile } from './procedure-files.ts';
import { ProcedureForm } from './ProcedureForm.tsx';
import { todayIn } from './schedule-dates.ts';
import { StartControl } from './StartProcedure.tsx';

/** Pin/unpin: personal, instant, never part of the Workspace history (13.12). */
function PinButton(props: { title: string; pinned: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="pin-button"
      aria-pressed={props.pinned}
      aria-label={t(props.pinned ? 'procedures.unpin' : 'procedures.pin', { title: props.title })}
      title={t(props.pinned ? 'procedures.pinnedHint' : 'procedures.pinHint')}
      onClick={props.onToggle}
    >
      <span aria-hidden="true">{props.pinned ? '★' : '☆'}</span>
    </button>
  );
}

/** Compact facts of a card: scheduled/due, last completion, active executions (13.16). */
function CardFacts({ card }: { card: ProcedureCard }) {
  const facts: { text: string; urgent?: boolean }[] = [];
  if (card.nextSchedule !== null) {
    const today = todayIn(card.nextSchedule.timeZone);
    const date = formatCalendarDate(card.nextSchedule.date);
    if (card.nextSchedule.date < today) facts.push({ text: t('procedures.overdue', { date }), urgent: true });
    else if (card.nextSchedule.date === today) facts.push({ text: t('procedures.dueToday'), urgent: true });
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
          {fact.text}
        </span>
      ))}
    </small>
  );
}

/** Every tag used in the Workspace, sorted for the filter. */
const allTags = (procedures: readonly Procedure[]) =>
  [...new Set(procedures.flatMap((procedure) => procedure.tags))].sort((a, b) => a.localeCompare(b));

const EMPTY: ProcedureContent = { title: '', description: '', icon: 'checklist', tags: [], sections: [] };


function ProcedureView({ detail }: { detail: ProcedureDetail }) {
  return (
    <>
      <div className="card stack">
        <h2 id="procedure-title" style={{ margin: 0 }}>
          <Icon icon={detail.icon} /> {detail.title}
        </h2>
        {/* Plain text: React escapes it; line breaks are preserved by CSS only. */}
        {detail.description !== '' && <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{detail.description}</p>}
        {detail.tags.length > 0 && <p className="muted" style={{ margin: 0 }}>{t('procedure.tags', { tags: detail.tags.join(', ') })}</p>}
      </div>
      {detail.sections.length === 0 && <p className="muted">{t('procedure.noSections')}</p>}
      {detail.sections.map((section) => (
        <section key={section.id} aria-label={t('procedure.sectionLabel', { title: section.title })} className="card">
          <h3 style={{ marginTop: 0 }}>{section.title}</h3>
          {section.description !== '' && <p style={{ whiteSpace: 'pre-wrap' }}>{section.description}</p>}
          <ol>
            {section.steps.map((step) => (
              <li key={step.id} style={{ marginBottom: '0.5rem' }}>
                {step.icon !== null && (
                  <>
                    <Icon icon={step.icon} />{' '}
                  </>
                )}
                <strong>{step.title}</strong>
                <StepMarks required={step.required} critical={step.critical} />
                {step.description !== '' && <p style={{ whiteSpace: 'pre-wrap' }}>{step.description}</p>}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}

type Mode =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'deleted' }
  | { kind: 'deletedView'; id: string }
  | { kind: 'view'; id: string; panel?: 'share' | 'history' }
  | { kind: 'edit'; id: string };

/** Capabilities only adapt the UI; the server authorizes every request. */
export function Procedures(props: {
  workspaceId: string;
  /** From the URL (e.g. a Knot link): open this Procedure first. */
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
  const importRef = useRef<HTMLInputElement>(null);
  const [deleted, setDeleted] = useState<DeletedProcedure[] | null>(null);
  const [detail, setDetail] = useState<ProcedureDetail | null>(null);
  const [mode, setMode] = useState<Mode>(props.openProcedureId === null ? { kind: 'list' } : { kind: 'view', id: props.openProcedureId });
  const [message, setMessage] = useState<string | null>(null);
  // Per view only (not stored); '' = all tags.
  const [tagFilter, setTagFilter] = useState('');
  const [deletedDetail, setDeletedDetail] = useState<ProcedureDetail | null>(null);

  const refresh = useCallback(() => {
    api.procedures(workspaceId).then(setProcedures, (caught: unknown) => setMessage(messageFor(caught)));
  }, [workspaceId]);
  useEffect(refresh, [refresh]);

  const openedId = mode.kind === 'view' || mode.kind === 'edit' ? mode.id : null;
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

  function open(id: string, panel?: 'share' | 'history') {
    setMessage(null);
    setMode({ kind: 'view', id, ...(panel === undefined ? {} : { panel }) });
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

  /** Secondary actions of a Procedure (13.15): only those the person may use. */
  function moreItems(procedure: Pick<Procedure, 'id' | 'title'>, inView: boolean): MoreMenuItem[] {
    return [
      ...(canEdit ? [{ label: t('procedure.edit'), onSelect: () => setMode({ kind: 'edit', id: procedure.id }) }] : []),
      ...(canEdit ? [{ label: t('procedure.duplicate'), onSelect: () => void runAction(() => api.duplicateProcedure(workspaceId, procedure.id)) }] : []),
      { label: t('procedure.export'), onSelect: () => void exportProcedure(procedure) },
      ...(props.canManageKnots ? [{ label: t('procedure.share'), onSelect: () => open(procedure.id, 'share') }] : []),
      ...(inView ? [] : [{ label: t('procedure.history'), onSelect: () => open(procedure.id, 'history') }]),
      ...(canEdit ? [{ label: t('procedure.delete'), onSelect: () => void remove(procedure), danger: true }] : []),
    ];
  }

  /** Runs an action; if it yields a new Procedure (import, duplicate), opens it. */
  async function runAction(action: () => Promise<ProcedureDetail | undefined>) {
    setMessage(null);
    try {
      const result = await action();
      if (result !== undefined) {
        setDetail(result);
        refresh();
        open(result.id);
      }
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

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file === undefined) return;
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
      setMode({ kind: 'list' });
    } catch (caught) {
      setMessage(messageFor(caught));
    }
    refresh();
  }

  const manageItems: MoreMenuItem[] = [
    ...(canEdit ? [{ label: t('procedures.import'), onSelect: () => importRef.current?.click() }] : []),
    ...(canRestore ? [{ label: t('procedures.showDeleted'), onSelect: showDeleted }] : []),
  ];

  return (
    <section aria-labelledby="procedures-heading">
      <div className="page-header">
        <h2 id="procedures-heading">{t('procedures.heading')}</h2>
        {mode.kind === 'list' && (
          <div className="row">
            {canEdit && (
              <button type="button" className="primary" onClick={() => setMode({ kind: 'create' })}>
                {t('procedures.new')}
              </button>
            )}
            <MoreMenu label={t('procedures.manage')} items={manageItems} />
          </div>
        )}
      </div>
      {/* Opened from the Manage menu; not a visible control of its own. */}
      {canEdit && (
        <input ref={importRef} type="file" accept="application/json,.json" className="visually-hidden" tabIndex={-1} aria-label={t('procedures.import')} onChange={(e) => void importFile(e)} />
      )}
      {message !== null && <p role="alert">{message}</p>}

      {mode.kind === 'create' && (
        <ProcedureForm
          initial={EMPTY}
          submitLabel={t('procedure.create')}
          onCancel={() => setMode({ kind: 'list' })}
          onSubmit={async (content) => {
            const created = await api.createProcedure(workspaceId, content);
            setDetail(created);
            refresh();
            open(created.id);
          }}
        />
      )}

      {mode.kind === 'edit' && shown !== null && (
        <ProcedureForm
          key={`${shown.id}-${shown.revision}`}
          initial={shown}
          submitLabel={t('procedure.save')}
          onCancel={() => setMode({ kind: 'view', id: shown.id })}
          onSubmit={async (content) => {
            const saved = await api.updateProcedure(workspaceId, shown.id, shown.revision, content);
            setDetail(saved);
            refresh();
            setMode({ kind: 'view', id: saved.id });
          }}
        />
      )}

      {mode.kind === 'view' && shown !== null && (
        <article aria-labelledby="procedure-title">
          <p>
            <button type="button" className="link-like" onClick={() => setMode({ kind: 'list' })}>
              {t('procedures.backArrow')}
            </button>
          </p>
          <div className="row procedure-actions">
            <StartControl workspaceId={workspaceId} procedure={shown} canStart={canStartRun} canSchedule={canSchedule} onOpenRun={onOpenRun} onScheduled={refresh} />
            <PinButton
              title={shown.title}
              pinned={procedures?.find((card) => card.id === shown.id)?.pinned === true}
              onToggle={() => void togglePin(shown.id, procedures?.find((card) => card.id === shown.id)?.pinned !== true)}
            />
            <MoreMenu label={t('procedure.moreFor', { title: shown.title })} items={moreItems(shown, true)} />
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
          <ProcedureView detail={shown} />
          {/* History is one click away, not competing with the Procedure itself. */}
          <details className="more-actions" open={mode.panel === 'history'}>
            <summary>{t('procedure.history')}</summary>
            <History key={`${shown.id}-${shown.revision}`} label={t('procedure.historyLabel')} load={(after) => api.procedureHistory(workspaceId, shown.id, after)} />
          </details>
        </article>
      )}

      {(mode.kind === 'view' || mode.kind === 'edit') && shown === null && <p>{t('common.loading')}</p>}

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
                  <Icon icon={procedure.icon} /> {procedure.title}
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
          <button type="button" onClick={() => setMode({ kind: 'list' })}>
            {t('procedures.back')}
          </button>
        </section>
      )}

      {mode.kind === 'deletedView' && (
        <article aria-labelledby="procedure-title">
          <p>
            <button type="button" className="link-like" onClick={showDeleted}>
              {t('procedures.backToDeleted')}
            </button>
          </p>
          {deletedDetail === null || deletedDetail.id !== mode.id ? (
            <p>{t('common.loading')}</p>
          ) : (
            <>
              <p role="note" className="card">
                {t('procedures.deletedNote')}
              </p>
              <ProcedureView detail={deletedDetail} />
              <p className="row">
                <button
                  type="button"
                  className="primary"
                  onClick={() => void runAction(() => api.restoreProcedure(workspaceId, deletedDetail.id))}
                >
                  {t('procedures.restore', { title: deletedDetail.title })}
                </button>
              </p>
            </>
          )}
        </article>
      )}

      {mode.kind === 'list' && (
        <>
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
            <p className="card">{t(canEdit ? 'procedures.noneHint' : 'procedures.none')}</p>
          ) : (
            <ul aria-label={t('procedures.heading')} className="plain-list">
              {procedures.filter((procedure) => tagFilter === '' || procedure.tags.includes(tagFilter)).map((procedure) => (
                <li key={procedure.id} className="card procedure-card">
                  <div className="procedure-card-main">
                    <button type="button" className="link-like procedure-link" onClick={() => open(procedure.id)}>
                      <Icon icon={procedure.icon} /> {procedure.title}
                    </button>
                    <CardFacts card={procedure} />
                  </div>
                  <div className="procedure-card-actions">
                    <PinButton title={procedure.title} pinned={procedure.pinned} onToggle={() => void togglePin(procedure.id, !procedure.pinned)} />
                    <StartControl
                      workspaceId={workspaceId}
                      procedure={procedure}
                      canStart={canStartRun}
                      canSchedule={canSchedule}
                      onOpenRun={onOpenRun}
                      onScheduled={refresh}
                    />
                    <MoreMenu label={t('procedure.moreFor', { title: procedure.title })} items={moreItems(procedure, false)} />
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
