import { parseStepImage, type StepImageRef } from './media.ts';
import { DomainValidationError } from './errors.ts';
import {
  normalizeProcedureDescription,
  parseProcedureIcon,
  type ProcedureIcon,
} from './procedure.ts';
import { normalizeSingleLineName } from './text.ts';
import { UUID_V4 } from './user.ts';

export type SectionId = string & { readonly __brand: 'SectionId' };
export type StepId = string & { readonly __brand: 'StepId' };

/** V1 supports only CHECK Steps. */
export const STEP_KINDS = ['CHECK'] as const;
export type StepKind = (typeof STEP_KINDS)[number];

/**
 * Whether a reason can be given when a Step is marked SKIPPED or NOT_APPLICABLE. The two policies are
 * configured separately because the two states mean different things.
 */
export const REASON_POLICIES = ['DISABLED', 'OPTIONAL', 'REQUIRED'] as const;
export type ReasonPolicy = (typeof REASON_POLICIES)[number];

export interface ProcedureStep {
  readonly id: StepId;
  readonly kind: StepKind;
  readonly title: string;
  readonly description: string;
  readonly icon: ProcedureIcon | null;
  /** Required Steps must be resolved before a Run can complete (rules in Step 5.4). */
  readonly required: boolean;
  /** Critical Steps need a press-and-hold confirmation in the UI (Step 5.3). */
  readonly critical: boolean;
  readonly skipReasonPolicy: ReasonPolicy;
  readonly notApplicableReasonPolicy: ReasonPolicy;
  /** Optional instruction image with its caption (14.3); the written Step must be understandable without it. */
  readonly image: StepImageRef | null;
}

export interface ProcedureSection {
  readonly id: SectionId;
  readonly title: string;
  readonly description: string;
  /** In display order. */
  readonly steps: readonly ProcedureStep[];
}

export const MAX_SECTIONS_PER_PROCEDURE = 50;
export const MAX_STEPS_PER_PROCEDURE = 200;
export const MAX_SECTION_TITLE_LENGTH = 120;
export const MAX_STEP_TITLE_LENGTH = 200;

/** Client input for one Step. `id` names an existing Step of the same Procedure; omit it for a new Step. */
export interface StepInput {
  readonly id?: string | undefined;
  readonly title: string;
  readonly description: string;
  readonly icon: string | null;
  readonly required: boolean;
  readonly critical: boolean;
  readonly skipReasonPolicy: string;
  readonly notApplicableReasonPolicy: string;
  /** Omitted or null: no image. The image must belong to the Procedure's Workspace (checked on write). */
  readonly image?: { readonly id: string; readonly caption: string } | null | undefined;
}

export interface SectionInput {
  readonly id?: string | undefined;
  readonly title: string;
  readonly description: string;
  readonly steps: readonly StepInput[];
}

/**
 * A validated structure. Existing ids are only syntactically checked here; whether they belong to
 * the Procedure being edited is checked against persistence inside the write transaction.
 */
export interface StructureDraft {
  readonly sections: readonly {
    readonly id: SectionId | undefined;
    readonly title: string;
    readonly description: string;
    readonly steps: readonly (Omit<ProcedureStep, 'id'> & { readonly id: StepId | undefined })[];
  }[];
}

function parseReasonPolicy(field: string, value: string): ReasonPolicy {
  if (!(REASON_POLICIES as readonly string[]).includes(value)) {
    throw new DomainValidationError(field, 'invalid_reason_policy', 'Unknown reason policy');
  }
  return value as ReasonPolicy;
}

function parseItemId<T extends string>(field: string, value: string | undefined, seen: Set<string>): T | undefined {
  if (value === undefined) return undefined;
  if (!UUID_V4.test(value)) throw new DomainValidationError(field, 'invalid_item_id', 'Item id must be a lower-case UUIDv4');
  if (seen.has(value)) throw new DomainValidationError(field, 'duplicate_item_id', 'Item ids must be unique');
  seen.add(value);
  return value as T;
}

export function normalizeProcedureStructure(sections: readonly SectionInput[]): StructureDraft {
  if (sections.length > MAX_SECTIONS_PER_PROCEDURE) {
    throw new DomainValidationError('sections', 'too_many_sections', 'Too many Sections');
  }
  const stepCount = sections.reduce((total, section) => total + section.steps.length, 0);
  if (stepCount > MAX_STEPS_PER_PROCEDURE) {
    throw new DomainValidationError('sections', 'too_many_steps', 'Too many Steps');
  }
  // One id namespace across Sections and Steps: an id can never be reused for a different kind of item.
  const seen = new Set<string>();
  return {
    sections: sections.map((section) => ({
      id: parseItemId<SectionId>('sections', section.id, seen),
      title: normalizeSingleLineName(section.title, {
        field: 'sections',
        codePrefix: 'section_title',
        label: 'Section title',
        maxLength: MAX_SECTION_TITLE_LENGTH,
      }),
      description: normalizeProcedureDescription(section.description),
      steps: section.steps.map((step) => ({
        id: parseItemId<StepId>('steps', step.id, seen),
        kind: 'CHECK' as const,
        title: normalizeSingleLineName(step.title, {
          field: 'steps',
          codePrefix: 'step_title',
          label: 'Step title',
          maxLength: MAX_STEP_TITLE_LENGTH,
        }),
        description: normalizeProcedureDescription(step.description),
        icon: step.icon === null ? null : parseProcedureIcon(step.icon),
        required: step.required,
        critical: step.critical,
        skipReasonPolicy: parseReasonPolicy('skipReasonPolicy', step.skipReasonPolicy),
        notApplicableReasonPolicy: parseReasonPolicy('notApplicableReasonPolicy', step.notApplicableReasonPolicy),
        image: parseStepImage(step.image),
      })),
    })),
  };
}

/** Counts for the audit summary of one save. Moves and reorders count as changes. */
export interface StructureChangeSummary {
  readonly sectionsAdded: number;
  readonly sectionsRemoved: number;
  readonly sectionsChanged: number;
  readonly stepsAdded: number;
  readonly stepsRemoved: number;
  readonly stepsChanged: number;
}

export function summarizeStructureChange(
  before: readonly ProcedureSection[],
  after: readonly ProcedureSection[],
): StructureChangeSummary {
  const index = (sections: readonly ProcedureSection[]) => {
    const sectionMap = new Map<string, string>();
    const stepMap = new Map<string, string>();
    sections.forEach((section, position) => {
      sectionMap.set(section.id, JSON.stringify([position, section.title, section.description]));
      section.steps.forEach((step, stepPosition) =>
        stepMap.set(step.id, JSON.stringify([section.id, stepPosition, { ...step, id: undefined }])),
      );
    });
    return { sectionMap, stepMap };
  };
  const diff = (a: Map<string, string>, b: Map<string, string>) => ({
    added: [...b.keys()].filter((id) => !a.has(id)).length,
    removed: [...a.keys()].filter((id) => !b.has(id)).length,
    changed: [...b.entries()].filter(([id, value]) => a.has(id) && a.get(id) !== value).length,
  });
  const old = index(before);
  const next = index(after);
  const sections = diff(old.sectionMap, next.sectionMap);
  const steps = diff(old.stepMap, next.stepMap);
  return {
    sectionsAdded: sections.added,
    sectionsRemoved: sections.removed,
    sectionsChanged: sections.changed,
    stepsAdded: steps.added,
    stepsRemoved: steps.removed,
    stepsChanged: steps.changed,
  };
}

export function isEmptyChange(summary: StructureChangeSummary): boolean {
  return Object.values(summary).every((count) => count === 0);
}
