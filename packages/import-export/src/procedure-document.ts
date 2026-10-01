// Canonical Procedure JSON. Exports carry only the reusable definition: no ids, Workspace, users
// or timestamps (nothing internal or personal leaves the server by exporting). Imports are hostile
// input: the envelope and version are checked first, then a strict schema (unknown keys rejected,
// coarse bounds); the domain rules and limits are applied afterwards by the regular create path.
import type {
  ProcedureIcon,
  ProcedureSection,
  ReasonPolicy,
  SectionInput,
} from '@vergissmeinnicht/domain';
import { z } from 'zod';

export const PROCEDURE_DOCUMENT_FORMAT = 'vergissmeinnicht.procedure';
export const PROCEDURE_SCHEMA_VERSION = 1;

export interface ProcedureDocumentV1 {
  readonly format: typeof PROCEDURE_DOCUMENT_FORMAT;
  readonly schemaVersion: 1;
  readonly procedure: {
    readonly title: string;
    readonly description: string;
    readonly icon: ProcedureIcon;
    readonly tags: readonly string[];
    readonly sections: readonly {
      readonly title: string;
      readonly description: string;
      readonly steps: readonly {
        readonly kind: 'CHECK';
        readonly title: string;
        readonly description: string;
        readonly icon: ProcedureIcon | null;
        readonly required: boolean;
        readonly critical: boolean;
        readonly skipReasonPolicy: ReasonPolicy;
        readonly notApplicableReasonPolicy: ReasonPolicy;
      }[];
    }[];
  };
}

export function toProcedureDocument(detail: {
  readonly procedure: { readonly title: string; readonly description: string; readonly icon: ProcedureIcon; readonly tags: readonly string[] };
  readonly sections: readonly ProcedureSection[];
}): ProcedureDocumentV1 {
  return {
    format: PROCEDURE_DOCUMENT_FORMAT,
    schemaVersion: PROCEDURE_SCHEMA_VERSION,
    procedure: {
      title: detail.procedure.title,
      description: detail.procedure.description,
      icon: detail.procedure.icon,
      tags: [...detail.procedure.tags],
      sections: detail.sections.map((section) => ({
        title: section.title,
        description: section.description,
        steps: section.steps.map((step) => ({
          kind: step.kind,
          title: step.title,
          description: step.description,
          icon: step.icon,
          required: step.required,
          critical: step.critical,
          skipReasonPolicy: step.skipReasonPolicy,
          notApplicableReasonPolicy: step.notApplicableReasonPolicy,
        })),
      })),
    },
  };
}

export type ImportErrorCode = 'invalid_document' | 'unsupported_format' | 'unsupported_schema_version' | 'invalid_archive';

/** The document is not an importable Procedure. `code` is stable; nothing from the input is echoed. */
export class ProcedureImportError extends Error {
  readonly code: ImportErrorCode;

  constructor(code: ImportErrorCode) {
    super('The file is not an importable Procedure');
    this.name = 'ProcedureImportError';
    this.code = code;
  }
}

// Coarse bounds only; exact rules (lengths in code points, characters, icon keys, counts) are the
// domain's. Every object is strict, so ids, Workspace ids, users or any other extra field are rejected.
const text = (max: number) => z.string().max(max);
const stepV1 = z.strictObject({
  kind: z.literal('CHECK'),
  title: text(1024),
  description: text(16_384),
  icon: text(64).nullable(),
  required: z.boolean(),
  critical: z.boolean(),
  skipReasonPolicy: text(32),
  notApplicableReasonPolicy: text(32),
});
const documentV1 = z.strictObject({
  format: z.literal(PROCEDURE_DOCUMENT_FORMAT),
  schemaVersion: z.literal(1),
  procedure: z.strictObject({
    title: text(512),
    description: text(16_384),
    icon: text(64),
    tags: z.array(text(128)).max(50),
    sections: z
      .array(
        z.strictObject({
          title: text(512),
          description: text(16_384),
          steps: z.array(stepV1).max(250),
        }),
      )
      .max(60),
  }),
});

/** Procedure content ready for the regular create use-case (which applies all domain rules). */
export interface ImportedProcedure {
  readonly title: string;
  readonly description: string;
  readonly icon: string;
  readonly tags: readonly string[];
  readonly sections: readonly SectionInput[];
}

export function parseProcedureDocument(input: unknown): ImportedProcedure {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ProcedureImportError('invalid_document');
  }
  const envelope = input as Record<string, unknown>;
  if (envelope.format !== PROCEDURE_DOCUMENT_FORMAT) throw new ProcedureImportError('unsupported_format');
  if (envelope.schemaVersion !== PROCEDURE_SCHEMA_VERSION) throw new ProcedureImportError('unsupported_schema_version');

  const parsed = documentV1.safeParse(input);
  if (!parsed.success) throw new ProcedureImportError('invalid_document');
  const { procedure } = parsed.data;
  return {
    title: procedure.title,
    description: procedure.description,
    icon: procedure.icon,
    tags: procedure.tags,
    // Built field by field: no id (or anything else) from the file can reach persistence.
    sections: procedure.sections.map((section) => ({
      title: section.title,
      description: section.description,
      steps: section.steps.map((step) => ({
        title: step.title,
        description: step.description,
        icon: step.icon,
        required: step.required,
        critical: step.critical,
        skipReasonPolicy: step.skipReasonPolicy,
        notApplicableReasonPolicy: step.notApplicableReasonPolicy,
      })),
    })),
  };
}
