import { describe, expect, it } from 'vitest';
import { emailTextsEn } from './en.ts';

describe('English email texts', () => {
  it('builds the invitation with and without an inviter', () => {
    const base = { email: 'bob@example.org', url: 'https://vmn.example.org/invite/x', expiresAt: '2026-10-01T10:00:00.000Z' };
    expect(emailTextsEn.invitation.body({ ...base, inviterName: 'Ada' })).toContain('invited by Ada to create a VergissMeinNicht account for bob@example.org.');
    expect(emailTextsEn.invitation.body({ ...base, inviterName: undefined })).toContain('you have been invited to create');
  });

  it('names what the recovery does and never leaves double blank lines', () => {
    const base = { displayName: 'Bob', adminName: 'Ada', url: 'https://vmn.example.org/recover/x', expiresAt: '2026-10-01T10:00:00.000Z' };
    const both = emailTextsEn.recovery.body({ ...base, resetPassword: true, resetTotp: true });
    expect(both).toContain('to choose a new password and remove your two-factor authentication:');
    expect(both).not.toContain('current password');
    const totpOnly = emailTextsEn.recovery.body({ ...base, resetPassword: false, resetTotp: true });
    expect(totpOnly).toContain('You will need your current password to complete it.');
    for (const text of [both, totpOnly]) expect(text).not.toContain('\n\n\n');
  });
});
