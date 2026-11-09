# AGENTS.md — VergissMeinNicht

This file contains mandatory instructions for all coding agents and contributors, including Codex, Claude Code, and similar tools.

## Release milestone — preserve the special 42nd release

The owner's current milestone count is **57** after publication of **v0.13.2** (2026-11-09), following **v0.13.1** (56, 2026-11-08), **v0.12.1** (55, 2026-11-05), **v0.12.0** (54, 2026-11-05), **v0.11.8** (53, 2026-11-05), **v0.11.7** (52, 2026-11-05), **v0.11.6** (51, 2026-11-04), **v0.11.5** (50, 2026-11-04), **v0.11.4** (49, 2026-11-04), **v0.11.3** (48, 2026-11-04), **v0.11.2** (47, 2026-11-04) and **v0.11.0-beta.1 — A Moment in Time** (46, 2026-11-03). The special 42nd milestone was fulfilled by **v0.9.0-beta.0 — The Curtain Between Worlds** on Halloween; next is the **58th** release. This ordinal is separate from semantic versions, ledger subsection numbers and the number of GitHub Release objects; do not silently replace the owner's count with one of those.

Before preparing any release, check the milestone note in `docs/development/steps.md` and include the next ordinal in the release plan. Preserve the special 42nd release and its dedication in the project history, include the next owner ordinal in future release plans, and update the milestone count after publication. **Milestone fulfilled (2026-10-31): the owner-authorized special 42nd was published on Halloween as “The Curtain Between Worlds”, with the dedication in `docs/releases/0.9.0-beta.0.md`. Celestial was release 43. After v0.13.2 the count is 57 and the next release is 58. Live deployment remains separate.**

### Release naming (settled 2026-11-04)

- Git tag and GitHub release tag: `vX.Y.Z`, with the leading `v`. The release workflow triggers on this tag.
- Everywhere else the version is bare `X.Y.Z`: image `ghcr.io/crimsonclyde/vergissmeinnicht:X.Y.Z`, GitHub release title, `docs/releases/X.Y.Z.md` and the Unraid template.
- GitHub release title: `X.Y.Z — Name` when the owner gives a name; otherwise `X.Y.Z`.
- No `-beta.N` or `-rc.N` suffix for new releases. The next and following releases are `0.n.n`, starting with `0.11.2`. Every stable release moves `0.n` and `latest`. The release workflow still accepts pre-release tags; do not use them.
- Existing `-beta.N` tags, GitHub releases and images stay as published. Never rename or move them.
- The owner's ordinal (milestone count, above) is separate from the semantic version.

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

The app is organised around tools (accepted 2026-10-01, `docs/development/steps.md` section 15): **Dashboard** brings what is actionable together; **Procedures**, **Reminders** and **Lists** each have their own place; the **Calendar** is an optional planning view. Reusable Procedures, scheduled Reminders and lightweight grocery Lists stay conceptually distinct.

House management is an **optional** addition (accepted 2026-10-01, `docs/development/steps.md` section 16; planned in five phases, implemented step by step): the tools **Documents**, **Contacts**, **Maintenance**, **Equipment** and **Mail**. Each is enabled per Workspace by a Workspace admin; a Workspace without them stays fully useful, and no house-specific information is ever required. The Dashboard stays actionable: these tools add no sections to it, except the compact **Maintenance due soon** card (`docs/development/steps.md` 19, T5), and planned maintenance, warranty expiry or servicing reach the Dashboard only as ordinary Occurrences of the existing Schedules. `docs/development/steps.md` 16.12 holds the decisions; read it before any 16.x step and do not reopen what is decided there.

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
- Workspace backup — a portable, versioned `.vmnbackup` package of one Workspace (section 18): allowlisted data, original files, members' name/role/email; never secrets, credentials or other Workspaces
- historical identity — a person kept in restored history (status `IMPORTED`, a reserved `@imported.invalid` address): display name and attribution only; never signs in, is notified, becomes a member, is activated or is matched to an account — enforced by the application **and** the database (CHECK and triggers, migration 0045)
- List — lightweight shared content of a Workspace with items that are checked off; so far only the grocery list
- ListItem — one entry of a List: a title, an optional quantity and unit, purchased or not
- WeatherProvider — an allow-listed forecast source with an endpoint fixed in code (Open-Meteo, MET Norway, OpenWeather, Meteomatics; 19.4)
- provider credential — a sealed secret for a WeatherProvider, server-wide (managed by server admins) or personal (its owner only); never returned or logged

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

