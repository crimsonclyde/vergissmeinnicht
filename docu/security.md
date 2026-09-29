# Security Policy & Security Checks

## Security is the highest priority

For VergissMeinNicht, **security takes precedence over convenience, speed of implementation, and feature count**.

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
- [x] Breached/common-password blocklist. (Offline: 60 003 most common 15+ character passwords from public breach corpora, bundled with the server, compared in NFKC/lower-case/no-space form; plus repetitive/sequential patterns and passwords made mostly of the service name or the account's own email/name. Checked at invitation acceptance, password change and recovery; passwords never leave the server. Update procedure: `packages/auth/data/README.md` — 13.3.)

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
_Deferred with 2.6; these checks apply when external login is implemented (reviewed 2026-09-29: no external login code exists)._
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
- [x] Session rotates after login and security-sensitive privilege changes. (Login, TOTP enable/disable, password change and account recovery: yes — all sessions of the user are replaced. Account disabling deletes every session in the same transaction (2.7). Workspace role changes need no rotation: no role is cached in the session, every request re-reads the Membership. Reviewed 2026-09-29: no server-admin grant/removal flow exists — **when one is added it must replace the user's sessions** (review trigger).)
- [x] Logout invalidates server-side session.
- [x] Idle/absolute expiration policies are documented. (Idle 7 days, refreshed at most daily; absolute 30 days, enforced per request — `SESSION_POLICY` in `packages/auth`.)
- [x] CSRF protection covers state-changing cookie-authenticated operations. (Every non-GET/HEAD/OPTIONS request needs `Origin` = `PUBLIC_ORIGIN`, missing `Origin` rejected; JSON-only bodies; `SameSite=Strict`.)
- [x] Authentication library endpoints are not exposed wholesale: only allow-listed server routes call Better Auth (`/api/auth/sign-in`, `/sign-out`, `/session`); tests assert other Better Auth paths return 404.
- [x] Disabled users cannot start sessions; disabling deletes their sessions and pending sign-in challenges at once (2.7), and any leftover session is revoked on the next request.
- [x] CORS is deny-by-default / narrowly configured. (No CORS plugin registered: same-origin only; any future CORS needs review.)
- [x] Sensitive responses are not cached publicly. (`Cache-Control: no-store` on all `/api/*`.)
- [x] Production uses HTTPS. (Config rejects non-https `PUBLIC_ORIGIN` except loopback; the Compose deployment terminates TLS in Caddy with automatic certificates, 10.1.)
- [x] HSTS enabled when deployment topology makes it safe. (For https origins, one year by default, `HSTS_MAX_AGE`; no `includeSubDomains`/`preload` so other services on the domain are unaffected, 10.3.)
- [x] Content-Security-Policy is defined. (`default-src 'self'`, `script-src 'self'`, `style-src 'self'` and `font-src 'self'` without `'unsafe-inline'` since 8.3, `object-src 'none'`, `frame-ancestors 'none'`; the e2e flow fails on any CSP violation.)
- [x] Clickjacking prevented via CSP `frame-ancestors`.
- [x] `X-Content-Type-Options: nosniff`.
- [x] Strict `Referrer-Policy`, especially around Knot URLs. (`no-referrer` header + meta tag; verified on `/knot/{token}` by e2e, 7.1.)

---

## 3. Authorization and ACLs

- [x] Authorization happens server-side for every protected operation. (`requireUser` + `authorizeWorkspace`/server-admin checks in every use-case. `apps/server/src/http/route-security.test.ts` checks the registered route table itself, so every new route is covered: pinned public routes, 401 without session, 404 for non-members on every Workspace route, 403 for non-admins on every `/api/admin/*` route — 13.2.)
- [x] UI-hidden buttons are never the authorization mechanism. (The web client receives capabilities only to adapt its UI; every request is re-authorized.)
- [x] Workspace membership checked for resource access. (`authorizeWorkspace` in `packages/application/src/workspaces/use-cases.ts` reads the Membership on every call; non-members get the same 404 as unknown ids.)
- [x] Role/capability checked for the requested operation. (Capabilities, not role strings; mutations re-check the actor's current role and ACTIVE status inside the write transaction.)
- [x] Child resources cannot bypass parent Workspace checks. (Memberships, Procedures, Sections, Steps, Runs, RunSteps, Knots: every query is scoped by the route's Workspace id plus the child id; a child id from another Workspace behaves like an unknown id; Section/Step ids in a save must already belong to that Procedure, enforced in the transaction and by a composite FK. The route-table test uses every child id of Workspace A under Workspace B → 404, nothing changes; it found and fixed Procedure history answering `200 []` instead of 404 — 13.2.)
- [x] Object identifiers are opaque but are not treated as authorization. (UUIDv4 Workspace ids; knowing an id grants nothing.)
- [x] Guest/User/Editor/Admin policies are centrally defined. (`packages/permissions`: one role → capability table incl. Procedure/Run capabilities (3.2), exact-matrix test; matrix documented in steps.md 3.2.)
- [x] Cross-Workspace access has negative tests.
- [x] Horizontal privilege escalation has negative tests. (Admin of Workspace A cannot manage members of Workspace B; members cannot see other Workspaces.)
- [x] Vertical privilege escalation has negative tests. (GUEST/USER/EDITOR cannot add, re-role, remove or rename; self-promotion refused; Workspace ADMIN ≠ server admin.)
- [x] Membership/role changes are audited. (`WORKSPACE_CREATED`, `WORKSPACE_RENAMED`, `MEMBERSHIP_ADDED`, `MEMBERSHIP_ROLE_CHANGED`, `MEMBERSHIP_REMOVED` in `security_events`, same transaction.)
- [x] Removing a member invalidates/updates active access promptly. (No cached authorization: the next request with the same session is denied. SSE streams re-check membership before every delivered change and at every 20 s heartbeat — Step 6.1.)
- [x] Workspace creation goes through one capability (`canCreateWorkspace`: ACTIVE server admins only).
- [x] Every Workspace keeps at least one ACTIVE member with `workspace.members.manage`; enforced inside the membership transaction.

---

## 4. Knot links

Canonical shape:
`/knot/{opaque-token}`

- [x] Token generated by CSPRNG with adequate entropy. (256 bits, `crypto.randomBytes`, base64url.)
- [x] Token is never placed in query parameters. (Path `/knot/{token}` for the page; the API takes it in the JSON body of `POST /api/knots/resolve`.)
- [x] Token values are redacted from application/proxy logs where possible. (`/knot/…` and `/api/knots/…` paths redacted by the request serializer; reverse-proxy logs must be configured by the operator — 10.x.)
- [x] Stored token is hashed where practical. (SHA-256 only; the link is shown once at creation.)
- [x] Knot has explicit scope/target and permission. (Exactly one Procedure or Run of its Workspace, DB CHECK; managed with `knot.manage`.)
- [x] Knot can expire. (1–365 days or never.)
- [x] Knot can be revoked. (Final, audited, record kept; DB trigger forbids un-revoking.)
- [x] Expired/revoked tokens have negative tests.
- [x] Knot possession does not replace authentication under current requirements. (Resolution requires a session; 401 without one.)
- [x] User authorization is checked after Knot resolution. (`procedure.view` / `run.view` in the Knot's Workspace, and again by every request of the target page.)
- [x] Referrer policy prevents accidental propagation. (`no-referrer`; the app also replaces the history entry after opening.)
- [x] Error responses do not disclose sensitive target details before authorization. (One `404 knot_not_found` for every failure.)

---

## 5. Input and output safety

- [x] Validate all inputs at server trust boundaries. (Params, query and body of every route are parsed by strict Zod schemas before use; imports by the strict import-export parser; domain parsers re-validate — reviewed 2026-09-29.)
- [x] Use schema validation for API payloads. (`z.strictObject` everywhere: unknown fields rejected.)
- [x] Parameterize SQL / use safe query builder or ORM. (Drizzle; `sql` templates bind interpolated values as parameters.)
- [x] Never concatenate user input into SQL. (`sql.raw` only in schema CHECK constraints from compile-time constants; `prepare`/`exec` only with constant strings — guarded by `packages/database/src/sql-safety.test.ts`.)
- [x] Escape output according to rendering context. (React text rendering only; no HTML sinks — guarded by `apps/server/src/http/web-output-safety.test.ts`; emails are text-only; JSON responses.)
- [x] Do not accept arbitrary HTML by default. (Procedure text is plain text; the web client renders it as text, never via `innerHTML`.)
- [x] User-selectable icons are trusted icon keys, not arbitrary uploaded SVG/HTML. (`PROCEDURE_ICONS`, validated in the domain; in the database every icon column references the `procedure_icons` table since migration 0019 — keys are only ever added by migrations.)
- [ ] Apply sensible text/array/file-size limits. (Procedures: title 120, description 4000 code points, ≤10 tags × 32, ≤1000 per Workspace; ≤50 Sections, ≤200 Steps per Procedure, 1 MiB body limit on Procedure saves; coarse transport bounds in the Zod schemas. Keep extending per feature.)
- [x] Reject malformed UUIDs/tokens/state transitions. (Lower-case UUIDv4 path/body ids; malformed, upper-case and nil ids in every path parameter → 400/404, never 5xx (route-table test); tokens length/alphabet-checked before hashing; state transitions by the domain state machine with compare-and-set.)
- [x] Drag/drop order input is validated, authorized, and bounded. (Reordering is client-side only; the result is saved through the 4.2 Procedure save: `procedure.edit`, ids must belong to the Procedure, ≤50 Sections / ≤200 Steps, revision check.)

- [x] Emails are normalized (trim, NFC, lower-case) before storage/lookup; uniqueness is enforced on the normalized value by a unique index.
- [x] Emails with invisible or broken characters are rejected (control, format — zero-width, direction marks, soft hyphen —, private-use, unassigned, lone surrogates, U+FFFD, non-ASCII spaces): they would create look-alike accounts or addresses nobody can type (found on the first Unraid install, 0.1.0-beta.3).
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

- [x] Important mutations record internal User UUID. (Procedures, Runs, Step state changes, Run completion/abort in `audit_events`; account/access changes in `security_events`.)
- [x] Store actor display-name snapshot where historical readability requires it. (Audit events, Run starter, Step state changes.)
- [x] Store trusted server timestamp. (Server clock only. Since 8.5 an offline change may report its device time; it is stored separately as `deviceAt`, labelled as device clock, bounded by `plausibleDeviceTime`, and never replaces the server time.)
- [x] Required state change + AuditEvent are one DB transaction. (Every repository mutation; tests force the audit insert to fail and assert a full rollback.)
- [x] Normal users cannot edit/delete audit history. (No write API; history is read-only via `AuditHistory`; UPDATE/DELETE blocked by triggers for everyone.)
- [x] `security_events` is append-only at the DB level (UPDATE/DELETE triggers abort); readable only by ACTIVE server admins through `GET /api/admin/security-events` (5.7).
- [x] `audit_events` (Workspace content history) is append-only at the DB level; Procedure changes and their audit event commit in one transaction with actor id, display-name snapshot and server timestamp.
- [x] Corrections are additive rather than silent rewrites. (Undo is a new event; finished Runs are frozen; no correction workflow exists in V1.)
- [x] Audit metadata does not contain credentials/secrets. (Titles, field names, states, counts, reasons and ids only; history responses expose display names, not user ids.)
- [x] Procedure deletion cannot cascade-delete historical Runs. (Soft delete only; `runs.procedure_id` FK without cascade blocks even a hard delete; Run rows cannot be deleted — triggers.)
- [x] Historical Run snapshot remains readable after Procedure change/deletion. (Definition copied at start; snapshot columns immutable by triggers; tests edit, restructure and delete the source.)
- [x] Completed/aborted Runs are immutable (application checks plus triggers `runs_finished_immutable` and `run_steps_state_only_while_active`); no correction workflow in V1 — any future one must be additive and audited.

---

## 7. Realtime collaboration

- [x] Realtime connection authenticates current session. (`requireUser` on connect; the same session is re-checked — exists, not expired/revoked, User ACTIVE — before every event and every 20 s.)
- [x] Subscription to a Run is authorized server-side. (`authorizeRunSubscription`: `run.view` + Run within the Workspace; re-evaluated like the session.)
- [x] User cannot subscribe to arbitrary Workspace/Run channels. (Channels are addressed only by Workspace + Run id through the authorized route; there is no client-chosen channel name.)
- [x] Realtime event does not expose unnecessary sensitive data. (Revision, event kind, Step id, actor display name, time — no user ids, emails or Step/Run text; content is refetched through the API.)
- [x] Mutations still use authoritative server validation. (The stream is server → client only; changes go through the existing POST routes.)
- [x] Client-supplied actor/timestamps are ignored for audit authority. (Events are built from the committed server result; an offline change's device time is informational metadata only, 8.5.)
- [x] Reconnect fetches canonical state. (Every (re)connect starts with a `ready` event carrying the current revision, read after subscribing; the client refetches when it is newer.)
- [x] Revision/version conflicts are handled deliberately. (`Run.revision`; Step writes keep the 5.2 `expectedState` check; the client never hides a revision gap and ignores older answers.)
- [x] Realtime endpoint has resource/rate/connection limits. (10 streams per user, 1000 per process, 30 connects/min per client, 15 min maximum lifetime, 20 s heartbeat, closed on shutdown.)

---

## 8. Database and storage

- [x] SQLite foreign keys enabled.
- [x] Migrations exist from first schema. (`packages/database/migrations` 0000–0015; readiness reports pending ones.)
- [x] Writes requiring audit consistency are transactional. (Every repository mutation with its audit/security event in one `IMMEDIATE` transaction — §6.)
- [x] SQLite file permissions are restrictive.
- [x] WAL/sidecar files are treated as sensitive data too. (Same `0700` directory; backups use the online backup API so WAL content is included, and are converted to a single file; restores move the old database together with its WAL/SHM.)
- [x] DB files are excluded from Git. (Also `deploy/secrets/`, `deploy/vergissmeinnicht.env`; `.dockerignore` keeps data and secrets out of the build context.)
- [x] Backup contains sensitive data and is protected accordingly. (`0600` files in `0700` `/data/backups`; docs require encrypted off-host copies and a separately stored `DATA_ENCRYPTION_KEY`. Scheduled backups (10.5) use the same verified path and retention only deletes automatic backups.)
- [x] Restore procedure is tested. (Automated round-trip tests plus a container drill, 10.2.)
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
- notification provider credentials (Telegram bot token) and Telegram pairing tokens;
- encryption keys;
- production DB files;
- private keys/certificates.

Checks:
- [x] `.gitignore` covers common local secret files.
- [x] `DATA_ENCRYPTION_KEY` (encryption at rest) is separate from `AUTH_SECRET` (cookie signing), wrapped in `Secret`, required in production, rejected if equal to `AUTH_SECRET`.
- [x] Safe `.env.example` contains placeholders only.
- [x] Structured logging has redaction.
- [x] Request logging avoids sensitive URL/path token leakage. (Knot paths — `/knot/…`, `/api/knot(s)/…` — and query strings redacted; add each new token route to the pattern in `apps/server/src/logging.ts`.)
- [x] Exceptions do not serialize credential-bearing objects. (MFA use-case errors carry no codes or secrets.) (Config secrets use the `Secret` wrapper; the HTTP error handler logs only error type + stack frames because messages can embed query parameters; Better Auth log calls are reduced to their message string. Notification credentials (13.7): the Telegram adapter turns every failure — whose URL would contain the bot token — into a `NotificationDeliveryError` with a stable code only; the reminder scheduler logs error type and code only; tests capture the logs and responses and assert the token is absent. Extend to every new credential type.)
- [x] Production debug mode is disabled. (`LOG_LEVEL` debug/trace rejected in production.)
- [x] Secret rotation process can be documented. (`AUTH_SECRET`: see deployment.md — rotation signs everyone out.)
- [x] Configuration is validated at startup and fails closed; production has no default for any secret, origin or DB path.
- [x] Development and production modes cannot overlap: `NODE_ENV` must be explicit and `.env` cannot override it; production never loads `.env`.
- [x] Placeholder or short (<32 chars) `AUTH_SECRET` values are rejected in every mode.
- [x] Configuration errors name variables but never echo their values.

---

## 10. Dependency / supply-chain security

- [x] Use lockfile.
- [x] Pin/review security-critical dependencies. (All versions pinned exactly with a committed lockfile; installed versions compared with the latest releases on 2026-09-29.)
- [x] Automated vulnerability/dependency scanning enabled.
- [x] Avoid abandoned auth/crypto libraries. (Reviewed 2026-09-29: better-auth, @node-rs/argon2, otpauth, nodemailer, drizzle-orm, fastify and its security plugins all released within the last two months; re-check at every upgrade.)
- [x] Review dependency install scripts where relevant.
- [x] CI runs tests/typecheck/lint.
- [ ] Security-sensitive dependency upgrades receive explicit review. (Standing rule, not closable once: every Dependabot upgrade of better-auth, argon2, otpauth, nodemailer, drizzle, fastify security plugins or zod is reviewed — changelog and advisories — before merging.)

---

## 11. Deployment security

- [x] Container runs non-root where practical. (Also verified as `--user 99:100` with bind mounts, 12.2. A container started as root — Unraid's per-container Tailscale needs that — is dropped by the entrypoint to `PUID:PGID` via `setpriv` with empty inheritable/bounding capability sets before anything else runs; `0` and non-numeric ids are refused; tested: the application process has no effective or bounding capabilities. As root it first gives the data directory to PUID:PGID — only that directory, without Tailscale's state, never following or changing symbolic links.) (`node`, uid 1000; `cap_drop: ALL`, `no-new-privileges`, read-only root file system, tmpfs `/tmp`; CI asserts uid 1000.)
- [x] No secrets baked into image. (Runtime env/`*_FILE` Docker secrets only; `.dockerignore` excludes `.env*`, secrets and data; the image fails closed without configuration — CI check.)
- [x] Only required port exposed. (The app publishes no port; only Caddy's 80/443.)
- [x] Persistent writable paths are explicit. (Volume `/data` only.)
- [x] Reverse proxy trust configuration is explicit. (`TRUSTED_PROXIES` = Caddy's fixed address; dynamic addresses come from a separate range; `/0`, `*`, host names rejected.)
- [x] Do not trust spoofable forwarding headers unless proxy is trusted. (Without `TRUSTED_PROXIES` the socket address is used; tested that untrusted clients cannot change their rate-limit identity via `X-Forwarded-For`.)
- [x] HTTPS termination documented. (deployment.md "Reverse proxy, HTTPS and rate limits".)
- [x] Backups are protected and restorable. (§8.)
- [x] Production migrations are controlled. (Server never migrates itself; explicit `migrate` command with automatic pre-migration backup; readiness `503 migrations_pending` until done. Opt-in `VMN_MIGRATE_ON_START=true` runs the same `migrate` command, backup included, in the entrypoint before `serve` — for Unraid, 12.2.)
- [x] Private/Tailscale deployment does not replace app authentication. (Documented; no configuration disables authentication.)

---

- [x] Install scripts only run for allow-listed packages (`allowBuilds`); new entries require review. (`@node-rs/argon2` ships prebuilt binaries as optional dependencies and needs no install script.)
- [x] Newly published versions are not installed for 24 h (`minimumReleaseAge`).
- [x] Publish trust downgrades fail install (`trustPolicy: no-downgrade`); exceptions are exact versions with a written reason.
- [x] CI actions are pinned to commit SHAs and run with a read-only token. (Release workflow: `packages: write` / `id-token: write` only in its tag-triggered jobs; every newly pinned action checked to be a verified commit on its default branch, 10.4.)
- [x] Built images are scanned before release (Trivy, fixable HIGH/CRITICAL fail CI and the release), smoke-tested on amd64 and arm64, signed keyless (Sigstore) with an SBOM attestation (10.4).

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
- external notification services (reviewed for email reminders and Telegram in 13.5–13.7; ntfy, Gotify, Web Push and webhooks each need their own review — see "Security check: notification providers and Telegram").

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
**Open risks:** HSTS off until HTTPS termination is configured (resolved in 10.3); moderate advisory GHSA-67mh-4wv8-2f99 in dev-only `drizzle-kit` dependency chain; CSP `style-src` allowed `'unsafe-inline'` (helmet default) — tightened to `'self'` in 8.3; validated configuration and fail-closed startup pending (1.2).  
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
**Open risks:** behind a reverse proxy without `TRUSTED_PROXIES` (available since 10.3, preset in the Compose deployment) all clients share one address and per-client limits become global (DoS of sign-in by one attacker); per-account limit lets an attacker temporarily block a known account's sign-in (bounded to 15 min windows); session tokens are stored unhashed (a DB leak plus `AUTH_SECRET` allows session forgery — protect both; rotate `AUTH_SECRET` after suspected compromise); no breached-password blocklist; in-memory rate-limit state resets on restart (sensitive limits persisted since 2.9); password change and privilege-change session rotation not yet implemented; `BETTER_AUTH_TELEMETRY` env var would override the explicit telemetry opt-out — do not set it.  
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
**Open risks:** "add member by email" tells a Workspace ADMIN whether an ACTIVE account exists for an address (accepted: invite-only system, admins are trusted, rate-limited and audited); Workspace names are stored in security-event metadata on rename (not secret, but personal wording persists); members cannot leave a Workspace on their own unless they are an admin; disabling the only ACTIVE admin of a Workspace is refused (2.7), so no Workspace is left without a manager; no Workspace deletion/archiving yet; SSE authorization and Procedure/Run capabilities still to come (3.2, 6.1).  
**Reviewed:** 2026-09-27

### Security check: Workspace role policy (Step 3.2)
**Threat surface:** over-broad default roles (GUEST executing or editing), scattered role checks drifting apart, members unable to withdraw from a Workspace, admins orphaning a Workspace by leaving.  
**Controls added:** full V1 capability matrix in `packages/permissions` (GUEST read-only: `workspace.view`, `procedure.view`, `run.view`; USER adds member list and Run start/execute/abort; EDITOR adds Procedure edit/restore; ADMIN adds member and settings management); tests pin the exact matrix, GUEST's read-only set and the author/execute role sets; `leaveWorkspace` removes only the caller, requires membership, keeps ≥1 ACTIVE admin and is audited.  
**Negative tests:** `packages/permissions/src/policy.test.ts`; leave cases in `packages/database/src/workspace-use-cases.test.ts` and `apps/server/src/http/workspace.test.ts` (non-member 404, missing Origin 403, unauthenticated 401, last admin 409).  
**Secrets/data involved:** none new.  
**Logging review:** no new log output.  
**Authorization review:** Procedure/Run capabilities are defined but not yet enforced anywhere because those features do not exist; Steps 4/5 must use `authorizeWorkspace` with them and add negative tests per capability.  
**Open risks:** matrix decided from the documented intent, pending product review (steps.md 3.2); SSE authorization not yet implemented (6.1); a Workspace can no longer lose its only ACTIVE admin through account disabling (refused since 2.7).  
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
**Open risks:** titles are copied into audit metadata on create/delete (Workspace-confidential text persists in the append-only log even after deletion — acceptable, readable only by future authorized history views); no audit history UI yet; restore (4.5) re-checks `procedure.restore` and the Workspace scope, counts against the limit and is audited (`PROCEDURE_RESTORED`) — implemented 2026-09-27; reading a deleted Procedure before restoring (8.9) needs the same `procedure.restore` capability, is Workspace-scoped and only finds soft-deleted rows.  
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
**Open risks:** exported files are outside the application's control once downloaded (anyone who can read a Procedure can already copy its content); the lockfile entries for the new workspace links were added by hand; verified 2026-09-27 with `pnpm install --frozen-lockfile` (no changes, supply-chain policies passed).  
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

### Security check: Step state changes (Step 5.2)
**Threat surface:** unauthorized execution (GUESTs, non-members, other Workspaces), IDOR by combining a Step id with another Run or Workspace, lost updates between collaborators, bypassing reason policies by calling the API directly, spoofed or oversized reasons, forged actor/time, changing finished Runs, state change without audit.  
**Controls added:** `run.execute` via `authorizeWorkspace` + in-transaction re-check; Step looked up within the Run within the Workspace; `expectedState` compare-and-set plus conditional UPDATE; transition and reason rules evaluated server-side against the Step's immutable snapshot; reasons plain text ≤500 code points without control/bidi characters; actor and time taken from the session and the server clock only (strict body rejects anything else); DB CHECKs for actor/time/reason consistency; trigger freezes execution state of non-ACTIVE Runs; state change, Run revision and `STEP_STATE_CHANGED` audit event (with `run_id`, from/to/undo/reason) in one transaction; responses expose display names only.  
**Negative tests:** `packages/domain/src/step-transition.test.ts`, `packages/database/src/step-state-use-cases.test.ts` (12), `apps/server/src/http/run.test.ts`; mutation checks in steps.md 5.2.  
**Secrets/data involved:** reasons (free text, Workspace-confidential), actor names.  
**Logging review:** no new log statements; reasons appear only in request bodies (not logged) and audit metadata.  
**Authorization review:** HTTP only authenticates/parses; authorization in `packages/application/src/runs/use-cases.ts`.  
**Open risks:** any member with `run.execute` can undo anyone's change (by design: "any authorized Workspace user may continue an active Run"; every undo is audited with the actor); reasons are stored in audit metadata permanently.  
**Reviewed:** 2026-09-27

### Security check: Run completion and abort (Step 5.4)
**Threat surface:** completing Runs with unresolved required Steps (also via a race with a concurrent undo), GUESTs or non-members ending Runs, ending Runs of another Workspace by id, reopening or editing finished Runs, rewriting who ended a Run, unaudited endings.  
**Controls added:** `run.execute` / `run.abort` via `authorizeWorkspace` + in-transaction re-check; completion rule evaluated on current Steps inside the `IMMEDIATE` transaction; Run resolved within the Workspace; conditional update from ACTIVE only; end data from session and server clock; DB CHECKs for end-data consistency; trigger `runs_finished_immutable` freezes every column of finished Runs (plus the 5.2 Step freeze and 5.1 no-delete triggers); `RUN_COMPLETED` / `RUN_ABORTED` audit events with `run_id` in the same transaction.  
**Negative tests:** `packages/database/src/run-lifecycle-use-cases.test.ts` (10), `packages/domain/src/run.test.ts`, lifecycle scenario in `apps/server/src/http/run.test.ts`; mutation checks in steps.md 5.4.  
**Secrets/data involved:** abort reasons (free text), actor names.  
**Logging review:** no new log statements.  
**Authorization review:** authorization only in `packages/application/src/runs/use-cases.ts`.  
**Open risks:** any member with `run.abort` can abort anyone's Run (by design, audited); there is no correction workflow for mistakes in finished Runs (V1 decision).  
**Reviewed:** 2026-09-27

### Security check: live Run updates (Step 6.1)
**Threat surface:** eavesdropping on Runs of other Workspaces by subscribing with guessed ids, removed/demoted/disabled members or signed-out sessions keeping a live feed, pre-MFA state reaching the stream, cross-site EventSource requests (CSRF-style reads), data leakage through event payloads, connection exhaustion (per user, per process), missed updates making the UI show stale state as current, intermediary caching or buffering of the stream.  
**Controls added:** session required (`requireUser`, no session exists before the TOTP challenge); authorization through `authorizeRunSubscription` (`run.view`, Run scoped by Workspace id), with the same 404/403 answers as reading the Run; session (same id, lifetimes, revocation, User ACTIVE — without refreshing it) and authorization re-checked before every delivered event and at every 20 s heartbeat, failures close the stream; `SameSite=Strict` session cookie (cross-site EventSource carries no session); events are announcements only (revision, kind, Step id, display name, time) and content is refetched over the authorized API; events emitted only after commit, never for rejected writes; hub limits (10/user, 1000/process), 30 connects/min per client, 15 min lifetime, `204` for finished Runs, `preClose` shutdown; `Cache-Control: no-store`, `X-Accel-Buffering: no`; the revision read after subscribing closes the subscribe/commit race.  
**Negative tests:** `apps/server/src/http/run-events.test.ts` (unauthenticated, forged session cookie, MFA-challenge cookie, non-member, cross-Workspace Run id, malformed id, removed member, sign-out, per-user limit, payload without ids/emails/content), `packages/realtime/src/run-change-hub.test.ts`, notification case in `packages/database/src/run-lifecycle-use-cases.test.ts`; mutation checks in steps.md 6.1.  
**Secrets/data involved:** actor display names and change times of Workspace Runs.  
**Logging review:** no new log statements; the stream URL contains only Workspace/Run ids.  
**Authorization review:** HTTP layer authenticates and streams; authorization in `packages/application/src/runs/use-cases.ts` (`authorizeRunSubscription`).  
**Open risks:** re-checks run every 20 s, so a revoked session or removed member may receive announcements (no content) for up to one heartbeat; per-client connect limits need `TRUSTED_PROXIES` behind a proxy (10.3); the hub is in-process (multi-node deployments require a reviewed shared pub/sub — §12 trigger "multi-node deployments").  
**Reviewed:** 2026-09-27

### Security check: Knot links (Step 7.1)
**Threat surface:** guessing or brute-forcing tokens; token leakage via logs, Referer, browser history, screenshots or chat; a leaked token granting access to outsiders; enumerating Workspaces/targets through error differences; linking targets of another Workspace (IDOR) or confusing Procedure and Run ids; creating Knots without permission; reviving revoked Knots or retargeting existing ones; unbounded Knot creation; pre-MFA or signed-out access.  
**Controls added:** 256-bit CSPRNG tokens, SHA-256 at rest, link shown once; resolution only with a full session (no session exists before the TOTP challenge), token only in the POST body (Origin guard, 1 KiB, 30/min per client), then expiry/revocation, `authorizeWorkspace` with the target's view capability and target availability — every failure the same `404 knot_not_found`; target resolved within the Knot's Workspace at creation, type-consistent DB CHECK; `knot.manage` (EDITOR, ADMIN) via `authorizeWorkspace` plus in-transaction re-check; create/revoke audited in the same transaction (metadata: label, target type/id, expiry — never token or hash); triggers keep Knots undeletable and allow only a one-time revocation; ≤500 active Knots per Workspace, 30 creations / 15 min per client; `/knot/…` and `/api/knots/…` redacted in request logs; `Referrer-Policy: no-referrer`; the web client replaces the history entry after opening.  
**Negative tests:** `packages/database/src/knot-use-cases.test.ts`, `apps/server/src/http/knot.test.ts`, `packages/domain/src/knot.test.ts`, `apps/server/src/logging.test.ts`, e2e revoke; mutation checks in steps.md 7.1.  
**Secrets/data involved:** Knot tokens (bearer-like pointers, not credentials), Knot labels (Workspace-confidential text), target ids.  
**Logging review:** no new log statements; tokens never in API URLs; the page path is redacted.  
**Authorization review:** HTTP authenticates and parses; all decisions in `packages/application/src/knots/use-cases.ts`; the target page re-authorizes every request on its own.  
**Open risks:** a leaked, unexpired Knot tells a member of the Workspace where it points (by design) but nothing to others; reverse-proxy access logs may record `/knot/{token}` unless the operator redacts them (document in 10.x); the token remains in the browser history entry until the app replaces it (and if opening fails); openings are not audited; anonymous Knot access would need a new review (§12).  
**Reviewed:** 2026-09-27

### Security check: deployment, hardening and backups (Steps 10.1–10.3)
**Threat surface:** container escape or tampering via root/capabilities/writable image; secrets in images, Compose files, environment dumps or build context; spoofed `X-Forwarded-For` defeating rate limits (or, without proxy trust, one attacker throttling everyone); downgrade to HTTP; slowloris-style connections; token leakage through proxy access logs; unprotected or unrestorable backups; restoring over a live database (silent data loss); inconsistent file copies; uncontrolled migrations; stale dependencies/base images.  
**Controls added:** image pinned by digest, multi-stage build, server-only production dependencies, runs as `node` with `cap_drop: ALL`, `no-new-privileges`, read-only root FS, tmpfs `/tmp`, `/data` 0700; HEALTHCHECK on readiness; `*_FILE` secrets (absolute path, both-set rejected, contents never echoed) with Docker secrets in Compose; `TRUSTED_PROXIES` explicit IP/CIDR list (no `/0`, no host names, no "trust all") with Caddy on a fixed address and dynamic addresses in a separate range; HSTS for https origins; `Permissions-Policy`; request/connection timeouts; Caddy without access log and without compression (BREACH, SSE); backups through SQLite's online backup API, verified (integrity, foreign keys, schema), `0600`, self-contained, never overwriting; restore verifies first, refuses while any connection holds the database (exclusive-lock probe), keeps the replaced database; `migrate` backs up before applying pending migrations, server reports `migrations_pending` as not ready; CI builds the image and asserts non-root + fail-closed startup; Dependabot for the Docker base image and the Compose proxy image.  
**Negative tests:** `apps/server/src/config/config.test.ts` (proxy entries incl. `/0`, `*`, host names; HSTS only for https; file secrets: both set, relative path, unreadable, short content not echoed), `apps/server/src/http/hardening.test.ts` (HSTS/Permissions-Policy, forwarded client identity only from the trusted proxy — spoofing from elsewhere does not escape the limit, readiness with pending migrations), `packages/database/src/backup.test.ts` (WAL content included, modes, refusal while open — also idle with empty WAL, garbage/foreign/missing/same-file rejected without changes); container drill (steps.md 10.2).  
**Secrets/data involved:** `AUTH_SECRET`, `DATA_ENCRYPTION_KEY`, SMTP password (Docker secrets); complete database backups.  
**Logging review:** no new application log output; proxy access logs deliberately absent (Knot tokens).  
**Authorization review:** no new endpoints except public `GET /api/health/ready` (status and reason code only) and `GET /api/about` (11.1).  
**Open risks:** backups are only as safe as where operators store them (encryption off-host is documented, not enforced); `restore --force` bypasses the in-use check; secrets readable by the container user (inherent); better-auth's optional peer dependencies (drizzle-kit, vitest, esbuild) are resolved into the production tree (unused at runtime, ~60 MB); image vulnerability scanning beyond Dependabot is not automated; a single host — no high availability.  
**Reviewed:** 2026-09-27

### Security check: account status (Step 2.7)
**Threat surface:** a stolen admin session disabling or re-enabling accounts; an admin locking everyone out (self-disable, last admin); disabled users keeping live sessions, sign-in challenges, recovery links or invitations they issued (e.g. a compromised admin's pending server-admin invitations); Workspaces left without a manager; TOCTOU between check and write; account enumeration.  
**Controls added:** ACTIVE-server-admin check in the use-case and again inside the `IMMEDIATE` transaction; step-up (password + TOTP if enabled); no self-change; sole-Workspace-manager rule evaluated inside the transaction (refused, Workspaces named); disabling deletes sessions, consumes MFA challenges, revokes pending recoveries and pending invitations issued by the user — all with security events in the same transaction; enabling restores nothing; strict body, UUIDv4 path, 20 changes / 15 min per admin.  
**Negative tests:** `packages/database/src/account-admin-use-cases.test.ts`, `apps/server/src/http/account-admin.test.ts`; mutation checks in steps.md 2.7.  
**Secrets/data involved:** account emails and status (only to server admins); admin password / TOTP (transient step-up).  
**Logging review:** no new log statements; passwords only in request bodies (not logged).  
**Authorization review:** `listAccounts` / `setAccountStatus` in `packages/application/src/accounts`; the HTTP layer only authenticates and parses.  
**Open risks:** server admins see every account's email (inherent to administration); an admin can disable any other admin (both actions audited); no server-admin grant/removal flow yet.  
**Reviewed:** 2026-09-28

### Security check: housekeeping and persistent rate limits (Steps 2.8/2.9)
**Threat surface:** deleting rows that are still usable (live sessions, pending links) or history (security/audit events); leftover expired token hashes and sessions accumulating; brute-force limits reset by restarting or crashing the server; personal data (emails, IPs) accumulating in a limiter table; write amplification by flooding a persisted limiter.  
**Controls added:** purge conditions only select expired, consumed, or finished-for-30-days rows, in one transaction; security events, audit events, Runs and Knots are never touched (append-only triggers would refuse anyway); counts-only logging. Sensitive limits in `rate_limits` keyed by SHA-256 of counter name + key; no writes after a key is over its limit; expired windows purged hourly.  
**Negative tests:** `packages/database/src/housekeeping.test.ts` (pending/recent/live rows kept, events untouched), `apps/server/src/http/rate-limit-persistence.test.ts` (limits survive a restart; no email/IP stored; ordinary routes do not write).  
**Secrets/data involved:** session rows, token hashes, hashed limiter keys.  
**Logging review:** only deletion counts and error types.  
**Authorization review:** no new endpoints; the CLI requires shell access with the production configuration.  
**Open risks:** hashed limiter keys of low-entropy inputs (emails, IPv4 addresses) could be brute-forced by someone with the database file — they exist only for the window length (≤15 min) plus up to one hour until purge; single-node only.  
**Reviewed:** 2026-09-28

### Security check: security log and paging (Step 5.7)
**Threat surface:** non-admins reading account activity (sign-ins, emails); using a cursor id from another Workspace/Run to learn about or position inside foreign data; malformed cursors; secrets leaking through event metadata.  
**Controls added:** `listSecurityEvents` requires an ACTIVE server admin; read-only (no write path exists, table append-only); cursors are resolved inside the same scope as the list (Workspace + Run/Procedure/state filter, account filter) and otherwise rejected with one `invalid_cursor`; strict UUIDv4 query schemas; the list is authorized before the cursor is looked at; event metadata never contains secrets (§6); only display-name snapshots/system labels and subject emails are returned.  
**Negative tests:** `packages/database/src/history-use-cases.test.ts` (foreign cursors), `packages/database/src/account-admin-use-cases.test.ts` (log authorization, filter-scoped cursors), `apps/server/src/http/run.test.ts` and `account-admin.test.ts` (401/403/404, invalid cursors).  
**Secrets/data involved:** account emails, session ids (not tokens) and client-independent event metadata.  
**Logging review:** no new log output.  
**Authorization review:** in `packages/application/src/accounts` and the history/run use-cases.  
**Open risks:** server admins see all accounts' sign-in activity (inherent to the role, documented).  
**Reviewed:** 2026-09-28

### Security check: offline Run execution (Step 8.5)
**Threat surface:** Workspace-confidential Run data at rest on phones/shared computers; queued changes sent under another account's session (misattribution); forged or wrong device clocks rewriting "when" in the history; replayed or duplicated writes; offline changes silently overwriting others' changes; stale client capabilities; a service worker caching private API responses or serving them to another user; changes to finished Runs through the new column.  
**Controls added:** server time stays authoritative; device time only in a separate labelled column/metadata, bounded to [Run start, server time + 2 min] and ≤7 days old, capped at the server time, frozen with the Run by trigger; every offline change is an ordinary authorized request (session, Origin, `run.execute` + in-transaction re-check, compare-and-set on the expected state, reason policies, Run ACTIVE); idempotency by a client UUIDv4 unique per actor, checked inside the write transaction (same Step only; duplicates write nothing and emit no event); refused changes are dropped with an explanation, never retried in another form; queue entries carry the user id and are only sent by that user's provider; sign-out deletes the IndexedDB database; another account signing in deletes the previous account's entries; only active Runs the user opened are stored, removed once finished; service worker caches only the same public shell for all users, never `/api`, same-origin GETs only; `Cache-Control: no-store` on the API unchanged; CSP unchanged (`default-src 'self'` covers the worker and manifest).  
**Negative tests:** `packages/database/src/offline-step-changes.test.ts`, `packages/domain/src/run.test.ts`, offline case in `apps/server/src/http/run.test.ts`, `apps/web/src/offline/queue.test.ts`, e2e offline/conflict/sign-out cleanup; mutation checks in steps.md 8.5.  
**Secrets/data involved:** Run snapshots and reasons (Workspace-confidential) and the user's display data on the device; no credentials (the session cookie stays HttpOnly and is never stored by the app).  
**Logging review:** no new log output.  
**Authorization review:** unchanged server-side authorization for every sent change; cached capabilities only adapt the offline UI.  
**Open risks:** a device that is never signed out keeps its last user's saved Runs readable to anyone who can use that browser profile (same as the open app itself; documented); a user can claim any plausible device time within the bounds (shown as device clock, next to the server time); browsers may evict storage (queued changes lost — the user sees them as not sent).  
**Addendum 13.1 (2026-09-29):** sign-out never reports a blocked database deletion as done: other tabs are told first (BroadcastChannel, no secrets) and drop the account; every store is emptied in one transaction; the deletion then waits for other tabs (connections close on `versionchange`); a failure is shown to the user. Device storage is suspended between accounts. Queued changes are sent only after checking that the session belongs to the account that queued them, and the server refuses an offline change whose `userId` is not the signed-in account (`409 offline_account_mismatch`, nothing written). Tests: `apps/web/src/offline/cleanup.test.ts`, `packages/database/src/offline-step-changes.test.ts`, `apps/server/src/http/run.test.ts`, e2e second tab.  
**Reviewed:** 2026-09-28

### Security check: image pipeline and releases (Step 10.4)
**Threat surface:** compromised CI actions (e.g. hijacked tags, as with trivy-action in March 2026) exfiltrating the registry token or altering images; publishing unscanned or broken images; tampered images between registry and host; unnecessary tooling (npm, compilers, dev packages) in the runtime image widening the attack surface; license obligations for bundled code.  
**Controls added:** every action pinned to a full commit SHA that was checked to be a verified commit on its default branch (tags are never trusted); scanner version pinned; release only on `vX.Y.Z` tags, after the full CI; per-architecture build → smoke test → Trivy scan → push; least-privilege job permissions (`packages: write`, `id-token: write` only where needed), `persist-credentials: false`; keyless Sigstore signature + CycloneDX SBOM attestation on the index digest, verification documented with an exact identity regexp; runtime image without dev packages, compilers, npm/yarn/corepack; smoke test in the hardened configuration (read-only, no capabilities); third-party notices generated from the actual bundle.  
**Negative tests:** smoke test fails if pruning removed a runtime dependency; Trivy fails on fixable HIGH/CRITICAL; fail-closed and non-root checks per architecture.  
**Secrets/data involved:** `GITHUB_TOKEN` (registry push), Sigstore OIDC token (short-lived) — neither leaves GitHub Actions; no application secrets in CI.  
**Logging review:** no new application logs; the scheduled backup logs its path and counts only.  
**Authorization review:** unchanged application authorization; the release workflow cannot be triggered by pull requests.  
**Open risks:** GitHub-hosted runners and GHCR are trusted infrastructure; `ignore-unfixed` hides vulnerabilities without a fix (tracked through Dependabot base-image updates); builds are not bit-for-bit reproducible.  
**Reviewed:** 2026-09-28

### Security check: branding and instance settings (Step 8.10)
**Threat surface:** non-admins changing server-wide presentation; hiding the AGPL source offer; rate limits that block ordinary page loads (self-inflicted denial of service) or, if widened, the API.  
**Controls added:** `updateInstanceSettings` requires an ACTIVE server admin, re-checked inside the `IMMEDIATE` transaction, audited (`INSTANCE_SETTINGS_CHANGED`); strict body; the setting is public (no secret) via `/api/about`; a hidden footer stays in the HTML and the source URL stays available in `/api/about`; the admin page explains the AGPL obligation for modified versions. The global per-client limit now covers `/api` only (static files never touch the database); every API limit is unchanged, tested.  
**Negative tests:** `apps/server/src/http/account-admin.test.ts` (non-admin 403, unauthenticated 401, missing Origin 403, invalid bodies, in-transaction re-check), `apps/server/src/http/hardening.test.ts` (API still limited).  
**Secrets/data involved:** none.  
**Logging review:** no new log output.  
**Authorization review:** `packages/application/src/settings`.  
**Open risks:** static file requests are no longer rate-limited by the app (a reverse proxy can limit them; they are cheap); operators of modified versions who hide the footer must offer the source elsewhere (documented).  
**Reviewed:** 2026-09-28

### Security check: scheduled Procedures and reminders (Steps 13.4, 13.5)
**Threat surface:** scheduling, reading or starting items of another Workspace (IDOR through schedule/Procedure ids); GUESTs scheduling or starting; history falsified by "automatic" execution; reminders leaking Workspace content (Procedure titles, Workspace names) to people who left the Workspace, were disabled or never had access; reminder links used as a login bypass; duplicate or endless reminders (restart, crash, overlapping runs, retries) — spam; stale reminders after downtime; unbounded items; time-zone confusion (reminders at the wrong time); delivery failures corrupting Procedure/Run truth.  
**Controls added:** `schedule.manage` (USER, EDITOR, ADMIN) via `authorizeWorkspace` plus an in-transaction re-check; reading needs `procedure.view`; starting needs `run.start`; every lookup scoped by Workspace id + item id (route-table test); the Procedure must be a non-deleted Procedure of the same Workspace; an item is never a Run — only Start creates one, in the same IMMEDIATE transaction that closes the item (no Run, audit or Step event is ever created by the passage of time); items are never deleted, identity immutable, closed items final (DB triggers); SCHEDULE_* audit events describe the intention only; strict bodies, calendar dates/24 h times/IANA zones validated in the domain, ≤5 reminders (0–30 days, 1–48 hours), ≤731 days ahead, ≤1000 open items per Workspace, 4 KiB bodies. Reminders go only to the person who scheduled the item, and only if — at send time — the account is ACTIVE, still a member with `procedure.view`, the item still open and the Procedure not deleted. Idempotent delivery: a unique (reminder, channel) row is claimed in a transaction before sending; a processed instant is never stored again when an item is moved back; claims have a 5-minute lease; ≤4 attempts per reminder and channel (1 min, 10 min, 1 h), permanent errors are not retried; reminders more than 24 h late are dropped; the dispatcher never overlaps itself and handles ≤50 reminders per minute. Reminder links are the plain Workspace URL: sign-in is still required, no token. Delivery state lives in its own tables — a failure never touches schedules, Runs or audit events.  
**Negative tests:** `packages/database/src/schedule-use-cases.test.ts` (GUEST, non-member, foreign Procedure/ids, in-transaction guard — mutation-checked, no Run when the date passes, deleted Procedure never started, audit rollback, triggers), `packages/database/src/reminder-dispatch.test.ts` (once per channel also after restart, concurrent dispatchers, interrupted claim only after the lease, bounded retries, permanent failure not retried and history untouched, removed member / deleted Procedure / cancelled item receive nothing, stale), `apps/server/src/reminder-schedule.test.ts` (no overlap, error logging without messages), `apps/server/src/http/schedule.test.ts`, `apps/server/src/http/route-security.test.ts`, `packages/domain/src/schedule.test.ts` (DST).  
**Secrets/data involved:** Procedure titles and Workspace names in reminders (Workspace-confidential, to the scheduler only); email addresses; schedule dates.  
**Logging review:** the scheduler logs counts and error type/code only — never recipients, titles, chat ids or tokens.  
**Authorization review:** HTTP only authenticates and parses; decisions in `packages/application/src/schedules` and `reminders/dispatch.ts` (`mayReceive`).  
**Open risks:** reminders travel through third parties (mail servers, Telegram) and reveal the Procedure title and Workspace name there — documented for users; an at-least-once edge remains: a crash between a provider accepting a message and recording it can repeat that one message (bounded by the attempt limit); any member with `schedule.manage` can cancel or move anyone's item (audited, like Runs).  
**Reviewed:** 2026-09-29

### Security check: notification providers and Telegram (Steps 13.6, 13.7, 13.8)
**Threat surface:** the Telegram bot token (full control of the bot) leaking through responses, logs, errors, backups or the security log; non-admins configuring providers; SSRF through provider URLs; abuse of test messages (spam, mail relay); a leaked pairing link attaching a stranger's chat to someone's account (their reminders then go to the stranger); guessing/replaying pairing tokens; one account confirming another's pairing; spoofed chat names; malicious bot updates (groups, floods, huge payloads); treating Telegram ids as identity.  
**Controls added:** bot token accepted only by an ACTIVE server admin (use-case check + in-transaction re-check), only in a JSON body, format-checked, verified with Telegram (`getMe`) before storing, stored sealed with AES-256-GCM (HKDF from `DATA_ENCRYPTION_KEY`, purpose-bound associated data `notification-provider:TELEGRAM`), never returned (responses show configured/enabled/bot name only), security event `NOTIFICATION_PROVIDER_CHANGED` records "replaced/removed", never the value; the adapter talks only to the fixed host `api.telegram.org` over HTTPS with redirects refused, 10 s timeout, 1 MiB response cap, and maps every failure to a stable code (the URL containing the token is never logged or passed on); plain-text messages only (no `parse_mode`). Test messages go only to the acting admin's own address/chat. Rate limits (persisted, per account): provider changes 20 / 15 min, tests 5 / 15 min, pairing 10 / 15 min. Pairing: 256-bit one-time token (SHA-256 stored), 10 minutes, one open pairing per account, claimed at most once (conditional update), only from private chats, and connected **only after the signed-in owner confirms it** in VMN (showing which chat asked) — a leaked link alone connects nothing, and the owner's own /start then fails visibly; confirmation is bound to the owner's own pairing; chat labels sanitized (no control/format characters, ≤64); Telegram chat ids are addresses, never credentials — no login or authorization uses them; connect/disconnect recorded as `TELEGRAM_CONNECTED/DISCONNECTED`. Polling instead of a webhook (works behind a VPN, no inbound endpoint, no webhook secret to manage); the server polls only while a pairing is open. Email reminders reuse the existing SMTP adapter (text-only, single recipient, no URL/file access). No generic webhook was added (see open risks).  
**Negative tests:** `packages/database/src/notification-use-cases.test.ts` (non-admin / disabled admin, malformed and rejected tokens stored nowhere, sealed at rest, security-log metadata without the token, test messages only to the actor, one-time / expired / group-chat / replaced / cancelled pairings, cross-account confirmation refused, no polling without a pairing, update offset, disconnect stops reminders), `packages/notifications/src/telegram-bot-api.test.ts` (fixed host, no redirects, plain text, error codes, token absent from errors, malformed token → no request), `apps/server/src/http/notification.test.ts` (401/403/Origin on every admin route, token absent from responses, security log and captured server log, rate limit on tests, strict bodies).  
**Secrets/data involved:** Telegram bot token (sealed), pairing tokens (hashed), Telegram chat ids and labels, email addresses.  
**Logging review:** no request bodies are logged; the poller logs claim counts; errors are logged as type + code.  
**Authorization review:** `packages/application/src/notifications/use-cases.ts` (server-admin checks, own-account checks); HTTP only authenticates and parses.  
**Open risks:** whoever holds the database **and** `DATA_ENCRYPTION_KEY` can read the bot token (same trust as TOTP seeds); a user who confirms a chat they do not recognise sends their reminders there; Telegram sees reminder texts; if the bot has a webhook set elsewhere, polling fails (documented). **Generic webhooks / ntfy / Gotify / Web Push are not implemented**: before adding a webhook, design an SSRF policy (https only, DNS resolution checked against private/loopback/link-local ranges at connect time, no redirects, size/time limits, per-admin allow-list) and review it here.  
**Reviewed:** 2026-09-29
