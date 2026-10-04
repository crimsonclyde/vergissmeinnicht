# Architecture

## Selected stack

VergissMeinNicht is a **TypeScript modular monolith** deployed as one application.

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

### Icons
Procedures, Steps, Runs and exported files store **stable VMN icon keys** (`PROCEDURE_ICONS` in the domain, e.g. `freezer`, `power`), never artwork, markup or a library component name. Every icon column references the `procedure_icons` table (a new key = one `INSERT` migration; keys are never renamed or removed, because Run snapshots are immutable). The web app has one registry, `apps/web/src/procedure-icons.tsx`: key → artwork, picker category and English search words; with its generated part it is the only code that imports icon artwork. It has two parts: **hand-written entries** (labels are messages `icon.<key>`, plus icons drawn in Tabler's style in `icon-art.tsx` for household topics Tabler 3.48 lacks — gas, chimney, fan, radiator, boiler, fuse box, valve, shower, sink, dishwasher, roller shutter) and **several hundred Tabler icons generated** by `apps/web/icon-catalog.ts` (`pnpm --filter @vergissmeinnicht/web icons:generate`) from the hand-picked list `apps/web/icon-selection.json` and the `@tabler/icons` metadata (names, tags) into `src/icon-catalog.generated.ts` and the append-only `packages/domain/src/procedure-icon-keys.generated.ts`. The generator refuses unknown Tabler names, clashing keys, reused artwork, bad key formats and — because keys are stored — dropping a key it produced before; a test fails when the generated files are stale. Search ranks icons: label, key and VMN aliases first, Tabler's tags after (`$ignoreTags` removes misleading ones), category names last; an exact name gets a bonus. Artwork comes from [Tabler Icons](https://tabler.io/icons) (`@tabler/icons-react`, MIT, individual named imports so only the offered icons are bundled; the Tabler artwork, generated catalogue and drawn icons form their own `icons` chunk). `<AppIcon name>` renders a key with a shared size and stroke in `currentColor` (every theme colours it) and falls back to a neutral icon for any unknown value (own-property lookup only). Changing the icon library means changing the registry only — stored data stays the same.

### Web text and formatting
User-facing text lives in `apps/web/src/i18n/en.ts` and is looked up with `t(key, params)`; dates are formatted only through `formatDateTime` / `formatTime` (lint-enforced). A translation is a new typed catalog, not a component change. Themes are token blocks selected by `<html data-theme>` (`apps/web/src/theme.ts`): light, dark, memento-mori. Theme and the critical-Step confirmation style (press and hold / tap then confirm) are account preferences (`GET/POST /api/account/preferences`, table `user_preferences`), loaded by `PreferencesProvider`; the browser keeps a copy of the theme for the first paint.

### Testing
- Vitest for unit/integration tests
- Playwright for end-to-end/browser tests
- Independent private database fixtures cloned from real migrated empty-schema bytes; upgrade tests run the migrator directly. CI quality/browser/native-image checks run concurrently behind one fail-closed aggregate gate.

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
  notifications/   (Telegram Bot API adapter; more providers later)
  import-export/   (Procedure JSON v1 and the Procedure archive, 14.3)
  media/           (instruction images: sharp/libvips processing, content-addressed file store, 14.3;
                    document files: validation, previews — MuPDF as WebAssembly in a worker thread —, store, 16.1)
  ui/

docs/
  admin/
  user/
  development/
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

### Account recovery

Recovery (`packages/application/src/recovery`) mirrors invitations: an authorized issuer (server admin with step-up, or the operator CLI) creates a hashed, short-lived, single-use token; the link goes to the account's own mailbox (or the operator's terminal); completion replaces credentials and revokes all sessions and MFA challenges in one transaction. Password changes use the same "replace credential + revoke all sessions atomically, then issue a fresh session" pattern.

### Account status (Step 2.7)

```text
GET  /api/admin/accounts                         server admin: every account (email, status, TOTP on/off)
POST /api/admin/accounts/{userId}/status         server admin + step-up { status, password, code? }
GET  /api/admin/security-events[?before=&userId=] server admin: security log, newest first, 100 per page
POST /api/admin/settings { footerHidden }          server admin: settings of this server (public via GET /api/about)
```

Lists page with keyset cursors (`{ items…, nextCursor }`): the cursor is the id of the last item and is resolved inside the same scope (Workspace, Run, Procedure, filter), so a foreign id is `400 invalid_cursor`, never a position in another list.

Disabling is one transaction: status, all sessions and pending MFA challenges, pending recoveries, pending invitations the user issued, and the security events. It is refused for the admin's own account and while the user is the only ACTIVE Workspace ADMIN anywhere.

### Security events

Account-security events (invitations, account creation, login success/failure, logout; MFA and recovery later) go to the append-only `security_events` table, written in the same transaction as the state change. Run/Step history uses the separate Run AuditEvent model (5.5).

## TOTP security state

TOTP is optional and user-activated in V1. Users enable it from their account security settings (current password required; activation only after a valid code; ten single-use recovery codes are shown once).

```text
POST /api/auth/sign-in (email + password)
  -> no TOTP:  full session cookie
  -> TOTP:     Better Auth's new session is deleted server-side before any cookie is sent;
               client gets {mfaRequired: true} + challenge cookie (Path=/api/auth/mfa, 5 min)
POST /api/auth/mfa ({code} | {recoveryCode}) + challenge cookie
  -> valid:    challenge consumed, new full session issued by Better Auth (server-only plugin)
```

Because no session exists before the challenge succeeds, no Workspace, Procedure, Run, Knot, admin, API or SSE route can be reached in the pre-MFA state; `authenticate()` needs no special case for it.

Whether an account must pass TOTP is decided by one central policy, `requiresTotpChallenge()` in `packages/domain/src/mfa.ts` (currently: "required if the user enabled TOTP"). A later enforcement rule, such as mandatory TOTP for server admins, is a policy change plus an enrollment prompt, not a redesign.

TOTP flows are application use-cases (`packages/application/src/mfa`) on ports implemented in `packages/auth` (`otpauth` for RFC 6238, AES-256-GCM secret box, recovery codes) and `packages/database` (credentials with replay/lock state, hashed recovery codes, challenges). Better Auth's `twoFactor` plugin is not used (see steps.md 2.4). TOTP secrets are encrypted with `DATA_ENCRYPTION_KEY`, which is independent from the cookie-signing `AUTH_SECRET`.

## Workspaces and authorization

A Workspace is the collaboration and security boundary; a Membership maps one User to one Workspace with one role (`GUEST`, `USER`, `EDITOR`, `ADMIN`). Users may belong to several Workspaces. Workspace roles are independent of the server-wide `serverAdmin` flag: a server admin has no implicit access to Workspaces they are not a member of.

```text
HTTP route (apps/server/src/http/workspace-routes.ts)
  -> requireUser                      session -> ACTIVE User
  -> use-case (packages/application/src/workspaces)
       -> authorizeWorkspace(actor, workspaceId, capability)
            Membership read on every call; none -> 404, missing capability -> 403
       -> repository mutation (BEGIN IMMEDIATE)
            re-check actor's current role + ACTIVE status (MembershipGuard)
            change + security event
            >= 1 ACTIVE ADMIN remains, else rollback
```

`packages/permissions` holds the only role → capability table (Workspace: `workspace.view`, `workspace.members.view`, `workspace.members.manage`, `workspace.settings.manage`; Procedures: `procedure.view`, `procedure.edit`, `procedure.restore`; Runs: `run.view`, `run.start`, `run.execute`, `run.abort`; Knots: `knot.manage`; scheduled Procedures: `schedule.manage` (USER and above, 13.4) — matrix in steps.md 3.2) and `canCreateWorkspace` (ACTIVE server admins only; a later admin-board option changes this one function). Use-cases ask for capabilities, never compare role strings.

Workspace API (all session-authenticated, JSON, `Origin`-guarded for POST):

```text
GET  /api/workspaces                                    own Workspaces + role
POST /api/workspaces                                    create (server admin) -> creator is ADMIN
GET  /api/workspaces/{id}                               Workspace, own role, capabilities
POST /api/workspaces/{id}/rename
POST /api/workspaces/{id}/leave                         any member; not the last ACTIVE admin
GET  /api/workspaces/{id}/members                       emails/status only for managers
POST /api/workspaces/{id}/members                       add existing ACTIVE account by email
POST /api/workspaces/{id}/members/{userId}/role
POST /api/workspaces/{id}/members/{userId}/remove
```

Procedures live under their Workspace and are addressed only together with it:

```text
GET  /api/workspaces/{id}/procedures                    procedure.view (all roles), non-deleted
POST /api/workspaces/{id}/procedures                    procedure.edit
GET  /api/workspaces/{id}/procedures/{procedureId}      procedure.view
POST /api/workspaces/{id}/procedures/{procedureId}/update   procedure.edit + expectedRevision + complete sections[]
POST /api/workspaces/{id}/procedures/{procedureId}/delete   procedure.edit (soft delete)
GET  /api/workspaces/{id}/procedures/deleted            procedure.restore
GET  /api/workspaces/{id}/procedures/deleted/{procedureId}  procedure.restore, full soft-deleted Procedure
POST /api/workspaces/{id}/procedures/{procedureId}/restore  procedure.restore, audited
GET  /api/workspaces/{id}/procedures/{procedureId}/history[?after=]  procedure.view, audit events, 500 per page
GET  /api/workspaces/{id}/procedures/{procedureId}/export   procedure.view, canonical JSON without ids
POST /api/workspaces/{id}/procedures/import             procedure.edit, untrusted document
POST /api/workspaces/{id}/procedures/{procedureId}/duplicate procedure.edit, same Workspace only
```

Runs live under their Workspace as well:

```text
GET  /api/workspaces/{id}/runs[?state=ACTIVE|COMPLETED|ABORTED][&before=]   run.view, 200 per page, newest first, with Step counts
POST /api/workspaces/{id}/runs  { procedureId }                   run.start → snapshot
GET  /api/workspaces/{id}/runs/{runId}                            run.view
POST /api/workspaces/{id}/runs/{runId}/steps/{stepId}/state      run.execute { expectedState, state, reason? }
POST /api/workspaces/{id}/runs/{runId}/complete                   run.execute, required Steps DONE or NOT_APPLICABLE
POST /api/workspaces/{id}/runs/{runId}/abort  { reason? }         run.abort
GET  /api/workspaces/{id}/runs/{runId}/history[?after=]           run.view, audit events of the Run, 500 per page
```

Starting a Run copies the Procedure's current definition (title, Sections, Steps with all flags and policies) into `runs` / `run_sections` / `run_steps` inside one transaction. The copy is immutable (DB triggers); Runs are never deleted; only execution state changes: Step transitions (PENDING ↔ DONE / SKIPPED / NOT_APPLICABLE) are compare-and-set on the state the client saw, validated against the snapshotted reason policies, bump the Run `revision` and are audited in the same transaction; a trigger freezes Step state once the Run is not ACTIVE. `audit_events.run_id` identifies the Run for every Run event.

A Procedure is saved as one document: content plus ordered Sections and CHECK Steps. Existing Section/Step ids are kept (they must belong to that Procedure); new items get server ids; the child rows are rewritten on every save, so Runs will snapshot them instead of referencing them. Each save is one `PROCEDURE_UPDATED` audit event with a change summary.

The canonical JSON format lives in `packages/import-export` (`schemaVersion` 1): exports carry only the definition; imports are parsed strictly there and then created through the same use-case as hand-made Procedures.

Workspace content changes are recorded in `audit_events` (append-only, same transaction; Run/Step events join in 5.5). Account and access changes stay in `security_events`.

Workspaces are not deleted by the application; `memberships` and future Procedure/Run tables reference them without cascading deletes.

### Knots (Step 7.1)

```text
/knot/{token}                                          SPA page; resolves after sign-in, then replaces the history entry
POST /api/knots/resolve { token }                      session; → { workspaceId, target: { type, id } } or 404 knot_not_found
GET  /api/workspaces/{id}/knots                        knot.manage, newest first (no tokens)
POST /api/workspaces/{id}/knots { target, label, expiresInDays|null }   knot.manage → { knot, url } (token shown once)
POST /api/workspaces/{id}/knots/{knotId}/revoke        knot.manage, final
```

A Knot is a pointer, not a credential: it names one Procedure or Run of its Workspace, and opening it requires a signed-in member who may view that target. Only the SHA-256 of the token is stored in `knots`; records are never deleted and only a one-time revocation can change them (triggers). Create/revoke are `audit_events` (`KNOT_CREATED`, `KNOT_REVOKED`, subject `knot`).

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

Implementation (Step 6.1):

```text
GET /api/workspaces/{id}/runs/{runId}/events     run.view, text/event-stream
  event: ready   { revision, state }             on every (re)connect, read after subscribing
  event: run     { revision, kind, stepId, by, at }   after each committed change
```

- The use-cases announce committed changes through the `RunChangeNotifier` port; `packages/realtime` implements it as an in-process hub (replaceable by shared pub/sub).
- Events carry no content; the client refetches `GET …/runs/{runId}` when the announced revision is newer than the one it shows (`Run.revision` increases with every change).
- The stream re-checks the session and `run.view` before each event and every 20 s, closes after 15 min, after the Run finished, and on shutdown; finished Runs answer `204`.
- The web client applies its own Step changes optimistically (Step 6.2) but always sends the canonical `expectedState` and falls back to the server state on rejection.

## Home, Schedules, Occurrences and reminders (Steps 13.4–13.13, 14.1–14.2)

The everyday flow is *Procedure or Reminder → optionally schedule it → reminders → Start/Complete → history*. A **Schedule** (series of a standalone **Reminder** or of a **Procedure**) produces **Occurrences** — one per due date, each with its own state and history. A Run exists only after an explicit Start; nothing is executed or marked done by the passage of time. The one-time ScheduledProcedure of 13.4 became a one-time Schedule with one Occurrence (migration 0024, same ids).

```text
GET  /api/workspaces/{id}/home                          procedure.view: Overdue, Today, Upcoming (90 days) + later count, recently done (24 h), Active, Pinned, Recent
GET  /api/workspaces/{id}/calendar?from=&to=            procedure.view: Occurrences due in the range (not cancelled) + projected dates of active fixed series; ≤ 92 days, ≤ 2000 entries (`truncated`)
GET  /api/workspaces/{id}/procedures                    cards: + pinned, lastCompletedAt, active executions, nextOccurrence
POST /api/workspaces/{id}/procedures/{pid}/pin|unpin    procedure.view — personal, not audited
GET  /api/workspaces/{id}/schedules                     procedure.view: active and paused Schedules
POST /api/workspaces/{id}/schedules { kind?, procedureId? | title, description?, recurrence?, date, time?, timeZone, reminders[], assigneeUserId? }   schedule.manage
GET  /api/workspaces/{id}/schedules/{sid}               Schedule + Occurrences (newest first) with their Run links
POST /api/workspaces/{id}/schedules/{sid}/update|pause|end|cancel { expectedRevision, … }   schedule.manage (cancel = end, 13.4 compatibility)
POST /api/workspaces/{id}/schedules/{sid}/resume { expectedRevision, skipElapsed }          schedule.manage
POST /api/workspaces/{id}/schedules/{sid}/skip-older { before, reason? }                    schedule.manage (bulk skip, D1)
POST /api/workspaces/{id}/schedules/{sid}/start         13.4 compatibility: starts the open Occurrence
GET  /api/workspaces/{id}/occurrences/{oid}             procedure.view
POST /api/workspaces/{id}/occurrences/{oid}/complete|reopen|skip   run.execute (Reminders; completing user recorded apart from the Assignee)
POST /api/workspaces/{id}/occurrences/{oid}/start       run.start → normal Run, linked; Occurrence IN_PROGRESS (same transaction)
POST /api/workspaces/{id}/occurrences/{oid}/link-run|unlink-run   run.execute (D7); GET …/linkable-runs (run.view)
POST /api/workspaces/{id}/occurrences/{oid}/move|assign  schedule.manage
```

- **Model** (`packages/domain/src/schedule.ts`): recurrence ONCE / FIXED (every N days, weeks with optional weekdays, months on a day or the last day, years) / AFTER_COMPLETION (N units after the completion or skip date). Fixed dates are always computed from the anchor (`fixedDateAt`), and non-existent dates are clamped to the month's last day — no drift. Dates are calendar dates in the Schedule's IANA zone; wall-clock times use Intl only (DST gap → later, overlap → earlier). Reminder offsets: on the due date / N days / N weeks / N calendar months (clamped) before, at the recipient's reminder time; N hours before a timed Occurrence.
- **Tables** (migration 0024): `schedules` (never deleted; identity immutable; ENDED final), `occurrences` (unique per Schedule and due date among non-cancelled rows — also the generator's idempotency key; never deleted; CANCELLED final), `occurrence_runs` (Run links: started or deliberately linked, at most one current link per Occurrence and per Run, aborted/unlinked ones kept as history), `scheduled_reminders` (per Occurrence and recipient), `reminder_deliveries`, `notification_summaries`.
- **Lifecycle**: Occurrences are OPEN → IN_PROGRESS (linked active Run) → COMPLETED, or SKIPPED/CANCELLED. Reminders are completed and reopened directly; a Procedure Occurrence is completed by its linked Run (Run completion and abort update it inside `RunRepository.finish`'s transaction). Completion-based series create the next Occurrence on completion or skip; reopening withdraws it if nobody acted on it. **Generator** (`advanceSchedules`, every minute before dispatch): the next Occurrence of a fixed series once the latest due date has passed — idempotent, incremental (one per elapsed period, bounded per run), nothing while paused, ended or with a deleted Procedure. Occurrences never count toward the 500-active-Run limit.
- **Calendar read model** (14.4, `occurrencesInRange` in `packages/application/src/home/use-cases.ts`): stored Occurrences by due date (`listDueBetween`, the same rows and view as Home) plus **projected** dates — for every active fixed series the generator would continue (`listFixedSeries`), the dates after its latest Occurrence (`fixedDatesInRange`, the generator's own continuation rule), so a projected date is exactly the date an Occurrence will get and never duplicates a stored one. Projections have no id and no state and cannot be acted on. Completion-based, paused and ended series and series of deleted Procedures are not projected. The web client (`apps/web/src/Calendar.tsx`, `calendar-model.ts`) filters and lays out what the server sent; filters and the Month/Agenda choice live in `localStorage` (convenience only).
- **Responsibility**: optional Assignee per Schedule and per Occurrence (override); reminders go to the Assignee, else the creator; assignment grants nothing.
- **Reminders** (`scheduled_reminders`): one row per (Occurrence, recipient, offset, instant), computed when an Occurrence is created, moved, reassigned or reopened (past instants not created); unsent rows are cancelled — never deleted — on changes, closing or pausing; a processed instant is never stored again.
- **Dispatch** (`packages/application/src/reminders/dispatch.ts`), run every minute by `apps/server/src/reminder-schedule.ts` inside the server process (no queue, no worker; never overlapping):

```text
catch-up summaries due for a retry ──► claim ──► re-check members ──► send / RETRY / FAILED
due reminders (≤50) ──► still allowed? (recipient ACTIVE, member with procedure.view, still the responsible person,
   │                     Occurrence OPEN, Schedule ACTIVE, Procedure not deleted)
   ├─ ≤24 h late (or already being retried): for each channel the server and the person enabled:
   │     claim (reminder, channel) in a transaction ──► send ──► SENT / RETRY (1 min, 10 min, 1 h) / FAILED
   └─ >24 h late (missed, D5): per Occurrence and recipient only the latest missed offset → catch-up;
         earlier ones SUPERSEDED; also superseded when a normal reminder comes within 24 h;
         grouped: one summary per recipient and channel (≤10 listed, "and N more"), claimed like a delivery
```

  Persistent delivery rows with unique logical keys, atomic claims with a 5-minute lease and ≤4 attempts make delivery idempotent across restarts and concurrent workers; success is recorded outside the provider call, so a crash between a provider accepting a message and recording it can repeat that one message (documented; emails carry a stable `Message-ID` per logical key). Texts describe the current due status, never the original offset. Delivery state never touches Schedules, Occurrences, Runs or audit events.
- **Providers** implement `ReminderNotifier` (`channel`, `enabledFor(user)`, `send(user, message)`):
  - **Email**: the existing SMTP `EmailSender` (texts in `email-texts/en.ts`).
  - **Telegram**: `packages/notifications` (Bot API over HTTPS to `api.telegram.org` only). The bot token is configured by a server admin, verified with `getMe`, stored sealed in `notification_providers` (AES-256-GCM, `DATA_ENCRYPTION_KEY`, context `notification-provider:TELEGRAM`) and never returned. Pairing: a 256-bit one-time token (hash stored, 10 min) in a `t.me/<bot>?start=<token>` link; the server polls `getUpdates` every 3 s **only while a pairing is open** (no webhook, works behind a VPN), claims the pairing for the private chat that sent `/start <token>`, and the chat is connected only after the signed-in owner confirms it.
    Two stages, also in the UI (0.2.0-beta.2): the admin page configures only the **instance-wide bot** (it says so, shows "Bot connected: @bot" and a *Next step* pointing to the admin's own `/account#notifications`); each person — the admin included — connects **their own chat** there through the visible sequence Connect → Start in Telegram → waiting → confirm → connected. The admin test message goes to the acting admin's own chat, so the admin page reads the admin's own `GET /api/account/notifications` (label only) and disables the test until that chat is connected. No chat id is ever entered by hand.
  - Future ntfy / Gotify / webhook / Web Push adapters implement the same port (`send(user, { subject, body, key })`); a webhook first needs its own review against the outbound-connection policy (security.md §14).

```text
GET  /api/account/notifications                     own settings: reminder time, email, Telegram (connected / pairing)
POST /api/account/notifications { reminderTime?, emailReminders?, telegramReminders? }
POST /api/account/notifications/telegram/pair|confirm|cancel|disconnect
GET  /api/admin/notifications                       server admin: email + Telegram state (never the token)
POST /api/admin/notifications/email { enabled }
POST /api/admin/notifications/telegram { enabled, botToken?: string | null }
POST /api/admin/notifications/test { provider }     to the acting admin only
GET/POST /api/admin/settings { footerHidden?, recentProceduresLimit? }   Recent 0–20 (default 5)
```

- **Web**: `/w/{id}` is the Workspace Home (Overdue, Today, Upcoming, recently done; filter All / Assigned to me / Shared; refreshed every 30 s while visible), `/w/{id}/history` the completed history (`/w/{id}/runs` still works), `/w/{id}/runs/{runId}` one execution. Start/Schedule live in `StartProcedure.tsx`/`ScheduleDialog.tsx` (also "New reminder" on Home), Occurrence actions in the `MoreMenu` (⋯) disclosure of each Home row.

## Web shell, tools and the Procedure builder (Step 15)

**Shell (`AppShell.tsx`).** One element holds the brand, the Workspace selector, the tool navigation and the Settings menu: a sticky sidebar from 56 rem up, a compact header below — where the four phone destinations move to a fixed bottom bar (`destinations()` is the single list of tools and of the pages each one is "current" for). `data-focus` on the shell hides the global navigation for focused work: `edit` (the builder, every width) and `run` (an execution, phones only). Layout, safe areas (`env(safe-area-inset-*)`, `viewport-fit=cover`) and the bar height (`--tabbar-height`, also used by sticky elements and `scroll-padding-bottom`) are CSS only.

**Routing (`router.tsx`).** Still the History API without a dependency. Sections of Profile & settings and Server admin are addresses (`/account/{section}`, `/admin/{section}`), Workspace settings reuse `/w/{id}/settings`, `/members`, `/knots`; tools add `/reminders[/new]`, `/lists[/new|/{listId}]`, `/more`; the builder is `/procedures/new` and `/procedures/{id}/edit`. Every older address still parses to the same page (pinned in `router.test.ts`). `setNavigationGuard` lets one editor veto leaving: `navigate()` asks it (Workspace switch, links, sign-out), a refused Back/Forward is undone by pushing the shown address again, and the builder adds `beforeunload` for closing or reloading the tab.

**Today, Reminders (`Today.tsx`, `Reminders.tsx`, `Occurrences.tsx`).** Both read the existing `GET …/home` overview; `todayView()` and `remindersView()` are the pure selections (unfinished Runs first, then overdue, then due today; Reminders = standalone Reminders only). Nothing changed on the server for them. Recently used Procedures moved to the Procedures page.

**Procedure builder (`ProcedureBuilder.tsx`, `StepEditor.tsx`, `ProcedurePreview.tsx`, `procedure-draft.ts`).** The draft and every operation on it are pure functions in `procedure-draft.ts` (add, paste preview, duplicate, move, remove, apply, validation, `saveState`, `canSave`): Sections and Steps keep their server `id` through edits and moves, duplicates and new items have none, `key` is only the client's handle. Undo restores the outline as it was before the last operation. The Step editor edits a copy; *Apply step* writes it into the draft, *Save procedure* sends the whole draft through the unchanged create/update routes with `expectedRevision`. There is no autosave and no stored draft. "Dirty" is a comparison of what would be sent with what was last loaded or saved. The preview renders the draft with the execution markup and calls no mutating API.

**Lists (`Lists.tsx`, `list-model.ts`).** See below.

**Theme tokens (`styles.css`).** Roles: `bg`, `surface`, `surface-muted`, `surface-raised`, `border`, `border-strong` (control edges, ≥ 3:1), `text`, `text-muted`, `accent` (primary actions, current destination), `danger` (destructive actions: an outline, never a filled primary), `focus`, `state-*`. Light, Dark and Memento Mori each define every token; `contrast.test.ts` checks the pairs in every theme.

## Lists (Step 15.3)

`List` and `ListItem` (`packages/domain/src/list.ts`) are a small vertical of their own, deliberately not built on Procedures or Runs: no snapshot, no Step rules. Tables `lists` and `list_items` (migration 0026; soft delete on both; a composite foreign key ties an item to its List *and* Workspace). Use-cases in `packages/application/src/lists`, repository in `packages/database/src/list-repository.ts`, routes under `/api/workspaces/{id}/lists`. Capabilities `list.view` / `list.edit`.

Collaboration without a new transport: every write runs in one `IMMEDIATE` transaction, raises the List's `revision` and answers with the canonical List; the page refetches every 10 s while visible and never applies an older revision. Checking is idempotent, editing an item is compare-and-set on the item's revision, renaming on the name the caller saw. The Run SSE hub is Run-specific (channels, limits and re-authorization are per Run) and was not widened for this; a push channel for Lists and Occurrences remains a possible later step. `kind` (`GROCERY`) is the seam for further list types.

## Offline execution (Step 8.5)

```text
online:   GET run ──► show + save (IndexedDB, per user, active Runs only)
offline:  Step change ──► queue (IndexedDB: clientChangeId, expectedState, to, reason, deviceTime)
          reload ──► service worker shell + last user + saved Workspace/Run + queue
online:   queue ──► POST …/steps/{id}/state { …, offline: { clientChangeId, deviceTime } } in order
          server: same rules as online + idempotency (actor, clientChangeId) + plausibleDeviceTime
          → ok / duplicate: remove   refused: remove + explain   401: keep, sign in   unreachable: keep
```

The server remains the only authority: the queue is a list of ordinary requests, the device time is informational (`state_changed_device_at`, audit metadata `deviceTime`), and sign-out deletes the device database. The service worker (`apps/web/public/sw.js`) caches only the app shell.

Hardened in 13.1: a queued change carries the id of the account that made it (`offline.userId`), and the server refuses it under any other session; the client also checks the session's account before sending. Sign-out tells other tabs (BroadcastChannel `vmn-session`, messages tagged with the sending tab so a tab ignores its own), empties every store, then deletes the database — a deletion blocked by another tab is never reported as done.

## Instruction images (Step 14.3)

```text
editor:  photo ──► browser: decode (Safari also HEIC), orient, ≤1600 px JPEG ──► POST …/images (octet-stream, ≤10 MB)
server:  uploadStepImage (procedure.edit) ──► ImageProcessor (sharp: identify, limits, rotate, strip, resize, JPEG ≤500 KB)
         ──► MediaStore.put (/data/media/<xx>/<sha256>.jpg, atomic) ──► ImageRepository.register (IMMEDIATE: guard, dedup, quota)
save:    Step { image: { id, caption } } ──► same-Workspace + still-charged check in the Procedure save transaction
start:   run_steps copy image id + caption (immutable)        serve: GET …/images/:id (procedure.view, Workspace-scoped)
```

Ports (`packages/application/src/ports/media.ts`): `ImageProcessor` and `MediaStore` are implemented by `packages/media`, `ImageRepository` by `packages/database/src/image-repository.ts`. The domain (`media.ts`) owns the limits, the caption rules and the quota choices. Files are immutable and written before their row commits; only housekeeping deletes them (unreferenced for 24 h). Quota usage is computed in the upload transaction (distinct referenced images + recent unreferenced uploads) rather than kept as a counter, so it cannot drift. Backups copy the referenced files into `backups/media` next to the backup files (`packages/database/src/backup.ts`). Offline: images of active Runs are cached in IndexedDB (`images` store) and shown from `blob:` URLs. The Procedure archive (`packages/import-export/src/procedure-archive.ts`) is a ZIP of `procedure.json` (manifest + JSON v1 document) and `images/<n>.jpg`; imports re-process every image (`importProcedureArchive`).

## Document files (Step 16.1)

Independent review (2026-10-03): file registration re-checks the Documents switch in its IMMEDIATE transaction. Preview processing checks it before each page and when registering a derivative. Disabled files remain PENDING with no extra retry attempt or quota charge; resume scans select only enabled Workspaces. The existing hourly/startup scan continues unfinished previews after re-enable. A render already in progress may finish, leaving only unreachable orphan bytes if registration is refused; housekeeping applies unchanged. Upload responses re-check authorization after asynchronous processing.

The foundation under Documents: files. An uploaded file is provisional — removed after 24 hours — until it becomes a page of a Document (16.2, next section).

```text
upload:  POST …/document-files (octet-stream, name in X-File-Name) ──► uploadDocumentFile (document.manage, checked first)
         ──► DocumentFileStore.stage: /data/documents/.staging/<random>, counted + hashed while received (limit cuts it off)
         ──► DocumentFileProcessor.inspect: signature at offset 0 → sharp header (JPEG, PNG, HEIC) or MuPDF (PDF)
         ──► renderPage(0): proves the file can be processed (refused otherwise; a locked PDF and every HEIC are kept without preview)
         ──► commit: rename to /data/documents/<xx>/<sha256>   ──► DocumentFileRepository.register (IMMEDIATE: guard, storage limit, row)
         ──► preview + thumbnail of page 1 stored as derived files ──► PreviewQueue: remaining PDF pages, one at a time
serve:   GET …/document-files/:id            facts (format, pages, preview progress, uploader name)          document.view
         GET …/document-files/:id/original   the unchanged bytes, attachment only, type of the detected format
         GET …/document-files/:id/pages/:n   preview page n (1-based), JPEG      GET …/:id/thumbnail
         GET …/document-files/usage          originals + previews, limit
```

- **Original and derived are different things all the way down.** The original is the staged upload renamed into the store — no code path writes it again. Previews (`document_file_derivatives`: `PREVIEW` per page, one `THUMBNAIL`) are re-encoded, metadata-free JPEGs with their own rows, hashes and routes; they can be deleted and made again. HEIC originals stay HEIC and currently have **no preview**: decoding HEIC needs an HEVC decoder, which is not shipped pending a licensing and patent review (steps.md HT1). They are validated from their container alone (libvips reads it without decoding), stored and downloaded like any other file; the API reports `preview.unavailable: "format"`.
- **Ports** (`packages/application/src/ports/document-files.ts`): `DocumentFileStore` (streaming, content-addressed, staging), `DocumentFileProcessor` (inspect, render a page, thumbnail), `DocumentFileRepository`, `DocumentFilePolicy` (the instance admin's size limit and formats, read per upload). Use-cases in `packages/application/src/documents` (`files.ts`, `previews.ts`); adapters in `packages/media` (`document-file-store.ts`, `document-file-processor.ts`) and `packages/database/src/document-file-repository.ts`. The domain (`document-file.ts`) owns formats, limits, name rules, download names and the storage arithmetic.
- **The PDF parser in a worker thread** (`packages/media/src/document-worker.ts` behind `document-worker-host.ts`): MuPDF is a WebAssembly build, run one job at a time in one `worker_threads` thread that is started on demand, stopped when idle and **terminated** when a job exceeds its time (30 s) — the only reliable way to stop a parser stuck inside WebAssembly. Memory: the module's own memory cannot grow beyond the 2 GiB it declares, the thread's JavaScript heap is capped at 256 MB, and the file being parsed (at most 100 MB) is held once more; that — roughly 2.4 GB for one job, and there is only ever one — is the bound that always holds. On top of it a **watchdog** ends the job when the whole process has grown by more than 1.5 GB since the job began; it polls five times a second from the main thread, so it is best effort and not a limit (a fast allocation, or a busy main thread, gets past it). The server's real ceiling is a memory limit on the container (`deployment.md`). JPEG and PNG stay with sharp/libvips as in 14.3 (two decodes at a time). The thread file is TypeScript run by Node's own type stripping, like the server.
- **Previews in the background** (`createPreviewQueue`): the first page is drawn during the upload; the rest of a PDF (up to 500 pages) by an in-process queue, one file and one page at a time. The to-do list is the `PENDING` state of the file's row, so a restart continues (`resume`, also hourly with housekeeping) without a job table; three failed attempts end in `FAILED`, a full Workspace in `PARTIAL`. One server process is assumed (the monolith), so there is no claiming; a separate worker process would need leases as the reminder dispatcher has them.
- **Storage limit**: document files are charged to the Workspace's combined storage (16.4, below): originals + derived files, identical content once, computed in the inserting transaction.
- **Uploads and timeouts** (`apps/server/src/app.ts`): the server-wide request timeout is 15 minutes for the upload route (`config.slowBody`); a hook keeps the 30-second deadline for every other request, and a connection silent for a minute is closed in both cases. The body is streamed, never buffered; a refused upload is answered while a bounded rest of the body is discarded.
- **Backups** (`packages/database/src/backup.ts`): `backups/documents` holds the files a backup needs as hard links to the live store (a copy where linking is impossible), hashed when they enter it; `verify` and `restore` hash everything; pruning follows the backups, as for images.
- **Connected by 16.2:** the reference rule (`unreferenced` in the repository, mirrored in `copyDocuments`), the Workspace tool switch in front of these routes, audit events when files are added to or removed from a Document, the upload screen with the metadata notice, previews shown in portions.

## Folders, Documents and optional tools (Step 16.2)

```text
GET  /api/workspaces/{id}/tools                         every member: which optional tools are on (also in GET /workspaces and /workspaces/{id})
POST /api/workspaces/{id}/tools { tool, enabled, expectedRevision }  workspace.tools.manage (ADMIN); audited; never touches content
GET  /api/workspaces/{id}/document-folders              document.view: the whole tree (live Folders, with their Document counts)
POST /api/workspaces/{id}/document-folders { name, parentId }                       document.manage
POST …/document-folders/{fid}/rename|move { …, expectedRevision }  ·  /delete  ·  /restore
GET  /api/workspaces/{id}/documents[?q=&folder=&sub=&type=&year=&tag=&uploader=&sort=&dir=&cursor=]   document.view: one page (50) of Documents — see "Finding Documents"
GET  …/documents/filters                                document.view: years, tags and uploader names in use
POST /api/workspaces/{id}/documents { title, folderId, fileIds[], type?, documentDate?, year?, notes?, tags? }
GET  …/documents/{did}                                  the Document with its pages (files) in order
POST …/documents/{did}/update { …, expectedRevision }  ·  /files { fileIds[], expectedRevision }  ·  /delete  ·  /restore
POST …/documents/move { documentIds[], folderId }       all or nothing
GET  …/documents/trash[?within=]                        document.manage: what is in Trash; inside a trashed Folder, what went with it
GET|POST …/document-types  ·  POST …/document-types/{tid}/rename|retire
```

- **Optional tools** (`workspace_tools`, `packages/application/src/documents/tools.ts`): `authorizeTool(actor, workspace, tool, capability)` is the gate of every route of an optional tool — membership, then the switch, then the capability — and repositories check the switch again inside their write transaction. A tool that is off is `404 tool_not_enabled` for everyone. The web shell gets the enabled tools with the Workspace list and adds them to the sidebar and to **More**; the phone bar keeps four destinations (`destinations(workspaceId, tools)`). Further tools add a value to `WORKSPACE_TOOLS`, their routes behind `authorizeTool`, and a navigation entry.
- **Versioned settings** (migration 0035): `GET /tools` and its POST response return `{ tools, revision }`; Workspace detail includes `toolsRevision`. POST requires `expectedRevision`; the IMMEDIATE transaction checks it before a change or no-op and returns 409 on conflict. Actual changes increment revision and write their audit together; a no-op does neither. Existing flags and history are preserved on upgrade.
- **Model** (`packages/domain/src/document.ts`, migration 0028): `document_folders` (a tree by `parent_id`; `name_key` for sibling uniqueness), `documents` (title, optional type — a built-in key or a row of `document_types` —, document date, year, notes, tags; `created_*` = uploaded, immutable; `updated_*` = last modified), `document_pages` (ordered file ids; a file is a page of one Document; this table is what keeps an uploaded file). Folder and Document carry a `revision` for compare-and-set.
- **Tree rules are pure** and shared: placement (cycle, depth, sibling name), restore target and restored name are functions over a list of Folders, used by the repository on the tree it reads inside its `IMMEDIATE` transaction and tested on their own, including a randomised invariant test. A trigger and indexes repeat the essential ones in the database.
- **Trash**: `deleted_at / by` on Folders and Documents. Deleting a Folder marks everything live below it with that Folder's id (`deleted_with_folder_id`), which makes "restore what went with it" exact and leaves what was deleted separately alone. Restoring a part of a trashed Folder moves it to the nearest ancestor that still exists. Nothing is ever deleted by this step (triggers refuse it); permanent deletion and the storage view are 16.4.
- **Repository** (`packages/database/src/document-repository.ts`): one `write()` helper per change — guard, tool, change, audit event — where a refusal rolls everything back. Reads return view records (`FolderRecord`, `DocumentSummary`, `DocumentRecord`, `TrashEntry`) with display names only.
- **Web** (`Documents.tsx`, `DocumentFields.tsx`, `document-model.ts`): addresses `/w/{id}/documents`, `/documents/folders/{fid}` (both with the optional search and filters of 16.3 in the query string), `/documents[/folders/{fid}]/new`, `/documents/{did}`, `/documents/trash`. The view model (paths, tree order, move targets, labels, restore messages, preview notes) is pure and tested; the components load through the API client and refresh by polling (30 s; 3 s while previews are being made). Uploads go file by file through `XMLHttpRequest` (progress, cancel, per-file retry), two at a time; the Add document page keeps nothing but what the server holds provisionally and says so; leaving it with files chosen asks first. Previews are ordinary `<img>` elements of the derived JPEGs, shown five PDF pages at a time; originals are plain download links.

## Finding Documents (Step 16.3)

Search, filters, sorting and paging are a **read model on the `documents` table** — no search service, no virtual table, no second store.

- **Rules in the domain** (`packages/domain/src/document-search.ts`): `foldSearchText` (NFKD, marks removed, lower case, `ß` → `ss`), `parseSearchTerms` (≤ 8 words, ≤ 100 characters), `containsPattern` (a literal `LIKE` pattern), `parseDocumentQuery` (place, type, year, tags, uploader, sort, direction — all validated, sort and direction from fixed lists) and `parseDocumentCursor`.
- **Derived columns** (migration 0029): `title_key`, `tag_keys`, `search_text` hold folded text and are written by the repository together with title, tags and notes. SQL cannot fold, so `runMigrations` calls `fillDocumentSearch` for rows that lack them, and a trigger refuses new rows without them. Four partial indexes (live Documents; Workspace + upload time / last change / document date / title key + id) serve the four orders.
- **Query** (`findDocuments` in `packages/database/src/document-repository.ts`): `workspace_id = ? AND deleted_at IS NULL`, then the filters as bound parameters, one `LIKE … ESCAPE` per search word, `ORDER BY <column>, id` and `LIMIT 51`. Paging is **keyset**: the cursor is `[sort value, id]` of the last row and the next page is strictly after it, so inserts and deletions between two pages neither repeat nor hide a row. Documents without a document date sort last in both directions. The total is counted for the first page only.
- **Why not FTS5** (steps.md HT7): substring matching finds German compounds and two-letter words; a scan of the Workspace's own rows was faster than FTS5 up to the 50 000-Document limit; and an FTS5 index is shared by all Workspaces, which made one Workspace's query time depend on another's content. Recognised text (16.9) is expected to need an index and will be evaluated there.
- **HTTP**: the query string is parsed by a strict schema; the cursor is base64url JSON, opaque to clients. **Web**: `document-model.ts` holds the filters as one value, mirrors it into the address (`?q=…`) with `history.replaceState` — the router itself only looks at the path — and builds the request; `Documents.tsx` shows the find bar, list or grid, chips and "Show more". Answers to superseded requests are dropped.

## Storage, export and permanent deletion (Step 16.4)

```
GET  /api/workspaces/{id}/storage                      workspace.settings.manage: usage by tool, limit, ceiling, own limit
POST /api/workspaces/{id}/storage/limit { bytes|null } workspace.settings.manage: the Workspace's own lower limit (audited)
GET  /api/admin/storage                                server admin: every Workspace with the same figures
POST /api/admin/storage/{id}/ceiling { bytes }         server admin: the ceiling (security log)
GET  …/documents/export/check[?folder=|?document=…]    document.view: how much an export would hold
GET  …/documents/export[?folder=|?document=…]          document.view: the ZIP, streamed (audited, one at a time, rate-limited)
POST …/documents/trash/purge { items[] | all: true }   document.purge (ADMIN): deletes from Trash for good (audited)
```

- **One usage function.** `storageUsageIn` (`packages/database/src/storage-usage.ts`) computes, from the rows, what a Workspace stores: instruction images (charged by the 14.3 rule), Document originals, previews, and Trash; and the limit in force, `min(ceiling, own limit)`. `ImageRepository.register`, `DocumentFileRepository.register` and `addDerivative` call it inside their IMMEDIATE transaction — that is the whole enforcement. `StorageRepository` reads it for the views and writes the two limits. The rules (range, effective limit, the `StorageUsage` shape) are in `packages/domain/src/storage.ts`; `workspaces.image_quota_bytes` is no longer read.
- **Export** is three layers: the domain plans **paths** (`document-export.ts`: `exportSegment`, `planExportPaths` — a title or file name never becomes a path as it is); the use-case (`application/documents/export.ts`) authorises, holds the one-per-person slot, asks the repository for the plan in the transaction that records `DOCUMENTS_EXPORTED`, and hands a `DocumentExport` with lazy `open()` functions to its caller; `packages/import-export/src/documents-archive.ts` renders `metadata.json`, the static `index.html` and the yazl stream. The HTTP route pipes that stream into the response and keeps the slot until the response has ended. Nothing is written to disk.
- **Permanent deletion** (`purgeTrash` in `document-repository.ts`) removes rows only: a Document with its pages, or a Folder with what went to Trash with it, deepest Folder first; other Trash entries inside are re-parented. Files stay until the hourly housekeeping finds them unreferenced and older than the grace period (`purgeUnusedDocumentFiles`, unchanged since 16.1) — so "what may be deleted from disk" still has exactly one definition, shared with backups. Triggers allow `DELETE` on Documents and Folders only for rows in Trash.

## Links and Document versions kept for Runs (Step 16.5)

```
GET  …/documents/{did}/links                    document.view (+ procedure.view): what the Document is linked to, and the Runs that keep a version
POST …/documents/{did}/links { target: { type, id } }     document.manage: link to a procedure | schedule | document
GET  …/document-links?procedure=<id> | ?schedule=<id>     document.view: the Documents linked to that record
POST …/document-links/{lid}/delete              document.manage
GET  …/runs/{rid}/documents                     document.view + run.view: the versions the Run keeps, with their files
POST …/runs/{rid}/documents { documentId }      document.manage: keep the Document as it is now
POST …/runs/{rid}/documents/{id}/remove         document.manage: only while the Run is ACTIVE
POST …/runs/{rid}/documents/{id}/remove-kept { reason, confirm: true }   run.document.remove (ADMIN): from a finished Run, leaving a permanent note
```

- **Links are references** (`links`, migration 0031; HT8 in steps.md): typed ends, a Document on one side, a Procedure, Schedule or Document on the other. Integrity is in triggers — both ends in the Link's Workspace, ends immutable, a Document not deletable while a Link shows it as present. The repository (`packages/database/src/link-repository.ts`) resolves the other end's title and state inside the Workspace; nothing is copied and no access follows from a Link. Use-cases in `packages/application/src/links`.
- **A Run keeps a version**, not a reference: `run_documents` copies the Document's details and `run_document_files` references its (immutable) files, beside the Run and never in the Run's tables; both are immutable by trigger. The file reference joins the one rule for "what may be deleted from disk" (`unreferenced`, `copyDocuments`) and the storage accounting (`storageUsageIn`: *kept for executions*). Kept files are served by the document-file routes.
- **Removal from a finished Run** (P4, migration 0032): `removeFromFinishedRun` writes a `run_document_removals` note (who, when, why — nothing of the document), deletes the version, and deletes the rows of files that nothing else references, all in one transaction; triggers allow deleting a finished Run's version only when its note exists, and never allow changing or deleting a note. Housekeeping removes the released bytes under its unchanged rule.
- **Permanent deletion** calls `markLinksOfPurgedDocuments` in its transaction: the Document's end of each Link becomes "gone" (when, by whom); kept versions stay.
- **Reminders** are not special: "Remind me…" creates an ordinary Schedule through the existing use-case and links it. Schedules stay the only reminder engine, and their messages carry nothing of a Document.
- **Web**: `DocumentLinks.tsx` (the Linked section, the link and "Remind me…" dialogs, `LinkedDocuments` for Procedures and Reminder details, `RunDocuments` for executions); `documents-tool.ts` provides "is the Documents tool on, may the viewer manage" to pages of other tools, so nothing of Documents appears where the tool is off.

## Contacts (Step 16.6)

```
GET  …/contacts?q=&category=&cursor=             contact.view: one page by name
GET  …/contacts/categories                       contact.view
POST …/contacts { name, … }                      contact.manage → { contact, duplicates }
POST …/contacts/duplicates { name, …, exceptId? } contact.view: "possibly the same as …" for a form; changes nothing
GET  …/contacts/{cid}                            contact.view → { contact, duplicates }
POST …/contacts/{cid}/update | delete | restore  contact.manage
GET  …/contacts/trash                            contact.manage
POST …/contacts/trash/purge { contactIds } | { all: true }   contact.purge (ADMIN)
POST …/contacts/import/preview?format=csv|vcard  contact.manage: the file as the raw body → entries, duplicates, problems; saves nothing
POST …/contacts/import { format, contacts }      contact.manage: saves the confirmed entries, all or nothing
GET  …/contacts/export?format=csv|vcard          contact.export: a download
GET  …/contacts/{cid}/procedures                 contact.view + procedure.view
POST …/contacts/{cid}/procedures { procedureId } contact.manage
GET  …/contact-links?procedure=<id>              contact.view + procedure.view: the Contacts of a Procedure
POST …/contact-links/{lid}/delete                contact.manage
GET  …/document-links?contact=<id>               document.view + contact.view: the Documents linked to a Contact (Documents tool)
```

- **Layers:** rules in `packages/domain/src/contact.ts` (normalisation, phone / website / link rules, duplicate keys, search text); use-cases in `packages/application/src/contacts`; `ContactRepository` in `packages/database/src/contact-repository.ts`; the file formats in `packages/import-export` (`contacts-file.ts` decoding, `contacts-csv.ts`, `contacts-vcard.ts`) — pure functions that turn bytes into plain drafts and Contacts into text, with no access to the database; routes in `apps/server/src/http/contact-routes.ts`, which is also where a parser is handed to the use-case (it runs only after authorisation).
- **Tables** (migration 0033): `contacts` (what is shown, plus the derived `sort_key`, `category_key`, `search_text`) and `contact_keys` (one row per email address, phone key and name key — what duplicates are found by). Email addresses and phone numbers are JSON arrays on the Contact: they are always read and written together and never queried by themselves.
- **Duplicates** are a read, not a constraint: `duplicatesOf` looks the keys up within the Workspace among Contacts not in Trash. Nothing is unique and nothing is merged.
- **Import is stateless:** the preview keeps nothing on the server; the browser sends back the entries the person confirmed, and the server validates them like any other input.
- **Links:** the `links` table of 16.5 with two more pairs — Document → Contact (through the Document link routes, with `contact` as a kind of record) and Contact → Procedure (through the Contact routes). Each tool removes only its own Links. `markLinksOfPurged` marks a deleted Contact's end like a Document's.
- **Audit events never hold a Contact's name** — the id and counts only — so that permanent deletion leaves nothing of the person in history that cannot be rewritten.
- **Web:** `Contacts.tsx` (list, Contact page, form dialog, import, Trash, and `LinkedContacts` for the Procedure page), `contact-model.ts` (pure helpers, incl. the second look at links before they are rendered), `ContactPicker.tsx`, `contacts-tool.ts` (is the tool on, may the viewer manage).

## Maintenance (Step 16.7)

```
GET  …/maintenance/board                         maintenance.view: the four statuses, each with its total and newest cards
GET  …/maintenance?q=&status=&category=&contact=&year=&cursor=   maintenance.view: the List, newest first
GET  …/maintenance/filters                       maintenance.view: categories, years, responsible Contacts; currency codes
POST …/maintenance { title, … }                  maintenance.manage → a Planned record
GET  …/maintenance/{id}                          maintenance.view
POST …/maintenance/{id}/update                   maintenance.manage: what the record says — never its status
POST …/maintenance/{id}/status { status, expectedRevision, completedOn? }   maintenance.manage: the only way a status changes
POST …/maintenance/{id}/delete | restore         maintenance.manage
GET  …/maintenance/trash                         maintenance.manage
POST …/maintenance/trash/purge                   maintenance.purge (ADMIN)
GET  …/maintenance/{id}/links                    maintenance.view (+ each end's own view capability)
POST …/maintenance/{id}/links { target: { type, id } }   maintenance.manage: document | procedure | run | schedule
POST …/maintenance-links/{lid}/delete            maintenance.manage
```

- **Layers:** rules in `packages/domain/src/maintenance.ts` (statuses, `statusChange`, cost, filing day, query); use-cases in `packages/application/src/maintenance`; `MaintenanceRepository` in `packages/database/src/maintenance-repository.ts`; routes in `apps/server/src/http/maintenance-routes.ts`.
- **One-way independence:** Maintenance may name a Run, a Schedule, a Procedure or a Document as the far end of a Link; none of those modules knows Maintenance. No code outside the Maintenance repository writes `maintenance_records`, and that repository writes no other domain table — which is what "completion is manual" rests on.
- **`MaintenanceScope`:** computed per request from the other tools' switches and the viewer's capabilities; it decides whether a Contact's name, the Contact filter and Document links exist in an answer at all.
- **The responsible Contact** is a column, not a foreign key: a Contact deleted for good leaves the id behind and the record shows "a deleted contact". A trigger checks it when it is set.
- **Links:** `linkedRecord` in `link-repository.ts` is the one reader of "the record at the other end" for all tools; it now also knows Runs and MaintenanceRecords.
- **Web:** `Maintenance.tsx` (overview with Board and List, record page, dialog, Trash), `maintenance-model.ts`. Drag and drop is the browser's own (HTML drag events with a private data type); the status control is a native select. The "Remind me…" dialog of 16.5 is shared (`RemindDialog` takes the link to make as a callback).

## House management (Step 16) — planned module boundaries

_Planned 2026-10-01; nothing below exists yet. It fixes where the section 16 tools live and what they may depend on, so each step is built into the same shape. Names of packages, files, tables and capabilities are engineering choices and are recorded in each step's completion note; the open technical choices are HT1–HT14 in steps.md 16.12._

**Same shape as before.** The tools are vertical slices through the existing layers, exactly as Lists are (15.3): rules in `packages/domain`, use-cases and ports in `packages/application/src/<module>`, repositories and migrations in `packages/database`, routes in `apps/server/src/http`, pages in `apps/web`. They are modules of the one deployable, not services. New packages appear only for new infrastructure adapters (file parsing, text recognition, mail protocols, outbound connections), never per tool.

```text
                         workspaces · permissions · audit            (existing)
                                        ▲
  tool settings ──► every module asks: is this tool enabled here, may this actor do this?
                                        ▲
  storage ◄── documents ◄── links ──► procedures · schedules · runs   (existing, unchanged)
     ▲            ▲           ▲
     │            │           ├── contacts
  media store     │           ├── maintenance ──► (reminders only through schedules)
  (14.3)          │           └── equipment   ──► (reminders only through schedules)
                  │
        text recognition (derived text for documents; optional)
                  ▲
                mail ──► documents (save a copy / an attachment, as an ordinary upload)
                  └────► outbound connector (security.md §14)
```

Arrows point from the module that knows to the module that is known. Nothing existing learns about the new tools: Procedures, Runs, Schedules, Lists and Today import nothing from them.

| Module | Owns | May use | Must not |
|---|---|---|---|
| **tool settings** (16.2) | which optional tools a Workspace has enabled | workspaces, permissions, audit | hold per-user preferences; delete data when a tool is disabled |
| **storage** (16.4) | the combined Workspace quota and its breakdown by tool, computed in the writing transaction like the 14.3 quota (not a drifting counter) | the image and document repositories | reserve disk space; delete anything when a limit is lowered |
| **documents** (16.1–16.4) | Folders, Documents, ordered files, DocumentTypes, originals and previews, search over metadata, export, Trash for its records | media store and processing (`packages/media`), storage, ZIP writing (`packages/import-export`), tool settings | touch an original after it is stored; reuse the 14.3 image pipeline for originals (previews only); know about Procedures, Runs or Mail |
| **links** (16.5) | typed references between two records of one Workspace; the Document version a Run retains (kept beside the Run, never in the Run tables) | each record type through a small port: "may this viewer read it" and "its title and state" | copy files; read another module's tables directly; grant or imply access; write to Run snapshots or rewrite audit history |
| **contacts** (16.6) | Contacts, CSV/vCard import and export | links, Trash rules, tool settings | become Users or carry permissions; merge automatically |
| **maintenance** (16.7) | MaintenanceRecords, their four statuses, Board and List read models | links, existing schedule use-cases | change a Run, Occurrence or Reminder; be changed by one; compute cost totals |
| **equipment** (16.8) | Equipment | links, existing schedule use-cases | notify by itself |
| **text recognition** (16.9) | derived text per file, processing jobs and their states, rule-based suggestions | documents (reads files, hands back text), a `TextExtractor` port | alter a Document or create anything without a confirmed user action; open a network connection |
| **mail** (16.10, 16.11) | Mailboxes, sealed credentials, cache, send records, remote-action records, saved copies | the outbound connector, documents (through its ordinary upload use-case), links, contacts | use or change the transactional `packages/email` (9.1); send, move or delete without a user action; be reachable through Documents permissions |

**Rules that hold across the modules**
- **Authorisation** stays where it is: HTTP handlers authenticate and parse; every use-case calls the Workspace authorisation with a capability from the one table in `packages/permissions`, plus the tool-enabled check; writes re-check inside the `IMMEDIATE` transaction. A disabled tool and a foreign id both look like an unknown resource.
- **Reminders** are created only by calling the existing schedule use-cases (`schedule.manage`); there is one reminder engine and one dispatcher (13.5, 14.1).
- **Trash** is one rule set (domain) applied by each module to its own records, with one combined Trash read model; permanent deletion removes records, housekeeping releases files once nothing references them. Procedure (4.5) and List (15.3) deletion are not rebuilt on it.
- **Files** have one path in: the document upload use-case (validation, limits, quota, audit). Mail attachments and saved copies use it; nothing writes to the store beside it. Originals are immutable and content-addressed (T1); whether Documents share `/data/media` with instruction images is HT2.
- **Background work** (preview generation, text recognition, mail synchronisation, exports) runs inside the server process: persistent job rows in SQLite, atomic claims with a lease and bounded attempts, bounded concurrency — the pattern of the reminder dispatcher. Jobs survive restarts and never run twice at once.
- **Refresh** uses polling as Lists and Today do; the Run SSE hub is not widened.
- **Outbound connections** to hosts entered through the application go through one connector that implements security.md §14 (resolve, classify, connect to the validated address); no module opens such a connection itself. Mail is its first and, so far, only planned user.
- **Untrusted content** (file contents, extracted text, mail) is data in every module: escaped on output, never executed, never a source of instructions or actions.

**No new infrastructure.** No Redis, no message queue or queue service, no search server, no object storage, no separate worker deployment. Search is SQLite (FTS5 or indexed `LIKE`, HT7). The only optional additional containers the plan allows are a `clamd` scanner (HT6) and, if the evaluation chooses so, a text-recognition container of the same deployment (HT9) — neither may become a required service, and neither is decided. Where the monolith's limits are reached (a 50 MB upload, a 500-page PDF, a large export), the answer is a bound and a queue, not a new service.

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
- local auth -> external identity providers;
- in-process background jobs (reminders, later previews, text recognition, mail synchronisation) -> a separate worker process of the same deployment.

These potential extensions do not justify microservices in V1.

### Optional core tools and Today reporting (17.1–17.2)

All seven implemented tools are Workspace flags. New Workspaces insert none; migration 0036 enables Procedures, Reminders, Lists and Calendar on upgrade and preserves existing house flags. Equipment/Mail are absent until implemented. Today, Workspace selection/membership/settings are structural. Phone navigation retains Today and More and conditionally adds Procedures/Lists (two to four destinations).

`toolForCapability` centralises application defaults; structural and source-aware Schedule operations explicitly override it. Repository actor guards enforce switches in mutation transactions; source-aware SQL filters Schedule/Occurrence reads and generator candidates before limits. Links require both source tools; retained-only Run file access additionally requires Procedures. Calendar controls only its view. Notification workers select/claim canonical enabled source records and reread immediately before sending; mixed catch-up summaries exclude disabled members. Normal queued deliveries and recurrence anchors survive disable. Source reenable marks unprocessed notifications older than 24 hours superseded in the same flag/revision/audit transaction; it never completes or changes an Occurrence. Disabling is not storage reclamation.

`TodayRepository.read` rechecks membership, capabilities and flags in a transaction and computes SQL counts with assignment filters. Occurrence reporting uses each Schedule's local date; the SQLite deterministic `vmn_local_date` function delegates to domain time-zone logic. Run weeks are labelled UTC Monday–Sunday. Only canonical completed states count; unlinked Runs are Shared. Bounded activity queries read ten rows per source, deduplicate linked completed Runs, merge ten, and the UI shows three. A read-only history view reuses the source-aware Schedule endpoint. No materialised metrics, new cache, queue or analytics service.

## Equipment (Step 16.8) and phone contact exports

`packages/domain/src/equipment.ts` owns metadata, validation, folded search/filter keys, cursor and target kinds. `EquipmentRepository` in the application ports is implemented by `equipment-repository.ts`; use cases enforce `EQUIPMENT` and capabilities, routes translate strict transport schemas, and `Equipment.tsx` supplies list/detail/Trash and reviewed Schedule dialogs. Every mutation uses an IMMEDIATE transaction with a fresh actor/tool check and audit event. Migration 0037 adds `equipment_records`, extends the tool constraint and replaces the typed Link integrity trigger without rewriting existing data. Name order uses `(workspace_id, sort_key, id)` keyset paging, 50 records per page; 20,000 live records and 50 source-owned Links per Equipment record bound growth. Notes are bounded to 4,000 characters, line fields to 200 (category 60); serial numbers and notes are excluded from derived search text.

Equipment links to Documents, Contacts, MaintenanceRecords, Procedures and Schedules. Maintenance links back to Equipment and filters by it; either direction appears on both detail pages. `sourceType` lets a page call the owning tool’s unlink endpoint; each repository still removes only source-owned Links. Both source tools gate every Link read/write, and the database refuses foreign ends. Shared linked-record views add Maintenance date/status for chronological history; deleted Contact names never enter Equipment audit history. Permanent deletion marks the Equipment end as gone and never deletes linked records.

Warranty reminders reuse `ScheduleDialog` with reviewed date and offset suggestions. Metadata writes never create or update Schedules. A warranty edit offers a separate explicit Schedule edit using its current revision. There is no Equipment notification worker. Titles generated by Equipment contain its name, never model/serial/notes.

Contacts exports still use the existing authenticated, audited, bounded vCard route. vCard 3.0 uses UTF-8, CRLF, 75-byte folding, escaped text and standard TEL/EMAIL TYPE tokens from a closed mapping, plus custom X-ABLabel groups. This supports address books that ignore Apple-specific labels without placing user input in property parameters. VMN never connects to a phone or a cloud Contacts account.
