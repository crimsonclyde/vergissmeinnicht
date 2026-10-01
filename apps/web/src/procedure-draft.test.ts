import { describe, expect, it } from 'vitest';
import type { ProcedureContent } from './api.ts';
import {
  NEW_STEP,
  addSteps,
  applyStep,
  canSave,
  draftFrom,
  draftProblems,
  duplicateStep,
  hasProblems,
  locateStep,
  moveSectionBy,
  moveSectionTo,
  moveStepBy,
  moveStepTo,
  previewPastedSteps,
  removeSection,
  removeStep,
  sameContent,
  saveState,
  stepCount,
  stepProblems,
  toContent,
  updateSection,
  type Draft,
  type DraftSection,
} from './procedure-draft.ts';

const step = (id: string, title: string, extra: object = {}) => ({ ...NEW_STEP, id, title, ...extra });
const SAVED: ProcedureContent = {
  title: 'Leaving Casa Nostra',
  description: 'Before a longer absence.',
  icon: 'home',
  tags: ['house', 'travel'],
  sections: [
    { id: 'sec-utilities', title: 'Utilities', description: 'In the cellar.', steps: [step('s-water', 'Switch off the water', { critical: true, skipReasonPolicy: 'REQUIRED' }), step('s-heating', 'Turn off heating'), step('s-plugs', 'Unplug appliances', { required: false })] },
    { id: 'sec-kitchen', title: 'Kitchen', description: '', steps: [step('s-fridge', 'Empty the fridge', { image: { id: 'img-1', caption: 'Fridge door open' } }), step('s-bin', 'Take out the bin')] },
  ],
};
const saved = (): Draft => draftFrom(SAVED, 'Steps');
const ids = (sections: readonly DraftSection[]) => sections.map((section) => [section.id ?? 'new', ...section.steps.map((s) => s.id ?? `new:${s.title}`)]);
const keyOf = (draft: Draft, id: string) => draft.sections.flatMap((section) => section.steps).find((s) => s.id === id)?.key ?? '';
const sectionKey = (draft: Draft, id: string) => draft.sections.find((section) => section.id === id)?.key ?? '';

describe('draft of a Procedure', () => {
  it('round-trips saved content unchanged, ids included', () => {
    expect(toContent(saved())).toEqual(SAVED);
    expect(sameContent(saved(), saved())).toBe(true);
  });

  it('starts a new Procedure with one Section named by the caller, so Steps can be typed at once', () => {
    const draft = draftFrom({ title: '', description: '', icon: 'checklist', tags: [], sections: [] }, 'Steps');
    expect(draft.sections).toHaveLength(1);
    expect(draft.sections[0]).toMatchObject({ title: 'Steps', description: '', steps: [] });
    expect(draft.sections[0]?.id).toBeUndefined();
  });

  it('adds typed Steps with the unchanged defaults: required, not critical, reasons optional', () => {
    const draft = saved();
    const sections = addSteps(draft.sections, sectionKey(draft, 'sec-kitchen'), ['Close the shutters']);
    const added = sections[1]?.steps.at(-1);
    expect(added).toMatchObject({ title: 'Close the shutters', description: '', icon: null, image: null, required: true, critical: false, skipReasonPolicy: 'OPTIONAL', notApplicableReasonPolicy: 'OPTIONAL' });
    expect(added?.id).toBeUndefined();
    // Existing Steps and the other Section are untouched.
    expect(ids(sections)).toEqual([
      ['sec-utilities', 's-water', 's-heating', 's-plugs'],
      ['sec-kitchen', 's-fridge', 's-bin', 'new:Close the shutters'],
    ]);
    expect(stepCount({ sections })).toBe(6);
  });

  it('notices a change, and that typing it back is no change', () => {
    const draft = saved();
    const renamed: Draft = { ...draft, title: 'Leaving the house' };
    expect(sameContent(renamed, draft)).toBe(false);
    expect(sameContent({ ...renamed, title: 'Leaving Casa Nostra' }, draft)).toBe(true);
    expect(sameContent({ ...draft, tags: 'house,travel' }, draft)).toBe(true);
    expect(sameContent({ ...draft, tags: 'house' }, draft)).toBe(false);
    const moved = { ...draft, sections: moveStepBy(draft.sections, keyOf(draft, 's-water'), 1) };
    expect(sameContent(moved, draft)).toBe(false);
    expect(sameContent({ ...moved, sections: moveStepBy(moved.sections, keyOf(draft, 's-water'), -1) }, draft)).toBe(true);
  });
});

