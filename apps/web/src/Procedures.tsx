import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import {
  api,
  messageFor,
  type DeletedProcedure,
  type Procedure,
  type ProcedureContent,
  type ProcedureDetail,
  type ReasonPolicy,
} from './api.ts';
import { History } from './History.tsx';
import { KnotShare } from './Knots.tsx';
import { Icon } from './procedure-icons.tsx';
import { downloadJson, exportFileName, readImportFile } from './procedure-files.ts';
import { ProcedureForm } from './ProcedureForm.tsx';

const EMPTY: ProcedureContent = { title: '', description: '', icon: 'checklist', tags: [], sections: [] };

const REASON_TEXT: Record<ReasonPolicy, string> = {
  DISABLED: 'no reason',
  OPTIONAL: 'reason optional',
  REQUIRED: 'reason required',
};

function ProcedureView({ detail }: { detail: ProcedureDetail }) {
  return (
    <>
      <div className="card stack">
        <h2 id="procedure-title" style={{ margin: 0 }}>
          <Icon icon={detail.icon} /> {detail.title}
        </h2>
        {/* Plain text: React escapes it; line breaks are preserved by CSS only. */}
        {detail.description !== '' && <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{detail.description}</p>}
        {detail.tags.length > 0 && <p className="muted" style={{ margin: 0 }}>Tags: {detail.tags.join(', ')}</p>}
      </div>
      {detail.sections.length === 0 && <p className="muted">No Sections yet.</p>}
      {detail.sections.map((section) => (
        <section key={section.id} aria-label={`Section: ${section.title}`} className="card">
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
                <strong>{step.title}</strong> — {step.required ? 'Required' : 'Optional'}
                {step.critical && ', Critical'}
                <br />
                <small>
                  Skip: {REASON_TEXT[step.skipReasonPolicy]} · Not applicable: {REASON_TEXT[step.notApplicableReasonPolicy]}
                </small>
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
    if (!window.confirm(`Delete “${procedure.title}”? It can be restored later; past Runs stay readable.`)) return;
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
        <h2 id="procedures-heading">Procedures</h2>
        <span className="muted">Reusable checklists. Start a Run to work through one.</span>
      </div>
      {message !== null && <p role="alert">{message}</p>}

      {mode.kind === 'create' && (
        <ProcedureForm
          initial={EMPTY}
          submitLabel="Create Procedure"
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
          submitLabel="Save changes"
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
          <ProcedureView detail={shown} />
          <div className="card">
            <History key={`${shown.id}-${shown.revision}`} label="Procedure history" load={() => api.procedureHistory(workspaceId, shown.id)} />
          </div>
          {props.canManageKnots && (
            <div style={{ marginBottom: '1rem' }}>
              <KnotShare key={shown.id} workspaceId={workspaceId} target={{ type: 'PROCEDURE', id: shown.id }} defaultLabel={shown.title} />
            </div>
          )}
          <p className="row">
            <button type="button" onClick={() => setMode({ kind: 'list' })}>
              ← Back to all Procedures
            </button>{' '}
            {canStartRun && (
              <>
                <button type="button" className="primary" onClick={() => void startRun(shown)}>
                  ▶ Start Run
                </button>{' '}
              </>
            )}
            <button type="button" onClick={() => void exportProcedure(shown)}>
              Export as JSON
            </button>{' '}
            {canEdit && (
              <>
                <button type="button" onClick={() => setMode({ kind: 'edit', id: shown.id })}>
                  Edit
                </button>{' '}
                <button type="button" onClick={() => void runAction(() => api.duplicateProcedure(workspaceId, shown.id))}>
                  Duplicate
                </button>{' '}
                <button type="button" onClick={() => void remove(shown)}>
                  Delete
                </button>
              </>
            )}
          </p>
        </article>
      )}

      {(mode.kind === 'view' || mode.kind === 'edit') && shown === null && <p>Loading…</p>}

      {mode.kind === 'deleted' && (
        <section aria-labelledby="deleted-heading" className="card stack">
          <h3 id="deleted-heading" style={{ marginTop: 0 }}>
            Deleted Procedures
          </h3>
          {deleted === null ? (
            <p>Loading…</p>
          ) : deleted.length === 0 ? (
            <p>No deleted Procedures.</p>
          ) : (
            <ul aria-label="Deleted Procedures">
              {deleted.map((procedure) => (
                <li key={procedure.id}>
                  <Icon icon={procedure.icon} /> {procedure.title} — deleted by {procedure.deletedBy} on{' '}
                  {new Date(procedure.deletedAt).toLocaleString()}{' '}
                  <button type="button" onClick={() => void runAction(() => api.restoreProcedure(workspaceId, procedure.id))}>
                    Restore {procedure.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => setMode({ kind: 'list' })}>
            Back to all Procedures
          </button>
        </section>
      )}

      {mode.kind === 'list' && (
        <>
          {procedures === null ? (
            <p>Loading…</p>
          ) : procedures.length === 0 ? (
            <p>No Procedures yet.</p>
          ) : (
            <ul aria-label="Procedures" className="plain-list">
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
                New Procedure
              </button>{' '}
              <label>
                Import Procedure from JSON file{' '}
                <input type="file" accept="application/json,.json" onChange={(e) => void importFile(e)} />
              </label>
            </p>
          )}
          {canRestore && (
            <button type="button" onClick={showDeleted}>
              Show deleted Procedures
            </button>
          )}
        </>
      )}
    </section>
  );
}
