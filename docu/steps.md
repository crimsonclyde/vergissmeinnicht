# Project Steps & Objectives

This file is the authoritative implementation ledger for Vergissmeinnicht.

**Agents must update this file when a task is completed or materially changed.**

Status values:

- `TODO`
- `IN PROGRESS`
- `BLOCKED`
- `DONE`
- `DEFERRED`

For every completed task, add a concise completion note, tests/checks performed, and security impact.

---

## Current state — resume here

_Last updated: 2026-09-27 (after 5.5)_

**Done:** 0.1, 0.2, 0.3, 1.1, 1.2, 2.1–2.5, 3.1–3.3, 4.1–4.5, 5.1–5.5, 9.1 (pulled forward for invitations). 2.6 (external providers) is DEFERRED.
**Next:** 5.6 Historical immutability (enforced since 5.4 — verify, document and close).

**UI note (2026-09-27, user feedback):** the web page mixes account settings, Workspace administration, server administration and everyday execution on one unstyled page. Planned remedy — an app shell with navigation (Runs · Procedures · Members · Server admin · Account), real URLs, and a minimal token-based stylesheet — was deferred by the user in favour of continuing with 5.x; pick it up with 8.1/8.3 or earlier on request.

**Lockfile note (4.4):** the hand-edited entries (`apps/server` → `@vergissmeinnicht/import-export`, `packages/import-export` → `zod`) were verified on 2026-09-27 with `pnpm install --frozen-lockfile` (pnpm 12.6.0): lockfile up to date, supply-chain policies passed, no changes.

Also open: trusted-proxy configuration (10.3) before production use behind a reverse proxy; admin web UI (invitations, recoveries — API only so far); account status changes (disable/enable users) with session revocation; housekeeping of expired challenge/recovery/invitation rows.

**Branches:** work is stacked, not yet merged into `main`: `step-1.1-app-skeleton` → `step-1.2-config` → `step-2.1-user-model` → `step-2.2-invitations` → `step-2.4-totp` → `step-2.5-recovery` → `step-3.1-workspaces` → `step-3.2-roles` → `step-4.1-procedures` → `step-4.2-steps` → `step-4.3-drag-drop` → `step-4.4-import-export` → `step-4.5-restore` → `step-5.1-run-snapshot` → `cleanup-web-domain-constants` → `step-5.2-step-states` → `step-5.3-press-and-hold` → `step-5.4-run-lifecycle` → `step-5.5-audit-trail` (each branch contains the previous ones; 2.3 was completed on `step-2.2-invitations` because acceptance finishes 2.2). CI runs on pull requests / `main` only.

**Manual testing:** `test-env/menu.sh` (added 2026-09-27) installs/starts/stops/removes an isolated production-mode instance on port 3200 with demo accounts for every role (see `test-env/README.md`). Extend `test-env/seed.ts` when new features need demo data (e.g. Procedures in 4.1).

**Local tooling:** Node 24 LTS (Node 26 works), pnpm 12.6.0 (`npm install -g pnpm@12.6.0`), Docker for Mailpit (`compose.dev.yml`), `pnpm exec playwright install chromium` for e2e.

---

## Locked product decisions

These decisions are already made and must not be silently changed by an implementation agent.

- Product name: **Vergissmeinnicht**
- Language/runtime: **TypeScript on Node.js**
- Backend: **Fastify 5**
- Frontend: **React + Vite**
- Deployment model: **one deployable modular monolith**
- Authentication library: **Better Auth**
- Database: **SQLite**
- DB layer/migrations: **Drizzle ORM + committed migrations**
- Realtime: **Server-Sent Events (SSE)**
- Registration: **invite-only**
- Invitations: sent by email
- User identity: stable internal User UUID
- Email: required
- Password recovery V1: **admin-assisted recovery only**
- TOTP: **optional, user-activated, built in from V1** (not mandatory for now; architecture keeps a seam for a later enforcement policy)
- External login: **Apple and GitHub planned for later** (deferred; mapped to the internal User UUID)
- Workspace roles: Guest / User / Editor / Admin
- Server-wide administration: a **server admin** flag on the User (separate from Workspace roles) grants invitations, admin-assisted recovery and account disabling. The first server admin is created by a one-time CLI bootstrap (`pnpm admin:bootstrap`) that issues an invitation link printed to the operator's terminal; it refuses to run once a server admin exists.
- Users may belong to multiple Workspaces
- Workspace creation (decided 2026-09-26): **only server admins** by default. Planned later: a setting in the admin board that lets a server admin additionally allow a group (e.g. all users with the Workspace role USER or EDITOR) to create Workspaces. Implement creation behind a single central capability (`canCreateWorkspace`) so this becomes a policy/configuration change.
- Procedures are Workspace-wide in V1
- Any authorized Workspace user may continue an active Run
- Multiple active Runs of the same Procedure are allowed
- V1 Step type: **CHECK only**
- Critical Step confirmation: **press-and-hold**
- Skip / Not Applicable reason policy: separately configurable as disabled / optional / required
- Procedure deletion: **soft delete**
- Completed historical Runs: immutable except future explicit audited correction flow
- Offline execution: Phase 2
- Initial deployment: **Docker Compose + SQLite + reverse proxy**
- License: **AGPL-3.0**
- Initial UI language: English
- Architecture must remain i18n-ready
- Themes: System / Light / Dark
- Dark theme direction: black/greyscale with restrained red accents
- Light theme: inverse/light counterpart
- Animations: allowed but restrained
- Share concept: **Knot**
- Knot route: `/knot/{opaque-token}`

---

## 0 — Foundation and project rules

### 0.1 Repository documentation
**Status:** DONE

**Objective:** Establish product strategy, agent rules, security rules, local-development documentation, deployment direction, and visual identity.

**Acceptance criteria:**
- AGENTS.md exists and references this file and security.md.
- security.md explicitly states security is highest priority.
- local-development and deployment docs exist.
- README explains the project name and links documentation.
- project includes hero and simplified icon assets.

**Completion notes:** Initial documentation structure created.

**Security impact:** Documentation establishes mandatory security gates before implementation.

**Checks performed:** Repository structure and cross-references reviewed.

### 0.2 Select implementation stack
**Status:** DONE
**Completed:** 2026-09-25

**Objective:** Choose a mature TypeScript stack with a clear server security boundary, strong validation, maintainable authentication, SQLite migrations, realtime collaboration, and simple self-hosting.

**Selected stack:**
- Node.js LTS/current supported release at implementation time
- TypeScript
- Fastify 5
- React
- Vite
- Better Auth
- Drizzle ORM
- SQLite
- SSE for realtime server-to-client Run updates
- pnpm preferred as package manager unless implementation reveals a concrete blocker
- Vitest for unit/integration tests
- Playwright for browser/end-to-end tests

**Rationale:** Fastify keeps authentication/authorization and validation on an explicit server boundary, has a mature plugin ecosystem for cookies, CSRF, security headers, CORS and rate limiting, and remains straightforward to self-host. React/Vite keeps the frontend conventional without coupling domain rules to a full-stack UI framework. Better Auth supplies maintained authentication and TOTP primitives instead of custom auth. Drizzle supplies typed SQLite access and committed migrations.

**Security impact:** CRITICAL.

**Security docs updated:** YES.

**Remaining:** Pin exact dependency versions when Step 1.1 begins; review current security advisories before first install.

### 0.3 Revise V1 TOTP and external-login policy
**Status:** DONE
**Completed:** 2026-09-26

**Objective:** Align documentation with the product decision that TOTP is not mandatory for now, but must be available as a built-in, user-activated feature; Apple and GitHub login are planned for later.

**Implemented:** Replaced "mandatory TOTP after first login" with "optional, user-activated TOTP" across `steps.md` (locked decisions, 2.4, 2.5, 2.6), `security.md` (§1, §13, per-feature security checks), `architecture.md` and `AGENTS.md`; resolved the previous contradiction between `security.md` §1 / `AGENTS.md` (optional) and §13 / `steps.md` (mandatory). Prioritized Apple and GitHub in 2.6; Microsoft remains a possible later provider.

**Tests/checks:** Documentation cross-references reviewed with `grep` for TOTP/MFA/provider mentions.

**Security impact:** HIGH — accounts without TOTP enabled are protected by password only. Mitigations and open risks recorded in `security.md`.

**Security docs updated:** YES.

**Remaining:** Decide later whether ADMIN accounts (or Workspaces) may enforce TOTP; the enforcement seam must be kept in 2.4.

---

## 1 — Application foundation

### 1.1 Modular application skeleton
**Status:** DONE
**Completed:** 2026-09-26

**Objective:** Establish one deployable application with explicit Presentation, Application, Domain, and Infrastructure boundaries.

**Target shape:**

```text
apps/
  server/          Fastify HTTP/SSE entrypoint
  web/             React/Vite presentation

packages/
  domain/
  application/
  database/
  auth/
  permissions/
  realtime/
  import-export/
  ui/
```

A different physical folder layout is acceptable only if the same boundaries remain obvious and enforceable.

**Acceptance criteria:**
- single repository and single production deployment unit;
- backend serves API and production frontend assets;
- no raw DB access from React components;
- domain code does not depend on React, Fastify, or SQLite;
- test/lint/typecheck/build commands exist;
- CI can run them;
- package lockfile committed.

**Security impact:** MEDIUM — boundaries must keep authorization server-side.

**Implemented:**
- pnpm workspace (`pnpm@12.6.0` pinned via `packageManager`), Node 24 LTS target (`.nvmrc`, `engines >=24.11.0`); all dependency versions pinned exactly (`savePrefix: ''`), `pnpm-lock.yaml` committed.
- Packages `@vergissmeinnicht/{domain,application,permissions,database,auth,realtime,import-export,ui}` and apps `server`, `web`. Packages export TypeScript source; the server runs on Node's built-in type stripping (no separate server build), the web app is built by Vite. `erasableSyntaxOnly` + `verbatimModuleSyntax` keep code compatible with type stripping.
- Domain: V1 vocabulary (Run states, Step states, Workspace roles). Other layer packages are empty seams with a comment naming their Step.
- Database: `openDatabase()` with `foreign_keys=ON`, WAL, `busy_timeout`, restrictive permissions (dir 0700, file 0600); Drizzle config, empty initial migration journal, `db:generate` / `db:migrate`. Default local DB: `.var/vergissmeinnicht.sqlite` (git-ignored), overridable with `DATABASE_PATH`.
- Server: Fastify app factory with `/api/health` (`Cache-Control: no-store`), `@fastify/helmet` baseline headers (CSP incl. `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy: no-referrer`; HSTS deferred to 10.3), `trustProxy: false`, production serving of `apps/web/dist` with SPA fallback that never answers `/api/*`; logger redacts authorization/cookie headers. Binds `127.0.0.1:3000` by default.
- Web: minimal React 19 app, Vite dev proxy for `/api`.
- Boundaries enforced twice: pnpm strict dependency isolation (undeclared imports fail) and ESLint `no-restricted-imports` rules (domain → no UI/HTTP/auth/DB/other layers; application/permissions → no infrastructure; web/ui → no DB, server layers or `node:*`).
- Supply chain: `allowBuilds` allow-list (`better-sqlite3`, `esbuild`), `minimumReleaseAge: 1440`, `trustPolicy: no-downgrade` with one reviewed exact-version exception (`semver@6.3.1`, see `pnpm-workspace.yaml`).
- CI: GitHub Actions (actions pinned to commit SHAs, read-only token, no persisted credentials) runs install (`--frozen-lockfile`), `pnpm audit --audit-level high`, lint, typecheck, test, build, Playwright e2e. Dependabot for npm and GitHub Actions.

