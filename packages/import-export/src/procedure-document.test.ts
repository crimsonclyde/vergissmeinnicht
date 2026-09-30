import { describe, expect, it } from 'vitest';
import type { ProcedureSection, SectionId, StepId } from '@vergissmeinnicht/domain';
import {
  PROCEDURE_DOCUMENT_FORMAT,
  ProcedureImportError,
  parseProcedureDocument,
  toProcedureDocument,
  type ImportErrorCode,
} from './index.ts';

const SECTIONS: ProcedureSection[] = [
  {
    id: '11111111-1111-4111-8111-111111111111' as SectionId,
    title: 'Kitchen',
    description: 'First',
    steps: [
      {
        id: '22222222-2222-4222-8222-222222222222' as StepId,
        kind: 'CHECK',
        title: 'Stove off',
        description: '',
        icon: 'kitchen',
        required: true,
        critical: true,
        skipReasonPolicy: 'DISABLED',
        notApplicableReasonPolicy: 'REQUIRED',
      },
    ],
  },
];
const DETAIL = {
  procedure: { title: 'Leave the house', description: 'Daily', icon: 'home' as const, tags: ['daily'] },
  sections: SECTIONS,
};

function codeOf(input: unknown): ImportErrorCode {
  try {
    parseProcedureDocument(input);
  } catch (error) {
    if (error instanceof ProcedureImportError) return error.code;
    throw error;
  }
  throw new Error('expected a ProcedureImportError');
}

const valid = () => JSON.parse(JSON.stringify(toProcedureDocument(DETAIL))) as Record<string, unknown> & {
  procedure: Record<string, unknown> & { sections: (Record<string, unknown> & { steps: Record<string, unknown>[] })[] };
};

describe('toProcedureDocument', () => {
  it('exports the definition only: no ids, Workspace, users or timestamps', () => {
    const document = toProcedureDocument(DETAIL);
    expect(document).toEqual({
      format: PROCEDURE_DOCUMENT_FORMAT,
      schemaVersion: 1,
      procedure: {
        title: 'Leave the house',
        description: 'Daily',
        icon: 'home',
        tags: ['daily'],
        sections: [
          {
            title: 'Kitchen',
            description: 'First',
            steps: [
              {
                kind: 'CHECK',
                title: 'Stove off',
                description: '',
                icon: 'kitchen',
                required: true,
                critical: true,
                skipReasonPolicy: 'DISABLED',
                notApplicableReasonPolicy: 'REQUIRED',
              },
            ],
          },
        ],
      },
    });
    expect(JSON.stringify(document)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
});

describe('icons in documents', () => {
  it('exports and re-imports stable VMN icon keys, never artwork or library names', () => {
    const document = toProcedureDocument({
      procedure: { ...DETAIL.procedure, icon: 'freezer' },
      sections: SECTIONS.map((section) => ({ ...section, steps: section.steps.map((step) => ({ ...step, icon: 'chimney' as const })) })),
    });
    const json = JSON.stringify(document);
    expect(json).toContain('"icon":"freezer"');
    expect(json).toContain('"icon":"chimney"');
    expect(json).not.toMatch(/Icon[A-Z]|tabler|<svg/i);
    const imported = parseProcedureDocument(JSON.parse(json));
    expect(imported.icon).toBe('freezer');
    expect(imported.sections[0]?.steps[0]?.icon).toBe('chimney');
  });

  it('passes an icon on only as a bounded string; key validation happens in the domain on create', () => {
    const document = valid();
    document.procedure.icon = { toString: 'x' };
    expect(codeOf(document)).toBe('invalid_document');
    const long = valid();
    long.procedure.icon = 'x'.repeat(65);
    expect(codeOf(long)).toBe('invalid_document');
  });
});

describe('parseProcedureDocument', () => {
  it('round-trips an export without any ids', () => {
    const imported = parseProcedureDocument(valid());
    expect(imported.title).toBe('Leave the house');
    expect(imported.sections[0]?.steps[0]).toEqual({
      title: 'Stove off',
      description: '',
      icon: 'kitchen',
      required: true,
      critical: true,
      skipReasonPolicy: 'DISABLED',
      notApplicableReasonPolicy: 'REQUIRED',
    });
    expect(JSON.stringify(imported)).not.toContain('"id"');
  });

  it('checks the envelope and version first', () => {
    for (const input of [null, 'text', 42, [], [valid()]]) expect(codeOf(input)).toBe('invalid_document');
    expect(codeOf({ ...valid(), format: 'something.else' })).toBe('unsupported_format');
    const withoutFormat: Record<string, unknown> = valid();
    delete withoutFormat.format;
    expect(codeOf(withoutFormat)).toBe('unsupported_format');
    for (const version of [2, 0, '1', undefined, 1.0000001]) {
      expect(codeOf({ ...valid(), schemaVersion: version })).toBe('unsupported_schema_version');
    }
  });

  it('rejects any extra field, at every level (ids, Workspace, users, prototype keys)', () => {
    const withTop = { ...valid(), workspaceId: '11111111-1111-4111-8111-111111111111' };
    expect(codeOf(withTop)).toBe('invalid_document');

    const withProcedureId = valid();
    withProcedureId.procedure.id = '11111111-1111-4111-8111-111111111111';
    expect(codeOf(withProcedureId)).toBe('invalid_document');

    const withSectionId = valid();
    (withSectionId.procedure.sections[0] as Record<string, unknown>).id = '11111111-1111-4111-8111-111111111111';
    expect(codeOf(withSectionId)).toBe('invalid_document');

    const withStepExtra = valid();
    (withStepExtra.procedure.sections[0]?.steps[0] as Record<string, unknown>).state = 'DONE';
    expect(codeOf(withStepExtra)).toBe('invalid_document');

    const proto = JSON.parse(
      JSON.stringify(valid()).replace('"title":"Leave the house"', '"title":"Leave the house","__proto__":{"polluted":true}'),
    );
    expect(codeOf(proto)).toBe('invalid_document');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects wrong types, unknown Step kinds and oversized collections', () => {
    const mutate = (change: (doc: ReturnType<typeof valid>) => void) => {
      const doc = valid();
      change(doc);
      return codeOf(doc);
    };
    expect(mutate((d) => (d.procedure.title = 7))).toBe('invalid_document');
    expect(mutate((d) => ((d.procedure.sections[0]?.steps[0] as Record<string, unknown>).kind = 'TEXT'))).toBe('invalid_document');
    expect(mutate((d) => ((d.procedure.sections[0]?.steps[0] as Record<string, unknown>).required = 'yes'))).toBe('invalid_document');
    expect(mutate((d) => (d.procedure.tags = Array(51).fill('x')))).toBe('invalid_document');
    expect(mutate((d) => (d.procedure.sections = Array(61).fill(d.procedure.sections[0])))).toBe('invalid_document');
    expect(mutate((d) => (d.procedure.title = 'x'.repeat(513)))).toBe('invalid_document');
    expect(mutate((d) => delete (d.procedure.sections[0] as Record<string, unknown>).steps)).toBe('invalid_document');
  });

  it('never echoes the input in errors', () => {
    try {
      parseProcedureDocument({ ...valid(), format: '<script>secret</script>' });
    } catch (error) {
      expect((error as Error).message).not.toContain('secret');
    }
  });
});
