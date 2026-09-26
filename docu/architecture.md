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
