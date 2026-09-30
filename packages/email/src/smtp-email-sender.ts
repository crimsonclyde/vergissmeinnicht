import { createTransport } from 'nodemailer';
import { EmailDeliveryError, type EmailMessage, type EmailSender } from '@vergissmeinnicht/application';
import { normalizeEmail } from '@vergissmeinnicht/domain';

/** `tls`: implicit TLS (usually port 465). `starttls`: upgrade required (usually 587). `none`: loopback/dev only. */
export type SmtpSecurity = 'tls' | 'starttls' | 'none';

export interface SmtpOptions {
  readonly host: string;
  readonly port: number;
  readonly security: SmtpSecurity;
  /** Credentials, if the server requires authentication. `password` is read only here. */
  readonly auth?: { readonly user: string; readonly password: { reveal(): string } } | undefined;
  readonly fromAddress: string;
  readonly fromName: string;
}

const MAX_SUBJECT_LENGTH = 200;
const LINE_BREAK = /[\r\n]/;
/** A Message-ID we generate ourselves: angle brackets around a safe local part and host, nothing else. */
const MESSAGE_ID = /^<[A-Za-z0-9._-]{1,120}@[A-Za-z0-9.-]{1,120}>$/;

export function createSmtpEmailSender(options: SmtpOptions): EmailSender {
  const transport = createTransport({
    host: options.host,
    port: options.port,
    secure: options.security === 'tls',
    requireTLS: options.security === 'starttls',
    ignoreTLS: options.security === 'none',
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    ...(options.auth ? { auth: { user: options.auth.user, pass: options.auth.password.reveal() } } : {}),
    // Messages never reference files or URLs; close nodemailer's content-loading paths entirely.
    disableFileAccess: true,
    disableUrlAccess: true,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    logger: false,
    debug: false,
  });
  const from = { name: options.fromName, address: normalizeEmail(options.fromAddress) };

  return {
    async send(message: EmailMessage) {
      // Re-validate at the trust boundary: the recipient must be a single normalized address,
      // and the subject must not be able to inject headers.
      if (normalizeEmail(message.to) !== message.to) {
        throw new EmailDeliveryError('invalid_recipient');
      }
      if (LINE_BREAK.test(message.subject) || message.subject.length > MAX_SUBJECT_LENGTH) {
        throw new EmailDeliveryError('invalid_subject');
      }
      if (message.messageId !== undefined && !MESSAGE_ID.test(message.messageId)) {
        throw new EmailDeliveryError('invalid_message_id');
      }
      try {
        await transport.sendMail({
          from,
          to: { name: '', address: message.to },
          subject: message.subject,
          text: message.text,
          ...(message.messageId === undefined ? {} : { messageId: message.messageId }),
          disableFileAccess: true,
          disableUrlAccess: true,
        });
      } catch (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'unknown';
        throw new EmailDeliveryError(`smtp_${code.toLowerCase()}`);
      }
    },
  };
}
