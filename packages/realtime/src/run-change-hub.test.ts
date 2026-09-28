import type { RunChange, RunId, WorkspaceId } from '@vergissmeinnicht/domain';
import { describe, expect, it } from 'vitest';
import { createRunChangeHub } from './run-change-hub.ts';

const RUN_A = '0b7d4a53-7f0e-4c7a-9a55-3c1f2d9e8a01' as RunId;
const RUN_B = '4c2e8f1a-9b3d-4e6f-8a7c-5d1e2f3a4b02' as RunId;

const change = (runId: RunId, revision: number): RunChange => ({
  workspaceId: 'ws' as WorkspaceId,
  runId,
  revision,
  kind: 'STEP_STATE_CHANGED',
  stepId: null,
  by: 'Uma',
  at: new Date(0),
});

describe('run change hub', () => {
  it('delivers changes only to subscribers of that Run', () => {
    const hub = createRunChangeHub();
    const a: number[] = [];
    const b: number[] = [];
    hub.subscribe(RUN_A, 'u1', (c) => a.push(c.revision));
    hub.subscribe(RUN_B, 'u2', (c) => b.push(c.revision));
    hub.runChanged(change(RUN_A, 2));
    hub.runChanged(change(RUN_B, 5));
    expect(a).toEqual([2]);
    expect(b).toEqual([5]);
  });

  it('stops delivering after unsubscribe and frees the slot once', () => {
    const hub = createRunChangeHub({ maxSubscriptions: 1, maxSubscriptionsPerUser: 1 });
    const seen: number[] = [];
    const subscription = hub.subscribe(RUN_A, 'u1', (c) => seen.push(c.revision));
    expect(hub.subscribe(RUN_A, 'u2', () => undefined)).toBeUndefined();
    subscription?.unsubscribe();
    subscription?.unsubscribe();
    expect(hub.size()).toBe(0);
    hub.runChanged(change(RUN_A, 2));
    expect(seen).toEqual([]);
    expect(hub.subscribe(RUN_A, 'u2', () => undefined)).toBeDefined();
  });

  it('enforces per-user and total limits', () => {
    const hub = createRunChangeHub({ maxSubscriptions: 3, maxSubscriptionsPerUser: 2 });
    expect(hub.subscribe(RUN_A, 'u1', () => undefined)).toBeDefined();
    expect(hub.subscribe(RUN_B, 'u1', () => undefined)).toBeDefined();
    expect(hub.subscribe(RUN_A, 'u1', () => undefined)).toBeUndefined();
    expect(hub.subscribe(RUN_A, 'u2', () => undefined)).toBeDefined();
    expect(hub.subscribe(RUN_A, 'u3', () => undefined)).toBeUndefined();
    expect(hub.size()).toBe(3);
  });

  it('isolates failing listeners and tolerates unsubscribing during delivery', () => {
    const hub = createRunChangeHub();
    const seen: string[] = [];
    hub.subscribe(RUN_A, 'u1', () => {
      throw new Error('broken client');
    });
    const self = hub.subscribe(RUN_A, 'u2', () => {
      seen.push('u2');
      self?.unsubscribe();
    });
    hub.subscribe(RUN_A, 'u3', () => seen.push('u3'));
    expect(() => hub.runChanged(change(RUN_A, 2))).not.toThrow();
    hub.runChanged(change(RUN_A, 3));
    expect(seen).toEqual(['u2', 'u3', 'u3']);
  });
});
