import { describe, expect, it } from 'vitest';
import { settingsLinks } from './SettingsMenu.tsx';

const W = '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f';

describe('Settings menu', () => {
  it('offers Server admin only to server admins', () => {
    expect(settingsLinks({ serverAdmin: false }, W).map((link) => link.href)).toEqual(['/account', `/w/${W}/settings`]);
    expect(settingsLinks({ serverAdmin: true }, W).map((link) => link.href)).toEqual(['/account', `/w/${W}/settings`, '/admin']);
    expect(settingsLinks({ serverAdmin: true }, W).at(-1)).toMatchObject({ note: 'menu.adminOnly' });
  });

  it('offers Workspace settings only while a Workspace is open', () => {
    expect(settingsLinks({ serverAdmin: false }, null).map((link) => link.href)).toEqual(['/account']);
    expect(settingsLinks({ serverAdmin: true }, null).map((link) => link.href)).toEqual(['/account', '/admin']);
  });
});
