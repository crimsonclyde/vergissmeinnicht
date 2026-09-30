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

  it('writes reminders with the current status, the date in words, the zone, the Workspace and a plain link', () => {
    const base = {
      kind: 'PROCEDURE' as const,
      title: 'Buy groceries',
      workspaceName: 'Home',
      date: '2026-10-15',
      time: null,
      timeZone: 'Europe/Berlin',
      url: 'https://vmn.example.org/w/0f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f',
      daysUntil: 7,
      hoursUntil: null,
    };
    expect(emailTextsEn.reminder.subject(base)).toBe('Reminder: Buy groceries — in 7 days');
    expect(emailTextsEn.reminder.subject({ ...base, daysUntil: 1 })).toBe('Reminder: Buy groceries — tomorrow');
    expect(emailTextsEn.reminder.subject({ ...base, daysUntil: 0 })).toBe('Reminder: Buy groceries — today');
    expect(emailTextsEn.reminder.subject({ ...base, daysUntil: 0, time: '18:00', hoursUntil: 2 })).toBe('Reminder: Buy groceries — in 2 hours');
    expect(emailTextsEn.reminder.subject({ ...base, daysUntil: -3 })).toBe('Reminder: Buy groceries — overdue since Thursday, 15 October 2026');
    const body = emailTextsEn.reminder.body({ ...base, daysUntil: 1, time: '18:00' });
    expect(body).toContain('Due on Thursday, 15 October 2026, 18:00 (Europe/Berlin) — tomorrow.');
    expect(body).toContain('to start it');
    expect(body).toContain('Workspace: Home');
    expect(body).toContain(base.url);
    expect(body).not.toContain('\n\n\n');
    expect(emailTextsEn.reminder.body({ ...base, kind: 'REMINDER', title: 'Pay annual tax' })).toContain('to mark it done');
  });

  it('writes one bounded catch-up summary describing each item as it stands now (D5)', () => {
    const item = { kind: 'REMINDER' as const, title: 'Pay annual tax', workspaceName: 'Home', date: '2027-06-15', time: null, timeZone: 'Europe/Berlin', daysUntil: 29, hoursUntil: null };
    const one = { items: [item], more: 0, url: 'https://vmn.example.org/' };
    expect(emailTextsEn.catchUp.subject(one)).toBe('Missed reminder: Pay annual tax — in 29 days');
    expect(emailTextsEn.catchUp.body(one)).toContain('- Pay annual tax — due on Tuesday, 15 June 2027 (Europe/Berlin), in 29 days (Workspace: Home)');
    expect(emailTextsEn.catchUp.body(one)).not.toMatch(/1 month|month before/);
    const many = { items: Array.from({ length: 10 }, () => ({ ...item, daysUntil: -2 })), more: 20, url: 'https://vmn.example.org/' };
    expect(emailTextsEn.catchUp.subject(many)).toBe('Missed reminders: 30 items need attention');
    const body = emailTextsEn.catchUp.body(many);
    expect(body).toContain('was due on Tuesday, 15 June 2027 (Europe/Berlin), overdue since Tuesday, 15 June 2027');
    expect(body).toContain('- … and 20 more');
    expect(body.split('\n').filter((line) => line.startsWith('- Pay'))).toHaveLength(10);
  });
});
