import { describe, expect, it } from 'vitest';
import { RUN_STATES, STEP_STATES, WORKSPACE_ROLES } from './index.ts';

describe('domain vocabulary', () => {
  it('defines the V1 Run states', () => {
    expect(RUN_STATES).toEqual(['ACTIVE', 'COMPLETED', 'ABORTED']);
  });

  it('keeps SKIPPED and NOT_APPLICABLE as distinct Step states', () => {
    expect(STEP_STATES).toEqual(['PENDING', 'DONE', 'SKIPPED', 'NOT_APPLICABLE']);
  });

  it('defines the initial Workspace roles', () => {
    expect(WORKSPACE_ROLES).toEqual(['GUEST', 'USER', 'EDITOR', 'ADMIN']);
  });
});
