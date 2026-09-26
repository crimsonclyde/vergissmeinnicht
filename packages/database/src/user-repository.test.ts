import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EmailAlreadyInUseError, type UserRepository } from '@vergissmeinnicht/application';
import { normalizeEmail, parseUserId, type UserId } from '@vergissmeinnicht/domain';
import { openDatabase, type AppDatabase } from './connection.ts';
import { runMigrations } from './migrate.ts';
import { createUserRepository } from './user-repository.ts';

const alice = {
  email: normalizeEmail('Alice@Example.org'),
  displayName: 'Alice',
  emailVerified: true,
  status: 'ACTIVE' as const,
  serverAdmin: false,
};

describe('user repository', () => {
  let dir: string;
  let database: AppDatabase;
  let repository: UserRepository;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vmn-users-'));
    const path = join(dir, 'test.sqlite');
    expect(runMigrations(path)).toBe('applied');
    database = openDatabase(path);
    repository = createUserRepository(database);
  });

  afterEach(() => {
    database.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates a User with an opaque UUIDv4 id and server timestamps', async () => {
    const before = Date.now();
    const user = await repository.create(alice);
    expect(parseUserId(user.id)).toBe(user.id);
    expect(user).toMatchObject({ email: 'alice@example.org', displayName: 'Alice', status: 'ACTIVE' });
    expect(user.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(user.updatedAt.getTime()).toBe(user.createdAt.getTime());
  });

  it('issues non-sequential ids', async () => {
    const a = await repository.create(alice);
    const b = await repository.create({ ...alice, email: normalizeEmail('bob@example.org') });
    expect(a.id).not.toBe(b.id);
    expect(a.id.slice(0, 8)).not.toBe(b.id.slice(0, 8));
  });

  it('finds Users by id and normalized email', async () => {
    const user = await repository.create(alice);
    expect(await repository.findById(user.id)).toEqual(user);
    expect(await repository.findByEmail(normalizeEmail(' ALICE@example.ORG'))).toEqual(user);
  });

  it('returns undefined for unknown Users', async () => {
    expect(await repository.findById('00000000-0000-4000-8000-000000000000' as UserId)).toBeUndefined();
    expect(await repository.findByEmail(normalizeEmail('nobody@example.org'))).toBeUndefined();
  });

  it('rejects a second User with the same normalized email', async () => {
    await repository.create(alice);
    await expect(
      repository.create({ ...alice, email: normalizeEmail('ALICE@example.org'), displayName: 'Mallory' }),
    ).rejects.toBeInstanceOf(EmailAlreadyInUseError);
  });

  describe('database constraints (defense in depth)', () => {
    const insert = (values: Record<string, unknown>) => () =>
      database.sqlite
        .prepare('INSERT INTO users (id, display_name, email, status) VALUES (@id, @name, @email, @status)')
        .run({ id: '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e', name: 'Eve', email: 'eve@example.org', status: 'ACTIVE', ...values });

    it('accepts a valid row', () => {
      expect(insert({})).not.toThrow();
    });

    it.each([
      ['non-normalized email', { email: 'Eve@Example.org' }],
      ['padded email', { email: ' eve@example.org' }],
      ['unknown status', { status: 'ROOT' }],
      ['blank display name', { name: '   ' }],
      ['non-UUID id', { id: '1' }],
    ])('rejects %s', (_label, values) => {
      expect(insert(values)).toThrow(/CHECK constraint failed/);
    });
  });
});
