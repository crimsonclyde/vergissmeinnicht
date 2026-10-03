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
    // Changing this table is a security-relevant change: update docs/development/security.md §3 as well.
    const matrix = Object.fromEntries(WORKSPACE_ROLES.map((role) => [role, capabilitiesOf(role)]));
    expect(matrix).toEqual({
      GUEST: ['workspace.view', 'procedure.view', 'run.view', 'list.view', 'document.view', 'contact.view', 'maintenance.view'],
      USER: ['workspace.view', 'workspace.members.view', 'procedure.view', 'run.view', 'run.start', 'run.execute', 'run.abort', 'schedule.manage', 'list.view', 'list.edit', 'document.view', 'document.manage', 'contact.view', 'contact.manage', 'contact.export', 'maintenance.view', 'maintenance.manage'],
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
        'list.view',
        'list.edit',
        'document.view',
        'document.manage',
        'contact.view',
        'contact.manage',
        'contact.export',
        'maintenance.view',
        'maintenance.manage',
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
    for (const capability of ['run.start', 'run.execute', 'run.abort', 'schedule.manage', 'list.edit', 'document.manage'] as const) {
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

  it('only lets ADMIN manage members and switch tools', () => {
    expect(rolesWithCapability('workspace.members.manage')).toEqual(['ADMIN']);
    expect(rolesWithCapability('workspace.tools.manage')).toEqual(['ADMIN']);
    // Deleting for good is an admin's decision (16.4): a USER or Editor restores from Trash, never empties it.
    expect(rolesWithCapability('document.purge')).toEqual(['ADMIN']);
    // Removing what a finished Run keeps (P4): an admin's decision, with a reason.
    expect(rolesWithCapability('run.document.remove')).toEqual(['ADMIN']);
    // Contacts (16.6): everyone reads; USER and above change, import and export; only an admin deletes for good.
    expect(rolesWithCapability('contact.view')).toEqual(['GUEST', 'USER', 'EDITOR', 'ADMIN']);
    expect(rolesWithCapability('contact.manage')).toEqual(['USER', 'EDITOR', 'ADMIN']);
    expect(rolesWithCapability('contact.export')).toEqual(['USER', 'EDITOR', 'ADMIN']);
    expect(rolesWithCapability('contact.purge')).toEqual(['ADMIN']);
    // Maintenance (16.7): guests see it, costs included (P3, decided 2026-10-02); USER and above change it; only an admin deletes for good.
    expect(rolesWithCapability('maintenance.view')).toEqual(['GUEST', 'USER', 'EDITOR', 'ADMIN']);
    expect(rolesWithCapability('maintenance.manage')).toEqual(['USER', 'EDITOR', 'ADMIN']);
    expect(rolesWithCapability('maintenance.purge')).toEqual(['ADMIN']);
    expect(rolesWithCapability('workspace.settings.manage')).toEqual(['ADMIN']); // also: the Workspace's storage limit
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