**Usability is the second product priority after security** (owner, 2026-11-03). Phone creation flows must be designed for touch and a small viewport; split writing and secondary entry tasks into focused screens, preserve unsaved work between them, and verify actual task completion instead of relying on overflow checks alone.

Desktop authoring and smartphone execution are both first-class.

**Accepted phone entry flow (2026-11-03):** new Notes and personal Journal entries use Title → visual writing → optional Details → explicit Save. Shared icon-based bottom action bars support Back, Next, Save, Cancel and future reviewed actions, with accessible names, safe-area/keyboard clearance and preserved unsaved work. Keep desktop authoring complete. Unsupported source must remain intact rather than pass through a lossy phone conversion. Existing server-confirmed, gated Gamification overlays encourage successful actions; navigation, cancellation and failed saves never award or claim success.

**Accepted phone Procedure authoring (2026-11-03):** Name → Sections/Steps → Review → explicit Save. Add section and Add step belong in the shared bottom action bar; all actions use matching icon-button geometry. Select a Section before adding Steps. Apply local Section/Step drafts before saving the outline; preserve ids, unsaved guards and desktop capabilities.

Color may reinforce state but never be the only state indicator.

Pending should be obvious, Done should include a visual confirmation, and remote collaborator changes should identify the actor/time where useful.

Use semantic design tokens rather than hard-coded theme colors. Light and Dark must offer identical functionality, layout and hierarchy; verify contrast in both (the token test in `apps/web/src/contrast.test.ts`).

Navigation (section 15): a persistent sidebar on desktop (Dashboard, Procedures, Reminders, Lists, Calendar; Workspace on top; one Settings entry at the bottom), four labelled bottom destinations on phones (Dashboard, Procedures, Lists, More). Focused editing hides the global navigation and offers Back. Keep existing addresses working.

Optional tools (section 16): an enabled tool is added to the sidebar below the existing ones and is reached through **More** on phones — the bottom bar keeps exactly four destinations. A disabled tool appears nowhere (no navigation entry, no fields, no prompts) and its routes answer as for an unknown resource; disabling keeps its data. There are no personal preferences for hiding tools.

Today (section 19, accepted 2026-10-07): the Dashboard is a set of cards. Dashboard cards are personal presentation preferences in the Profile (card visible = enabled by the person AND its tool on in the Workspace AND something to show); they are not tool hiding — there are still no personal preferences for hiding tools.

Keep cards concise (title, one line of context, the next action); secondary facts and management actions belong in details or ⋯ menus. Touch targets are at least 44 × 44 px; nothing scrolls sideways from 320 px up. Never claim autosave or draft persistence that does not exist.

Initial modes:

- System
- Light
- Dark

Named presets: `Memento Mori` (8.7), `Tokyo Nights` (`docs/development/steps.md` 24.1: neon arcade scene and gentle motion in `tokyo-nights.css`) and `Witch Forest` (25.1: forest at night, sundial and old-book pages in `witch-forest.css`). A preset may re-arrange presentation and add decoration and motion, but keeps the same controls, order and names; its motion stops under `prefers-reduced-motion`, and text on any surface it paints passes the contrast test.

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

