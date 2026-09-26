import type { EmailMessage } from '../ports/email-sender.ts';
import type { Invitation } from '@vergissmeinnicht/domain';

/** `publicOrigin` is the validated origin from configuration (scheme://host[:port], no path). */
export function invitationAcceptUrl(publicOrigin: string, token: string): string {
  // Token in the path, never in the query string (docu/security.md §4 applies to all link tokens).
  return `${publicOrigin}/invite/${token}`;
}

export function invitationEmail(
  invitation: Invitation,
  acceptUrl: string,
  inviterName: string | undefined,
): EmailMessage {
  const invitedBy = inviterName === undefined ? '' : ` by ${inviterName}`;
  return {
    to: invitation.email,
    subject: 'You are invited to Vergissmeinnicht',
    text: [
      `Hello,`,
      ``,
      `you have been invited${invitedBy} to create a Vergissmeinnicht account for ${invitation.email}.`,
      ``,
      `Open this link to choose your password:`,
      acceptUrl,
      ``,
      `The link can be used once and expires on ${invitation.expiresAt.toISOString()}.`,
      `If you did not expect this invitation, ignore this email; no account is created without the link.`,
    ].join('\n'),
  };
}
