import { describe, expect, it } from 'vitest';
import { WORKSPACE_ROLES, type User } from '@vergissmeinnicht/domain';
import {
  WORKSPACE_CAPABILITIES,
  canCreateWorkspace,
  capabilitiesOf,
  roleHasCapability,
  rolesWithCapability,
} from './index.ts';

describe('Workspace role policy', () => {
  it('matches the reviewed capability matrix exactly', () => {
    // Changing this table is a security-relevant change: update docu/security.md §3 as well.
    const matrix = Object.fromEntries(WORKSPACE_ROLES.map((role) => [role, capabilitiesOf(role)]));
    expect(matrix).toEqual({
      GUEST: ['workspace.view', 'procedure.view', 'run.view'],
      USER: ['workspace.view', 'workspace.members.view', 'procedure.view', 'run.view', 'run.start', 'run.execute', 'run.abort', 'schedule.manage'],
      EDITOR: [
        'workspace.view',
        'workspace.members.view',
        'procedure.view',
        'procedure.edit',
        'procedure.restore',
        'run.view',
        'run.start',
        'run.execute',
        'run.abort',
        'knot.manage',
        'schedule.manage',
      ],
      ADMIN: [...WORKSPACE_CAPABILITIES],
    });
  });

  it('keeps GUEST read-only', () => {
    for (const capability of capabilitiesOf('GUEST')) expect(capability).toMatch(/\.view$/);
  });

  it('lets only EDITOR and ADMIN author Procedures, and USER and above execute Runs', () => {
    expect(rolesWithCapability('procedure.edit')).toEqual(['EDITOR', 'ADMIN']);
    expect(rolesWithCapability('procedure.restore')).toEqual(['EDITOR', 'ADMIN']);
    expect(rolesWithCapability('knot.manage')).toEqual(['EDITOR', 'ADMIN']);
    for (const capability of ['run.start', 'run.execute', 'run.abort', 'schedule.manage'] as const) {
      expect(rolesWithCapability(capability)).toEqual(['USER', 'EDITOR', 'ADMIN']);
    }
  });

  it('is monotonic: a higher role never loses a capability of a lower one', () => {
    WORKSPACE_ROLES.slice(1).forEach((higher, i) => {
      const lower = WORKSPACE_ROLES[i] ?? 'GUEST';
      for (const capability of WORKSPACE_CAPABILITIES) {
        if (roleHasCapability(lower, capability)) expect(roleHasCapability(higher, capability)).toBe(true);
      }
    });
  });

  it('only lets ADMIN manage members', () => {
    expect(rolesWithCapability('workspace.members.manage')).toEqual(['ADMIN']);
  });

  it('rejects unknown roles instead of granting anything', () => {
    expect(() => roleHasCapability('OWNER' as never, 'workspace.view')).toThrow();
  });
});

describe('canCreateWorkspace', () => {
  const user = (serverAdmin: boolean, status: User['status']) => ({ serverAdmin, status });

  it('allows only ACTIVE server admins', () => {
    expect(canCreateWorkspace(user(true, 'ACTIVE'))).toBe(true);
    expect(canCreateWorkspace(user(true, 'DISABLED'))).toBe(false);
    expect(canCreateWorkspace(user(false, 'ACTIVE'))).toBe(false);
  });
});
