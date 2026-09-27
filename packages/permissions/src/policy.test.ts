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
    expect(Object.fromEntries(WORKSPACE_ROLES.map((role) => [role, capabilitiesOf(role)]))).toEqual({
      GUEST: ['workspace.view'],
      USER: ['workspace.view', 'workspace.members.view'],
      EDITOR: ['workspace.view', 'workspace.members.view'],
      ADMIN: ['workspace.view', 'workspace.members.view', 'workspace.members.manage', 'workspace.settings.manage'],
    });
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
