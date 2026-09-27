import { describe, expect, it } from 'vitest';
import { DomainValidationError, STEP_STATES, canTransitionStep, validateStepTransition, type StepState } from './index.ts';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof DomainValidationError) return error.code;
    throw error;
  }
  throw new Error('expected a DomainValidationError');
}

const step = (state: StepState, skip = 'OPTIONAL', na = 'OPTIONAL') =>
  ({ state, skipReasonPolicy: skip, notApplicableReasonPolicy: na }) as const as Parameters<typeof validateStepTransition>[0];

describe('canTransitionStep', () => {
  it('allows resolving a pending Step and undoing a resolved one, nothing else', () => {
    const allowed = STEP_STATES.flatMap((from) => STEP_STATES.filter((to) => canTransitionStep(from, to)).map((to) => `${from}->${to}`));
    expect(allowed.sort()).toEqual(
      [
        'PENDING->DONE',
        'PENDING->SKIPPED',
        'PENDING->NOT_APPLICABLE',
        'DONE->PENDING',
        'SKIPPED->PENDING',
        'NOT_APPLICABLE->PENDING',
      ].sort(),
    );
  });
});

describe('validateStepTransition', () => {
  it('rejects disallowed transitions', () => {
    expect(codeOf(() => validateStepTransition(step('PENDING'), 'PENDING', undefined))).toBe('invalid_transition');
    expect(codeOf(() => validateStepTransition(step('DONE'), 'SKIPPED', 'x'))).toBe('invalid_transition');
  });

  it('never takes a reason for DONE or undo', () => {
    expect(validateStepTransition(step('PENDING'), 'DONE', undefined)).toEqual({ reason: null });
    expect(validateStepTransition(step('PENDING'), 'DONE', '   ')).toEqual({ reason: null });
    expect(codeOf(() => validateStepTransition(step('PENDING'), 'DONE', 'because'))).toBe('reason_not_allowed');
    expect(codeOf(() => validateStepTransition(step('SKIPPED'), 'PENDING', 'because'))).toBe('reason_not_allowed');
  });

  it('applies the Skip and Not Applicable policies separately', () => {
    const s = step('PENDING', 'REQUIRED', 'DISABLED');
    expect(codeOf(() => validateStepTransition(s, 'SKIPPED', undefined))).toBe('reason_required');
    expect(codeOf(() => validateStepTransition(s, 'SKIPPED', ' \n '))).toBe('reason_required');
    expect(validateStepTransition(s, 'SKIPPED', '  No time today\r\n ')).toEqual({ reason: 'No time today' });
    expect(validateStepTransition(s, 'NOT_APPLICABLE', undefined)).toEqual({ reason: null });
    expect(codeOf(() => validateStepTransition(s, 'NOT_APPLICABLE', 'no stove here'))).toBe('reason_not_allowed');
    const optional = step('PENDING', 'OPTIONAL', 'OPTIONAL');
    expect(validateStepTransition(optional, 'SKIPPED', undefined)).toEqual({ reason: null });
    expect(validateStepTransition(optional, 'NOT_APPLICABLE', 'Line 1\nLine 2')).toEqual({ reason: 'Line 1\nLine 2' });
  });

  it('bounds and sanitizes reasons', () => {
    const s = step('PENDING');
    expect(validateStepTransition(s, 'SKIPPED', 'é'.repeat(500)).reason).toHaveLength(500);
    expect(codeOf(() => validateStepTransition(s, 'SKIPPED', 'x'.repeat(501)))).toBe('reason_too_long');
    expect(codeOf(() => validateStepTransition(s, 'SKIPPED', 'bell\u0007'))).toBe('reason_invalid_characters');
    expect(codeOf(() => validateStepTransition(s, 'SKIPPED', 'rtl‮text'))).toBe('reason_invalid_characters');
  });
});
