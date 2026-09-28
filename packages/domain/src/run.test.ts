import { describe, expect, it } from 'vitest';
import { DomainValidationError, completionBlockers, normalizeOptionalReason, plausibleDeviceTime, type StepState } from './index.ts';

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

describe('plausibleDeviceTime (offline changes, 8.5)', () => {
  const run = { startedAt: new Date('2026-09-28T08:00:00Z') };
  const now = new Date('2026-09-28T10:00:00Z');
  const at = (iso: string) => plausibleDeviceTime(new Date(iso), run, now)?.toISOString() ?? null;

  it('keeps device times between the Run start and the server time', () => {
    expect(at('2026-09-28T09:15:00Z')).toBe('2026-09-28T09:15:00.000Z');
    expect(at('2026-09-28T08:00:00Z')).toBe('2026-09-28T08:00:00.000Z');
  });

  it('caps a slightly fast device clock at the server time', () => {
    expect(at('2026-09-28T10:01:00Z')).toBe('2026-09-28T10:00:00.000Z');
  });

  it('drops implausible device times', () => {
    expect(at('2026-09-28T07:59:59Z')).toBeNull(); // before the Run started
    expect(at('2026-09-28T10:03:00Z')).toBeNull(); // far in the future
    expect(plausibleDeviceTime(new Date('invalid'), run, now)).toBeNull();
    const old = { startedAt: new Date('2026-09-01T00:00:00Z') };
    expect(plausibleDeviceTime(new Date('2026-09-20T00:00:00Z'), old, now)).toBeNull(); // older than a week
  });
});
