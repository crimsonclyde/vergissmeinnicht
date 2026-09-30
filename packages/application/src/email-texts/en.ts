import type { CatchUpTextInput, EmailTexts, ReminderTextInput } from './email-texts.ts';

/** Removes blank lines left by optional parts, never two blank lines in a row. */
const lines = (parts: readonly string[]) => parts.filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n');

/** "Thursday, 15 October 2026" — the calendar date as such, independent of any time zone. */
function longDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

/** Where the item stands now: "today", "tomorrow", "in 5 days", "in 3 hours", "overdue since …". */
function when(input: Omit<ReminderTextInput, 'url'>): string {
  if (input.daysUntil < 0) return `overdue since ${longDate(input.date)}`;
  if (input.hoursUntil !== null && input.hoursUntil >= 1 && input.daysUntil <= 1) return input.hoursUntil === 1 ? 'in 1 hour' : `in ${input.hoursUntil} hours`;
  if (input.daysUntil === 0) return 'today';
  return input.daysUntil === 1 ? 'tomorrow' : `in ${input.daysUntil} days`;
}

const dueAt = (input: Omit<ReminderTextInput, 'url'>) => `${longDate(input.date)}${input.time === null ? '' : `, ${input.time}`} (${input.timeZone})`;

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
    subject: (input) => `Reminder: ${input.title} — ${when(input)}`,
    body: (input) =>
      lines([
        `Reminder from VergissMeinNicht:`,
        ``,
        `${input.title}`,
        `${input.daysUntil < 0 ? 'Was due on' : 'Due on'} ${dueAt(input)} — ${when(input)}.`,
        `Workspace: ${input.workspaceName}`,
        ``,
        input.kind === 'PROCEDURE'
          ? `Open VergissMeinNicht to start it (you will be asked to sign in if needed):`
          : `Open VergissMeinNicht to mark it done (you will be asked to sign in if needed):`,
        input.url,
        ``,
        `You get this reminder because you are responsible for it or scheduled it. Change your reminder channels under Profile & settings → Notifications.`,
      ]),
  },
  catchUp: {
    subject: (input: CatchUpTextInput) => {
      const total = input.items.length + input.more;
      const first = input.items[0];
      return total === 1 && first !== undefined ? `Missed reminder: ${first.title} — ${when(first)}` : `Missed reminders: ${total} items need attention`;
    },
    body: (input: CatchUpTextInput) =>
      lines([
        `VergissMeinNicht could not send ${input.items.length + input.more === 1 ? 'this reminder' : 'these reminders'} on time (the server was unavailable). As of now:`,
        ``,
        ...input.items.map((item) => `- ${item.title} — ${item.daysUntil < 0 ? 'was due on' : 'due on'} ${dueAt(item)}, ${when(item)} (Workspace: ${item.workspaceName})`),
        input.more > 0 ? `- … and ${input.more} more` : '',
        ``,
        `Open VergissMeinNicht to see everything that needs attention (you will be asked to sign in if needed):`,
        input.url,
        ``,
        `Change your reminder channels under Profile & settings → Notifications.`,
      ]),
  },
  providerTest: {
    subject: 'VergissMeinNicht test notification',
    body: ({ provider }) => lines([`This is a test notification from VergissMeinNicht (${provider}).`, ``, `If you can read it, reminders can reach you this way.`]),
  },
};
