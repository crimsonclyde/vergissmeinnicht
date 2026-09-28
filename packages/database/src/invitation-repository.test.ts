import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InvitationRepository, UserRepository } from '@vergissmeinnicht/application';
import { normalizeEmail, type Actor, type InvitationId } from '@vergissmeinnicht/domain';
import { createInvitationRepository } from './invitation-repository.ts';
import { createTestDatabase } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';

const email = normalizeEmail('bob@example.org');
const t0 = new Date('2026-09-26T10:00:00Z');
const later = (hours: number) => new Date(t0.getTime() + hours * 3_600_000);
const hash = (char: string) => char.repeat(64);
const cli: Actor = { kind: 'system', label: 'cli:admin-bootstrap' };

describe('invitation repository', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let repo: InvitationRepository;
  let users: UserRepository;
  let admin: Actor;

  const events = () =>
    database.sqlite.prepare('SELECT type, actor_user_id, actor_label, subject_id, metadata FROM security_events ORDER BY rowid').all() as {
      type: string;
      actor_user_id: string | null;
      actor_label: string;
      subject_id: string;
      metadata: string | null;
    }[];

  beforeEach(async () => {
    database = createTestDatabase();
    repo = createInvitationRepository(database);
    users = createUserRepository(database);
    const user = await users.create({
      email: normalizeEmail('admin@example.org'),
      displayName: 'Admin',
      emailVerified: true,
      status: 'ACTIVE',
      serverAdmin: true,
    });
    admin = { kind: 'user', userId: user.id, displayName: user.displayName };
  });

  afterEach(() => database.dispose());

  const issue = (tokenHash: string, actor: Actor = admin, at = t0) =>
    repo.issue({ email, tokenHash, grantsServerAdmin: false, createdAt: at, expiresAt: later(72) }, actor);

  it('stores the invitation with its hash and records INVITATION_CREATED atomically', async () => {
    const invitation = await issue(hash('a'));
    expect(await repo.findByTokenHash(hash('a'))).toEqual(invitation);
    expect(events()).toEqual([
      {
        type: 'INVITATION_CREATED',
        actor_user_id: admin.kind === 'user' ? admin.userId : null,
        actor_label: 'Admin',
        subject_id: invitation.id,
        metadata: JSON.stringify({ grantsServerAdmin: false, expiresAt: later(72).toISOString() }),
      },
    ]);
  });

  it('records system actors by label without a user id', async () => {
    await issue(hash('a'), cli);
    expect(events()[0]).toMatchObject({ actor_user_id: null, actor_label: 'cli:admin-bootstrap' });
  });

  it('supersedes a pending invitation for the same email', async () => {
    const first = await issue(hash('a'));
    const second = await issue(hash('b'), admin, later(1));
    expect((await repo.findById(first.id))?.revokedAt).toEqual(later(1));
    expect((await repo.findById(second.id))?.revokedAt).toBeUndefined();
    expect(events().map((event) => event.type)).toEqual([
      'INVITATION_CREATED',
      'INVITATION_SUPERSEDED',
      'INVITATION_CREATED',
    ]);
  });

  it('revokes only pending invitations, once', async () => {
    const invitation = await issue(hash('a'));
    expect(await repo.revoke(invitation.id, admin, later(1))).toBe(true);
    expect(await repo.revoke(invitation.id, admin, later(2))).toBe(false);
    expect(events().filter((event) => event.type === 'INVITATION_REVOKED')).toHaveLength(1);
  });

  it('does not revoke an expired invitation', async () => {
    const invitation = await issue(hash('a'));
    expect(await repo.revoke(invitation.id, admin, later(72))).toBe(false);
  });

  it('returns false for unknown invitations', async () => {
    expect(await repo.revoke('00000000-0000-4000-8000-000000000000' as InvitationId, admin, t0)).toBe(false);
  });

  it('rolls back the state change when the security event cannot be written', async () => {
    const first = await issue(hash('a'));
    const ghost: Actor = { kind: 'user', userId: '00000000-0000-4000-8000-000000000000', displayName: 'Ghost' };
    await expect(issue(hash('b'), ghost, later(1))).rejects.toThrow(/FOREIGN KEY/);

    expect(await repo.findByTokenHash(hash('b'))).toBeUndefined();
    expect((await repo.findById(first.id))?.revokedAt).toBeUndefined();
    expect(events()).toHaveLength(1);
  });

  it('rejects duplicate token hashes', async () => {
    await issue(hash('a'));
    await expect(
      repo.issue(
        { email: normalizeEmail('carol@example.org'), tokenHash: hash('a'), grantsServerAdmin: false, createdAt: t0, expiresAt: later(1) },
        admin,
      ),
    ).rejects.toThrow(/UNIQUE/);
  });

  it('keeps security events append-only', async () => {
    await issue(hash('a'));
    expect(() => database.sqlite.prepare("UPDATE security_events SET actor_label = 'x'").run()).toThrow(/append-only/);
    expect(() => database.sqlite.prepare('DELETE FROM security_events').run()).toThrow(/append-only/);
    expect(events()).toHaveLength(1);
  });

  it('reports whether a server admin exists', async () => {
    expect(await users.hasServerAdmin()).toBe(true);
    const empty = createTestDatabase();
    try {
      expect(await createUserRepository(empty).hasServerAdmin()).toBe(false);
    } finally {
      empty.dispose();
    }
  });
});