describe('Step identity while reordering', () => {
  it('moves a Step within its Section and keeps every id', () => {
    const draft = saved();
    const down = moveStepBy(draft.sections, keyOf(draft, 's-water'), 1);
    expect(ids(down)[0]).toEqual(['sec-utilities', 's-heating', 's-water', 's-plugs']);
    // The moved Step is the same object: content and rules travel with it.
    expect(locateStep(down, keyOf(draft, 's-water'))?.step).toBe(draft.sections[0]?.steps[0]);
    // At the edge nothing changes.
    expect(ids(moveStepBy(draft.sections, keyOf(draft, 's-water'), -1))).toEqual(ids(draft.sections));
    expect(ids(moveStepBy(draft.sections, keyOf(draft, 's-plugs'), 1))).toEqual(ids(draft.sections));
  });

  it('moves a Step to another Section at a position, or to its end', () => {
    const draft = saved();
    const kitchen = sectionKey(draft, 'sec-kitchen');
    expect(ids(moveStepTo(draft.sections, keyOf(draft, 's-water'), kitchen, 1))).toEqual([
      ['sec-utilities', 's-heating', 's-plugs'],
      ['sec-kitchen', 's-fridge', 's-water', 's-bin'],
    ]);
    expect(ids(moveStepTo(draft.sections, keyOf(draft, 's-water'), kitchen, Number.MAX_SAFE_INTEGER))[1]).toEqual(['sec-kitchen', 's-fridge', 's-bin', 's-water']);
    // Dropping onto a Step further down in the same Section: it takes that place.
    expect(ids(moveStepTo(draft.sections, keyOf(draft, 's-water'), sectionKey(draft, 'sec-utilities'), 2))[0]).toEqual(['sec-utilities', 's-heating', 's-plugs', 's-water']);
    // Unknown Step or Section: nothing changes.
    expect(ids(moveStepTo(draft.sections, 'nope', kitchen, 0))).toEqual(ids(draft.sections));
    expect(ids(moveStepTo(draft.sections, keyOf(draft, 's-water'), 'nope', 0))).toEqual(ids(draft.sections));
  });

  it('reorders Sections with their Steps', () => {
    const draft = saved();
    const swapped = moveSectionBy(draft.sections, sectionKey(draft, 'sec-kitchen'), -1);
    expect(ids(swapped)).toEqual([
      ['sec-kitchen', 's-fridge', 's-bin'],
      ['sec-utilities', 's-water', 's-heating', 's-plugs'],
    ]);
    expect(ids(moveSectionTo(swapped, sectionKey(draft, 'sec-kitchen'), 1))).toEqual(ids(draft.sections));
    expect(ids(moveSectionBy(draft.sections, sectionKey(draft, 'sec-utilities'), -1))).toEqual(ids(draft.sections));
    expect(ids(moveSectionTo(draft.sections, sectionKey(draft, 'sec-utilities'), 5))).toEqual(ids(draft.sections));
  });

  it('duplicates a Step right below the original as a new Step without id', () => {
    const draft = saved();
    const sections = duplicateStep(draft.sections, keyOf(draft, 's-water'));
    const [original, copy] = sections[0]?.steps ?? [];
    expect(ids(sections)[0]).toEqual(['sec-utilities', 's-water', 'new:Switch off the water', 's-heating', 's-plugs']);
    expect(copy).toMatchObject({ title: 'Switch off the water', critical: true, skipReasonPolicy: 'REQUIRED', required: true });
    expect(copy && 'id' in copy).toBe(false);
    expect(copy?.key).not.toBe(original?.key);
    expect(original?.id).toBe('s-water');
    // A duplicated photo is the same stored image (images are immutable and may be shared).
    const withPhoto = duplicateStep(draft.sections, keyOf(draft, 's-fridge'));
    expect(withPhoto[1]?.steps[1]?.image).toEqual({ id: 'img-1', caption: 'Fridge door open' });
    expect(toContent({ ...draft, sections }).sections[0]?.steps[1]).not.toHaveProperty('id');
  });

  it('deletes a Step and a Section; the outline before is the Undo', () => {
    const draft = saved();
    const before = draft.sections;
    const withoutStep = removeStep(before, keyOf(draft, 's-heating'));
    expect(ids(withoutStep)[0]).toEqual(['sec-utilities', 's-water', 's-plugs']);
    const withoutSection = removeSection(before, sectionKey(draft, 'sec-kitchen'));
    expect(ids(withoutSection)).toEqual([['sec-utilities', 's-water', 's-heating', 's-plugs']]);
    // Undo puts the outline as it was back: the removed items return with their ids and content.
    expect(sameContent({ ...draft, sections: before }, saved())).toBe(true);
    expect(before[1]?.steps[0]?.image).toEqual({ id: 'img-1', caption: 'Fridge door open' });
  });

  it('renames and describes a Section without touching its id or Steps', () => {
    const draft = saved();
    const sections = updateSection(draft.sections, sectionKey(draft, 'sec-kitchen'), { title: 'Kitchen & pantry' });
    expect(sections[1]).toMatchObject({ id: 'sec-kitchen', title: 'Kitchen & pantry', description: '' });
    expect(sections[1]?.steps).toBe(draft.sections[1]?.steps);
  });
});

