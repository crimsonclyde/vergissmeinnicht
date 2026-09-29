import { describe, expect, it } from 'vitest';
import type { HistoryEvent } from './api.ts';
import { describeEvent } from './History.tsx';

const event = (type: string, metadata: HistoryEvent['metadata']): HistoryEvent => ({
  id: '1',
  type,
  at: '2026-09-27T08:00:00.000Z',
  actor: 'Uma',
  subjectType: 'run',
  subjectId: 'x',
  metadata,
});

describe('describeEvent', () => {
  it('describes Run events in plain language', () => {
    expect(describeEvent(event('RUN_STARTED', { procedureRevision: 3, steps: 5 }))).toBe('started it (Procedure revision 3, 5 Steps)');
    expect(describeEvent(event('STEP_STATE_CHANGED', { stepTitle: 'Stove off', from: 'PENDING', to: 'SKIPPED', undo: false, reason: 'Later' }))).toBe(
      'Stove off: Pending → Skipped — reason: Later',
    );
    expect(describeEvent(event('STEP_STATE_CHANGED', { stepTitle: 'Stove off', from: 'DONE', to: 'PENDING', undo: true }))).toBe(
      'Stove off: Done → Pending (undo)',
    );
    expect(describeEvent(event('RUN_ABORTED', { reason: 'Power cut' }))).toBe('aborted it — reason: Power cut');
  });

  it('describes Procedure changes including structure summaries', () => {
    expect(describeEvent(event('PROCEDURE_CREATED', { origin: 'imported' }))).toBe('imported the Procedure from a file');
    expect(
      describeEvent(event('PROCEDURE_UPDATED', { fields: ['title', 'structure'], revision: 4, stepsAdded: 1, stepsChanged: 2 })),
    ).toBe('changed title; 1 Step added; 2 Steps changed (revision 4)');
  });

  it('falls back to the event type for unknown events', () => {
    expect(describeEvent(event('SOMETHING_NEW', {}))).toBe('SOMETHING_NEW');
  });
});
