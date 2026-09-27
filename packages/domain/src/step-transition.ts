import { DomainValidationError } from './errors.ts';
import type { ReasonPolicy } from './procedure-structure.ts';
import type { StepState } from './states.ts';
import { BIDI_CONTROLS, CONTROL_CHARS } from './text.ts';

/**
 * Step state machine. A PENDING Step can be resolved as DONE, SKIPPED or NOT_APPLICABLE; any resolved
 * Step can be undone back to PENDING. Changing between two resolved states takes an undo first, so
 * every change is an explicit, separately audited event.
 */
export function canTransitionStep(from: StepState, to: StepState): boolean {
  if (from === to) return false;
  return from === 'PENDING' || to === 'PENDING';
}

export const MAX_STEP_REASON_LENGTH = 500;

// Line feed and tab are the only control characters a reason may contain.
const DISALLOWED_IN_REASON = new RegExp(`(?![\\n\\t])${CONTROL_CHARS.source}`, 'u');

/** Which reason policy applies to entering `to`; DONE and PENDING never take a reason. */
function policyFor(step: StepPolicies, to: StepState): ReasonPolicy {
  if (to === 'SKIPPED') return step.skipReasonPolicy;
  if (to === 'NOT_APPLICABLE') return step.notApplicableReasonPolicy;
  return 'DISABLED';
}

export interface StepPolicies {
  readonly skipReasonPolicy: ReasonPolicy;
  readonly notApplicableReasonPolicy: ReasonPolicy;
}

/**
 * Validates a requested transition against the Step's snapshotted policies and returns the
 * normalized reason (`null` when none). Whitespace-only reasons count as no reason.
 */
export function validateStepTransition(
  step: StepPolicies & { readonly state: StepState },
  to: StepState,
  reasonInput: string | undefined,
): { readonly reason: string | null } {
  if (!canTransitionStep(step.state, to)) {
    throw new DomainValidationError('state', 'invalid_transition', 'This state change is not allowed');
  }
  const reason = reasonInput?.replace(/\r\n?/g, '\n').normalize('NFC').trim() ?? '';
  const policy = policyFor(step, to);
  if (reason === '') {
    if (policy === 'REQUIRED') throw new DomainValidationError('reason', 'reason_required', 'A reason is required');
    return { reason: null };
  }
  if (policy === 'DISABLED') {
    throw new DomainValidationError('reason', 'reason_not_allowed', 'This state change does not take a reason');
  }
  if ([...reason].length > MAX_STEP_REASON_LENGTH) {
    throw new DomainValidationError('reason', 'reason_too_long', 'The reason is too long');
  }
  if (DISALLOWED_IN_REASON.test(reason) || BIDI_CONTROLS.test(reason)) {
    throw new DomainValidationError('reason', 'reason_invalid_characters', 'The reason contains control characters');
  }
  return { reason };
}
