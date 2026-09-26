import type { BetterAuthPlugin } from 'better-auth';
import { createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { z } from 'zod';

/**
 * Server-only extensions (`metadata.SERVER_ONLY`; Better Auth's HTTP handler is not mounted at
 * all). They exist so session cookies are always created and signed by Better Auth itself.
 */
export const sessionPlugin = () =>
  ({
    id: 'vmn-sessions',
    endpoints: {
      /**
       * Creates a full session and sets its cookie for a user whose authentication the caller has
       * completed (password + TOTP challenge) or whose session must be rotated after a
       * security-sensitive change. Never reachable from a client.
       */
      issueSession: createAuthEndpoint.serverOnly(
        { method: 'POST', body: z.strictObject({ userId: z.string() }) },
        async (ctx) => {
          const user = await ctx.context.internalAdapter.findUserById(ctx.body.userId);
          if (!user) throw new Error('Cannot issue a session for an unknown user');
          const session = await ctx.context.internalAdapter.createSession(user.id);
          if (!session) throw new Error('Session was not created');
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ sessionId: session.id });
        },
      ),
      /** Re-authentication: verifies the user's current password with the configured hasher. */
      checkPassword: createAuthEndpoint.serverOnly(
        { method: 'POST', body: z.strictObject({ userId: z.string(), password: z.string() }) },
        async (ctx) => {
          const account = await ctx.context.internalAdapter.findCredentialAccount(ctx.body.userId);
          if (!account?.password) {
            // Same cost as a real check, so the response time does not reveal a missing credential.
            await ctx.context.password.hash(ctx.body.password);
            return ctx.json({ valid: false });
          }
          const valid = await ctx.context.password.verify({ hash: account.password, password: ctx.body.password });
          return ctx.json({ valid });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;
