/**
 * The unsaved state of the Procedure builder (15.2) and every change to it, as pure functions: adding,
 * pasting, duplicating, moving and removing Steps and Sections, applying one edited Step, and turning the
 * draft back into what the server saves. Items keep their identity: an existing Section or Step keeps
 * its server `id` through every edit and move; new ones and duplicates have none (the server assigns
 * ids). `key` is only the client's handle. The server validates every save again.
 */
import {
  MAX_IMAGE_CAPTION_LENGTH,
  MAX_PROCEDURE_TITLE_LENGTH,
  MAX_SECTIONS_PER_PROCEDURE,
  MAX_SECTION_TITLE_LENGTH,
  MAX_STEPS_PER_PROCEDURE,
  MAX_STEP_TITLE_LENGTH,
} from '@vergissmeinnicht/domain';
import type { ProcedureContent, ProcedureIcon, SectionInput, StepInput } from './api.ts';

export interface DraftStep extends StepInput {
  readonly key: string;
}

export interface DraftSection extends Omit<SectionInput, 'steps'> {
  readonly key: string;
  readonly steps: readonly DraftStep[];
}

export interface Draft {
  readonly title: string;
  readonly description: string;
  readonly icon: ProcedureIcon;
  /** As typed: comma-separated. */
  readonly tags: string;
  readonly sections: readonly DraftSection[];
}

let nextKey = 0;
const newKey = (): string => `k${nextKey++}`;

/** What a new Step starts with — unchanged from the former editor: required, not critical, reasons optional. */
export const NEW_STEP: StepInput = {
  title: '',
  description: '',
  icon: null,
  required: true,
  critical: false,
  skipReasonPolicy: 'OPTIONAL',
  notApplicableReasonPolicy: 'OPTIONAL',
  image: null,
};

export const newStep = (title: string): DraftStep => ({ ...NEW_STEP, title, key: newKey() });
export const newSection = (title: string): DraftSection => ({ key: newKey(), title, description: '', steps: [] });

/** A draft from saved content. A Procedure without Sections starts with one (named by the caller, e.g. "Steps"). */
export function draftFrom(content: ProcedureContent, defaultSectionTitle: string): Draft {
  const sections = content.sections.map((section) => ({
    ...section,
    key: newKey(),
    steps: section.steps.map((step) => ({ ...step, image: step.image ?? null, key: newKey() })),
  }));
  return {
    title: content.title,
    description: content.description,
    icon: content.icon,
    tags: content.tags.join(', '),
    sections: sections.length === 0 ? [newSection(defaultSectionTitle)] : sections,
  };
}

export function splitTags(value: string): string[] {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
}

function toStepInput(step: DraftStep): StepInput {
  return {
    ...(step.id === undefined ? {} : { id: step.id }),
    title: step.title.trim(),
    description: step.description,
    icon: step.icon,
    required: step.required,
    critical: step.critical,
    skipReasonPolicy: step.skipReasonPolicy,
    notApplicableReasonPolicy: step.notApplicableReasonPolicy,
    image: step.image ?? null,
  };
}

/** Back to API input: client keys dropped, ids of existing items kept. */
export function toContent(draft: Draft): ProcedureContent {
  return {
    title: draft.title.trim(),
    description: draft.description,
    icon: draft.icon,
    tags: splitTags(draft.tags),
    sections: draft.sections.map((section) => ({
      ...(section.id === undefined ? {} : { id: section.id }),
      title: section.title.trim(),
      description: section.description,
      steps: section.steps.map(toStepInput),
    })),
  };
}

/** Whether saving would change anything: compares what would be sent, so client keys and typing back do not count. */
export const sameContent = (a: Draft, b: Draft): boolean => JSON.stringify(toContent(a)) === JSON.stringify(toContent(b));

export const stepCount = (draft: Pick<Draft, 'sections'>): number => draft.sections.reduce((sum, section) => sum + section.steps.length, 0);

type Sections = readonly DraftSection[];
const mapSection = (sections: Sections, key: string, change: (section: DraftSection) => DraftSection): DraftSection[] =>
  sections.map((section) => (section.key === key ? change(section) : section));

/** Where a Step is: its Section and position. */
export function locateStep(sections: Sections, stepKey: string): { readonly section: DraftSection; readonly sectionIndex: number; readonly index: number; readonly step: DraftStep } | undefined {
  for (const [sectionIndex, section] of sections.entries()) {
    const index = section.steps.findIndex((step) => step.key === stepKey);
    const step = section.steps[index];
    if (step !== undefined) return { section, sectionIndex, index, step };
  }
  return undefined;
}