**Tests/checks:**
- `pnpm typecheck`, `pnpm lint`, `pnpm test` (9 tests: domain vocabulary; SQLite FK/WAL/file permissions + FK violation rejected; health, security headers, SPA fallback, unknown `/api/*` → JSON 404), `pnpm build`, `pnpm db:generate`, `pnpm db:migrate`, `pnpm test:e2e` (desktop + mobile Chromium smoke test against the production server) — all passing locally on Node 26.10.0.
- Negative lint check: deliberately forbidden imports in domain, application and web produced 5 `no-restricted-imports` errors (files removed afterwards).
- `pnpm audit`: 0 high/critical; 1 moderate (GHSA-67mh-4wv8-2f99, esbuild ≤0.24.2 dev-server CORS) via `drizzle-kit` → `@esbuild-kit/esm-loader`, dev-only tooling not using esbuild's `serve()`.
- CI workflow not yet executed on GitHub (branch not pushed).

**Security docs updated:** YES.

**Remaining:**
- Configuration/secret handling, `.env.example`, validated env schema → Step 1.2 (server currently reads only `HOST`, `PORT`, `NODE_ENV`, `DATABASE_PATH`).
- Better Auth is not installed yet; added with Step 2.x.
- Production migration strategy/container image → Step 10.1; HSTS/proxy trust → 10.3.
- Watch for a `drizzle-kit` release that drops `@esbuild-kit/*` to clear the moderate advisory.
- Node type stripping for the server is a deliberate choice; revisit if a dependency or deployment constraint requires a compiled server bundle.

### 1.2 Configuration and secret handling
**Status:** DONE
**Completed:** 2026-09-26

**Objective:** Establish safe environment/config handling.

**Acceptance criteria:**
- no real secrets in repository;
- safe `.env.example` only;
- validated environment schema at startup;
- startup fails closed for missing production secrets;
- logs redact security-sensitive values;
- production and development configuration modes cannot silently overlap.

**Security impact:** CRITICAL.

**Implemented:**
- `apps/server/src/config/`: Zod-validated environment schema (`NODE_ENV`, `HOST`, `PORT`, `PUBLIC_ORIGIN`, `DATABASE_PATH`, `AUTH_SECRET`, `LOG_LEVEL`) producing a frozen `AppConfig`. Startup prints the invalid variable names (never values) and exits 1.
- Mode separation: `NODE_ENV` must be exactly `development`, `test` or `production`; unset/unknown fails. Scripts set it explicitly (`pnpm dev` → development, `pnpm start` → production) and Node's `--env-file-if-exists` never overrides an already-set variable, so a `.env` cannot switch modes. `.env` is loaded only by `pnpm dev` / `pnpm db:migrate`, never in production.
- Production has no fallbacks: `AUTH_SECRET` (≥32 chars), `PUBLIC_ORIGIN` (https, or http only for loopback hosts) and an absolute `DATABASE_PATH` are required; `LOG_LEVEL` `debug`/`trace` rejected. Outside production a missing `AUTH_SECRET` becomes a random per-process secret with a startup warning.
- `AUTH_SECRET` rejected in every mode if shorter than 32 characters or containing the `.env.example` placeholder marker `replace-me`.
- `Secret` wrapper: secret values render as `[REDACTED]` via `toString`, JSON and `util.inspect`; read only through `reveal()`.
- Logging (`apps/server/src/logging.ts`): request serializer logs method, redacted URL and remote address only; `/knot/{token}` and `/api/knot/{token}` path tokens and any query string are replaced with `[REDACTED]`; `authorization`, `cookie`, `x-csrf-token` and `set-cookie` headers are redacted by path.
- Relative `DATABASE_PATH` resolves against the repository root in both the server and `db:migrate`.
- Safe `.env.example` with placeholders only; Playwright's production server gets throwaway generated config.

**Tests/checks:**
- `pnpm test` — 30 tests. New negative tests: missing/unknown `NODE_ENV`; each required production variable missing; short and placeholder secret; non-https and `javascript:` origins; relative production DB path; debug/trace in production; error message and `inspect(error)` do not contain the rejected secret; `JSON.stringify`/`inspect` of config do not contain the secret; ephemeral secrets differ per load; config frozen; URL redaction cases; captured log output contains no Knot token, query token, cookie or bearer value.
- Mutation check: disabling URL redaction makes the log-capture test fail.
- Manual: `pnpm start` without configuration exits with the three missing variables listed; a `.env` containing `NODE_ENV=production` did not switch `pnpm dev`-style startup out of development.
- `pnpm lint`, `pnpm typecheck`, `pnpm test:e2e` (2 passed).

**Security docs updated:** YES.

**Remaining:**
- Better Auth consumes `AUTH_SECRET`/`PUBLIC_ORIGIN` from Step 2.x; SMTP settings are added with Step 9.1 using the same `Secret` wrapper.
- New token-bearing routes (e.g. invitation acceptance, recovery) must be added to the URL redaction pattern when introduced.
- Production secret injection method (Docker secrets vs. env) is decided in Step 10.1; secret rotation procedure still to be documented.

---

## 2 — Identity, invitations, and authentication

### 2.1 Internal User model
**Status:** DONE
**Completed:** 2026-09-26

**Objective:** Create stable internal User identity independent of login provider.

**Acceptance criteria:**
- opaque UUID;
- required unique normalized email;
- display name;
- account status;
- timestamps;
- architecture supports multiple linked authentication methods later.

**Security impact:** CRITICAL.

**Implemented:**
- Domain (`packages/domain/src/user.ts`): `User`, branded `UserId` / `NormalizedEmail`, `USER_STATUSES` (`ACTIVE`, `DISABLED`), `canAuthenticate()`, `DomainValidationError` with stable codes and messages that never echo input.
- `normalizeEmail`: trim → NFC → lower-case the whole address (case/composition variants cannot create a second account or dodge invite binding); shape check, control characters rejected, ≤254 chars / local part ≤64.
- `normalizeDisplayName`: trim → NFC, 1–80 code points, control and bidi override/isolate characters rejected (prevents spoofed names in audit snapshots). Emoji and non-Latin scripts allowed.
- Application port `UserRepository` (async, for a later DB swap) and `EmailAlreadyInUseError`.
- Database: `users` table + migration `0000_users.sql`. Drizzle property names follow Better Auth's core `user` schema (`name`, `email`, `emailVerified`, `image`, `createdAt`, `updatedAt`) so Better Auth (2.3) can use the table via `user.modelName = 'users'` without a data migration; columns are snake_case. `status` is ours and must be registered as a Better Auth additional field with `input: false`. CHECK constraints: 36-char id, normalized email ≤254, non-blank display name, valid status; unique index on email.
- `createUserRepository`: server-generated UUIDv4 ids (`crypto.randomUUID`), server timestamps, unique-email violations mapped to `EmailAlreadyInUseError`.
- Linked authentication methods: not a column on `users`. Better Auth's `account` table (provider + provider account id → `users.id`) will hold password and future Apple/GitHub credentials, added with 2.3.

**Tests/checks:**
- `pnpm test` — 69 tests. New: email normalization (case, NFC, 10 malformed inputs, length limits, no input echo); display-name normalization (bidi override/isolate, control chars, empty, code-point length); `parseUserId` rejects non-v4/upper-case/SQL-like input; repository create/find, non-sequential ids, duplicate normalized email rejected; raw-SQL inserts violating each CHECK constraint rejected.
- `pnpm db:migrate` applied to the dev DB and re-run idempotently; `pnpm lint`, `pnpm typecheck`, `pnpm test:e2e` pass.

**Security docs updated:** YES.

**Remaining:**
- Status changes (disable/enable) and who may perform them arrive with admin tooling (2.5 / 3.2) and must be audited.
- Better Auth configuration mapping (`modelName`, `status` additional field with `input: false`, `generateId: () => crypto.randomUUID()`) is done in 2.3.
- Email ownership (`emailVerified`) is established by invite acceptance in 2.2.

### 2.2 Invite-only account creation
**Status:** DONE
**Completed:** 2026-09-26 (acceptance and HTTP endpoints together with 2.3)

**Objective:** No public self-registration. A server admin sends an invitation to a specific email address.

**Decision (2026-09-26):** invitations are issued by **server admins** (server-wide flag on the User), not by Workspace ADMINs. First-admin bootstrap is a one-time CLI command. Delivery uses the transactional email abstraction (9.1), which is therefore implemented before this step. Acceptance (setting the password) needs Better Auth and is completed together with 2.3.

**Acceptance criteria:**
- only a server admin (or the one-time CLI bootstrap) can create invitations;
- invitation binds to normalized recipient email;
- invitation token is cryptographically random, single-use, expiring, and stored hashed where practical;
- invitation email contains the acceptance link;
- invite cannot be used for another email/account;
- accepting invite establishes password and verifies ownership of invited email;
- replay, expired and revoked invitations fail safely;
- invitation create/revoke/accept actions are audited;
- no invitation token is logged.

**Security impact:** CRITICAL.

