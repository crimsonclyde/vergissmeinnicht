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
- [ ] Use a mature maintained authentication library/framework.
- [ ] Never store plaintext or reversibly encrypted passwords.
- [ ] Use Argon2id or a currently recommended reviewed equivalent.
- [ ] Parameter choices are documented and tested.
- [ ] Compare secrets using library primitives designed for the purpose.
- [ ] Login errors do not reveal whether an account exists.
- [ ] Login attempts are rate-limited.
- [ ] Successful login rotates the session identifier.
- [ ] Password changes invalidate relevant old sessions as policy requires.
- [ ] Password values never appear in application logs, traces, analytics, or error payloads.

### TOTP MFA
- [ ] TOTP is built in and user-activated (optional) for V1 accounts; the MFA requirement is evaluated by a central server-side policy so enforcement (e.g. for ADMIN) can be added later.
- [ ] Seed generated with a CSPRNG.
- [ ] Enrollment is not active until the user proves a valid OTP.
- [ ] TOTP seed is treated as highly sensitive data.
- [ ] Submitted OTP values are never logged.
- [ ] Verification attempts are rate-limited.
- [ ] Time-window handling is intentionally bounded.
- [ ] Recovery codes are high entropy.
- [ ] Recovery codes are stored hashed.
- [ ] Recovery code use is one-time and atomic.
- [ ] MFA enable/disable/reset is audited.
- [ ] Enabling TOTP and regenerating recovery codes require recent re-authentication.
- [ ] Disabling TOTP requires re-authentication plus a valid OTP or recovery code.
- [ ] For a TOTP-enabled account, a password-authenticated session that has not passed the TOTP challenge cannot access authenticated app resources.
- [ ] The session is rotated after a successful TOTP challenge.

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

- [ ] Session IDs are opaque and generated with sufficient entropy.
- [ ] Server-side session state is authoritative.
- [ ] Production session cookie is `Secure`.
- [ ] Session cookie is `HttpOnly`.
- [ ] `SameSite` policy is intentional and documented.
- [ ] Cookie Domain/Path are no broader than necessary.
- [ ] Session rotates after login and security-sensitive privilege changes.
- [ ] Logout invalidates server-side session.
- [ ] Idle/absolute expiration policies are documented.
- [ ] CSRF protection covers state-changing cookie-authenticated operations.
- [x] CORS is deny-by-default / narrowly configured. (No CORS plugin registered: same-origin only; any future CORS needs review.)
- [ ] Sensitive responses are not cached publicly.
- [ ] Production uses HTTPS.
- [ ] HSTS enabled when deployment topology makes it safe.
- [x] Content-Security-Policy is defined.
- [x] Clickjacking prevented via CSP `frame-ancestors`.
- [x] `X-Content-Type-Options: nosniff`.
- [x] Strict `Referrer-Policy`, especially around Knot URLs. (`no-referrer` header + meta tag; re-verify when Knot routes land.)

---

## 3. Authorization and ACLs

- [ ] Authorization happens server-side for every protected operation.
- [ ] UI-hidden buttons are never the authorization mechanism.
- [ ] Workspace membership checked for resource access.
- [ ] Role/capability checked for the requested operation.
- [ ] Child resources cannot bypass parent Workspace checks.
- [ ] Object identifiers are opaque but are not treated as authorization.
- [ ] Guest/User/Editor/Admin policies are centrally defined.
- [ ] Cross-Workspace access has negative tests.
- [ ] Horizontal privilege escalation has negative tests.
- [ ] Vertical privilege escalation has negative tests.
- [ ] Membership/role changes are audited.
- [ ] Removing a member invalidates/updates active access promptly.

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
- [ ] Do not accept arbitrary HTML by default.
- [ ] User-selectable icons are trusted icon keys, not arbitrary uploaded SVG/HTML.
- [ ] Apply sensible text/array/file-size limits.
- [ ] Reject malformed UUIDs/tokens/state transitions.
- [ ] Drag/drop order input is validated, authorized, and bounded.

