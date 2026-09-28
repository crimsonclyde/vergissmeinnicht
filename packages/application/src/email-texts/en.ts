import type { EmailTexts } from './email-texts.ts';

/** Removes blank lines left by optional parts, never two blank lines in a row. */
const lines = (parts: readonly string[]) => parts.filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n');

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
};