/** Appends Steps (one typed, or several pasted) to a Section. Titles are taken as given: validate first. */
export function addSteps(sections: Sections, sectionKey: string, titles: readonly string[]): DraftSection[] {
  return mapSection(sections, sectionKey, (section) => ({ ...section, steps: [...section.steps, ...titles.map(newStep)] }));
}

/** A copy right below the original: same content and rules, but a new Step — no id, so the server creates it. */
export function duplicateStep(sections: Sections, stepKey: string): DraftSection[] {
  const found = locateStep(sections, stepKey);
  if (found === undefined) return [...sections];
  const copy: { -readonly [K in keyof DraftStep]: DraftStep[K] } = { ...found.step, key: newKey() };
  delete copy.id;
  return mapSection(sections, found.section.key, (section) => ({
    ...section,
    steps: [...section.steps.slice(0, found.index + 1), copy, ...section.steps.slice(found.index + 1)],
  }));
}

export function removeStep(sections: Sections, stepKey: string): DraftSection[] {
  return sections.map((section) => (section.steps.some((step) => step.key === stepKey) ? { ...section, steps: section.steps.filter((step) => step.key !== stepKey) } : section));
}

/**
 * Moves a Step so that it ends up at `index` of the target Section (`index` beyond the end appends).
 * The Step object itself moves: id, content and rules are untouched.
 */
export function moveStepTo(sections: Sections, stepKey: string, targetSectionKey: string, index: number): DraftSection[] {
  const found = locateStep(sections, stepKey);
  if (found === undefined || !sections.some((section) => section.key === targetSectionKey)) return [...sections];
  return removeStep(sections, stepKey).map((section) => {
    if (section.key !== targetSectionKey) return section;
    const at = Math.max(0, Math.min(Number.isInteger(index) ? index : section.steps.length, section.steps.length));
    return { ...section, steps: [...section.steps.slice(0, at), found.step, ...section.steps.slice(at)] };
  });
}

/** One place up or down within its Section; at the edge nothing changes. */
export function moveStepBy(sections: Sections, stepKey: string, delta: -1 | 1): DraftSection[] {
  const found = locateStep(sections, stepKey);
  if (found === undefined) return [...sections];
  const to = found.index + delta;
  if (to < 0 || to >= found.section.steps.length) return [...sections];
  return moveStepTo(sections, stepKey, found.section.key, to);
}

/** Replaces a Step with its edited version (Apply step); `sectionKey` moves it to the end of another Section. */
export function applyStep(sections: Sections, edited: DraftStep, sectionKey: string): DraftSection[] {
  const found = locateStep(sections, edited.key);
  if (found === undefined) return [...sections];
  const replaced = mapSection(sections, found.section.key, (section) => ({ ...section, steps: section.steps.map((step) => (step.key === edited.key ? edited : step)) }));
  return sectionKey === found.section.key ? replaced : moveStepTo(replaced, edited.key, sectionKey, Number.MAX_SAFE_INTEGER);
}

export function moveSectionBy(sections: Sections, sectionKey: string, delta: -1 | 1): DraftSection[] {
  const from = sections.findIndex((section) => section.key === sectionKey);
  return moveSectionTo(sections, sectionKey, from + delta);
}

/** Moves a Section so that it ends up at `index`. Its Steps move with it. */
export function moveSectionTo(sections: Sections, sectionKey: string, index: number): DraftSection[] {
  const from = sections.findIndex((section) => section.key === sectionKey);
  const next = [...sections];
  if (from === -1 || !Number.isInteger(index) || index < 0 || index >= sections.length || index === from) return next;
  const [section] = next.splice(from, 1);
  next.splice(index, 0, section as DraftSection);
  return next;
}

export function updateSection(sections: Sections, sectionKey: string, patch: { readonly title?: string; readonly description?: string }): DraftSection[] {
  return mapSection(sections, sectionKey, (section) => ({ ...section, ...patch }));
}

export const removeSection = (sections: Sections, sectionKey: string): DraftSection[] => sections.filter((section) => section.key !== sectionKey);

// ---- Paste multiple steps ---------------------------------------------------------------------

/** Leading list markers of pasted text: "- ", "* ", "• ", "1. ", "2) ", "[ ] ". */
const LIST_MARKER = /^(?:[-*•–—·]\s+|\d{1,3}[.)]\s+|\[[ xX]?\]\s+)+/;
const CONTROL = /\p{Cc}/u;

export type PasteProblem =
  | { readonly kind: 'too_long'; readonly line: number; readonly length: number }
  | { readonly kind: 'invalid_characters'; readonly line: number }
  | { readonly kind: 'too_many'; readonly fit: number };

export interface PastePreview {
  /** One Step title per non-empty line, list markers removed. */
  readonly titles: readonly string[];
  readonly problems: readonly PasteProblem[];
}