- import of exported data — superseded for exactly the **Workspace backup** package (`docs/development/steps.md` section 18: export by Workspace admins, restore into a new Workspace by server admins; never a merge into an existing Workspace); other exports (Documents ZIP, Contacts) stay one-way;
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
- weather beyond exactly `docs/development/steps.md` 19.4 (optional and personal; provider endpoints fixed and allow-listed in code — Open-Meteo, MET Norway, OpenWeather, Meteomatics; per-person location, provider and model; optional sealed server-wide and personal provider credentials; server-side fetching and caching only; a server-admin switch, no Workspace switch; no automatic paid subscriptions);
- geolocation (also not for weather);
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
- only a Workspace ADMIN exports and only a server admin restores; a Workspace backup contains no secret, credential, token, personal setting or other Workspace's data (a test classifies every table); a restore creates a new Workspace, never touches the source, and either restores everything or nothing; restored originals are byte-identical; restored Schedules start paused and send nothing;
- a restore treats every package as hostile: unexpected, linked, duplicate, oversized or over-compressed entries, a changed byte, a newer version, a malformed record, a reference outside the package and a renamed executable are each refused and create nothing; every restored record has a new id and no source id reaches the new Workspace; a validated restore is confirmed at most once; a historical identity can never sign in, be recovered, invited, added, activated or reminded; the runner never takes the server down;
- restore uploads, previews (with previous members' addresses), the restore limit and the historical-identity list are server-admin only; a restore's files and preview are gone after failure, discard, interruption, expiry or success; a restore mark never outlives its transaction; an export lists rows in insertion order, and export → restore → re-export is equal after the documented normalisation (`workspace-recovery.test.ts`);
- a database migrated by a newer version is never worked on: the server starts no services and reports `database_newer`, `migrate` and server-backup `verify`/`restore` refuse it, and nothing changes it;
- a new column ending in `_id` in an exported table must be classified for restore (foreign key, person, or loose reference in `workspace-restore.ts`) — the restore refuses to run otherwise; a migration that changes an exported table's columns needs an upgrade path for older packages (`isRestorableLevel`).
- a personal provider credential is never readable, usable or overwritable by anyone but its owner, and never reaches another user through a cache; weather tests never call live providers.
- a person's weather history (`weather_history`, 14 local days per place) is never readable by anyone but its owner, is written only from a fresh provider fetch, and is never part of a Workspace backup.

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


## Accepted follow-up — shared optional Workspace location (2026-10-23)

A Workspace admin may set or clear an optional shared geographic location in Workspace settings (Home, another home, Van, Car, etc.). It is visible to all current members, including guests, and included in Workspace backups; it grants no access and never tracks a device or vehicle. Coordinates follow the existing rounded Weather location validation. This narrowly extends section 19.4's personal-only location rule. Each person explicitly opts in per Workspace in Profile → Weather (Workspace-first): the opt-in covers only that Workspace's Today weather and forest moonlight, defaults to off, and their personal location is the fallback; opt-ins are not shared, not backed up and end with membership. Providers, models, units and credentials remain personal/server-scoped as before; the server Weather switch and provider allowlist still apply. No geolocation, new provider, external calendar, live tracking or automatic location updates are approved. Finished Run snapshots, existing schedules and their time zones do not change.

## Accepted follow-up — Moon card and Journal (2026-10-23)

The Moon is an optional Workspace-admin-enabled Today card, off by default, with locally calculated phase/illumination, next full moon and location-based rise/set from the shared Workspace location (no geolocation/provider). Journal is an optional shared Workspace tool: members read, USER/EDITOR/ADMIN write, GUEST read-only. Account-private entries are separate, author-only even from Workspace admins, and excluded from Workspace backups; shared entries are included. Both scopes start with dated text notes, search, explicit Save and reversible archive. Scope never changes in place. A bundled module and versioned entry-type registry provide extension seams; no downloaded code, external plugin execution, attachments, automation or sharing links are approved.

## Accepted follow-up — Open horizon, Equipment and encouragement (2026-10-25)

The owner approved the Open horizon Places design: Munich, Triora, London and Scotland, open landscape defaults and a floating labelled tool dock with one More disclosure. Preserve saved theme identifiers, enabled-tool gates, personal photo/No image choices, focused editing and accessible reduced-motion behavior. Equipment is a shared reference collection with brand/model, searchable compatible replacement parts and optional bounded labelled details; existing Links, roles, Trash and history remain. Private account lifetime points and an original companion may encourage useful actions across the app (section 31). Points are server-awarded, deduplicated, capped, own-account only and excluded from Workspace backups; never permissions, financial rewards, rankings, leaderboards, streak penalties or external analytics. Restored/imported history and historical identities earn nothing. No new Equipment upload path is approved; manuals/photos remain linked Documents.

## Accepted follow-up — named companions and personal menu order (2026-10-25)

Celebrations randomly choose Herr Fuchsky, Count Duckula or Fester Fiesta from the owner's supplied character references. Both ducks have no feet; Count Duckula retains the photo's closed cloak and reserved vegetarian-vampire character, and Fester wears a Mexican charro outfit with sombrero. Personal menu ordering is approved in Profile: Today stays first, More last on phones, every other enabled tool is reorderable. The first two enabled personal choices occupy the phone bar; remaining tools stay accessible through More. This narrowly supersedes the fixed Procedures/Lists phone destinations. Order only: no personal tool hiding, tool activation, permission change or new upload path. The account-wide order is private, excluded from Workspace backups, and must never bypass Workspace tool gates.

## Accepted follow-up — optional unified Gamification (2026-10-25)

Gamification is a bundled Workspace-admin-controlled plugin across all tools (31.4), not a navigation destination. New Workspaces start off; migration 0058 keeps existing Workspaces on. Off stops new points and decorative celebrations, retains earned private lifetime totals and ordinary progress/status/history, and consumes zero-point opaque deduplication marks so later re-enabling cannot reward off-period activity. Private Journal has its own account-only setting, on by default to preserve prior behavior. Random styles are the three approved characters and bottom-up confetti; a bundled renderer registry permits future reviewed styles, never remote code. All rewards remain server-authoritative, scoped in the mutation transaction, capped and deduplicated. No new permissions, rankings, streaks, external tracking, public scores or upload path.


## Accepted follow-up — Bring (section 20, implemented 2026-10-28)

Bring is an optional Workspace tool for short-lived transfer reminders, never inventory, stock, asset ownership, storage-location tracking or logistics. A **BringItem** has a title, optional from/to/due date/assignee/notes, and Open/Completed/Cancelled status. Places are free text, not managed records; completion remembers no object's current location. No quantities, categories, attachments, notifications or offline writes. Every role reads; USER/EDITOR/ADMIN manage. Assignment grants no access; a departed or disabled member is unassigned. Direct deletion has Undo, no Trash. Completed/Cancelled history stays. Workspace backups include the records; restoration clears assignments and earns no points. The Today card obeys personal visibility and the Workspace gate, shows at most three relevant items, and allows authorized Done with Undo. Relevance: overdue or due within seven days, or undated and assigned to the viewer, respecting All/Mine/Shared. Personal menu order includes Bring; disabled routes remain unknown. Required negatives: guest writes, foreign ids, disabled routes for every role, stale revisions, invalid/non-member assignment, membership revocation, audit rollback, backup hostility/round trip, off-period gamification replay and card visibility/relevance.


## Accepted follow-up — everyday themes and README (2026-10-28)

The visible base choices are **System**, **Don't go into the (light)** (stored `light`) and **Memento Mori (dark)** (stored `memento-mori`), followed by the existing Tokyo Nights, Witch Forest and Places themes. The separate Dark choice is redundant: retain persisted/API `dark` as an alias of Memento Mori, including account defaults, Workspace overrides and first paint; do not discard or silently rewrite saved preferences. System follows the new light/dark pair. Keep these two everyday themes restrained: original static line art, token-based readable surfaces and a little character, with the same controls and layout. No new background upload, downloaded assets, processing or permission boundary. Public README screenshots use only fictional local demo data.


## Accepted follow-up — Release 42 Guide interface (2026-10-31)

The owner approved implementing the reviewed one-column Guide prototype and incremental plan. A theme-independent top menu exposes enabled tools in private saved order, with Workspace/account/settings and existing routes preserved; the previous interface remains an explicit private account fallback. The optional Galactic Guide theme uses the approved floating everyday-object direction (fireplace, supermarket, Tesla coil and water pump), contained art/translucent backgrounds, no visible DON'T PANIC/42 marks, and compact opt-in Clock/Weather in the top bar opening larger views. Card background style/opacity and decorative imagery are private account presentation choices; Places retains its own existing per-person/per-Workspace opacity/photo settings. Preserve all themes/aliases, tool gates, focused editing, saved Today choices, offline work, history and security flows. This supersedes navigation placement only; it authorizes no new tool, upload, search/AI service, monitoring or permission. Subsequent owner-authorized Halloween publication is recorded above. This implementation approval does not authorize future automatic releases or live deployment.


## Accepted follow-up — Notes, personal Journal and shared attachments (2026-11-02)

The owner approved implementing the reviewed Journal/Notes integration and explicitly requested a separated,
reusable uploader. Workspace Notes evolves the existing shared Journal; retain stored `JOURNAL` gates,
saved ordering and old addresses, with USER/EDITOR/ADMIN managing and GUEST reading. Personal Journal
remains account-owned, independent of Workspace selection and inaccessible through other users' application
permissions, Workspace search/references or Workspace backups. A versioned, per-user acknowledgement of the
owner's exact unencrypted-Journal notice precedes new personal content, draft or image writes. Preserve all
existing entries as literal legacy text until explicitly converted.

Use shared CommonMark/GFM editing, explicit source preservation, scoped organization, draft recovery,
revision conflicts/history and portable UTF-8 Markdown exports. Shared attachment transport, application,
consumer authorization and storage/processing ports must stay separate. Preserve original upload bytes and
metadata; previews/thumbnails are separate, bounded and regenerable, with original downloads and recovery.
New image defaults are 20 MB/upload and 500 MB/person (decimal), with server-admin settings/overrides and
an optional managed-storage cap. Existing Documents size/format/Workspace policies remain independent.
Charge originals plus retained derivatives; protect concurrent admission with durable reservations and
transaction-time permission/quota rechecks. Restored shared files retain historical attribution but use a
Workspace recovery billing bucket, never a historical identity's personal allowance. Hashes are SHA-256,
private storage facts, never capabilities or public duplicate probes. Physical deduplication and storage
optimization remain deferred. Other tools gain reviewed extension seams, not new attachment fields.
No external processor, remote editor service, AI execution or new identity provider is approved. Portable
Markdown/ZIP import and broader backlink features remain follow-up work after the format/security review.
Preserve Release 42 navigation/themes/fallback, existing files and old supported backups. This approval is
for incremental implementation, not publication or live deployment; next owner-counted release remains 44.


## Accepted follow-up — Recipes and user-task MCP (2026-11-02)

Owner requested a shared Recipes tool with original images and **serving-scaled grocery-list transfer**,
and clarified that MCP should help ordinary users through clients such as Claude: add Procedure Steps,
mark actual RunSteps done, add shopping entries in an authorized Workspace, and turn a meal request into
a saved pictured Recipe and a shopping list for the requested servings. Focus on these user tasks first;
no account/server/Workspace administration, raw SQL/shell, security-setting changes or destructive cleanup.

Use the existing application commands and preserve current capabilities: USER execution does not grant
EDITOR Procedure authoring. Recheck actor, delegation, Workspace/tool/capability and revisions at commit;
use idempotency, atomic required audit and clear results. Never mutate historical Runs while editing a
Procedure. Shared recipe/image infrastructure keeps original bytes/metadata, separate derivatives,
central quotas and backup compatibility. Scaling is server-authoritative and preserves the base recipe;
never silently convert units, guess ambiguous servings or discard an unrepresentable amount.

This narrowly authorizes designing external AI-client access to explicitly granted Procedure/Run context,
Recipes and grocery Lists for these tasks. It does not expose private Journal, Documents/OCR, credentials,
admin/security data or unrelated Workspaces, and does not select a paid provider, stored third-party key,
server-side AI/image-generation service or arbitrary remote image fetching. AI-supplied text is untrusted
content, never authority to widen a grant. Standard MCP stays client-independent; voice belongs to the
chosen client. A real recipe image must come from validated supplied bytes or an explicitly configured
image capability; do not claim a placeholder completes a requested pictured recipe. The detailed design
and implementation gates are in docs/development/recipes-mcp-plan.md and security.md section 36.


### Accepted image-provider follow-up (2026-11-02)

Owner selected OpenAI API image generation using a dedicated project key, with roughly $10 as the initial
budget. This narrowly permits a server-side, explicitly configured Recipe-image generator; use protected
secrets/sealed credentials, bounded model/quality/size, quota/cost admission and idempotent jobs. Never
expose the key to Claude, browsers, logs, source control or Workspace backups. Only recipe image prompts
are sent; Documents/OCR, private Journal and unrelated records remain excluded. Store actual generated
bytes as an original with independent derivatives and clear generated provenance. This is implementation
direction, not authorization to create a subscription, charge an account, expose a public MCP endpoint or
configure a tunnel. Claude Desktop local MCP over the user's tailnet is a proposed connection path;
independent mobile versus a running-desktop bridge remains a product/deployment choice.

## Accepted follow-up — Today instruments and focused Clock/Weather (2026-11-03)

Each person independently chooses Celestial, Clock and Weather in Profile → Today. Among these three,
only Celestial defaults on, and it still requires the Workspace `MOON` gate. Owner correction later the same day: enabled Clock/Weather comes first, then enabled Celestial,
then the continuation hero; preserve other saved choices/order. The owner approved the illustrated combined Clock/Weather
card and authorized implementation, commit/push and release. Both equal halves are whole-picture links;
one selected instrument fills the card, neither selected removes it, and there are no text-link footers. Existing personal/server switches remain; no new
Workspace switches for Clock or Weather. Clock and Weather use
Celestial-compatible contained instruments and dedicated screens, reusing the shared bottom action bar.
Clock includes local Stopwatch/laps and Timer with presets/custom minutes. Timing is account-keyed tab
memory across navigation only, reset on reload/sign-out/close; no alarm/background notification promise,
persistence, reward or new permission. Existing Weather opt-in/server/provider/credential/cache rules
remain; explicitly opening its screen can fetch without enabling its Today tile. No geolocation or new
provider/data source.

Notes and private Journal editing retain a Home action in the shared phone bar and desktop controls.
Home returns to the current Workspace Today (or start-page fallback), keeps the existing unsaved-work
confirmation, is disabled while saving and never saves or awards success merely for navigation.
