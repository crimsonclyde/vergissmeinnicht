import { describe, expect, it } from 'vitest';
import { menuLinks } from './UserMenu.tsx';

describe('user menu', () => {
  it('offers server administration only to server admins', () => {
    expect(menuLinks({ serverAdmin: false }).map((link) => link.href)).toEqual(['/account']);
    expect(menuLinks({ serverAdmin: true }).map((link) => link.href)).toEqual(['/account', '/admin']);
  });
});
