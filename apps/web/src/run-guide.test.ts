import { describe, expect, it } from 'vitest';
import type { RunSection, RunStep, StepState } from './api.ts';
import { sectionIcon } from './procedure-icons.tsx';
import { nextOpenSection, nextPendingIndex, resolvedCount } from './RunGuide.tsx';

const step = (id: string, state: StepState): RunStep => ({ id, state }) as unknown as RunStep;
const section = (id: string, states: StepState[], icon: RunSection['icon'] = null): RunSection => ({ id, title: id, description: '', icon, steps: states.map((state, index) => step(`${id}-${index}`, state)) });

describe('guided Run (22.2)', () => {
  it('moves on to the next pending Step after the current one, wrapping round, and knows when none is left', () => {
    const steps = ['DONE', 'PENDING', 'DONE', 'PENDING'].map((state, index) => step(String(index), state as StepState));
    expect(nextPendingIndex(steps, 1)).toBe(3);
    expect(nextPendingIndex(steps, 3)).toBe(1);
    expect(nextPendingIndex(steps.map((each) => ({ ...each, state: 'DONE' as const })), 0)).toBe(-1);
    // Skipped and Not applicable are resolved, too.
    expect(resolvedCount([step('a', 'SKIPPED'), step('b', 'NOT_APPLICABLE'), step('c', 'PENDING')])).toBe(2);
  });

  it('offers the next Section that still has something to do', () => {
    const sections = [section('kitchen', ['DONE']), section('bath', ['PENDING']), section('doors', ['DONE', 'PENDING'])];
    expect(nextOpenSection(sections, null)?.id).toBe('bath');
    expect(nextOpenSection(sections, 'bath')?.id).toBe('doors');
    expect(nextOpenSection(sections, 'doors')?.id).toBe('bath');
    expect(nextOpenSection([section('kitchen', ['DONE'])], 'kitchen')).toBeUndefined();
  });

  it('shows a default icon for a Section without one, also for a Run saved by an older version', () => {
    expect(sectionIcon(section('a', [], 'kitchen'))).toBe('kitchen');
    expect(sectionIcon(section('a', []))).toBe('checklist');
    expect(sectionIcon({})).toBe('checklist');
  });
});
