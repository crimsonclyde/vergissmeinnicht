# AGENTS.md — VergissMeinNicht

This file contains mandatory instructions for all coding agents and contributors, including Codex, Claude Code, and similar tools.

## Prime directive

**Security is the highest-priority requirement of this project.**

This is especially true for authentication, sessions, MFA/TOTP, authorization, Workspace separation, Knot links, account recovery, external identity providers, audit history, uploaded files, stored third-party credentials and outbound connections.

Never trade security for implementation speed or convenience.

If a requested implementation conflicts with the rules in `docs/development/security.md`, stop and resolve the security design before continuing.

## Mandatory files to read before changing code

Before starting a task, read:

1. `AGENTS.md`
2. `docs/development/steps.md`
3. `docs/development/security.md`
4. any architecture documentation relevant to the task

Do not assume the current code is the complete specification.

## Mandatory completion workflow

When a task is finished, the agent MUST:

1. update the matching entry in `docs/development/steps.md`;
2. record what was implemented;
3. record tests/checks performed;
4. record remaining work or limitations;
5. state whether the task changed the security surface;
6. if security-sensitive behavior was added or changed, update `docs/development/security.md`;
7. add new security checks to `docs/development/security.md` when a new attack surface, credential type, permission boundary, or sensitive data flow is introduced;
8. update other documentation when commands, deployment, architecture, or behavior changed.

A task is not considered complete until its documentation state is updated.

## Product objective

VergissMeinNicht is a general-purpose platform for **repeatable procedures with trustworthy execution history**.

The application must make it easy to:

- define reusable Procedures;
- organize them into Sections and Steps;
- start a historical Run from a Procedure;
- execute that Run collaboratively;
- clearly distinguish Pending, Done, Skipped, and Not Applicable states;
- preserve the actor and timestamp for important state changes;
- preserve historical Runs independently of later Procedure edits or deletion.

It also helps people remember everyday responsibilities and see what needs attention (accepted 2026-09-30, `docs/development/steps.md` section 14). A person must be able to answer at a glance:

- What is due or overdue?
- What is coming up?
- Who is responsible?
- How do I do this correctly?
- Has this occurrence already been completed?

The app is organised around tools (accepted 2026-10-01, `docs/development/steps.md` section 15): **Today** brings what is actionable together; **Procedures**, **Reminders** and **Lists** each have their own place; the **Calendar** is an optional planning view. Reusable Procedures, scheduled Reminders and lightweight grocery Lists stay conceptually distinct.

House management is an **optional** addition (accepted 2026-10-01, `docs/development/steps.md` section 16; planned in five phases, implemented step by step): the tools **Documents**, **Contacts**, **Maintenance**, **Equipment** and **Mail**. Each is enabled per Workspace by a Workspace admin; a Workspace without them stays fully useful, and no house-specific information is ever required. Today stays actionable: these tools add no sections to it, and planned maintenance, warranty expiry or servicing reach Today only as ordinary Occurrences of the existing Schedules. `docs/development/steps.md` 16.12 holds the decisions; read it before any 16.x step and do not reopen what is decided there.

**Not planned (owner, 2026-10-06):** the **Mail** tool (16.10, 16.11) — the effort and attack surface are not worth it; mail attachments reach Documents by ordinary upload. A small import of saved `.eml` files into Documents is a possible later step (no mailbox connection, no stored credentials). Mail-related rules below stay as constraints should it ever be revived. Also not planned: completion photos, required photo evidence and annotations (14.5), and external identity providers (2.6).

Do not turn it into a generic project-management suite or an enterprise workflow engine.

## Security rules

The full security policy is in `docs/development/security.md`; it is normative.

At minimum:

- all authorization is enforced server-side;
- client-side role/UI checks are never treated as security boundaries;
- never invent cryptography;
- use established authentication/security libraries;
- local passwords must use a modern password hashing scheme such as Argon2id with reviewed parameters;
- session cookies must be Secure, HttpOnly, and appropriately SameSite in production;
- state-changing cookie-authenticated requests need CSRF protection;
- rotate sessions on login and privilege-sensitive changes;
- rate-limit login, MFA, recovery, and other sensitive endpoints;
- secrets and credentials must never be committed or logged;
- database queries must be parameterized / safely generated by the selected DB layer;
- sensitive operations require negative authorization tests;
- authentication must support optional, user-activated TOTP (built in from V1; not mandatory for now);
- architecture must permit future Apple and GitHub login (planned; Microsoft possible) without making an external provider the primary internal user identity.

### Identity model

The system has a stable internal User UUID.

Authentication methods are linked identities/credentials belonging to that internal User.

Future Apple/GitHub/Microsoft sign-in must map to this internal identity and must not create insecure implicit account linking.

### Knot links

A Knot uses an opaque high-entropy token at:

`/knot/{token}`

The token is sensitive, must not appear in query parameters or logs, should be stored hashed where practical, and does **not** replace authentication under the current design.

The server must still verify the authenticated user and their authorization.

## Architecture

Use a **modular monolith** unless an accepted architecture decision says otherwise.

Conceptual layers:

- Presentation
- Application
- Domain
- Infrastructure

Domain logic must not depend on the UI framework, database engine, or realtime transport.

Avoid giant controllers, components, service classes, or generic helper dumping grounds.

## Core domain vocabulary

Use these terms consistently:

- User
- Workspace
- Membership
- Procedure
- Section
- Step
- Run
- RunStep
- AuditEvent
- Knot
- Reminder — a standalone obligation without a Procedure (e.g. "pay the annual tax")
- Schedule — a series that produces Occurrences of a Reminder or a Procedure (one-time, fixed calendar, or after completion)
- Occurrence — one dated instance of a Schedule with its own status and history
- Assignee — the optional responsible member of a Schedule or Occurrence; assignment grants no access
- List — lightweight shared content of a Workspace with items that are checked off; so far only the grocery list
- ListItem — one entry of a List: a title, an optional quantity and unit, purchased or not

House management (section 16; a term is in use once its step is implemented):

- Folder — a named, nestable place for Documents
- Document — one record (title, dates, type, tags, notes) holding one or more ordered files, shown as pages
- original — the uploaded file, kept byte-for-byte including embedded metadata
- preview / converted version — derived from an original, metadata-free, never called or served as the original
- DocumentType — bill, receipt, contract, …; built-in or managed by the Workspace
- Trash — where deleted house-management records stay until a Workspace admin deletes them permanently; no automatic expiry
- Link — a reference between two records, never a copy; a Link grants no access
- Contact — a person or organisation of the Workspace; not a User, grants no access
- MaintenanceRecord — planned or done work with one of four statuses: Planned, In progress, Completed, Cancelled
- Equipment — an appliance or installation of the house
- Mailbox — a mail account connected to a Workspace; its messages are *live* (at the provider), *cached* (temporary, never an archive) or a *saved copy* (explicitly retained in VMN)

A List is neither a Procedure nor a Run: nothing is started, and it has no Required, Critical, Skip or Not Applicable.

A Schedule of a Procedure never creates Runs by itself: only an explicit Start does. Completing one Occurrence never completes another.

Schedules are the only reminder engine: no house-management tool notifies by itself. Completing a Run never completes a MaintenanceRecord, and completing a MaintenanceRecord never touches a Run, an Occurrence or a Reminder.

### Procedure vs Run

A Procedure is an editable reusable definition.

A Run is an execution snapshot.

Starting a Run must snapshot enough Procedure/Section/Step data that historical Runs remain readable and truthful after the original Procedure is edited or deleted.

Deleting a Procedure must never cascade-delete historical Runs.

## Roles and authorization

Initial Workspace roles:

- `GUEST`
- `USER`
- `EDITOR`
- `ADMIN`

Prefer centralized policy/capability evaluation over scattered role string checks.

## States

Run states:

- `ACTIVE`
- `COMPLETED`
- `ABORTED`

Step states:

- `PENDING`
- `DONE`
- `SKIPPED`
- `NOT_APPLICABLE`

