import type { NormalizedEmail } from '@vergissmeinnicht/domain';

/** Plain-text transactional email. No HTML in V1: nothing user-controlled is ever rendered as markup. */
export interface EmailMessage {
  readonly to: NormalizedEmail;
  readonly subject: string;
  readonly text: string;
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
