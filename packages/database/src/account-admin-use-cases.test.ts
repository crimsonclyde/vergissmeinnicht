import { randomUUID } from 'node:crypto';
import { TOTP } from 'otpauth';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AccountStatusUnchangedError,
  NotAuthorizedError,
  ReauthenticationFailedError,
  SecondFactorRequiredError,
  SoleWorkspaceManagerError,
  UnknownAccountError,
  addMember,
  confirmTotpEnrollment,
  createWorkspace,
  listAccounts,
  listSecurityEvents,
  InvalidCursorError,
  setAccountStatus,
  startTotpEnrollment,
  type AccountAdminDeps,
  type MfaDeps,
  type WorkspaceDeps,
} from '@vergissmeinnicht/application';
import { createSecretBox, hashPassword, invitationTokens, recoveryCodes, totpAlgorithm, verifyPassword } from '@vergissmeinnicht/auth';
import { DomainValidationError, normalizeEmail, type User, type UserStatus } from '@vergissmeinnicht/domain';
import { createAccountAdminRepository } from './account-admin-repository.ts';
import { createSecurityEventReader } from './security-events.ts';
import { createMfaChallengeRepository, createTotpRepository } from './mfa-repository.ts';
import { createTestDatabase } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';
import { createConfiguredWorkspaceRepository as createWorkspaceRepository } from './test-support.ts';

const ADMIN_PASSWORD = 'admin passphrase for status';
const PASSWORD = 'member passphrase 12345';