Skipped and Not Applicable are semantically different.

Skip / Not Applicable reasons may be disabled, optional, or required by the Procedure definition.

Undo/revert actions must be supported and auditable.

## Audit requirements

Important state changes must identify:

- event UUID;
- Run UUID;
- affected object;
- event type;
- actor internal User UUID;
- actor display-name snapshot where useful;
- timestamp;
- relevant transition/reason metadata.

State mutation and required audit-event creation must be atomic.

Do not silently rewrite historical audit events.

## Collaboration

Multiple authorized users may work on the same active Run.

The server/database remains authoritative.

Normal authenticated API requests perform mutations. A realtime transport may fan out canonical updates to connected clients.

Clients must recover after disconnect by refetching canonical Run state.

Do not add Redis/Kafka/message queues merely because realtime exists.

## UI/UX

Desktop authoring and smartphone execution are both first-class.

Color may reinforce state but never be the only state indicator.

Pending should be obvious, Done should include a visual confirmation, and remote collaborator changes should identify the actor/time where useful.

Use semantic design tokens rather than hard-coded theme colors. Light and Dark must offer identical functionality, layout and hierarchy; verify contrast in both (the token test in `apps/web/src/contrast.test.ts`).

Navigation (section 15): a persistent sidebar on desktop (Today, Procedures, Reminders, Lists, Calendar; Workspace on top; one Settings entry at the bottom), four labelled bottom destinations on phones (Today, Procedures, Lists, More). Focused editing hides the global navigation and offers Back. Keep existing addresses working.

Optional tools (section 16): an enabled tool is added to the sidebar below the existing ones and is reached through **More** on phones — the bottom bar keeps exactly four destinations. A disabled tool appears nowhere (no navigation entry, no fields, no prompts) and its routes answer as for an unknown resource; disabling keeps its data. There are no personal preferences for hiding tools.

Keep cards concise (title, one line of context, the next action); secondary facts and management actions belong in details or ⋯ menus. Touch targets are at least 44 × 44 px; nothing scrolls sideways from 320 px up. Never claim autosave or draft persistence that does not exist.

Initial modes:

- System
- Light
- Dark

`Memento Mori` is reserved as a likely named dark theme.

## Data and persistence

SQLite is the initial DB.

Required from the beginning:

- schema migrations;
- foreign keys;
- transactions;
- safe query parameterization;
- backup/restore documentation;
- WAL where appropriate.

Use opaque non-sequential public identifiers.

## Scope discipline

Do not add without an accepted requirement:

- AI features — superseded for exactly optional AI-assisted suggestions on VMN's own infrastructure, disabled by default, planned after text recognition (`docs/development/steps.md` 16.9); they need their own detailed plan and scope entry here before any implementation, and external processing is neither a default nor an approved option;
- chat;
- calendar features beyond the accepted calendar/agenda view of Occurrences (no external calendar sync, no drag-and-drop planning);
- notification channels beyond the accepted email and Telegram reminders;
- photos beyond the accepted instruction image per Procedure Step (`docs/development/steps.md` 14.3); completion photos, required photo evidence and annotations are not planned (14.5, owner 2026-10-06);
- other attachments — superseded for exactly the accepted house-management tools Documents, Contacts, Maintenance, Equipment and Mail (`docs/development/steps.md` section 16), each only as specified in its step; a Run retaining the Document version linked to it (16.5) is not approval of completion photos;
- list types beyond the accepted grocery list, list categories, or links between Lists and Schedules or Documents (`docs/development/steps.md` 15.3);
- Kanban or other boards — superseded for exactly the Maintenance status board with its four fixed statuses (`docs/development/steps.md` 16.7); no boards elsewhere, no custom columns, swimlanes or limits;
- per-folder permissions, or personal preferences for hiding tools;
- automatic payments or financial decisions, cost totals, budgets or charts;
- automatic sending, replying, forwarding or filing of mail, mail rules, or automatic permanent deletion or expunging of remote mail;
- mail servers on a LAN, VPN-only or private addresses; any outbound connection to a user-chosen host before the outbound-connection policy in `docs/development/security.md` covers it;
- text recognition or any other processing of Documents or mail outside VMN's own infrastructure;
- geolocation;
- QR/NFC;
- complex branching workflows;
- distributed infrastructure (also no Redis, queue service or search server for section 16);
- Kubernetes;
- analytics dashboards.

