import { describe, expect, it } from 'vitest';
import type { RunDetail, RunStep } from './api.ts';
import { applyStepResult, isNewer, withPendingChanges } from './run-updates.ts';

const step = (id: string, state: RunStep['state'] = 'PENDING'): RunStep => ({
  id,
  kind: 'CHECK',
  title: id,
  description: '',
  icon: null,
  required: true,
  critical: false,
  skipReasonPolicy: 'OPTIONAL',
  notApplicableReasonPolicy: 'OPTIONAL',
  image: null,
  state,
  stateChange: null,
});

const run = (revision: number, steps: RunStep[]): RunDetail => ({
  id: 'r',
  procedureId: 'p',
  procedureRevision: 1,
  title: 'Run',
  description: '',
  icon: 'home',
  tags: [],
  state: 'ACTIVE',
  revision,
  startedAt: '2026-09-27T10:00:00.000Z',
  startedBy: 'Uma',
  ended: null,
  sections: [{ id: 's', title: 'S', description: '', steps }],
});

const states = (detail: RunDetail) => detail.sections.flatMap((section) => section.steps.map((s) => s.state));

describe('run updates', () => {
  it('applies the next revision directly', () => {
    const result = applyStepResult(run(3, [step('a'), step('b')]), step('a', 'DONE'), 4);
    expect(result.stale).toBe(false);
    expect(result.run.revision).toBe(4);
    expect(states(result.run)).toEqual(['DONE', 'PENDING']);
  });

  it('keeps the revision and asks for a refetch when a change in between is missing', () => {
    const result = applyStepResult(run(3, [step('a'), step('b')]), step('a', 'DONE'), 5);
    expect(result.stale).toBe(true);
    expect(result.run.revision).toBe(3);
    expect(states(result.run)).toEqual(['DONE', 'PENDING']);
    // A later event for revision 4 or 5 is therefore still recognized as new.
    expect(isNewer(result.run, 4)).toBe(true);
  });

  it('ignores answers that a refetch already overtook', () => {
    const current = run(6, [step('a', 'PENDING')]);
    expect(applyStepResult(current, step('a', 'DONE'), 5)).toEqual({ run: current, stale: false });
    expect(isNewer(current, 6)).toBe(false);
  });

  it('shows pending changes over the canonical state without changing it', () => {
    const canonical = run(1, [step('a'), step('b', 'DONE')]);
    const shown = withPendingChanges(canonical, new Map([['b', { from: 'DONE', to: 'PENDING' }], ['a', { from: 'PENDING', to: 'SKIPPED' }]]));
    expect(states(shown)).toEqual(['SKIPPED', 'PENDING']);
    expect(states(canonical)).toEqual(['PENDING', 'DONE']);
    expect(withPendingChanges(canonical, new Map())).toBe(canonical);
  });
});
