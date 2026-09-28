import type { Invitation } from '@vergissmeinnicht/domain';
import { emailTextsEn } from '../email-texts/en.ts';
import type { EmailMessage } from '../ports/email-sender.ts';

/** `publicOrigin` is the validated origin from configuration (scheme://host[:port], no path). */
export function invitationAcceptUrl(publicOrigin: string, token: string): string {
  // Token in the path, never in the query string (docu/security.md §4 applies to all link tokens).
  return `${publicOrigin}/invite/${token}`;
}

export function invitationEmail(
  invitation: Invitation,
  acceptUrl: string,
  inviterName: string | undefined,
  texts = emailTextsEn,
): EmailMessage {
  return {
    to: invitation.email,
    subject: texts.invitation.subject,
    text: texts.invitation.body({
      email: invitation.email,
      inviterName,
      url: acceptUrl,
      expiresAt: invitation.expiresAt.toISOString(),
    }),
  };
}
