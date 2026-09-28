import { DomainValidationError } from './errors.ts';
import type { ProcedureIcon, ProcedureId } from './procedure.ts';
import type { ReasonPolicy, StepKind } from './procedure-structure.ts';
import type { RunState, StepState } from './states.ts';
import { UUID_V4, type UserId } from './user.ts';
import type { WorkspaceId } from './workspace.ts';

/**
 * A Run is a historical execution of a Procedure. Starting it snapshots the Procedure's definition
 * (title, Sections, Steps with all flags and policies) so the Run stays readable and truthful after
 * the Procedure is edited, restructured or deleted. Several Runs of one Procedure may be active.
 */
export type RunId = string & { readonly __brand: 'RunId' };
export type RunSectionId = string & { readonly __brand: 'RunSectionId' };
export type RunStepId = string & { readonly __brand: 'RunStepId' };

export function parseRunStepId(value: string): RunStepId {
  if (!UUID_V4.test(value)) {
    throw new DomainValidationError('stepId', 'invalid_step_id', 'Step id must be a lower-case UUIDv4');
  }
  return value as RunStepId;
}

export interface Run {
  readonly id: RunId;
  readonly workspaceId: WorkspaceId;
  /** The Procedure it was started from (may since have changed or been deleted). */
  readonly procedureId: ProcedureId;
  /** The Procedure revision that was snapshotted. */
  readonly procedureRevision: number;
  readonly title: string;
  readonly description: string;
  readonly icon: ProcedureIcon;
  readonly tags: readonly string[];
  readonly state: RunState;
  /** Increases with every change of the Run or one of its Steps; clients use it to detect missed updates. */
  readonly revision: number;
  readonly startedAt: Date;
  /** Actor snapshot: internal id plus the display name at the time of starting. */
  readonly startedBy: { readonly userId: UserId; readonly displayName: string };
  /** How the Run ended; `null` while ACTIVE. */
  readonly ended: RunEnd | null;
}

export interface RunEnd {
  readonly at: Date;
  readonly by: { readonly userId: UserId; readonly displayName: string };
  /** Optional reason, only for ABORTED. */
  readonly reason: string | null;
}

/** States that satisfy a required Step for completion. SKIPPED does not: it was applicable but not done. */
const SATISFIES_REQUIRED: readonly StepState[] = ['DONE', 'NOT_APPLICABLE'];

/**
 * Required Steps that prevent completing the Run. Optional Steps never block (any state, even
 * PENDING, is acceptable for them).
 */
export function completionBlockers<T extends Pick<RunStep, 'required' | 'state'>>(steps: readonly T[]): T[] {
  return steps.filter((step) => step.required && !SATISFIES_REQUIRED.includes(step.state));
}

export interface RunStep {
  readonly id: RunStepId;
  readonly kind: StepKind;
  readonly title: string;
  readonly description: string;
  readonly icon: ProcedureIcon | null;
  readonly required: boolean;
  readonly critical: boolean;
  readonly skipReasonPolicy: ReasonPolicy;
  readonly notApplicableReasonPolicy: ReasonPolicy;
  readonly state: StepState;
  /** Who set the current state, when, and why (reason only for SKIPPED / NOT_APPLICABLE). `null` = never changed. */
  readonly stateChange: StepStateChange | null;
}

export interface StepStateChange {
  readonly by: { readonly userId: UserId; readonly displayName: string };
  /** Server time: when the server accepted the change (authoritative). */
  readonly at: Date;
  readonly reason: string | null;
  /** Device clock of a change made offline and sent later (8.5); reported by the client, never authoritative. */
  readonly deviceAt: Date | null;
}

/** How far a device clock may run ahead of the server clock and still be believed. */
export const DEVICE_CLOCK_AHEAD_TOLERANCE_MS = 2 * 60_000;
/** Offline changes older than this keep only the server time. */
export const MAX_OFFLINE_AGE_MS = 7 * 24 * 60 * 60_000;

/**
 * Whether a device time reported for an offline change is plausible (Step 8.5): not before the Run
 * started, not (much) after the server received it, and not older than a week. Implausible values
 * are dropped — the change itself still counts, with the server time only.
 */
export function plausibleDeviceTime(deviceAt: Date, run: { readonly startedAt: Date }, serverNow: Date): Date | null {
  const at = deviceAt.getTime();
  if (!Number.isFinite(at)) return null;
  if (at < run.startedAt.getTime()) return null;
  if (at > serverNow.getTime() + DEVICE_CLOCK_AHEAD_TOLERANCE_MS) return null;
  if (serverNow.getTime() - at > MAX_OFFLINE_AGE_MS) return null;
  // Never later than the server time it is shown next to.
  return at > serverNow.getTime() ? serverNow : deviceAt;
}

export interface RunSection {
  readonly id: RunSectionId;
  readonly title: string;
  readonly description: string;
  readonly steps: readonly RunStep[];
}

export interface RunDetail {
  readonly run: Run;
  readonly sections: readonly RunSection[];
}

/** List entry: the Run plus how many of its Steps are in each state. */
export interface RunSummary {
  readonly run: Run;
  readonly stepCounts: Readonly<Record<StepState, number>>;
}

export function parseRunId(value: string): RunId {
  if (!UUID_V4.test(value)) {
    throw new DomainValidationError('runId', 'invalid_run_id', 'Run id must be a lower-case UUIDv4');
  }
  return value as RunId;
}

/**
 * Notification that a Run changed, emitted after the change is committed. It names the new
 * revision and who changed what, but is never the source of truth: receivers refetch the Run.
 */
export interface RunChange {
  readonly workspaceId: WorkspaceId;
  readonly runId: RunId;
  readonly revision: number;
  readonly kind: 'STEP_STATE_CHANGED' | 'RUN_COMPLETED' | 'RUN_ABORTED';
  /** The changed Step for STEP_STATE_CHANGED, otherwise `null`. */
  readonly stepId: RunStepId | null;
  /** Display-name snapshot of the actor (no internal user id). */
  readonly by: string;
  readonly at: Date;
}
