import { useCallback, useEffect, useState } from 'react';
import { api, messageFor, type Procedure, type ProcedureContent, type ProcedureDetail, type ReasonPolicy } from './api.ts';
import { Icon } from './procedure-icons.tsx';
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
      <h5 id="procedure-title">
        <Icon icon={detail.icon} /> {detail.title}
      </h5>
      {/* Plain text: React escapes it; line breaks are preserved by CSS only. */}
      {detail.description !== '' && <p style={{ whiteSpace: 'pre-wrap' }}>{detail.description}</p>}
      {detail.tags.length > 0 && <p>Tags: {detail.tags.join(', ')}</p>}
      {detail.sections.length === 0 && <p>No Sections yet.</p>}
      {detail.sections.map((section) => (
        <section key={section.id} aria-label={`Section: ${section.title}`}>
          <h6>{section.title}</h6>
          {section.description !== '' && <p style={{ whiteSpace: 'pre-wrap' }}>{section.description}</p>}
          <ol>
            {section.steps.map((step) => (
              <li key={step.id}>
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

type Mode = { kind: 'list' } | { kind: 'create' } | { kind: 'view'; id: string } | { kind: 'edit'; id: string };

/** Capabilities only adapt the UI; the server authorizes every request. */
export function Procedures({ workspaceId, canEdit }: { workspaceId: string; canEdit: boolean }) {
  const [procedures, setProcedures] = useState<Procedure[] | null>(null);
  const [detail, setDetail] = useState<ProcedureDetail | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
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

  async function remove(procedure: ProcedureDetail) {
    if (!window.confirm(`Delete “${procedure.title}”? Past Runs stay readable.`)) return;
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
      <h4 id="procedures-heading">Procedures</h4>
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
          <p>
            <button type="button" onClick={() => setMode({ kind: 'list' })}>
              Back to all Procedures
            </button>{' '}
            {canEdit && (
              <>
                <button type="button" onClick={() => setMode({ kind: 'edit', id: shown.id })}>
                  Edit
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

      {mode.kind === 'list' && (
        <>
          {procedures === null ? (
            <p>Loading…</p>
          ) : procedures.length === 0 ? (
            <p>No Procedures yet.</p>
          ) : (
            <ul aria-label="Procedures">
              {procedures.map((procedure) => (
                <li key={procedure.id}>
                  <button type="button" onClick={() => open(procedure.id)}>
                    <Icon icon={procedure.icon} /> {procedure.title}
                  </button>
                  {procedure.tags.length > 0 && <> ({procedure.tags.join(', ')})</>}
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <button type="button" onClick={() => setMode({ kind: 'create' })}>
              New Procedure
            </button>
          )}
        </>
      )}
    </section>
  );
}