**Implemented so far (2026-09-26):**
- Domain: `Invitation`, `invitationState()` (PENDING/ACCEPTED/REVOKED/EXPIRED), `serverAdmin` on `User`, `isActiveServerAdmin()` (flag + ACTIVE), security event types and `Actor` (user or named system channel).
- Tokens (`packages/auth`): 32-byte CSPRNG, base64url; only SHA-256 hex stored; malformed tokens rejected before any lookup.
- Use-cases (`packages/application/src/invitations`), authorization enforced inside each use-case:
  - `issueInvitation` — ACTIVE server admin only; refuses if an account exists for the email; supersedes pending invitations for that email; emails the link; token never returned to the caller (inviter cannot accept on the invitee's behalf); delivery failure leaves a pending, revocable invitation and reports `delivery: 'failed'`.
  - `bootstrapServerAdmin` — only while no server admin exists; admin-granting invitation, link returned for the operator's terminal only, supersedes every pending bootstrap invitation (at most one live bootstrap link).
  - `revokeInvitation` — ACTIVE server admin only; pending only; once.
  - `resolvePendingInvitation` — one generic error for malformed/unknown/expired/revoked/accepted.
- Link format `{PUBLIC_ORIGIN}/invite/{token}` (path, never query). `/invite/…` and `/api/invitations/…` added to log URL redaction.
- Database: `users.server_admin`; `invitations` table (hash unique, normalized email, CHECKs for expiry/outcome consistency, FKs to users); append-only `security_events` table (UPDATE/DELETE blocked by triggers, migration `0002`). Invitation state change and its security event(s) commit in one transaction.
- CLI: `pnpm admin:bootstrap --email …` (dev) / `NODE_ENV=production node apps/server/src/cli/admin-bootstrap.ts --email …` (prod). Prints link to stdout only.

**Tests/checks:** 126 tests. New negative tests: non-admin and DISABLED admin cannot issue; non-admin cannot revoke; revoke twice fails; bootstrap refused once an admin exists; account-exists refusal; malformed/unknown/expired/revoked/superseded tokens rejected with the same generic error; raw token absent from DB rows and events; token not in use-case result; security event failure (FK) rolls back invitation + supersede; security events cannot be updated/deleted; duplicate token hash rejected. CLI manually checked (usage/invalid email/extra args exit 1; production without config fails closed).

**Completed with 2.3 (2026-09-26):**
- `acceptInvitation` use-case + `InvitationRepository.accept`: token and bootstrap validity are checked *before* the password is hashed (invalid links never cost an Argon2id hash); then one `BEGIN IMMEDIATE` transaction re-checks pending state, bootstrap-only-while-no-server-admin and email uniqueness, creates the User (`emailVerified: true`, `serverAdmin` from the invitation), the `credential` account row (Argon2id hash) and marks the invitation accepted with a conditional update; `INVITATION_ACCEPTED` + `USER_CREATED` events in the same transaction. Acceptance never creates a session.
- `resolvePendingInvitation` now also rejects bootstrap links once a server admin exists (same generic error).
- `listPendingInvitations` (server admin only).
- HTTP (`apps/server/src/http/invitation-routes.ts`): `POST /api/invitations/resolve` and `POST /api/invitations/accept` (token in the JSON body, never in API URLs), `GET/POST /api/admin/invitations`, `POST /api/admin/invitations/{id}/revoke` (session required; authorization inside the use-cases).
- Web page `/invite/{token}`: GET only resolves (safe for mail link scanners), account creation is a form POST; the token is removed from the address bar/history after success. `Referrer-Policy: no-referrer` is global.

**Tests/checks (acceptance part):** replay; concurrent acceptance creates exactly one User; expired/revoked/superseded links rejected without hashing; weak password / bidi display name rejected with invitation still pending; account created by another path in between → rejected; bootstrap link rejected once any server admin exists; bootstrap invitee becomes server admin; listing is admin-only. HTTP: unknown/malformed token 404, extra fields (`serverAdmin: true`) 400, no session on acceptance, no token/password in logs.

**Remaining:** admin web UI for issuing/revoking invitations (API exists); resend-delivery button when `delivery: 'failed'`.

### 2.3 Local password login
**Status:** DONE
**Completed:** 2026-09-26

**Objective:** Secure email + password authentication using Better Auth.

**Acceptance criteria:**
- no custom password crypto;
- Argon2id or Better Auth's currently recommended secure password mechanism, reviewed before implementation;
- server-side/opaque secure session semantics;
- Secure/HttpOnly/SameSite cookies in production;
- session fixation prevention;
- login rate limiting;
- generic authentication errors;
- relevant security events audited.

**Security impact:** CRITICAL.

**Review before install (2026-09-26):**
- Better Auth **1.7.6** (published 2026-09-24): no GitHub advisory affects it (all listed advisories are fixed in ≤1.6.22 / 1.7.0-beta.10). Relevant history kept in mind: GHSA-xg6x-h9c9-2m83 (TOTP bypass via `cookieCache`), GHSA-p6v2-xcpg-h6xw (IPv6 rate-limit bypass), GHSA-g38m-r43w-p2q7 (OAuth auto-link) — none of those features is enabled.
- Its default password hash is scrypt N=2^14, r=16, p=1 (~32 MiB) compared with `===` on hex strings — below our policy. Replaced via `emailAndPassword.password.{hash,verify}` with **Argon2id** (`@node-rs/argon2@2.2.1`: PHC strings, constant-time verify, prebuilt binaries, no install scripts, npm provenance, no advisories).
- Better Auth's sign-in response contains the raw session token and honours `callbackURL` (redirect); its IP detection trusts `X-Forwarded-For` by default; its built-in origin/CSRF checks are skipped when `NODE_ENV=test`. Consequence: Better Auth's HTTP handler is **not mounted**; the server calls `auth.api.*` from narrow Fastify routes.
- Telemetry is off by default (explicitly disabled as well; the `BETTER_AUTH_TELEMETRY` env var would still enable it — never set it).

**Implemented:**
- `packages/auth`: `createAuth()` (Better Auth on the existing `users` table via Drizzle adapter; `sessions`, `accounts`, `verifications` models; `status`/`serverAdmin` as `input: false`; server-generated UUIDs; sign-up, email change, user deletion and account linking disabled; `cookieCache` disabled; Better Auth rate limiter disabled in favour of Fastify's; client IP only from an internal header set by the server; log messages forwarded without structured arguments). `hashPassword`/`verifyPassword`: Argon2id m=64 MiB, t=3, p=1, 32-byte output, NFKC-normalized input; malformed hashes never match.
- Domain `validateNewPassword`: 15–128 characters (NIST SP 800-63B-4 single-factor minimum, since TOTP is optional), no composition rules.
- DB migration `0003_better_auth_tables`: `sessions` (unique token, FK to users), `accounts` (unique provider+subject, CHECK that `credential` rows point to their own user and hold an Argon2id PHC string), `verifications` (required by Better Auth's schema check; unused in V1).
- HTTP (`apps/server/src/http/`): `POST /api/auth/sign-in`, `POST /api/auth/sign-out`, `GET /api/auth/session`; `requireUser` preHandler + `authenticate()` (the central place for the 2.4 TOTP gate). Sign-in accepts exactly `{email, password}`, normalizes the email, answers every failure with one `401 invalid_credentials`, strips the token from the response, revokes any session presented with the login request (rotation) and records `LOGIN_SUCCEEDED` (in Better Auth's session-create hook — if the event cannot be written, sign-in fails before the cookie is issued) / `LOGIN_FAILED` (existing accounts only; unknown identifiers are not stored) / `LOGOUT`.
- Sessions: opaque ~190-bit token, cookie `__Secure-vmn.session_token` in production (`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, no `Domain`), value HMAC-signed with `AUTH_SECRET`; 7-day idle expiry (refreshed at most daily), 30-day absolute lifetime enforced on every request; sessions of DISABLED users are revoked on sight and DISABLED users cannot start sessions.
- CSRF: global `onRequest` guard — every non-GET/HEAD/OPTIONS request must carry `Origin` equal to `PUBLIC_ORIGIN`; `text/plain` body parser removed (JSON only); plus `SameSite=Strict`.
- Rate limits (`@fastify/rate-limit@11.2.0`, in-memory, IPv6 grouped per /56): global 300/min per client; sign-in 10/min per client and 10/15 min per account; invitation resolve 30/15 min, accept 10/15 min, admin issue 30/15 min per client.
- Central error mapping to stable JSON codes; unexpected errors are logged with type and stack frames only (messages can embed query parameters). Global body limit 64 KiB (4 KiB on auth routes).
- Web: sign-in form, invitation acceptance page, signed-in shell with sign-out (`apps/web/src`).
- `main.ts` opens the database and wires services; e2e runs migrations before starting the server.

**Tests/checks:**
- `pnpm test` — 190 tests. New: Argon2id format/parameters, salting, NFKC, malformed-hash handling; password policy; acceptance use-cases (see 2.2); HTTP integration suite `apps/server/src/http/auth.test.ts` (40): cookie flags and no token in body; identical responses for unknown email / wrong password / malformed email / over-long password; LOGIN_FAILED only for existing accounts and no attempted identifiers stored; LOGIN_SUCCEEDED with session id; session rotation on login; `callbackURL` rejected; DISABLED user refused + sessions revoked; per-IP and per-account rate limits; tampered cookie and raw DB token rejected; absolute and idle expiry; server-side sign-out; missing/foreign/`null`/scheme-mismatched `Origin` rejected on sign-in, sign-out and admin routes; non-JSON bodies 415; admin routes 401 unauthenticated / 403 for a USER (list, issue, revoke) / full admin flow; 12 Better Auth endpoints (sign-up, update-user, change-password, reset, list-accounts, …) unreachable; logs contain no tokens, passwords or attempted emails.
- Mutation checks: disabling the origin guard, the absolute-lifetime check, the per-request status check, session rotation, or the per-account limiter each makes at least one test fail.
- Log review: captured log output of the whole suite contains only method, redacted URL, status and Better Auth messages such as "User not found" / "Invalid password" (no identifiers).
- `pnpm test:e2e` — CLI bootstrap → `/invite/{token}` → account creation → link reuse rejected → wrong password → sign-in (cookie `HttpOnly`/`Secure`/`Strict` verified in Chromium) → reload → sign-out; plus smoke tests (desktop + mobile).
- `pnpm lint`, `pnpm typecheck`; `pnpm audit`: 0 high/critical, only the known dev-only moderate GHSA-67mh-4wv8-2f99 (esbuild via `drizzle-kit`, now also reachable as Better Auth's optional peer).

**Security impact:** CRITICAL — new credential type (password hashes), session cookies, login/logout endpoints, admin endpoints.

**Security docs updated:** YES (`security.md` §1, §2, §5, §9 and per-task blocks "local password login and sessions", "invite-only account bootstrap").

**Remaining:**
- **Reverse proxy:** `trustProxy` is still `false` (Step 10.3). Behind a proxy all clients share the proxy's address, so per-client limits act as one global limit (an attacker can then throttle everyone's sign-in). Configure trusted proxies before production use behind a proxy.
- Password change (with re-authentication and revocation of other sessions) is not exposed yet; add with account settings (2.4) or 2.5. Admin password reset is 2.5.
- No breached/common-password blocklist yet (NIST recommends one); consider an offline list.
- Session tokens are stored unhashed in `sessions.token` (Better Auth design). A DB leak alone does not yield usable cookies (HMAC with `AUTH_SECRET`), but DB + secret does.
- Rate-limit state is in memory (single process; resets on restart); revisit for multi-node deployments.
- Admin web UI for invitations; session list/revoke UI.
- `drizzle-kit` appears in `packages/auth`'s resolved tree as Better Auth's optional peer; ensure production images install without dev tooling (10.1).


### 2.4 Optional user-activated TOTP
**Status:** DONE
**Completed:** 2026-09-26

**Objective:** TOTP is a built-in feature from V1 that every local user can activate for their own account. It is **not mandatory** for now; the design must keep a server-side enforcement seam so a later policy (for example "ADMIN accounts require TOTP" or a per-Workspace requirement) can be added without redesign.

**Enrollment flow (user-initiated, from account settings):**

```text
Authenticated user opens account security settings
  -> re-authenticates (current password)
  -> TOTP seed generated, QR/secret shown once
  -> user submits valid OTP
  -> TOTP activated
  -> recovery codes presented once
```

**Login flow for an account with TOTP enabled:**

```text
email + password
  -> restricted pre-MFA session (TOTP challenge/logout only)
  -> valid OTP or recovery code
  -> session rotated to full authenticated session
```

Accounts without TOTP enabled log in with email + password only.

**Acceptance criteria:**
- user can enable TOTP from account settings; enabling requires recent re-authentication;
- cryptographically strong TOTP seed;
- enrollment verified with a valid OTP before activation;
- backup/recovery codes generated and stored hashed;
- disabling TOTP requires re-authentication plus a valid OTP or recovery code;
- regenerating recovery codes requires re-authentication;
- for TOTP-enabled accounts, no access to Workspace/Procedure/Run/Knot/admin/SSE routes before the TOTP challenge succeeds;
- session rotated after successful TOTP challenge;
- OTP and recovery-code attempts rate-limited;
- TOTP/recovery secrets never logged;
- enable/disable/recovery-code use/regeneration are audited;
- no "remember this device" in V1 unless separately approved;
- TOTP reset (lost device) is admin-assisted in V1 and fully audited;
- MFA requirement is evaluated by a central server-side policy (currently "required only if the user enabled TOTP"), so a future enforcement rule is a policy change, not a rewrite;
- negative tests prove a TOTP-enabled account cannot bypass the challenge through API/SSE/Knot endpoints or by client-supplied flags.

**Security impact:** CRITICAL.

**Review and design decision (2026-09-26):** Better Auth's `twoFactor` plugin (1.7.6) was reviewed and **not used**: no OTP replay protection (a code is reusable within its ±30 s window), backup codes stored as one plaintext or reversibly encrypted JSON blob and consumed by a non-atomic read-modify-write (concurrent reuse possible), disabling requires only the password, and it ships "trust device" (not allowed in V1). Instead the flows are implemented as application use-cases with reviewed primitives: `otpauth@9.5.2` (RFC 6238, constant-time comparison, returns the matched step — enables replay protection; old advisory GHSA-rmmc-8cqj-hfp3 fixed in 3.2.8), Node/OpenSSL AES-256-GCM + HKDF for secret encryption, SHA-256 for 80-bit recovery codes. Better Auth still creates and signs every session, through a small server-only plugin (`issueSession`, `checkPassword`).

**Pre-MFA state:** stronger than the "restricted session" sketched above — for a TOTP account the session Better Auth creates at the password step is deleted before its cookie leaves the server; the client receives only a challenge token (256-bit, SHA-256 at rest, 5 min, 5 attempts, single use) in an `HttpOnly`/`Secure`/`SameSite=Strict` cookie scoped to `Path=/api/auth/mfa`. With no session in existence there is nothing a Workspace/admin/SSE/Knot route could accept by mistake.

**Implemented:**
- Domain `mfa.ts`: TOTP parameters (SHA-1, 6 digits, 30 s, ±1 step, 160-bit secret), `requiresTotpChallenge()` — the central MFA policy (currently "TOTP enabled"), `totpLockDurationMs()` (lock after every 10 consecutive failures: 15 min doubling, max 24 h), `normalizeTotpCode()` (exactly six ASCII digits).
- Application `mfa/use-cases.ts`: `startTotpEnrollment` (password), `confirmTotpEnrollment` (valid code within 10 min; yields 10 recovery codes once), `disableTotp` (password + TOTP or recovery code), `regenerateRecoveryCodes` (password), `beginMfaChallenge`, `completeMfaChallenge`, `requiresSecondFactor`, `mfaStatus`. Recovery codes bypass the TOTP lock (unguessable; lets the owner in during an attack).
- DB migration `0004_totp_mfa`: `totp_credentials` (sealed secret, `last_used_step`, failure count, lock), `recovery_codes` (hash per code, `used_at`), `mfa_challenges`. Conditional updates make step acceptance, recovery-code use and challenge consumption single-use under concurrency; state change + security event in one `IMMEDIATE` transaction.
- Secret encryption: `DATA_ENCRYPTION_KEY` (new required production variable, ≥32 chars, must differ from `AUTH_SECRET`), HKDF-SHA256 → AES-256-GCM, random 96-bit IV, user id bound as associated data.
- HTTP: sign-in returns `{mfaRequired: true}` + challenge cookie for TOTP accounts; `POST /api/auth/mfa` (`{code}` or `{recoveryCode}`); `GET /api/account/mfa`, `POST /api/account/mfa/totp/setup|confirm|disable`, `POST /api/account/mfa/recovery-codes` (full session required, per-account limit 10/15 min plus per-client limits). Enabling or disabling TOTP revokes **all** of the user's sessions and issues a fresh one.
- Security events: `MFA_CHALLENGE_STARTED`, `TOTP_CODE_REJECTED`, `TOTP_LOCKED`, `TOTP_ENROLLMENT_STARTED`, `TOTP_ENABLED`, `TOTP_DISABLED`, `RECOVERY_CODE_USED`, `RECOVERY_CODES_REGENERATED`; `LOGIN_SUCCEEDED` now carries `method` (`password` / `totp` / `recovery_code`) and is written by the routes (after the MFA outcome is known, before the cookie is sent).
- Web: second sign-in step (authenticator or recovery code), account security section (enable with locally rendered QR code via `qrcode-generator@2.0.4` into a `data:` image, disable, new recovery codes).

**Tests/checks:**
- `pnpm test` — 253 tests. New: domain policy/lock/code normalization; RFC 6238 test vector and drift window; recovery code format/entropy/hash normalization; secret box round-trip, fresh IV, wrong context, wrong key, tampering; 22 use-case tests (password required, activation only after valid code, no plaintext secret/codes in DB, enrollment expiry and replacement, no re-enrollment while enabled, challenge single use, replay across challenges and from enrollment, drift, 5 attempts, 5 min expiry, malformed tokens, disabled user, lock after 10 failures with recovery code still working and unlock after 15 min, concurrent recovery-code use → 1 success, disable needs password + factor, regeneration invalidates old codes); 12 HTTP tests (`apps/server/src/http/mfa.test.ts`): no session and a narrowly scoped challenge cookie after the password step, challenge cookie (also disguised as session cookie) rejected by session/account/admin routes, `mfaVerified` flag rejected, missing/forged challenge, full session only after a valid code and only once, recovery code once, 5-attempt limit, replay, disabled-after-password, all other sessions revoked on enable/disable, regeneration, no secrets/codes/challenge tokens/passwords in logs.
- Mutation checks: skipping the sign-in MFA gate, keeping the pre-MFA session, removing replay protection, disabling without second factor, not revoking sessions on TOTP change, ignoring the lock, and removing the per-challenge attempt limit each fail at least one test.
- `pnpm test:e2e`: bootstrap → account → sign-in → TOTP enrollment via UI (QR shown, key read from page) → 10 recovery codes → sign-out → sign-in requires code (no session cookie before it) → signed in → sign-out.
- `pnpm lint`, `pnpm typecheck`, `pnpm audit` (unchanged: only dev-only moderate GHSA-67mh-4wv8-2f99). Migration 0004 applied on a copy of the dev DB.

**Security impact:** CRITICAL — new credential types (TOTP secrets, recovery codes, challenge tokens), new encryption-at-rest key, new authentication step.

**Security docs updated:** YES (§1 TOTP, §2, §9, §13, TOTP and secret-box check blocks).

**Remaining:**
- Admin-assisted TOTP reset (lost device) → 2.5.
- Enforcement policy (e.g. mandatory TOTP for server admins) is a change to `requiresTotpChallenge()` plus an enrollment-on-login flow; not decided.
- `DATA_ENCRYPTION_KEY` rotation needs a re-encryption tool (the sealed format is versioned `v1.` to allow it); until then the key must not change (see deployment.md).
- Expired/consumed `mfa_challenges` rows and unconfirmed enrollments are not cleaned up yet (small, no secrets in plaintext).
- Future SSE/Knot routes must use `requireUser`; tests for them must include the "challenge cookie only" case.


### 2.5 Admin-assisted account recovery
**Status:** DONE
**Completed:** 2026-09-26

**Objective:** V1 has no public password-reset-by-email flow.

**Acceptance criteria:**
- recovery requires ADMIN action;
- action is explicitly audited;
- recovery cannot expose current password/TOTP secret;
- recovery uses short-lived one-time reset/enrollment mechanism;
- reset invalidates relevant existing sessions;
- TOTP reset removes the user's TOTP credential and recovery codes, is audited, and the user may re-enroll afterwards.

**Security impact:** CRITICAL.

**Design (security review 2026-09-26, security.md §12 trigger "account recovery"):**
- A server admin starts a recovery for another account by email, choosing *reset password*, *reset TOTP* or both. Step-up required: the admin's current password, plus the admin's TOTP/recovery code if the admin has TOTP. Admins cannot target themselves (own credentials are changed in account settings).
- The link (`/recover/{token}`, 256-bit, SHA-256 at rest, **60 min**, single use, superseded by a newer one) is emailed to the **account's own address** and never returned to the admin — a malicious admin or stolen admin session also needs the user's mailbox.
- Completing: password reset sets a new password; a TOTP-only reset requires the user's **current password** (mailbox + password). One `IMMEDIATE` transaction claims the recovery, applies the reset (TOTP credential + recovery codes deleted), invalidates pending MFA challenges, deletes **all sessions** of the user and records the events. No session is created; the user signs in again.
- Operator CLI `admin:recover --email … [--password] [--totp]` for when no admin can act (e.g. the only server admin lost the authenticator): prints the link to the terminal; attributed to `cli:admin-recover`.
- Self-service password change (`POST /api/account/password`): current password + policy-valid new password; all sessions revoked in the same transaction, the client gets a fresh session.

**Implemented:** domain `recovery.ts`; application `recovery/` (`issueAccountRecovery`, `issueOperatorRecovery`, `resolveAccountRecovery`, `completeAccountRecovery`, `changePassword`) and `verifyStepUp` in `mfa/`; DB migration `0005_account_recoveries` (CHECKs: scope non-empty, single outcome, never self-issued) and `createAccountRecoveryRepository` / `createCredentialRepository`; HTTP `POST /api/admin/recoveries`, `POST /api/recoveries/resolve|complete`, `POST /api/account/password`; `/recover/…` and `/api/recoveries/…` added to log redaction; CLI `apps/server/src/cli/admin-recover.ts` (`pnpm admin:recover`); web pages `/recover/{token}` and "Change password"; security events `ACCOUNT_RECOVERY_ISSUED/_SUPERSEDED/_COMPLETED`, `PASSWORD_RESET`, `TOTP_RESET`, `PASSWORD_CHANGED` (with revoked-session counts).

**Tests/checks:**
- `pnpm test` — 279 tests. New use-case tests (17): link only to the account owner, token absent from result/DB/events; non-admin, disabled admin, wrong admin password refused without side effects; admin TOTP step-up; self/unknown/disabled/TOTP-less targets refused; supersede; password reset sets new password, revokes only that user's sessions, single use, weak password rejected with link still usable, 60-min expiry, target disabled after issue, concurrent completion → one; TOTP reset needs current password, removes credential + codes, invalidates challenges, re-enrollment possible; both-factor reset; operator recovery of the only admin attributed to the CLI; password change. HTTP tests (8, `apps/server/src/http/recovery.test.ts`) incl. old sessions dead after completion, non-admin 403, missing admin password 403, missing admin TOTP `second_factor_required`, empty scope / self / unknown, no tokens or passwords in logs, password change replaces all sessions.
- Mutation checks: removing admin step-up, the admin check, the self-target check, the current-password requirement for TOTP reset, session revocation on completion, or the single-use condition each fails tests.
- CLI manually: usage errors, unknown account, TOTP-less account → exit 1; valid run prints link.
- `pnpm test:e2e`: extended with CLI TOTP recovery of the only admin → `/recover/{token}` with current password → sign-in without TOTP.
- `pnpm lint`, `pnpm typecheck`, `pnpm audit` (unchanged), migration 0005 on a copy of the dev DB.

**Security impact:** CRITICAL — new privileged action over other accounts, new token type, credential replacement paths.

**Security docs updated:** YES.

**Remaining:**
- Admin web UI for starting recoveries (API only; `curl`/future admin page).
- Recovery delivery depends on the user's mailbox; a user who lost mailbox access needs an operator-driven process (e.g. CLI link handed over in person) — document per deployment.
- Disabling/enabling accounts (status change with session revocation) is not implemented yet.


### 2.6 External identity provider abstraction
**Status:** DEFERRED

**Objective:** Future sign-in with Apple and GitHub (planned). Microsoft remains a possible later provider.

**Acceptance criteria when activated:**
- provider identities link to internal User UUID;
- explicit safe account-linking rules;
- state/nonce/PKCE as applicable;
- provider tokens treated as secrets;
- users who enabled TOTP must not be able to bypass it by signing in through a provider; MFA policy for provider logins is decided explicitly because provider-login paths can have different 2FA semantics;
- linking/unlinking a provider requires recent authentication and is audited.

**Security impact:** CRITICAL.

---

## 3 — Workspaces and ACLs

### 3.1 Workspace and Membership
**Status:** DONE
**Completed:** 2026-09-27

**Objective:** Workspace is the primary collaboration/security boundary.

**Decision (2026-09-26):** only server admins create Workspaces for now; creation goes through one central capability check so a later admin-board option ("allow USERs/EDITORs to create Workspaces") only changes the policy. That option is not part of 3.1.

**Acceptance criteria:**
- user may belong to multiple Workspaces;
- Membership maps User + Workspace + role;
- Procedures and Runs belong to one Workspace;
- removal from Workspace revokes future access promptly.

**Security impact:** CRITICAL — new permission boundary (Workspace), role assignment, personal data of members.

**Implemented:**
- Domain (`packages/domain/src/workspace.ts`): `Workspace`, `Membership`, branded `WorkspaceId`, `parseWorkspaceId`, `normalizeWorkspaceName` (same rules as display names: trim, NFC, 1–80 code points, no control/bidi characters; shared helper `text.ts`). New security event types `WORKSPACE_CREATED`, `WORKSPACE_RENAMED`, `MEMBERSHIP_ADDED`, `MEMBERSHIP_ROLE_CHANGED`, `MEMBERSHIP_REMOVED`.
- Policy (`packages/permissions`): role → capability table (`workspace.view` all roles; `workspace.members.view` USER+; `workspace.members.manage` and `workspace.settings.manage` ADMIN), `capabilitiesOf`, `rolesWithCapability`, `canCreateWorkspace` (ACTIVE server admins only — the single switch for the planned admin-board option).
- Application (`packages/application/src/workspaces`): `authorizeWorkspace` (ACTIVE actor + Membership + capability; non-member ≡ unknown id → `WorkspaceNotFoundError`), `createWorkspace` (creator becomes ADMIN), `listMyWorkspaces`, `getWorkspace` (role + capabilities), `listMembers` (email/status only for managers), `renameWorkspace`, `addMember` (existing ACTIVE account by email; unknown/disabled → same `UnknownAccountError`), `changeMemberRole`, `removeMember`. Port `WorkspaceRepository` with a `MembershipGuard` evaluated inside the write transaction.
- Database: migration `0006_workspaces_memberships` — `workspaces` (UUID id CHECK, non-blank name, creator FK) and `memberships` (composite PK workspace+user, role CHECK, FKs without cascade, index on user). `createWorkspaceRepository`: every mutation in `BEGIN IMMEDIATE`, re-checks the actor's current role and ACTIVE status, keeps ≥1 ACTIVE ADMIN (rollback otherwise), writes the security event in the same transaction.
- HTTP (`apps/server/src/http/workspace-routes.ts`): `GET/POST /api/workspaces`, `GET /api/workspaces/{id}`, `POST …/rename`, `GET/POST …/members`, `POST …/members/{userId}/role`, `POST …/members/{userId}/remove`; strict Zod schemas, lower-case UUIDv4 ids; add-member limited to 30/15 min per client; error codes `workspace_not_found` (404), `member_not_found` (404), `already_member` (409), `last_workspace_admin` (409), `unknown_account` (404), `forbidden` (403).
- Web (`apps/web/src/Workspaces.tsx`): own Workspaces with role, create form for server admins, member table with role select / remove / leave and add-member form for admins. Capabilities from the API only adapt the UI.

**Tests/checks:**
- `pnpm test` — 329 tests (+50). New: domain name/id validation (4); policy matrix, monotonicity, fail-closed unknown role, `canCreateWorkspace` (5); use-cases against SQLite (29, see security.md "Workspaces and Memberships"); HTTP (12: 401 everywhere, Origin guard, identical 404 for non-member/unknown, cross-Workspace, vertical escalation, contact data hidden, removal/demotion effective on the same session's next request, last admin, strict validation, rate limit).
- Mutation checks: removing the capability check, the create check, the in-transaction actor guard, the last-admin check, the ACTIVE check in `authorizeWorkspace` or the contact filter each fails tests.
- `pnpm test:e2e` (3 passed, 1 skipped as before): account flow extended with Workspace creation, member table, unknown-account and last-admin messages.
- `pnpm lint`, `pnpm typecheck`; migration 0006 applied twice to a copy of the dev DB. No new dependencies (audit unchanged).
- Tooling note: pnpm was not on PATH in this session; commands were run through the repository-local binaries (`node_modules/.bin/{vitest,tsc,eslint,playwright}`, `drizzle-kit`, `vite`) — equivalent to the pnpm scripts.

**Security docs updated:** YES (§3 checklist, "Security check: Workspaces and Memberships (Step 3.1)").

**Remaining:**
- Procedures and Runs do not exist yet; "Procedures and Runs belong to one Workspace" is satisfied by design (FK to `workspaces`, capability checks via `authorizeWorkspace`) when 4.1/5.1 add them.
- Inviting a new person directly into a Workspace (invitation with Workspace grant) — invitations remain server-admin only; admins add existing accounts.
- Self-service "leave Workspace" for non-admins; Workspace archiving/deletion; server-level repair when the only ADMIN is disabled.
- "Add member by email" reveals to a Workspace ADMIN whether an ACTIVE account exists (accepted, rate-limited, audited).

### 3.2 Roles and policies
**Status:** DONE
**Completed:** 2026-09-27

**Objective:** Implement Guest, User, Editor, Admin via centralized server-side policies.

Initial intent:
- GUEST: read explicitly permitted Workspace content/history
- USER: execute permitted Procedures/Runs
- EDITOR: create/edit/soft-delete Procedures
- ADMIN: membership, roles, invitations, recovery, Workspace settings

Exact capabilities must be represented centrally rather than scattered string comparisons.

**Required tests:**
- cross-Workspace denial;
- horizontal privilege escalation denial;
- vertical role escalation denial;
- removed member denial;
- SSE subscription authorization.

**Security impact:** CRITICAL.

**Decision (2026-09-27, derived from the initial intent above and 3.3 — review welcome):** V1 has no per-Procedure ACLs, so GUEST's "explicitly permitted content" is the Workspace's non-deleted Procedures and its Run history, read-only. Invitations and account recovery stay **server-admin** capabilities (locked decisions), not Workspace ADMIN capabilities.

| Capability | GUEST | USER | EDITOR | ADMIN |
|---|---|---|---|---|
| `workspace.view` (see Workspace, leave it) | ✓ | ✓ | ✓ | ✓ |
| `workspace.members.view` | | ✓ | ✓ | ✓ |
| `procedure.view` | ✓ | ✓ | ✓ | ✓ |
| `run.view` (incl. history/audit) | ✓ | ✓ | ✓ | ✓ |
| `run.start`, `run.execute`, `run.abort` | | ✓ | ✓ | ✓ |
| `procedure.edit`, `procedure.restore` | | | ✓ | ✓ |
| `workspace.members.manage`, `workspace.settings.manage` | | | | ✓ |

**Implemented:**
- The matrix above in `packages/permissions` (the only place roles map to capabilities). Procedure/Run capabilities are enforced by the use-cases of Steps 4/5 via `authorizeWorkspace`.
- `leaveWorkspace` use-case + `POST /api/workspaces/{id}/leave`: any member leaves on their own (audited as `MEMBERSHIP_REMOVED` by themselves); the last ACTIVE admin gets `last_workspace_admin`. Web: "Leave Workspace" button with confirmation; admins no longer remove themselves through the member table.
- From 3.1: `authorizeWorkspace`, in-transaction re-check of the actor's role, audited role changes, cross-Workspace / horizontal / vertical / removed-member negative tests.

**Tests/checks:**
- `pnpm test` — 337 tests (+8): exact matrix, GUEST read-only (`*.view` only), author/execute role sets; leave for GUEST/USER/EDITOR, last admin cannot leave until another ACTIVE admin exists, non-member leave ≡ unknown Workspace and only removes the caller; HTTP leave incl. missing `Origin` and 401.
- `pnpm test:e2e` (3 passed, 1 skipped): last-admin leave refused via the new button.
- `pnpm lint`, `pnpm typecheck`. No schema change, no new dependencies.

**Security impact:** CRITICAL — defines who may author, execute and read.

**Security docs updated:** YES (§3, "Security check: Workspace role policy (Step 3.2)").

**Remaining:**
- SSE subscription authorization test moves to 6.1 (its acceptance criteria already require it): subscriptions must check `run.view` on connect and drop on membership removal/demotion.
- Repairing a Workspace whose only ACTIVE admin is disabled: to be designed with account disabling (server admin action, audited).
- Revisit whether USER should abort Runs started by others once Runs exist (currently `run.abort` for USER+, a policy-only change).

### 3.3 Workspace-wide Procedure visibility
**Status:** DONE
**Completed:** 2026-09-27 (with 4.1)

All non-deleted Procedures in a Workspace are visible according to Workspace role permissions. Per-Procedure ACLs are out of V1 scope.

**Implemented:** `listProcedures` / `getProcedure` require `procedure.view` (every role) and return all non-deleted Procedures of the Workspace; soft-deleted ones are invisible to everyone until 4.5 adds the restore view (`procedure.restore`). Tests: every role sees the same list; deleted Procedures are hidden and unreachable by id.

---

## 4 — Procedure authoring

### 4.1 Procedure CRUD
**Status:** DONE
**Completed:** 2026-09-27

Create/edit/soft-delete reusable Procedures with title, description, icon, tags, and UUID.

**Security impact:** HIGH — new Workspace child resource, user-authored text rendered to other members, new audit log.

**Implemented:**
- Domain (`packages/domain/src/procedure.ts`): `Procedure`, `ProcedureContent`, `ProcedureId`; title 1–120 code points single-line; description plain text ≤4000 code points (line feed/tab allowed, other control and bidi characters rejected, CRLF → LF); icon from the trusted key list `PROCEDURE_ICONS` (15 keys, clients map keys to artwork); ≤10 tags of ≤32 code points, case-insensitive de-duplication. `AUDIT_EVENT_TYPES` (`PROCEDURE_CREATED/_UPDATED/_DELETED`).
- Application (`packages/application/src/procedures`): `listProcedures`, `getProcedure` (`procedure.view`), `createProcedure`, `updateProcedure`, `deleteProcedure` (`procedure.edit`), all via `authorizeWorkspace`. Optimistic concurrency: updates carry `expectedRevision`; a stale revision → `ProcedureConflictError` (409) instead of a silent overwrite; no-op edits change nothing. At most 1000 non-deleted Procedures per Workspace. Shared `ActorGuard` port (the in-transaction re-check introduced in 3.1, now also used by Procedures) and `userActor` helper.
- Database: migration `0007` — `procedures` (Workspace FK without cascade, CHECKs for id, title, description length, icon key list, tags JSON array ≤10, revision ≥1, deletion columns consistent) and `audit_events` (Workspace-scoped, actor id + display-name snapshot, JSON metadata); migration `0008` — `audit_events` append-only triggers. `createProcedureRepository`: every query is scoped by Workspace id *and* Procedure id and excludes deleted rows; writes run in `BEGIN IMMEDIATE`, re-check the actor, and record the audit event in the same transaction (metadata: title, changed field names, revision — no content copies).
- HTTP (`apps/server/src/http/procedure-routes.ts`): `GET/POST /api/workspaces/{id}/procedures`, `GET …/procedures/{procedureId}`, `POST …/{procedureId}/update`, `POST …/{procedureId}/delete`; strict Zod bodies with coarse transport bounds, domain applies exact rules; errors `procedure_not_found` (404), `procedure_conflict` (409), `procedure_limit_reached` (409).
- Web (`apps/web/src/Procedures.tsx`): list, detail (description rendered as text with preserved line breaks), create/edit form (icon select from the key list, comma-separated tags), delete with confirmation; conflict message on stale edits. Edit/delete controls only for `procedure.edit`.
- `test-env/seed.ts` creates three demo Procedures in "Demo Household" as the editor.

**Tests/checks:**
- `pnpm test` — 369 tests (+32): domain content rules (6), use-cases against SQLite (17: EDITOR/ADMIN lifecycle with audit, USER/GUEST refused, validation before write, in-transaction re-check after concurrent demotion, per-Workspace limit, stale revision conflict, no-op edit, all roles see the same list, soft delete hides but keeps the row, Procedure id through another Workspace ≡ unknown, non-member ≡ unknown Workspace for read/create/update/delete, removal effective, audit rollback atomicity, append-only triggers, DB CHECK/FK constraints), HTTP (8: lifecycle, 401 on every route, Origin guard, read-only roles, cross-Workspace ids, 409 conflict, strict validation incl. markup/URL icons and extra fields, verbatim JSON text), web/domain constant drift test (1).
- Mutation checks: removing the Workspace scoping of Procedure queries, the deleted filter, the revision check, the in-transaction guard on create, the use-case check on update, or using `procedure.view` for authoring each fails tests.
- `pnpm test:e2e`: account flow extended with create/view/edit/delete of a Procedure (markup in the description shown as text).
- `test-env` install → demo Procedures listed for GUEST, GUEST create → 403 → uninstall.
- `pnpm lint`, `pnpm typecheck`; migrations 0007/0008 applied twice to a copy of the dev DB. No new dependencies.

**Security docs updated:** YES (§3, §5, §6, "Security check: Procedures (Steps 4.1, 3.3)").

**Remaining:**
- ~~The web client keeps its own copy of the icon and role lists~~ — done 2026-09-27: `apps/web` depends on `@vergissmeinnicht/domain` (browser-safe) and imports `PROCEDURE_ICONS`, `REASON_POLICIES`, `WORKSPACE_ROLES` and the state types; the drift test was removed.
- No history view of `audit_events` yet; restore of deleted Procedures is 4.5.
- Search/filter by tag is not implemented (not required by 4.1).

### 4.2 Sections and CHECK Steps
**Status:** DONE
**Completed:** 2026-09-27

Support ordered Sections and V1 `CHECK` Steps with:
- title;
- description;
- icon;
- required/optional;
- critical flag;
- press-and-hold confirmation for critical Steps;
- Skip reason policy;
- Not Applicable reason policy.

Reason policies are independently:
- disabled;
- optional;
- required.

**Decision (2026-09-27, user):** one audit entry per save. Editors save the whole Procedure (content + ordered Sections + Steps) in one request; the `PROCEDURE_UPDATED` event summarizes what changed (`fields` incl. `structure`, counts of Sections/Steps added, removed and changed — moves and reorders count as changes).

**Security impact:** HIGH — nested child resources with client-supplied ids (IDOR risk), larger request bodies.

**Implemented:**
- Domain (`packages/domain/src/procedure-structure.ts`): `ProcedureSection`, `ProcedureStep` (`kind: 'CHECK'`, title ≤200, plain-text description ≤4000, optional trusted icon key, `required`, `critical`, `skipReasonPolicy` / `notApplicableReasonPolicy` ∈ `DISABLED`/`OPTIONAL`/`REQUIRED`), `normalizeProcedureStructure` (≤50 Sections, ≤200 Steps per Procedure, UUIDv4 item ids unique across Sections and Steps), `summarizeStructureChange`. The *meaning* of reason policies and required/critical is enforced by Run execution (5.2–5.4); 4.2 stores them. Press-and-hold is the Run UI (5.3); authoring only sets the critical flag.
- Application: `ProcedureInput.sections` (complete structure); create/get/update return `ProcedureDetail` (Procedure + Sections); `InvalidProcedureReferenceError` for foreign ids.
- Database: migration `0009` — `procedure_sections` and `procedure_steps` (positions unique per parent and bounded, CHECKs for kind, policies, icon, lengths; composite FK `(section_id, procedure_id)` → `procedure_sections(id, procedure_id)` so a Step can never sit in another Procedure's Section; no cascading deletes). The repository resolves ids inside the `IMMEDIATE` transaction: a named id must already be a Section/Step of *this* Procedure (right kind); new items get server UUIDs; client ids on create are always rejected. The structure is rewritten as a whole with ids preserved; unchanged saves are no-ops; soft delete keeps Sections/Steps.
- HTTP: create accepts `sections` (default empty), update **requires** `sections` (a missing field must never mean "delete everything"); strict nested Zod schemas; body limit 1 MiB on create/update (a full 200-Step Procedure can exceed the global 64 KiB); error `invalid_item_reference` (400). List responses stay without structure; detail/create/update responses include it.
- Web: `ProcedureForm.tsx` edits Sections and Steps (add, remove, ↑/↓ reorder, all Step fields; labels explicitly associated for assistive tech), `Procedures.tsx` shows the structure with Required/Optional, Critical and reason-policy text; icon components shared in `procedure-icons.tsx`.
- `test-env/seed.ts`: demo Procedures now have Sections and Steps covering every flag and policy.

**Tests/checks:**
- `pnpm test` — 388 tests (+19): domain structure rules (6: normalization, policies, icons, malformed/duplicate ids incl. cross-kind, limits, change summary), use-cases (10: ordered create with server ids, stable ids across edit/reorder/move with one audit event and exact summary, no-op, foreign Step/Section ids from another Procedure and another Workspace rejected with nothing changed, Section id used as Step id and vice versa, client ids on create, stale save, USER refused, invalid policy, soft delete keeps structure, DB composite FK/unique/CHECK), HTTP (3: structure round trip and required `sections` on update, stolen Step id → 400 with the other Procedure intact, strict Step field validation), drift test extended to reason policies.
- Mutation checks: removing the Step-id or Section-id ownership check, accepting client ids on create, the duplicate-id check, the Step limit or the revision check each fails tests.
- `pnpm test:e2e`: Procedure with a Section and two Steps (critical flag, skip policy), view, edit with reorder, delete.
- test-env install → structured demo Procedures readable by USER → uninstall.
- `pnpm lint`, `pnpm typecheck`; migration 0009 applied twice to a copy of the dev DB, `foreign_key_check` clean.

**Security docs updated:** YES (§3, §5, "Security check: Procedure Sections and Steps (Step 4.2)").

**Remaining:**
- Drag and drop (4.3) on top of the same save.
- Run snapshots (5.1) must copy Section/Step data and must not reference `procedure_sections`/`procedure_steps` rows (they are rewritten on every save).

### 4.3 Drag and drop
**Status:** DONE
**Completed:** 2026-09-27

Reorder Sections/Steps while preserving stable identifiers.

**Security impact:** LOW — client-only; order input reaches the server only through the 4.2 save, which already validates, authorizes and bounds it.

**Implemented:**
- `apps/web/src/structure-moves.ts`: pure `moveItem` / `moveStep` (within and across Sections, append, invalid positions are no-ops, never loses or duplicates a Step).
- `ProcedureForm.tsx`: native HTML5 drag and drop (no new dependency) — drag handles (⠿) on Sections and Steps; drop a Step onto another Step (takes its place, also across Sections) or onto a "Drop here …" zone at the end of any Section (incl. empty ones); drop a Section onto another Section. The dragged item is kept in a ref for event handlers so fast drags work before React re-renders.
- Accessible alternative for keyboard and touch: existing ↑/↓ buttons plus a new "Move step … to section" select. Handles are `aria-hidden`; all moves are also possible without a pointer.
- Nothing is saved until "Save changes" — one save, one audit event (4.2).

**Tests/checks:**
- `pnpm test` — 394 tests (+6 in `structure-moves.test.ts`, incl. an exhaustive no-loss/no-duplicate check over all move combinations).
- `pnpm test:e2e`: drag a Step into a new Section's drop zone, move it back with the select, drag it again, drag Section 2 above Section 1, save, verify order and that ids survived (Step stays the same row).
- `pnpm lint`, `pnpm typecheck`.

**Security docs updated:** YES (§5 drag/drop item checked).

**Remaining:**
- Native HTML5 drag and drop is desktop-oriented; touch devices use the buttons/select (authoring is desktop-first per 8.1). Revisit with a reviewed DnD library if touch dragging is required.
- No visual drop indicator beyond the browser's default and the end-of-section zones (styling with 8.x).

### 4.4 Duplicate / JSON import-export
**Status:** DONE
**Completed:** 2026-09-27

Canonical JSON includes `schemaVersion`; imported data is hostile input and must be validated.

**Security impact:** HIGH for import parser/input validation.

**Implemented:**
- `packages/import-export` (now used by the server; depends on `domain` and `zod`): canonical document `{ format: "vergissmeinnicht.procedure", schemaVersion: 1, procedure: { title, description, icon, tags, sections: [{ title, description, steps: [{ kind: "CHECK", … }] }] } }`. `toProcedureDocument` exports the definition only — **no ids, Workspace, users, timestamps or revision**. `parseProcedureDocument`: envelope and version checked first (`unsupported_format`, `unsupported_schema_version`), then a strict Zod schema (unknown keys rejected at every level — ids, `__proto__`, run state …; coarse length/count bounds); the result is built field by field so nothing else from the file can reach persistence. Lint boundary: same rules as `application` (no infrastructure imports).
- Application: `importProcedure` and `duplicateProcedure` (both `procedure.edit` via `authorizeWorkspace`) share the regular create path: all domain rules, the per-Workspace limit, in-transaction re-check, server-generated ids, one audit event. `PROCEDURE_CREATED` metadata now has `origin` (`created` / `imported` / `duplicated`, plus `sourceProcedureId`). Duplicates stay in the same Workspace; title "… (copy)" kept ≤120 code points (`copyTitle`). Copying between Workspaces = export + import, so both Workspaces' permissions apply.
- HTTP: `GET …/procedures/{id}/export` (`procedure.view` — readers can already see the full definition), `POST …/procedures/import` (1 MiB body limit, 30 per 15 min per client), `POST …/procedures/{id}/duplicate`. Import errors: `invalid_document`, `unsupported_format`, `unsupported_schema_version` (400); domain errors as usual. The client builds the download itself (no `Content-Disposition` header built from user text).
- Web: "Export as JSON" (all roles; file name slugged to letters/digits/dashes), "Duplicate" and "Import Procedure from JSON file" (editors; 1 MiB and JSON pre-check in the browser, server decides).

**Tests/checks:**
- `pnpm test` — 413 tests (+19): parser (6: export has no ids/internal data, round trip, envelope/version cases, extra fields at every level incl. `__proto__` without prototype pollution, wrong types/kinds/oversized collections, no input echo), use-cases (7: duplicate with new ids and audited origin, `procedure.edit` required, no cross-Workspace duplicate by id, deleted source, title limit, limit reached; import into another Workspace with new ids and origin, USER/non-member refused, domain rules applied before any write), HTTP (5: export content, export→import round trip across Workspaces, role and Workspace boundaries, duplicate, hostile bodies — future version, foreign format, array, embedded id, markup icon, bidi title, `__proto__`, 50 000-deep nesting, truncated JSON, >1 MiB → 413, nothing created), file-name slugging (1).
- `pnpm test:e2e`: export download (file name), duplicate, delete copy, import the downloaded file (structure preserved), import of a future-version file shows the version message.
- `pnpm lint`, `pnpm typecheck`. No schema change.

**Security docs updated:** YES (§5 JSON import checklist, "Security check: Procedure import/export and duplicate (Step 4.4)").

**Remaining:**
- ~~Verify the hand-edited lockfile~~ — verified 2026-09-27 (`pnpm install --frozen-lockfile`, no changes).
- Only schema version 1 exists; a future version needs an explicit upgrade function per older version (never "best effort" parsing).
- Bulk export/import of several Procedures is not part of V1.

### 4.5 Soft deletion / restore
**Status:** DONE
**Completed:** 2026-09-27

Procedure deletion sets deletion metadata rather than destroying definition rows immediately.

Admin/editor restore behavior must be explicit and audited where appropriate.

Historical Runs are never cascaded.

**Security impact:** MEDIUM — new privileged view and state change.

**Implemented:**
- Soft delete existed since 4.1 (deletion metadata, Sections/Steps kept, no cascading FKs; a hard delete is blocked by FKs as soon as anything references the Procedure).
- `listDeletedProcedures` / `restoreProcedure` (`procedure.restore` = EDITOR, ADMIN) via `authorizeWorkspace` + in-transaction re-check. Restore is explicit per Procedure, scoped by Workspace id + Procedure id + "is deleted", counts against the 1000-active limit, bumps the revision, records `PROCEDURE_RESTORED` in the same transaction; Sections and Steps come back unchanged.
- HTTP: `GET …/procedures/deleted` (title, who deleted, when), `POST …/procedures/{id}/restore`.
- Web: "Show deleted Procedures" (editors/admins) with a Restore button per entry; delete confirmation mentions that restore is possible.

**Tests/checks:** `pnpm test` — 419 tests (+6): restore with structure and audit, USER/GUEST/non-member refused, not for active or other-Workspace Procedures, limit, restore once; HTTP list/restore incl. 403/404/Origin. `pnpm test:e2e`: delete → show deleted → restore → delete again. `pnpm lint`, `pnpm typecheck`. No schema change.

**Security docs updated:** YES (§3 note in "Security check: Procedures").

**Remaining:** no permanent purge (intentionally none in V1); a deleted Procedure cannot be viewed in full before restoring.

---

## 5 — Run execution

### 5.1 Create immutable Run snapshot
**Status:** DONE
**Completed:** 2026-09-27

Starting a Procedure creates a historical snapshot independent of future Procedure changes/deletion.

Multiple simultaneous active Runs of the same Procedure are valid.

**Security impact:** HIGH — history integrity, new Workspace child resource.

**Implemented:**
- Domain (`packages/domain/src/run.ts`): `Run`, `RunSection`, `RunStep`, `RunDetail`, `RunSummary`, `parseRunId`; `RUN_STARTED` audit type.
- Database: migration `0010` — `runs` (Workspace FK, source `procedure_id` FK without cascade + snapshotted `procedure_revision`, copied title/description/icon/tags, `state` ACTIVE/COMPLETED/ABORTED, `revision` concurrency token for later, starter id + display-name snapshot, `started_at`), `run_sections` and `run_steps` (copied definition incl. required/critical/reason policies, `source_*_id` informational without FK, composite FK keeps a Step inside its own Run's Section, `state` default PENDING with CHECK), `audit_events.run_id` (FK, indexed). Migration `0011` — triggers: snapshot columns of `runs`/`run_steps` and all of `run_sections` cannot be updated; no row of any Run table can be deleted. Only execution state stays writable.
- `createRunRepository.start`: one `IMMEDIATE` transaction re-checks the actor (`run.start`), reads the active Procedure of *this* Workspace with its current Sections/Steps, refuses Procedures without Steps and more than 500 ACTIVE Runs per Workspace, copies everything with new ids, records `RUN_STARTED` (with `run_id`, Procedure id + revision, title, Step count). `list` (newest first, ≤200, optional state filter, per-state Step counts) and `find` are scoped by Workspace id.
- Application (`packages/application/src/runs`): `startRun` (`run.start`: USER, EDITOR, ADMIN), `listRuns` / `getRun` (`run.view`: all roles).
- HTTP (`apps/server/src/http/run-routes.ts`): `GET/POST /api/workspaces/{id}/runs` (`?state=` filter; body `{ procedureId }`), `GET /api/workspaces/{id}/runs/{runId}`; errors `run_not_found` (404), `procedure_has_no_steps` / `run_limit_reached` (409). Responses carry the starter's display-name snapshot, not the user id.
- Web: "Start Run" on the Procedure view (for `run.start`), "Runs" section with list (state, progress, starter, time) and a read-only Run view; states shown as text + glyph (never color only). Checking Steps off is 5.2.
- `test-env/seed.ts`: one active demo Run started by the USER account.

**Tests/checks:**
- `pnpm test` — 434 tests (+15): use-cases (12: full definition copied with new ids and PENDING Steps, audit with `run_id`; snapshot unchanged after Procedure rename/restructure and after deletion, deleted Procedure cannot start new Runs; three simultaneous active Runs with their own snapshots/revisions, list counts and state filter; GUEST view-only; cross-Workspace Run/Procedure ids unknown; in-transaction re-check after demotion; unknown ids; no-Steps refusal; active-Run limit; DB triggers block snapshot updates and deletes while state stays writable; Procedure hard delete blocked by FK; audit failure rolls back all Run rows), HTTP (3: snapshot across Procedure edit, list/filter, 401/403/404 matrix incl. Origin and cross-Workspace, validation of bodies/query/ids).
- Mutation checks: Workspace scoping in `find`, the in-transaction guard (and its capability), the no-Steps check, and the `run.view` check in `getRun` each fail tests; weakening only the use-case check of `startRun` is masked by the in-transaction guard (intended second layer).
- `pnpm test:e2e`: two Runs of the same Procedure, pending Steps, list with progress.
- test-env install → demo Run visible to GUEST → uninstall. Migrations 0010/0011 applied twice to a copy of the dev DB, `foreign_key_check` clean.
- `pnpm lint`, `pnpm typecheck`.

**Security docs updated:** YES (§6, "Security check: Run snapshots (Step 5.1)").

**Remaining:**
- Step execution, Run completion/abort and their audit events: 5.2–5.5. Completed Runs' immutability for state (5.6) is not enforced yet (only the definition snapshot is).
- Run list pagination beyond the newest 200.

### 5.2 Step state machine
**Status:** DONE
**Completed:** 2026-09-27

Implement:
- PENDING
- DONE
- SKIPPED
- NOT_APPLICABLE

with separate reason policies and undo.

**Security impact:** HIGH — integrity and attribution of execution history; collaborative writes.

**Decisions (2026-09-27):** transitions are PENDING → DONE / SKIPPED / NOT_APPLICABLE and any resolved state → PENDING (undo); switching directly between resolved states requires an undo first, so every change is explicit and separately audited. DONE and undo never take a reason. Reasons are plain text ≤500 code points (line breaks allowed, other control and bidi characters rejected). Concurrency: the client names the state it saw (`expectedState`); a mismatch is a conflict (409), never a silent overwrite.

**Implemented:**
- Domain (`packages/domain/src/step-transition.ts`): `canTransitionStep`, `validateStepTransition` (transition + policy of the target state from the Step's snapshot: DISABLED → no reason, OPTIONAL → reason or none, REQUIRED → non-empty; whitespace-only = none). `RunStep.stateChange` (actor id + display-name snapshot, time, reason); `STEP_STATE_CHANGED` audit type; `parseRunStepId`.
- Database: migration `0012` adds `run_steps.state_reason`, `state_changed_by_user_id` (FK users), `state_changed_by_display_name`, `state_changed_at` with CHECKs (actor/time all-or-nothing; reason only for SKIPPED/NOT_APPLICABLE, non-blank, ≤500) and trigger `run_steps_state_only_while_active` (execution state of a non-ACTIVE Run cannot change — groundwork for 5.4/5.6). Hand-written `ALTER TABLE` statements, because drizzle-kit's table rebuild would have dropped the 0011 immutability triggers (drizzle snapshot kept in sync; a test asserts the triggers still work).
- `RunRepository.changeStepState`: one `IMMEDIATE` transaction — guard re-check (`run.execute`), Run resolved within the Workspace, Step resolved within the Run, Run must be ACTIVE, `expectedState` must match, domain validation of the current snapshot, conditional update with actor/time/reason, Run `revision` + 1 (for 6.1), `STEP_STATE_CHANGED` audit event with `run_id`, Step id as subject, `from`/`to`/`undo`/Step title/Run revision/reason.
- Application: `changeStepState` (`run.execute`: USER, EDITOR, ADMIN — any of them may continue any active Run); errors `RunStepNotFoundError` (404 `step_not_found`), `RunNotActiveError` (409 `run_not_active`), `StepStateConflictError` (409 `step_conflict`).
- HTTP: `POST /api/workspaces/{id}/runs/{runId}/steps/{stepId}/state` `{ expectedState, state, reason? }` → `{ step, runRevision }`; Run responses now include `stateChange` with the actor's display name and time (no user ids).
- Web: per Step "Done", "Skip", "Not applicable" (reason form when the policy is OPTIONAL/REQUIRED) and "Undo"; shows who/when/why; after a conflict the Run is reloaded from the server. GUESTs see the Run read-only. Critical Steps use the normal button until 5.3.

**Tests/checks:**
- `pnpm test` — 451 tests (+18): transition matrix and reason rules (5), use-cases (12: resolve with actor/time/reason and one audited event per change with `run_id`, undo and re-resolve, every policy combination incl. whitespace/length/bidi with nothing written on rejection, disallowed transitions, concurrent change → conflict, GUEST refused, any USER continues someone else's Run, Step of another Run / Run through another Workspace / non-member, in-transaction re-check after demotion, inactive Run refused, audit failure rolls back state and revision, snapshot triggers survive the migration), HTTP (1 extended scenario: states, conflict, invalid transition, reason rules, 401/403/404, Origin, strict bodies, no user ids in responses); 5.1 DB test extended with the new CHECKs and the inactive-Run freeze.
- Mutation checks: removing the `expectedState` check, the domain validation, the Run scoping of the Step lookup, the ACTIVE check, the in-transaction guard, REQUIRED enforcement, or allowing any transition each fails tests.
- `pnpm test:e2e`: execute a Run in the browser (Done, Skip with required reason, Undo, progress in the list).
- Migration 0012 applied to a copy of the dev DB (twice) and to an online backup of the running test environment with an existing Run (5 Steps preserved, new columns NULL, FK check clean).
- `pnpm lint`, `pnpm typecheck`.

**Security docs updated:** YES (§6, "Security check: Step state changes (Step 5.2)").

**Remaining:**
- Press-and-hold for critical Steps (5.3), Run completion/abort (5.4), a history view of `audit_events` (5.5), realtime fan-out (6.1; the Run `revision` is ready for it).
- The test-environment seed still starts its demo Run with all Steps pending.

### 5.3 Critical Step press-and-hold
**Status:** DONE
**Completed:** 2026-09-27

Critical CHECK Steps use an accessible press-and-hold interaction before marking Done.

The backend still validates the requested state transition; client interaction is UX protection, not an authorization/security control.

**Security impact:** NONE — client-side UX only; no server change (5.2 validation unchanged).

**Implemented:** `apps/web/src/HoldToConfirm.tsx` — hold for 1.2 s with pointer/touch (pointer capture; release, cancel or leaving cancels) or keyboard (hold Space/Enter; key repeat ignored; key-up or blur cancels); the normal click is suppressed, context menu on long touch suppressed; progress as text ("hold… 45 %") plus a bar; `aria-describedby` hint "Critical step: press and hold for 1.2 seconds to confirm." Used for "Done" on critical Steps; Skip / Not applicable / Undo stay normal buttons.

**Tests/checks:** `pnpm test:e2e` — plain click and a 0.6 s hold leave the critical Step pending, a full mouse hold and a held Space key mark it Done, the accessible description is present. `pnpm lint`, `pnpm typecheck`.

**Remaining:** hold duration is fixed (not user-configurable); users who cannot hold a key/pointer for 1.2 s have no alternative yet — revisit with 8.x accessibility review (e.g. a setting for a two-step confirmation instead).

### 5.4 Run lifecycle
**Status:** DONE
**Completed:** 2026-09-27

Implement:
- ACTIVE
- COMPLETED
- ABORTED

Required Steps must satisfy completion rules before Run completion.

Any authorized Workspace USER-or-higher capability may continue an active Run.

**Security impact:** HIGH — finality of history, collaborative writes.

**Decisions (2026-09-27, review welcome):** a Run can be completed only when every *required* Step is DONE or NOT_APPLICABLE — SKIPPED does not satisfy a required Step (it was applicable but not done); optional Steps may be in any state, including PENDING. Abort is possible at any time for an ACTIVE Run, with an optional reason (≤500 code points, same text rules as Step reasons). Completion needs `run.execute`, abort `run.abort` (both USER, EDITOR, ADMIN). There is no reopening.

**Implemented:**
- Domain: `completionBlockers`, `normalizeOptionalReason`, `Run.ended` (actor snapshot, time, reason); audit types `RUN_COMPLETED`, `RUN_ABORTED`.
- Database: migration `0013` (hand-written `ALTER TABLE`, keeps the 0011 triggers) adds `runs.ended_at`, `ended_by_user_id` (FK), `ended_by_display_name`, `end_reason` with CHECKs (end data present exactly when not ACTIVE; reason only for ABORTED) and trigger `runs_finished_immutable` (no column of a COMPLETED/ABORTED Run can change; together with the 5.2 trigger their Steps are frozen as well).
- `RunRepository.finish`: one `IMMEDIATE` transaction — guard re-check, Run within Workspace, must be ACTIVE, completion rule evaluated on the *current* Steps, conditional update, revision + 1, audit event with Step counts and reason.
- Application: `completeRun`, `abortRun`; `RunIncompleteError` → 409 `required_steps_open` with `openRequiredSteps`.
- HTTP: `POST /api/workspaces/{id}/runs/{runId}/complete`, `POST …/abort` `{ reason? }`; Run responses include `ended` (display name, time, reason).
- Web: "Complete Run" (disabled with the list of open required Steps), "Abort Run…" with optional reason, finished Runs show "Completed/Aborted by … on …" and no execution controls.

**Tests/checks:**
- `pnpm test` — 465 tests (+14): completion rule (domain 3; use-cases: pending and skipped required Steps block, optional pending allowed, audit sequence and counts), GUEST / non-member / other-Workspace refused, concurrent undo inside the transaction blocks completion, in-transaction actor re-check, abort with reason / invalid reason / GUEST / non-member (404, not 403), finished Runs cannot be completed/aborted/executed again, DB freeze of state/end data/Steps, end-data CHECKs, audit failure rolls back; HTTP scenario incl. 409 body, Origin, strict bodies, cross-Workspace.
- Mutation checks: SKIPPED satisfying required Steps, skipping the completion validation, finishing a non-ACTIVE Run, or dropping the use-case check of `abortRun` each fail tests.
- `pnpm test:e2e`: completion blocked with hint, complete, abort with reason, list shows both states.
- Migration 0013 on a copy of the dev DB (twice) and on an online backup of the running test environment (existing ACTIVE Run unchanged, FK check clean). `pnpm lint`, `pnpm typecheck`.

**Security docs updated:** YES ("Security check: Run completion and abort (Step 5.4)").

**Remaining:** no "reopen" or correction workflow (explicitly out of V1, see 5.6).

### 5.5 Audit trail
**Status:** DONE
**Completed:** 2026-09-27

Every relevant mutation records actor User UUID, actor display-name snapshot where appropriate, trusted server timestamp, event, and reason/transition metadata.

**Security impact:** HIGH — integrity and attribution.

**Recording (built up since 4.1):** `audit_events` (append-only by triggers, Workspace-scoped) is written in the same transaction as the change it records, with event UUID, event type, actor internal user id + display-name snapshot, server timestamp, subject (Procedure / Run / Run Step), `run_id` for every Run event, and metadata:

| Event | Metadata |
|---|---|
| `PROCEDURE_CREATED` | title, revision, origin (created / imported / duplicated, source id), Section and Step counts |
| `PROCEDURE_UPDATED` | changed fields, revision, structure summary (Sections/Steps added, removed, changed) |
| `PROCEDURE_DELETED` / `_RESTORED` | title, revision |
| `RUN_STARTED` | Procedure id and revision, title, Step count |
| `STEP_STATE_CHANGED` | from, to, undo, Step title, Run revision, reason |
| `RUN_COMPLETED` / `RUN_ABORTED` | Run revision, Step counts per state, reason (abort) |

Account and access events (logins, MFA, recovery, invitations, Workspace membership) stay in the separate append-only `security_events` table.

**Implemented in 5.5 (read side):**
- Port `AuditHistory` (read-only; there is no update/delete path) and `createAuditHistory` (always filtered by Workspace; ordered by time, then insertion order; ≤1000 events per request).
- Use-cases `getRunHistory` (`run.view`; Run must belong to the Workspace, otherwise `run_not_found`) and `getProcedureHistory` (`procedure.view`; also after deletion; ids from other Workspaces yield an empty list).
- HTTP: `GET /api/workspaces/{id}/runs/{runId}/history`, `GET /api/workspaces/{id}/procedures/{procedureId}/history` — entries carry the actor's display-name snapshot, never user ids.
- Web: "Show history" in the Run view and the Procedure view with plain-language entries ("Uma — Stove off: Pending → Skipped — reason: Later", "changed title; 1 Step added (revision 4)").

**Tests/checks:** `pnpm test` — 482 tests (+17): history use-cases (4: full Run story in order with actor snapshots and metadata, only the Run's own events, Procedure history across delete/restore, no cross-Workspace reads, display name kept after rename), HTTP (1: members only, 401/404, no user ids or emails in the response, cross-Workspace), `describeEvent` (3; caught a pluralization bug). `pnpm test:e2e`: history of the completed Run shows start, skip with reason, undo and completion. `pnpm lint`, `pnpm typecheck`. No schema change.

**Security docs updated:** YES (§6 checklist).

**Remaining:** pagination beyond 1000 events; no history view for `security_events` (server-admin audit UI) yet.

### 5.6 Historical immutability
**Status:** TODO

Completed Runs cannot be edited in V1.

Future correction support must be an explicit additive audited workflow; never silently rewrite a completed Run.

---

## 6 — Collaboration

### 6.1 SSE active Run updates
**Status:** TODO

Multiple authorized users can work on one Run and receive canonical updates via Server-Sent Events.

**Acceptance criteria:**
- SSE connection uses authenticated session;
- Run subscription is authorized;
- server remains source of truth;
- state-changing commands use authenticated HTTP endpoints;
- reconnect refetches canonical state;
- revision/version supports missed/conflicting updates;
- remote changes expose actor/time where useful;
- heartbeat/timeouts/resource limits are defined.

**Security impact:** HIGH.

### 6.2 Optimistic UI
**Status:** TODO

Instant visual feedback with safe rollback and clear error state on rejected writes.

---

## 7 — Knots / shared entry links

### 7.1 Authenticated Knot links
**Status:** TODO

Use:
`/knot/{opaque-token}`

Token is high entropy, revocable, optionally expiring, redacted from logs, and does not replace authentication.

**Security impact:** CRITICAL.

---

## 8 — UX, accessibility, and theming

### 8.1 Responsive authoring/execution
**Status:** TODO

Desktop-first Procedure creation; smartphone-first Run execution.

ADHD-friendly design goals:
- strong visual hierarchy;
- obvious next/pending work;
- low visual clutter;
- persistent progress;
- forgiving undo;
- no reliance on memory to understand current state.

### 8.2 State presentation
**Status:** TODO

Color plus semantic icon/text:
- Pending: danger/red treatment
- Done: success treatment + actor/time
- Skipped: distinct state
- Not Applicable: distinct state

Do not rely on red/green alone.

### 8.3 Theme system
**Status:** TODO

Semantic design tokens.

Initial modes:
- System
- Light
- Dark

Dark visual direction:
- black and greyscale foundation;
- restrained red accents;
- modern, professional appearance.

Light theme uses the corresponding light/inverted direction.

Animations are acceptable when useful, brief, and not distracting.

Future named presets such as `Memento Mori` must not require business-component rewrites.

### 8.4 i18n readiness
**Status:** TODO

V1 ships English only, but user-facing strings must be structured so adding translations later does not require rewriting business logic/components.

### 8.5 PWA/offline active Runs
**Status:** DEFERRED — Phase 2

Important eventual scenario: a Procedure can contain “turn off router/network”.

---

## 9 — Email

### 9.1 Transactional email abstraction
**Status:** DONE
**Completed:** 2026-09-26

V1 requires email for invitations.

Prefer configurable SMTP as the self-hosted baseline, with an adapter boundary for future providers.

**Acceptance criteria:**
- no SMTP credentials in repo/logs;
- invitation email templates do not leak unnecessary sensitive data;
- invitation link tokens are redacted from logs;
- email send failures do not accidentally create ambiguous account state.

**Security impact:** HIGH.

**Implemented:** (pulled forward because invitations (2.2) need it)
- Port `EmailSender` / `EmailMessage` / `EmailDeliveryError` in `packages/application` — plain text only (no HTML in V1).
- `packages/email`: SMTP adapter on nodemailer 10.0.10 (all known advisories patched). `disableFileAccess`/`disableUrlAccess` on transport and message, no raw messages, TLS ≥1.2 with certificate verification, `requireTLS` for `starttls`, timeouts, nodemailer logging off. Recipient re-validated as a single normalized address; subject rejected if it contains CR/LF or exceeds 200 chars. Errors are `EmailDeliveryError` with a short reason code only (no recipient, body or SMTP transcript).
- Config: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY` (`tls`/`starttls`/`none`), `SMTP_USER`+`SMTP_PASSWORD` (both or neither; password wrapped in `Secret`), `MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME`, plus `INVITATION_TTL_HOURS` for 2.2. Production requires host and sender, defaults to STARTTLS/587 and rejects `none` for non-loopback hosts. Development defaults to Mailpit (`compose.dev.yml`, image pinned `axllent/mailpit:v1.31.2`, bound to 127.0.0.1).

**Tests/checks:** 9 adapter tests against an in-process SMTP server (delivery to exactly one recipient as text/plain; header-injection subjects and multi/non-normalized/CRLF recipients rejected before any SMTP traffic; STARTTLS-required against a server without STARTTLS fails without sending; connection failure yields a reason code without recipient/body). Config tests for SMTP defaults, cleartext rejection, credential pairing, password redaction, sender validation, invitation TTL bounds. Full suite, lint, typecheck, e2e pass.

**Security docs updated:** YES.

**Remaining:** "send failures do not create ambiguous account state" is enforced where emails are sent (2.2: an invitation stays valid/revocable and can be re-sent; no account exists before acceptance). DKIM/SPF/DMARC are the operator's mail-server responsibility (document in 10.x).

---

## 10 — Operations

### 10.1 Docker Compose deployment
**Status:** TODO

Supported V1 deployment:
- one application container;
- SQLite persistent volume;
- reverse proxy providing HTTPS;
- runtime-injected secrets.

### 10.2 Backup/restore
**Status:** TODO

Document consistent SQLite backup and tested restore.

### 10.3 Production hardening
**Status:** TODO

HTTPS, proxy trust, security headers, dependency scanning, health checks, safe secret injection.

**Security impact:** CRITICAL.

---

## 11 — Licensing

### 11.1 AGPL-3.0
**Status:** TODO

Add canonical GNU Affero General Public License v3 text and appropriate package/project license metadata.

---

## Completion template

Agents should update a task with:

**Status:** DONE  
**Completed:** YYYY-MM-DD  
**Implemented:** short factual summary  
**Tests/checks:** commands or checks performed  
**Security impact:** NONE / LOW / MEDIUM / HIGH / CRITICAL  
**Security docs updated:** YES / NO / N/A  
**Remaining:** any known follow-up
