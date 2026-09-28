import type { NormalizedEmail, User, UserId, UserStatus } from '@vergissmeinnicht/domain';

export interface NewUser {
  readonly email: NormalizedEmail;
  readonly displayName: string;
  readonly emailVerified: boolean;
  readonly status: UserStatus;
  readonly serverAdmin: boolean;
}

/** Persistence port for internal Users. Async so the SQLite implementation can later be swapped. */
export interface UserRepository {
  create(user: NewUser): Promise<User>;
  findById(id: UserId): Promise<User | undefined>;
  findByEmail(email: NormalizedEmail): Promise<User | undefined>;
  /** True if any User (ACTIVE or not) holds the server-admin flag. */
  hasServerAdmin(): Promise<boolean>;
}

/** Raised when a normalized email already belongs to a User. */
export class EmailAlreadyInUseError extends Error {
  constructor() {
    super('Email address is already in use');
    this.name = 'EmailAlreadyInUseError';
  }
}
