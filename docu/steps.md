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
**Status:** TODO

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

### 2.3 Local password login
**Status:** TODO

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

### 2.4 Optional user-activated TOTP
**Status:** TODO

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

### 2.5 Admin-assisted account recovery
**Status:** TODO

**Objective:** V1 has no public password-reset-by-email flow.

**Acceptance criteria:**
- recovery requires ADMIN action;
- action is explicitly audited;
- recovery cannot expose current password/TOTP secret;
- recovery uses short-lived one-time reset/enrollment mechanism;
- reset invalidates relevant existing sessions;
- TOTP reset removes the user's TOTP credential and recovery codes, is audited, and the user may re-enroll afterwards.

**Security impact:** CRITICAL.

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
**Status:** TODO

**Objective:** Workspace is the primary collaboration/security boundary.

**Acceptance criteria:**
- user may belong to multiple Workspaces;
- Membership maps User + Workspace + role;
- Procedures and Runs belong to one Workspace;
- removal from Workspace revokes future access promptly.

### 3.2 Roles and policies
**Status:** TODO

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

### 3.3 Workspace-wide Procedure visibility
**Status:** TODO

All non-deleted Procedures in a Workspace are visible according to Workspace role permissions. Per-Procedure ACLs are out of V1 scope.

---

## 4 — Procedure authoring

### 4.1 Procedure CRUD
**Status:** TODO

Create/edit/soft-delete reusable Procedures with title, description, icon, tags, and UUID.

### 4.2 Sections and CHECK Steps
**Status:** TODO

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

### 4.3 Drag and drop
**Status:** TODO

Reorder Sections/Steps while preserving stable identifiers.

### 4.4 Duplicate / JSON import-export
**Status:** TODO

Canonical JSON includes `schemaVersion`; imported data is hostile input and must be validated.

**Security impact:** HIGH for import parser/input validation.

### 4.5 Soft deletion / restore
**Status:** TODO

Procedure deletion sets deletion metadata rather than destroying definition rows immediately.

Admin/editor restore behavior must be explicit and audited where appropriate.

Historical Runs are never cascaded.

---

## 5 — Run execution

### 5.1 Create immutable Run snapshot
**Status:** TODO

Starting a Procedure creates a historical snapshot independent of future Procedure changes/deletion.

Multiple simultaneous active Runs of the same Procedure are valid.

### 5.2 Step state machine
**Status:** TODO

Implement:
- PENDING
- DONE
- SKIPPED
- NOT_APPLICABLE

with separate reason policies and undo.

### 5.3 Critical Step press-and-hold
**Status:** TODO

Critical CHECK Steps use an accessible press-and-hold interaction before marking Done.

The backend still validates the requested state transition; client interaction is UX protection, not an authorization/security control.

### 5.4 Run lifecycle
**Status:** TODO

Implement:
- ACTIVE
- COMPLETED
- ABORTED

Required Steps must satisfy completion rules before Run completion.

Any authorized Workspace USER-or-higher capability may continue an active Run.

### 5.5 Audit trail
**Status:** TODO

Every relevant mutation records actor User UUID, actor display-name snapshot where appropriate, trusted server timestamp, event, and reason/transition metadata.

**Security impact:** HIGH — integrity and attribution.

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
**Status:** TODO

V1 requires email for invitations.

Prefer configurable SMTP as the self-hosted baseline, with an adapter boundary for future providers.

**Acceptance criteria:**
- no SMTP credentials in repo/logs;
- invitation email templates do not leak unnecessary sensitive data;
- invitation link tokens are redacted from logs;
- email send failures do not accidentally create ambiguous account state.

**Security impact:** HIGH.

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
