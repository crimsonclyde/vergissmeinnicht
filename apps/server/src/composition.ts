import { systemClock, type InvitationDeps } from '@vergissmeinnicht/application';
import { invitationTokens } from '@vergissmeinnicht/auth';
import { createInvitationRepository, createUserRepository, type AppDatabase } from '@vergissmeinnicht/database';
import { createSmtpEmailSender } from '@vergissmeinnicht/email';
import type { AppConfig } from './config/index.ts';

/** Composition root: wires infrastructure adapters into application use-case dependencies. */
export function invitationDeps(config: AppConfig, database: AppDatabase): InvitationDeps {
  return {
    users: createUserRepository(database),
    invitations: createInvitationRepository(database),
    tokens: invitationTokens,
    email: createSmtpEmailSender(config.smtp),
    clock: systemClock,
    publicOrigin: config.publicOrigin,
    invitationTtlHours: config.invitationTtlHours,
  };
}
