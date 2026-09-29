import type { EmailTexts, ReminderTextInput } from './email-texts.ts';

/** Removes blank lines left by optional parts, never two blank lines in a row. */
const lines = (parts: readonly string[]) => parts.filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n');

/** "Thursday, 15 October 2026" — the calendar date as such, independent of any time zone. */
function longDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function when(input: ReminderTextInput): string {
  if (input.overdue) return 'overdue';
  const [unit, raw] = input.reminderKey.split(':');
  const amount = Number(raw);
  if (unit === 'DAYS') return amount === 0 ? 'today' : amount === 1 ? 'tomorrow' : `in ${amount} days`;
  return amount === 1 ? 'in 1 hour' : `in ${amount} hours`;
}

const dueAt = (input: ReminderTextInput) => `${longDate(input.date)}${input.time === null ? '' : `, ${input.time}`} (${input.timeZone})`;

export const emailTextsEn: EmailTexts = {
  invitation: {
    subject: 'You are invited to VergissMeinNicht',
    body: ({ email, inviterName, url, expiresAt }) =>
      lines([
        `Hello,`,
        ``,
        `you have been invited${inviterName === undefined ? '' : ` by ${inviterName}`} to create a VergissMeinNicht account for ${email}.`,
        ``,
        `Open this link to choose your password:`,
        url,
        ``,
        `The link can be used once and expires on ${expiresAt}.`,
        `If you did not expect this invitation, ignore this email; no account is created without the link.`,
      ]),
  },
  recovery: {
    subject: 'VergissMeinNicht account recovery',
    body: ({ displayName, adminName, resetPassword, resetTotp, url, expiresAt }) => {
      const what = [resetPassword && 'choose a new password', resetTotp && 'remove your two-factor authentication']
        .filter(Boolean)
        .join(' and ');
      return lines([
        `Hello ${displayName},`,
        ``,
        `${adminName} started a recovery of your VergissMeinNicht account. Open this link to ${what}:`,
        url,
        ``,
        `The link can be used once and expires on ${expiresAt}.`,
        resetPassword ? '' : 'You will need your current password to complete it.',
        `If you did not ask for this, do not open the link and contact your administrator.`,
      ]);
    },
  },
  reminder: {
    subject: (input) => `Reminder: ${input.procedureTitle} — ${when(input)}`,
    body: (input) =>
      lines([
        `Reminder from VergissMeinNicht:`,
        ``,
        `${input.procedureTitle}`,
        `Scheduled for ${dueAt(input)} — ${when(input)}.`,
        `Workspace: ${input.workspaceName}`,
        ``,
        `Open VergissMeinNicht to start it (you will be asked to sign in if needed):`,
        input.url,
        ``,
        `You get this reminder because you scheduled this Procedure. Change your reminder channels under Profile & settings → Notifications.`,
      ]),
  },
  providerTest: {
    subject: 'VergissMeinNicht test notification',
    body: ({ provider }) => lines([`This is a test notification from VergissMeinNicht (${provider}).`, ``, `If you can read it, reminders can reach you this way.`]),
  },
};
