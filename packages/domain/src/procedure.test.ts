import { describe, expect, it } from 'vitest';
import {
  DomainValidationError,
  MAX_PROCEDURE_DESCRIPTION_LENGTH,
  normalizeProcedureContent,
  normalizeProcedureDescription,
  normalizeProcedureTags,
  parseProcedureIcon,
  parseProcedureId,
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

describe('Procedure content', () => {
  it('normalizes a complete definition', () => {
    expect(
      normalizeProcedureContent({
        title: '  Leave the house ',
        description: 'Windows\r\n\tclosed?\r\n',
        icon: 'home',
        tags: [' Daily ', 'daily', 'Safety'],
      }),
    ).toEqual({ title: 'Leave the house', description: 'Windows\n\tclosed?', icon: 'home', tags: ['Daily', 'Safety'] });
  });

  it('rejects empty, over-long and spoofable titles', () => {
    const content = { description: '', icon: 'home', tags: [] };
    expect(codeOf(() => normalizeProcedureContent({ ...content, title: ' ' }))).toBe('procedure_title_empty');
    expect(codeOf(() => normalizeProcedureContent({ ...content, title: 'x'.repeat(121) }))).toBe('procedure_title_too_long');
    expect(codeOf(() => normalizeProcedureContent({ ...content, title: 'a‮b' }))).toBe('procedure_title_invalid_characters');
    expect(codeOf(() => normalizeProcedureContent({ ...content, title: 'two\nlines' }))).toBe('procedure_title_invalid_characters');
  });

  it('keeps descriptions plain text with line breaks but no other control or bidi characters', () => {
    expect(normalizeProcedureDescription('')).toBe('');
    expect(normalizeProcedureDescription('<b>not html</b>')).toBe('<b>not html</b>');
    for (const bad of ['bell\u0007', 'nul\u0000', 'esc\u001b[31m', 'rtl⁦x', 'v\u000bt', 'form\u000cfeed']) {
      expect(codeOf(() => normalizeProcedureDescription(bad))).toBe('description_invalid_characters');
    }
    expect(normalizeProcedureDescription('é'.repeat(MAX_PROCEDURE_DESCRIPTION_LENGTH))).toHaveLength(4000);
    expect(codeOf(() => normalizeProcedureDescription('x'.repeat(MAX_PROCEDURE_DESCRIPTION_LENGTH + 1)))).toBe(
      'description_too_long',
    );
  });

  it('accepts only trusted icon keys', () => {
    expect(parseProcedureIcon('car')).toBe('car');
    for (const bad of ['', 'Car', '<svg onload=alert(1)>', 'https://example.org/i.png', '__proto__', 'constructor']) {
      expect(codeOf(() => parseProcedureIcon(bad))).toBe('invalid_icon');
    }
  });

  it('bounds tags', () => {
    expect(codeOf(() => normalizeProcedureTags(['ok', ' ']))).toBe('tag_empty');
    expect(codeOf(() => normalizeProcedureTags(['x'.repeat(33)]))).toBe('tag_too_long');
    expect(codeOf(() => normalizeProcedureTags(Array.from({ length: 11 }, (_, i) => `t${i}`)))).toBe('too_many_tags');
    expect(normalizeProcedureTags([...Array.from({ length: 10 }, (_, i) => `t${i}`), 'T0'])).toHaveLength(10);
  });

  it('parses only lower-case UUIDv4 ids', () => {
    expect(codeOf(() => parseProcedureId('1'))).toBe('invalid_procedure_id');
    expect(parseProcedureId('3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f')).toBe('3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f');
  });
});
