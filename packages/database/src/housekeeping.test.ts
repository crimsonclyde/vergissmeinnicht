import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeEmail } from '@vergissmeinnicht/domain';
import { FINISHED_LINK_RETENTION_MS, purgeExpired } from './housekeeping.ts';
import { createRateLimitCounter } from './rate-limit-counter.ts';
import { createTestDatabase } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';

const MINUTE = 60_000;

describe('housekeeping', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let userId: string;
  const now = new Date('2026-09-28T12:00:00Z').getTime();
  const old = now - FINISHED_LINK_RETENTION_MS - MINUTE;
  const recent = now - MINUTE;
  let hash = 0;
  const nextHash = () => (hash++).toString(16).padStart(64, '0');

  const ids = (table: string, column = 'id') =>
    (database.sqlite.prepare(`SELECT ${column} AS id FROM ${table} ORDER BY ${column}`).all() as { id: string }[]).map((row) => row.id);

  function session(id: string, expiresAt: number) {
    database.sqlite.prepare('INSERT INTO sessions (id, token, user_id, expires_at) VALUES (?, ?, ?, ?)').run(id, randomUUID(), userId, expiresAt);
  }
  function challenge(id: string, expiresAt: number, consumedAt: number | null) {
    database.sqlite
      .prepare('INSERT INTO mfa_challenges (id, token_hash, user_id, created_at, expires_at, consumed_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, nextHash(), userId, expiresAt - 5 * MINUTE, expiresAt, consumedAt);
  }
  function recovery(id: string, created: number, expires: number, completed: number | null, revoked: number | null) {
    database.sqlite
      .prepare(
        'INSERT INTO account_recoveries (id, user_id, token_hash, reset_password, reset_totp, created_at, expires_at, completed_at, revoked_at) VALUES (?, ?, ?, 1, 0, ?, ?, ?, ?)',
      )
      .run(id, userId, nextHash(), created, expires, completed, revoked);
  }
  function invitation(id: string, expires: number, accepted: number | null, revoked: number | null) {
    database.sqlite
      .prepare('INSERT INTO invitations (id, email, token_hash, created_at, expires_at, accepted_at, accepted_user_id, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, `${id}@example.org`, nextHash(), expires - 60 * MINUTE, expires, accepted, accepted === null ? null : userId, revoked);
  }

  beforeEach(async () => {
    database = createTestDatabase();
    const user = await createUserRepository(database).create({
      email: normalizeEmail('ada@example.org'),
      displayName: 'Ada',
      emailVerified: true,
      status: 'ACTIVE',
      serverAdmin: true,
    });
    userId = user.id;
  });
  afterEach(() => database.dispose());

  it('deletes only rows that can no longer be used and keeps everything else', async () => {
    session('s-expired', now - 1);
    session('s-live', now + MINUTE);
    challenge('c-expired', now - 1, null);
    challenge('c-used', now + MINUTE, recent);
    challenge('c-live', now + MINUTE, null);
    database.sqlite
      .prepare("INSERT INTO totp_credentials (user_id, sealed_secret, created_at) VALUES (?, 'v1.x', ?)")
      .run(userId, now - 11 * MINUTE);

    recovery('r-completed-old', old - MINUTE, old, old, null);
    recovery('r-completed-recent', recent - MINUTE, now + MINUTE, recent, null);
    recovery('r-expired-old', old - 2 * MINUTE, old, null, null);
    recovery('r-expired-recent', recent - 2 * MINUTE, recent, null, null);
    recovery('r-pending', now - MINUTE, now + 60 * MINUTE, null, null);
    invitation('i-accepted-old', old + MINUTE, old, null);
    invitation('i-revoked-old', old + MINUTE, null, old);
    invitation('i-expired-old', old, null, null);
    invitation('i-revoked-recent', now + MINUTE, null, recent);
    invitation('i-pending', now + 60 * MINUTE, null, null);

    const counter = createRateLimitCounter(database);
    counter.hit('expired', MINUTE, 10, now - 2 * MINUTE);
    counter.hit('live', MINUTE, 10, now - 1000);

    const events = database.sqlite.prepare('SELECT count(*) AS n FROM security_events').get();
    expect(purgeExpired(database, new Date(now))).toEqual({
      sessions: 1,
      verifications: 0,
      mfaChallenges: 2,
      totpEnrollments: 1,
      accountRecoveries: 2,
      invitations: 3,
      rateLimits: 1,
    });
    expect(ids('sessions')).toEqual(['s-live']);
    expect(ids('mfa_challenges')).toEqual(['c-live']);
    expect(ids('totp_credentials', 'user_id')).toEqual([]);
    expect(ids('account_recoveries')).toEqual(['r-completed-recent', 'r-expired-recent', 'r-pending']);
    expect(ids('invitations')).toEqual(['i-pending', 'i-revoked-recent']);
    expect(counter.peek('live', now).current).toBe(1);
    expect(database.sqlite.prepare('SELECT count(*) AS n FROM security_events').get()).toEqual(events);
    // Idempotent.
    expect(Object.values(purgeExpired(database, new Date(now))).every((n) => n === 0)).toBe(true);
  });

  it('keeps confirmed TOTP credentials and fresh enrollments', () => {
    database.sqlite
      .prepare("INSERT INTO totp_credentials (user_id, sealed_secret, created_at, enabled_at) VALUES (?, 'v1.x', ?, ?)")
      .run(userId, old, old);
    purgeExpired(database, new Date(now));
    expect(ids('totp_credentials', 'user_id')).toEqual([userId]);
  });
});

describe('persistent rate-limit counter', () => {
  let database: ReturnType<typeof createTestDatabase>;
  beforeEach(() => {
    database = createTestDatabase();
  });
  afterEach(() => database.dispose());

  it('counts per fixed window, survives a reopen and stops writing once exceeded', () => {
    const start = 1_000_000;
    const counter = createRateLimitCounter(database);
    expect(counter.hit('sign-in:email:ada@example.org', MINUTE, 2, start)).toEqual({ current: 1, ttl: MINUTE });
    expect(counter.hit('sign-in:email:ada@example.org', MINUTE, 2, start + 1000)).toEqual({ current: 2, ttl: MINUTE - 1000 });
    expect(counter.hit('sign-in:email:ada@example.org', MINUTE, 2, start + 2000).current).toBe(3);
    expect(counter.hit('sign-in:email:ada@example.org', MINUTE, 2, start + 3000).current).toBe(3);
    // A new counter on the same database (a restart) sees the same state.
    expect(createRateLimitCounter(database).peek('sign-in:email:ada@example.org', start + 4000)).toEqual({ current: 3, ttl: MINUTE - 4000 });
    expect(counter.hit('sign-in:email:ada@example.org', MINUTE, 2, start + MINUTE)).toEqual({ current: 1, ttl: MINUTE });
    expect(counter.hit('other', MINUTE, 2, start + MINUTE).current).toBe(1);
  });

  it('stores only key hashes', () => {
    createRateLimitCounter(database).hit('sign-in:email:ada@example.org', MINUTE, 2);
    const rows = database.sqlite.prepare('SELECT * FROM rate_limits').all() as { key_hash: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain('ada');
  });
});
