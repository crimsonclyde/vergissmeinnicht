import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AccountAlreadyExistsError,
  BootstrapNotAllowedError,
  EmailDeliveryError,
  InvalidInvitationError,
  InvitationNotRevocableError,
  NotAuthorizedError,
  bootstrapServerAdmin,
  issueInvitation,
  resolvePendingInvitation,
  revokeInvitation,
  type EmailMessage,
  type InvitationDeps,
} from '@vergissmeinnicht/application';
import { invitationTokens } from '@vergissmeinnicht/auth';
import { normalizeEmail, type User } from '@vergissmeinnicht/domain';
import { createInvitationRepository } from './invitation-repository.ts';
import { createTestDatabase } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';

const ORIGIN = 'https://vmn.example.org';
const LINK = /https:\/\/vmn\.example\.org\/invite\/([A-Za-z0-9_-]{43})/;

describe('invitation use-cases', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let deps: InvitationDeps;
  let outbox: EmailMessage[];
  let failDelivery: boolean;
  let now: Date;
  let admin: User;
  let member: User;

  const eventTypes = () =>
    (database.sqlite.prepare('SELECT type FROM security_events ORDER BY rowid').all() as { type: string }[]).map(
      (row) => row.type,
    );
  const tokenFromOutbox = () => LINK.exec(outbox.at(-1)?.text ?? '')?.[1] ?? '';

  beforeEach(async () => {
    database = createTestDatabase();
    outbox = [];
    failDelivery = false;
    now = new Date('2026-09-26T10:00:00Z');
    const users = createUserRepository(database);
    deps = {
      users,
      invitations: createInvitationRepository(database),
      tokens: invitationTokens,
      email: {
        async send(message) {
          if (failDelivery) throw new EmailDeliveryError('smtp_econnrefused');
          outbox.push(message);
        },
      },
      clock: { now: () => now },
      publicOrigin: ORIGIN,
      invitationTtlHours: 72,
    };
    const base = { emailVerified: true, status: 'ACTIVE' as const };
    admin = await users.create({ ...base, email: normalizeEmail('admin@example.org'), displayName: 'Ada Admin', serverAdmin: true });
    member = await users.create({ ...base, email: normalizeEmail('mia@example.org'), displayName: 'Mia', serverAdmin: false });
  });

  afterEach(() => database.dispose());

  const invite = (inviter: User = admin, email = 'bob@example.org') =>
    issueInvitation(deps, { inviter, email: normalizeEmail(email), grantsServerAdmin: false });

  describe('issueInvitation', () => {
    it('emails a one-time link to exactly the invited address and never returns the token', async () => {
      const result = await invite();
      expect(result.delivery).toBe('sent');
      expect(outbox).toHaveLength(1);
      expect(outbox[0]?.to).toBe('bob@example.org');
      expect(outbox[0]?.text).toContain('Ada Admin');
      const token = tokenFromOutbox();
      expect(token).toHaveLength(43);
      expect(JSON.stringify(result)).not.toContain(token);
      expect(await resolvePendingInvitation(deps, token)).toMatchObject({ id: result.invitation.id });
    });

    it('never stores the raw token', async () => {
      await invite();
      const token = tokenFromOutbox();
      const dump = JSON.stringify(database.sqlite.prepare('SELECT * FROM invitations').all()) +
        JSON.stringify(database.sqlite.prepare('SELECT * FROM security_events').all());
      expect(dump).not.toContain(token);
    });

    it('is refused for a non-admin USER', async () => {
      await expect(invite(member)).rejects.toBeInstanceOf(NotAuthorizedError);
      expect(outbox).toHaveLength(0);
      expect(eventTypes()).toEqual([]);
    });

    it('is refused for a DISABLED server admin', async () => {
      await expect(invite({ ...admin, status: 'DISABLED' })).rejects.toBeInstanceOf(NotAuthorizedError);
      expect(eventTypes()).toEqual([]);
    });

    it('is refused when an account already exists for the email', async () => {
      await expect(invite(admin, 'MIA@example.org')).rejects.toBeInstanceOf(AccountAlreadyExistsError);
      expect(outbox).toHaveLength(0);
    });

    it('keeps the invitation pending and audited when delivery fails', async () => {
      failDelivery = true;
      const result = await invite();
      expect(result.delivery).toBe('failed');
      expect(eventTypes()).toEqual(['INVITATION_CREATED']);
    });

    it('invalidates the previous link when re-inviting the same email', async () => {
      await invite();
      const first = tokenFromOutbox();
      await invite();
      const second = tokenFromOutbox();
      await expect(resolvePendingInvitation(deps, first)).rejects.toBeInstanceOf(InvalidInvitationError);
      await expect(resolvePendingInvitation(deps, second)).resolves.toBeDefined();
    });
  });

  describe('resolvePendingInvitation', () => {
    it.each(['', 'not-a-token', 'A'.repeat(43)])('rejects malformed or unknown token %#', async (token) => {
      await expect(resolvePendingInvitation(deps, token)).rejects.toBeInstanceOf(InvalidInvitationError);
    });

    it('rejects an expired token', async () => {
      await invite();
      now = new Date(now.getTime() + 72 * 3_600_000);
      await expect(resolvePendingInvitation(deps, tokenFromOutbox())).rejects.toBeInstanceOf(InvalidInvitationError);
    });

    it('rejects a revoked token with the same generic error', async () => {
      const { invitation } = await invite();
      await revokeInvitation(deps, { actor: admin, invitationId: invitation.id });
      const error = await resolvePendingInvitation(deps, tokenFromOutbox()).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(InvalidInvitationError);
      expect((error as Error).message).toBe('Invitation is invalid or has expired');
    });
  });

  describe('revokeInvitation', () => {
    it('is refused for a non-admin USER', async () => {
      const { invitation } = await invite();
      await expect(revokeInvitation(deps, { actor: member, invitationId: invitation.id })).rejects.toBeInstanceOf(
        NotAuthorizedError,
      );
      await expect(resolvePendingInvitation(deps, tokenFromOutbox())).resolves.toBeDefined();
    });

    it('cannot revoke twice', async () => {
      const { invitation } = await invite();
      await revokeInvitation(deps, { actor: admin, invitationId: invitation.id });
      await expect(revokeInvitation(deps, { actor: admin, invitationId: invitation.id })).rejects.toBeInstanceOf(
        InvitationNotRevocableError,
      );
    });
  });

  describe('bootstrapServerAdmin', () => {
    it('is refused once a server admin exists', async () => {
      await expect(bootstrapServerAdmin(deps, { email: normalizeEmail('root@example.org') })).rejects.toBeInstanceOf(
        BootstrapNotAllowedError,
      );
      expect(eventTypes()).toEqual([]);
    });

    it('issues an admin-granting invitation without email when no server admin exists', async () => {
      const fresh = createTestDatabase();
      try {
        const freshDeps = { ...deps, users: createUserRepository(fresh), invitations: createInvitationRepository(fresh) };
        const { invitation, acceptUrl } = await bootstrapServerAdmin(freshDeps, { email: normalizeEmail('Root@Example.org') });
        expect(invitation).toMatchObject({ email: 'root@example.org', grantsServerAdmin: true, invitedBy: undefined });
        expect(acceptUrl).toMatch(LINK);
        expect(outbox).toHaveLength(0);
        const token = LINK.exec(acceptUrl)?.[1] ?? '';
        expect(await resolvePendingInvitation(freshDeps, token)).toMatchObject({ id: invitation.id });
        const event = fresh.sqlite.prepare('SELECT actor_label, actor_user_id FROM security_events').get();
        expect(event).toEqual({ actor_label: 'cli:admin-bootstrap', actor_user_id: null });

        // A second bootstrap, even for another address, invalidates the first link.
        const second = await bootstrapServerAdmin(freshDeps, { email: normalizeEmail('other@example.org') });
        await expect(resolvePendingInvitation(freshDeps, token)).rejects.toBeInstanceOf(InvalidInvitationError);
        await expect(
          resolvePendingInvitation(freshDeps, LINK.exec(second.acceptUrl)?.[1] ?? ''),
        ).resolves.toMatchObject({ email: 'other@example.org' });
      } finally {
        fresh.dispose();
      }
    });
  });
});
