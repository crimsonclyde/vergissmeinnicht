import type { NormalizedEmail } from '@vergissmeinnicht/domain';

/** Plain-text transactional email. No HTML in V1: nothing user-controlled is ever rendered as markup. */
export interface EmailMessage {
  readonly to: NormalizedEmail;
  readonly subject: string;
  readonly text: string;
  /**
   * Optional stable `Message-ID` (`<local@host>`), e.g. derived from a reminder's logical key, so a
   * repeated delivery after a crash is recognisable as the same message (14.1).
   */
  readonly messageId?: string | undefined;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

/** Delivery failed. Deliberately carries no recipient, body or SMTP transcript. */
export class EmailDeliveryError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super('Email delivery failed');
    this.name = 'EmailDeliveryError';
    this.reason = reason;
  }
}