Product points that touch privacy, permissions, destructive behaviour or scope are decided by the user, never silently by an implementation (none open: P6–P7 lapsed with Mail not planned, `docs/development/steps.md` 16.12).

Design extension seams, but do not implement speculative systems.

## Testing

Security rules require negative tests.

Examples:

- USER cannot edit a Procedure;
- Workspace A user cannot access Workspace B data;
- revoked/expired Knot fails;
- TOTP-enabled account cannot bypass the TOTP challenge;
- incomplete required Steps prevent Run completion;
- Procedure deletion leaves historical Runs intact;
- state transition and AuditEvent commit atomically;
- completing one Occurrence never completes another, and fixed recurrence never drifts;
- reminders are delivered at most once per logical key across concurrent workers and restarts, and outage catch-up never floods;
- assignment never grants access;
- instruction images require Workspace authorisation;
- GUEST cannot change a List, and a List or item id of another Workspace resolves to nothing;
- a tool that is not switched on in a Workspace answers like an unknown resource on every one of its routes, for every role, and switching it off deletes nothing;
- editing or moving a Step in the Procedure builder keeps its id, a duplicate gets a new one, and an outline is never saved while a Step has unapplied changes.

House management (section 16; each applies from the step that implements it):

- a Workspace A member cannot read, preview, download, search, export or link a Document of Workspace B;
- a GUEST can view, download and bulk-export Documents but cannot upload, edit, move or delete one, and a GUEST's export contains nothing from Mail or other content they cannot access;
- a Link never reveals a record the viewer cannot read;
- a renamed executable or HTML file is refused as a Document;
- an original downloads byte-identical to its upload;
- moving a Folder into its own descendant is refused;
- only a Workspace admin can permanently delete from Trash;
- a Run still shows the Document version linked at the time after the Document is edited or permanently deleted;
- only a Workspace admin can remove a Document version from a finished Run, only with a reason, and the removal note holds nothing of the document;
- a GUEST sees Contacts but cannot change, import or export them, and a Contact id of another Workspace resolves to nothing;
- a Contact import saves nothing before it is confirmed, and saves exactly what was confirmed;
- a Contact’s name never appears in audit history, and a deleted Contact is never named on a linked record;
- a `javascript:` website or a formula-like name does no harm in the UI or in an export;
- completing a Run never completes a MaintenanceRecord;
- a MaintenanceRecord changes status only on a request of someone who may manage it, a stale request is refused, and Cancelled never carries a completion date;
- a GUEST sees MaintenanceRecords including costs and cannot change one; no answer ever holds a sum of costs;
- text-recognition results follow the source Document's permissions;
- a GUEST has no Mail access;
- mail credentials never appear in responses or logs;
- a retried Send never sends twice.

## Documentation

`docs/development/steps.md` is the project execution ledger.

`docs/development/security.md` is the authoritative security checklist/policy.

Keep both current.

## Accepted follow-up — section 17 (2026-10-02)

Documentation now lives in `docs/admin`, `docs/user` and `docs/development`. Section 17 of the ledger records the accepted changes; 17.1–17.4 are implemented and released in 0.5.0-beta.3 (2026-10-04). Workspace admins choose all implemented functional tools, all off for new Workspaces; Today, selection and settings remain structural. This supersedes fixed core navigation and exactly four phone destinations when tools are disabled. Preserve existing Workspace flags and available core tools on upgrade. Today includes compact progress statistics and recent accomplishments alongside actionable items; this narrowly supersedes “actionable only” and the analytics exclusion for those measures, with no cost charts, rankings or external analytics. Read 17.1–17.2 before implementation; server gates and workers must enforce tool settings and aggregate access.
