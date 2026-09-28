import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import {
  api,
  messageFor,
  type DeletedProcedure,
  type Procedure,
  type ProcedureContent,
  type ProcedureDetail,
} from './api.ts';
import { History } from './History.tsx';
import { formatDateTime, t } from './i18n/index.ts';
import { KnotShare } from './Knots.tsx';
import { StepMarks } from './StepMarks.tsx';
import { Icon } from './procedure-icons.tsx';
import { downloadJson, exportFileName, readImportFile } from './procedure-files.ts';
import { ProcedureForm } from './ProcedureForm.tsx';

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
  | { kind: 'view'; id: string }
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
  onRunStarted: (runId: string) => void;
}) {
  const { workspaceId, canEdit, canRestore, canStartRun, onRunStarted } = props;
  const [procedures, setProcedures] = useState<Procedure[] | null>(null);
  const [deleted, setDeleted] = useState<DeletedProcedure[] | null>(null);
  const [detail, setDetail] = useState<ProcedureDetail | null>(null);
  const [mode, setMode] = useState<Mode>(props.openProcedureId === null ? { kind: 'list' } : { kind: 'view', id: props.openProcedureId });
  const [message, setMessage] = useState<string | null>(null);

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

  function open(id: string) {
    setMessage(null);
    setMode({ kind: 'view', id });
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

  async function exportProcedure(procedure: ProcedureDetail) {
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

  function showDeleted() {
    setMessage(null);
    setDeleted(null);
    setMode({ kind: 'deleted' });
    api.deletedProcedures(workspaceId).then(setDeleted, (caught: unknown) => setMessage(messageFor(caught)));
  }

  async function startRun(procedure: ProcedureDetail) {
    setMessage(null);
    try {
      const run = await api.startRun(workspaceId, procedure.id);
      setMode({ kind: 'list' });
      onRunStarted(run.id);
    } catch (caught) {
      setMessage(messageFor(caught));
    }
  }

  async function remove(procedure: ProcedureDetail) {
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

  return (
    <section aria-labelledby="procedures-heading">
      <div className="page-header">
        <h2 id="procedures-heading">{t('procedures.heading')}</h2>
      </div>
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
          <ProcedureView detail={shown} />
          <p className="row">
            {canStartRun && (
              <button type="button" className="primary" onClick={() => void startRun(shown)}>
                {t('procedure.startRun')}
              </button>
            )}
            {canEdit && (
              <button type="button" onClick={() => setMode({ kind: 'edit', id: shown.id })}>
                {t('procedure.edit')}
              </button>
            )}
          </p>
          <details className="more-actions">
            <summary>{t('procedure.more')}</summary>
            <div className="row">
              <button type="button" onClick={() => void exportProcedure(shown)}>
                {t('procedure.export')}
              </button>
              {canEdit && (
                <>
                  <button type="button" onClick={() => void runAction(() => api.duplicateProcedure(workspaceId, shown.id))}>
                    {t('procedure.duplicate')}
                  </button>
                  <button type="button" onClick={() => void remove(shown)}>
                    {t('procedure.delete')}
                  </button>
                </>
              )}
            </div>
            {props.canManageKnots && (
              <KnotShare key={shown.id} workspaceId={workspaceId} target={{ type: 'PROCEDURE', id: shown.id }} defaultLabel={shown.title} />
            )}
          </details>
          <div className="card">
            <History key={`${shown.id}-${shown.revision}`} label={t('procedure.historyLabel')} load={(after) => api.procedureHistory(workspaceId, shown.id, after)} />
          </div>
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
                  {t('procedures.deletedBy', { name: procedure.deletedBy, time: formatDateTime(procedure.deletedAt) })}
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

      {mode.kind === 'list' && (
        <>
          {procedures === null ? (
            <p>{t('common.loading')}</p>
          ) : procedures.length === 0 ? (
            <p className="card">{t(canEdit ? 'procedures.noneHint' : 'procedures.none')}</p>
          ) : (
            <ul aria-label={t('procedures.heading')} className="plain-list">
              {procedures.map((procedure) => (
                <li key={procedure.id} className="card row" style={{ justifyContent: 'space-between' }}>
                  <button type="button" className="link-like" style={{ fontSize: '1.1rem', fontWeight: 600 }} onClick={() => open(procedure.id)}>
                    <Icon icon={procedure.icon} /> {procedure.title}
                  </button>
                  {procedure.tags.length > 0 && <span className="muted">{procedure.tags.join(', ')}</span>}
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <p className="row" style={{ marginTop: '1rem' }}>
              <button type="button" className="primary" onClick={() => setMode({ kind: 'create' })}>
                {t('procedures.new')}
              </button>{' '}
              <label>
                {t('procedures.import')}{' '}
                <input type="file" accept="application/json,.json" onChange={(e) => void importFile(e)} />
              </label>
            </p>
          )}
          {canRestore && (
            <button type="button" onClick={showDeleted}>
              {t('procedures.showDeleted')}
            </button>
          )}
        </>
      )}
    </section>
  );
}
