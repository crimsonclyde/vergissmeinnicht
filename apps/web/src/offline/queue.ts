import { ApiError, type RunDetail, type RunStep, type StepState } from '../api.ts';

/**
 * A Step change made while offline (Step 8.5), kept on this device until the server accepted or
 * refused it. `clientChangeId` makes a repeated send harmless; `deviceTime` is informational only.
 */
export interface QueuedChange {
  readonly clientChangeId: string;
  /** Only ever sent with this user's session (never under another account). */
  readonly userId: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly stepId: string;
  /** For notices when the change could not be applied. */
  readonly stepTitle: string;
  readonly expectedState: StepState;
  readonly to: StepState;
  readonly reason?: string | undefined;
  readonly deviceTime: string;
  /** Order of creation; changes are sent strictly in this order. */
  readonly seq: number;
}

/** The state a new change of this Step starts from: the last queued target, else the shown state. */
export function expectedStateFor(step: RunStep, queued: readonly QueuedChange[]): StepState {
  const last = queued.filter((change) => change.stepId === step.id).at(-1);
  return last?.to ?? step.state;
}

/** What the user sees offline: the saved Run with its queued changes applied, in order. */
export function withQueuedChanges(run: RunDetail, queued: readonly QueuedChange[]): RunDetail {
  const mine = queued.filter((change) => change.runId === run.id);
  if (mine.length === 0) return run;
  const latest = new Map<string, QueuedChange>();
  for (const change of mine) latest.set(change.stepId, change);
  return {
    ...run,
    sections: run.sections.map((section) => ({
      ...section,
      steps: section.steps.map((step) => {
        const change = latest.get(step.id);
        return change === undefined ? step : { ...step, state: change.to, stateChange: null };
      }),
    })),
  };
}

/**
 * What to do after sending one queued change:
 * - `sent`: accepted (or already applied earlier) — remove it;
 * - `rejected`: the server refused it for good (someone changed the Step, the Run ended, no
 *   permission, invalid) — remove it and tell the user; later changes of the same Step go too;
 * - `sign-in`: the session is gone — keep everything and ask the user to sign in again;
 * - `retry`: still offline or the server is unreachable — keep everything and try later.
 */
export type SendOutcome = 'sent' | 'rejected' | 'sign-in' | 'retry';

export function outcomeOf(error: unknown): SendOutcome {
  if (error === undefined) return 'sent';
  if (!(error instanceof ApiError)) return 'retry';
  if (error.status === 401) return 'sign-in';
  if (error.status === 429 || error.status >= 500) return 'retry';
  return 'rejected';
}

/** Changes that depend on a rejected one (same Step, created later) cannot apply either. */
export function dependents(queued: readonly QueuedChange[], rejected: QueuedChange): QueuedChange[] {
  return queued.filter((change) => change.stepId === rejected.stepId && change.seq > rejected.seq);
}
