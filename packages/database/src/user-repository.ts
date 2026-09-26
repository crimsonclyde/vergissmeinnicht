import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { SqliteError } from 'better-sqlite3';
import {
  EmailAlreadyInUseError,
  type NewUser,
  type UserRepository,
} from '@vergissmeinnicht/application';
import type { NormalizedEmail, User, UserId } from '@vergissmeinnicht/domain';
import type { AppDatabase } from './connection.ts';
import { users } from './schema.ts';

type UserRow = typeof users.$inferSelect;

function toUser(row: UserRow): User {
  return {
    id: row.id as UserId,
    email: row.email as NormalizedEmail,
    emailVerified: row.emailVerified,
    displayName: row.name,
    status: row.status,
    serverAdmin: row.serverAdmin,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createUserRepository({ db }: Pick<AppDatabase, 'db'>): UserRepository {
  return {
    async create(user: NewUser) {
      const now = new Date();
      try {
        const row = db
          .insert(users)
          .values({
            id: randomUUID(),
            email: user.email,
            name: user.displayName,
            emailVerified: user.emailVerified,
            status: user.status,
            serverAdmin: user.serverAdmin,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
        return toUser(row);
      } catch (error) {
        if (error instanceof SqliteError && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          throw new EmailAlreadyInUseError();
        }
        throw error;
      }
    },

    async findById(id: UserId) {
      const row = db.select().from(users).where(eq(users.id, id)).get();
      return row && toUser(row);
    },

    async findByEmail(email: NormalizedEmail) {
      const row = db.select().from(users).where(eq(users.email, email)).get();
      return row && toUser(row);
    },

    async hasServerAdmin() {
      return db.select({ id: users.id }).from(users).where(eq(users.serverAdmin, true)).limit(1).get() !== undefined;
    },
  };
}
