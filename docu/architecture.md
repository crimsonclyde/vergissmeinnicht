# Architecture

## Selected stack

Vergissmeinnicht is a **TypeScript modular monolith** deployed as one application.

### Server
- Node.js
- Fastify 5
- Better Auth
- Drizzle ORM
- SQLite
- Server-Sent Events (SSE)

### Web
- React
- Vite
- semantic design-token based UI
- English first, i18n-ready

### Testing
- Vitest for unit/integration tests
- Playwright for end-to-end/browser tests

### Package manager
- pnpm preferred

Exact versions must be pinned/locked when implementation begins and checked against current security advisories.

## Why this shape

The primary security boundary is the Fastify server.

React is presentation only and never owns authorization decisions.

Fastify was chosen because the project benefits from an explicit HTTP server boundary, schema validation, straightforward testability, and maintained ecosystem plugins for concerns such as cookies, CSRF protection, rate limiting, CORS and security headers.

Better Auth is used instead of custom authentication code. Its supported authentication primitives will be wrapped by project-specific policy enforcing invite-only registration and, for accounts that enabled TOTP, a completed TOTP challenge before normal application access.

Drizzle provides typed DB access and committed migrations while keeping SQLite simple to self-host.

SSE is sufficient because collaborative mutations already travel from client to server as normal authenticated HTTP commands; realtime transport is primarily server-to-client fan-out.

## Architectural style

```text
Presentation
  React / browser UI / view models

Application
  commands / queries / use cases

Domain
  entities / policies / state transitions

Infrastructure
  Fastify adapters
  Better Auth adapter/policy
  Drizzle/SQLite repositories
  SSE
  email
  logging
  import/export
```

Dependencies should point inward.

Domain code must not depend on React, Fastify, Better Auth, Drizzle, SQLite, or SSE.

## Suggested physical repository shape

```text
apps/
  server/
  web/

packages/
  domain/
  application/
  database/
  auth/
  permissions/
  realtime/
  email/
  import-export/
  ui/

docu/
```

This is a suggested structure, not permission to split into deployable microservices.

## Authentication architecture

There is one stable internal User UUID.

Authentication mechanisms attach to it.

V1:
- invite-only email accounts;
- email + password;
- optional, user-activated TOTP (built in; enforcement policy may be added later);
- admin-assisted recovery.

Future:
- Apple (planned);
- GitHub (planned);
- Microsoft (possible).

Provider identities must map to internal User records; provider account linking requires a separate security design.

### User table and Better Auth

The `users` table (`packages/database/src/schema.ts`) is the internal identity. Its Drizzle property names match Better Auth's core `user` model so Better Auth reads and writes it directly (`user.modelName = 'users'`); column names are snake_case. `status` is application-owned and must never be writable through Better Auth input.

Credentials and login methods live in Better Auth's `account` table (one row per provider + provider account id, pointing to `users.id`). Adding Apple/GitHub later adds `account` rows; it never changes `users.id`.

Emails are normalized (trimmed, NFC, lower-cased) before storage and lookup; the normalized email is unique.

### Server admins and invitations

`users.server_admin` is a server-wide capability (invitations, recovery, disabling accounts), independent of Workspace roles, and effective only for ACTIVE users. The first server admin is created through a one-time CLI bootstrap invitation.

Invitations store only a SHA-256 hash of a 256-bit token. Use-cases in `packages/application/src/invitations` enforce authorization themselves; HTTP handlers only authenticate and translate.

### Sessions and the Better Auth boundary

Better Auth (`packages/auth`) owns password verification and server-side sessions (`sessions` table, HMAC-signed cookie). Its HTTP handler is **not** mounted. The Fastify layer (`apps/server/src/http/`) exposes a small allow-list of routes that call `auth.api.*` directly:

```text
POST /api/auth/sign-in    -> auth.api.signInEmail (email + password only)
POST /api/auth/sign-out   -> auth.api.signOut
GET  /api/auth/session    -> authenticate()
```

`authenticate()` in `apps/server/src/http/session.ts` is the single place that turns a cookie into a `Principal` (ACTIVE User + session id): it enforces the absolute session lifetime and account status, and is where the TOTP challenge gate (2.4) plugs in. Routes needing a user use the `requireUser` preHandler; capability checks stay in the application use-cases.

Cross-cutting HTTP controls registered in `apps/server/src/app.ts`: `Origin` guard for every state-changing request (CSRF), JSON-only bodies, `@fastify/rate-limit` (global + per-route + per-account for sign-in), central error mapping to stable error codes.

Accounts are created only by invitation acceptance (`acceptInvitation` use-case), which writes the `users` and `accounts` (credential) rows itself in one transaction; Better Auth's sign-up is disabled.

### Security events

Account-security events (invitations, account creation, login success/failure, logout; MFA and recovery later) go to the append-only `security_events` table, written in the same transaction as the state change. Run/Step history uses the separate Run AuditEvent model (5.5).

## TOTP security state

TOTP is optional and user-activated in V1. Users enable it from their account security settings (re-authentication required; activation only after a valid OTP).

When an account has TOTP enabled, password login yields a restricted pre-MFA session that may access only the TOTP challenge/recovery-code/logout endpoints. The session is rotated to a full session after a successful challenge.

No Workspace, Procedure, Run, Knot, admin, API or SSE access is granted before this gate is complete.

Whether an account must pass TOTP is decided by one central server-side MFA policy (currently: "required if the user enabled TOTP"). A later enforcement rule, such as mandatory TOTP for ADMIN, is a policy change rather than a redesign.

## Realtime

SSE is the selected V1 realtime transport.

```text
browser command
  -> authenticated HTTP endpoint
  -> authorization + validation
  -> DB transaction + audit event
  -> canonical response
  -> SSE fan-out to authorized subscribers
```

SSE is not the source of truth.

Clients refetch canonical state after reconnect or version gaps.

## Persistence

SQLite is initial persistence.

Requirements:
- migrations from day one;
- foreign keys enabled;
- transactions;
- safe parameterized access;
- WAL where appropriate;
- tested backup/restore.

## Future extension boundaries

Do not implement yet, but avoid coupling that prevents:
- SQLite -> PostgreSQL;
- in-process SSE fan-out -> shared pub/sub;
- local auth -> external identity providers.

These potential extensions do not justify microservices in V1.
