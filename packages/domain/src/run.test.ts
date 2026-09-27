import { describe, expect, it } from 'vitest';
import { DomainValidationError, completionBlockers, normalizeOptionalReason, type StepState } from './index.ts';

const step = (required: boolean, state: StepState) => ({ required, state });

describe('completionBlockers', () => {
  it('blocks on required Steps that are PENDING or SKIPPED', () => {
    const steps = [step(true, 'DONE'), step(true, 'NOT_APPLICABLE'), step(true, 'PENDING'), step(true, 'SKIPPED')];
    expect(completionBlockers(steps)).toEqual([step(true, 'PENDING'), step(true, 'SKIPPED')]);
  });

  it('never blocks on optional Steps', () => {
    expect(completionBlockers([step(false, 'PENDING'), step(false, 'SKIPPED'), step(false, 'DONE')])).toEqual([]);
  });
});

describe('normalizeOptionalReason', () => {
  it('normalizes and bounds', () => {
    expect(normalizeOptionalReason(undefined)).toBeNull();
    expect(normalizeOptionalReason('  \n ')).toBeNull();
    expect(normalizeOptionalReason(' Power cut\r\n ')).toBe('Power cut');
    expect(() => normalizeOptionalReason('x'.repeat(501))).toThrow(DomainValidationError);
    expect(() => normalizeOptionalReason('a‮b')).toThrow(DomainValidationError);
  });
});
