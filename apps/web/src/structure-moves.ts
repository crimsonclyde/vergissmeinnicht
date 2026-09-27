/**
 * Pure reordering of a draft Procedure structure (drag and drop, ↑/↓ buttons, "move to section").
 * Items keep their identity: only positions change. The server re-validates every save.
 */

export interface StepPosition {
  readonly section: number;
  readonly index: number;
}

type WithSteps<Step> = { readonly steps: readonly Step[] };

function inRange(length: number, index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < length;
}

/** Moves item `from` so that it ends up at index `to` (indices of the resulting array). */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (!inRange(items.length, from) || !inRange(items.length, to) || from === to) return [...items];
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

/**
 * Moves a Step so that it ends up at `to.index` in Section `to.section` (`index === steps.length`
 * of the target after removal appends). Dropping onto another Step therefore means "take its place".
 * Works within one Section and across Sections; invalid positions leave the structure unchanged.
 */
export function moveStep<Step, Section extends WithSteps<Step>>(
  sections: readonly Section[],
  from: StepPosition,
  to: StepPosition,
): Section[] {
  const source = sections[from.section];
  const target = sections[to.section];
  if (source === undefined || target === undefined || !inRange(source.steps.length, from.index)) return [...sections];
  const step = source.steps[from.index] as Step;
  const withoutStep = sections.map((section, i) =>
    i === from.section ? { ...section, steps: section.steps.filter((_, j) => j !== from.index) } : section,
  );
  const targetSteps = (withoutStep[to.section] as Section).steps;
  if (!Number.isInteger(to.index) || to.index < 0 || to.index > targetSteps.length) return [...sections];
  return withoutStep.map((section, i) =>
    i === to.section
      ? { ...section, steps: [...targetSteps.slice(0, to.index), step, ...targetSteps.slice(to.index)] }
      : section,
  );
}