- [x] Emails are normalized (trim, NFC, lower-case) before storage/lookup; uniqueness is enforced on the normalized value by a unique index.
- [x] Display names reject control and bidi override/isolate characters so audit snapshots cannot be visually spoofed.
- [x] Critical invariants (id shape, normalized email, status enum) are also enforced by DB CHECK constraints.
- [x] Validation errors carry stable codes and never echo the rejected input.

### JSON import
- [ ] Treat imports as hostile input.
- [ ] Require/validate `schemaVersion`.
- [ ] Validate full shape before persistence.
- [ ] Reject invalid references/state/type values.
- [ ] Bound input size and collection counts.
- [ ] Do not allow imported IDs to overwrite unauthorized existing records.
- [ ] Import is transactional or fails cleanly.

---

## 6. Audit integrity

- [ ] Important mutations record internal User UUID.
- [ ] Store actor display-name snapshot where historical readability requires it.
- [ ] Store trusted server timestamp.
- [ ] Required state change + AuditEvent are one DB transaction.
- [ ] Normal users cannot edit/delete audit history.
- [ ] Corrections are additive rather than silent rewrites.
- [ ] Audit metadata does not contain credentials/secrets.
- [ ] Procedure deletion cannot cascade-delete historical Runs.
- [ ] Historical Run snapshot remains readable after Procedure change/deletion.

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
- [x] Safe `.env.example` contains placeholders only.
- [x] Structured logging has redaction.
- [x] Request logging avoids sensitive URL/path token leakage. (Knot paths + query strings redacted; add each new token route to the pattern in `apps/server/src/logging.ts`.)
- [ ] Exceptions do not serialize credential-bearing objects. (Config secrets use the `Secret` wrapper; extend to every new credential type.)
- [x] Production debug mode is disabled. (`LOG_LEVEL` debug/trace rejected in production.)
- [ ] Secret rotation process can be documented.
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

- [x] Install scripts only run for allow-listed packages (`allowBuilds`); new entries require review.
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
- TOTP is optional and user-activated, but built in from V1 (not mandatory for now);
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

### Security check: optional user-activated TOTP
**Threat surface:** challenge bypass through API routes, SSE, Knot resolution, stale session, alternate login path; enrollment race; attacker with a stolen session enabling TOTP to lock the owner out; attacker disabling TOTP (downgrade); recovery-code brute force.  
**Controls required:** explicit restricted pre-MFA session state for TOTP-enabled accounts; centralized middleware/policy denies normal resources until the TOTP challenge is satisfied; re-authentication to enable TOTP or regenerate recovery codes; re-authentication plus OTP/recovery code to disable; rate limits; audit events for enable/disable/recovery-code use/regeneration/admin reset.  
**Negative tests:** pre-MFA session of a TOTP-enabled account cannot access Workspace API, subscribe SSE, resolve Knot target details, or call admin routes; cannot promote session via client flag; TOTP cannot be disabled without OTP/recovery code; TOTP cannot be enabled without re-authentication; used recovery code is rejected.  
**Secrets/data involved:** TOTP seed, OTP values, recovery codes.  
**Logging review:** seed, OTP and recovery codes never logged.  
**Authorization review:** MFA gate must be server-side and centralized.  
**Open risks:** accounts that have not enabled TOTP (including ADMIN accounts) are protected by password only — consider an enforcement policy for ADMIN later; future OAuth/OIDC login paths require explicit policy because provider flows may not automatically pass through credential 2FA hooks.  
**Reviewed:** 2026-09-26

### Security check: admin-assisted recovery
**Threat surface:** malicious/compromised admin, privilege abuse, stolen reset token, active-session persistence.  
**Controls required:** explicit ADMIN capability, short-lived single-use recovery flow, audit trail, session invalidation, TOTP credential and recovery codes removed when TOTP is reset.  
**Negative tests:** non-admin cannot initiate; used/expired token rejected; old sessions rejected after reset.  
**Secrets/data involved:** recovery/reset token.  
**Logging review:** reset token redacted.  
**Authorization review:** separate capability from ordinary User/Editor actions.  
**Open risks:** administrative social engineering remains an operational risk and should be addressed in admin UX/docs.

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
