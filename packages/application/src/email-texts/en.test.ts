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

  it('writes reminders with the date in words, the zone, the Workspace and a plain link', () => {
    const base = {
      procedureTitle: 'Buy groceries',
      workspaceName: 'Home',
      date: '2026-10-15',
      time: null,
      timeZone: 'Europe/Berlin',
      url: 'https://vmn.example.org/w/0f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f',
      overdue: false,
    };
    expect(emailTextsEn.reminder.subject({ ...base, reminderKey: 'DAYS:7' })).toBe('Reminder: Buy groceries — in 7 days');
    expect(emailTextsEn.reminder.subject({ ...base, reminderKey: 'DAYS:1' })).toBe('Reminder: Buy groceries — tomorrow');
    expect(emailTextsEn.reminder.subject({ ...base, reminderKey: 'DAYS:0' })).toBe('Reminder: Buy groceries — today');
    expect(emailTextsEn.reminder.subject({ ...base, reminderKey: 'HOURS:2', time: '18:00' })).toBe('Reminder: Buy groceries — in 2 hours');
    const body = emailTextsEn.reminder.body({ ...base, reminderKey: 'DAYS:1', time: '18:00' });
    expect(body).toContain('Scheduled for Thursday, 15 October 2026, 18:00 (Europe/Berlin) — tomorrow.');
    expect(body).toContain('Workspace: Home');
    expect(body).toContain(base.url);
    expect(body).not.toContain('\n\n\n');
  });
});
