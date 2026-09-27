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
  readonly startedAt: Date;
  /** Actor snapshot: internal id plus the display name at the time of starting. */
  readonly startedBy: { readonly userId: UserId; readonly displayName: string };
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
