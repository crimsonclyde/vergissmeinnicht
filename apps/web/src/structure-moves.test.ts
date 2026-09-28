import { describe, expect, it } from 'vitest';
import { moveItem, moveStep } from './structure-moves.ts';

const structure = () => [
  { id: 'A', steps: ['a1', 'a2', 'a3'] },
  { id: 'B', steps: ['b1'] },
  { id: 'C', steps: [] as string[] },
];
const flat = (sections: ReturnType<typeof structure>) => sections.map((s) => `${s.id}:${s.steps.join(',')}`);

describe('moveItem', () => {
  it('moves down and up so the item ends at the target index', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });

  it('ignores invalid indices', () => {
    for (const [from, to] of [[-1, 0], [0, 3], [1.5, 0], [0, Number.NaN]]) {
      expect(moveItem(['a', 'b', 'c'], from as number, to as number)).toEqual(['a', 'b', 'c']);
    }
  });
});

describe('moveStep', () => {
  it('reorders within a Section (drop onto a Step takes its place)', () => {
    expect(flat(moveStep(structure(), { section: 0, index: 0 }, { section: 0, index: 2 }))).toEqual(['A:a2,a3,a1', 'B:b1', 'C:']);
    expect(flat(moveStep(structure(), { section: 0, index: 2 }, { section: 0, index: 0 }))).toEqual(['A:a3,a1,a2', 'B:b1', 'C:']);
  });

  it('moves across Sections, including into an empty one and to the end', () => {
    expect(flat(moveStep(structure(), { section: 0, index: 1 }, { section: 1, index: 0 }))).toEqual(['A:a1,a3', 'B:a2,b1', 'C:']);
    expect(flat(moveStep(structure(), { section: 1, index: 0 }, { section: 2, index: 0 }))).toEqual(['A:a1,a2,a3', 'B:', 'C:b1']);
    expect(flat(moveStep(structure(), { section: 0, index: 0 }, { section: 1, index: 1 }))).toEqual(['A:a2,a3', 'B:b1,a1', 'C:']);
  });

  it('leaves the structure unchanged for invalid positions', () => {
    const invalid = [
      [{ section: 5, index: 0 }, { section: 0, index: 0 }],
      [{ section: 0, index: 7 }, { section: 1, index: 0 }],
      [{ section: 0, index: 0 }, { section: 1, index: 5 }],
      [{ section: 0, index: 0 }, { section: -1, index: 0 }],
    ] as const;
    for (const [from, to] of invalid) expect(flat(moveStep(structure(), from, to))).toEqual(flat(structure()));
  });

  it('never loses or duplicates a Step', () => {
    const before = structure().flatMap((s) => s.steps).sort();
    for (let fs = 0; fs < 2; fs++)
      for (let fi = 0; fi < 3; fi++)
        for (let ts = 0; ts < 3; ts++)
          for (let ti = 0; ti < 4; ti++) {
            const after = moveStep(structure(), { section: fs, index: fi }, { section: ts, index: ti });
            expect(after.flatMap((s) => s.steps).sort()).toEqual(before);
          }
  });
});