describe('account status administration', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let deps: AccountAdminDeps;
  let workspaceDeps: WorkspaceDeps;
  let mfa: MfaDeps;
  let now: Date;
  let admin: User;
  let bob: User;

  const statusOf = (user: User) =>
    (database.sqlite.prepare('SELECT status FROM users WHERE id = ?').get(user.id) as { status: UserStatus }).status;
  const events = () =>
    database.sqlite.prepare('SELECT type, subject_id AS subjectId, metadata FROM security_events ORDER BY rowid').all() as {
      type: string;
      subjectId: string;
      metadata: string | null;
    }[];
  const sessionCount = (user: User) =>
    (database.sqlite.prepare('SELECT count(*) AS n FROM sessions WHERE user_id = ?').get(user.id) as { n: number }).n;
  const passwordOf = (userId: string) =>
    (database.sqlite.prepare("SELECT password FROM accounts WHERE user_id = ? AND provider_id = 'credential'").get(userId) as {
      password: string;
    }).password;

  async function createUser(email: string, name: string, password: string, serverAdmin = false): Promise<User> {
    const user = await createUserRepository(database).create({
      email: normalizeEmail(email),
      displayName: name,
      emailVerified: true,
      status: 'ACTIVE',
      serverAdmin,
    });
    database.sqlite
      .prepare("INSERT INTO accounts (id, account_id, provider_id, user_id, password) VALUES (?, ?, 'credential', ?, ?)")
      .run(randomUUID(), user.id, user.id, await hashPassword(password));
    return user;
  }

  function addSession(user: User) {
    database.sqlite
      .prepare('INSERT INTO sessions (id, token, user_id, expires_at) VALUES (?, ?, ?, ?)')
      .run(randomUUID(), randomUUID(), user.id, Date.now() + 86_400_000);
  }

  const change = (userId: string, status: UserStatus, actor = admin, password = ADMIN_PASSWORD, factor?: { code: string }) =>
    setAccountStatus(deps, { admin: actor, adminPassword: password, adminFactor: factor, userId, status });

  beforeEach(async () => {
    database = createTestDatabase();
    now = new Date();
    admin = await createUser('admin@example.org', 'Ada Admin', ADMIN_PASSWORD, true);
    bob = await createUser('bob@example.org', 'Bob', PASSWORD);
    const users = createUserRepository(database);
    mfa = {
      users,
      totp: createTotpRepository(database),
      challenges: createMfaChallengeRepository(database),
      secretBox: createSecretBox('test-data-encryption-key-0123456789abcdef'),
      algorithm: totpAlgorithm,
      recoveryCodes,
      challengeTokens: invitationTokens,
      passwords: { verify: async (userId, password) => verifyPassword(passwordOf(userId), password) },
      clock: { now: () => now },
    };
    deps = {
      accounts: createAccountAdminRepository(database),
      securityEvents: createSecurityEventReader(database),
      mfa,
      clock: { now: () => now },
    };
    workspaceDeps = { users, workspaces: createWorkspaceRepository(database), clock: { now: () => now } };
  });

  afterEach(() => database.dispose());

  it('lists every account with status and TOTP state for server admins only', async () => {
    const accounts = await listAccounts(deps, { actor: admin });
    expect(accounts.map((account) => [account.email, account.status, account.serverAdmin, account.totpEnabled])).toEqual([
      ['admin@example.org', 'ACTIVE', true, false],
      ['bob@example.org', 'ACTIVE', false, false],
    ]);
    await expect(listAccounts(deps, { actor: bob })).rejects.toBeInstanceOf(NotAuthorizedError);
    await expect(listAccounts(deps, { actor: { ...admin, status: 'DISABLED' } })).rejects.toBeInstanceOf(NotAuthorizedError);
  });

  it('disables an account: status, sessions, challenges, pending recoveries and issued invitations in one audited transaction', async () => {
    const carol = await createUser('carol@example.org', 'Carol', PASSWORD, true);
    addSession(carol);
    addSession(carol);
    database.sqlite
      .prepare('INSERT INTO mfa_challenges (id, token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), 'a'.repeat(64), carol.id, now.getTime(), now.getTime() + 60_000);
    database.sqlite
      .prepare(
        'INSERT INTO account_recoveries (id, user_id, token_hash, reset_password, reset_totp, issued_by_user_id, created_at, expires_at) VALUES (?, ?, ?, 1, 0, ?, ?, ?)',
      )
      .run(randomUUID(), carol.id, 'b'.repeat(64), admin.id, now.getTime(), now.getTime() + 60_000);
    const invitationId = randomUUID();
    database.sqlite
      .prepare('INSERT INTO invitations (id, email, token_hash, grants_server_admin, invited_by_user_id, created_at, expires_at) VALUES (?, ?, ?, 1, ?, ?, ?)')
      .run(invitationId, 'eve@example.org', 'c'.repeat(64), carol.id, now.getTime(), now.getTime() + 60_000);

    await expect(change(carol.id, 'DISABLED')).resolves.toEqual({ sessionsRevoked: 2 });

    expect(statusOf(carol)).toBe('DISABLED');
    expect(sessionCount(carol)).toBe(0);
    expect(database.sqlite.prepare('SELECT consumed_at FROM mfa_challenges WHERE user_id = ?').get(carol.id)).toEqual({ consumed_at: now.getTime() });
    expect(database.sqlite.prepare('SELECT revoked_at FROM account_recoveries WHERE user_id = ?').get(carol.id)).toEqual({ revoked_at: now.getTime() });
    expect(database.sqlite.prepare('SELECT revoked_at, revoked_by_user_id FROM invitations WHERE id = ?').get(invitationId)).toEqual({
      revoked_at: now.getTime(),
      revoked_by_user_id: admin.id,
    });
    const recorded = events();
    expect(recorded.map((event) => event.type)).toEqual(['INVITATION_REVOKED', 'ACCOUNT_DISABLED']);
    expect(JSON.parse(recorded[1]?.metadata ?? '{}')).toEqual({ sessionsRevoked: 2, recoveriesRevoked: 1, invitationsRevoked: 1 });
    expect(recorded[1]?.subjectId).toBe(carol.id);
  });

  it('re-enables an account without restoring any access', async () => {
    await change(bob.id, 'DISABLED');
    await expect(change(bob.id, 'ACTIVE')).resolves.toEqual({ sessionsRevoked: 0 });
    expect(statusOf(bob)).toBe('ACTIVE');
    expect(events().map((event) => event.type)).toEqual(['ACCOUNT_DISABLED', 'ACCOUNT_ENABLED']);
  });

  it('refuses non-admins, disabled admins, self-changes and unknown or malformed targets without writing', async () => {
    await expect(change(admin.id, 'DISABLED', bob, PASSWORD)).rejects.toBeInstanceOf(NotAuthorizedError);
    await expect(change(bob.id, 'DISABLED', { ...admin, status: 'DISABLED' })).rejects.toBeInstanceOf(NotAuthorizedError);
    await expect(change(admin.id, 'DISABLED')).rejects.toBeInstanceOf(NotAuthorizedError);
    await expect(change(randomUUID(), 'DISABLED')).rejects.toBeInstanceOf(UnknownAccountError);
    await expect(change('not-a-uuid', 'DISABLED')).rejects.toBeInstanceOf(DomainValidationError);
    await expect(change(bob.id, 'ACTIVE')).rejects.toBeInstanceOf(AccountStatusUnchangedError);
    expect(statusOf(admin)).toBe('ACTIVE');
    expect(events()).toEqual([]);
  });

  it('requires step-up: wrong password, and TOTP when the admin enabled it', async () => {
    await expect(change(bob.id, 'DISABLED', admin, 'wrong password 1234567')).rejects.toBeInstanceOf(ReauthenticationFailedError);
    const { secret } = await startTotpEnrollment(mfa, { user: admin, password: ADMIN_PASSWORD });
    const totp = new TOTP({ secret });
    await confirmTotpEnrollment(mfa, { user: admin, code: totp.generate({ timestamp: now.getTime() }) });
    now = new Date(now.getTime() + 30_000);
    await expect(change(bob.id, 'DISABLED')).rejects.toBeInstanceOf(SecondFactorRequiredError);
    expect(statusOf(bob)).toBe('ACTIVE');
    await change(bob.id, 'DISABLED', admin, ADMIN_PASSWORD, { code: totp.generate({ timestamp: now.getTime() }) });
    expect(statusOf(bob)).toBe('DISABLED');
  });

  it('re-checks the acting admin inside the transaction', async () => {
    const carol = await createUser('carol@example.org', 'Carol', PASSWORD, true);
    // The admin lost the flag after the request was authorized.
    database.sqlite.prepare('UPDATE users SET server_admin = 0 WHERE id = ?').run(admin.id);
    await expect(change(carol.id, 'DISABLED')).rejects.toBeInstanceOf(NotAuthorizedError);
    expect(statusOf(carol)).toBe('ACTIVE');
  });

  it('refuses to disable the only active admin of a Workspace and names the Workspaces', async () => {
    const household = await createWorkspace(workspaceDeps, { actor: admin, name: 'Household' });
    await addMember(workspaceDeps, { actor: admin, workspaceId: household.id, email: normalizeEmail('bob@example.org'), role: 'ADMIN' });
    await expect(change(bob.id, 'DISABLED')).resolves.toEqual({ sessionsRevoked: 0 });
    await change(bob.id, 'ACTIVE');

    // Bob becomes the only active ADMIN of his own Workspace.
    const bobsAdmin = await createUser('dora@example.org', 'Dora', PASSWORD, true);
    const garage = await createWorkspace(workspaceDeps, { actor: bobsAdmin, name: 'Garage' });
    await addMember(workspaceDeps, { actor: bobsAdmin, workspaceId: garage.id, email: normalizeEmail('bob@example.org'), role: 'ADMIN' });
    database.sqlite.prepare("UPDATE users SET status = 'DISABLED' WHERE id = ?").run(bobsAdmin.id);

    const refused = change(bob.id, 'DISABLED');
    await expect(refused).rejects.toBeInstanceOf(SoleWorkspaceManagerError);
    await expect(refused).rejects.toMatchObject({ workspaces: [{ id: garage.id, name: 'Garage' }] });
    expect(statusOf(bob)).toBe('ACTIVE');
    expect(events().filter((event) => event.type === 'ACCOUNT_DISABLED')).toHaveLength(1);
  });

  it('keeps the disabled user unable to act as server admin', async () => {
    const carol = await createUser('carol@example.org', 'Carol', PASSWORD, true);
    await change(carol.id, 'DISABLED');
    const disabledCarol = { ...carol, status: 'DISABLED' as const };
    await expect(change(bob.id, 'DISABLED', disabledCarol, PASSWORD)).rejects.toBeInstanceOf(NotAuthorizedError);
    await expect(listAccounts(deps, { actor: disabledCarol })).rejects.toBeInstanceOf(NotAuthorizedError);
  });

  it('shows the security log newest first, pages it and filters by account, for server admins only', async () => {
    await change(bob.id, 'DISABLED');
    await change(bob.id, 'ACTIVE');
    const carol = await createUser('carol@example.org', 'Carol', PASSWORD);
    await change(carol.id, 'DISABLED');

    const page = await listSecurityEvents(deps, { actor: admin });
    expect(page.items.map((entry) => [entry.type, entry.subjectEmail, entry.actorLabel])).toEqual([
      ['ACCOUNT_DISABLED', 'carol@example.org', 'Ada Admin'],
      ['ACCOUNT_ENABLED', 'bob@example.org', 'Ada Admin'],
      ['ACCOUNT_DISABLED', 'bob@example.org', 'Ada Admin'],
    ]);
    expect(page.nextCursor).toBeNull();
    const aboutBob = await listSecurityEvents(deps, { actor: admin, userId: bob.id });
    expect(aboutBob.items.map((entry) => entry.type)).toEqual(['ACCOUNT_ENABLED', 'ACCOUNT_DISABLED']);
    // Cursor continues after the given event; an event outside the filter is no cursor.
    expect((await listSecurityEvents(deps, { actor: admin, before: page.items[0]?.id })).items).toHaveLength(2);
    await expect(listSecurityEvents(deps, { actor: admin, userId: bob.id, before: page.items[0]?.id })).rejects.toBeInstanceOf(
      InvalidCursorError,
    );
    await expect(listSecurityEvents(deps, { actor: admin, userId: 'nope' })).rejects.toBeInstanceOf(DomainValidationError);
    await expect(listSecurityEvents(deps, { actor: bob })).rejects.toBeInstanceOf(NotAuthorizedError);
    await expect(listSecurityEvents(deps, { actor: { ...admin, status: 'DISABLED' } })).rejects.toBeInstanceOf(NotAuthorizedError);
  });

  it('pages the security log by insertion order when timestamps tie', async () => {
    const reader = createSecurityEventReader(database);
    for (let i = 0; i < 5; i += 1) await change(bob.id, i % 2 === 0 ? 'DISABLED' : 'ACTIVE');
    const all = await reader.list({ limit: 100 });
    const first = await reader.list({ limit: 2 });
    const second = await reader.list({ limit: 2, before: first.nextCursor ?? undefined });
    const third = await reader.list({ limit: 2, before: second.nextCursor ?? undefined });
    expect([...first.items, ...second.items, ...third.items].map((entry) => entry.id)).toEqual(all.items.map((entry) => entry.id));
    expect(third.nextCursor).toBeNull();
  });
});

