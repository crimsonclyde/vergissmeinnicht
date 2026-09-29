import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AccountAlreadyExistsError,
  BootstrapNotAllowedError,
  EmailDeliveryError,
  InvalidInvitationError,
  InvitationNotRevocableError,
  NotAuthorizedError,
  acceptInvitation,
  bootstrapServerAdmin,
  issueInvitation,
  listPendingInvitations,
  resolvePendingInvitation,
  revokeInvitation,
  type EmailMessage,
  type InvitationDeps,
} from '@vergissmeinnicht/application';
import { commonPasswords, invitationTokens, passwordHasher } from '@vergissmeinnicht/auth';
import { DomainValidationError, normalizeEmail, type User } from '@vergissmeinnicht/domain';
import { createInvitationRepository } from './invitation-repository.ts';
import { createTestDatabase } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';

const ORIGIN = 'https://vmn.example.org';
const PASSWORD = 'a long enough passphrase';
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
      passwords: passwordHasher,
      commonPasswords,
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

  describe('acceptInvitation', () => {
    const accept = (token: string, overrides: { displayName?: string; password?: string } = {}) =>
      acceptInvitation(deps, { token, displayName: 'Bob', password: PASSWORD, ...overrides });

    it('creates a verified user with an Argon2id credential and consumes the invitation', async () => {
      const { invitation } = await invite();
      const token = tokenFromOutbox();
      const user = await accept(token, { displayName: '  Bob Builder ' });
      expect(user).toMatchObject({
        email: 'bob@example.org',
        displayName: 'Bob Builder',
        emailVerified: true,
        status: 'ACTIVE',
        serverAdmin: false,
      });
      const account = database.sqlite
        .prepare('SELECT provider_id, account_id, password FROM accounts WHERE user_id = ?')
        .get(user.id) as { provider_id: string; account_id: string; password: string };
      expect(account.provider_id).toBe('credential');
      expect(account.account_id).toBe(user.id);
      expect(account.password).toMatch(/^\$argon2id\$/);
      expect(account.password).not.toContain(PASSWORD);
      expect(eventTypes()).toEqual(['INVITATION_CREATED', 'INVITATION_ACCEPTED', 'USER_CREATED']);
      const accepted = database.sqlite
        .prepare('SELECT accepted_user_id FROM invitations WHERE id = ?')
        .get(invitation.id) as { accepted_user_id: string };
      expect(accepted.accepted_user_id).toBe(user.id);
    });

    it('cannot be replayed', async () => {
      await invite();
      const token = tokenFromOutbox();
      await accept(token);
      await expect(accept(token, { displayName: 'Mallory' })).rejects.toBeInstanceOf(InvalidInvitationError);
      expect(database.sqlite.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 3 });
    });

    it('creates at most one user when accepted concurrently', async () => {
      await invite();
      const token = tokenFromOutbox();
      const results = await Promise.allSettled([accept(token), accept(token), accept(token)]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      for (const result of results) {
        if (result.status === 'rejected') expect(result.reason).toBeInstanceOf(InvalidInvitationError);
      }
      expect(database.sqlite.prepare("SELECT count(*) AS n FROM users WHERE email = 'bob@example.org'").get()).toEqual({ n: 1 });
      expect(eventTypes().filter((type) => type === 'USER_CREATED')).toHaveLength(1);
    });

    it.each([
      ['expired', async () => { now = new Date(now.getTime() + 72 * 3_600_000); }],
      ['revoked', async (id: string) => revokeInvitation(deps, { actor: admin, invitationId: id as never })],
      ['superseded', async () => { await invite(); }],
    ])('rejects a %s invitation without hashing the password', async (_label, invalidate) => {
      const { invitation } = await invite();
      const token = tokenFromOutbox();
      await invalidate(invitation.id);
      let hashed = 0;
      deps = { ...deps, passwords: { hash: async (password) => { hashed++; return passwordHasher.hash(password); } } };
      await expect(accept(token)).rejects.toBeInstanceOf(InvalidInvitationError);
      expect(hashed).toBe(0);
    });

    it('rejects weak passwords and invalid display names, leaving the invitation pending', async () => {
      await invite();
      const token = tokenFromOutbox();
      await expect(accept(token, { password: 'short-password' })).rejects.toMatchObject({ code: 'password_too_short' });
      await expect(accept(token, { password: 'x'.repeat(129) })).rejects.toMatchObject({ code: 'password_too_long' });
      // Offline common/breached-password list and context words (13.3): the invited email, the chosen name.
      await expect(accept(token, { password: 'correcthorsebatterystaple' })).rejects.toMatchObject({ code: 'password_too_common' });
      await expect(accept(token, { password: 'qwertyuiopasdfghjkl' })).rejects.toMatchObject({ code: 'password_too_common' });
      await expect(accept(token, { password: 'bob@example.org!!' })).rejects.toMatchObject({ code: 'password_too_predictable' });
      await expect(accept(token, { displayName: 'Robert Tables', password: 'Robert Tables 1234' })).rejects.toMatchObject({
        code: 'password_too_predictable',
      });
      await expect(accept(token, { displayName: 'evil\u202Eeman' })).rejects.toBeInstanceOf(DomainValidationError);
      await expect(resolvePendingInvitation(deps, token)).resolves.toBeDefined();
    });

    it('fails if an account for the email appeared after the invitation was issued', async () => {
      await invite();
      const token = tokenFromOutbox();
      await deps.users.create({
        email: normalizeEmail('bob@example.org'),
        displayName: 'Other Bob',
        emailVerified: true,
        status: 'ACTIVE',
        serverAdmin: false,
      });
      await expect(accept(token)).rejects.toBeInstanceOf(InvalidInvitationError);
    });

    it('grants server admin only through a bootstrap link, and only while no server admin exists', async () => {
      const fresh = createTestDatabase();
      try {
        const freshDeps = { ...deps, users: createUserRepository(fresh), invitations: createInvitationRepository(fresh) };
        const first = await bootstrapServerAdmin(freshDeps, { email: normalizeEmail('root@example.org') });
        const firstToken = LINK.exec(first.acceptUrl)?.[1] ?? '';

        // Simulate an admin appearing by another path (e.g. a concurrent bootstrap acceptance).
        const other = await createUserRepository(fresh).create({
          email: normalizeEmail('other-admin@example.org'),
          displayName: 'Other Admin',
          emailVerified: true,
          status: 'ACTIVE',
          serverAdmin: true,
        });
        expect(other.serverAdmin).toBe(true);
        await expect(resolvePendingInvitation(freshDeps, firstToken)).rejects.toBeInstanceOf(InvalidInvitationError);
        await expect(
          acceptInvitation(freshDeps, { token: firstToken, displayName: 'Root', password: PASSWORD }),
        ).rejects.toBeInstanceOf(InvalidInvitationError);
      } finally {
        fresh.dispose();
      }
    });

    it('makes the bootstrap invitee a server admin', async () => {
      const fresh = createTestDatabase();
      try {
        const freshDeps = { ...deps, users: createUserRepository(fresh), invitations: createInvitationRepository(fresh) };
        const { acceptUrl } = await bootstrapServerAdmin(freshDeps, { email: normalizeEmail('root@example.org') });
        const user = await acceptInvitation(freshDeps, {
          token: LINK.exec(acceptUrl)?.[1] ?? '',
          displayName: 'Root',
          password: PASSWORD,
        });
        expect(user.serverAdmin).toBe(true);
      } finally {
        fresh.dispose();
      }
    });
  });

  describe('listPendingInvitations', () => {
    it('lists only pending invitations, for server admins only', async () => {
      const { invitation } = await invite();
      await invite(admin, 'carol@example.org');
      await revokeInvitation(deps, { actor: admin, invitationId: invitation.id });
      const pending = await listPendingInvitations(deps, { actor: admin });
      expect(pending.map((entry) => entry.email)).toEqual(['carol@example.org']);
      await expect(listPendingInvitations(deps, { actor: member })).rejects.toBeInstanceOf(NotAuthorizedError);
    });
  });
});
