import { describe, expect, it } from 'vitest';
import { ApiError, type RunDetail, type RunStep } from '../api.ts';
import { dependents, expectedStateFor, outcomeOf, withQueuedChanges, type QueuedChange } from './queue.ts';

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
  state,
  stateChange: state === 'PENDING' ? null : { by: 'Uma', at: '2026-09-28T10:00:00Z', reason: null },
});
const run = (steps: RunStep[]): RunDetail =>
  ({ id: 'run-1', revision: 3, state: 'ACTIVE', sections: [{ id: 's', title: 'All', description: '', steps }] }) as unknown as RunDetail;
const queued = (seq: number, stepId: string, expectedState: RunStep['state'], to: RunStep['state'], runId = 'run-1'): QueuedChange => ({
  clientChangeId: `id-${seq}`,
  userId: 'u',
  workspaceId: 'w',
  runId,
  stepId,
  stepTitle: stepId,
  expectedState,
  to,
  deviceTime: '2026-09-28T10:00:00Z',
  seq,
});

describe('offline queue (8.5)', () => {
  it('chains changes of one Step: each starts from the previous queued target', () => {
    const router = step('router');
    expect(expectedStateFor(router, [])).toBe('PENDING');
    const first = queued(1, 'router', 'PENDING', 'DONE');
    expect(expectedStateFor(router, [first])).toBe('DONE');
    expect(expectedStateFor(router, [first, queued(2, 'router', 'DONE', 'PENDING')])).toBe('PENDING');
    expect(expectedStateFor(step('door'), [first])).toBe('PENDING');
  });

  it('shows queued targets for this Run only, without a server attribution', () => {
    const shown = withQueuedChanges(run([step('router'), step('door', 'DONE')]), [
      queued(1, 'router', 'PENDING', 'DONE'),
      queued(2, 'door', 'DONE', 'PENDING'),
      queued(3, 'router', 'PENDING', 'SKIPPED', 'other-run'),
    ]);
    const [router, door] = shown.sections[0]?.steps ?? [];
    expect(router).toMatchObject({ state: 'DONE', stateChange: null });
    expect(door).toMatchObject({ state: 'PENDING', stateChange: null });
    expect(shown.revision).toBe(3);
  });

  it('decides per answer: sent, refused for good, sign in again, or retry later', () => {
    expect(outcomeOf(undefined)).toBe('sent');
    expect(outcomeOf(new TypeError('Failed to fetch'))).toBe('retry');
    expect(outcomeOf(new ApiError(503, 'x'))).toBe('retry');
    expect(outcomeOf(new ApiError(429, 'rate_limited'))).toBe('retry');
    expect(outcomeOf(new ApiError(401, 'unauthenticated'))).toBe('sign-in');
    // Another account's session: kept for its own account, never dropped or re-sent as someone else (13.1).
    expect(outcomeOf(new ApiError(409, 'offline_account_mismatch'))).toBe('sign-in');
    for (const [status, code] of [[409, 'step_conflict'], [409, 'run_not_active'], [403, 'forbidden'], [404, 'run_not_found'], [400, 'reason_required']] as const) {
      expect(outcomeOf(new ApiError(status, code))).toBe('rejected');
    }
  });

  it('drops later changes of a Step whose earlier change was refused', () => {
    const list = [queued(1, 'router', 'PENDING', 'DONE'), queued(2, 'door', 'PENDING', 'DONE'), queued(3, 'router', 'DONE', 'PENDING')];
    expect(dependents(list, list[0] as QueuedChange).map((change) => change.seq)).toEqual([3]);
    expect(dependents(list, list[1] as QueuedChange)).toEqual([]);
  });
});
