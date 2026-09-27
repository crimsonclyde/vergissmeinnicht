import { useCallback, useEffect, useState } from 'react';
import { api, messageFor, type RunDetail, type RunState, type RunSummary, type StepState } from './api.ts';
import { Icon } from './procedure-icons.tsx';

/** Text (and a glyph) for every state: color is never the only indicator. */
const STEP_STATE_LABELS: Record<StepState, { glyph: string; label: string }> = {
  PENDING: { glyph: '○', label: 'Pending' },
  DONE: { glyph: '✔', label: 'Done' },
  SKIPPED: { glyph: '↷', label: 'Skipped' },
  NOT_APPLICABLE: { glyph: '–', label: 'Not applicable' },
};
const RUN_STATE_LABELS: Record<RunState, string> = { ACTIVE: 'Active', COMPLETED: 'Completed', ABORTED: 'Aborted' };

function progress(summary: RunSummary): string {
  const total = Object.values(summary.stepCounts).reduce((sum, n) => sum + n, 0);
  return `${total - summary.stepCounts.PENDING} of ${total} Steps resolved`;
}

function RunView({ run }: { run: RunDetail }) {
  return (
    <article aria-labelledby="run-title">
      <h5 id="run-title">
        <Icon icon={run.icon} /> {run.title}
      </h5>
      <p>
        {RUN_STATE_LABELS[run.state]} · started by {run.startedBy} on {new Date(run.startedAt).toLocaleString()} (Procedure
        revision {run.procedureRevision})
      </p>
      {run.description !== '' && <p style={{ whiteSpace: 'pre-wrap' }}>{run.description}</p>}
      {run.sections.map((section) => (
        <section key={section.id} aria-label={`Run section: ${section.title}`}>
          <h6>{section.title}</h6>
          <ol>
            {section.steps.map((step) => (
              <li key={step.id}>
                <span aria-hidden="true">{STEP_STATE_LABELS[step.state].glyph}</span> <strong>{step.title}</strong> —{' '}
                {STEP_STATE_LABELS[step.state].label}
                {step.required ? '' : ' (optional)'}
                {step.critical && ', critical'}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </article>
  );
}

/** Runs of a Workspace. `openRunId` is controlled by the parent so other sections can open a Run. */
export function Runs(props: { workspaceId: string; openRunId: string | null; onOpen: (runId: string | null) => void }) {
  const { workspaceId, openRunId, onOpen } = props;
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.runs(workspaceId).then(setRuns, (caught: unknown) => setMessage(messageFor(caught)));
  }, [workspaceId]);
  useEffect(refresh, [refresh, openRunId]);

  useEffect(() => {
    if (openRunId === null) return;
    let active = true;
    api.run(workspaceId, openRunId).then(
      (loaded) => active && setDetail(loaded),
      (caught: unknown) => active && setMessage(messageFor(caught)),
    );
    return () => {
      active = false;
    };
  }, [workspaceId, openRunId]);

  const shown = detail !== null && detail.id === openRunId ? detail : null;

  return (
    <section aria-labelledby="runs-heading">
      <h4 id="runs-heading">Runs</h4>
      {message !== null && <p role="alert">{message}</p>}
      {openRunId !== null ? (
        <>
          {shown === null ? <p>Loading…</p> : <RunView run={shown} />}
          <button type="button" onClick={() => onOpen(null)}>
            Back to all Runs
          </button>
        </>
      ) : runs === null ? (
        <p>Loading…</p>
      ) : runs.length === 0 ? (
        <p>No Runs yet.</p>
      ) : (
        <ul aria-label="Runs">
          {runs.map((run) => (
            <li key={run.id}>
              <button type="button" onClick={() => onOpen(run.id)}>
                <Icon icon={run.icon} /> {run.title}
              </button>{' '}
              — {RUN_STATE_LABELS[run.state]}, {progress(run)}, started by {run.startedBy} on {new Date(run.startedAt).toLocaleString()}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
