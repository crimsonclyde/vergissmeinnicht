import { describe, expect, it } from 'vitest';
import { DomainValidationError, normalizeWorkspaceName, parseWorkspaceId } from './index.ts';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof DomainValidationError) return error.code;
    throw error;
  }
  throw new Error('expected a DomainValidationError');
}

describe('normalizeWorkspaceName', () => {
  it('trims and NFC-normalizes', () => {
    expect(normalizeWorkspaceName('  Café Kitchen ')).toBe('Café Kitchen');
  });

  it('rejects empty, over-long and spoofable names', () => {
    expect(codeOf(() => normalizeWorkspaceName('   '))).toBe('workspace_name_empty');
    expect(codeOf(() => normalizeWorkspaceName('x'.repeat(81)))).toBe('workspace_name_too_long');
    expect(normalizeWorkspaceName('🌼'.repeat(80))).toHaveLength(160);
    expect(codeOf(() => normalizeWorkspaceName('Home‮emoh'))).toBe('workspace_name_invalid_characters');
    expect(codeOf(() => normalizeWorkspaceName('Line\nbreak'))).toBe('workspace_name_invalid_characters');
  });

  it('never echoes the input in error messages', () => {
    try {
      normalizeWorkspaceName(`secret-ish\u0007${'y'.repeat(10)}`);
    } catch (error) {
      expect((error as Error).message).not.toContain('secret-ish');
    }
  });
});

describe('parseWorkspaceId', () => {
  it('accepts lower-case UUIDv4 only', () => {
    expect(parseWorkspaceId('3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f')).toBe('3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f');
    for (const value of ['1', '3F1C2B9A-6D4E-4F8A-9B7C-1A2B3C4D5E6F', "' or 1=1 --", '3f1c2b9a-6d4e-1f8a-9b7c-1a2b3c4d5e6f']) {
      expect(codeOf(() => parseWorkspaceId(value))).toBe('invalid_workspace_id');
    }
  });
});