/**
 * Turns pasted text into Step titles: one per non-empty line, trimmed, a leading bullet or number
 * removed. Nothing is cut or dropped silently — a line that is too long, has control characters, or
 * more lines than still fit (`room` = Steps the Procedure can still take) is reported instead.
 */
export function previewPastedSteps(text: string, room: number): PastePreview {
  const titles: string[] = [];
  const problems: PasteProblem[] = [];
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const title = raw.replace(/\t/g, ' ').trim().replace(LIST_MARKER, '').trim().normalize('NFC');
    if (title === '') continue;
    titles.push(title);
    const line = titles.length;
    const length = [...title].length;
    if (length > MAX_STEP_TITLE_LENGTH) problems.push({ kind: 'too_long', line, length });
    if (CONTROL.test(title)) problems.push({ kind: 'invalid_characters', line });
  }
  if (titles.length > room) problems.push({ kind: 'too_many', fit: Math.max(0, room) });
  return { titles, problems };
}

// ---- Validation before Apply and Save -----------------------------------------------------------

export type StepField = 'title' | 'caption';
export type StepProblem = 'step_title_empty' | 'step_title_too_long' | 'image_caption_empty' | 'image_caption_too_long';

/** Problems of one Step by field (shown next to the field in the Step editor). */
export function stepProblems(step: Pick<StepInput, 'title' | 'image'>): Partial<Record<StepField, StepProblem>> {
  const problems: Partial<Record<StepField, StepProblem>> = {};
  const title = step.title.trim();
  if (title === '') problems.title = 'step_title_empty';
  else if ([...title].length > MAX_STEP_TITLE_LENGTH) problems.title = 'step_title_too_long';
  if (step.image != null) {
    const caption = step.image.caption.trim();
    if (caption === '') problems.caption = 'image_caption_empty';
    else if ([...caption].length > MAX_IMAGE_CAPTION_LENGTH) problems.caption = 'image_caption_too_long';
  }
  return problems;
}

export interface DraftProblems {
  readonly title?: 'procedure_title_empty' | 'procedure_title_too_long';
  /** Section key → problem. */
  readonly sections: Readonly<Record<string, 'section_title_empty' | 'section_title_too_long'>>;
  /** Step key → its first problem. */
  readonly steps: Readonly<Record<string, StepProblem>>;
  readonly tooManySections: boolean;
  readonly tooManySteps: boolean;
}

/** What would make the server refuse the save, found before sending (the server checks again). */
export function draftProblems(draft: Draft): DraftProblems {
  const title = draft.title.trim();
  const sections: Record<string, 'section_title_empty' | 'section_title_too_long'> = {};
  const steps: Record<string, StepProblem> = {};
  for (const section of draft.sections) {
    const sectionTitle = section.title.trim();
    if (sectionTitle === '') sections[section.key] = 'section_title_empty';
    else if ([...sectionTitle].length > MAX_SECTION_TITLE_LENGTH) sections[section.key] = 'section_title_too_long';
    for (const step of section.steps) {
      const found = stepProblems(step);
      const first = found.title ?? found.caption;
      if (first !== undefined) steps[step.key] = first;
    }
  }
  return {
    ...(title === '' ? { title: 'procedure_title_empty' as const } : [...title].length > MAX_PROCEDURE_TITLE_LENGTH ? { title: 'procedure_title_too_long' as const } : {}),
    sections,
    steps,
    tooManySections: draft.sections.length > MAX_SECTIONS_PER_PROCEDURE,
    tooManySteps: stepCount(draft) > MAX_STEPS_PER_PROCEDURE,
  };
}

export const hasProblems = (problems: DraftProblems): boolean =>
  problems.title !== undefined || Object.keys(problems.sections).length > 0 || Object.keys(problems.steps).length > 0 || problems.tooManySections || problems.tooManySteps;

// ---- What the builder tells the person about saving ---------------------------------------------

/** The states the builder distinguishes — one at a time, most pressing first. */
export type SaveState = 'saving' | 'step-unapplied' | 'unsaved' | 'saved' | 'unchanged';

export function saveState(input: { readonly saving: boolean; readonly stepDirty: boolean; readonly dirty: boolean; readonly savedOnce: boolean }): SaveState {
  if (input.saving) return 'saving';
  if (input.stepDirty) return 'step-unapplied';
  if (input.dirty) return 'unsaved';
  return input.savedOnce ? 'saved' : 'unchanged';
}

/**
 * Whether Save procedure may run. Never while a Step has unapplied changes: saving then would persist
 * the outline as it was before those changes, which is not what the person sees in the Step editor.
 */
export const canSave = (input: { readonly saving: boolean; readonly stepDirty: boolean; readonly dirty: boolean; readonly isNew: boolean }): boolean =>
  !input.saving && !input.stepDirty && (input.dirty || input.isNew);