describe('Apply step', () => {
  it('replaces the Step in the outline and keeps its id', () => {
    const draft = saved();
    const original = locateStep(draft.sections, keyOf(draft, 's-heating'));
    const edited = { ...(original?.step as NonNullable<typeof original>['step']), title: 'Heating to frost protection', description: 'Dial to ❄.', critical: true };
    const sections = applyStep(draft.sections, edited, sectionKey(draft, 'sec-utilities'));
    expect(ids(sections)).toEqual(ids(draft.sections));
    expect(sections[0]?.steps[1]).toMatchObject({ id: 's-heating', title: 'Heating to frost protection', description: 'Dial to ❄.', critical: true, required: true });
    // The draft the editor started from is untouched: Cancel simply keeps using it.
    expect(draft.sections[0]?.steps[1]).toMatchObject({ title: 'Turn off heating', critical: false });
  });

  it('moves the Step to the end of the chosen Section', () => {
    const draft = saved();
    const original = locateStep(draft.sections, keyOf(draft, 's-heating'));
    const sections = applyStep(draft.sections, { ...(original?.step as NonNullable<typeof original>['step']), title: 'Heating off' }, sectionKey(draft, 'sec-kitchen'));
    expect(ids(sections)).toEqual([
      ['sec-utilities', 's-water', 's-plugs'],
      ['sec-kitchen', 's-fridge', 's-bin', 's-heating'],
    ]);
    expect(sections[1]?.steps[2]?.title).toBe('Heating off');
  });
});

describe('Paste multiple steps', () => {
  it('previews one Step per non-empty line, without list markers', () => {
    const text = '- Lock the back door\n\n  2) Close the windows  \r\n• Turn off the heating\n[ ] Water the plants\n\t\n3 eggs\n12. Take the keys';
    expect(previewPastedSteps(text, 100)).toEqual({
      titles: ['Lock the back door', 'Close the windows', 'Turn off the heating', 'Water the plants', '3 eggs', 'Take the keys'],
      problems: [],
    });
    expect(previewPastedSteps('  \n\n', 100)).toEqual({ titles: [], problems: [] });
  });

  it('reports a line that is too long instead of cutting it', () => {
    const preview = previewPastedSteps(`Short\n${'x'.repeat(201)}\n${'y'.repeat(200)}`, 100);
    expect(preview.titles).toHaveLength(3);
    expect(preview.problems).toEqual([{ kind: 'too_long', line: 2, length: 201 }]);
  });

  it('reports more lines than the Procedure can still take, and control characters', () => {
    expect(previewPastedSteps('a\nb\nc', 2).problems).toEqual([{ kind: 'too_many', fit: 2 }]);
    expect(previewPastedSteps('a', 0).problems).toEqual([{ kind: 'too_many', fit: 0 }]);
    expect(previewPastedSteps('a\nb', 2).problems).toEqual([]);
    expect(previewPastedSteps('ok\nbad\u0007bell', 10).problems).toEqual([{ kind: 'invalid_characters', line: 2 }]);
  });
});

