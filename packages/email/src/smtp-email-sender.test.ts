import type { AddressInfo } from 'node:net';
import { SMTPServer } from 'smtp-server';
import { afterEach, describe, expect, it } from 'vitest';
import { EmailDeliveryError } from '@vergissmeinnicht/application';
import { normalizeEmail, type NormalizedEmail } from '@vergissmeinnicht/domain';
import { createSmtpEmailSender, type SmtpSecurity } from './smtp-email-sender.ts';

interface Received {
  from: string;
  to: string[];
  raw: string;
}

let server: SMTPServer | undefined;

async function startServer(options: { offerStartTls: boolean }) {
  const received: Received[] = [];
  server = new SMTPServer({
    authOptional: true,
    hideSTARTTLS: !options.offerStartTls,
    disabledCommands: options.offerStartTls ? [] : ['STARTTLS'],
    logger: false,
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => {
        received.push({
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '',
          to: session.envelope.rcptTo.map((rcpt) => rcpt.address),
          raw: Buffer.concat(chunks).toString('utf8'),
        });
        callback();
      });
    },
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const port = (server.server.address() as AddressInfo).port;
  return { received, port };
}

function sender(port: number, security: SmtpSecurity = 'none') {
  return createSmtpEmailSender({
    host: '127.0.0.1',
    port,
    security,
    fromAddress: 'noreply@vergissmeinnicht.test',
    fromName: 'Vergissmeinnicht',
  });
}

const recipient = normalizeEmail('alice@example.org');

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

describe('SMTP email sender', () => {
  it('delivers a plain-text message to exactly the given recipient', async () => {
    const { received, port } = await startServer({ offerStartTls: false });
    await sender(port).send({ to: recipient, subject: 'Hello', text: 'Line 1\nLine 2' });

    expect(received).toHaveLength(1);
    const [message] = received;
    expect(message?.to).toEqual(['alice@example.org']);
    expect(message?.from).toBe('noreply@vergissmeinnicht.test');
    expect(message?.raw).toMatch(/^Subject: Hello$/m);
    expect(message?.raw).toMatch(/^Content-Type: text\/plain/m);
    expect(message?.raw).not.toMatch(/text\/html/);
  });

  it.each(['Hi\r\nBcc: mallory@evil.example', 'Hi\nX-Injected: 1', 'x'.repeat(201)])(
    'rejects a subject that could inject headers or is too long (%#)',
    async (subject) => {
      const { received, port } = await startServer({ offerStartTls: false });
      await expect(sender(port).send({ to: recipient, subject, text: 'body' })).rejects.toMatchObject({
        reason: 'invalid_subject',
      });
      expect(received).toHaveLength(0);
    },
  );

  it.each(['alice@example.org, mallory@evil.example', 'Alice@Example.org', 'alice@example.org\r\nBcc: x@y.z'])(
    'rejects a recipient that is not a single normalized address (%j)',
    async (to) => {
      const { received, port } = await startServer({ offerStartTls: false });
      await expect(
        sender(port).send({ to: to as NormalizedEmail, subject: 'Hi', text: 'body' }),
      ).rejects.toBeInstanceOf(Error);
      expect(received).toHaveLength(0);
    },
  );

  it('refuses to send in cleartext when STARTTLS is required but not offered', async () => {
    const { received, port } = await startServer({ offerStartTls: false });
    const error = await sender(port, 'starttls')
      .send({ to: recipient, subject: 'Secret link', text: 'token-in-body' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect(received).toHaveLength(0);
    const text = `${(error as Error).message} ${(error as EmailDeliveryError).reason}`;
    expect(text).not.toContain('alice@example.org');
    expect(text).not.toContain('token-in-body');
  });

  it('reports connection failures without leaking message details', async () => {
    const { port } = await startServer({ offerStartTls: false });
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
    const error = await sender(port)
      .send({ to: recipient, subject: 'Hi', text: 'token-in-body' })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect((error as EmailDeliveryError).reason).toMatch(/^smtp_/);
  });
});
