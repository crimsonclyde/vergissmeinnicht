import { describe, expect, it } from 'vitest';
import {
  DomainValidationError,
  normalizeProcedureStructure,
  summarizeStructureChange,
  type ProcedureSection,
  type SectionId,
  type StepId,
  type StepInput,
} from './index.ts';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof DomainValidationError) return error.code;
    throw error;
  }
  throw new Error('expected a DomainValidationError');
}

const STEP: StepInput = {
  title: 'Close windows',
  description: '',
  icon: null,
  required: true,
  critical: false,
  skipReasonPolicy: 'OPTIONAL',
  notApplicableReasonPolicy: 'DISABLED',
};
const ID_A = '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f';
const ID_B = '8a1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e60';

describe('normalizeProcedureStructure', () => {
  it('normalizes Sections and CHECK Steps in order', () => {
    const draft = normalizeProcedureStructure([
      { title: ' Ground floor ', description: '', steps: [{ ...STEP, title: ' Close windows ', icon: 'home' }, { ...STEP, title: 'Lights' }] },
    ]);
    expect(draft.sections[0]?.title).toBe('Ground floor');
    expect(draft.sections[0]?.steps.map((step) => [step.title, step.kind, step.icon])).toEqual([
      ['Close windows', 'CHECK', 'home'],
      ['Lights', 'CHECK', null],
    ]);
  });

  it('rejects unknown reason policies and icon keys', () => {
    expect(codeOf(() => normalizeProcedureStructure([{ title: 'S', description: '', steps: [{ ...STEP, skipReasonPolicy: 'ALWAYS' }] }]))).toBe(
      'invalid_reason_policy',
    );
    expect(
      codeOf(() => normalizeProcedureStructure([{ title: 'S', description: '', steps: [{ ...STEP, notApplicableReasonPolicy: 'required' }] }])),
    ).toBe('invalid_reason_policy');
    expect(codeOf(() => normalizeProcedureStructure([{ title: 'S', description: '', steps: [{ ...STEP, icon: '<svg>' }] }]))).toBe(
      'invalid_icon',
    );
  });

  it('rejects malformed and duplicate ids, also across Sections and Steps', () => {
    expect(codeOf(() => normalizeProcedureStructure([{ id: 'x', title: 'S', description: '', steps: [] }]))).toBe('invalid_item_id');
    expect(
      codeOf(() =>
        normalizeProcedureStructure([
          { id: ID_A, title: 'S', description: '', steps: [] },
          { id: ID_A, title: 'T', description: '', steps: [] },
        ]),
      ),
    ).toBe('duplicate_item_id');
    expect(
      codeOf(() => normalizeProcedureStructure([{ id: ID_A, title: 'S', description: '', steps: [{ ...STEP, id: ID_A }] }])),
    ).toBe('duplicate_item_id');
  });

  it('bounds the number of Sections and Steps and validates text', () => {
    const sections = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `S${i}`, description: '', steps: [] }));
    expect(normalizeProcedureStructure(sections(50)).sections).toHaveLength(50);
    expect(codeOf(() => normalizeProcedureStructure(sections(51)))).toBe('too_many_sections');
    const steps = (n: number) => Array.from({ length: n }, () => STEP);
    expect(codeOf(() => normalizeProcedureStructure([{ title: 'A', description: '', steps: steps(150) }, { title: 'B', description: '', steps: steps(51) }]))).toBe(
      'too_many_steps',
    );
    expect(codeOf(() => normalizeProcedureStructure([{ title: '', description: '', steps: [] }]))).toBe('section_title_empty');
    expect(codeOf(() => normalizeProcedureStructure([{ title: 'S', description: '', steps: [{ ...STEP, title: 'x'.repeat(201) }] }]))).toBe(
      'step_title_too_long',
    );
  });
});

describe('summarizeStructureChange', () => {
  const step = (id: string, title: string) => ({
    id: id as StepId,
    kind: 'CHECK' as const,
    title,
    description: '',
    icon: null,
    required: true,
    critical: false,
    skipReasonPolicy: 'OPTIONAL' as const,
    notApplicableReasonPolicy: 'OPTIONAL' as const,
  });
  const before: ProcedureSection[] = [
    { id: 's1' as SectionId, title: 'One', description: '', steps: [step(ID_A, 'a'), step(ID_B, 'b')] },
    { id: 's2' as SectionId, title: 'Two', description: '', steps: [] },
  ];

  it('is empty for identical structures', () => {
    expect(Object.values(summarizeStructureChange(before, before)).every((n) => n === 0)).toBe(true);
  });

  it('counts additions, removals, edits and moves', () => {
    const after: ProcedureSection[] = [
      { id: 's2' as SectionId, title: 'Two', description: '', steps: [step(ID_B, 'b')] },
      { id: 's3' as SectionId, title: 'Three', description: '', steps: [step('new', 'c')] },
    ];
    expect(summarizeStructureChange(before, after)).toEqual({
      sectionsAdded: 1,
      sectionsRemoved: 1,
      sectionsChanged: 1,
      stepsAdded: 1,
      stepsRemoved: 1,
      stepsChanged: 1,
    });
  });
});