describe('validation before Apply and Save', () => {
  it('finds a missing Step title and a missing caption of an image', () => {
    expect(stepProblems({ title: '  ', image: null })).toEqual({ title: 'step_title_empty' });
    expect(stepProblems({ title: 'x'.repeat(201), image: null })).toEqual({ title: 'step_title_too_long' });
    expect(stepProblems({ title: 'Valve', image: { id: 'img', caption: ' ' } })).toEqual({ caption: 'image_caption_empty' });
    expect(stepProblems({ title: 'Valve', image: { id: 'img', caption: 'x'.repeat(201) } })).toEqual({ caption: 'image_caption_too_long' });
    expect(stepProblems({ title: 'Valve', image: { id: 'img', caption: 'Blue lever' } })).toEqual({});
    // No image: no caption needed.
    expect(stepProblems({ title: 'Valve' })).toEqual({});
  });

  it('names what blocks saving, per field', () => {
    const draft = saved();
    expect(hasProblems(draftProblems(draft))).toBe(false);
    const broken: Draft = {
      ...draft,
      title: ' ',
      sections: [{ ...(draft.sections[0] as DraftSection), title: '' }, { ...(draft.sections[1] as DraftSection), steps: addSteps(draft.sections, sectionKey(draft, 'sec-kitchen'), [''])[1]?.steps ?? [] }],
    };
    const problems = draftProblems(broken);
    expect(problems.title).toBe('procedure_title_empty');
    expect(problems.sections).toEqual({ [sectionKey(draft, 'sec-utilities')]: 'section_title_empty' });
    expect(Object.values(problems.steps)).toEqual(['step_title_empty']);
    expect(hasProblems(problems)).toBe(true);
    expect(draftProblems({ ...draft, title: 'x'.repeat(121) }).title).toBe('procedure_title_too_long');
  });

  it('enforces the limits of 50 Sections and 200 Steps', () => {
    const draft = saved();
    const many = addSteps(draft.sections, sectionKey(draft, 'sec-kitchen'), Array.from({ length: 196 }, (_unused, i) => `Step ${i}`));
    expect(draftProblems({ ...draft, sections: many }).tooManySteps).toBe(true);
    expect(draftProblems({ ...draft, sections: addSteps(draft.sections, sectionKey(draft, 'sec-kitchen'), Array.from({ length: 195 }, (_unused, i) => `Step ${i}`)) }).tooManySteps).toBe(false);
    const sections = Array.from({ length: 51 }, () => draft.sections[0] as DraftSection);
    expect(draftProblems({ ...draft, sections }).tooManySections).toBe(true);
  });
});

describe('what the builder says about saving', () => {
  it('distinguishes unapplied Step changes, unsaved changes, saving and saved', () => {
    expect(saveState({ saving: false, stepDirty: false, dirty: false, savedOnce: false })).toBe('unchanged');
    expect(saveState({ saving: false, stepDirty: false, dirty: true, savedOnce: false })).toBe('unsaved');
    expect(saveState({ saving: false, stepDirty: true, dirty: false, savedOnce: true })).toBe('step-unapplied');
    expect(saveState({ saving: false, stepDirty: true, dirty: true, savedOnce: false })).toBe('step-unapplied');
    expect(saveState({ saving: true, stepDirty: false, dirty: true, savedOnce: false })).toBe('saving');
    expect(saveState({ saving: false, stepDirty: false, dirty: false, savedOnce: true })).toBe('saved');
    // Changed again after a save: unsaved, not "saved".
    expect(saveState({ saving: false, stepDirty: false, dirty: true, savedOnce: true })).toBe('unsaved');
  });

  it('never saves while a Step has unapplied changes, nor twice at once', () => {
    expect(canSave({ saving: false, stepDirty: true, dirty: true, isNew: false })).toBe(false);
    expect(canSave({ saving: false, stepDirty: true, dirty: false, isNew: true })).toBe(false);
    expect(canSave({ saving: true, stepDirty: false, dirty: true, isNew: false })).toBe(false);
    expect(canSave({ saving: false, stepDirty: false, dirty: true, isNew: false })).toBe(true);
    // Nothing changed on an existing Procedure: nothing to save. A new one can be saved (and validated).
    expect(canSave({ saving: false, stepDirty: false, dirty: false, isNew: false })).toBe(false);
    expect(canSave({ saving: false, stepDirty: false, dirty: false, isNew: true })).toBe(true);
  });
});
