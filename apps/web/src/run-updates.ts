import type { RunDetail, RunStep, StepState } from './api.ts';

/** A Step change sent to the server and not yet confirmed (optimistic UI, Step 6.2). */
export interface PendingStepChange {
  readonly from: StepState;
  readonly to: StepState;
}

function mapSteps(run: RunDetail, map: (step: RunStep) => RunStep): RunDetail {
  return { ...run, sections: run.sections.map((section) => ({ ...section, steps: section.steps.map(map) })) };
}

/**
 * Merges the server's answer to our own Step change. `stale` means the Run changed in between
 * (someone else's change we have not fetched yet): the Step is still taken over, but the revision
 * is kept so the gap is not hidden, and the caller must refetch the canonical Run.
 */
export function applyStepResult(run: RunDetail, step: RunStep, runRevision: number): { run: RunDetail; stale: boolean } {
  // Already contained in what we have (e.g. a refetch overtook the response).
  if (runRevision <= run.revision) return { run, stale: false };
  const merged = mapSteps(run, (current) => (current.id === step.id ? step : current));
  if (runRevision === run.revision + 1) return { run: { ...merged, revision: runRevision }, stale: false };
  return { run: merged, stale: true };
}

/** What the user sees: the canonical Run with not-yet-confirmed changes shown as their target state. */
export function withPendingChanges(run: RunDetail, pending: ReadonlyMap<string, PendingStepChange>): RunDetail {
  if (pending.size === 0) return run;
  return mapSteps(run, (step) => {
    const change = pending.get(step.id);
    return change === undefined ? step : { ...step, state: change.to };
  });
}

/** A change announced by the server that the shown Run does not contain yet. */
export function isNewer(run: RunDetail, revision: number): boolean {
  return revision > run.revision;
}
