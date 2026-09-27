# Security Policy & Security Checks

## Security is the highest priority

For Vergissmeinnicht, **security takes precedence over convenience, speed of implementation, and feature count**.

The application manages authenticated users, collaborative procedures, audit trails, security-sensitive household/operational routines, and potentially shareable entry links. A weakness in login or authorization can expose far more than a normal todo list.

Authentication, sessions, MFA, authorization, Workspace isolation, account recovery, Knot tokens, imports, and audit integrity must be treated as security-critical.

This file is normative and must evolve with the application.

**Every agent must review this file before implementing security-sensitive behavior.**

**Whenever a task introduces a new attack surface, credential type, permission boundary, sensitive input, or sensitive data flow, the agent must add or update checks in this file before marking the task complete in `steps.md`.**

---

## 1. Authentication baseline

### Password login
- [x] Use a mature maintained authentication library/framework. (Better Auth 1.7.6, reviewed 2026-09-26; its HTTP handler is not mounted, see "local password login and sessions".)
- [x] Never store plaintext or reversibly encrypted passwords.
- [x] Use Argon2id or a currently recommended reviewed equivalent. (Argon2id via `@node-rs/argon2`; Better Auth's default scrypt is replaced.)
- [x] Parameter choices are documented and tested. (m=64 MiB, t=3, p=1, 32-byte output, 16-byte salt; `packages/auth/src/password-hashing.ts` + test.)
- [x] Compare secrets using library primitives designed for the purpose. (Argon2 `verify`; cookie signatures verified by Better Auth.)
- [x] Login errors do not reveal whether an account exists. (One `401 invalid_credentials` for every failure; unknown users still cost one hash.)
- [x] Login attempts are rate-limited. (10/min per client address, 10/15 min per account.)
- [x] Successful login rotates the session identifier. (New session per login; a session presented with the login request is revoked.)
- [x] Password changes invalidate relevant old sessions as policy requires. (Self-service change and recovery reset delete all sessions of the user in the same transaction; the changing client gets a fresh session.)
- [x] Password values never appear in application logs, traces, analytics, or error payloads. (Verified by log capture in `apps/server/src/http/auth.test.ts`.)
- [x] New passwords: 15–128 characters (NIST SP 800-63B-4 single-factor minimum), no composition rules, NFKC-normalized before hashing.
- [ ] Breached/common-password blocklist.

### TOTP MFA
- [x] TOTP is built in and user-activated (optional) for V1 accounts; the MFA requirement is evaluated by a central server-side policy so enforcement (e.g. for ADMIN) can be added later. (`requiresTotpChallenge()` in `packages/domain/src/mfa.ts`.)
- [x] Seed generated with a CSPRNG. (160 bits via `otpauth` → `crypto.randomBytes`.)
- [x] Enrollment is not active until the user proves a valid OTP. (Unconfirmed enrollment expires after 10 min.)
- [x] TOTP seed is treated as highly sensitive data. (AES-256-GCM at rest with `DATA_ENCRYPTION_KEY`, bound to the user id; shown once at enrollment; never logged.)
- [x] Submitted OTP values are never logged. (Verified by log capture.)
- [x] Verification attempts are rate-limited. (Per client, per account, 5 per challenge, account lock after 10 consecutive failures escalating to 24 h.)
- [x] Time-window handling is intentionally bounded. (±1 step of 30 s; each step accepted once per account — replay protection.)
- [x] Recovery codes are high entropy. (10 × 80 bits.)
- [x] Recovery codes are stored hashed. (SHA-256 per code.)
- [x] Recovery code use is one-time and atomic. (Conditional update; concurrency tested.)
- [x] MFA enable/disable/reset is audited. (Enable/disable/use/regenerate/lock and admin/operator TOTP reset.)
- [x] Enabling TOTP and regenerating recovery codes require recent re-authentication. (Current password in the same request.)
- [x] Disabling TOTP requires re-authentication plus a valid OTP or recovery code.
- [x] For a TOTP-enabled account, a password-authenticated session that has not passed the TOTP challenge cannot access authenticated app resources. (No session exists before the challenge; only a challenge cookie scoped to `/api/auth/mfa`.)
- [x] The session is rotated after a successful TOTP challenge. (The full session is created only then; enabling/disabling TOTP revokes all sessions of the user.)
- [x] No "remember this device" / trusted-device bypass.

### Future external login: Apple / GitHub (planned), Microsoft (possible)
- [ ] Internal User UUID remains primary identity.
- [ ] External subject/provider ID mapping is explicit.
- [ ] No implicit account linking merely because two providers claim the same email.
- [ ] Use maintained OAuth/OIDC libraries.
- [ ] Validate issuer/audience/signature as applicable.
- [ ] Use state and nonce where required.
- [ ] Use PKCE where applicable.
- [ ] Access/refresh tokens are secrets and never logged.
- [ ] Linking/unlinking identity providers requires recent authenticated confirmation.
- [ ] Provider login cannot bypass TOTP for a user who enabled it, unless an explicitly reviewed policy says otherwise.

---

## 2. Sessions and browser security

- [x] Session IDs are opaque and generated with sufficient entropy. (32 chars from a 62-symbol alphabet via `crypto.getRandomValues`, ≈190 bits; cookie value HMAC-signed with `AUTH_SECRET`.)
- [x] Server-side session state is authoritative. (`sessions` table; `cookieCache` disabled; user status re-checked on every request.)
- [x] Production session cookie is `Secure`. (`__Secure-vmn.session_token`.)
- [x] Session cookie is `HttpOnly`.
- [x] `SameSite` policy is intentional and documented. (`Strict`: the SPA only needs the cookie on same-site `fetch` calls; cross-site navigations such as email links load the public shell first.)
- [x] Cookie Domain/Path are no broader than necessary. (No `Domain`, `Path=/`.)
- [ ] Session rotates after login and security-sensitive privilege changes. (Login, TOTP enable/disable, password change and account recovery: yes — all sessions of the user are replaced. Server-admin grant/removal and account disabling must do the same when those flows exist.)
- [x] Logout invalidates server-side session.
- [x] Idle/absolute expiration policies are documented. (Idle 7 days, refreshed at most daily; absolute 30 days, enforced per request — `SESSION_POLICY` in `packages/auth`.)
- [x] CSRF protection covers state-changing cookie-authenticated operations. (Every non-GET/HEAD/OPTIONS request needs `Origin` = `PUBLIC_ORIGIN`, missing `Origin` rejected; JSON-only bodies; `SameSite=Strict`.)
- [x] Authentication library endpoints are not exposed wholesale: only allow-listed server routes call Better Auth (`/api/auth/sign-in`, `/sign-out`, `/session`); tests assert other Better Auth paths return 404.
- [x] Disabled users cannot start sessions, and their existing sessions are revoked on the next request.
- [x] CORS is deny-by-default / narrowly configured. (No CORS plugin registered: same-origin only; any future CORS needs review.)
- [x] Sensitive responses are not cached publicly. (`Cache-Control: no-store` on all `/api/*`.)
- [ ] Production uses HTTPS.
- [ ] HSTS enabled when deployment topology makes it safe.
- [x] Content-Security-Policy is defined.
- [x] Clickjacking prevented via CSP `frame-ancestors`.
- [x] `X-Content-Type-Options: nosniff`.
- [x] Strict `Referrer-Policy`, especially around Knot URLs. (`no-referrer` header + meta tag; re-verify when Knot routes land.)

---

## 3. Authorization and ACLs

- [ ] Authorization happens server-side for every protected operation. (Workspace routes: yes — `requireUser` + `authorizeWorkspace` in every use-case. Re-check for every new route.)
- [x] UI-hidden buttons are never the authorization mechanism. (The web client receives capabilities only to adapt its UI; every request is re-authorized.)
- [x] Workspace membership checked for resource access. (`authorizeWorkspace` in `packages/application/src/workspaces/use-cases.ts` reads the Membership on every call; non-members get the same 404 as unknown ids.)
- [x] Role/capability checked for the requested operation. (Capabilities, not role strings; mutations re-check the actor's current role and ACTIVE status inside the write transaction.)
- [ ] Child resources cannot bypass parent Workspace checks. (Memberships, Procedures, Sections and Steps: yes — every query is scoped by the route's Workspace id plus the child id; a child id from another Workspace behaves like an unknown id; Section/Step ids in a save must already belong to that Procedure, enforced in the transaction and by a composite FK. Runs must follow the same rule — Step 5.)
- [x] Object identifiers are opaque but are not treated as authorization. (UUIDv4 Workspace ids; knowing an id grants nothing.)
- [x] Guest/User/Editor/Admin policies are centrally defined. (`packages/permissions`: one role → capability table incl. Procedure/Run capabilities (3.2), exact-matrix test; matrix documented in steps.md 3.2.)
- [x] Cross-Workspace access has negative tests.
- [x] Horizontal privilege escalation has negative tests. (Admin of Workspace A cannot manage members of Workspace B; members cannot see other Workspaces.)
- [x] Vertical privilege escalation has negative tests. (GUEST/USER/EDITOR cannot add, re-role, remove or rename; self-promotion refused; Workspace ADMIN ≠ server admin.)
- [x] Membership/role changes are audited. (`WORKSPACE_CREATED`, `WORKSPACE_RENAMED`, `MEMBERSHIP_ADDED`, `MEMBERSHIP_ROLE_CHANGED`, `MEMBERSHIP_REMOVED` in `security_events`, same transaction.)
- [x] Removing a member invalidates/updates active access promptly. (No cached authorization: the next request with the same session is denied. SSE subscriptions must re-check on membership change — Step 6.1.)
- [x] Workspace creation goes through one capability (`canCreateWorkspace`: ACTIVE server admins only).
- [x] Every Workspace keeps at least one ACTIVE member with `workspace.members.manage`; enforced inside the membership transaction.

---

## 4. Knot links

Canonical shape:
`/knot/{opaque-token}`

- [ ] Token generated by CSPRNG with adequate entropy.
- [ ] Token is never placed in query parameters.
- [ ] Token values are redacted from application/proxy logs where possible.
- [ ] Stored token is hashed where practical.
- [ ] Knot has explicit scope/target and permission.
- [ ] Knot can expire.
- [ ] Knot can be revoked.
- [ ] Expired/revoked tokens have negative tests.
- [ ] Knot possession does not replace authentication under current requirements.
- [ ] User authorization is checked after Knot resolution.
- [ ] Referrer policy prevents accidental propagation.
- [ ] Error responses do not disclose sensitive target details before authorization.

---

## 5. Input and output safety

- [ ] Validate all inputs at server trust boundaries.
- [ ] Use schema validation for API payloads.
- [ ] Parameterize SQL / use safe query builder or ORM.
- [ ] Never concatenate user input into SQL.
- [ ] Escape output according to rendering context.
- [x] Do not accept arbitrary HTML by default. (Procedure text is plain text; the web client renders it as text, never via `innerHTML`.)
- [x] User-selectable icons are trusted icon keys, not arbitrary uploaded SVG/HTML. (`PROCEDURE_ICONS`, validated in the domain and by a DB CHECK.)
- [ ] Apply sensible text/array/file-size limits. (Procedures: title 120, description 4000 code points, ≤10 tags × 32, ≤1000 per Workspace; ≤50 Sections, ≤200 Steps per Procedure, 1 MiB body limit on Procedure saves; coarse transport bounds in the Zod schemas. Keep extending per feature.)
- [ ] Reject malformed UUIDs/tokens/state transitions.
- [x] Drag/drop order input is validated, authorized, and bounded. (Reordering is client-side only; the result is saved through the 4.2 Procedure save: `procedure.edit`, ids must belong to the Procedure, ≤50 Sections / ≤200 Steps, revision check.)

- [x] Emails are normalized (trim, NFC, lower-case) before storage/lookup; uniqueness is enforced on the normalized value by a unique index.
- [x] Display names reject control and bidi override/isolate characters so audit snapshots cannot be visually spoofed.
- [x] Critical invariants (id shape, normalized email, status enum) are also enforced by DB CHECK constraints.
- [x] Validation errors carry stable codes and never echo the rejected input.
- [x] Auth/invitation API bodies are validated with strict Zod schemas (unknown fields rejected, string length bounds); global body limit 64 KiB, 4 KiB on auth routes; only `application/json` is parsed.
- [x] Link tokens travel in JSON bodies for API calls, never in API URLs.

### JSON import
- [x] Treat imports as hostile input. (`packages/import-export`: strict parse, then the regular create path with all domain rules.)
- [x] Require/validate `schemaVersion`. (Only `1`; checked before the schema; anything else → `unsupported_schema_version`.)
- [x] Validate full shape before persistence. (Strict Zod schema, then domain normalization of every field before the transaction.)
- [x] Reject invalid references/state/type values. (Unknown keys at every level rejected; enums/kinds validated; the format carries no references.)
- [x] Bound input size and collection counts. (1 MiB body, coarse array bounds in the schema, exact domain limits, per-Workspace Procedure limit.)
- [x] Do not allow imported IDs to overwrite unauthorized existing records. (Documents contain no ids; any id field is rejected; all ids are server-generated.)
- [x] Import is transactional or fails cleanly. (One `IMMEDIATE` transaction with the audit event; tests assert nothing is created on failure.)

---

## 6. Audit integrity

- [ ] Important mutations record internal User UUID.
- [ ] Store actor display-name snapshot where historical readability requires it.
- [ ] Store trusted server timestamp.
- [ ] Required state change + AuditEvent are one DB transaction.
- [ ] Normal users cannot edit/delete audit history.
- [x] `security_events` is append-only at the DB level (UPDATE/DELETE triggers abort).
- [x] `audit_events` (Workspace content history) is append-only at the DB level; Procedure changes and their audit event commit in one transaction with actor id, display-name snapshot and server timestamp.
- [ ] Corrections are additive rather than silent rewrites.
- [ ] Audit metadata does not contain credentials/secrets.
- [x] Procedure deletion cannot cascade-delete historical Runs. (Soft delete only; `runs.procedure_id` FK without cascade blocks even a hard delete; Run rows cannot be deleted — triggers.)
- [x] Historical Run snapshot remains readable after Procedure change/deletion. (Definition copied at start; snapshot columns immutable by triggers; tests edit, restructure and delete the source.)

---

## 7. Realtime collaboration

- [ ] Realtime connection authenticates current session.
- [ ] Subscription to a Run is authorized server-side.
- [ ] User cannot subscribe to arbitrary Workspace/Run channels.
- [ ] Realtime event does not expose unnecessary sensitive data.
- [ ] Mutations still use authoritative server validation.
- [ ] Client-supplied actor/timestamps are ignored for audit authority.
- [ ] Reconnect fetches canonical state.
- [ ] Revision/version conflicts are handled deliberately.
- [ ] Realtime endpoint has resource/rate/connection limits.

---

## 8. Database and storage

- [x] SQLite foreign keys enabled.
- [ ] Migrations exist from first schema.
- [ ] Writes requiring audit consistency are transactional.
- [x] SQLite file permissions are restrictive.
- [ ] WAL/sidecar files are treated as sensitive data too.
- [x] DB files are excluded from Git.
- [ ] Backup contains sensitive data and is protected accordingly.
- [ ] Restore procedure is tested.
- [ ] A future PostgreSQL migration must preserve security/integrity semantics.

---

## 9. Secret handling and logging

Never commit or log:
- passwords;
- password hashes in diagnostic output;
- session IDs;
- CSRF secrets/tokens;
- TOTP seeds;
- submitted OTPs;
- recovery codes;
- OAuth client secrets;
- OAuth access/refresh tokens;
- Knot tokens;
- encryption keys;
- production DB files;
- private keys/certificates.

Checks:
- [x] `.gitignore` covers common local secret files.
- [x] `DATA_ENCRYPTION_KEY` (encryption at rest) is separate from `AUTH_SECRET` (cookie signing), wrapped in `Secret`, required in production, rejected if equal to `AUTH_SECRET`.
- [x] Safe `.env.example` contains placeholders only.
- [x] Structured logging has redaction.
- [x] Request logging avoids sensitive URL/path token leakage. (Knot paths + query strings redacted; add each new token route to the pattern in `apps/server/src/logging.ts`.)
- [ ] Exceptions do not serialize credential-bearing objects. (MFA use-case errors carry no codes or secrets.) (Config secrets use the `Secret` wrapper; the HTTP error handler logs only error type + stack frames because messages can embed query parameters; Better Auth log calls are reduced to their message string. Extend to every new credential type.)
- [x] Production debug mode is disabled. (`LOG_LEVEL` debug/trace rejected in production.)
- [x] Secret rotation process can be documented. (`AUTH_SECRET`: see deployment.md — rotation signs everyone out.)
- [x] Configuration is validated at startup and fails closed; production has no default for any secret, origin or DB path.
- [x] Development and production modes cannot overlap: `NODE_ENV` must be explicit and `.env` cannot override it; production never loads `.env`.
- [x] Placeholder or short (<32 chars) `AUTH_SECRET` values are rejected in every mode.
- [x] Configuration errors name variables but never echo their values.

---

## 10. Dependency / supply-chain security

- [x] Use lockfile.
- [ ] Pin/review security-critical dependencies. (All versions pinned exactly; per-upgrade review is ongoing.)
- [x] Automated vulnerability/dependency scanning enabled.
- [ ] Avoid abandoned auth/crypto libraries.
- [x] Review dependency install scripts where relevant.
- [x] CI runs tests/typecheck/lint.
- [ ] Security-sensitive dependency upgrades receive explicit review.

---

## 11. Deployment security

- [ ] Container runs non-root where practical.
- [ ] No secrets baked into image.
- [ ] Only required port exposed.
- [ ] Persistent writable paths are explicit.
- [ ] Reverse proxy trust configuration is explicit.
- [x] Do not trust spoofable forwarding headers unless proxy is trusted. (`trustProxy: false` until Step 10.3 configures the proxy explicitly.)
- [ ] HTTPS termination documented.
- [ ] Backups are protected and restorable.
- [ ] Production migrations are controlled.
- [ ] Private/Tailscale deployment does not replace app authentication.

---

- [x] Install scripts only run for allow-listed packages (`allowBuilds`); new entries require review. (`@node-rs/argon2` ships prebuilt binaries as optional dependencies and needs no install script.)
- [x] Newly published versions are not installed for 24 h (`minimumReleaseAge`).
- [x] Publish trust downgrades fail install (`trustPolicy: no-downgrade`); exceptions are exact versions with a written reason.
- [x] CI actions are pinned to commit SHAs and run with a read-only token.

---

## 12. Security review triggers

A dedicated security review and update to this file is mandatory before adding:

- password reset/account recovery;
- external OAuth/OIDC providers;
- provider account linking;
- anonymous Knot/bearer access;
- file or image uploads;
- arbitrary rich text/HTML;
- webhooks;
- public APIs/API keys;
- email-based authentication;
- device trust / remembered MFA;
- encryption-at-rest schemes;
- admin impersonation/support tooling;
- multi-node deployments;
- third-party analytics;
- external notification services.

---

## Per-task security completion block

For security-sensitive tasks, add/update a section in this file:

### Security check: <feature>
**Threat surface:**  
**Controls added:**  
**Negative tests:**  
**Secrets/data involved:**  
**Logging review:**  
**Authorization review:**  
**Open risks:**  
**Reviewed:** YYYY-MM-DD


---

## 13. Locked V1 authentication policy

The following choices are mandatory V1 behavior:

- public registration is disabled;
- account creation begins with an ADMIN-created invitation to a required email address;
- invitation acceptance must prove/use that invited email;
- TOTP is optional and user-activated, but built in from V1 (not mandatory for now); the pre-MFA state holds no session at all (challenge token only);
- an account with TOTP enabled receives no normal application/Workspace access until the TOTP challenge succeeds;
- whether TOTP is required is decided by a central server-side policy, so mandatory enforcement can be introduced later without redesign;
- password recovery is admin-assisted only in V1;
- TOTP reset (lost device) is admin-assisted, audited, removes the TOTP credential and recovery codes, and invalidates existing sessions;
- there is no unauthenticated password-reset email flow in V1;
- there is no "remember this device" MFA bypass in V1 unless separately approved;
- Apple and GitHub login are planned but deferred (Microsoft possible later) and require a new account-linking/MFA security review before implementation.

### Security check: invite-only account bootstrap
**Threat surface:** invitation theft, token replay, account squatting, email mismatch, invitation enumeration.  
**Controls required:** CSPRNG token, expiry, single use, revocation, token hashing where practical, target-email binding, generic error handling, audit trail, no token logging.  
**Negative tests:** expired invite; replayed invite; revoked invite; wrong email; unauthorized invite creation.  
**Secrets/data involved:** invite token, email address.  
**Logging review:** invitation token must be redacted.  
**Authorization review:** only ADMIN capability can issue/revoke invitations.  
**Open risks:** email delivery channel security is external to the application.  
**Status (2026-09-26):** complete (steps.md 2.2/2.3).  
**Implemented controls:** 256-bit CSPRNG token, SHA-256 at rest, `/invite/{token}` path (redacted in logs), TTL (default 72 h, max 720 h), supersede-on-reissue, single-outcome DB constraint, generic resolve error, ACTIVE-server-admin check inside use-cases, token never returned to the inviter, atomic security events, append-only event table, bootstrap refused once an admin exists and limited to one live link; acceptance is POST-only, validates the link before hashing, and creates User + credential + acceptance + events in one `BEGIN IMMEDIATE` transaction (single use under concurrency); bootstrap links are rejected at resolve and accept time once any server admin exists; acceptance never creates a session; admin endpoints require a session and the ACTIVE-server-admin check in the use-case.  
**Negative tests (implemented):** replay, concurrency (3 parallel accepts → 1 user), expired/revoked/superseded, email taken in between, bootstrap after admin exists, unknown/malformed tokens, extra body fields, USER calling admin list/issue/revoke, unauthenticated admin calls, missing/foreign `Origin`.  
**Reviewed:** 2026-09-26

### Security check: optional user-activated TOTP
**Threat surface:** challenge bypass through API routes, SSE, Knot resolution, stale session, alternate login path; enrollment race; attacker with a stolen session enabling TOTP to lock the owner out; attacker disabling TOTP (downgrade); recovery-code brute force.  
**Controls required:** explicit restricted pre-MFA session state for TOTP-enabled accounts; centralized middleware/policy denies normal resources until the TOTP challenge is satisfied; re-authentication to enable TOTP or regenerate recovery codes; re-authentication plus OTP/recovery code to disable; rate limits; audit events for enable/disable/recovery-code use/regeneration/admin reset.  
**Negative tests:** pre-MFA session of a TOTP-enabled account cannot access Workspace API, subscribe SSE, resolve Knot target details, or call admin routes; cannot promote session via client flag; TOTP cannot be disabled without OTP/recovery code; TOTP cannot be enabled without re-authentication; used recovery code is rejected.  
**Secrets/data involved:** TOTP seed, OTP values, recovery codes.  
**Logging review:** seed, OTP and recovery codes never logged.  
**Authorization review:** MFA gate must be server-side and centralized.  
**Open risks:** accounts that have not enabled TOTP (including ADMIN accounts) are protected by password only — consider an enforcement policy for ADMIN later; future OAuth/OIDC login paths require explicit policy because provider flows may not automatically pass through credential 2FA hooks.  
**Status (2026-09-26):** implemented (steps.md 2.4), except admin reset (2.5).  
**Implemented controls:** own use-cases on reviewed primitives (Better Auth `twoFactor` plugin rejected: no replay protection, reversible non-atomic backup codes, password-only disable, trust-device feature); no session before the challenge — the password step yields only a 256-bit challenge token (hash at rest, 5 min, 5 attempts, single use, cookie `HttpOnly`/`Secure`/`Strict`, `Path=/api/auth/mfa`); full session issued by Better Auth only after a valid factor; replay protection via last accepted time step; account lock after 10 consecutive wrong codes (15 min doubling to 24 h) with recovery codes still usable; per-client and per-account rate limits; seed encrypted (AES-256-GCM, HKDF from `DATA_ENCRYPTION_KEY`, user id as AAD); 80-bit recovery codes hashed, atomic single use; password for enable/regenerate, password + factor for disable; all sessions replaced on enable/disable; security events for every step.  
**Negative tests (implemented):** `packages/database/src/mfa-use-cases.test.ts`, `apps/server/src/http/mfa.test.ts` — challenge cookie (also disguised as session cookie) rejected by session, account and admin routes; client `mfaVerified` flag rejected; forged/missing/expired/exhausted/used challenge; replay; disable without factor; enable without password; used recovery code; concurrent recovery-code use; disabled user after password step; no secrets in logs. SSE/Knot routes do not exist yet — their tests must include the challenge-only case.  
**Reviewed:** 2026-09-26

### Security check: admin-assisted recovery
**Threat surface:** malicious/compromised admin, stolen admin session, privilege abuse, stolen reset token, active-session persistence, downgrade of a user's TOTP, social engineering of admins.  
**Controls required:** explicit ADMIN capability, short-lived single-use recovery flow, audit trail, session invalidation, TOTP credential and recovery codes removed when TOTP is reset.  
**Controls implemented (2026-09-26, Step 2.5):** server-admin capability checked in the use-case; step-up (admin password + admin TOTP if enabled) per recovery; no self-recovery via the admin path; link emailed only to the account's own address and never shown to the admin; 256-bit token, SHA-256 at rest, 60 min, single use, superseded on re-issue; TOTP-only reset additionally needs the user's current password; completion atomically applies the reset, deletes TOTP + recovery codes, invalidates MFA challenges and deletes every session of the user; per-client and per-admin rate limits; security events for issue/supersede/complete/reset; operator CLI fallback attributed to `cli:admin-recover`; self-service password change revokes all sessions.  
**Negative tests:** non-admin, disabled admin, wrong admin password, missing admin TOTP, self-target, unknown/disabled/TOTP-less target; used/expired/superseded/malformed token; TOTP reset without or with wrong current password; old sessions rejected after completion; concurrent completion (`packages/database/src/recovery-use-cases.test.ts`, `apps/server/src/http/recovery.test.ts`).  
**Secrets/data involved:** recovery token (link), new password.  
**Logging review:** `/recover/{token}` and `/api/recoveries/{…}` redacted in request logs; tokens travel in JSON bodies for API calls; verified by log capture.  
**Authorization review:** separate server-admin capability, independent of Workspace roles; enforced in `issueAccountRecovery`.  
**Open risks:** an admin who also controls the user's mailbox (or an operator with shell access) can take over accounts — inherent to admin-assisted recovery, visible in the audit trail; users who lost mailbox access need an out-of-band operator process; no admin UI yet; administrative social engineering remains an operational risk (admins should verify the requester through a second channel before starting a recovery).  
**Reviewed:** 2026-09-26

### Security check: application skeleton (Step 1.1)
**Threat surface:** HTTP server baseline (headers, static file serving, SPA fallback), SQLite file handling, dependency supply chain, CI.  
**Controls added:** `@fastify/helmet` (CSP with `frame-ancestors 'none'`, `object-src 'none'`, `nosniff`, `Referrer-Policy: no-referrer`); `Cache-Control: no-store` on `/api/*`; unknown `/api/*` routes return JSON 404, never the SPA shell; `trustProxy: false`; default bind `127.0.0.1`; logger redacts `authorization`/`cookie`/`set-cookie`; SQLite `foreign_keys=ON`, WAL, DB dir 0700 / file 0600; layer boundaries enforced by pnpm isolation + ESLint; pnpm `allowBuilds`, `minimumReleaseAge`, `trustPolicy`; exact version pins + lockfile; CI with SHA-pinned actions, `permissions: contents: read`, `persist-credentials: false`, `pnpm audit --audit-level high`; Dependabot.  
**Negative tests:** unknown API route is not served the SPA shell; FK violation rejected; forbidden cross-layer imports fail lint (verified manually).  
**Secrets/data involved:** none yet (no auth, no secrets, empty schema).  
**Logging review:** request logs contain method/URL/host/remote address only; credential headers redacted. URL-path token redaction (Knot) must be added with Step 7.1 / 1.2.  
**Authorization review:** no protected resources exist yet; boundaries keep DB/auth code out of the web client.  
**Open risks:** HSTS off until HTTPS termination is configured (10.3); moderate advisory GHSA-67mh-4wv8-2f99 in dev-only `drizzle-kit` dependency chain; CSP `style-src` allows `'unsafe-inline'` (helmet default) — tighten when the theme system (8.3) is built; validated configuration and fail-closed startup pending (1.2).  
**Reviewed:** 2026-09-26

### Security check: configuration and secret handling (Step 1.2)
**Threat surface:** misconfigured production running with development defaults, weak/placeholder secrets, secrets leaking through logs, error messages or serialized config objects, `.env` files switching modes, token-bearing URLs in request logs.  
**Controls added:** Zod env schema with frozen result; explicit `NODE_ENV`; production requires `AUTH_SECRET`/`PUBLIC_ORIGIN`/absolute `DATABASE_PATH` with no fallback; https-only public origin (loopback exception); min-length + placeholder rejection for `AUTH_SECRET`; `Secret` wrapper redacting `toString`/JSON/`inspect`; error messages list variable names only; production never loads `.env`; request log serializer with URL/token/query redaction and header redaction; debug/trace logging rejected in production.  
**Negative tests:** see `apps/server/src/config/config.test.ts` and `apps/server/src/logging.test.ts` (missing/unknown mode, each missing production variable, weak/placeholder secret, insecure origin, relative DB path, debug logging, no secret in errors/serialization/logs).  
**Secrets/data involved:** `AUTH_SECRET`; future SMTP credentials (9.1) must use the same wrapper.  
**Logging review:** request logs contain method, redacted URL, remote address; no headers except redacted paths. Error objects logged by Fastify must not carry credentials — review when auth errors are introduced.  
**Authorization review:** not applicable (no protected resources yet).  
**Open risks:** env-based secret injection is visible to processes that can read the app's environment — prefer Docker secrets / files when deploying (10.1); redaction pattern must be extended for every new token route; ephemeral development secrets are process-local by design.  
**Reviewed:** 2026-09-26

### Security check: internal User model (Step 2.1)
**Threat surface:** duplicate accounts via email case/Unicode variants, display-name spoofing in audit history, guessable/sequential user ids, identity tied to an external provider, invalid rows written around application validation.  
**Controls added:** server-generated UUIDv4 ids; normalized unique email; display-name character policy; DB CHECK constraints + unique index; status is application-owned (`input: false` required when Better Auth is configured); identity stays in `users.id`, credentials go to Better Auth `account` rows.  
**Negative tests:** duplicate normalized email rejected; malformed emails/ids rejected; bidi/control display names rejected; raw-SQL rows violating constraints rejected (`packages/domain/src/user.test.ts`, `packages/database/src/user-repository.test.ts`).  
**Secrets/data involved:** email addresses and display names (personal data). No credentials yet.  
**Logging review:** no logging added; emails must not be logged at info level in later auth flows.  
**Authorization review:** no endpoints yet. Future: only ADMIN may change `status`; users must not change their own status or email without a verified flow.  
**Open risks:** lower-casing the local part assumes case-insensitive mailboxes (true for mainstream providers); `image` column exists for Better Auth compatibility and must not be rendered as an arbitrary URL without review; DISABLED must also revoke active sessions once sessions exist (2.3).  
**Reviewed:** 2026-09-26

### Security check: transactional email (Step 9.1)
**Threat surface:** header/recipient injection, mail sent to unintended recipients, cleartext SMTP exposing invitation links and credentials, nodemailer file/URL content loading (SSRF/file read), secrets or tokens leaking via delivery errors.  
**Controls added:** text-only messages; recipient must be a single normalized address; subject CR/LF rejected; nodemailer `disableFileAccess`/`disableUrlAccess`, no raw messages; TLS ≥1.2 with certificate verification; STARTTLS required by default in production, cleartext only to loopback relays; SMTP password in `Secret`; `EmailDeliveryError` carries only a reason code; nodemailer logging disabled.  
**Negative tests:** `packages/email/src/smtp-email-sender.test.ts`; SMTP config cases in `apps/server/src/config/config.test.ts`.  
**Secrets/data involved:** SMTP password; recipient addresses; invitation links in message bodies (2.2).  
**Logging review:** adapter logs nothing; callers must not log recipients at info level or message bodies at any level.  
**Authorization review:** no endpoint sends arbitrary email; only application use-cases (invitations) call the port.  
**Open risks:** mailbox security and transport between mail servers are outside the app; link-scanning mail gateways may fetch invitation URLs (acceptance must require a POST, never act on GET — 2.2); nodemailer has a history of advisories — keep Dependabot/audit gating.  
**Reviewed:** 2026-09-26

### Security check: server-admin bootstrap CLI (Step 2.2)
**Threat surface:** creating an admin-granting link outside the app; link exposure in terminals/shell history; repeated bootstrap after setup.  
**Controls added:** refuses once any server admin exists; supersedes all pending bootstrap links; link written to stdout only (never logged/emailed); requires validated configuration (fails closed in production); security event attributed to `cli:admin-bootstrap`.  
**Negative tests:** bootstrap refused with existing admin; second bootstrap invalidates first link (`packages/database/src/invitation-use-cases.test.ts`).  
**Secrets/data involved:** invitation token (in printed link).  
**Logging review:** no logger in the CLI; token only in stdout.  
**Authorization review:** requires shell access with the production environment — equivalent to full server control already.  
**Open risks:** terminal scrollback/recording. (Acceptance rejects bootstrap invitations once an admin exists — implemented in 2.3.)  
**Reviewed:** 2026-09-26

### Security check: local password login and sessions (Step 2.3)
**Threat surface:** credential guessing (online, distributed), account enumeration, password hash theft/cracking, session theft/fixation, CSRF on login/logout/admin actions, open redirects, hidden endpoints of the authentication library (sign-up, profile/email change, password reset, account linking), spoofed client IPs defeating rate limits, disabled accounts keeping access, leaking tokens/passwords into logs or responses.  
**Controls added:** Better Auth 1.7.6 reviewed (advisories, defaults); its HTTP handler is not mounted — only `POST /api/auth/sign-in`, `POST /api/auth/sign-out`, `GET /api/auth/session` call `auth.api.*`; sign-up/email change/delete/linking disabled, `status`/`serverAdmin` not writable (`input: false`); Argon2id (m=64 MiB, t=3, p=1) replacing default scrypt; 15–128 character passwords; generic `401 invalid_credentials`; per-client (10/min) and per-account (10/15 min) sign-in limits plus global 300/min; client IP only from the socket via a server-set internal header (Better Auth never sees `X-Forwarded-For`); session token stripped from responses, `callbackURL` rejected; session rotation on login; `__Secure-` + `HttpOnly` + `Secure` + `SameSite=Strict` cookie; idle 7 d / absolute 30 d; per-request user status check; `Origin` guard on every state-changing request; JSON-only bodies; `cookieCache` off; telemetry off; LOGIN_SUCCEEDED/LOGIN_FAILED/LOGOUT security events (success event written before the cookie is issued).  
**Negative tests:** `apps/server/src/http/auth.test.ts` (identical failure responses, rate limits per IP and per account, tampered/unsigned cookies, DB token without signature, idle/absolute expiry, disabled user, rotation, origin variants, non-JSON body, unreachable Better Auth endpoints, no secrets in logs); `packages/auth/src/password-hashing.test.ts`; `packages/domain/src/password.test.ts`; e2e cookie attributes in Chromium.  
**Secrets/data involved:** passwords (transient), Argon2id hashes (`accounts.password`), session tokens (`sessions.token`, cookie), `AUTH_SECRET` (cookie HMAC), client IP and user agent in `sessions`.  
**Logging review:** request logs contain method, redacted URL, status; failed sign-ins log an event marker without email; Better Auth messages are forwarded without structured arguments ("User not found", "Invalid password"); unexpected errors logged as type + stack frames only. Verified by capturing all log output in the HTTP test suite.  
**Authorization review:** session → ACTIVE User resolution is centralized in `authenticate()`/`requireUser` (`apps/server/src/http/session.ts`), which is also the seam for the 2.4 TOTP gate; admin capabilities are checked in the use-cases.  
**Open risks:** behind a reverse proxy, until `trustProxy` is configured (10.3), all clients share one address and per-client limits become global (DoS of sign-in by one attacker) — configure before production use behind a proxy; per-account limit lets an attacker temporarily block a known account's sign-in (bounded to 15 min windows); session tokens are stored unhashed (a DB leak plus `AUTH_SECRET` allows session forgery — protect both; rotate `AUTH_SECRET` after suspected compromise); no breached-password blocklist; in-memory rate-limit state resets on restart; password change and privilege-change session rotation not yet implemented; `BETTER_AUTH_TELEMETRY` env var would override the explicit telemetry opt-out — do not set it.  
**Reviewed:** 2026-09-26

### Security check: encryption at rest for TOTP secrets (Step 2.4)
**Threat surface:** database or backup theft yielding usable authenticator seeds; ciphertext swapped between users; key reuse across purposes; key loss.  
**Controls added:** `DATA_ENCRYPTION_KEY` (≥32 chars, production-required, distinct from `AUTH_SECRET`); HKDF-SHA256 with a purpose label derives the AES-256-GCM key; random 96-bit IV per seal; `totp-secret:<userId>` as associated data; versioned format `v1.<iv>.<ciphertext>.<tag>`; any failure to open is treated as a wrong code (no oracle); DB CHECK on the format.  
**Negative tests:** `packages/auth/src/secret-box.test.ts` (wrong context, wrong key, tampered IV/ciphertext/tag, malformed input); config tests (missing, short, placeholder, equal to `AUTH_SECRET`).  
**Secrets/data involved:** `DATA_ENCRYPTION_KEY`, TOTP seeds.  
**Logging review:** neither key nor seeds are logged; `Secret` wrapper redacts the key.  
**Authorization review:** only the MFA use-cases open sealed secrets, for the owning user.  
**Open risks:** key and database together (same host) defeat the encryption — it protects stolen DB files/backups, not a compromised server; losing or changing the key disables every enrolled authenticator (users fall back to recovery codes / admin reset in 2.5); no rotation tool yet; development without a configured key uses a per-process key.  
**Reviewed:** 2026-09-26

### Security check: Workspaces and Memberships (Step 3.1)
**Threat surface:** cross-Workspace data access, horizontal escalation (acting on another Workspace's members through one's own), vertical escalation (self-promotion, non-admins managing members), probing Workspace ids, leaking other members' contact data, account enumeration through "add member by email", orphaned Workspaces without an admin, TOCTOU between authorization check and write, removed/disabled members keeping access, unaudited role changes.  
**Controls added:** centralized role → capability table and `canCreateWorkspace` (`packages/permissions`); single authorization entry point `authorizeWorkspace` (ACTIVE actor + Membership + capability) used by every Workspace use-case; non-member and unknown id both `404 workspace_not_found`; membership mutations run in `BEGIN IMMEDIATE` transactions that re-read the actor's current role and ACTIVE status, verify the target belongs to the same Workspace, keep ≥1 ACTIVE ADMIN and write the security event atomically; emails/status of members only for members who manage the Workspace; unknown and DISABLED accounts both reported as `unknown_account`; add-member rate limit 30/15 min per client; strict Zod bodies (unknown fields rejected), lower-case UUIDv4 path ids, role enum; server admins get no implicit Workspace access; DB: composite PK (one Membership per user/Workspace), role CHECK, FKs without cascade (a Workspace with members cannot be deleted).  
**Negative tests:** `packages/database/src/workspace-use-cases.test.ts` (29: creation by non-admin/Workspace-ADMIN/disabled admin, cross-Workspace for every use-case, horizontal A→B, no implicit server-admin access, GUEST/USER/EDITOR vertical escalation, GUEST cannot list members, contact data hidden, in-transaction re-check after concurrent demotion, disabled actor, last-admin removal/demotion incl. disabled co-admin, duplicate/unknown/disabled targets, removal effective immediately, audit rollback atomicity, DB constraints); `packages/permissions/src/policy.test.ts` (exact matrix, monotonic roles, unknown role fails closed); `apps/server/src/http/workspace.test.ts` (12: 401 on every route, Origin guard, 403/404 mapping, identical 404 bodies, same-session revocation after removal, demotion, strict input validation, rate limit); e2e Workspace creation. Mutation checks: removing the capability check, the create check, the in-transaction actor guard, the last-admin check, the ACTIVE check or the contact-data filter each fails tests.  
**Secrets/data involved:** member emails and account status (personal data), Workspace names.  
**Logging review:** no new log statements; emails travel in JSON bodies, never in URLs; security event metadata holds user ids, roles and Workspace names only.  
**Authorization review:** HTTP handlers only authenticate (`requireUser`) and translate; all Workspace authorization is in `packages/application/src/workspaces/use-cases.ts` via `packages/permissions`.  
**Open risks:** "add member by email" tells a Workspace ADMIN whether an ACTIVE account exists for an address (accepted: invite-only system, admins are trusted, rate-limited and audited); Workspace names are stored in security-event metadata on rename (not secret, but personal wording persists); members cannot leave a Workspace on their own unless they are an admin; disabling the only ACTIVE admin of a Workspace leaves it without a manager until a server-level repair tool exists; no Workspace deletion/archiving yet; SSE authorization and Procedure/Run capabilities still to come (3.2, 6.1).  
**Reviewed:** 2026-09-27

### Security check: Workspace role policy (Step 3.2)
**Threat surface:** over-broad default roles (GUEST executing or editing), scattered role checks drifting apart, members unable to withdraw from a Workspace, admins orphaning a Workspace by leaving.  
**Controls added:** full V1 capability matrix in `packages/permissions` (GUEST read-only: `workspace.view`, `procedure.view`, `run.view`; USER adds member list and Run start/execute/abort; EDITOR adds Procedure edit/restore; ADMIN adds member and settings management); tests pin the exact matrix, GUEST's read-only set and the author/execute role sets; `leaveWorkspace` removes only the caller, requires membership, keeps ≥1 ACTIVE admin and is audited.  
**Negative tests:** `packages/permissions/src/policy.test.ts`; leave cases in `packages/database/src/workspace-use-cases.test.ts` and `apps/server/src/http/workspace.test.ts` (non-member 404, missing Origin 403, unauthenticated 401, last admin 409).  
**Secrets/data involved:** none new.  
**Logging review:** no new log output.  
**Authorization review:** Procedure/Run capabilities are defined but not yet enforced anywhere because those features do not exist; Steps 4/5 must use `authorizeWorkspace` with them and add negative tests per capability.  
**Open risks:** matrix decided from the documented intent, pending product review (steps.md 3.2); SSE authorization not yet implemented (6.1); a Workspace whose only ACTIVE admin is disabled cannot be managed until a server-admin repair path exists.  
**Reviewed:** 2026-09-27

### Security check: local test environment (`test-env/`, 2026-09-27)
**Threat surface:** a demo instance with known accounts reachable by others; generated secrets or the demo password committed or world-readable; cleanup killing unrelated processes or deleting outside its directory; demo data created through a privileged backdoor.  
**Controls added:** binds to `127.0.0.1` only; runs in production mode (same config validation, Secure cookies, Origin guard, rate limits); secrets from `openssl rand`, stored with the DB, log and credentials in `.var/test-env/` (git-ignored, dir `0700`, files `0600`); one random demo password per install (no fixed password in the repository); demo data is created only through the public HTTP API, the bootstrap CLI and real invitation emails — no seeding code with database access exists; `uninstall.sh` kills only a PID whose command line is this repository's server, stops Mailpit only if it started it, and deletes only the expected state path.  
**Negative tests:** manual — the GUEST demo account gets `403` on the member list, the outsider account gets `404` for the Household Workspace, and the demo password does not appear in the server log. Full install → stop → restart → uninstall cycle verified; the development database stays untouched.  
**Secrets/data involved:** throwaway `AUTH_SECRET`/`DATA_ENCRYPTION_KEY`, demo password (plaintext in `credentials.txt`, by design).  
**Logging review:** server log in `.var/test-env/server.log` at `info`; no passwords or tokens (verified).  
**Authorization review:** unchanged application rules; the environment adds no routes.  
**Open risks:** anyone with access to the local user account can read the demo credentials (acceptable for throwaway data); never reuse it for real data or expose the port.  
**Reviewed:** 2026-09-27

### Security check: Procedures (Steps 4.1, 3.3)
**Threat surface:** authoring by roles without `procedure.edit`, reading or changing Procedures of another Workspace by id (IDOR), stored XSS through title/description/tags/icon, spoofed text via bidi/control characters, lost updates between concurrent editors, unbounded content/number of Procedures, hard deletion destroying history, unaudited or partially audited changes.  
**Controls added:** `procedure.view` / `procedure.edit` via `authorizeWorkspace` plus in-transaction re-check (`ActorGuard`); every repository query scoped by Workspace id + Procedure id + not deleted; plain-text fields with control/bidi rejection and length bounds (domain + DB CHECKs); icons only from `PROCEDURE_ICONS` (domain + DB CHECK), web renders text via React escaping; optimistic concurrency (`expectedRevision`, conditional UPDATE); per-Workspace limit 1000; soft delete with actor/time, no cascading FKs; `audit_events` append-only (triggers), written in the same transaction; strict Zod bodies rejecting unknown fields such as `id`/`workspaceId`.  
**Negative tests:** `packages/domain/src/procedure.test.ts`; `packages/database/src/procedure-use-cases.test.ts` (17); `apps/server/src/http/procedure.test.ts` (8); mutation checks listed in steps.md 4.1.  
**Secrets/data involved:** user-authored Procedure text (may contain household/operational details — Workspace-confidential).  
**Logging review:** no new log statements; Procedure text only in request bodies, which are not logged; audit metadata holds title, field names and revision numbers only.  
**Authorization review:** HTTP layer only authenticates and parses; all authorization in `packages/application/src/procedures/use-cases.ts` using `packages/permissions`.  
**Open risks:** titles are copied into audit metadata on create/delete (Workspace-confidential text persists in the append-only log even after deletion — acceptable, readable only by future authorized history views); no audit history UI yet; restore (4.5) re-checks `procedure.restore` and the Workspace scope, counts against the limit and is audited (`PROCEDURE_RESTORED`) — implemented 2026-09-27.  
**Reviewed:** 2026-09-27

### Security check: Procedure Sections and Steps (Step 4.2)
**Threat surface:** IDOR through client-supplied Section/Step ids (moving or overwriting another Procedure's or Workspace's items), id confusion between Sections and Steps, client-chosen ids on create, a partial update body wiping the structure, oversized structures and bodies, invalid policy/flag values, stored XSS in Section/Step text.  
**Controls added:** ids validated syntactically (UUIDv4, unique across kinds) and, inside the `IMMEDIATE` transaction, against the Procedure's own current items; new ids only server-generated; composite FK keeps each Step inside its own Procedure's Sections; update requires the complete `sections` array; ≤50 Sections / ≤200 Steps, 1 MiB body limit on create/update only; enums and lengths enforced in domain and DB CHECKs; plain-text rendering in the web client; one audit event per save with a structural change summary (no text copies).  
**Negative tests:** `packages/domain/src/procedure-structure.test.ts`, `packages/database/src/procedure-structure-use-cases.test.ts`, structure cases in `apps/server/src/http/procedure.test.ts`; mutation checks listed in steps.md 4.2.  
**Secrets/data involved:** user-authored Section/Step text (Workspace-confidential).  
**Logging review:** no new log statements; bodies are not logged.  
**Authorization review:** unchanged capabilities (`procedure.view` / `procedure.edit`); structure writes go through the same guarded repository methods as Procedure content.  
**Open risks:** the 1 MiB body limit on two routes raises per-request parsing cost (bounded by the global rate limit and authentication); Section/Step rows are rewritten on every save, so nothing may reference them by foreign key (Run snapshots must copy — 5.1).  
**Reviewed:** 2026-09-27

### Security check: Procedure import/export and duplicate (Step 4.4)
**Threat surface:** malicious import files (prototype pollution, deep nesting, huge payloads, unknown fields, forged ids to overwrite other records, script-bearing icons/text, bidi spoofing, future/foreign formats), data leakage through exports (internal ids, users, emails, Workspace data), cross-Workspace copying without permission, download file-name/header injection.  
**Controls added:** versioned envelope checked first; strict Zod schema with coarse bounds; field-by-field mapping into the regular create use-case (domain rules, limits, `procedure.edit`, in-transaction re-check, new ids, one audited transaction with `origin`); Fastify's JSON parser rejects `__proto__`/`constructor` keys and malformed JSON; 1 MiB body limit and 30 imports / 15 min per client; exports contain only definition fields; duplicate restricted to the same Workspace (cross-Workspace = export + import with both permission checks); client-side download naming from a letters/digits/dashes slug, no server `Content-Disposition`.  
**Negative tests:** `packages/import-export/src/procedure-document.test.ts`, `packages/database/src/procedure-copy-use-cases.test.ts`, `apps/server/src/http/procedure-transfer.test.ts`, `apps/web/src/procedure-files.test.ts`, e2e future-version import.  
**Secrets/data involved:** Procedure definitions (Workspace-confidential) leave the server as files by design; they contain no personal data.  
**Logging review:** no new log statements; import bodies are not logged.  
**Authorization review:** export `procedure.view`, import/duplicate `procedure.edit`, all through `authorizeWorkspace`; Procedure ids resolved only within the route's Workspace.  
**Open risks:** exported files are outside the application's control once downloaded (anyone who can read a Procedure can already copy its content); the lockfile entries for the new workspace links were added by hand and must be verified with `pnpm install --frozen-lockfile`.  
**Reviewed:** 2026-09-27

### Security check: Run snapshots (Step 5.1)
**Threat surface:** falsifying history (editing a Run's copied definition or starter after the fact, deleting Runs), Runs changing when their Procedure changes, starting or reading Runs of another Workspace by id, GUESTs starting Runs, race between Procedure edit and snapshot, unbounded active Runs.  
**Controls added:** snapshot copied (not referenced) in one `IMMEDIATE` transaction together with the `RUN_STARTED` audit event (with `run_id`); DB triggers make snapshot columns and `run_sections` immutable and forbid deleting `runs`/`run_sections`/`run_steps`; `run.start` (USER+) / `run.view` (all roles) via `authorizeWorkspace` plus in-transaction re-check; every Run/Procedure lookup scoped by the route's Workspace id; ≤500 ACTIVE Runs per Workspace; responses expose the starter's display-name snapshot only.  
**Negative tests:** `packages/database/src/run-use-cases.test.ts` (12), `apps/server/src/http/run.test.ts` (3); mutation checks in steps.md 5.1.  
**Secrets/data involved:** Run snapshots of Workspace-confidential Procedure text; starter display names.  
**Logging review:** no new log statements.  
**Authorization review:** HTTP only authenticates/parses; authorization in `packages/application/src/runs/use-cases.ts` via `packages/permissions`.  
**Open risks:** state columns are intentionally writable for 5.2/5.4 — their transitions must go only through audited use-cases; completed-Run immutability (5.6) still to be enforced; an operator with direct DB file access can drop triggers (DB-level protections guard the application, not the host).  
**Reviewed:** 2026-09-27

