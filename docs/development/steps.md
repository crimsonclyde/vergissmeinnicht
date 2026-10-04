# Project Steps & Objectives

This file is the authoritative implementation ledger for VergissMeinNicht.

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

**Released 2026-10-04: 16.8 Equipment and phone-compatible Contacts export**, explicitly requested by the owner, published as **v0.5.0-beta.4** after fix/review/test/commit/push. PR #16 merged as `1012613`; PR CI, main CI and tagged release workflow all passed. GitHub prerelease: https://github.com/crimsonclyde/vergissmeinnicht/releases/tag/v0.5.0-beta.4. Image `ghcr.io/crimsonclyde/vergissmeinnicht:0.5.0-beta.4` has amd64/arm64 manifests, workflow signing and CycloneDX attestation. Equipment is off until enabled by a Workspace admin; upgrade includes migration 0037 (38 migrations, 0000–0037). Nothing was deployed to the running Unraid installation; owner-provided untracked assets remain preserved.

**Next:** manual beta.4/upgrade checks on the owner’s installation and physical iPhone/Android .vcf imports. Next product phase is 16.9, still TODO and untouched; P5 plus HT9/HT10 must be settled before implementation. No OCR/AI/Mail work is authorised by the 16.8 implementation. Section 16.8 records the remaining limitations; section 12.23 records release evidence.


**Released 2026-10-04:** PR #15 merged as `799bb70`; **v0.5.0-beta.3** publishes 17.1–17.4: all seven implemented Workspace tools optional, scoped Today progress, reviewed actual-app screenshots, tool/file/notification fixes, patched runtime PCRE2 and faster CI/fixtures. Main CI and the tagged release workflow passed. GitHub prerelease: https://github.com/crimsonclyde/vergissmeinnicht/releases/tag/v0.5.0-beta.3. Owner-provided mock-ups/screenshots are preserved. The original pause handoff is historical. Nothing was deployed to the running Unraid installation. 16.8 has since been implemented; Phase 4 (16.9) still requires P5 and technical evaluations before implementation.

**Latest accepted update (2026-10-02):** documentation reorganisation done (17.0). All-tool Workspace switches (17.1), scoped Today progress (17.2) and actual demo screenshots (17.3) are implemented on the review branch. These requirements supersede the older fixed-navigation/action-only rules as stated in section 17.

**Independent review (2026-10-03, completed on review branch 2026-10-04):** dedicated branch `development/optional-tools-review`, based on main after documentation PR #8 merged. Existing untracked mock-ups and screenshots are preserved. Confirmed and fixed: a Document upload could register metadata and consume quota after Documents was disabled during processing; registration now checks the switch inside the same IMMEDIATE transaction as the role and quota. The new regression failed before the fix (successful upload, 1277 bytes charged) and passes after it; the complete document-file use-case suite passes (20 tests). Orphan bytes from a refused staged upload remain subject to existing housekeeping, never become a visible file. Security impact: closes a tool-boundary race; no new capability or data flow. The additional verified fixes, broader checks and steps 17.1–17.3 are recorded below; this single regression is not whole-app security certification.

Second confirmed finding: Maintenance evidence links exposed a trashed Document's title and the deleting actor to a GUEST, bypassing the ordinary Document-link visibility rule. `listMaintenanceLinks` now strips both values unless the current role has `document.manage`. The regression failed before the fix with `Invoice 2026` / `Uma`, and passes after it; an admin still sees the title. No stored links or history are rewritten. Security impact: closes a cross-tool disclosure. Baseline checks after the upload fix: 138 Vitest files / 1121 tests passed; typecheck and lint passed; Playwright 3 passed, 1 intentionally skipped (the mobile project skips the long account flow; desktop flow includes responsive checks); dependency audit: one moderate advisory, no high/critical advisories.

Third confirmed finding: queued PDF previews ran through tool disable and added to quota. The preview queue now checks the switch before each page and inside the derivative transaction; disabled files stay PENDING without consuming attempts, resume scans omit disabled Workspaces, and re-enable restores the existing continuation. A render already in flight may finish, but its derivative is not registered while disabled. The regression failed before the fix (READY / one attempt) and passes afterward (PENDING / zero attempts / unchanged quota, then READY on re-enable and resume). Upload metadata is re-authorized before responding. Security impact: closes a background-processing tool-boundary gap. No original, history, stored link or membership is rewritten.


_Last updated: 2026-10-02 (0.5.0-beta.2 released from `main`: section 16 through 16.7 — links, Contacts, Maintenance; before it 0.5.0-beta.1: Phase 1 — Documents)_

**Done:** 0.1, 0.2, 0.3, 1.1, 1.2, 2.1–2.5, 2.7–2.9, 3.1–3.3, 4.1–4.5, 5.1–5.7, 6.1, 6.2, 7.1, 8.0–8.11, 9.1, 10.1–10.5, 11.1, 12.1–12.14, 13.1–13.19, 14.0–14.4, 12.15, 12.16, 13.20, 12.17, 12.18, 15.0–15.4, 12.19, 16.0, 16.1, 16.2, 16.3, 16.4, 12.20, 16.5, 16.6, 16.7, 12.21. DEFERRED: 2.6 (external identity providers — a later step, user decision 2026-09-28).
**Next:** section 16 — 16.0 (instruction files, `security.md` §14), 16.1 (document files: store, upload, validation, previews, backups; migration 0027) and **16.2** (Folders, Documents, Trash, document types, the Workspace tool switch and the Documents screens; migration 0028) and **16.3** (Recently added, search over titles, notes and tags, filters, sorting with a labelled date, cursor paging, list and grid; migration 0029; HT7 settled: a folded search column with `LIKE`, no FTS5) and **16.4** (one combined storage limit per Workspace with a breakdown by tool — replaces the image quota D11a —, the Workspace's own lower limit, the server admin's ceiling and file settings pages, ZIP export for every member incl. guests, permanent deletion from Trash by a Workspace admin; migration 0030) are done and committed (`c1dcdc0`). **Phase 1 (Documents) is complete.** Phase 2: **16.5** (links between Documents and Procedures, Reminders and Runs; a Run retains the linked Document version; "Remind me…"; migration 0031; HT8 settled) is done (released in 0.5.0-beta.2). **P4 was decided by the owner on 2026-10-02 and is implemented** (migration 0032): a Workspace admin may remove a Document version kept by a finished Run — confirmed, with a reason — leaving a permanent removal note and an audit entry; while a Run is ACTIVE the ordinary removal applies as before. **16.6** (Contacts: the second optional tool — people and organisations with call / write links, search, possible duplicates, CSV and vCard import with a preview, export, Trash and links to Procedures and Documents; migration 0033) is done as well, and so is **16.7** (Maintenance: the third optional tool — records with the four statuses Planned, In progress, Completed and Cancelled, a board with drag and an accessible status control, a List with filters, manual completion only, links to Documents, Procedures, Runs and Reminders; guests read everything incl. costs — P3 for Maintenance; migration 0034). Next is **16.8** (Equipment); P3 is resolved for it (guests see everything incl. costs and serial numbers, read-only). 16.1 and 16.2 are one unit for release. HEIC previews are deferred pending a licensing / patent review (owner's decision, HT1): HEIC files are stored and downloadable and show "Preview unavailable for this format". The container memory limit is 4 GiB by default and the Unraid template restarts the container unless it was stopped (owner's decisions; validated with `deploy/memory-check.sh` — three runs, peak about 2.9 GB — and `deploy/restart-check.sh` on the development machine; **both still to run on the Unraid host before release**). Independently: beta test of 0.4.0-beta.1 (needs migration 0026 applied: `migrate` as usual) on real phones (bottom bar, safe areas, on-screen keyboard in the builder and Step editor, grocery list in a shop). Open from section 15: see 15.4 "Remaining". Still open from before: beta test of 0.3.0-beta.4 (calendar and agenda, also on a real phone); 14.5 later; the rest of the real-iPhone photo matrix (see 14.3 Remaining); upgrade of real data not yet confirmed; beta feedback on the icon catalogue (12.11, 12.13); GHCR package visibility, a session with a real screen reader, physical iOS/Android devices (incl. offline storage eviction), and automate GitHub Release creation in the release workflow. Possible next providers: ntfy/Gotify or a webhook — each needs its own review against the outbound-connection policy (security.md §14), which allows public addresses only.

**Handoff after 0.5.0-beta.2 (2026-10-02) — work paused here by the owner until it is taken up again.**
- **State:** `main` = tag `v0.5.0-beta.2` plus the commit that records this; nothing is uncommitted; nothing was deployed to the running Unraid installation.
- **Released:** section 16 through 16.7 — Documents (0.5.0-beta.1), links incl. P4, Contacts, Maintenance. 35 migrations (0000–0034).
- **Next step: 16.8 Equipment.** Not started. **P3 is resolved for it:** a GUEST sees everything of Equipment, including costs and serial numbers, read-only; manage = USER and above; permanent deletion = ADMIN. No open product point blocks 16.8. Things 16.8 is expected to bring along because 16.7 left them for it: the Equipment link on a MaintenanceRecord and the Equipment filter of the Maintenance List.
- **Open product points:** P5–P7 (16.12), none before Phase 4.
- **Choices made while implementing that the owner has not confirmed** (each listed in its step): Contacts — history holds no names; a Contact in Trash is unnamed on linked records; "similar name" = same words in any order; notes and addresses are not searched; first address only from a vCard. Maintenance — categories are free text, not a managed list; fifty cards per column; the completion date defaults to today and the screens do not ask for another day.
- **Validation still owed (none of it has evidence yet):** this release and its upgrade on the Unraid host, with `deploy/memory-check.sh` and `deploy/restart-check.sh` there; real phones (dialling from a Contact, camera upload, the board by touch, iPhone HEIC); a guest and a non-admin account by hand in the browser; a screen reader; `cosign verify` by hand on the published image.
- **Known gaps to pick up later:** reverse listing of linked MaintenanceRecords on a Procedure, execution or Contact page; linked Contacts and MaintenanceRecords in the Documents ZIP export; the title of a removed kept Document stays in the earlier history entry (P4 limitation); HEIC previews (deferred by the owner).
- **Working notes for whoever continues:** never restore a tracked file from git to undo an edit while work is uncommitted (it cost the 16.5 / P4 end-to-end steps once; they were rebuilt). Write multi-line code through files, not unquoted shell heredocs. `test-env/seed.ts` is the demo data; extend it with every new tool.

**Section 16, house management — planned and product decisions confirmed 2026-10-01 (user); 16.0 (instruction files), 16.1 (document files), 16.2 (Folders, Documents, tool switch, screens), 16.3 (finding Documents) and 16.4 (storage, export, permanent deletion) done — Phase 1 complete; everything else TODO:** optional tools Documents, Contacts, Maintenance, Equipment, Mail, enabled per Workspace by a Workspace admin (no personal hiding; phones keep four bottom destinations), in five phases (16.1–16.11). Decided (table in 16.12): all members incl. GUEST view Documents and Contacts (GUEST also downloads), USER and above manage, no per-folder permissions; nested folders; originals kept byte-for-byte incl. metadata (HEIC original kept); 50 MB per file; one combined Workspace storage quota (default 5 GB, a usage limit, not reserved space) with a breakdown by tool, Trash counted; changes audited, routine previews/downloads not; Trash without expiry, permanent deletion only by a Workspace admin (new records only — Procedure and List rules unchanged); a Run retains the linked Document version; ZIP export with metadata and HTML index, also for GUEST; Contacts CSV + vCard; Maintenance with four statuses, Board and List, manual completion; OCR and later optional AI only on our own infrastructure, AI off by default; Mail: shared Mailboxes on public servers only, no GUEST access, remote read/unread, moves and ordinary deletions synchronised (Delete moves to the configured server Trash; no automatic permanent deletion or expunge; explicit permanent remote deletion not approved initially), explicit saved copies kept. **Phase 1 has no open product decision**; P1 (quota default) and P2 (GUEST export) were resolved on 2026-10-01, P4 (removal from a finished Run) on 2026-10-02. Open: technical choices HT8–HT14 (HT1–HT7 for Phase 1 are settled: 16.1 and 16.3) and the later-phase product points P3 and P5–P7 (none concerns Phase 1; P4 resolved 2026-10-02). `AGENTS.md`, `docs/development/security.md` and `docs/development/architecture.md` carry the accepted scope, the planned checks and the module boundaries since 16.0 (done 2026-10-01).

**Decisions 2026-10-01 (user) — section 15:** the app is organised around tools (Today, Procedures, Reminders, Lists, Calendar) with one Settings entry; Today shows only what is actionable; Procedures are written outline-first in a builder with a focused Step editor; Reminders get their own destination; a minimum **Grocery list** is added as lightweight shared Workspace content (new scope — supersedes "no generic tasks" for exactly this); Light and Dark are delivered alike. Made while implementing (15.x): capabilities `list.view` / `list.edit` (USER and above may change lists); lists refresh by polling, not SSE; item changes are not audit events; "Recently used" and pinning moved from Home to the Procedures page; upcoming dates and "Recently done" left Today for the Calendar and Reminders.

**Decisions 2026-09-30 (user) — new objective, section 14 (planned, not implemented):** VMN becomes an ADHD-friendly place to see what needs attention, remember recurring obligations and follow clear visual instructions. First release: standalone Reminders and scheduled Procedures in one overview and calendar; one-time, fixed-calendar and completion-based recurrence with independent Occurrence history; reminder offsets in days/weeks/calendar months; bounded catch-up after outages; one optional Assignee (no extra access); Overdue/Today/Upcoming overview, calendar and mobile agenda; one optional instruction image per Step (processed to a ≤500 KB JPEG, metadata removed) with a per-Workspace storage quota (default 100 MB). Later: completion photos, required evidence, annotations. Supersedes the 2026-09-29 "no calendar / no generic tasks / no recurring schedules / no photos" scope for exactly these features. Product decisions D1–D8, D11–D18 approved; technical choices T1–T5 (details in 14.6).

**Decisions 2026-09-29 (user):** MFA stays optional (also for admins; the beta runs behind a VPN) with the enforcement seam kept; VMN's main flow is *Procedure → optionally schedule → reminders → Start → execute → history* — no task manager, calendar or workflow engine; Home is the Workspace landing page; email and Telegram reminders; Recent limit admin-configurable. **Made while implementing (documented in 13.x):** name *ScheduledProcedure*; reminders go to the person who scheduled; pairing needs a confirmation in VMN; polling instead of a webhook; Recent limit 0–20 (0 hides).

**Decisions 2026-09-28 (user):** offline = queue + labelled device time (8.5); disabling an account is refused while it is the only active Workspace admin (2.7); TOTP stays optional for everyone, also server admins; housekeeping automatic in the server (2.8); sensitive rate limits persisted (2.9); critical Steps: "Tap, then confirm" per account, theme per account (8.7); Memento Mori = darker + stronger red (8.7); slim image, image scan, arm64, signed GHCR releases on tags (10.4); scheduled backups without own crypto (10.5); SKIPPED keeps blocking completion (5.4) and the Knot design stays (7.1) — both confirmed.

**UI:** app shell (8.0), responsive execution (8.1), state presentation (8.2), themes incl. Memento Mori (8.3, 8.7), message catalog (8.4), declutter (8.6), accessibility review with automated axe checks (8.8), UX follow-ups (8.9), offline Runs (8.5).

**Lockfile note (4.4):** the hand-edited entries (`apps/server` → `@vergissmeinnicht/import-export`, `packages/import-export` → `zod`) were verified on 2026-09-27 with `pnpm install --frozen-lockfile` (pnpm 12.6.0): lockfile up to date, supply-chain policies passed, no changes.

**Branches:** work is stacked, not yet merged into `main`: `step-1.1-app-skeleton` → `step-1.2-config` → `step-2.1-user-model` → `step-2.2-invitations` → `step-2.4-totp` → `step-2.5-recovery` → `step-3.1-workspaces` → `step-3.2-roles` → `step-4.1-procedures` → `step-4.2-steps` → `step-4.3-drag-drop` → `step-4.4-import-export` → `step-4.5-restore` → `step-5.1-run-snapshot` → `cleanup-web-domain-constants` → `step-5.2-step-states` → `step-5.3-press-and-hold` → `step-5.4-run-lifecycle` → `step-5.5-audit-trail` → `step-5.6-immutability` → `step-8.0-app-shell` → `step-6-collaboration` (6.1, 6.2) → `step-7.1-knots` → `step-11.1-license` → `step-8-ux` (8.1–8.4) → `step-10-operations` (10.1–10.3) → `ui-declutter` (8.6) → `step-2.7-account-status` → `step-2.8-housekeeping` (2.8, 2.9) → `step-5.7-history-paging` → `step-8.7-preferences` → `step-8.9-ux` (8.8 was committed on `step-8.7-preferences`) → `step-8.5-offline` → `step-10.4-operations` (10.4, 10.5) → `branding-footer` (8.10) → `header-refresh` (8.11) (each branch contains the previous ones; 2.3 was completed on `step-2.2-invitations` because acceptance finishes 2.2). CI runs on pull requests / `main` only.

**Manual testing:** `test-env/menu.sh` (added 2026-09-27) installs/starts/stops/removes an isolated production-mode instance on port 3200 with demo accounts for every role (see `test-env/README.md`). Extend `test-env/seed.ts` when new features need demo data (e.g. Procedures in 4.1).

**Local tooling:** Node 24 LTS (Node 26 works), pnpm 12.6.0 (`npm install -g pnpm@12.6.0`), Docker for Mailpit (`compose.dev.yml`), `pnpm exec playwright install chromium` for e2e.

---

## Locked product decisions

These decisions are already made and must not be silently changed by an implementation agent.

- Product name: **VergissMeinNicht**, short **VMN** (display spelling changed from "Vergissmeinnicht" on 2026-09-27 at the user's request; technical identifiers stay lower-case)
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
- Offline execution: Phase 2 → pulled forward and implemented in 8.5 (2026-09-28): queued Step changes, server time authoritative, device time labelled
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

**Remaining:** ~~admin web UI~~ (8.0) and ~~resend button~~ (2.7) done.

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
- Rate-limit state is in memory (single process; resets on restart); revisit for multi-node deployments. → Sensitive limits persisted in 2.9.
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
- ~~Disabling/enabling accounts~~ — done in 2.7.


### 2.7 Disable / enable accounts
**Status:** DONE
**Completed:** 2026-09-28

**Objective:** server admins can take away (and give back) an account's access at once — the open item from 2.1/2.5.

**Security impact:** HIGH — new privileged action over other accounts; session revocation.

**Decisions (2026-09-28, user):** disabling is **refused** while the account is the only ACTIVE admin of any Workspace (the error names those Workspaces; promote someone else first). No self-change through the admin path, so the last active server admin can never be disabled. Step-up like recovery (own password + TOTP if enabled).

**Implemented:**
- Domain: security events `ACCOUNT_DISABLED`, `ACCOUNT_ENABLED`.
- Application (`packages/application/src/accounts`): `listAccounts` (ACTIVE server admins), `setAccountStatus` (server admin, not self, valid UUID, step-up via `verifyStepUp`); errors `AccountStatusUnchangedError` (409 `account_status_unchanged`), `SoleWorkspaceManagerError` (409 `sole_workspace_admin` + `workspaces`). The managing roles come from `rolesWithCapability('workspace.members.manage')`.
- Database (`createAccountAdminRepository`): one `IMMEDIATE` transaction re-checks the actor (ACTIVE + server admin, not the target), sets the status, and for disabling checks the sole-manager rule after the update, deletes all sessions, consumes pending MFA challenges, revokes pending account recoveries and every pending invitation the user issued (`INVITATION_REVOKED`, reason `issuer_disabled`), records `ACCOUNT_DISABLED` with counts. Enabling restores no session. `revokeAllAccess` moved to `access-revocation.ts` (shared with recovery/password change).
- HTTP: `GET /api/admin/accounts`, `POST /api/admin/accounts/{userId}/status` `{ status, password, code? | recoveryCode? }` (strict body, 20 / 15 min per admin).
- Web: admin page "Accounts" table (name, email, status, two-factor mark, "(you)" without actions) with an inline step-up confirmation; invitations got a "Send again" button (re-issues and supersedes the link — closes the 2.2 resend item). `ApiError.details` carries extra error fields (e.g. the Workspaces).

**Tests/checks:**
- `pnpm test` — 548 (+13): use-cases (8: list only for ACTIVE server admins; disable revokes sessions/challenges/recoveries/issued invitations atomically with events and counts; enable restores nothing; non-admin/disabled admin/self/unknown/malformed/unchanged write nothing; wrong password and missing TOTP refused; in-transaction re-check after the admin flag is removed; sole-admin refusal names the Workspace; disabled admin cannot act), HTTP (5: 401/403 matrix, Origin, strict bodies, session unusable at once and sign-in refused, re-enabled account needs a new sign-in, 409 bodies, rate limit).
- Mutation checks: skipping the sole-manager check, the session revocation or the in-transaction actor re-check each fails tests.
- `pnpm test:e2e` (Accounts table with own row and no self-action), `pnpm lint`, `pnpm typecheck`.

**Security docs updated:** YES (§2 session rotation line, "Security check: account status (Step 2.7)").

**Remaining:** server-admin grant/removal of the flag has no UI/API yet (only invitations can grant it); no bulk actions.

### 2.8 Housekeeping of expired rows
**Status:** DONE
**Completed:** 2026-09-28

**Decision (2026-09-28, user):** automatic in the server (at start + hourly), also available as a CLI command; security events are never deleted.

**Security impact:** MEDIUM — deletes credential-adjacent rows (token hashes, sessions); must never delete anything still usable or any history.

**Implemented:** `purgeExpired` (`packages/database/src/housekeeping.ts`, one `IMMEDIATE` transaction): expired sessions and `verifications`; MFA challenges that are expired or consumed; TOTP enrollments unconfirmed after `TOTP_ENROLLMENT_TTL_MS`; expired `rate_limits` windows (2.9); invitations and account recoveries accepted/completed, revoked or expired more than 30 days ago (`FINISHED_LINK_RETENTION_MS`). `scheduleHousekeeping` in `apps/server` runs it at start and hourly (unref'd timer, stopped on close, failures logged by type only, counts logged only when something was deleted). CLI: `pnpm db:housekeeping` / image command `housekeeping`.

**Tests/checks:** `packages/database/src/housekeeping.test.ts` (exact deletion set incl. boundaries — recent/pending links, live sessions/challenges/rate-limit windows, confirmed TOTP credentials stay; security events untouched; idempotent), `apps/server/src/housekeeping.test.ts` (start + interval, stop, logs contain counts only); CLI run against a fresh database (success and usage error exit codes). `pnpm test`, `pnpm lint`, `pnpm typecheck`.

**Security docs updated:** YES ("Security check: housekeeping and persistent rate limits (2.8/2.9)").

**Remaining:** retention is fixed (30 days), not configurable.

### 2.9 Persistent rate limits for sensitive endpoints
**Status:** DONE
**Completed:** 2026-09-28

**Decision (2026-09-28, user):** persist only the security-sensitive limits; the global per-request limit stays in memory.

**Security impact:** MEDIUM — restarts no longer reset brute-force limits.

**Implemented:**
- Migration `0015_rate_limits`: `rate_limits` (`key_hash` = SHA-256 of counter name + key — no email/IP in clear; `hits`, `window_start`, `window_ms`; CHECKs).
- `createRateLimitCounter` (`packages/database`): fixed windows like the plugin's in-memory store; once a key exceeds its maximum, further hits are not written (one write per window under a flood).
- `apps/server/src/http/rate-limit-store.ts`: store for `@fastify/rate-limit` — in memory by default, persistent for limits configured with `persist: '<name>'`. Persisted: sign-in (per client and per account), `/auth/mfa`, account security (password, TOTP), recovery link resolve/complete, admin recovery, invitation resolve/accept, admin invitations, admin account status, Knot resolution.

**Tests/checks:** counter (fixed window, reopen = restart, write stop, hashes only), `apps/server/src/http/rate-limit-persistence.test.ts` (per-account and per-client sign-in limits still apply after a restart on the same database; no email/IP in the table; ordinary routes write nothing); mutation: disabling persistence fails the test. Existing rate-limit tests unchanged and passing.

**Security docs updated:** YES.

**Remaining:** single database/process only (multi-node needs a reviewed shared store, §12).

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
| `knot.manage` (added in 7.1) | | | ✓ | ✓ |
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
- ~~Search/filter by tag~~ — tag filter in 8.9.

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

**Remaining:** no permanent purge (intentionally none in V1); ~~full view before restoring~~ (8.9).

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
- ~~Run list pagination beyond the newest 200~~ (5.7).

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

**Implemented:** `apps/web/src/HoldToConfirm.tsx` — hold for 1.2 s (1.0 s since 8.0) with pointer/touch (pointer capture; release, cancel or leaving cancels) or keyboard (hold Space/Enter; key repeat ignored; key-up or blur cancels); the normal click is suppressed, context menu on long touch suppressed; progress as text ("hold… 45 %") plus a bar; `aria-describedby` hint "Critical step: press and hold for 1.2 seconds to confirm." Used for "Done" on critical Steps; Skip / Not applicable / Undo stay normal buttons.

**Tests/checks:** `pnpm test:e2e` — plain click and a 0.6 s hold leave the critical Step pending, a full mouse hold and a held Space key mark it Done, the accessible description is present. `pnpm lint`, `pnpm typecheck`.

**Remaining:** hold duration is fixed (not user-configurable); ~~no alternative for users who cannot hold~~ — "Tap, then confirm" account setting since 8.7.

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

**Decisions (2026-09-27; confirmed by the user 2026-09-28):** a Run can be completed only when every *required* Step is DONE or NOT_APPLICABLE — SKIPPED does not satisfy a required Step (it was applicable but not done); optional Steps may be in any state, including PENDING. Abort is possible at any time for an ACTIVE Run, with an optional reason (≤500 code points, same text rules as Step reasons). Completion needs `run.execute`, abort `run.abort` (both USER, EDITOR, ADMIN). There is no reopening.

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

**Tests/checks:** `pnpm test` — 473 tests (+8): history use-cases (4: full Run story in order with actor snapshots and metadata, only the Run's own events, Procedure history across delete/restore, no cross-Workspace reads, display name kept after rename), HTTP (1: members only, 401/404, no user ids or emails in the response, cross-Workspace), `describeEvent` (3; caught a pluralization bug). `pnpm test:e2e`: history of the completed Run shows start, skip with reason, undo and completion. `pnpm lint`, `pnpm typecheck`. No schema change.

**Security docs updated:** YES (§6 checklist).

**Remaining:** ~~pagination~~ and ~~security-event view~~ — done in 5.7.

### 5.6 Historical immutability
**Status:** DONE
**Completed:** 2026-09-27

Completed Runs cannot be edited in V1.

Future correction support must be an explicit additive audited workflow; never silently rewrite a completed Run.

**Security impact:** HIGH — integrity of history.

**How it is enforced (layers):**
1. Application: every Run write path (`changeStepState`, `finish`) requires an ACTIVE Run inside its transaction (`run_not_active` otherwise); there is no API to edit a Run's content, its end data, or audit events.
2. Database triggers (apply to every writer, including bugs and manual SQL through the app's connection):
   - `runs_snapshot_immutable`, `run_sections_immutable`, `run_steps_snapshot_immutable` (0011) — the copied definition never changes, for any Run;
   - `runs_no_delete`, `run_sections_no_delete`, `run_steps_no_delete` (0011) — Runs are never deleted;
   - `run_steps_state_only_while_active` (0012) — Step state of a non-ACTIVE Run is frozen;
   - `runs_finished_immutable` (0013) — no column of a COMPLETED/ABORTED Run changes, so it cannot be reopened;
   - `audit_events_no_update` / `_no_delete` (0008) — history is append-only.
3. No cascading foreign keys into Runs: Procedure (soft) deletion or edits never touch them; a Procedure with Runs cannot even be hard-deleted.

No correction workflow exists in V1. If one is added, it must be a new, additive, audited record referring to the finished Run — never an update of it (the triggers above would have to stay in place).

**Tests/checks:** `pnpm test` — 474 tests (+1): a completed Run and its audit history stay identical after its Procedure is rewritten and deleted; existing tests cover re-complete/abort/execute refusal (application) and trigger refusals for state, end data, Steps, snapshot and deletes. `pnpm lint`, `pnpm typecheck`.

**Security docs updated:** YES (§6).

**Remaining:** an operator with direct access to the SQLite file can drop triggers — database-level protections guard the application, not the host (see §11 deployment / backups).

---

### 5.7 History paging and server security log
**Status:** DONE
**Completed:** 2026-09-28

**Objective:** open items from 5.1/5.5: Run lists beyond the newest 200, histories beyond 1000 events, and a server-admin view of `security_events`.

**Security impact:** MEDIUM — new read path to the security log (server admins only); cursors must not leak across Workspaces.

**Implemented:**
- Application: `Page<T>` (`items`, `nextCursor`), `InvalidCursorError` (400 `invalid_cursor`), `toPage`. `listRuns` (`before`), `getRunHistory` / `getProcedureHistory` (`after`, 500 per page), `listSecurityEvents` (ACTIVE server admin, 100 per page, optional account filter) with port `SecurityEventReader`.
- Database: keyset paging on (`started_at` desc, id) for Runs and (`occurred_at`, rowid) for audit/security events; the cursor row is looked up inside the same scope (Workspace + Run/Procedure/state/account filter) — any other id is an invalid cursor. `createSecurityEventReader` joins the subject's current email for user subjects.
- HTTP: `?before=` on Run lists, `?after=` on histories (strict query schemas, UUIDv4), `GET /api/admin/security-events[?before=&userId=]`; responses carry `nextCursor`.
- Web: "Show older Runs" and "Show more" in histories; admin page "Security log" (time, event in plain words, by, about) with an account filter and "Show more".

**Tests/checks:** `pnpm test` 560 (+5): paging walks produce exactly the single-page order (Runs, Run history, security log incl. timestamp ties), foreign/other-list/other-filter cursors rejected, security log newest-first, filter, only ACTIVE server admins; HTTP: cursor validation, `invalid_cursor`, cursors do not bypass authorization (404 for non-members), security log 401/403, strict queries, no password in output. `pnpm test:e2e` (security log rows), `pnpm lint`, `pnpm typecheck`.

**Security docs updated:** YES (§6, "Security check: security log and paging (Step 5.7)").

**Remaining:** the security log is not exported/archived; metadata is not shown in the table (ids only in the API).

---

## 6 — Collaboration

### 6.1 SSE active Run updates
**Status:** DONE
**Completed:** 2026-09-27

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

**Security impact:** HIGH — new long-lived authenticated endpoint that pushes Workspace data.

**Decisions (2026-09-27):** events are *announcements*, not state: `{ revision, kind, stepId, by, at }` (actor display name, no user ids, no Step text). Clients always refetch the Run over the normal API, so the stream can never show data the reader could not fetch. One stream per open Run (no Workspace-wide stream; the Run list refreshes on navigation as before).

**Implemented:**
- Domain: `Run.revision` (exposed in API responses), `RunChange` event type.
- Application: port `RunChangeNotifier` (optional in `RunDeps`); `changeStepState`, `completeRun` and `abortRun` announce a change only after the repository committed it (rejected/conflicting writes announce nothing); use-case `authorizeRunSubscription` (`run.view`, Run within the Workspace).
- `packages/realtime`: `createRunChangeHub` — in-process fan-out by Run id, listener errors isolated, limits 1000 streams per process and 10 per user.
- HTTP (`apps/server/src/http/run-events.ts`): `GET /api/workspaces/{id}/runs/{runId}/events` (`text/event-stream`, `Cache-Control: no-store`, `X-Accel-Buffering: no`). Session via `requireUser`; subscription authorized like reading the Run (401/404/403 as for `GET …/runs/{runId}`); finished Runs answer `204` (EventSource then stops). After subscribing, the current revision is read again and sent as `ready` — a change committed between authorization and subscription cannot be missed. Before every delivered change and at every heartbeat (20 s) the stream re-checks the session (same session id, not expired, not revoked, User ACTIVE — `reauthenticate()` without session refresh) and `run.view`; any failure closes the stream. Streams close after 15 min (client reconnects re-authenticated), after `RUN_COMPLETED`/`RUN_ABORTED`, on client disconnect and on server shutdown (`preClose`). Rate limit 30 connects/min per client; `429 too_many_streams` beyond the hub limits. `retry: 5000` for reconnects.
- Web: `useRunLiveUpdates` (EventSource) — refetches the Run whenever the announced revision is newer than the shown one (after reconnects via `ready`), shows the connection state as text ("● Live…", "reconnecting", "off"), announces others' changes in a `role="status"` line ("Uma changed “Stove off” at 17:40") and outlines the changed Step; stops after the Run finished. `api.run` answers older than the shown revision are ignored.

**Tests/checks:**
- `pnpm test` — 490 tests (+14): hub (4: per-Run delivery, unsubscribe/slot release, per-user and total limits, failing listener isolation), use-case (1: only committed changes announced, with revision and display name; conflicts, incomplete completion and GUEST attempts announce nothing), SSE over a real socket (5: ready → change → completion → stream end → `204`, no user ids/emails/Step text in events, revision matches the API; 401 without/with forged session or MFA challenge cookie, 404 non-member, 404 cross-Workspace Run id, 400 malformed id; removed member receives nothing further and the stream closes; sign-out closes the stream within a heartbeat; 10 streams per user then 429, other users unaffected, closed streams free their slot), web merge helpers (4, shared with 6.2).
- Mutation checks: removing the per-event re-check fails the removed-member test; removing the heartbeat re-check fails the sign-out test.
- `pnpm test:e2e`: a second browser session follows the Run live (Done appears with actor/time and a status message, completion appears without reload).
- `pnpm lint`, `pnpm typecheck`. Lockfile: new workspace link `apps/server` → `@vergissmeinnicht/realtime` added by hand; `pnpm install --frozen-lockfile --offline` accepts it.

**Security docs updated:** YES (§3, §7, "Security check: live Run updates (Step 6.1)").

**Remaining:**
- In-process hub only: a multi-node deployment needs shared pub/sub (architecture extension seam).
- Per-client connect rate limits share the reverse-proxy address until `trustProxy` is configured (10.3).
- Streams re-check authorization every 20 s, so a revoked session may still receive announcements (revision/actor name/time only, no content) for up to one heartbeat.
- No live update of the Run list.

### 6.2 Optimistic UI
**Status:** DONE
**Completed:** 2026-09-27

Instant visual feedback with safe rollback and clear error state on rejected writes.

**Security impact:** LOW — client-side only; the server still validates every change (`expectedState` compare-and-set from 5.2).

**Implemented:**
- `apps/web/src/run-updates.ts`: pure helpers — `withPendingChanges` (shows unconfirmed target states over the canonical Run without modifying it), `applyStepResult` (takes over the server's answer; if the revision jumped, e.g. someone else's change is not fetched yet, the Step is merged but the revision kept and a refetch requested, so the gap is not hidden), `isNewer`.
- `Runs.tsx`: a Step change shows its target state immediately, marked "Saving…" (dashed border; its old actor/time line hidden); only that Step's buttons are disabled, other Steps stay usable; Complete/Abort wait until nothing is pending. On rejection the canonical state comes back from the server and an alert names the Step and the reason ("“Close windows” was not changed: Someone else changed this Step just now…"). `expectedState` is always taken from the canonical state, never from the optimistic one.

**Tests/checks:** `run-updates.test.ts` (4: next revision applied, revision gap → refetch, overtaken answers ignored, overlay does not modify canonical state); `pnpm test:e2e`: delayed request shows "Saving…" with the new state, a rejected change (409) rolls back with the alert, a delayed successful change resolves to the server's actor/time and reaches the other session live; the keyboard press-and-hold test now waits for the undo to be saved.

**Security docs updated:** N/A (no server change).

**Remaining:** no automatic retry for network failures (the user repeats the action; the canonical state is reloaded); offline execution stays Phase 2 (8.5).

---

## 7 — Knots / shared entry links

### 7.1 Authenticated Knot links
**Status:** DONE
**Completed:** 2026-09-27

Use:
`/knot/{opaque-token}`

Token is high entropy, revocable, optionally expiring, redacted from logs, and does not replace authentication.

**Security impact:** CRITICAL — new credential-like token type and a new Workspace capability.

**Decisions (2026-09-27; confirmed by the user 2026-09-28 — targets, `knot.manage` for EDITOR/ADMIN, link shown once):**
- A Knot points at exactly one **Procedure** or **Run** of its Workspace (explicit target, stored with a type-checked FK). Other targets (Sections, Steps, Workspaces) are not part of V1.
- New capability `knot.manage` (EDITOR, ADMIN): create, list and revoke the Workspace's Knots. Opening a Knot needs no extra capability — only what reading the target needs (`procedure.view` / `run.view`, i.e. every member role).
- The link is shown **once** at creation (only the SHA-256 is stored); to share again, create a new Knot. Lifetime 1–365 days or no expiry (default in the UI: 30 days). Revocation is final and audited; records are kept.
- Every opening failure — malformed/unknown token, expired, revoked, deleted Procedure, not signed in as a member with access — is the same `404 knot_not_found` (401 only when there is no session at all).

**Implemented:**
- Domain (`packages/domain/src/knot.ts`): `Knot`, `KnotTarget`, `knotStatus` (ACTIVE / EXPIRED / REVOKED; expiry inclusive), `normalizeKnotLabel` (1–80 code points, no control/bidi characters), `knotExpiresAt`, `parseKnotId`; audit types `KNOT_CREATED`, `KNOT_REVOKED` (subject `knot`).
- Permissions: `knot.manage` for EDITOR and ADMIN (matrix test updated).
- Database: migration `0014` — `knots` (Workspace FK, unique 64-hex `token_hash`, label, `target_type` + `procedure_id`/`run_id` with a CHECK that exactly the matching one is set, creator id + display-name snapshot, `created_at`, optional `expires_at` after creation, revocation columns all-or-nothing). Triggers: `knots_no_delete`; `knots_only_revocation` (only the revocation columns may change, once). `createKnotRepository`: create/revoke in `IMMEDIATE` transactions with the actor re-check and the audit event; target must exist in the same Workspace (non-deleted Procedure or any Run); ≤500 unrevoked, unexpired Knots per Workspace.
- Application (`packages/application/src/knots`): `createKnot` (returns the token once; 256-bit token via the existing token service), `listKnots`, `revokeKnot`, `resolveKnot` (hash → Knot → status → `authorizeWorkspace` with the target's view capability → target still available; all failures `KnotNotFoundError`).
- HTTP: `POST /api/knots/resolve { token }` (session required, Origin guard, 30/min per client, 1 KiB body); `GET|POST /api/workspaces/{id}/knots`, `POST …/knots/{knotId}/revoke` (`knot.manage`; create 30 / 15 min per client). The create response contains `url` = `PUBLIC_ORIGIN/knot/{token}`; list responses never contain tokens or hashes. Request-log redaction extended to `/api/knots/…`.
- Web: `/knot/{token}` — when signed out, the sign-in page says "Sign in to open this Knot link."; after sign-in the app resolves the token (in the JSON body) and replaces the history entry with the target page, so the token leaves the address bar. "Share as Knot link…" on Procedure and Run views (editors/admins: name, lifetime, link shown once with Copy), "Knot links" page (`/w/{id}/knots`, nav item for `knot.manage`) with target, status, creator, expiry and Revoke. New route `/w/{id}/procedures/{procedureId}` opens a Procedure directly (Knot target).

**Tests/checks:**
- `pnpm test` — 507 tests (+17): domain (4: labels, lifetimes, status, ids), policy matrix (`knot.manage` EDITOR/ADMIN), use-cases (8: create for Procedure/Run with only the hash stored and no token in audit metadata; USER/GUEST/non-member refused; cross-Workspace targets and Procedure/Run id confusion refused; label/lifetime/target validation with nothing written; resolve only for members with access — other Workspace, unknown, malformed, Knot id as token, removed member, disabled account fail identically; expiry, revocation (once), Procedure deletion and restore; in-transaction re-check after demotion; active limit; DB triggers and CHECKs), HTTP (4: link format and token absent from lists; resolve matrix incl. 401 without session and with only an MFA challenge cookie, missing Origin, identical 404 bodies without Workspace ids, token-in-URL 404, revoke; `knot.manage`/Origin/Workspace scope for management; strict bodies), router (Knot and Procedure routes), log redaction.
- Mutation checks: removing the authorization in `resolveKnot`, the expiry/revocation check, the target-availability check, or the `knot.manage` check in `createKnot` each fails tests.
- `pnpm test:e2e`: create a Knot for a Procedure (link shown once), open it in a signed-out browser (`Referrer-Policy: no-referrer`, sign-in hint, lands on the Procedure with the token gone from the URL), revoke it on the Knot links page, opening again fails.
- Migration 0014 applied twice to online backups of the development and test-environment databases (FK check clean, triggers present, existing Run preserved). `pnpm lint`, `pnpm typecheck`.

**Security docs updated:** YES (§2, §3, §4, §9, "Security check: Knot links (Step 7.1)").

**Remaining:**
- Anonymous (unauthenticated) Knot access is not supported and requires a new security review (§12).
- Knot openings are not recorded (reads are not audited); no "last used" information.
- Inside the Procedures page, opening another Procedure does not update the URL yet (only direct links and Knots use `/procedures/{id}`).
- QR codes / NFC for Knots are out of scope (AGENTS.md).

---

## 8 — UX, accessibility, and theming

### 8.0 App shell and usability pass (pulled forward)
**Status:** DONE
**Completed:** 2026-09-27

**Why:** user feedback — account settings, Workspace and server administration and everyday execution were mixed on one unstyled page; the press-and-hold gave almost no feedback, so the app could not be tested meaningfully.

**Security impact:** LOW — client only. No new server endpoints; the admin page uses the existing invitation/recovery APIs (server-admin checks unchanged). The last used Workspace id is kept in `localStorage` as a per-viewer convenience (wrapped in try/catch, never required). Capabilities still only adapt the UI.

**Implemented:**
- Routing without a dependency (`apps/web/src/router.tsx`, History API, links usable with middle-click): `/` (opens the last used or first Workspace), `/w/{id}/runs[/{runId}]`, `/w/{id}/procedures`, `/w/{id}/members`, `/admin`, `/account`, plus the public `/invite/…` and `/recover/…`; unknown paths show a not-found message. The server's SPA fallback already serves these paths.
- App shell (`AppShell.tsx`): header with Workspace switcher (name + role), Workspace sections (Runs · Procedures · Members), "Server admin" (server admins only), "Account", "Sign out". Sign-in, invitation and recovery pages use a separate public layout.
- Pages: Runs (active and finished lists with progress bars; Run view with state badges, per-Step cards, finish controls and history), Procedures (cards, "▶ Start Run"), Members (table, add with role explanation, rename Workspace, leave) — extracted from the old `Workspaces.tsx`, Server admin (create Workspace, invitations list/send/revoke, account recovery with step-up), Account (password, two-factor).
- `styles.css`: semantic tokens with light and dark (system setting) values — dark = black/greyscale with restrained red accents (8.3 direction); state colors always paired with glyph + text (8.2): Pending red, Done green, Skipped amber, Not applicable grey; positive "Done" actions are green; responsive (full-width actions on phones).
- Press-and-hold redesigned: the whole button fills while held (1.0 s), stable accessible name "Hold to mark done: …", hint text as accessible description, releasing early says "Keep holding until the button is completely filled.", a click without pressing says "Press and hold this button for one second."

**Tests/checks:** `pnpm test` — 476 tests (+2 router tests). `pnpm test:e2e` rewritten for the new navigation: admin page (invite + revoke, create Workspace), Members page, Procedures page, Run URLs, Step execution incl. early-release hint and keyboard hold, complete/abort, history, Account page for TOTP. Screenshots checked for desktop light/dark and a 390 px phone. `pnpm lint`, `pnpm typecheck`.

**Remaining:** manual theme toggle (8.3), i18n string structure (8.4), a full accessibility review (incl. an alternative to press-and-hold for users who cannot hold), Procedure view URLs (the Procedure detail is not yet addressable by URL).

### 8.1 Responsive authoring/execution
**Status:** DONE
**Completed:** 2026-09-27

Desktop-first Procedure creation; smartphone-first Run execution.

ADHD-friendly design goals:
- strong visual hierarchy;
- obvious next/pending work;
- low visual clutter;
- persistent progress;
- forgiving undo;
- no reliance on memory to understand current state.

**Security impact:** NONE — presentation only.

**Implemented:** (on top of the 8.0 shell: responsive layout, full-width Step actions on phones)
- Obvious next work: the first pending Step of an active Run is marked with a "Next" chip (text, not only colour), a stronger border and `aria-current="step"`.
- Persistent progress: a sticky bottom dock on active Runs ("1 of 2 resolved · Next: Turn off stove") within thumb reach, with "Go to next Step" (scrolls — smoothly only without `prefers-reduced-motion` — and moves keyboard focus to the Step).
- Low clutter on demand: "Hide resolved Steps" (per view, not stored); sections say "All Steps in this section are resolved."; empty live-status regions no longer render as empty boxes.
- Forgiving undo and no reliance on memory: already present (Undo on every resolved Step, actor/time/reason lines, per-state summary from 8.2, live updates from 6.1).
- Touch: buttons and selects at least 44 px high on narrow screens.
- Wide tables (members, invitations, Knot links) scroll inside their card; a visually hidden header cell no longer widened the page.
- Desktop authoring is unchanged from 4.x/8.0 (form with keyboard/drag reordering); it works on phones but is not optimized for them.

**Tests/checks:** e2e at 390×844: no horizontal page scroll on the Run view and the Knot links page, "Next" on the right Step, dock text and visibility, focus after "Go to next Step", 44 px action buttons, hide/show resolved Steps; contrast test extended to the "Next" chip. `pnpm lint`, `pnpm typecheck`, `pnpm test`.

**Security docs updated:** N/A.

**Remaining:** Procedure authoring on phones is usable but not optimized (drag handles are desktop-only; buttons/select work); no manual test on physical iOS/Android devices yet; a full accessibility review (incl. an alternative to press-and-hold) is still open from 8.0.

### 8.2 State presentation
**Status:** DONE
**Completed:** 2026-09-27

Color plus semantic icon/text:
- Pending: danger/red treatment
- Done: success treatment + actor/time
- Skipped: distinct state
- Not Applicable: distinct state

Do not rely on red/green alone.

**Security impact:** NONE — presentation only.

**Implemented:** (built on 8.0, which introduced badges and Step cards)
- Every state is glyph + word + colour: badges (○ Pending, ✔ Done, ↷ Skipped, – Not applicable), a coloured left border per Step card, the actor/time/reason line ("Done by Uma at …"), remote changes outlined and announced with actor and time (6.1), a brief Done confirmation (8.3).
- New per-state summary under the progress bar in Run lists and the Run view ("✔ 2 done · ↷ 1 skipped · ○ 3 pending"), so Skipped and Not applicable are not merged into "resolved".
- `contrast.test.ts` reads the real token blocks of both themes from `styles.css` and checks WCAG AA: 4.5:1 for all text pairs (text/muted/links on backgrounds, badge text on its tint, button labels, summary text, the press-and-hold label on its fill) and 3:1 for non-text UI (Step borders, progress bar); it also requires four distinct state colours. A deliberately darkened dark-theme colour fails it (checked).

**Tests/checks:** `pnpm test` (contrast: 4 tests); e2e asserts the summaries ("○ 2 pending", "✔ 2 done"); `pnpm lint`, `pnpm typecheck`.

**Security docs updated:** N/A.

**Remaining:** ~~forced colours~~ and automated/tree review done in 8.8; a session with a real screen reader is still open.

### 8.3 Theme system
**Status:** DONE
**Completed:** 2026-09-27

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

**Security impact:** LOW — client-only preference; the CSP was tightened as part of this step.

**Implemented:**
- `apps/web/src/theme.ts`: modes `system` / `light` / `dark` resolve to a theme id written to `<html data-theme>` before the first render (`initTheme` in `main.tsx`); "System" follows the device setting live (`matchMedia` change). The choice is a per-browser convenience in `localStorage` (`vmn.theme`, wrapped in try/catch, invalid values ignored), not part of the account.
- `styles.css`: `:root` = light tokens, `:root[data-theme='dark']` = dark tokens (black/grey, restrained red accent) — defined once; a pre-script fallback follows the system for the page background. Components still use only semantic tokens. **Adding a named preset** (e.g. Memento Mori) = one token block `:root[data-theme='memento-mori']`, one entry in `THEMES` and one mode; no component changes.
- Account page: "Appearance" radio group (System / Light / Dark) with short explanations.
- Motion: a 220 ms confirmation when a Step becomes Done, only under `prefers-reduced-motion: no-preference`.
- CSP: `style-src 'self'` and `font-src 'self'` (no `'unsafe-inline'`, no remote styles/fonts) — possible because the app has no inline `<style>`/`style=""` markup (React style props use the CSSOM).

**Tests/checks:** `theme.test.ts` (3: System resolution, only known stored modes accepted, every mode resolves to an existing theme); `app.test.ts` asserts the tightened CSP; e2e: Dark applies at once (body background from the dark tokens), survives a reload, Light switches back, System follows emulated `prefers-color-scheme`; the whole e2e flow collects console messages and fails on any CSP violation. `pnpm lint`, `pnpm typecheck`.

**Security docs updated:** YES (§2 CSP, Step 1.1 open risk closed).

**Remaining:** ~~no named preset~~ (Memento Mori, 8.7); ~~theme per browser~~ (account preference, 8.7).

### 8.4 i18n readiness
**Status:** DONE
**Completed:** 2026-09-27

V1 ships English only, but user-facing strings must be structured so adding translations later does not require rewriting business logic/components.

**Security impact:** NONE — client-side text only (messages are rendered as plain text, never HTML).

**Implemented:**
- `apps/web/src/i18n/`: `en.ts` is the reference catalog (455 keys grouped by area); `t(key, params)` fills `{name}` placeholders and chooses plural forms by `{count}` via `Intl.PluralRules`; `Messages = Record<MessageKey, Message>` makes TypeScript require every key in any future catalog; `hasMessage` for server error codes; `formatDateTime` / `formatTime` via `Intl.DateTimeFormat` (UI language, with the browser's regional variant for date formats); `setLocale` also sets `<html lang>`.
- **Every component's user-facing text now comes from the catalog**: shell and navigation, sign-in/MFA, invitation and recovery pages, account (password, two-factor, appearance), Members, server admin, Procedures and the Procedure form (incl. icon names, reason policies, drag/move labels and accessible names), Runs (states, summaries, progress, dock, finishing, live updates, optimistic errors), press-and-hold, history descriptions, Knot links, footer. API error texts moved from `api.ts` into `error.<code>` keys (`messageFor` looks them up). Sentences that embedded links were rephrased so no translation has to be split into fragments. Only the product name stays literal.
- Guards: ESLint forbids `toLocaleString` / `toLocaleDateString` / `toLocaleTimeString` in `apps/web` outside `i18n/`; a server test checks that every error code mapped in `apps/server/src/http/errors.ts` has an `error.<code>` message (it found `invalid_invitation` missing — added).
- Adding a language: copy `en.ts` to `xx.ts` typed as `Messages`, translate, register it in `CATALOGS`, and pick the locale (a user setting would be new UI).

**Tests/checks:** `i18n.test.ts` (6: placeholders, plurals, values never re-interpreted, `hasMessage` incl. prototype keys, date formatting, well-formed catalog — no empty/HTML messages, balanced braces, plural entries use `{count}`), `error-messages.test.ts`; `pnpm test` (523), `pnpm test:e2e` unchanged selectors pass (visible texts kept identical except rephrased link sentences and the Knot/start-page link names), `pnpm lint`, `pnpm typecheck`.

**Security docs updated:** N/A.

**Remaining:** no language switcher and no second catalog (V1 is English only); ~~email texts~~ in a catalog since 8.9 (CLI output stays English); numbers are interpolated without locale formatting (only counts and revisions today).

### 8.6 Declutter and naming (user feedback)
**Status:** DONE
**Completed:** 2026-09-27

**Why:** user feedback — too much text, too many controls at once; the header should use a menu; the project name must be consistent with VMN clearly referenced; no private use-case names in a public project.

**Security impact:** LOW — client-side presentation only. The "Server admin" menu entry is shown only to server admins, but the server still authorizes every admin request (unchanged); no server behavior changed besides display names (email subjects/bodies, TOTP issuer label for new enrollments, Better Auth app name).

**Implemented:**
- Header: brand ("VergissMeinNicht", "VMN" on phones), Workspace selector (no label text), and a menu button (avatar initial + ☰) with the user's name/email, "Profile & settings", "Server admin" (server admins only) and "Sign out". Disclosure pattern: Escape and outside clicks close it, focus returns to the button, menu items close it. Workspace tabs stay on one row on phones.
- Steps: "Required · critical" prose replaced by marks — a red "!" icon for critical Steps (accessible name "Critical", tooltip "press and hold to confirm") and a small "optional" tag; required is the unmarked default. Same marks in the Procedure view, which no longer lists reason policies (they are in the editor).
- Less text in the Run view: buttons "✔ Done" / "Undo" / "✔ Hold to confirm" (full names such as "Done: Stove off" stay as accessible names); "who · when" lines ("Ada · 17:40", date only when not today) only for resolved Steps; "Started by … · …" without state word and Procedure revision; live status as a small "● Live" chip with the explanation as tooltip; the "Uma changed …" notice fades after 10 s; the "x of y resolved" lines under progress bars removed (bar value is announced; counts are in the state summary and the bottom bar); the standing press-and-hold hint is only for assistive tech (feedback such as "keep holding" is still shown).
- Secondary actions behind disclosures: Procedure "More actions" (Export, Duplicate, Delete, Knot link), Run "More actions" (Knot link), and per-Step "More options" in the editor (icon, reason policies, move to section).
- Page hints moved into empty states ("No Runs yet. Start one from a Procedure."); footer shortened to "VergissMeinNicht (VMN) · AGPL-3.0 · Source code".
- Naming: display name **VergissMeinNicht** (short **VMN**) across UI, emails, TOTP issuer, docs, deployment files and test environment; README and architecture explain that VMN is the prefix of technical identifiers; package/image/file names stay lower-case. The German word keeps its spelling where the name is explained.
- Removed the private "Casa Nostra" use-case references (README, objectives); README now lists general uses.
- New test `catalog-usage.test.ts`: every catalog message must be used (dynamic key prefixes allow-listed); it found and removed 17 messages orphaned by this pass.

**Tests/checks:** `pnpm test` 535, `pnpm test:e2e` updated to the new structure (menu helper, marks via accessible names, "More" disclosures, short labels) plus a menu check (opens, shows identity, Escape closes and restores focus); screenshots reviewed on desktop and at 390 px; `pnpm lint`, `pnpm typecheck`.

**Security docs updated:** N/A.

**Remaining:** ~~menu test~~ and ~~accessibility review~~ (8.8); Knot links and history could get the same "more" treatment in list pages.

### 8.7 Account preferences: theme sync, Memento Mori, critical-Step alternative
**Status:** DONE
**Completed:** 2026-09-28

**Decisions (2026-09-28, user):** critical Steps can be confirmed by "Tap, then confirm" instead of press-and-hold, chosen per account (follows the user to every device); the theme moves into the same account preferences; Memento Mori = darker + stronger red (pure black, bone-white text, deep crimson), a fourth appearance option.

**Security impact:** LOW — presentation preferences of the user's own account; no authorization change (the server validates every Step transition regardless of the confirmation style).

**Implemented:**
- Domain `preferences.ts`: `THEME_PREFERENCES` (system/light/dark/memento-mori), `CRITICAL_CONFIRM_MODES` (hold/tap-confirm), defaults.
- Migration `0016_user_preferences` (one row per user, enum CHECKs, FK to users); `createPreferencesRepository`; use-cases `getPreferences` / `updatePreferences` (own account, ACTIVE); `GET/POST /api/account/preferences` (strict body, at least one field, Origin-guarded).
- Web: `PreferencesProvider` loads the account's preferences after sign-in and applies the theme (the browser keeps a copy only for the first paint); Appearance and "Critical Steps" settings on the Account page save to the account; `TapToConfirm` — "✔ Done" asks "Really done?" with "✔ Yes, done" (focused) and Cancel/Escape (focus returns); Memento Mori token block.
- `contrast.test.ts` checks all three themes and requires every preset to define every colour token.

**Tests/checks:** `apps/server/src/http/preferences.test.ts` (defaults, partial updates, per account, other session sees them, strict validation, 401/403, nothing stored on rejection); contrast (Memento Mori passes WCAG AA for all pairs); theme tests; e2e: Memento Mori applies (black background) and another browser gets it after sign-in; tap-confirm flow incl. Escape and focus handling. `pnpm test` 563, `pnpm lint`, `pnpm typecheck`.

**Security docs updated:** N/A (no security-relevant behavior; noted under 5.3 that confirmation style is UX only).

**Remaining:** hold duration itself is not configurable.

### 8.8 Accessibility review
**Status:** DONE
**Completed:** 2026-09-28

**Security impact:** NONE — presentation and tests; one exactly pinned dev dependency (`@axe-core/playwright` 4.13.0 by Deque, depends only on `axe-core` 4.13.0 without dependencies; lockfile verified with `pnpm install --frozen-lockfile`, supply-chain policies passed).

**Implemented:**
- Automated checks: `e2e/a11y.ts` runs axe-core (WCAG 2.0/2.1/2.2 A+AA and best practices) at 16 points of the e2e flow — invitation, sign-in with error, start page, server admin, members, Procedure view, Run list, Run view on a phone, Run view in forced colours, critical-Step confirmation question, finished Run with history, Knot links, Account page in light, dark and Memento Mori, second-factor page. Any violation fails the run.
- Fixes from the review: the header's product name is now the page's level-one heading (axe `page-has-heading-one`); in forced colours the current tab uses the system selection colours (axe `color-contrast`); Step titles are level-4 headings (jump from Step to Step); the press-and-hold hint is only the button's description (no longer read twice) and its feedback ("keep holding…") is a live status.
- Forced colours (Windows High Contrast): outlines for badges, chips and the progress bar; progress and hold fills use `Highlight` (the hold fill becomes a bar under the label); Skipped/Not applicable Steps get dashed/dotted borders, the next Step thicker borders; dock outlined.
- "Server admin" menu entry: `menuLinks()` extracted and unit-tested (only for server admins; the server check is unchanged and tested).
- Accessibility-tree review (Playwright ARIA snapshots of the Run view and admin page) in place of a screen-reader session: landmarks (banner, navigation, main, regions), names of all controls, live regions for remote changes and hold feedback, progressbar with a name.

**Tests/checks:** `pnpm test:e2e` (all axe checks clean; forced-colours border styles; Step headings; live hold feedback), `apps/web/src/UserMenu.test.ts`, `pnpm test`, `pnpm lint`, `pnpm typecheck`.

**Security docs updated:** N/A (dev dependency noted above; §10 policies applied).

**Remaining:** no session with a real screen reader (NVDA/VoiceOver/TalkBack) or on physical iOS/Android devices — needs a person with the devices; axe covers only automatically detectable issues; the `<details>` disclosure marker is the browser default.

### 8.9 UX follow-ups: deleted Procedure view, tag filter, email text catalog
**Status:** DONE
**Completed:** 2026-09-28

**Security impact:** LOW — one new read route for soft-deleted Procedures, behind the existing `procedure.restore` capability.

**Implemented:**
- Deleted Procedures can be read in full before restoring: `getDeletedProcedure` (`procedure.restore`, Workspace-scoped, only soft-deleted rows; the normal view still answers 404), `GET /api/workspaces/{id}/procedures/deleted/{procedureId}`; web: "View …" in the deleted list, a read-only view with a "This Procedure is deleted" note and Restore.
- Procedures list: tag filter (every tag of the Workspace, "All tags" by default; per view, not stored). Client-side over the list the user may already see.
- Server-side i18n: invitation and recovery emails come from a typed catalog (`packages/application/src/email-texts`, `EmailTexts` + `emailTextsEn`); a translation is another object of that type. Operator CLI output stays English (operator tooling).
- Reviewed and left unchanged: the Knot links page has one action per row and histories are collapsed by default, so no further "more" disclosure is needed.

**Tests/checks:** use-case (viewable with structure, normal view 404, USER/GUEST refused) and HTTP tests (403 for USER/GUEST, 404 for other Workspaces/unknown/restored ids, 400 for malformed ids); email text tests; e2e: view a deleted Procedure (note, Sections, axe clean) and restore from there, tag filter options. `pnpm test` 566, `pnpm lint`, `pnpm typecheck`.

**Security docs updated:** YES (§ Procedures check: deleted view).

**Remaining:** Procedure authoring on phones is usable but not optimized (drag handles desktop-only; move buttons work).

### 8.10 Branding: header icon, hero image, footer and the option to hide it
**Status:** DONE
**Completed:** 2026-09-28

**Request (user, 2026-09-28):** the icon in the upper left corner in both styles (light/dark); a more realistic hero image of the forget-me-not with the knot; a more exciting README; the footer reads "VergissMeinNicht (VMN) with 🖤 by CrimsonClyde - Licence: AGPL-3.0"; an admin option to hide the footer — still in the HTML, only hidden.

**Security impact:** LOW — one new server-admin write (`POST /api/admin/settings`), audited; the global rate limit no longer counts static web files.

**Implemented:**
- Header and public pages show `icon.svg` (black tile, white flower) next to "VergissMeinNicht" / "VMN"; a thin border in the theme's border colour keeps the tile's edge visible on dark themes. Phones: the Workspace selector is narrower so the header stays on one line.
- `assets/brand/vergissmeinnicht-hero.svg`: new illustration — sky-blue five-petal flowers with white halos and golden eyes, pink buds, leaves, and a stem tied into an overhand knot (an opened trefoil with alternating over/under crossings). README uses it and was rewritten (features, security, quick start, the "Forget-Me-Knot" name story).
- Follow-up (2026-09-29): replaced the stylized SVG hero entirely with `assets/brand/vergissmeinnicht-hero.png`, a transparent hyperrealistic botanical image with a continuous living stem forming a clear overhand knot; updated the README reference and accessible description.
- Footer: "VergissMeinNicht (VMN) with 🖤 by CrimsonClyde - Licence: AGPL-3.0"; the name links to the source code (AGPL §13 offer), "AGPL-3.0" to the licence text, the heart has the accessible name "love". The third-party notices stay at `/third-party-notices.txt` (no longer linked from the footer).
- Instance settings: migration `0018_instance_settings` (single row, CHECK id = 1); `updateInstanceSettings` (ACTIVE server admin, re-checked inside the transaction, `INSTANCE_SETTINGS_CHANGED` security event); `POST /api/admin/settings { footerHidden }` (strict body); `GET /api/about` returns `footerHidden` (public). Admin page "This server": "Hide the page footer (name and licence)" with a note on the AGPL. The footer keeps its markup and gets the `hidden` attribute; it starts hidden until the server answered (no flash), and is shown when the server cannot be reached.
- Rate limits: the global per-client limit (300/min) now applies to `/api` only — every page load had cost several requests for static files, which the e2e flow exposed as `rate_limited` on a page load. All API limits are unchanged.

**Tests/checks:** HTTP (footer setting: 401/403/Origin, strict body, public `/api/about`, audited, in-transaction re-check), hardening (320 static requests pass, the 301st API request is limited), e2e (footer text and links; hide → hidden but in the DOM → survives reload → show; axe checks), screenshots of header (light, dark, phone) and footer reviewed; hero rendered and reviewed. `pnpm test` 593, `pnpm lint`, `pnpm typecheck`.

**Hero replacement checks (2026-09-29):** generated image visually reviewed for botanical realism, five-petal flower morphology, knot readability, and clean isolation; verified as 1448×1086 8-bit sRGB PNG with a true alpha channel. Documentation-only asset change; no automated application suite rerun.

**Security docs updated:** YES (§2 rate limits, "Security check: branding and instance settings (8.10)").

**Hero replacement security impact (2026-09-29):** NONE — static documentation artwork only; `docs/development/security.md` unchanged.

**Remaining:** none.

### 8.11 Header and colour scheme refresh (user feedback)
**Status:** DONE
**Completed:** 2026-09-28

**Request (user, 2026-09-28):** bigger icon, a livelier header; apart from the Step cards no colour: black page, dark grey boxes, a dark blood-red (crimson) highlight, an animated stripe through the scheme's colours (black, greys, red); the light theme as the inverted version; no blue anywhere, the glow a darker shade of white.

**Security impact:** NONE — presentation only.

**Implemented:** header icon 44 px (36 px on phones) with a grey glow; wordmark "VergissMein**Nicht**" (accent) with the tagline "Never skip the step that matters" on wider screens; a soft grey glow behind the logo; a 3 px stripe that slowly runs through page colour → greys → blood red and back (still under `prefers-reduced-motion: reduce`); current tab and avatar ring in the highlight colour. Tokens: dark = `#000` page, `#141416`/`#1f1f23` boxes, `#8b1020` highlight (white text), `#c41e3a` brand text; light = white page, `#f3f3f5`/`#e7e7eb` boxes, `#8b1020` highlight; links and focus rings neutral (no blue); new tokens `--link`, `--glow`, `--on-pending` (text on the Pending red, e.g. the "Next" chip); checkboxes/radios use the highlight (`accent-color`). Fixed on the way: radio buttons were stretched to text-field width. Step state colours (cards) unchanged.

**Tests/checks:** contrast test for all three themes (new pairs: link on page/boxes, brand on page/boxes, text on Pending red); e2e incl. all axe checks; screenshots reviewed (dark, light, phone). `pnpm test`, `pnpm lint`, `pnpm typecheck`.

**Security docs updated:** N/A.

### 8.5 PWA/offline active Runs
**Status:** DONE
**Completed:** 2026-09-28 (pulled forward from Phase 2 at the user's request)

Important scenario: a Procedure can contain “turn off router/network”.

**Decisions (2026-09-28, user):** Step changes made offline are queued on the device and sent when back online; the server time stays authoritative, the device clock is stored only as a clearly labelled extra ("offline, device clock …"); conflicts with others' changes are shown, never silently overwritten.

**Security impact:** HIGH — Workspace data at rest on the device, client-reported times in the execution history, replayed writes.

**Scope:** only active Runs the user opened on this device while online; offline only Step changes (DONE / SKIPPED / NOT_APPLICABLE / undo). Starting, completing and aborting need a connection (and completing waits until queued changes are sent).

**Implemented:**
- Domain: `StepStateChange.deviceAt`; `plausibleDeviceTime` — kept only between the Run's start and the server time (+2 min clock skew, capped at the server time) and not older than 7 days; otherwise dropped (the change still counts).
- Database: migration `0017` (hand-written, triggers kept): `run_steps.state_changed_device_at` (CHECK: only with a server time; added to the `run_steps_state_only_while_active` freeze trigger), `audit_events.client_change_id` with a unique index per actor.
- `changeStepState` with `offline: { clientChangeId, deviceAt }`: inside the `IMMEDIATE` transaction a change id this actor already used for this Step returns `duplicate` (nothing written, no live event — also after the Run ended); an id used for another Step is a conflict; otherwise the normal rules apply (`expectedState` compare-and-set, reason policies, Run ACTIVE, `run.execute` re-check); audit metadata `offline: true` and `deviceTime` when kept. An online change clears the device time.
- HTTP: strict optional `offline` object (`clientChangeId` UUIDv4, `deviceTime` ISO 8601 with offset); response `duplicate`; Run responses carry `stateChange.deviceAt`.
- Web: service worker (`public/sw.js`) caches only the app shell (HTML + hashed assets, same for every user; never `/api`; old assets pruned); web app manifest and icon. `OfflineProvider` + IndexedDB store (`offline/store.ts`): active Runs opened while online, the Workspace list/context and the last user (for a reload without connection), and the queue — all keyed by user id. Step changes go to the queue when the browser is offline, when the request cannot reach the server, or when earlier changes of the Run still wait; queued changes are shown as "Saved on this device · not sent yet"; the queue is sent strictly in order on `online`, at start and every 30 s: accepted/duplicate → removed; refused (conflict, Run ended, no permission, invalid) → removed together with later changes of the same Step, explained in an alert; 401 → kept, "sign in again"; unreachable/429/5xx → kept. Sign-out deletes the whole device database (with a confirmation when changes wait); another account signing in on the browser deletes the previous account's data. Offline banner (status line); complete/abort disabled while offline or while changes wait.

**Tests/checks:** domain (5: plausibility bounds), use-cases (8: server time authoritative + device time kept; implausible dropped; idempotent replay also after completion; id per actor and per Step; conflict without overwrite; online change clears the device time; device time frozen with the Run; GUEST refused, malformed id; DB unique index), HTTP (duplicate flag, strict `offline` body, GUEST 403, `deviceAt` in the Run view), web queue logic (4), e2e: go offline, mark a Step done (queued, banner, abort disabled, axe clean), reload offline (service worker + saved Run + queue), back online → sent with "(offline, device clock …)"; offline undo against another device's change → dropped and explained, other device's state kept; sign-out removes the device database. Mutation checks: dropping the duplicate check or the plausibility rule fails tests. Migration 0017 on a fresh database and on a copy of the dev database (twice; integrity and FK checks clean).

**Security docs updated:** YES ("Security check: offline Run execution (Step 8.5)", §6, §7).

**Remaining:** Runs not opened on the device while online are not available offline; a shared device that is never signed out keeps the saved Runs of its last user (until sign-out or another account signs in); no background sync while the app is closed (sending resumes when it is opened); physical-device testing (iOS Safari storage eviction) not done.

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
**Status:** DONE
**Completed:** 2026-09-27

Supported V1 deployment:
- one application container;
- SQLite persistent volume;
- reverse proxy providing HTTPS;
- runtime-injected secrets.

**Security impact:** HIGH — production runtime environment, secret injection, network exposure.

**Implemented:**
- `Dockerfile` (multi-stage, base `node:24.21.0-bookworm-slim` pinned by digest): web bundle built in its own stage, server-only production dependencies (`pnpm install --prod --filter "@vergissmeinnicht/server..."`), runtime as `node` (uid 1000), `/data` volume (0700), `HEALTHCHECK` on `/api/health/ready`, `LICENSE` included. `.dockerignore` keeps `.git`, data, secrets, env files, tests and docs out of the build context.
- `deploy/docker-entrypoint.sh` (`vergissmeinnicht` in the image): `serve` (default), `migrate`, `backup`, `verify`, `restore`, `admin-bootstrap`, `admin-recover` — all with the server's configuration.
- `deploy/compose.yml`: app (read-only root FS, tmpfs `/tmp`, `cap_drop: ALL`, `no-new-privileges`, `init`, Docker secrets for `AUTH_SECRET`/`DATA_ENCRYPTION_KEY` via `*_FILE`, no published port) and Caddy `2.11.4-alpine` (pinned digest; automatic HTTPS; only 80/443 published) on an internal network where Caddy has a fixed address (`TRUSTED_PROXIES`) and other containers get addresses from a separate range. `deploy/Caddyfile` (no access log, no compression), `deploy/vergissmeinnicht.env.example`; env file and secrets git-ignored.
- CI job `image`: builds the image, asserts uid 1000 and that `serve` fails without configuration. Dependabot: `docker` (Dockerfile) and `docker-compose` (`deploy/`).
- `docs/admin/deployment.md` rewritten: quick start, commands, configuration incl. new variables, upgrades, proxy/HTTPS, health checks, backups.

**Tests/checks:** image build locally (Docker 29.8.1, Compose 5.5.1); container drill with the Compose file (local TLS for `localhost` via Caddy): `migrate` → `up` → healthy; process uid 1000, root FS read-only, `/data` 0700 and files 0600; headers through Caddy (HSTS, CSP, Permissions-Policy, no-store); bootstrap CLI → accept invitation → sign-in → create Workspace over HTTPS; request logs show the forwarded client address (Docker gateway), not Caddy's; no token in logs; `docker compose stop` exits 0 (graceful SIGTERM); no error-level log lines. Found and fixed during the drill: a one-off `run` container could take Caddy's fixed IP (now a separate dynamic range) and a fixed app IP blocked `run` while the app was up (removed).

**Security docs updated:** YES (§2, §8, §11, "Security check: deployment, hardening and backups").

**Remaining:** ~~image size~~, ~~registry/release~~, ~~image scan~~, ~~ARM builds~~ — all in 10.4.

### 10.2 Backup/restore
**Status:** DONE
**Completed:** 2026-09-27

Document consistent SQLite backup and tested restore.

**Security impact:** HIGH — backups hold every credential-like artefact of the system; restore can destroy data if done wrong.

**Implemented:**
- `packages/database/src/backup.ts`: `backupDatabase` (SQLite online backup API from a read-only connection — consistent while the server writes, WAL included; never overwrites; `0600` in a `0700` directory; converted to a self-contained rollback-journal file; verified), `verifyDatabase` (integrity check, foreign-key check, expected tables, pending-migration info; read-only), `restoreDatabase` (verifies first; refuses while any connection has the database open via an exclusive-lock probe held during the swap; keeps the replaced database and its WAL/SHM as `.before-restore-<time>`; `0600`), `defaultBackupPath`.
- `packages/database/src/ops-cli.ts`: `migrate` (automatic `…-pre-migration.sqlite` backup when migrations are pending), `backup [--out]`, `verify`, `restore [--force]`; root scripts `pnpm db:backup` / `pnpm db:restore`.
- `migrationStatus` (drizzle-compatible: newest applied vs. newest shipped migration timestamp) used by readiness and verification.
- Documentation: what to back up (database via the command, `DATA_ENCRYPTION_KEY` separately, configuration), encryption of off-host copies, retention, restore procedure, restore drill.

**Tests/checks:** `backup.test.ts` (5: older schemas are valid backups and a failed verification leaves no file; backup during writes includes uncheckpointed WAL data, modes, no sidecars, no overwrite; restore refused while open — including idle with an empty WAL — then succeeds after close, old database kept, restored database usable; restore into an empty location reporting an older schema; garbage/foreign/missing/same-file inputs rejected without changes). CLI drill on a copy of the dev database. Container drill: backup while running (`exec`), change data, restore refused while running (also via a separate `run` container), stop, restore, start → data back to the backup state, healthy. The first drill found a real bug: the WAL-size heuristic let a restore run against an idle server (writes would have gone to the renamed file) — replaced by the lock probe, with a regression test.

**Security docs updated:** YES (§8).

**Remaining:** ~~no built-in schedule/retention~~ (10.5); encryption stays with the operator's tools (documented); `--force` bypasses the in-use check by design.

### 10.3 Production hardening
**Status:** DONE
**Completed:** 2026-09-27

HTTPS, proxy trust, security headers, dependency scanning, health checks, safe secret injection.

**Security impact:** CRITICAL.

**Implemented:**
- Proxy trust: `TRUSTED_PROXIES` (IPs, CIDR ranges `/1`+, `loopback`; `/0`, `*`, host names and presets like `uniquelocal` rejected) → Fastify `trustProxy` list; default none. Rate limits, sign-in client identity (Better Auth client-IP header) and logs then use the real client behind the proxy.
- HTTPS/HSTS: `HSTS_MAX_AGE` (default one year, only for https origins, `0` disables; no `includeSubDomains`/`preload`). HTTPS itself: config already requires an https `PUBLIC_ORIGIN`; Compose terminates TLS in Caddy.
- Headers: `Permissions-Policy` denying camera, microphone, geolocation, payment, USB, interest-cohort; CSP tightened in 8.3; existing helmet baseline.
- Timeouts: `requestTimeout` 30 s, `connectionTimeout` 60 s (request reception only; SSE responses unaffected).
- Health: `GET /api/health` (liveness) and `GET /api/health/ready` (database reachable, no pending migrations; `503` + reason code).
- Secret injection: `AUTH_SECRET_FILE`, `DATA_ENCRYPTION_KEY_FILE`, `SMTP_PASSWORD_FILE` (absolute path; either variable or file; trailing newline trimmed; errors never echo contents).
- Dependency scanning: existing `pnpm audit --audit-level high` in CI and Dependabot (npm, GitHub Actions) extended with Docker and Compose images; CI builds the image.

**Tests/checks:** `config.test.ts` (+3), `hardening.test.ts` (3: HSTS/Permissions-Policy; per-client limits behind a trusted proxy, other clients unaffected, spoofed `X-Forwarded-For` from an untrusted address does not escape the limit; readiness with pending migrations); container drill (forwarded address in logs, headers through Caddy). `pnpm test` 534, `pnpm test:e2e`, `pnpm lint`, `pnpm typecheck`.

**Security docs updated:** YES (§2, §11, open risks of Steps 1.1, 2.3, 6.1 updated).

**Remaining:** ~~rate-limit state in memory~~ (sensitive limits persisted in 2.9; single node only); no WAF/fail2ban integration; secrets can still be given as plain environment variables (allowed for development and simple setups).

---

### 10.4 Image size, vulnerability scanning, multi-architecture builds, signed releases
**Status:** DONE
**Completed:** 2026-09-28

**Decisions (2026-09-28, user):** slim image, image vulnerability scan, arm64 builds, and publishing to GHCR on version tags — nothing is published until a tag is pushed.

**Security impact:** MEDIUM — supply chain of the published artifact; new CI permissions (`packages: write`, `id-token: write`) only in the tag-triggered release workflow.

**Implemented:**
- Image: better-auth's optional peers and all build/test tooling (vitest, vite, rolldown, esbuild, drizzle-kit, lightningcss, postcss, React, @types, tsx, …) are removed from the runtime tree; better-sqlite3 keeps only the prebuilt binary of the image's platform (no sources); npm/npx/corepack/yarn removed from the runtime file system. 576 MB → 416 MB (runtime `node_modules` 193 MB → 72 MB); OCI labels (title, description, license; version/revision/source on releases).
- `deploy/smoke-test.sh`: starts an image with a throwaway production configuration — `migrate`, `admin-bootstrap`, `backup`, then `serve` read-only with dropped capabilities: readiness, web app, service worker, manifest, third-party notices, scheduled backup. Proves the pruning removed nothing needed.
- CI `image` job: matrix on native `ubuntu-latest` and `ubuntu-24.04-arm` runners (no emulation): build, non-root + fail-closed checks, smoke test, Trivy scan (HIGH/CRITICAL with a fix → fail). `trivy-action` pinned to the verified signed commit of v0.36.0 (released after the March 2026 tag compromise; checked to be in the default branch) with an explicit scanner version v0.70.0.
- `.github/workflows/release.yml` (tags `vX.Y.Z` only): runs the full CI (`workflow_call`), then per architecture on native runners build → smoke test → scan → push `:<version>-<arch>`; then one multi-architecture index (`:<version>`, `:<major.minor>`, `:latest`), a CycloneDX SBOM (Trivy), keyless Sigstore signature and SBOM attestation of the index digest (`cosign`). All actions pinned to verified commit SHAs (checked: signed, on the default branch); least-privilege job permissions; `persist-credentials: false`.
- Third-party notices (open item of 11.1): a Vite plugin writes `third-party-notices.txt` from the modules actually in the bundle (name, version, license, full license text); linked in the footer.

**Tests/checks:** local image build + smoke test (amd64); Trivy v0.70.0 scan of the slim image: 0 fixable HIGH/CRITICAL; actionlint 1.7.7 on both workflows (clean); notices unit tests; e2e: footer link and notices content; `pnpm test`, `pnpm lint`, `pnpm typecheck`. Not run here: the arm64 job and the release workflow (they run on GitHub; first real run happens on the next pull request / tag).

**Security docs updated:** YES (§10, §11, "Security check: image pipeline and releases (10.4)").

**Remaining:** first GHCR package must be made public once; releases are not reproducible builds; no automatic base-image rebuild when only the OS packages get fixes (Dependabot bumps the pinned digest).

### 10.5 Scheduled backups
**Status:** DONE
**Completed:** 2026-09-28

**Decision (2026-09-28, user):** built-in schedule and retention; encryption stays with established external tools (documented), no home-made crypto.

**Security impact:** LOW — more copies of the sensitive database on the same volume (same `0600`/`0700` protection); retention deletes only automatic backups.

**Implemented:** `BACKUP_INTERVAL_HOURS` (off by default, ≤744) and `BACKUP_KEEP` (default 14); `backupIfDue` (`packages/database/src/backup.ts`): decides from the newest `vergissmeinnicht-auto-<UTC>.sqlite` on disk (restarts neither skip nor repeat), writes through the verified online-backup path, keeps the newest N automatic backups and never touches manual or pre-migration backups or other files; `scheduleBackups` in the server checks at start and every 10 minutes, never overlapping, logs path/count or error type + BackupError message. Documented with an `age`/`restic` off-host example.

**Tests/checks:** backup tests (due/not due across a restart, retention, manual and pre-migration backups untouched, look-alike files ignored, file mode), scheduler tests (off by default, one backup when due, failures logged not thrown), config tests, smoke test in the container (read-only root FS). `pnpm test` 590.

**Security docs updated:** YES (§8).

**Remaining:** off-host copies and encryption remain the operator's job (documented).

---

## 12 — Rollout

### 12.1 User guide and beta releases
**Status:** DONE
**Completed:** 2026-09-28

**Implemented:** `docs/user/user-guide.md` (for people using the app: getting in, roles, writing Procedures, Runs, offline, Knots, settings, server-admin tools; every quoted label checked against the message catalog); README "Get started" (install from a published package or build from source, first steps in the app); the release workflow also accepts `vX.Y.Z-beta.N` / `-rc.N` tags, which publish only their exact version (no `latest`, no minor tag).

**Tests/checks:** actionlint on the workflows; labels verified against `apps/web/src/i18n/en.ts`.

**Security docs updated:** N/A.

### 12.2 Unraid installation
**Status:** DONE
**Completed:** 2026-09-28

**Request (user, 2026-09-28):** install on Unraid; the user runs containers with Unraid's Tailscale feature (HTTPS through Tailscale), no reverse proxy.

**Security impact:** MEDIUM — the container may now start as root (required by Unraid's Tailscale integration); the entrypoint drops the application to an unprivileged user before anything else runs.

**Implemented:**
- Entrypoint: if started as root, re-executes itself as `PUID:PGID` (default 1000:1000; Unraid template 99:100) via `setpriv --clear-groups --inh-caps=-all --bounding-set=-all`; `0` and non-numeric ids refused. Opt-in `VMN_MIGRATE_ON_START` (the normal `migrate`, backup first) before `serve`.
- `deploy/unraid/vergissmeinnicht.xml`: bridge network, no published port, WebUI port 3000 for Tailscale Serve, `TRUSTED_PROXIES=loopback`, PUID/PGID 99/100, `appdata` paths for data and secrets, secrets via `*_FILE`, backups and migration on start.
- `docs/admin/unraid.md`: Tailscale-first guide (MagicDNS + HTTPS certificates, Serve not Funnel, public address = the container's `ts.net` name), first admin from the container console, updates, backups/restore, troubleshooting; reverse-proxy alternative with the fully hardened parameters.

**Tests/checks:** image started as root with PUID/PGID 99/100: application process uid/gid 99/100, `CapEff`/`CapBnd` 0; ready; `admin-bootstrap` via `docker exec` (as root → dropped); data files 99:100; PUID 0 / non-numeric refused (exit 2). Hardened variant (`--user 99:100 --read-only --cap-drop ALL`): migration on start, scheduled backup, restore. Standard smoke test passes. Template XML well-formed.

**Security docs updated:** YES (§11).

**Follow-up (2026-09-28, first install by the user):** the hook refused with `No root privileges!` because the image starts as `node` — the template now sets `--user 0:0` (not Privileged; the entrypoint still drops to 99:100); the SMTP password-file field was hidden under *advanced* and is now always shown; the config error names `SMTP_PASSWORD_FILE`; the guide explains both and the Tailscale state directory. Second report: `SQLITE_CANTOPEN` — the first start (before `--user 0:0`) created the database as the image user 1000; now the entrypoint, when started as root, gives the data directory to PUID:PGID before dropping privileges (not Tailscale's state kept there, never the secrets, symbolic links neither followed nor changed) — reproduced on the 0.1.0-beta.1 image and verified fixed. Guide: secrets permissions, Tailscale certificates, name mismatch.

**Remaining:** Unraid's Tailscale setup itself was not run here (only on Unraid); no Community Applications listing yet.

### 12.3 First beta release (0.1.0-beta.1)
**Status:** DONE
**Completed:** 2026-09-28

**Implemented:** PR #1 merged all work into `main` (first CI run of the full pipeline: tests, e2e, image build + smoke test + Trivy on amd64 and arm64 — all green); tag `v0.1.0-beta.1` published `ghcr.io/crimsonclyde/vergissmeinnicht:0.1.0-beta.1` (index `sha256:e5cbbc3437f0deb8735dfa3f1d609a829f13df88e66fe93cfd57bd846c9281d3`, no `latest`), signed keyless with an SBOM attestation; GitHub pre-release with notes.

**Found by the first CI run:** the `.gitignore` rule `totp*` (for exported TOTP secrets) also matched `packages/auth/src/totp.ts` and `totp.test.ts`, so they had never been committed — builds from a clean checkout failed. Fixed with explicit exceptions for source files; verified in a fresh clone from GitHub (install, typecheck, lint, 593 tests).

**Remaining:** the GHCR package is private until its visibility is set to public (GitHub → Packages → vergissmeinnicht → Package settings); first real installation on Unraid.

### 12.4 Reject invisible characters in email addresses (0.1.0-beta.3)
**Status:** DONE
**Completed:** 2026-09-28

**Found on the first Unraid install:** `admin-bootstrap` accepted an address with a U+FFFD (a mis-decoded paste in the terminal) — the admin account then could not be signed in with the typed address, and bootstrap refused to run again.

**Security impact:** MEDIUM — identifier validation (look-alike accounts).

**Implemented:** `INVISIBLE_OR_INVALID_CHARS` (`\p{Cc}`, `\p{Cf}`, `\p{Co}`, `\p{Cn}`, `\p{Cs}`, U+FFFD) in `normalizeEmail`, used by every path (invitations, acceptance, sign-in lookup, members, recovery, CLIs); the CLIs explain the error ("type it by hand …").

**Tests/checks:** domain tests for U+FFFD, zero-width space/joiner, soft hyphen, bidi override, private use, lone surrogate, non-breaking space; CLI run with the reported address (refused, exit 1) and the typed one (accepted). `pnpm test` 601.

**Security docs updated:** YES (§5).

### 12.5 More icons and an icon picker (0.1.0-beta.4)
**Status:** DONE
**Completed:** 2026-09-28

**Request (user, 2026-09-28):** more Step icons — power, water, gas, internet, offboarding and others — and a good selection box.

**Security impact:** LOW — icons stay trusted keys; a schema migration that rebuilds four tables (data and immutability triggers verified).

**Implemented:**
- 45 new icons (60 in total): utilities (power, water, gas, heating, internet, Wi-Fi, lights, trash, recycling), home (door, window, keys, houseplants, bedroom, bathroom), people & work (onboarding, offboarding, team, work, calendar, mail, phone, school), tech (computer, server, backup, update, launch), care & food (medication, baby, food, coffee, fitness), safety (fire safety, warning, alarm), outdoors & travel (bike, weather, snow, sun, delivery), general (money, clock, settings, camera).
- Migration `0019_procedure_icons` (hand-written table rebuild, generated from the live schema): table `procedure_icons`; `procedures`, `procedure_steps`, `runs`, `run_steps` rebuilt with their definitions unchanged except that the icon CHECK becomes a reference to `procedure_icons`; indexes and the six immutability triggers recreated verbatim. Future icons = one `INSERT`, no rebuild. `runMigrations` applies migrations with foreign keys off (SQLite's rebuild procedure) and then refuses to continue on any foreign-key or integrity problem.
- `IconPicker`: a button with the current icon opens a searchable panel (icon and group names) of large tiles in eight groups; native radio buttons (arrow keys, screen readers), pointer choice closes, Enter/Escape close without submitting the form, focus returns to the button; used for Procedure and Step icons.

**Tests/checks:** `migration-0019.test.ts` (database with Procedures, finished and active Runs at 0018 → 0019: every row identical, every index and trigger identical, finished Runs still frozen, Runs never deleted, snapshot columns immutable, FK and integrity checks clean, new icon usable, unknown icon refused, re-run is a no-op); icon catalog test (every key has artwork, a name and exactly one group); e2e (search, pointer and keyboard choice, Enter does not submit, axe with the panel open); screenshots desktop/phone. `pnpm test`, `pnpm lint`, `pnpm typecheck`.

**Security docs updated:** YES (§5 icons).

### 12.6 Release 0.2.0-beta.1: scheduling, reminders, Home
**Status:** DONE
**Completed:** 2026-09-29

**Request (user, 2026-09-29):** release the section 13 work; version chosen by the user: **0.2.0-beta.1** (minor bump: new features and migration 0020).

**Implemented:** Unraid template and guide point to `ghcr.io/crimsonclyde/vergissmeinnicht:0.2.0-beta.1`. PR #7 merged into `main` at `8cf495f`; tag `v0.2.0-beta.1` points to that merge. The release workflow built, smoke-tested, scanned and pushed native amd64/arm64 images, assembled and signed the multi-architecture image, and attached its CycloneDX SBOM attestation. Published index: `sha256:a0c0dec0f9c69b22703bdcc3e0bfdcf291c07af2c7152aaecd6fd077fc64fa77` (exact version only; no `latest`). GitHub pre-release: `https://github.com/crimsonclyde/vergissmeinnicht/releases/tag/v0.2.0-beta.1`.

The first PR CI run exposed that the new offline common-password dataset and provenance were hidden by the generic `.gitignore` `data/` rule. Narrow exceptions now include `packages/auth/data/README.md` and `common-passwords.txt.gz` in clean checkouts.

**Checks performed:** Confirmed the initial CI root cause (`ENOENT` for the dataset); affected tests 69/69; local full suite 697/697, lint and typecheck; PR CI green (tests, build and e2e; amd64/arm64 image build, smoke test and Trivy); post-merge `main` CI green; release workflow green (checks; native builds, smoke tests and scans; multi-architecture manifest; SBOM; keyless signature and attestation). The published manifest was inspected directly and contains linux/amd64 and linux/arm64.

**Security impact:** MEDIUM — the bundled offline breached/common-password check must be present in every source checkout and release image so password validation fails consistently rather than raising an internal error.

**Remaining:** The workflow does not currently create a GitHub Release despite earlier ledger wording; this pre-release was created manually after the successful workflow and automated creation remains a follow-up. GHCR package visibility still needs an owner-side check if public pulls fail.

**Upgrade note for operators:** migration 0020 (new tables, one added column); `migrate` backs up first (or `VMN_MIGRATE_ON_START=true` on Unraid). Telegram is optional and configured in the app; the server then needs outgoing HTTPS to `api.telegram.org`.

### 12.7 Chimney icon and a gas icon that is not fire (0.2.0-beta.2)
**Status:** DONE
**Completed:** 2026-09-30

**Request (user, 2026-09-29):** "We need def more icons!" — at least a **chimney**, and **gas** must not use a fire glyph.

**Implemented:** new trusted key `chimney` (domain `PROCEDURE_ICONS`, label, *Utilities* group next to heating); migration `0021_chimney_icon` = one `INSERT` into `procedure_icons` (no rebuild, as planned in 12.5). Neither a chimney nor natural gas has a fitting emoji, so both are drawn as small static inline SVGs in the emoji style (`GasArt` — a gas bottle; `ChimneyArt` — a roof with a smoking brick chimney), compiled into the bundle, `aria-hidden` (the label stays the accessible name); `ICON_GLYPHS` now holds `ReactNode`s. Existing Procedures/Runs with `gas` keep their key and simply show the new artwork.

**Tests/checks:** new `packages/database/src/procedure-icons.test.ts` (after all migrations the table holds exactly `PROCEDURE_ICONS` — a key without its migration fails); existing icon catalog test (artwork, name, one group); migration-0019 test; visual check light/dark.

**Security impact:** LOW — one more trusted key via migration; artwork is static code, never data.

**Security docs updated:** YES (§5 icons checklist line).

**Remaining:** ask the user which further icons they want.

### 12.8 Telegram setup UX: bot for the server, chat per person (0.2.0-beta.2)
**Status:** DONE
**Completed:** 2026-09-30

**Request (user, 2026-09-30):** the real-bot pairing works (tested by the user), but the admin page made Telegram look finished after the token was saved; the per-person pairing and the fact that the admin test goes to the admin's own chat were not obvious. UI and help only; architecture unchanged.

**Implemented (web only, no backend change):**
- *Server admin → Notification providers → Telegram* (`TelegramProvider`): scope text ("Configure the Telegram bot used by this VergissMeinNicht instance … each user must connect their own Telegram account …; this page does not choose a destination chat"); field **Bot token** with BotFather/encrypted-storage hint (+ "leave empty to keep" once configured); "✓ Bot connected: @bot — enabled/switched off"; when enabled and the admin has no chat, a **Next step** callout with **Go to my notification settings** (`/account#notifications`, scrolls there); the test is **Send test message to my Telegram**, disabled with an explanation while the admin's own chat is not connected (read from the admin's own `GET /api/account/notifications`, label only; if that read fails the button stays usable and the server decides); a `not_connected` answer shows the explicit "bot configured successfully, but your account is not connected …" message.
- *Profile & settings → Notifications* (`TelegramConnection`): stages unavailable / ready / waiting / claimed / connected (`telegramStage`), a numbered step list (Connect → Open Telegram and press Start → Come back and confirm → Connected) with the current step marked by text/glyph and `aria-current="step"`, "Waiting for Telegram…", confirm/Not me, connected with the safe label; Disconnect; server admins also get *Send test message to my Telegram* there. No chat-id field anywhere.
- Docs: `deployment.md` (two stages, admin steps, user steps, global token vs. per-person destination, no chat id), `user-guide.md`, `unraid.md` (troubleshooting), `architecture.md`, `security.md`.
- Fixed on the way: the token hint rendered inline next to the input.

**Tests/checks:** new `apps/web/src/telegram-setup.test.tsx` (13, server-rendered): bot not configured, configured + admin not paired, configured + admin paired, own state unknown, switched off, `not_connected` message; account: unavailable, ready, pairing pending (link only once), claimed not confirmed, confirmed, disconnected, paused — each asserts no chat-id input and no token/pairing token/chat id in the output. e2e updated (new wording, no test button without a bot, axe). `pnpm lint`, `pnpm typecheck`, `pnpm test` (711), `pnpm build`, `pnpm test:e2e`; screenshots light/dark.

**Security impact:** LOW — presentation only; the admin page additionally reads the admin's *own* notification settings (existing endpoint, own data). Nothing new is exposed: no token, raw chat id or pairing token reaches the UI beyond what 13.7/13.8 already returned (bot name, chat label, the one-time link right after *Connect*).

**Security docs updated:** YES (Telegram security check: UI negative tests).

**Remaining:** ordinary users have no own "send test message" (the confirmation message in Telegram serves as proof; a per-user test would need a new rate-limited endpoint).

### 12.9 Release 0.2.0-beta.2
**Status:** DONE
**Completed:** 2026-09-30

**Request (user, 2026-09-30):** commit, push and release 12.7 and 12.8. Version chosen by the agent: **0.2.0-beta.2** (small migration 0021 + UX fixes). Unraid template and guide point to `ghcr.io/crimsonclyde/vergissmeinnicht:0.2.0-beta.2`.

**Implemented:** committed straight to `main` (`53942fc` feature, `fb3463f` ledger/template); annotated tag `v0.2.0-beta.2` on `fb3463f`. The release workflow ran checks, native amd64/arm64 builds with smoke tests and scans, assembled and signed the multi-architecture image and attached the SBOM. Published index `sha256:999fbf59553484c32b2b6a411bb8eba93c8d1ecef09d5c6f974386e510ff5812` (linux/amd64, linux/arm64; inspected directly). GitHub pre-release created manually: `https://github.com/crimsonclyde/vergissmeinnicht/releases/tag/v0.2.0-beta.2`.

**Checks performed:** local lint, typecheck, 711 unit/integration tests, build, e2e; `main` CI green; release workflow green.

**Security impact:** LOW (see 12.7, 12.8).

**Remaining:** automated GitHub Release creation in the workflow is still open (as in 12.6).

**Upgrade note for operators:** migration 0021 (one row); `migrate` backs up first (or `VMN_MIGRATE_ON_START=true` on Unraid).

### 12.10 Unraid Docker icon
**Status:** DONE
**Completed:** 2026-09-30

**Found (user, 2026-09-30):** Unraid showed the generic Docker icon. The template's `<Icon>` pointed to `apps/web/public/icon.svg`; Unraid caches the icon as a PNG and does not display SVGs reliably.

**Implemented:** `assets/brand/vergissmeinnicht-icon.png` (512×512, rendered from the app icon SVG with `rsvg-convert`); the template's `<Icon>` now points to its raw GitHub URL on `main` (no image release needed); `unraid.md` troubleshooting explains how to update an existing container's Icon URL and clear Unraid's cached icon.

**Tests/checks:** PNG inspected (512×512 RGBA, correct artwork); raw URL on `main` serves `image/png`; on the user's Unraid server the icon appeared after the Icon URL was updated and both cached copies (`/var/lib/docker/unraid/images/` and `/var/local/emhttp/plugins/dynamix.docker.manager/images/`) were deleted.

**Security impact:** NONE (static public image; Unraid fetches it from GitHub, not from the app).

**Security docs updated:** N/A.

### 12.11 Tabler Icons: a much larger, consistent icon set
**Status:** DONE
**Completed:** 2026-09-30

**Request (user, 2026-09-30):** integrate Tabler Icons (`@tabler/icons-react`) as the primary icon library; store stable VMN icon ids, never library names; keep old data working with a fallback for unknown ids; many more icons in useful categories; a searchable picker with aliases and categories; a central `<AppIcon>`; monochrome, theme-safe; no arbitrary icon values; icon ids preserved in import/export; tests; license notice.

**Decisions:** all 61 existing keys stay unchanged (Run snapshots are immutable, so no renaming migration) and map to equivalent Tabler artwork; new concepts get new keys (e.g. `freezer`); words like *electricity* or *plug* are search aliases of `power` rather than duplicate keys. Unknown values render a neutral fallback, but writes and imports keep refusing them (no silent rewrite of an imported file). Gas and chimney stay drawn by hand in Tabler's style, because Tabler only has a flame for gas and no chimney. The icon artwork is bundled as its own chunk (the main chunk had crossed Vite's 500 kB warning).

**Implemented:**
- `@tabler/icons-react@3.48.0` (MIT, exact pin, +`@tabler/icons`) in `apps/web` only.
- Domain `PROCEDURE_ICONS`: 61 → **205** keys; migration `0022_more_icons` inserts the 144 new keys into `procedure_icons` (no rebuild).
- `procedure-icons.tsx` is the central registry (key → artwork, category, aliases; 25 categories: Tasks & time, Home, Doors/windows/keys, Utilities, Kitchen, Bathroom, Cleaning & laundry, Garden, Vehicles, Travel, Safety & first aid, Security, Tools & maintenance, Documents & money, Shopping, Food & drink, Animals, Technology, Communication, People & work, Health, Weather, Storage, Waste & recycling, Miscellaneous); `isIconKey` (own properties only), `searchIcons` (every query word must start a word of the label, key, category or aliases), `AppIcon` (size 1.15em, stroke 1.75, `currentColor`, labelled `role="img"` or decorative, fallback `IconCircleDashed` "Other icon"). All `Icon`/emoji uses replaced.
- Picker: same calm quick view (Suggested, Recently used, Browse all), plus a **Category** select next to the search; native radio groups (keyboard unchanged), tile labels and tooltips, responsive grid.
- `vite.config.ts`: `icons` chunk (main 504 → 436 kB, icons 72 kB / 20 kB gzip); the service worker already caches every asset referenced by `index.html`.
- Docs: `architecture.md` (Icons), `user-guide.md`, `security.md` (§5 icons line), README (third-party notices incl. Tabler). Tabler's MIT text is in `/third-party-notices.txt` automatically (generated from the bundle).

**Tests/checks:** `apps/web/src/procedure-icons.test.tsx` (registry = key list, labels/categories, all 61 old keys still resolve, known icon renders one `currentColor` outline SVG with the shared stroke, decorative mode, fallback for unknown/removed/malicious values incl. `IconSnowflake`, `constructor`, `__proto__`, markup, URLs; aliases power/electricity/plug, fridge→fridge+freezer, trash/bin, car/vehicle, door/key/access, fire, water/plumbing; word-start matching; category filtering); `packages/database`: table = key list after all migrations, `freezer` accepted and `IconSnowflake` refused by the foreign key, import keeps new and old keys and refuses library names/prototype keys/markup/URLs/empty without writing; `packages/import-export`: export writes `"icon":"freezer"` (no library names or SVG) and round-trips; e2e: alias search, Category filter, keyboard choice, axe with the picker open. `pnpm lint`, `pnpm typecheck`, `pnpm test` (721), `pnpm build` (no chunk warning), `pnpm test:e2e`, `drizzle-kit generate` (no drift); full catalog screenshots light/dark.

**Security impact:** LOW — more trusted keys via migration; a new MIT dependency (reviewed: React components only, no install scripts, passed the 24 h minimum release age and trust policy); icon values stay trusted keys end to end.

**Security docs updated:** YES (§5 icons).

**Remaining:** search aliases are English (like the only catalog); more icons on request = registry entry + label + one `INSERT` migration.

### 12.12 Release 0.2.0-beta.3
**Status:** DONE
**Completed:** 2026-09-30

**Request (user, 2026-09-30):** commit, push and release the Tabler icon set (12.11) together with the Unraid PNG icon (12.10). Version: **0.2.0-beta.3**. Unraid template and guide point to `ghcr.io/crimsonclyde/vergissmeinnicht:0.2.0-beta.3`.

**Implemented:** committed to `main` (`7582747` feature, `fed3710` template/ledger); annotated tag `v0.2.0-beta.3` on `fed3710`. The release workflow ran checks, native amd64/arm64 builds with smoke tests and scans, and assembled, signed and SBOM-attested the multi-architecture image. Published index `sha256:340aadb5f675f2c1b4231fac9aced38cd2c3d29c56cb89aa01fcf7659f2df0d3` (linux/amd64, linux/arm64; inspected directly). GitHub pre-release created manually: `https://github.com/crimsonclyde/vergissmeinnicht/releases/tag/v0.2.0-beta.3`.

**Checks performed:** local lint, typecheck, 721 unit/integration tests, build, e2e; `main` CI green; release workflow green.

**Security impact:** LOW (see 12.11).

**Remaining:** automated GitHub Release creation in the workflow is still open.

**Upgrade note for operators:** migration 0022 (144 rows in `procedure_icons`); `migrate` backs up first (or `VMN_MIGRATE_ON_START=true` on Unraid). Existing icons keep their keys and show the new artwork.

### 12.13 Hundreds of icons from Tabler metadata, household icons, ranked search
**Status:** DONE
**Completed:** 2026-09-30

**Request (user, 2026-09-30):** the 205-icon registry is too small (searching *fan* only found Air conditioning). Expose hundreds of useful Tabler icons (not all 5000+), add a fan (`IconFan`, id `fan`, aliases fan/ventilator/ventilation/lüfter/air), dedicated icons for common household concepts, search that finds real-world words naturally; prefer generating the catalogue from Tabler metadata; keep stored ids stable.

**Found:** Tabler 3.48.0 (the latest release) has **no `IconFan`** and no icon for radiator, heater/boiler, dishwasher, sink/tap, shower, roller shutter, valve or fuse box. Its fan-like icons are `propeller` and `car-fan` (both now offered). A purely rule-based selection from the metadata picked up too much noise (`http-get`, `rewind-backward-10`, circuit symbols, laundry-care codes), so the selection is hand-picked and everything else comes from the metadata.

**Implemented:**
- Generator `apps/web/icon-catalog.ts` (`icons:generate`, `icons:check`) + hand-picked `apps/web/icon-selection.json` (entries `tabler-name[>vmn-key]|Label|search words`, `$ignoreTags`) → `src/icon-catalog.generated.ts` (artwork imports, English labels, aliases, Tabler tags; Tabler tags for the hand-written entries too) and `packages/domain/src/procedure-icon-keys.generated.ts` (append-only). Refuses unknown/non-outline names, clashing keys (`storm` → `hurricane`), reused artwork, bad key formats, dropped keys. `@tabler/icons@3.48.0` (metadata, same MIT package the React one depends on) as an exact-pinned dev dependency.
- Nine drawn household icons in Tabler's style: **fan** (with the requested aliases), radiator, boiler, fuse box, valve, shower, sink, dishwasher, roller shutter.
- **594 icons** (205 existing unchanged + 9 drawn + 380 generated) in 28 categories (new: Sport & leisure, Clothing, Buildings & places); migration `0023_tabler_icon_catalogue` inserts the 389 new keys.
- Ranked search (`rankIcons`): label/key/VMN aliases 10 (word start 6), Tabler tag 4 (word start only from 4 letters: *fan* does not find *fantasy*), category 3/2, +5 when the query is the whole label; the picker shows search results as one list, best first ("12 matching icons"); browsing stays grouped. Generated labels are English (messages `icon.<key>` override them).
- `icons` chunk now also holds the generated catalogue and drawn art (main 441 kB, icons 265 kB / 69 kB gzip; no size warning).

**Tests/checks:** `apps/web/src/procedure-icons.test.tsx` — every word of the request (fan … travel, incl. *lüfter*, *washing machine*, *fire extinguisher*, *first aid*) has a dedicated icon among the first three results; *fan* first is Fan and never Dragon; *box* first is Box; aliases; categories; 500–1000 icons; unique labels; generated files current. `apps/web/src/icon-catalog.test.ts` — generator output, `$ignoreTags`, and every refusal incl. dropped keys. Existing: table = key list after all migrations, fallback/malicious values, import/export, 61 original keys. e2e (exact radio names now: *Power* also appears in *Solar power*). `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:e2e`, `drizzle-kit generate` (no drift); screenshots of the drawn icons and search results light/dark.

**Security impact:** LOW — more trusted keys via migration; a build-time generator (never runs in the app or on user input); dev dependency from the same MIT publisher/version already in use.

**Security docs updated:** YES (§5 icons line).

**Remaining:** search words are English (plus *lüfter* for the fan); if a later Tabler release adds `IconFan`, the drawn fan can switch artwork without changing the stored key `fan`.

### 12.14 Release 0.2.0-beta.4
**Status:** DONE
**Completed:** 2026-09-30

**Request (user, 2026-09-30):** release 12.13. Version: **0.2.0-beta.4**. Unraid template and guide point to `ghcr.io/crimsonclyde/vergissmeinnicht:0.2.0-beta.4`.

**Implemented:** committed to `main` (`01b0f78` feature, `66bae3c` template/ledger); annotated tag `v0.2.0-beta.4` on `66bae3c`. The release workflow ran checks, native amd64/arm64 builds with smoke tests and scans, and assembled, signed and SBOM-attested the multi-architecture image. Published index `sha256:d89c68e818508ad73cba65cc448abd766737e27607a8157234992b331b5e96c1` (linux/amd64, linux/arm64; inspected directly). GitHub pre-release created manually: `https://github.com/crimsonclyde/vergissmeinnicht/releases/tag/v0.2.0-beta.4`.

**Checks performed:** local lint, typecheck, 728 unit/integration tests, build, e2e, icon catalogue check; `main` CI green; release workflow green.

**Security impact:** LOW (see 12.13).

**Remaining:** automated GitHub Release creation in the workflow is still open.

**Upgrade note for operators:** migration 0023 (389 rows in `procedure_icons`); `migrate` backs up first (or `VMN_MIGRATE_ON_START=true` on Unraid). Existing icons keep their keys.

### 12.15 Release 0.3.0-beta.1
**Status:** DONE
**Completed:** 2026-09-30

**Request (user, 2026-09-30):** release 14.0–14.2 for testing. Version chosen by the user: **0.3.0-beta.1** (minor bump: recurring Schedules, Reminders, assignment, new Home; migration 0024). Unraid template and guide point to `ghcr.io/crimsonclyde/vergissmeinnicht:0.3.0-beta.1`.

**Implemented:** committed to `main` (`10c7986` 14.0, `fe55c2e` 14.1/14.2, `7eef00c` template/ledger); annotated tag `v0.3.0-beta.1` on `7eef00c`. The release workflow ran checks, native amd64/arm64 builds with smoke tests and scans, and assembled, signed and SBOM-attested the multi-architecture image. Published index `sha256:90daf6d2d8ac1dee7089ac453982f1891eb14cf3c89fd4e4547525e1e4154d97` (linux/amd64, linux/arm64; inspected directly; the image tag has no `v`). GitHub pre-release created manually: `https://github.com/crimsonclyde/vergissmeinnicht/releases/tag/v0.3.0-beta.1`.

**Checks performed:** local lint, typecheck, 756 unit/integration tests, build, e2e, schema drift; `main` CI green; release workflow green.

**Remaining:** beta test with real email/Telegram reminders and an upgrade of real data; automated GitHub Release creation still open.

**Upgrade note for operators:** migration 0024 converts every scheduled Procedure into a one-time Schedule with one Occurrence (same ids, reminders and delivery records kept; nothing already sent is sent again); `migrate` backs up first (or `VMN_MIGRATE_ON_START=true` on Unraid). Recommended: try the upgrade on a copy of the database first.

### 12.16 Release 0.3.0-beta.2
**Status:** DONE
**Completed:** 2026-10-01

**Request (user, 2026-10-01):** commit and release 14.3 (instruction images) as **0.3.0-beta.2** so it can be tested on a real iPhone. Unraid template and guide point to `ghcr.io/crimsonclyde/vergissmeinnicht:0.3.0-beta.2`.

**Fixed before the release:** `backup-media.test.ts` set a backup store file's time from the wall clock but pruned with injected backup times, so it failed from 2026-10-01 on; the test now uses the injected times throughout (test only, no behaviour change).

**Implemented:** committed to `main` (`3617cae` 14.3, `597b57a` template/ledger); annotated tag `v0.3.0-beta.2` on `597b57a`. The release workflow ran checks, native amd64/arm64 builds with smoke tests and scans, and assembled, signed and SBOM-attested the multi-architecture image. Published index `sha256:fbadc13d2f9422cdacf5a5ca5b0b6921263aff4e05524d2f773c3590970884cc` (linux/amd64, linux/arm64; inspected directly; the image tag has no `v`).

**Checks performed:** local lint, typecheck, 796 unit/integration tests, build, e2e, `pnpm audit --audit-level high`; `main` CI green (both commits); release workflow green. Docker build and smoke test ran in CI and the release workflow (locally on 2026-09-30).

**Security surface:** unchanged by the release itself (14.3 is recorded in its own entry and in security.md).

GitHub pre-release created later on 2026-10-01 (after the user approved the command): `https://github.com/crimsonclyde/vergissmeinnicht/releases/tag/v0.3.0-beta.2`.

**Remaining:** real-iPhone test of instruction photos (14.3 Remaining); beta test from 12.15 still open; automated GitHub Release creation still open.

**Upgrade note for operators:** migration 0025 adds instruction images (`step_images`, image columns on Steps and Run Steps, a per-Workspace photo quota of 100 MB by default); existing data is unchanged. Photos are stored in `/data/media`; **a backup is now the `.sqlite` file together with `backups/media/`** (docs/admin/deployment.md). `migrate` backs up first (or `VMN_MIGRATE_ON_START=true` on Unraid).


### 12.17 Release 0.3.0-beta.3
**Status:** DONE
**Completed:** 2026-10-01

**Request (user, 2026-10-01):** release the menu fix (13.20) as **0.3.0-beta.3**, so instruction photos (14.3) can be tested on a real iPhone. Unraid template and guide point to `ghcr.io/crimsonclyde/vergissmeinnicht:0.3.0-beta.3`. No migration since 0.3.0-beta.2; upgrading from 0.3.0-beta.1 runs migration 0025 (see 12.16).

**Implemented:** committed to `main` (`d6daf4a` 13.20, `004feb5` template/ledger); annotated tag `v0.3.0-beta.3` on `004feb5`. The release workflow ran checks, native amd64/arm64 builds with smoke tests and scans, and assembled, signed and SBOM-attested the multi-architecture image. Published index `sha256:1603a26d2d86c26bf9e6cf8f9275a27864f277a7cd0236ac8dc64fd24ad28331` (linux/amd64, linux/arm64; inspected directly; the image tag has no `v`).

**Checks performed:** local lint, typecheck, 800 unit/integration tests, build, e2e; `main` CI green (both commits); release workflow green.

**Security surface:** unchanged.

GitHub pre-release created by the user: `https://github.com/crimsonclyde/vergissmeinnicht/releases/tag/v0.3.0-beta.3`.

The missing pre-release page for `v0.3.0-beta.2` was added the same day, after the user approved the command.

**Remaining:** rest of the real-iPhone photo matrix (14.3 Remaining); automated GitHub Release creation still open.


### 12.18 Release 0.3.0-beta.4
**Status:** DONE
**Completed:** 2026-10-01

**Request (user, 2026-10-01):** release the calendar and agenda (14.4) as **0.3.0-beta.4**. Unraid template and guide point to `ghcr.io/crimsonclyde/vergissmeinnicht:0.3.0-beta.4`. No migration since 0.3.0-beta.2.

**Implemented:** committed to `main` (`faca8d5` 14.4, `9c01abb` template/ledger); annotated tag `v0.3.0-beta.4` on `9c01abb`. The release workflow ran checks, native amd64/arm64 builds with smoke tests and scans, and assembled, signed and SBOM-attested the multi-architecture image. Published index `sha256:60d479a7635f06bcf6922557949339dc2d3ef5ef8dfb222df8f8f680e201d5b8` (linux/amd64, linux/arm64; inspected directly; the image tag has no `v`).

**Checks performed:** local lint, typecheck, 820 unit/integration tests, build, e2e; `main` CI green (both commits); release workflow green.

**Security surface:** unchanged by the release itself (14.4 is recorded in its own entry and in security.md).

GitHub pre-release created after the user approved the command: `https://github.com/crimsonclyde/vergissmeinnicht/releases/tag/v0.3.0-beta.4`.

**Remaining:** beta test of the calendar, also on a real phone; automated GitHub Release creation still open.

### 12.19 Release 0.4.0-beta.1
**Status:** DONE
**Completed:** 2026-10-01

**Request (user, 2026-10-01):** commit and push section 15 and release it as **0.4.0-beta.1**. Unraid template and guide point to `ghcr.io/crimsonclyde/vergissmeinnicht:0.4.0-beta.1`. **This release has a migration (`0026_lists`)**: run `migrate` as usual (or `VMN_MIGRATE_ON_START=true` on Unraid); it only adds two tables, and a backup is taken first.

**Implemented:** section 15 committed to `main` as `a45207e` (the `assets/` folder — mockups and screenshots — is not part of the repository); template and this entry in `fc807b6`; annotated tag `v0.4.0-beta.1` on `fc807b6`. The release workflow ran checks, native amd64/arm64 builds with smoke tests and scans, and assembled, signed and SBOM-attested the multi-architecture image. Published index `sha256:485074caf0485c4e000e0fed8a2d51ed4f733ae603dd6f6425b5cd3f90a0e546` (linux/amd64, linux/arm64; inspected directly; the image tag has no `v`). GitHub pre-release: `https://github.com/crimsonclyde/vergissmeinnicht/releases/tag/v0.4.0-beta.1`.

**Checks performed:** local lint, typecheck, 874 unit/integration tests, build, e2e, migration drift check; `main` CI green for `a45207e` and `fc807b6`; release workflow green.

**Security surface:** unchanged by the release itself (section 15 is recorded in its own entries and in security.md).

**Remaining:** beta test on real phones (15.4 Remaining); automated GitHub Release creation still open.

### 12.20 Release 0.5.0-beta.1
**Status:** DONE
**Completed:** 2026-10-02

**Request (user, 2026-10-02):** commit and push Phase 1 of section 16 (Documents) and release it. The user first named 0.4.0-beta.1; that version exists already (12.19), and asked which version to use, the user chose **0.5.0-beta.1**. Unraid template and guide point to `ghcr.io/crimsonclyde/vergissmeinnicht:0.5.0-beta.1`. **This release has four migrations (`0027_document_files`, `0028_documents`, `0029_document_search`, `0030_workspace_storage`)**: run `migrate` as usual (or `VMN_MIGRATE_ON_START=true` on Unraid); they add tables and columns, change no existing content, and a backup is taken first. **Existing Unraid containers need the new Extra Parameters added by hand** (`--memory=4g --memory-swap=4g --restart=unless-stopped`, `unraid.md`).

**Implemented:** Phase 1 committed to `main` as `c1dcdc0` (the `assets/mock-ups` and `assets/screenshots` folders are not part of the repository); template and this entry in `2aca279`; annotated tag `v0.5.0-beta.1` on `2aca279`. The release workflow ran checks, native amd64/arm64 builds with smoke tests and scans, and assembled, signed and SBOM-attested the multi-architecture image. Published index `sha256:63cb5ba05ff626f38bf426b60396509d4d81ff3611f7f40d0bbef95e808ce161` (linux/amd64, linux/arm64; inspected directly; the image tag has no `v`). GitHub pre-release: `https://github.com/crimsonclyde/vergissmeinnicht/releases/tag/v0.5.0-beta.1`.

**Checks performed:** local lint, typecheck, 1045 unit/integration tests, build, e2e, production image build and `deploy/smoke-test.sh` (16.4); `main` CI green for `c1dcdc0` and `2aca279` (checks, both image builds, smoke test, vulnerability scan — the first CI run of the section 16 code); release workflow green.

**Security surface:** unchanged by the release itself (section 16 is recorded in 16.1–16.4 and in security.md).

**Remaining:** **Released at the owner's request before the two checks of the owner's pre-release list were run on the Unraid host** (`deploy/memory-check.sh`, `deploy/restart-check.sh` — both passed on the development machine only); they remain to be run there. Beta test on real phones, with a guest account and a screen reader (16.2–16.4 "Not run").

### 12.21 Release 0.5.0-beta.2
**Status:** DONE
**Completed:** 2026-10-02

**Request (user, 2026-10-02):** commit, push and release the work through 16.7 as `0.5.0.beta.2`, as a prerelease, with the repository's release workflow; record P3 for Equipment (guests see everything incl. costs and serial numbers, read-only); do not implement 16.8; do not deploy to the running Unraid installation. By the repository's conventions the tag is **`v0.5.0-beta.2`** and the image `ghcr.io/crimsonclyde/vergissmeinnicht:0.5.0-beta.2` (the release workflow only accepts `-beta.N`; package versions are not used for releases). Unraid template and guide point to that image. **This release has four migrations (`0031_links`, `0032_run_document_removals`, `0033_contacts`, `0034_maintenance`); 0033 and 0034 rebuild the small `workspace_tools` table (data copied).**

**Implemented:** steps 16.5 (links, incl. P4), 16.6 (Contacts) and 16.7 (Maintenance) committed to `main` as `aeb4ca9`; template, guide and this entry in `d0eb051`; annotated tag `v0.5.0-beta.2` on `d0eb051`. The release workflow ran the checks, native amd64 and arm64 builds with smoke tests and vulnerability scans, and assembled, signed and SBOM-attested the multi-architecture image. Published index `sha256:87b8d4706b6848d1a0ee5f18498d6aaa825c2d35fd95b1b141f5cc74fa7e9274` (linux/amd64, linux/arm64). GitHub prerelease: https://github.com/crimsonclyde/vergissmeinnicht/releases/tag/v0.5.0-beta.2 — its notes describe the new features, the upgrade, what to change by hand on Unraid, and what was not checked. As for the earlier releases the image is the release artifact; the GitHub release carries no files of its own. P3 recorded in 16.12. The test environment's demo data (`test-env/seed.ts`) gained Contacts and Maintenance; running it against a throwaway server showed that it had been failing since 16.2 — it signed the admin out before switching Documents on — which is fixed (the admin now stays signed in until the tools are on).

**Checks performed before committing (all on the final tree):** `pnpm lint`, `pnpm typecheck`, `pnpm test` (138 files, 1120 tests), `pnpm build`, `pnpm test:e2e`, production image build and `deploy/smoke-test.sh`. **On GitHub:** `main` CI green for `aeb4ca9` and `d0eb051` (checks, both image builds with smoke test and scan); release workflow green for the tag (run 37047949225). **Migration coverage:** `drizzle-kit generate` reports no difference between the schema and the migrations (35 migrations, journal complete); a database built with the migrations of `v0.5.0-beta.1` (31), holding a Workspace with Documents switched on, was upgraded with `migrate`: 35 applied, the tool switch kept, the seven new tables present, no foreign-key violation, integrity `ok`, and a new tool accepted afterwards. The whole diff was reviewed before committing — for leftovers (temporary screenshots, debug output), secrets, invisible or bidirectional characters in source (two literal ones were replaced by escapes) and files that do not belong (the `assets/mock-ups` and `assets/screenshots` folders stay outside the repository) — including the end-to-end steps of 16.5 and P4 in `e2e/account.spec.ts`, which had been rebuilt from the session transcript after a mistaken `git checkout` of that file and were compared with the commands that had originally written them. The seed was run once against a throwaway server and database.

**Security surface:** unchanged by the release itself (16.5–16.7 are recorded in their steps and in security.md).

**Remaining:** see "Handoff after 0.5.0-beta.2" in Current state.

---

## 13 — Remembering Procedures: scheduling, reminders, Home (accepted 2026-09-29)

**Request (user, 2026-09-29):** VMN exists so people do not forget repeatable procedures. Main flow: *Procedure → optionally schedule it → receive reminders → Start → execute → trustworthy history*. Not a task manager, calendar, Kanban, workflow engine or chat. MFA stays optional (the beta runs behind a VPN); the enforcement seam stays. Stack, architecture, Run snapshot model and audit trail stay unchanged. Implementation order as listed; focused commits.

**Out of scope (this pass):** mandatory MFA, folders, generic tasks, calendar events, recurring schedules/cron, Kanban, comments/chat, attachments, photos, geolocation, AI, Web Push, SMS, WhatsApp, analytics, branching, queues/Redis/Kubernetes.

### 12.22 Release 0.5.0-beta.3
**Status:** DONE (2026-10-04)

**Request:** stabilize PR #15, review it, test the upgrade/restore, measure and shorten validation, then commit, push and publish a release with notes. The next beta is `v0.5.0-beta.3`; image `ghcr.io/crimsonclyde/vergissmeinnicht:0.5.0-beta.3`. Release publishing is authorised; no deployment to the running Unraid installation.

**Scope:** 17.1–17.3 (all implemented tools optional, scoped Today progress, actual demo screenshots), verified tool/file/notification security fixes, PCRE2 runtime patch and faster CI/fixture validation (17.4). Migrations 0035/0036 bring the schema from 35 to 37 migrations; upgrades preserve core availability/house flags and content, new Workspaces start with every tool off. Template and Unraid guide point to the new exact beta tag. Release remains gated on the complete CI, both native publishing smoke tests/scans, multi-architecture manifest, signatures and SBOM.

**Checks:** populated fictional beta.2 upgrade with verified backup/restore and original bytes/history intact; fixture-isolation/FK/mode regression; full local suite 143 files / 1138 tests, typecheck/lint, schema generation (no drift), production image build/smoke and diff checks passed. PR CI 37214175964, main CI 37214457266 and release workflow 37214476732 all passed. Browser checks: 3 passed / 1 intentional mobile-flow skip; amd64/arm64 validation and publishing smoke/scans passed with no fixable HIGH/CRITICAL finding. Security surface and remaining limits are documented in 17.1–17.4 and security §15. Real production-data upgrade, physical devices, screen reader and Unraid resource/restart checks are not performed here.

**Published:** stabilization commit `3de6fa5`, PR #15 merged as `799bb70a9bcb9081a8c63f2e45fc2702218d6c57`; annotated tag `v0.5.0-beta.3` on that merge commit. Multi-architecture index `sha256:f278032b4a8ef071eeca07f9de9f278b9d0d8339c5fd997f2eccb83fd7264e77` inspected directly (linux/amd64, linux/arm64); signing and CycloneDX attestation steps succeeded. GitHub prerelease with feature/security/upgrade/performance notes: https://github.com/crimsonclyde/vergissmeinnicht/releases/tag/v0.5.0-beta.3. Only the exact beta image tag was published; `latest` was not moved. Completion is recorded in a follow-up documentation commit after publication.

**Observed speed:** complete PR CI 5m18 → 3m00 (~43% reduction); CI unit/integration step 1m52 → 1m11 (~37% reduction), including two added regressions. Same-machine unchanged local suite 32.7 → 29.1 seconds (~11% in one paired sample). Tests, security/authentication settings, accessibility checks and release scan gates are retained. Times vary with runner/load; no guaranteed speedup is claimed.


### 12.23 Release 0.5.0-beta.4
**Status:** DONE (2026-10-04)

**Scope:** 16.8 Equipment and iPhone/Android-compatible Contacts .vcf exports. Continue the owner's requested fix/review/test, commit, push and release workflow. Tag `v0.5.0-beta.4`; image `ghcr.io/crimsonclyde/vergissmeinnicht:0.5.0-beta.4`. Unraid template and guide point to the new exact beta. No deployment to the running Unraid installation.

**Upgrade:** migration 0037 adds Equipment metadata and typed links and expands the Workspace tool constraint while preserving existing tool flags/revision. Equipment is off on upgrade and in new Workspaces until a Workspace admin enables it. Back up database and file storage before updating, apply the normal migration command, then optionally enable Equipment. No OCR/AI/Mail implementation (16.9–16.11).

**Published:** commits `704b01c` and `0c0f0bd`; PR #16 merged as `1012613282557a26c556abd038d8f40ea1346983`. Annotated tag `v0.5.0-beta.4` points to that merge. GitHub prerelease with feature, security, validation and upgrade notes: https://github.com/crimsonclyde/vergissmeinnicht/releases/tag/v0.5.0-beta.4. Published image index `sha256:ef993baa822e904f884325bf7c88c139807ee9b4acd42351b12cd5402ff265b9` inspected directly: linux/amd64 and linux/arm64. Only the exact beta tag was published; `latest` was not moved.

**Validation:** implementation and local checks recorded in 16.8 (146 files / 1154 tests, 27.30 s; Playwright 3 passed / 1 intentional skip; typecheck/lint/build/schema checks). Final PR CI `37218359808`, main CI `37218652596` and release `37218676293` succeeded. Both native validation and publishing images passed smoke tests and fixable HIGH/CRITICAL vulnerability scans; manifest publishing, workflow signing and CycloneDX attestation succeeded. Completion is recorded in a documentation commit after publication. Physical-phone imports, live Unraid upgrade and the existing development-only moderate esbuild finding remain open. Security surface: MEDIUM, documented in `security.md`; release validation must remain fail-closed.

### 13.1 Offline device data: sign-out cleanup and account binding
**Status:** DONE
**Completed:** 2026-09-29

**Found (review of `apps/web/src/offline/store.ts`):** sign-out resolved "cleanup done" on `deleteDatabase`'s `onblocked` — while another tab held the database, the saved Runs and queue could stay on the device although the app reported them gone. Tabs share one session cookie: a second tab still showing account A could send A's queued changes after B signed in elsewhere (the server would have recorded them as B's).

**Security impact:** HIGH — Workspace data at rest on shared devices; misattribution of execution history.

**Implemented:**
- `offline/cleanup.ts`: sign-out tells other tabs first, empties every VMN store in one transaction (data gone even if the file stays), then deletes the database, waiting ≤3 s for other tabs to let go. `onblocked` is never success; the result is `deleted` / `emptied` / `failed`; `failed` shows an alert on the sign-in page (close every tab, clear site data).
- Every database connection closes itself on `versionchange`, so other tabs never block the deletion.
- `offline/session-channel.ts` (BroadcastChannel `vmn-session`, no secrets): on `signed-out` other tabs drop the account at once (sign-in page); on `signed-in` of another account they re-check the session. Device storage is suspended from sign-out until the next account is known (late writes cannot re-create data).
- Before sending queued changes the client checks that the current session belongs to the account that queued them; otherwise nothing is sent.
- Server: an offline change now carries `offline.userId` (required); the use-case refuses it with `409 offline_account_mismatch` unless it is the signed-in account — before any write. The client keeps such changes for their own account ("sign in again").
- Service worker unchanged (app shell only, never `/api`).

**Tests/checks:** `apps/web/src/offline/cleanup.test.ts` (order announce → empty → delete; blocked never reported as deleted; timeout; errors; message parsing; tab reactions), queue outcome for `offline_account_mismatch`; use-case test (change queued by another account refused, nothing written, no live event); HTTP test (mismatch 409 both ways; strict body incl. missing/malformed `userId`); e2e: a second tab of the same browser shows the sign-in page after the first tab signs out and the device database is gone. `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm test:e2e`.

**Security docs updated:** YES ("Security check: offline Run execution", addendum 13.1).

**Remaining:** browsers without BroadcastChannel fall back to the per-send session check and the server-side refusal; a tab frozen by the browser receives the message when it resumes; physical-device testing still open (8.5).

### 13.2 Security checklist closure
**Status:** DONE
**Completed:** 2026-09-29

**Implemented:** every unchecked item of `security.md` reviewed against the code; ticked only with evidence:
- `apps/server/src/http/route-security.test.ts` runs against the **registered route table** (`app.routeTable`, collected by an `onRoute` hook), so routes added later are covered automatically: pinned list of public routes; 401 without a session on every other route; non-member → 404 on every Workspace route (no content in the body); every Workspace child id (Procedure, Run, Step, Knot, member, target of `POST …/runs` / `…/knots`) used under another Workspace → 404 and nothing changes; malformed / upper-case / nil UUIDs in every path parameter → 400/404, never 5xx; every `/api/admin/*` route → 403 for non-admins.
- **Gap found and fixed:** `GET …/procedures/{id}/history` answered `200 []` for a Procedure id of another Workspace (no data leaked — the query was Workspace-scoped — but it did not behave like an unknown id). Now `404 procedure_not_found` unless the Procedure (also soft-deleted) is in the Workspace.
- Static guards: `packages/database/src/sql-safety.test.ts` (`sql.raw` only in schema CHECK constraints from compile-time constants; no interpolated or concatenated `prepare`/`exec`), `apps/server/src/http/web-output-safety.test.ts` (no HTML sinks in the web client).
- Reviewed: every route parses params/query/body with strict Zod schemas (the two direct `request.body` reads are the sign-in limiter key after parsing and the strict import parser); auth/crypto libraries current and maintained (better-auth 1.7.6, @node-rs/argon2 2.2.1, otpauth 9.5.2, nodemailer 10.0.10 — 10.0.12 available, left to Dependabot review); `pnpm audit`: only the known moderate dev-only drizzle-kit/esbuild advisory.

**Left open deliberately:** external-login items (deferred, 2.6), PostgreSQL migration (future), "security-sensitive upgrades receive explicit review" (standing rule, not closable once), breached-password blocklist (13.3), exception serialization for the new notification credentials (13.7).

**Tests/checks:** new tests above; mutation check: without the history fix the route test fails; `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm audit`.

**Security impact:** MEDIUM — one isolation inconsistency fixed; generic regression tests for every route.

**Security docs updated:** YES (§2, §3, §5, §10).

### 13.3 Common/breached-password blocklist
**Status:** DONE
**Completed:** 2026-09-29

**Security impact:** MEDIUM — closes the open §1 item; passwords stay on the server.

**Implemented:**
- Domain (`packages/domain/src/password.ts`): `validateNewPassword(password, { common, context })` keeps the 15–128 length policy and no composition rules, and now also rejects (a) passwords on the common/breached list (`password_too_common`), (b) repetitive or sequential patterns — one unit of ≤4 characters repeated, runs along the alphabet, digits or QWERTY/QWERTZ/AZERTY rows, forwards or backwards (`password_too_predictable`), (c) passwords that are mostly context words — the service name, the account's email (whole, local part, its parts) and display name — leaving fewer than 8 own letters/digits (`password_too_predictable`). Comparison form: NFKC (as the hasher), lower case, no white space.
- Offline list (`packages/auth/data/common-passwords.txt.gz`, 560 KB, 60 003 entries): the most common 15+ character passwords of three public breach corpora (SecLists, MIT: NCSC top 100k, xato 1M, Pwdb top 10M, merged by rank), hash-like hex strings excluded, loaded once into a `Set` on first use. Provenance and update procedure in `packages/auth/data/README.md`; maintainer tool `node packages/auth/scripts/update-common-passwords.ts` (network access, never used by the server). No password or hash is ever sent anywhere.
- Checked on every path that sets a password: invitation acceptance (context: invited email + chosen name), self-service change and admin-assisted recovery (context: the account's email + name) — before hashing, nothing written on refusal.
- Web: hint under every new-password field; messages for both codes. Test passwords changed from "correct horse battery staple" (now correctly refused).

**Tests/checks:** `packages/domain/src/password.test.ts` (list match through case/spaces/full-width forms, patterns, context words, acceptable passphrases, no echo), `packages/auth/src/common-passwords.test.ts` (bundled, size, known entries, comparison form only), use-cases for acceptance/change/recovery (refused, invitation/recovery still usable, no sessions revoked, no events), HTTP `400 {error: 'password_too_common', field: 'password'}`. The first list build excluded all-digit passwords by mistake (hash filter) — found by the test, fixed. `pnpm test`, `pnpm lint`, `pnpm typecheck`.

**Security docs updated:** YES (§1).

**Remaining:** the list is a snapshot (update procedure documented; refresh with releases); the server keeps ≈5 MB for the list after the first password change; existing passwords are not re-checked (they are checked when changed).

### 13.4 Scheduled Procedures (domain, database, application)
**Status:** DONE
**Completed:** 2026-09-29

**Security impact:** MEDIUM — new Workspace-scoped resource with its own capability; no new credential.

**Decisions (made here, documented):** name **ScheduledProcedure** (Procedure vocabulary; not a Run); an item is Workspace-visible (`procedure.view`), managed with the new capability `schedule.manage` (USER, EDITOR, ADMIN — like `run.start`); **reminders go to the person who scheduled it** (no Workspace-wide broadcast); a started or cancelled item is final; items are never deleted; editing the source Procedure changes what a later Start snapshots (the Run is taken from the Procedure *at Start*); a deleted source Procedure leaves the item visible as unavailable — it can be cancelled but never started, and no reminders are sent for it (13.5).

**Implemented:**
- Domain `schedule.ts`: `ScheduledProcedure`, states SCHEDULED / STARTED / CANCELLED; calendar date + optional time + IANA zone (validated with Intl, no offsets) + reminder time; reminder offsets `DAYS` 0–30 (at the reminder time) and `HOURS` 1–48 (before the due moment), ≤5, de-duplicated and ordered; DST-aware wall-clock → instant conversion without a library (gap → later, overlap → earlier, like Temporal "compatible"); due/overdue judged by the calendar date in the item's own zone; dates today … +731 days; `upcomingReminders` drops past instants and sends one reminder per instant.
- Database (migration 0020, hand-edited): `scheduled_procedures` (CHECKs for formats/state/closing; triggers: never deleted, identity immutable, closed = final), `scheduled_reminders` (one row per instant for the recipient; cancelled — not deleted — when moved/started/cancelled; a processed instant is never stored again), plus the tables for 13.5–13.13.
- Application `schedules/`: schedule, reschedule (revision compare-and-set), cancel, list open, get, **start** — `startRun` with `fromSchedule`: the Run snapshot and closing the item as STARTED happen in one IMMEDIATE transaction (`RUN_STARTED` metadata carries `scheduleId`); audit events `SCHEDULE_CREATED/CHANGED/CANCELLED` (subject `schedule`) — never execution evidence.
- HTTP: `GET/POST /api/workspaces/{id}/schedules`, `GET …/{scheduleId}`, `POST …/{scheduleId}/update|cancel|start`; strict bodies; display names only.
- Limits: ≤1000 open items per Workspace, 4 KiB bodies.

**Tests/checks:** domain (11: formats, zones, reminder bounds, DST gap/overlap in Berlin and New York, day- vs hour-based reminders across DST, due by local date, past/far dates); use-cases (13: no Run on create or when the date passes, default reminder time, past reminders dropped, one per instant, server-side validation, GUEST/non-member/foreign Procedure, in-transaction guard (mutation-checked), reschedule replaces unsent reminders and never repeats a sent one, cancel, start once → normal Run + closed item, deleted Procedure → unavailable, audit rollback, DB triggers); HTTP (3) and the route-table test now covers all schedule routes. `pnpm test`, `pnpm lint`, `pnpm typecheck`.

**Security docs updated:** YES ("Security check: scheduled Procedures and reminders", §3).

### 13.5 Reminder persistence and scheduler
**Status:** DONE
**Completed:** 2026-09-29

**Security impact:** MEDIUM — Workspace content leaves the server in reminders; spam/duplication risk.

**Implemented:**
- `scheduled_reminders` (13.4) + `reminder_deliveries`: one row per (reminder, channel), unique, claimed in an IMMEDIATE transaction *before* sending (status SENDING with a 5-minute lease, attempt counter); outcomes SENT / RETRY (next attempt) / FAILED / SKIPPED with a stable error code only; a reminder is processed when all its channels are final, otherwise it is not looked at before the earliest retry.
- `dispatchDueReminders` (application): ≤50 due reminders per run; checks at send time that the recipient (the person who scheduled the item) is ACTIVE and still a member with `procedure.view`, the item still open and the Procedure not deleted — otherwise nothing is sent; channels = providers the server enabled **and** the person enabled/connected; ≤4 attempts (1 min, 10 min, 1 h), permanent errors not retried; reminders >24 h late are dropped; the message links to the Workspace Home (plain URL, sign-in required).
- Scheduler in the server process (`apps/server/src/reminder-schedule.ts`): every minute, never overlapping; the Telegram pairing poll every 3 s only while a pairing is open (13.7); logs counts and error type/code only. No queue, worker or extra deployment; the database is the source of truth, so restarts just continue.
- Provider port `ReminderNotifier` (channel, `enabledFor`, `send`) — future ntfy/Gotify/webhook/Web Push adapters plug in here.

**Tests/checks:** `packages/database/src/reminder-dispatch.test.ts` (9: nothing early; once per channel, also after a restart; two concurrent dispatchers; interrupted claim retried only after the lease; bounded retries with delays, given up for good; permanent failure not retried and schedule/Runs/audit untouched; removed member, deleted Procedure, cancelled item → nothing; disabled channel; stale reminders dropped), `apps/server/src/reminder-schedule.test.ts` (no overlap; error log without messages).

**Remaining:** reminders go to the scheduler only (no per-item recipients); delivery history is not shown in the UI; a crash between the provider accepting a message and the outcome being recorded can repeat that single message (bounded).

**Security docs updated:** YES.

### 13.6 Email reminders
**Status:** DONE
**Completed:** 2026-09-29

**Implemented:** `emailReminderNotifier` reuses the existing SMTP `EmailSender` (no second email stack): plain text with the Procedure title, the date in words with time and zone, "in 7 days / tomorrow / today / in 2 hours / overdue", the Workspace name and the link to the Workspace Home; texts in the email catalog (`reminder`, `providerTest`). On unless the server admin switches email reminders off (`notification_providers` row EMAIL) or the person does (Account → Notifications). No Knot or other token in reminders.

**Tests/checks:** email text tests (subjects per offset, date format, no double blank lines), dispatch tests with a fake provider, admin test message only to the admin's own address.

**Security impact:** LOW (existing transport; content per 13.5).

**Security docs updated:** YES.

### 13.7 Telegram provider: admin configuration and account pairing
**Status:** DONE
**Completed:** 2026-09-29

**Security impact:** HIGH — new credential type (bot token), external service, account linking of an outside identity.

**Decisions (made here, documented):** the bot token is entered in the admin UI (not an environment variable) and stored sealed with `DATA_ENCRYPTION_KEY`; **polling, not a webhook** (the beta runs behind a VPN; no inbound endpoint needed) and only while a pairing is open; pairing needs a **confirmation by the signed-in user in VMN** after /start, so a leaked link cannot attach a stranger's chat; one Telegram chat per account; no generic webhook/ntfy in this pass (SSRF policy must be designed first — security.md).

**Implemented:**
- `packages/notifications` (new): Telegram Bot API client on `fetch` — fixed host `api.telegram.org`, POST JSON, redirects refused, 10 s timeout, 1 MiB cap, plain-text messages ≤4096 characters, updates reduced to id/chat/type/text/sender label; every failure a `NotificationDeliveryError` with a stable code (the token-bearing URL is never exposed).
- Application `notifications/`: admin overview, email on/off, `configureTelegram` (format check, `getMe` verification, seal, save — token never returned), `testNotificationProvider` (to the acting admin only); per-person settings (default reminder time, email/Telegram on/off), `startTelegramPairing` (256-bit token, hash stored, 10 min, one open pairing per account, returns the `t.me/<bot>?start=<token>` link once), `pollTelegramPairings` (only `/start <token>` in private chats; one-time claim; stored update offset), `confirmTelegramPairing`, cancel, disconnect; security events `NOTIFICATION_PROVIDER_CHANGED` (no credential), `TELEGRAM_CONNECTED`, `TELEGRAM_DISCONNECTED`.
- HTTP: `GET /api/admin/notifications`, `POST …/email`, `…/telegram`, `…/test` (server admin, persisted per-account limits 20 / 20 / 5 per 15 min); `GET/POST /api/account/notifications`, `POST …/telegram/pair|confirm|cancel|disconnect` (pair/confirm 10 per 15 min).

- Web (*Server admin → Notification providers*): email configured/enabled with a test email to oneself; Telegram status (bot name, enabled), bot-token field (password input, `autocomplete=off`, cleared after every save, never filled from the server), enable, test message to one's own chat, remove token.

**Tests/checks:** `packages/database/src/notification-use-cases.test.ts` (13), `packages/notifications/src/telegram-bot-api.test.ts` (5), `apps/server/src/http/notification.test.ts` (3, incl. captured server log without the token), route-table test; e2e: providers section (email configured, Telegram not configured, a malformed token refused with its message and the field cleared), axe.

**Remaining:** real pairing with Telegram cannot run in CI (no bot) — covered with a fake Bot API at use-case and HTTP level; ntfy/Gotify/webhook not implemented (webhook needs the SSRF policy first).

**Security docs updated:** YES ("Security check: notification providers and Telegram", §9, §12).

### 13.8 Account → Notifications
**Status:** DONE
**Completed:** 2026-09-29

**Implemented:** `notification_preferences` (default reminder time, email/Telegram reminders on/off; defaults 09:00/on/on); *Profile & settings → Notifications*: default reminder time (used for "n days before" reminders and for new items without a time), email reminders (or "switched off on this server"), Telegram: *Connect Telegram* → link to the bot (shown once) → the page checks every 3 s until a chat pressed Start → "The Telegram chat “@x” wants to receive your reminders" → **Confirm** / **Not me**; connected: label and date, reminders on/off, *Disconnect Telegram*. No provider setting or secret appears here.

**Tests/checks:** use-case and HTTP tests (13.7); e2e: default time saved and kept after reload, "Telegram is not set up on this server", no token field, axe.

**Security impact:** MEDIUM (account linking of an outside chat — controls in 13.7).

**Security docs updated:** YES.

### 13.9 Workspace Home
**Status:** DONE
**Completed:** 2026-09-29

**Implemented:** `/w/{id}` is the Workspace Home (the start page opens the last Workspace's Home); navigation **Home · Procedures · Completed history · Members · Knot links**. `GET /api/workspaces/{id}/home` returns Due, Upcoming, Active, Pinned, Recent and the Recent limit in one call. Sections appear only when they have content, in the order Due, Upcoming, Active, Pinned, Recent; an empty Workspace gets one calm hint. Offline, Home shows the active executions saved on the device. No charts, statistics or percentages over time.

**Tests/checks:** `packages/database/src/home-use-cases.test.ts`; route-table test (non-members 404); e2e: Home after sign-in (also after the TOTP sign-in), axe.

**Security impact:** LOW — read-only aggregation of data the member can already see (`procedure.view`).

### 13.10 Start directly from the Procedure list (Start now / Schedule…)
**Status:** DONE
**Completed:** 2026-09-29

**Implemented:** every Procedure card and the Procedure view have **Start** (a disclosure: *Start now*, *Schedule…* — each only with its capability). *Schedule…* opens a modal `<dialog>`: date (today or later in the item's zone), optional time, reminders (on the day, 1 day before, 1 week before, plus custom 1–48 hours / 0–30 days, ≤5), the time zone named; *Reschedule…* uses the same dialog. Cards are compact: icon, title, scheduled/due/overdue, active count, "Last completed …", ★, Start, ⋯.

**Tests/checks:** e2e: Start now from the card and from the view, Schedule… with preset and custom reminders, the card shows "Scheduled …"/"Due today", axe on the dialog.

**Security impact:** NONE (UI only; the server authorizes every request).

### 13.11 Due / Upcoming / Active on Home
**Status:** DONE
**Completed:** 2026-09-29

**Implemented:** **Due** — overdue (marked "!" and "Overdue — was due …", not colour alone) and today, primary **Start** (creates the Run from the item; the item then disappears); **Upcoming** — date/time and "Reminders: 1 day before, 3 hours before, on the day", **Start early**, ⋯ *Reschedule…* / *Cancel this schedule* (confirmation); **Active** — title, "Started by Jane 18 minutes ago · 2 of 5 resolved", **Continue**. A scheduled item whose Procedure was deleted says so and offers only Cancel.

**Tests/checks:** e2e: Due (today) and Upcoming with reminders, reschedule, cancel, Start from Due → execution, Active with Continue; use-cases for due/overdue per time zone.

### 13.12 Pinned Procedures
**Status:** DONE
**Completed:** 2026-09-29

**Implemented:** `procedure_pins` (user, Procedure, Workspace, time); ★ toggle (`aria-pressed`) on cards and in the Procedure view, instant; pinned Procedures first (in pinning order) and on Home; personal — another member does not see them; never audited; pins of deleted Procedures are hidden; unpin/pin of a Procedure outside the Workspace → 404.

**Tests/checks:** use-cases (personal, order, no audit, Workspace isolation, deleted), route-table test (found unpin answering 204 for a foreign id → now 404), e2e pin/unpin.

**Security impact:** LOW.

### 13.13 Recent Procedures with an admin-configurable limit
**Status:** DONE
**Completed:** 2026-09-29

**Decision:** range **0–20** (default 5); 0 hides the section — the cleaner way to switch it off.

**Implemented:** Recent = non-deleted Procedures of the Workspace that *this person started*, newest start first (derived from `runs`, index `runs_starter_idx`); opening a Procedure does not count. `instance_settings.recent_procedures_limit` (CHECK 0–20), *Server admin → This server → Recent Procedures on Home*, validated server-side (`invalid_recent_limit`), audited with `INSTANCE_SETTINGS_CHANGED`; changing it only changes what Home shows.

**Tests/checks:** use-cases (started vs. opened, per person, limit 2/0/20, invalid values), HTTP (admin only, strict body, bounds, audit), e2e (0 hides Recent, back to 5).

**Security impact:** LOW (server-admin setting, audited).

### 13.14 "Completed history" wording and navigation
**Status:** DONE
**Completed:** 2026-09-29

**Implemented:** *Completed history* (`/w/{id}/history`; the old `/w/{id}/runs` address leads there) lists finished executions; active ones are on Home. User-facing texts say Start, Continue, Complete, Abort…, execution, Completed history instead of "Run" where the word did not help ("Complete Run" → "Complete", "Abort Run…" → "Abort…", history lines "started it / completed it"). The internal Run entity, its snapshot model, actors, timestamps and audit events are unchanged. The execution view no longer fetches the history list (fewer requests).

**Tests/checks:** router tests (new routes, old address), web text tests, e2e.

**Security impact:** NONE.

### 13.15 Procedure ⋯ menu and page-level Manage menu
**Status:** DONE
**Completed:** 2026-09-29

**Implemented:** `MoreMenu` (⋯): a disclosure of ordinary buttons (Tab, Escape closes and returns focus, click outside closes), only with actions the person may use (not shown disabled); Procedure ⋯: Edit, Duplicate, Export as JSON, Share as Knot link…, History, Delete (last, marked). Page level: **New Procedure** + **⋯ Manage Procedures** (*Import Procedure (JSON file)…*, *Deleted Procedures*). The Procedure's history is folded away below it.

**Tests/checks:** e2e (all actions through ⋯ and Manage), axe with the Manage menu open.

**Security impact:** NONE.

### 13.16 Calmer icon picker
**Status:** DONE
**Completed:** 2026-09-29

**Implemented:** the panel opens with **Suggested** (8 common icons, plus the current one) and **Recently used** (this browser, localStorage, per-viewer convenience only), a search field and **Browse all 60 icons** for the complete grouped catalog; each view shows every icon once as one native radio group (arrow keys, screen readers, Enter/Escape unchanged). Icons stay trusted keys.

**Tests/checks:** icon test (suggestions distinct and existing), e2e (Suggested first, Browse all, keyboard choice, search), axe.

**Security impact:** NONE.

### 13.17 Focused mobile execution
**Status:** DONE
**Completed:** 2026-09-29

**Implemented:** the execution view shows title, live state, progress and the Steps (Next, Done / Skip / Not applicable, undo, actor/time) first; the history and Knot sharing are folded into one *History (and sharing)* section below (open by default only for finished executions). Kept: sticky dock with the next Step, critical-Step confirmation, large touch targets, glyph + text states, offline queue, live updates, reduced motion.

**Tests/checks:** e2e on a 390 px viewport: no sideways scrolling, history folded, axe.

**Security impact:** NONE.

### 13.18 Warning before starting another active Run
**Status:** DONE
**Completed:** 2026-09-29

**Implemented:** before *Start now* (and before starting a scheduled item) the client fetches the Procedure's active executions (`GET …/runs?state=ACTIVE&procedureId=`); if there are any, a dialog says "“Leave the flat” already has an active execution, started by Jane 18 minutes ago" with **Continue existing**, **Start another anyway**, **Cancel**. UX only: the server still allows several active Runs, and if the check fails the start proceeds (the server decides).

**Tests/checks:** e2e (second start shows the warning, "Start another anyway" starts), axe on the dialog; HTTP filter covered by the route tests.

**Security impact:** NONE.

### 13.19 Final security, documentation and test pass
**Status:** DONE
**Completed:** 2026-09-29

**Implemented/checked:** review of every change of section 13 for logging (counts and error type/code only; no token-bearing URLs; request bodies never logged), output (React text only, plain-text email/Telegram), outbound requests (only `api.telegram.org`, redirects refused), authorization (route-table test covers every new route), and time handling; docs updated: `security.md` (checklist, three new security checks, §9/§12), `architecture.md` (Home, scheduling, reminders, providers; offline addendum), `deployment.md` (reminders and notification providers, `API_RATE_LIMIT_PER_MINUTE`, `DATA_ENCRYPTION_KEY` also encrypts the bot token), `unraid.md` (Telegram troubleshooting), `user-guide.md` (Home, Start/Schedule, reminders, pins, Notifications, admin), `.env.example` and `deploy/vergissmeinnicht.env.example`; `test-env/seed.ts` creates two scheduled items and a pin (type-checked; the existing local test environment was left untouched, so the seed itself was not re-run).

**New configuration:** `API_RATE_LIMIT_PER_MINUTE` (optional, 60–10000, default 300) — added because the single e2e flow exceeded the fixed global limit from one address; sensitive routes keep their own limits.

**Tests/checks (final run):** `pnpm lint`, `pnpm typecheck`, `pnpm test` (all unit/integration tests), `pnpm build`, `pnpm test:e2e` (desktop + mobile Chromium; the long flow runs on desktop, smoke on both) — all passing; `pnpm db:generate` reports no schema drift after the hand-edited migration 0020; `pnpm audit`: only the known moderate dev-only advisory.

**Security impact:** HIGH overall for section 13 (new credential type, external service, outbound Workspace content) — controls and open risks in security.md.

**Remaining:** real Telegram pairing untested against Telegram itself; no UI for delivery history; reminders only to the scheduler (no per-item recipients); no recurring schedules (out of scope); the e2e flow is long — consider splitting it once a second bootstrap path for tests exists.


### 13.20 Menus stay on screen on phones
**Status:** DONE
**Completed:** 2026-10-01

**Report (user, 2026-10-01, iPhone, 0.3.0-beta.2):** on the Procedure page the "⋯" menu opened half off-screen to the left, so Edit and the other actions could not be reached — which also blocks the real-iPhone photo test (14.3).

**Cause:** the panel is aligned to the right edge of its button; on a phone the button sits near the left edge of the page.

**Implemented:** `useKeepInViewport` / `panelShift` in `apps/web/src/MoreMenu.tsx` move an open panel sideways so it lies inside the viewport (8 px margin; re-checked on resize); used by the "⋯" menu and the Start menu.

**Tests/checks:** `pnpm lint`, `pnpm typecheck`, `pnpm test` (102 files, 800 tests; new `MoreMenu.test.ts`), `pnpm build`, `pnpm test:e2e` (new check at 390 px width: the menu items lie inside the viewport; confirmed to fail without the fix, x = −65.5).

**Security surface:** unchanged (presentation only). **Security docs updated:** NO — not needed.

**Remaining:** the phone-sized run of the full e2e flow (`mobile-chromium`, `account.spec.ts`) is skipped, which is why this was not caught. Confirmed by the user on a real iPhone with 0.3.0-beta.3 (2026-10-01).

---

## 14 — Attention, recurring obligations and visual instructions (accepted 2026-09-30)

**Objective (user, 2026-09-30):** make VMN an ADHD-friendly place to see what needs attention, remember recurring obligations and follow clear visual instructions. A person must be able to answer at a glance: *What is due or overdue? What is coming up? Who is responsible? How do I do this correctly? Has this occurrence already been completed?*

**Status of this section:** plan only — nothing below is implemented; every task is TODO until its own completion note. Product decisions D1–D8 and D11–D18 (incl. D11a, the Workspace image quota) were approved by the user on 2026-09-30 and are part of the requirements below; storage, processing, HEIC, archive and licence notices are technical choices T1–T5 (14.6).

**First release scope:** recurring schedules, standalone Reminders, optional assignment, the actionable overview, instruction photos (one optional image per Step, Workspace storage quota), calendar and mobile agenda (14.0–14.4). **Later phase:** completion photos, required photo evidence, annotations (14.5).

### Relation to existing work
**Already implemented (reused, not re-specified here):**
- One-time *ScheduledProcedure* (13.4): calendar date + optional time + IANA zone; DST handling (non-existent time → later, ambiguous → earlier); due/overdue judged by the item's own zone; states SCHEDULED / STARTED / CANCELLED; never deleted; Start creates the Run and closes the item in one transaction; nothing is created by the passage of time.
- Reminder pipeline (13.5–13.8): `scheduled_reminders` (one row per instant, cancelled rather than deleted, a processed instant never stored again), `reminder_deliveries` (unique per reminder and channel, claimed before sending, 5-minute lease, ≤4 attempts at 1 min / 10 min / 1 h, permanent errors not retried, reminders >24 h late currently dropped), in-process scheduler every minute, email and optional Telegram (server switch + personal switch/pairing), send-time checks (account ACTIVE, still a member with `procedure.view`, item open, Procedure not deleted). Reminders currently go only to the person who scheduled.
- Home (13.9–13.11, 13.18): Due (overdue + today), Upcoming (all open future items), Active, Pinned, Recent; warning before a second active Run of the same Procedure.
- Capabilities (3.2, 13.4): `procedure.view` (all roles); `run.start`, `run.execute`, `schedule.manage` (USER, EDITOR, ADMIN); `procedure.edit` (EDITOR, ADMIN). Run snapshot model (5.1). `MAX_ACTIVE_RUNS_PER_WORKSPACE = 500`. Several active Runs of one Procedure are allowed (locked decision). Offline execution of saved Runs (8.5). Procedure JSON import/export `schemaVersion 1`, strict (4.4). Backups: SQLite online backup API → one verified file; scheduled backups keep `BACKUP_KEEP` (default 14) copies on `/data` (10.2, 10.5).

**New with this section:** standalone Reminders; recurring Schedules with individual Occurrences; optional Assignee; Overdue / Today / Upcoming overview with actions; calendar and mobile agenda; one optional instruction image per Procedure Step with a per-Workspace storage quota; bounded catch-up after outages; a Procedure archive format with images.

**Superseded decisions (recorded, not silently changed):** the 2026-09-29 decision "no task manager, calendar or workflow engine" and section 13's out-of-scope list (generic tasks, calendar events, recurring schedules, attachments, photos) are replaced **for exactly these features** by the 2026-09-30 decision. Still out of scope: Kanban/boards, comments/chat, workflow branching, Web Push, SMS, analytics, external calendar sync (ICS/CalDAV), drag-and-drop planning; completion photos and annotations until 14.5.

### Cross-cutting model (applies to 14.1–14.4)
**Vocabulary:** *Procedure* — the editable reusable definition; *Run* — one execution snapshot; *Reminder* — a standalone obligation without a Procedure (title, optional description); *Schedule* — a series that produces Occurrences of either a Reminder or a Procedure; *Occurrence* — one dated instance of a Schedule with its own status and history; *Assignee* — the optional responsible member. The existing ScheduledProcedure becomes a one-time Schedule with one Occurrence (14.1, migration).

**Recurrence and calendar arithmetic:**
- *Kinds:* one-time; **fixed calendar** — every N days, N weeks (on chosen weekdays), N months (on a day of the month or the last day), N years (month + day); **completion-based** — the next due date is the completion (or skip) date plus N days / weeks / months / years.
- *Anchor rule (no drift):* every fixed due date is computed from the series' original anchor — occurrence *k* = anchor + k × interval, then clamped — never from the previous due date, a completion or a skip. Completing late never shifts later deadlines.
- *Clamping (D15):* a date that does not exist in the target month becomes that month's last day: the 31st → 30 April / 28 or 29 February; 29 February → 28 February in non-leap years. Because each date is computed from the anchor, the next month/year returns to the 31st / 29 February.
- *Time zone:* each Schedule stores an explicit IANA zone (default: the creating device's zone, shown and changeable). Due dates are calendar dates in that zone; "today", "overdue" and all arithmetic use that zone, never the server's. An optional wall-clock time uses the 13.4 DST rules (non-existent → next valid time; ambiguous → earlier instant). Changing the zone applies to Occurrences not yet acted on.
- *Reminder offsets (D4):* up to 5 per Schedule, each **on the due date**, **N days before** (1–366), **N weeks before** (1–52 = 7 × N days) or **N calendar months before** (1–12: the same day N months earlier, clamped as above — "1 month before 31 March" = 28/29 February). Date offsets fire at the recipient's default reminder time (Account → Notifications) on the resulting date, interpreted in the Schedule's zone with the DST rules above. The existing hour offsets (1–48 h before a timed Occurrence) remain. Offsets apply to every Occurrence; an offset whose instant is already past when the Occurrence is created is not sent (it is not a "missed" reminder).
- *Display horizon is not a scheduling limit (D16):* Upcoming shows 90 days and the calendar one month by default; other ranges load on navigation. Recurring Schedules have no end unless ended; the existing 731-day limit applies only to the date of a one-time item.

**Occurrence lifecycle:** states `OPEN` (shown as Upcoming / Today / Overdue by its due date in the Schedule's zone), `IN_PROGRESS` (Procedure: a linked Run is active), `COMPLETED`, `SKIPPED` (optional reason), `CANCELLED` (withdrawn by a Schedule change before being acted on).
- An Occurrence is unique per (Schedule, due date) and has its own history; completing, skipping or reopening one never changes another — last year's and this year's are separate rows.
- *Reminder Occurrence:* **Complete** records the completing user (id + display-name snapshot) and time **separately from the Assignee** (D6); **Reopen** returns it to OPEN. Both audited.
- *Procedure Occurrence:* **Start** creates a normal Run (snapshot, `run.start`, the 500-Run limit) and links it in the same transaction → IN_PROGRESS; while that Run is active only **Continue** is offered. Run COMPLETED → Occurrence COMPLETED in the same transaction; Run ABORTED → Occurrence back to OPEN (the aborted Run stays in its history).
- *Linking an existing Run (D7):* only a Run linked to an Occurrence completes it. An authorised user may deliberately **Link existing Run…**: eligible are Runs of the same Procedure and Workspace, ACTIVE or COMPLETED, not linked to any Occurrence, started on or after the previous Occurrence's due date (or the Schedule's creation). The dialog shows the Run's start time and starter and needs confirmation. A Run can be linked to at most one Occurrence and an Occurrence to at most one Run at a time (database constraints); linking and unlinking are audited; unlinking a completed Run reopens the Occurrence.
- *Skip:* one Occurrence → SKIPPED with actor/time/optional reason. Fixed series continue unchanged. Completion-based (D2): the next due date is the **skip date** + interval, and the dialog shows that resulting date before confirmation.
- *Overdue and backlog (D1):* overdue Occurrences stay OPEN until completed or skipped — nothing is marked done, missed or skipped by the passage of time. Fixed series create their Occurrences incrementally (the next one when the previous due date has passed, idempotently by the unique key), so an ignored yearly series grows by one Occurrence per year, never in bursts. The overview groups several open Occurrences of one Schedule; **Skip older occurrences…** (bulk skip, `schedule.manage`) skips all OPEN Occurrences of a Schedule due before a chosen date in one audited transaction (one audit event per Occurrence), never touching IN_PROGRESS ones. No Run is ever created automatically.
- *Pause / resume (D3):* a paused Schedule creates no Occurrences and sends no reminders (existing Occurrences stay actionable; their unsent reminders are cancelled and recreated on resume if still in the future). Resuming a **fixed** series keeps the original anchor; Occurrences whose due dates elapsed during the pause are created and the resume dialog offers to skip them (default: skip, listed by date) — no catch-up notifications are sent for the pause period. Resuming a **completion-based** series keeps its existing due date, even if that is now overdue.
- *Editing:* changes to title, rule, time, zone, offsets or Assignee apply to Occurrences not yet acted on (OPEN, not started); COMPLETED / SKIPPED / IN_PROGRESS Occurrences and all history are never rewritten. A single OPEN Occurrence can be moved or given its own Assignee ("this occurrence only"). Unsent reminders of changed Occurrences are cancelled and recreated; a processed reminder instant is never re-sent.
- *Ending / deletion:* Schedules and Occurrences are never hard-deleted; ending a Schedule cancels its future OPEN Occurrences and keeps history. A deleted Procedure leaves its Occurrences visible as unavailable (Start disabled, Skip/Cancel possible, no reminders).
- *Active-Run limit:* Occurrences are not Runs and never count toward `MAX_ACTIVE_RUNS_PER_WORKSPACE`; only Start does and it fails with the existing limit error and message.

**Responsibility and permissions (D6, D8):**
- At most one Assignee per Schedule, optionally overridden per Occurrence; "Shared" when unassigned. The Assignee must be a current member with `procedure.view` when assigned. **Assignment grants no access and no capability.**
- Complete / Reopen / Skip a single Occurrence and Link/Unlink a Run: `run.execute` (the Workspace execution permission; USER, EDITOR, ADMIN). Start / Continue: `run.start` / `run.execute` as today. Create / edit / pause / resume / end a Schedule, assign, move an Occurrence, bulk skip: `schedule.manage`. Viewing: `procedure.view`. All re-checked inside the transaction; every lookup scoped by Workspace.
- If an Assignee later loses membership or the needed capability, the assignment stays visible with a warning ("no longer a member" / "cannot complete this") and reminders to them are skipped — not redirected.

**Notifications (reuse 13.5–13.8):**
- *Recipient:* the Occurrence's Assignee (override, else the Schedule's Assignee), otherwise the Schedule's creator. Never all Workspace members. Channels: providers the server enabled **and** the recipient enabled/connected. Reassigning cancels unsent reminders of the old recipient and creates them for the new one; processed instants are not repeated.
- *Send-time checks (all messages, incl. catch-up):* recipient ACTIVE, still a member with `procedure.view`, still the current recipient, channel still enabled; Occurrence OPEN; Schedule not paused/ended; Procedure not deleted. Otherwise the reminder is recorded as SKIPPED with a code, nothing is sent.
- *Delivery records, keys and claiming (extends 13.5):* every notification is a **persistent delivery record** with a **unique logical key** — reminders: (Occurrence, recipient, offset instant, channel); catch-up summaries: (recipient, channel, summary id) plus a unique (Occurrence, recipient, outage) membership so an Occurrence is in at most one summary. A worker **claims** a record atomically (IMMEDIATE transaction, conditional update from a claimable state to SENDING with a lease and attempt number) before calling the provider; only one worker can hold a claim. **Retries** happen only after the scheduled next attempt or an expired lease (≤4 attempts: 1 min / 10 min / 1 h; permanent errors not retried); a record whose success is recorded (SENT) is never claimed again, also after restarts. Emails carry a stable `Message-ID` derived from the logical key, so a repeated email is recognisable; the Telegram Bot API offers no idempotency key.
- *No exactly-once promise:* if the process stops after a provider accepted a message but before SENT is recorded, the lease expires and that one message can be sent again (at most once more per attempt limit). This is documented for operators and users; the overview stays authoritative.
- *Outage catch-up (D5), replacing the unconditional 24 h drop:*
  - Reminders up to **24 h late** are delivered normally (as today).
  - Reminders **more than 24 h late** are *missed*. Per Occurrence and recipient, only the **most recent missed offset** becomes a single **catch-up**; earlier missed offsets of that Occurrence are recorded as SUPERSEDED (never sent). Future offsets stay scheduled normally.
  - Only OPEN Occurrences (future-due or overdue) are eligible; COMPLETED, SKIPPED, CANCELLED, IN_PROGRESS Occurrences and paused/ended Schedules produce no catch-up. All send-time checks above are re-evaluated at delivery.
  - No catch-up is sent alongside another eligible notification for the same Occurrence and recipient: if a normal (≤24 h late or on-time) reminder for it is deliverable in the same dispatch run or within the next 24 h, the catch-up is SUPERSEDED and only the normal reminder goes out.
  - Wording describes the **current** state, not the original offset: "Missed while VMN was unavailable — *Pay annual tax* is due on 15 June (in 5 days)" or "… was due on 15 June and is overdue". Never "due in 1 month" when that is no longer true.
  - Flood control and a concise interface: catch-ups are grouped into **one summary message per recipient and channel per dispatch run**, listing at most 10 Occurrences (earliest due first) plus "and N more — open VMN"; the summary is itself a claimed delivery (lease, retries, dedup). Several consecutive dispatch runs after a long outage therefore send at most one summary each, not one message per Occurrence; an Occurrence appears in at most one summary.
  - Best-effort limits stay: a crash between a provider accepting a message and recording it can repeat that one message; providers may delay or lose messages; nothing guarantees delivery.
- **Upcoming / Overdue and the calendar are authoritative** regardless of notification delivery.

**Audit:** Schedule and Occurrence changes are audited atomically with the change: existing `SCHEDULE_*` plus `SCHEDULE_PAUSED/RESUMED/ENDED`, `SCHEDULE_ASSIGNED`, `OCCURRENCE_COMPLETED/REOPENED/SKIPPED/MOVED/ASSIGNED`, `OCCURRENCE_RUN_LINKED/UNLINKED`. Run events remain the evidence of execution; delivery state stays outside the audit trail (13.5).

### 14.0 Repository instruction updates (D17)
**Status:** DONE
**Completed:** 2026-09-30
**Depends on:** nothing; do before 14.1 so implementers see the approved scope.

**Required changes (recorded here; the files themselves are not edited in this documentation task):**
- `AGENTS.md` → *Product objective*: add the ADHD-friendly attention objective and the five questions.
- `AGENTS.md` → *Core domain vocabulary*: add **Reminder, Schedule, Occurrence** (and Assignee); keep Procedure and Run; state that a Schedule of a Procedure never creates Runs by itself.
- `AGENTS.md` → *Scope discipline*: "calendars" and "attachments/photos" → accepted for the calendar/agenda view and instruction photos (14.2–14.4); completion photos, required evidence and annotations remain unaccepted until 14.5; external calendar sync stays out.
- `AGENTS.md` → *Testing*: add examples — completing one Occurrence never completes another; recurrence never drifts; catch-up never floods; instruction images need Workspace authorisation.
- `docs/development/security.md`: new security checks when 14.1 and 14.3 are implemented (§12 triggers: file uploads and downloads, a new server resource limit (image quota), new outbound notification behaviour), and a checklist line that instruction images are processed server-side (metadata stripped) and served only after Workspace authorisation.

**Acceptance criteria:** the instruction files use Reminder, Schedule, Occurrence, Procedure and Run consistently with this section; nothing in them contradicts the approved scope.

**Implemented:** `AGENTS.md` — product objective (ADHD-friendly attention, the five questions), vocabulary (Reminder, Schedule, Occurrence, Assignee; "a Schedule never creates Runs by itself"), scope discipline (calendar/agenda view and one instruction image per Step accepted; completion photos, evidence and annotations still not; no external calendar sync), testing examples. `docs/development/security.md` — new "Security check: Schedules, Occurrences, assignment and outage catch-up" and a §3 checklist line "Assignment grants no access" (with 14.1/14.2); the image checks follow with 14.3.
**Checks:** read-through against section 14 for contradictions. **Security impact:** NONE (documentation).

### 14.1 Phase 1 — Schedules, Occurrences, recurrence and reminders
**Status:** DONE
**Completed:** 2026-09-30
**Depends on:** 13.4–13.8 (done), 14.0.

**Tasks:**
1. Domain (no I/O): `Schedule` (kind REMINDER | PROCEDURE, rule, anchor, zone, time, offsets, Assignee, paused/ended), `Occurrence` (due date, state, completing-user snapshot, Assignee override, linked Run), recurrence from the anchor with clamping, completion/skip-based next date, offset arithmetic (days/weeks/calendar months/on the day; hours), the lifecycle transitions and rules above.
2. Database: `schedules`, `occurrences` (unique Schedule + due date; unique linked Run; CHECKs for states and closing data; triggers: never deleted, closed Occurrences change only through audited Reopen/Unlink), reminder rows per Occurrence and recipient, new delivery outcomes SUPERSEDED and catch-up summaries.
3. **Migration (D14):** every existing `scheduled_procedures` row becomes a one-time PROCEDURE Schedule with one Occurrence, keeping ids (existing links keep working), dates, times, zones, reminder offsets and reminder time; SCHEDULED → OPEN; STARTED → IN_PROGRESS or COMPLETED according to the Run it started (found through `RUN_STARTED` metadata `scheduleId`, then linked), ABORTED Run → OPEN with the Run in history; CANCELLED → CANCELLED; `scheduled_reminders` and `reminder_deliveries` rows are kept and re-pointed, so no delivered (or processed) reminder is sent again; audit history untouched. The old `/schedules` routes keep working for one release.
4. Application: create/edit/pause/resume/end Schedules; move/assign one Occurrence; complete/reopen/skip/bulk skip; start/continue; link/unlink Run; Run completion/abort updating the Occurrence in the same transaction; next-Occurrence job and reminder creation in the existing minute scheduler; catch-up selection, supersession and grouped summaries in the dispatcher; audit events.
5. HTTP: Workspace-scoped routes, strict bodies and limits, route-table coverage; ≤1000 active Schedules per Workspace (existing bound).
6. Web: create/edit dialog (Reminder or Procedure; one-time / fixed / completion-based; offsets incl. "on the due date", weeks, months; zone; Assignee); skip dialog showing the next date (completion-based); resume dialog listing elapsed Occurrences with "skip these" preselected; Link existing Run dialog.
7. Email/Telegram texts for reminders and catch-up summaries (plain text, current due status).
8. Docs: architecture, user guide, deployment upgrade note, security check.

**Acceptance criteria:**
- *Recurrence drift:* "yearly on 15 June", completed on 20 June 2027 → next due 15 June 2028. "Monthly on the 31st" from 31 January 2027 → 28 February, 31 March, 30 April, 31 May (never "the 28th/30th forever"). "Yearly on 29 February 2028" → 28 February 2029, 28 February 2030, 28 February 2031, 29 February 2032. "Every 2 weeks on Monday" keeps Mondays across DST changes in Europe/Berlin.
- *Completion-based:* "every 6 months after completion", completed 3 March 2027 → next due 3 September 2027; skipped on 10 September → the dialog shows 10 March 2028 before confirming, and that is the next due date.
- *Independent history:* completing the 2027 Occurrence of a yearly Reminder leaves the 2028 Occurrence OPEN; reopening 2027 changes nothing in 2028; two members completing the same Occurrence at once produce one completion (the other sees it already completed, with who and when).
- *Backlog:* a yearly Reminder ignored for three years shows three overdue Occurrences grouped as one row "3 overdue"; **Skip older occurrences** skips the two oldest in one action; no Run exists for any of them.
- *Pause/resume:* a monthly series (anchor the 15th) paused 1 March and resumed 20 May offers to skip 15 March, 15 April and 15 May; the next due date stays the 15th; no reminders were sent while paused. A completion-based series due 1 April, paused and resumed 20 April, is still due 1 April (overdue).
- *Offsets:* "1 month before" a 31 March due date fires on 28 February 2027 (29 February 2028) at the recipient's reminder time in the Schedule's zone; "1 month and 1 week before" produce one delivery each per channel; moving the due date replaces unsent reminders and never repeats a sent one.
- *Outage catch-up:* (a) server down from 14 May to 17 May across the "1 month before" instant (15 May) of an Occurrence due 15 June → after restart exactly one catch-up per channel saying "due on 15 June (in 29 days)", and the "1 week before" reminder still arrives on 8 June; (b) down across both "1 month" and "1 week" instants → one catch-up for the 1-week offset, the 1-month offset recorded as SUPERSEDED; (c) down 20 hours → the missed reminder is sent normally, not as catch-up; (d) the Occurrence was completed, skipped or its Schedule paused during the outage → nothing is sent; (e) a normal reminder for the same Occurrence is due within 24 h of recovery → only the normal reminder is sent; (f) after an outage 30 Occurrences of one recipient are missed → one email and one Telegram summary listing 10 and "20 more", not 30 messages; (g) the server restarts twice during recovery → no Occurrence appears in two summaries and no summary is sent twice (except the documented crash window).
- *Delivery concurrency and restarts:* two dispatchers running against the same database at the same moment (separate connections/processes) produce exactly one provider call per logical notification (fake provider counts calls); a server killed after SENT was recorded and restarted sends nothing again; a server killed after claiming but before calling the provider sends the message once after the lease expires; a simulated crash after the provider accepted but before SENT was recorded results in at most one repeat (documented behaviour), never more; a failing provider is retried at 1 min / 10 min / 1 h and then recorded FAILED.
- *Assignment and access changes:* reassigning from Ana to Ben sends Ben the future reminders and Ana none; an Occurrence override to Cleo sends only that Occurrence's reminders to Cleo; Ben demoted to GUEST still sees his Occurrences but cannot complete them and his reminders stop; a removed member's reminders are skipped and the overview warns; assignment never lets a GUEST complete, start or skip.
- *Runs:* Start creates exactly one Run and links it; a second Start offers Continue; Run completion completes only its Occurrence; abort reopens it; linking an existing Run requires confirmation, refuses Runs already linked or of another Procedure/Workspace, and cannot complete two Occurrences with one Run; the 500-Run limit applies unchanged.
- *Migration:* a copy of a production-like database with scheduled, started (active, completed, aborted Run), cancelled and deleted-Procedure items migrates with identical dates, reminder settings, delivery rows and audit history; the dispatcher run right after migration sends nothing that had already been sent or processed.

**Checks (required):** unique-key and claim tests on the delivery tables (constraint violations, conditional-update races, lease expiry, SENT never reclaimed); property tests of recurrence over ≥50 years for every rule kind (no drift after clamping; leap years; month ends; weekday rules across DST in Europe/Berlin and America/New_York; zone change); offset arithmetic incl. month clamping; independent Occurrence history and concurrent completion; notification deduplication (restart, concurrent dispatchers, reassignment, move back and forth, catch-up vs normal, summaries); catch-up rules (a)–(g); permission negative tests (GUEST, non-member, other Workspace → 404, assignment grants nothing, in-transaction re-checks); audit atomicity; migration test like `migration-0019.test.ts`.

**Security impact (expected):** MEDIUM — new Workspace resources and transitions, changed outbound notification behaviour. `security.md`: "Security check: schedules, occurrences and catch-up".

**Implemented (2026-09-30):**
- Domain `schedule.ts`: Schedule/Occurrence types, `parseRecurrence` (ONCE, FIXED with weekdays / last day of month, AFTER_COMPLETION; interval 1–99), anchor-based `fixedDateAt`/`nextFixedDate` with month-end and leap-day clamping, `dueAfterCompletion`, `addMonthsClamped`, reminder offsets DAYS 0–366 / WEEKS 1–52 / MONTHS 1–12 (calendar, clamped) / HOURS 1–48 at the recipient's reminder time, `reminderRecipientId` (Occurrence Assignee → Schedule Assignee → creator); the 13.4 time-zone arithmetic is unchanged. New audit types `SCHEDULE_PAUSED/RESUMED/ENDED/ASSIGNED`, `OCCURRENCE_COMPLETED/REOPENED/SKIPPED/MOVED/ASSIGNED/RUN_LINKED/RUN_UNLINKED` (subject `occurrence`).
- Migration `0024_schedules_occurrences` (hand-written around generated DDL, verified identical to the schema; snapshot regenerated, no drift): `schedules`, `occurrences` (partial unique Schedule + due date), `occurrence_runs` (partial unique current link per Run and per Occurrence), `notification_summaries`; `scheduled_reminders` re-pointed to Occurrences (+`superseded_at`, unique per Occurrence, recipient, offset, instant) and `reminder_deliveries` (+`summary_id`, status GROUPED) rebuilt with every row kept; `scheduled_procedures` migrated (same ids for Schedule and Occurrence; SCHEDULED → OPEN, STARTED → IN_PROGRESS/COMPLETED/OPEN by the linked Run's state using its `run_id`, CANCELLED → ENDED + CANCELLED) and dropped; triggers: never deleted, identity immutable, ENDED/CANCELLED/ended links final.
- `packages/database/src/schedule-repository.ts`: every write in one IMMEDIATE transaction with guard re-check, reminder refresh and audit event; generator `advance` (incremental, idempotent, ≤24 per series and run); Run hooks `occurrenceIsStartable`/`linkStartedRun` (Start) and `onRunFinished` (inside `RunRepository.finish`: completed → Occurrence COMPLETED, aborted → OPEN with the Run kept in history).
- Application `schedules/use-cases.ts` (create/update/pause/resume/end/skip-older; complete/reopen/skip/move/assign/start/link/unlink/linkable Runs; history; `advanceSchedules`), capabilities as in the cross-cutting model; 13.4 request shapes keep working (`/cancel` = end, `/start` on a Schedule, `reminderTime` accepted and ignored).
- Reminders (`reminders/dispatch.ts`, `reminder-queue.ts`): send-time re-checks incl. "still the responsible person"; ≤24 h late normal delivery; bounded catch-up (latest missed offset per Occurrence and recipient, earlier ones superseded, none next to a normal reminder within 24 h, one claimed summary per recipient and channel with ≤10 items, members re-checked on retry); success recorded only after the provider call; texts describe the current status (`reminder`, `catchUp` in the email catalog); email `Message-ID` from the logical key (`<r-…@host>` / `<s-…@host>`, validated in the SMTP adapter). The server's minute job runs `advanceSchedules` before dispatch.
- HTTP `schedule-routes.ts` (`/schedules`, new `/occurrences`), views with display names and the Assignee id; new error codes with web messages.
- Web: `ScheduleDialog` (Reminder or Procedure; once / fixed / after completion; weekdays, last day; presets on the due date, 1 day, 1 week, 1 month before + custom hours/days/weeks/months; responsible person), skip dialog showing the next date (completion-based), resume dialog with "skip the dates that fell into the pause", link dialog; `test-env/seed.ts` adds two Reminders.

**Tests/checks:** `packages/domain/src/recurrence.test.ts` (50-year no-drift property checks for monthly/yearly/daily rules, 31st and 29 February, weekdays across DST in Berlin and New York, completion/skip dates, recipient rule) and updated `schedule.test.ts` (offsets incl. month clamping); `packages/database/src/schedule-use-cases.test.ts` (23: every 14.1 acceptance case — yearly late completion, monthly 31st, completion-based skip, independent history, backlog + bulk skip, pause/resume both kinds, offsets at the recipient's time, moves never repeat processed reminders, edits keep history, end, Run start/abort/complete, D7 linking incl. refusals, assignment/override/GUEST, in-transaction re-check, Workspace isolation, concurrent completion, audit rollback, DB triggers); `reminder-dispatch.test.ts` (14: concurrent workers on two connections, restart after SENT, lease expiry, crash window — at most one repeat, retries, send-time re-checks, catch-up a–g, summary member dropped); `migration-0024.test.ts` (production-like legacy data: ids, dates, reminder settings, delivery rows, audit history kept; started items linked; nothing re-sent); `apps/server/src/http/schedule.test.ts`, `route-security.test.ts` (all new routes; found and fixed: linkable Runs of a foreign Occurrence answered 200 instead of 404), `reminder-schedule.test.ts`, email text tests; `migration-0019.test.ts` adapted (finishes its old-schema Run in SQL). `pnpm lint`, `pnpm typecheck`, `pnpm test` (756), `pnpm build`, `pnpm test:e2e`, `drizzle-kit generate` (no drift), `pnpm install --frozen-lockfile`.

**Security docs updated:** YES ("Security check: Schedules, Occurrences, assignment and outage catch-up", §3 line).

**Remaining / limitations:** no per-action rate limit for Occurrence actions (global API limit only); delivery stays best-effort (documented crash window); after very long outages catch-up may arrive as one summary per dispatch run (50 reminders per run), not a single message; editing a one-time Schedule whose date was already acted on is refused (`schedule_closed`) — schedule it again instead.

### 14.2 Phase 2 — Overdue / Today / Upcoming overview and optional assignment
**Status:** DONE
**Completed:** 2026-09-30
**Depends on:** 14.1.

**Tasks:**
1. Application read model `occurrencesInRange(workspace, from, to, filters)` — the single source for the overview and the calendar (14.4): stored Occurrences plus projected future dates of active series (marked projected, not actionable until they exist).
2. Home: **Overdue**, **Today**, **Upcoming (next 90 days**, more via "Show later" / the calendar), then Active, Pinned, Recent. Each row: type (Reminder / Procedure), title, due date (and time), Assignee or "Shared", status (glyph + text), and one primary action — **Complete** (Reminder), **Start** / **Continue** (Procedure); ⋯ for Skip, Move, Assign, Link Run, Open Schedule. Several open Occurrences of one Schedule grouped with "Skip older occurrences…".
3. Assignment UI: Assignee or "Shared" in the Schedule dialog and per Occurrence; "Assigned to me" / "Shared" filter; warnings for ineligible Assignees.
4. ADHD-friendly presentation: one clear next action per row, calm empty state ("Nothing needs attention"), no colour-only status (8.2), screen-reader labels, large touch targets, live updates for other members (6.1).

**Acceptance criteria:** each OPEN Occurrence appears exactly once in the right section by its own zone (checked around midnight and on DST days); Complete / Start / Continue work from the overview and the row moves or disappears for everyone without reload; the completing user is shown ("Completed by Ben, 2 min ago") next to the Assignee ("Assigned to Ana"); Upcoming ends at 90 days but an Occurrence 200 days ahead exists and is reachable via the calendar; a GUEST sees rows without action buttons.

**Checks:** use-case tests for section boundaries, grouping, projection vs stored, 90-day window; HTTP tests for assignment validation and GUEST/non-member/other-Workspace; e2e complete, start/continue, reassign, bulk skip; axe.

**Security impact (expected):** LOW–MEDIUM (read model; assignment validation).

**Implemented (2026-09-30):** `getHome` returns Overdue, Today, Upcoming (≤90 days in each Schedule's zone) plus a count of later Occurrences, recently done (completed/skipped in 24 h with who), Active without Runs already shown on their Occurrence, Pinned, Recent; Procedure cards show the next open Occurrence. Home rows: type (Reminder/Procedure) and repetition, due date, "Assigned to …"/"Shared", in-progress starter, one primary action (Complete / Start / Start early / Continue) and ⋯ (Skip…, Move this date…, Assign…, Link an execution…, Skip the older ones…, Edit schedule…, Pause/Resume, End schedule…); overdue Occurrences of one Schedule grouped ("3 overdue"); Recently done with Undo for Reminders; filter All / Assigned to me / Shared (pressed state by border, weight and ✓; remembered per browser); **New reminder** on Home; calm "Nothing needs attention right now"; refresh every 30 s while visible and on return.

**Tests/checks:** `home-use-cases.test.ts` (sections by each Occurrence's own zone incl. UTC+14, 90-day window with later count, recently done with who, Active without the linked Run, GUEST view); HTTP tests (assignment validation, GUEST read-only, non-member assignee); e2e (Today/Upcoming, move, end, Start from Today → Continue on the same row, abort reopens, New reminder with repetition and responsible person, filters, Complete → Recently done "Completed by …" → Undo, Skip with reason; axe on Home, the dialog and Recently done; 390 px); screenshots desktop/phone.

**Security docs updated:** YES (same security check as 14.1).

**Remaining / limitations (to address with 14.4 or later):** other members' changes appear by polling every 30 s (no push channel for Schedules — 6.1 SSE covers Runs only); later Occurrences beyond 90 days are only counted until the calendar (14.4) exists; the resume dialog offers "skip the dates that fell into the pause" but does not list them by date yet; a Schedule's full Occurrence history is available in the API (`GET …/schedules/{id}`) but has no page yet (Undo on Home covers the last 24 h); performance with 1000 active Schedules not measured.

### 14.3 Phase 3 — Instruction images on Procedure Steps
**Status:** DONE (real-iPhone HEIC check open — see Remaining)
**Depends on:** 4.2, 5.1, 8.5, 10.2/10.5 (backups); technical choices in 14.6 (T1–T5). Independent of 14.1/14.2 and may be done in parallel.

**Requirements:**
- **One optional instruction image per Step** (like the icon: optional, not a gallery). Replacing it swaps the Step's single image; removing it leaves the Step without image. The one-image rule applies to instruction images only (completion photos are 14.5).
- **Caption (D18):** required whenever a Step has an image — short descriptive text (1–200 characters) used as the image's accessible text and shown with it. The written Step (title/description) must remain understandable without the image; the editor says so, and reviewing the demo data checks it.
- **Upload** in the Step editor (`procedure.edit`): phone camera via `<input type="file" accept="image/*" capture="environment">` with a normal file picker as fallback; **≤10 MB** (10 000 000 bytes) per upload, enforced while receiving; rate-limited and CSRF-protected like other mutations.
- **Server-side validation and processing** (never trusting the client, the file name or the declared type):
  1. Identify the format from the content; accept JPEG, PNG, WebP (and HEIC only if T3 resolves it; otherwise refuse with the HEIC message below); refuse SVG, animated images, multi-page files and anything else.
  2. Check dimensions before decoding fully and refuse images above a decoded-pixel limit (initially 40 megapixels); bounded memory and processing time; at most a few images processed at once (queue, not unbounded concurrency).
  3. **Correct orientation** from the EXIF orientation first, then **remove all metadata** (EXIF incl. GPS, XMP, IPTC, comments; ICC converted to sRGB); flatten transparency onto white.
  4. **Resize** so the longest edge is at most **1600 px**, never upscaling.
  5. Encode as **JPEG**, starting at **quality 80**; if the result exceeds **500 KB** (500 000 bytes), lower the quality in steps down to a floor (initially 60), then reduce the long edge in steps down to a floor (initially 1024 px) at quality 70–80, until the file is ≤500 KB. The floors keep valves, switches and printed labels legible.
  6. If no result within the floors is ≤500 KB, or processing fails, refuse with a clear message ("This photo could not be processed. Try another photo or a smaller crop.") — nothing is stored.
- **Only the processed JPEG is stored**; the original upload is discarded (never written to the data volume except in bounded temporary processing memory/tmpfs).
- **Display:** a compact thumbnail next to the Step (editor and execution); tap/click opens it enlarged (full-screen viewer: pinch/zoom, Escape/Back closes, focus returned, caption visible); works on the 390 px execution layout (13.17).
- **Run snapshot:** a Run keeps the instruction version from its Start: the RunStep snapshot references the image and copies its caption. Stored images are immutable — replacing a template image stores a new image and never changes the old one; removing or replacing never breaks older Runs, also after the Procedure is deleted.
- **Access:** every image request goes through an authenticated, Workspace-authorised route — template images need `procedure.view` in the Workspace; Run images need access to that Run. This holds for hash-addressed files too: the content hash is an internal storage name, never a public URL or a capability; the API addresses images by id within a Workspace and checks the reference on every request. Responses: `Cache-Control: private`, `X-Content-Type-Options: nosniff`, fixed `Content-Type: image/jpeg`, `Content-Disposition: inline`, CSP-compatible (`img-src 'self'`). No public or signed URLs, no image links in reminders; Knot links still require sign-in.
- **HEIC input (T3):** JPEG is always the stored format. Until HEIC decoding is evaluated and tested on real iPhones, a HEIC/HEIF upload is refused with: "HEIC photos are not supported yet. On iPhone choose Settings → Camera → Formats → Most Compatible, or share the photo as JPEG." It is **not** assumed that iPhone browsers always convert photos to JPEG.
- **Offline (D12):** downloading a Run for offline use includes its snapshotted images (size shown); an image that cannot be stored or was evicted shows "Image not available offline" with its caption; the snapshot is never replaced by newer template images.
- **Export / import (D13):** JSON `schemaVersion 1` stays unchanged and image-free (the export dialog says images are not included). A new **Procedure archive** carries the Procedure JSON and its processed images (format and library: T4), imported with strict limits; every image goes through the same validation and processing as an upload and is charged to the target Workspace's quota.

**Workspace image storage quota:**
- *Setting:* per Workspace, chosen by a **server admin** (*Server admin → Workspaces*; storage is a server resource, the existing instance-level settings belong to server admins) from **100 MB, 250 MB, 500 MB, 1 GB**; **default 100 MB**. Workspace admins see usage; members see it when an upload is refused.
- *Units:* decimal — 1 KB = 1 000 bytes, 1 MB = 1 000 000 bytes, 1 GB = 1 000 000 000 bytes (the same units as the 10 MB and 500 KB limits). Shown as "23.4 MB of 100 MB used".
- *Accounting:* the sum of the stored sizes of the **distinct** images referenced in the Workspace — by current Steps, by Steps of restorable (soft-deleted) Procedures, and by Run snapshots (historical Runs included). An image referenced several times in the same Workspace (template + many Runs, or an identical upload) is charged **once**. Identical content in two Workspaces is charged to each Workspace (the file itself may be stored once). Images no longer referenced by anything in the Workspace are not charged, even while waiting for housekeeping.
- *Atomic enforcement:* the reference change and the usage check happen in one IMMEDIATE transaction against a per-Workspace usage counter (maintained in the same transaction as every reference change, verified/recomputed by housekeeping); concurrent uploads therefore cannot exceed the quota. The processed file is written before that transaction; if the transaction refuses, the file stays unreferenced and housekeeping removes it.
- *Full:* uploads (and archive imports) that would exceed the quota are refused: "This Workspace's image storage is full (98.7 MB of 100 MB). Remove images from Procedures or ask a server admin for more storage." Existing images, Runs and Starting Runs keep working (starting a Run adds references, not bytes).
- *Lowering the quota* below current usage deletes nothing; further storage is blocked until usage is below the limit.
- *Replacement:* replacing a Step's image is checked against usage **after** removing the old template reference: if the old image is referenced only by that Step, its bytes are released in the same transaction; if Runs still reference it, it stays charged and kept.
- *Cleanup:* housekeeping deletes a stored file only when no template Step, restorable Procedure or Run snapshot in any Workspace references it and a grace period longer than a backup run has passed; a file still referenced is never deleted.

**Tasks:** image metadata tables (image id, Workspace, content hash, bytes, width, height, created by/at) with Step and RunStep references and the usage counter (migration); quota setting per Workspace (server admin UI/API, audited as a security event like other instance settings); upload/serve/remove routes; processing pipeline (T2) with limits; HEIC evaluation (T3); housekeeping purge and counter verification; `startRun` snapshot extension; editor UI (camera/file, caption, thumbnail, replace, remove, usage); execution thumbnail and viewer; offline download of images; backup/verify/restore extension (T1); archive export/import (T4); notices and SBOM (T5); `security.md` check (file uploads, §12 trigger).

**Acceptance criteria:**
- *One image:* an editor adds a photo with the caption "Blue lever left of the meter" to "Close the main water valve" on a phone (camera) and on desktop (file); a second image replaces the first (the Step never has two); a USER sees the thumbnail while executing and enlarges it by tap.
- *Processing:* a 9 MB, 4032 × 3024 phone JPEG with EXIF orientation 6 and GPS is stored upright, as JPEG, ≤1600 px on the long edge, ≤500 000 bytes, with no EXIF/GPS/XMP; a 800 × 600 PNG is stored at 800 × 600 (no upscaling); a noisy image that cannot reach 500 KB within the floors is refused with the processing message and nothing is stored; the original upload exists nowhere on disk.
- *Validation:* an 11 MB file, an SVG, a renamed PDF, a polyglot JPEG/HTML, an animated WebP and a 20 000 × 20 000 px PNG are refused with clear messages; a HEIC file gets the HEIC message (until T3 enables support).
- *Snapshot retention:* a Run started before the editor replaces photo A with photo B still shows A — also after the Procedure is deleted and housekeeping has run; a new Run shows B; A's file is deleted only after the last referencing Run/restorable Procedure is gone and the grace period has passed.
- *Access:* the image URL returns 401 when signed out and 404 for a member of another Workspace and for a non-member — also with a copied id or a known content hash; a GUEST of the Workspace can view but not upload, replace or remove.
- *Quota:* with a 100 MB quota and 99.8 MB used, a 400 KB image is refused with the full message while existing images stay visible; two concurrent uploads that each fit alone but not together — exactly one succeeds; an image shared by a template and 30 Runs counts once; lowering 250 MB → 100 MB at 180 MB usage deletes nothing and blocks uploads until usage is below 100 MB; replacing an image referenced only by its Step at the limit succeeds when the new image is not larger; removing a Step's image referenced by old Runs does not reduce usage.
- *Backup:* scheduled backup → restore on a fresh volume shows every image; `verify` fails on a backup with a missing or altered image file.
- *Offline:* a Run downloaded for offline use shows its image in flight mode; a deliberately missing image shows "Image not available offline" with the caption.
- *Archive:* export → import into another Workspace recreates the Procedure with its images and charges that Workspace; an archive with traversal names, symlinks, duplicate names, a zip bomb, a mismatched hash, a non-image entry or a size above the limits is refused and writes nothing; JSON v1 export/import behaves exactly as before.

**Checks (security, required):** access negative tests incl. hash/id guessing and cross-Workspace references; upload validation (size while streaming, type spoofing, polyglots, decompression bombs, pixel limit, animated/multi-page, HEIC); processing properties (≤1600 px, no upscale, ≤500 KB, orientation, metadata stripped — checked by parsing the stored file); quota concurrency (parallel uploads in separate connections), dedup accounting, lowering, replacement, counter recomputation; snapshot immutability and retention/purge (never delete a referenced file); backup/verify/restore with images; archive import fuzz cases; offline store tests; e2e with the file-input fallback; axe on the viewer; physical-device checks (T3).

**Security impact (expected):** HIGH — first file-upload and file-download surface (security.md §12 trigger); new server resource limit.

**Implemented (2026-09-30):**
- *Model and migration 0025:* `step_images` (id, Workspace, SHA-256, bytes, width, height, created by/at; unique per Workspace + hash; immutable), `procedure_steps`/`run_steps.image_id` + `image_caption` (triggers keep them together, caption 1–200; Run snapshot columns immutable; FKs keep referenced images), `workspaces.image_quota_bytes` (default 100 MB; only the four choices). Domain `media.ts` (limits, caption rules, quota choices); `ProcedureStep.image`/`RunStep.image`; `startRun` copies the reference and caption.
- *Processing (T2, `packages/media`):* sharp 0.35.5 — HEIC detected and refused, content-based format check (JPEG/PNG/WebP), header pixel check (≤50 MP — raised from the planned 40 MP so 48 MP iPhone photos pass) before decoding, animated/multi-page refused, orientation then metadata-free output, flatten on white, sRGB, ≤1600 px without upscaling, JPEG 80→60 then 1400/1200/1024 px, ≤500 KB or refused; ≤2 images processed at once. Content-addressed file store `/data/media/<xx>/<sha256>.jpg` (`MEDIA` = `media/` next to the database; atomic write + fsync).
- *HEIC (T3):* the browser converts before upload (`apps/web/src/image-prep.ts`: decode via `<img>`, canvas ≤1600 px, JPEG 0.9 — Safari/WebKit on iOS decodes HEIC); the server still decodes nothing HEIC and refuses it with the planned message. This also keeps EXIF/GPS on the phone. Claimed only after a real-iPhone test (see Remaining).
- *Use cases and routes:* `uploadStepImage` (`procedure.edit`; dedup per Workspace; quota in one IMMEDIATE transaction, `replacing`), `readStepImage` (`procedure.view`, Workspace-scoped id — never a hash), `imageUsage`, `listWorkspaceImageStorage`/`setWorkspaceImageQuota` (server admins, security event `WORKSPACE_IMAGE_QUOTA_CHANGED`), `purgeUnusedImages` (hourly housekeeping). `POST/GET /api/workspaces/:ws/images[/:id|/usage]`, `GET /api/admin/image-storage`, `POST /api/admin/image-storage/:id/quota`. Quota usage is computed in the transaction instead of a stored counter (cannot drift); an upload unused past the 24 h grace is no longer charged and can no longer be attached. Duplicating a Procedure keeps its images (charged once).
- *Backups (T1):* backup (manual, scheduled, pre-migration) copies the referenced files into `backups/media` next to the backup files (shared, refreshed, pruned when no backup file needs them); `verify` checks presence and SHA-256; `restore` writes the photos into `/data/media` before replacing the database and refuses an incomplete set.
- *Archive (T4):* `.vmn.zip` = `procedure.json` (manifest + JSON v1 document) + `images/<n>.jpg`, written deterministically with yazl 3.3.1, read with yauzl 3.4.0 in bounded memory with all planned limits; `GET …/procedures/:id/archive`, `POST …/procedures/import-archive` (images re-processed and charged; all-or-nothing). JSON v1 is unchanged and image-free.
- *Web:* Step editor (Take photo / Choose photo, required description with hint, thumbnail, Replace / Remove, "Photos in this Workspace: x MB of y MB used", precise refusal messages), Procedure view and execution thumbnail with caption, full-screen viewer (`<dialog>`: Close, Escape, Back), offline copies of active Runs' images in IndexedDB (`images` store, DB version 2) with "Image not available offline", archive export/import in the Procedure menus, *Server admin → Photo storage*. CSP `img-src 'self' data: blob:`.
- *Licences (T5):* `deploy/server-notices.ts` generates `third-party-notices-server.txt` from the pruned runtime tree during the image build (libvips components and licences; LGPL/MPL texts in `/usr/share/common-licenses`); the Trivy CycloneDX SBOM of the release covers the new packages automatically.

**Tests/checks:** `pnpm lint`, `pnpm typecheck`, `pnpm test` (101 files, 796 tests), `pnpm build`, `drizzle-kit generate` (no drift), `pnpm test:e2e` (file-picker upload, caption, execution thumbnail, viewer with axe, JSON export without photos, archive export and re-import with photo), Docker build + `deploy/smoke-test.sh` (now also processes an image in the read-only container and checks the server notices). New suites: `media/image-processor.test.ts`, `media/file-media-store.test.ts`, `domain/media.test.ts`, `database/image-use-cases.test.ts`, `database/backup-media.test.ts`, `import-export/procedure-archive.test.ts`, `server/http/image.test.ts`, `server/server-notices.test.ts`; route-security sweep covers all new routes; legacy migration tests (0019, 0024) now create old-schema data in plain SQL (`insertLegacyWorkspace/Procedure/Run`).

**Security docs updated:** YES — "Security check: instruction images (Step 14.3)", §8 (media and backups), §10 (new dependencies), §12 (upload trigger reviewed for instruction images).

**Remaining / limitations:**
- *User test 2026-10-01 (real iPhone, 0.3.0-beta.3):* two photos taken with the camera from the Step editor (one landscape, one portrait), descriptions added, saved; both are stored and shown upright (screenshot of the Procedure view). Not recorded: the camera format setting (*High Efficiency* / *Most Compatible*), the browser (Safari assumed from the earlier screenshot), the photo library path, Chrome on iOS, pinch-zoom in the viewer, and the location-data check — the item below stays open for those.
- *Real iPhone test (T3) — required before announcing HEIC support:* camera capture and photo library, Safari and Chrome on iOS, camera set to *High Efficiency* and to *Most Compatible*; expected: upload succeeds, stored photo upright, no location data.
- Physical-device check of the viewer (pinch-zoom inside the full-screen dialog) on iOS and Android.
- Offline image copies stay in IndexedDB until sign-out (not pruned per finished Run); the viewer's Back handling uses a same-URL history entry.
- `replacing` can exclude one image (≤500 KB) that other Procedures still use from a single quota check; archives up to 125 MB are held in memory during import.
- Workspace admins see usage in the editor only (no separate Workspace settings view yet); a per-Workspace usage breakdown (which Procedures use most) does not exist.

### 14.4 Phase 4 — Calendar and mobile agenda
**Status:** DONE (real-phone check open — see Remaining)
**Depends on:** 14.1, 14.2 (read model).

**Tasks:** month view as the default (D16) and an agenda/list view (default on narrow screens) on `occurrencesInRange`; previous/next navigation loads that range (the display range never limits scheduling); entries show type, title, time, Assignee, status (glyph + text) and projected entries marked; filters: status (open / overdue / completed / skipped), Assignee (me / shared / member), type (Reminder / Procedure) — remembered per viewer (localStorage convenience only); selecting an entry opens it with the same actions as the overview; keyboard navigation between days; no drag-and-drop, no external calendar sync.

**Acceptance criteria:** calendar and overview never disagree about an Occurrence (same read model); completing from the calendar updates both, also for other members; past months show completed and skipped Occurrences with who/when; a series projected years ahead appears when navigating there; the agenda works at 390 px without sideways scrolling; filters combine correctly.

**Checks:** read-model tests over month and year boundaries and zones; e2e month and agenda views, navigation, filters; axe; performance with 1000 active Schedules.

**Security impact (expected):** LOW (read-only view over authorised data).

**Implemented (2026-10-01):**
- *Read model:* `occurrencesInRange` (`packages/application/src/home/use-cases.ts`): `procedure.view`; validated range (1–92 days); stored Occurrences due in the range (every state except CANCELLED; `ScheduleRepository.listDueBetween`) plus **projected** dates of active fixed series (`listFixedSeries` + domain `fixedDatesInRange`). Projection uses the generator's own rule (dates after the series' latest Occurrence), so a projected date is the date the Occurrence will get and is never shown twice. Not projected: completion-based series (the next date depends on the completion), paused and ended series, series of deleted Procedures. At most 2000 entries per answer (`truncated`).
- *Route:* `GET /api/workspaces/{id}/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD` (`calendarRoutes` in `apps/server/src/http/home-routes.ts`) → `{ from, to, occurrences, projected, truncated }` with the existing Occurrence/Schedule views; a projection has no id and no state. New stable error `invalid_range`.
- *Web:* **Calendar** in the Workspace navigation (`/w/{id}/calendar`, `apps/web/src/Calendar.tsx`; pure view model in `calendar-model.ts`). Month view (Monday first; default) with up to three entries named per day and the rest counted; the chosen day lists its entries below with **the same components and actions as Home** (`OccurrenceItem`, `DoneItem` with exact date/time and skip reason) and a non-actionable "Planned" entry for projections. Agenda view (default below 40 rem) lists the month day by day. Entries show type, title, time, responsible person and status as glyph + word (○ open, ! overdue, ▶ in progress, ✓ completed, ↷ skipped, ◌ planned). Previous/next month and Today load that range; arrow keys move between days (roving tabindex, focus kept across months), Page Up/Down between months. Filters (status, responsible: anyone / me / shared / a person responsible for something in the shown month, type) combine and are remembered in `localStorage` together with the Month/Agenda choice; they are folded away until used and open by themselves when a remembered filter hides entries. Refreshes every 30 s while visible, like Home. No drag-and-drop, no external calendar sync.

**Deviations from the plan:**
- Filters are applied in the browser on the (bounded) answer, not passed to the read model: they are a per-viewer convenience and the month's data is small. When an answer is truncated (> 2000 entries in a month), the filters therefore apply to the returned part only (a notice is shown).
- Home still reads through `listOpen`/`listRecentlyClosed` and was not rebuilt on `occurrencesInRange`; both read the same Occurrence rows through the same mapping and view (a test compares the ids), but Home shows no projected dates.
- "Selecting an entry" is selecting its day: the entries of the day are listed with their actions (no separate entry dialog).

**Tests/checks:** `pnpm lint`, `pnpm typecheck`, `pnpm test` (103 files, 820 tests), `pnpm build`, `pnpm test:e2e`. No schema change (no migration). New/extended: `packages/domain/src/schedule.test.ts` (projection across month/year ends, clamping, leap years, weekday rules, years ahead), `packages/database/src/home-use-cases.test.ts` (states, who closed, zones, year boundary, generator agreement, paused/ended/deleted/completion-based not projected, Workspace isolation, invalid ranges, 1000 active series bounded and under 2 s), `apps/server/src/http/schedule.test.ts` (HTTP shape, GUEST read, 400/401), `route-security.test.ts` (sweep covers the route), `apps/web/src/calendar-model.test.ts` (status by zone, ordering, filters alone and combined, remembered filters, month grid, arrow keys), `router.test.ts`; e2e: month view, filters incl. reload, arrow keys, a planned date one year ahead without actions, agenda and month at 390 px without sideways scrolling, Undo and Complete from the calendar reflected on Home, axe on month view and phone agenda. Screenshots of month (desktop, 390 px) and agenda (390 px) reviewed. Docker image not rebuilt locally (CI does).

**Security surface:** changed slightly — one new read-only route over data members already see. **Security docs updated:** YES — "Security check: calendar and agenda (Step 14.4)".

**Remaining / limitations:**
- Check on a real phone (the full e2e flow still runs at desktop size only; phone width is covered by the 390 px assertions).
- Changes by other members arrive by polling (30 s), not instantly.
- The week always starts on Monday; the month shows at most three titles per day (glyphs only on phones).
- Beyond 2000 entries in one month the answer is cut and marked, not paged.

### 14.5 Phase 5 (later) — Completion photos, required evidence, annotations
**Status:** TODO (later phase — not part of the first release)
**Depends on:** 14.3 (image pipeline, access rules, storage, quota accounting — completion photos will need their own quota rules).

**Scope (the one-image rule of 14.3 applies to instruction images only):** optional completion photos on an individual RunStep (what was done, with actor/time; part of the Run's history and immutable once the Run ends); a per-Step setting requiring photo evidence before Done; simple annotations (arrows, circles) on instruction images, stored as data drawn over the image.

**Fixed rules:** instruction photos explain what to do (template, snapshotted into Runs); completion photos record what was done (Run evidence). Separate references, permissions and retention: completion photos follow Run immutability and are never removed by template edits; instruction photos never become evidence.

**To plan before starting:** retention and privacy of evidence photos (homes, people), offline capture queue, storage growth, whether required evidence can be satisfied offline.

### 14.6 Decisions for section 14
**Product decisions (approved by the user on 2026-09-30; integrated above; the image rules were finalised in a second pass the same day and replace the earlier "5 images per Step" and "admin-configurable upload limits"):**
| # | Decision |
|---|---|
| D1 | Overdue Occurrences stay OPEN; fixed series grow incrementally; no automatic Runs; authorised bulk skip of older Occurrences |
| D2 | Skipping a completion-based Occurrence: next due = skip date + interval, shown before confirming |
| D3 | Resume: fixed keeps its anchor and offers to skip elapsed Occurrences; completion-based keeps its due date even if overdue |
| D4 | Offsets: on the due date, days, weeks, calendar months (clamped), several per Schedule; zone and DST rules explicit |
| D5 | Bounded catch-up after outages: ≤24 h late normal; older → one catch-up per Occurrence (most recent missed offset), earlier ones superseded, no double notification, current-status wording, grouped summaries, send-time re-checks; persistent keyed delivery records, atomic claiming, restart-safe; no exactly-once promise |
| D6 | Completing a Reminder needs the execution permission (`run.execute`); the completing user is recorded separately from the Assignee |
| D7 | Only a linked Run completes an Occurrence; deliberate, confirmed linking of an eligible existing Run; no duplicate links |
| D8 | Recipient = Assignee (Occurrence override, else Schedule), else creator; assignment grants no access; permissions and preferences respected |
| D11 | **One optional image per Step**; ≤10 MB upload; server-side validation, decoded-pixel/resource limits; orientation corrected, metadata incl. GPS removed; JPEG, ≤1600 px long edge (no upscaling), quality from 80, ≤500 KB, legibility floors, clear error otherwise; only the processed image stored |
| D11a | **Superseded on 2026-10-02 by the combined Workspace storage limit (16.4, H7 / P1): instruction images are charged to the Workspace's one limit (5 GB by default) together with Documents; the four fixed choices and the separate image quota are gone.** Until then: **Workspace image quota:** server-admin setting per Workspace — 100 MB (default), 250 MB, 500 MB, 1 GB; decimal units; distinct images incl. those retained by Runs charged once per Workspace; atomic enforcement; full → uploads refused, existing images kept; lowering never deletes |
| D12 | Offline Runs include their instruction image; unavailable images clearly marked; snapshot preserved |
| D13 | JSON import/export unchanged; additional archive format with images and safe import validation |
| D14 | Migration preserves schedules, dates, reminder settings, history and delivery records; nothing delivered is sent again |
| D15 | Clamp to the month's last day; every fixed date computed from the original anchor |
| D16 | Calendar defaults to month view, Upcoming to 90 days; ranges load on navigation; display horizon ≠ scheduling limit |
| D17 | Repository instructions updated for scope and vocabulary (14.0) |
| D18 | A short descriptive caption is required with an image; written instructions must stand on their own |

**Technical choices (resolved by inspecting the repository; no further product approval needed — confirm while implementing 14.3):**
- **T1 — storage: immutable processed JPEG files on the data volume + metadata in SQLite.** Files named by SHA-256 under `/data/media` (`0700`/`0600`; the read-only root file system is unaffected); ids, Workspace, hash, size, dimensions, captions, references and usage counters in SQLite. *Why:* scheduled backups keep `BACKUP_KEEP` (default 14) full database copies on the same volume — images as BLOBs would multiply image data 14× and grow the WAL; immutable files can be shared between backups and verified by hash. *Consistency:* the file is written and fsynced before its metadata commits; only housekeeping deletes files, and only unreferenced ones after a grace period longer than a backup, so a database snapshot never references a missing file. *Backup work:* `backup` (manual and scheduled) = verified database snapshot + the files it references (copied once into a shared, hash-named store under `/data/backups/media`, pruned with the backups that need them); `verify` checks every referenced file exists and matches its hash; `restore` (server stopped, existing exclusive-lock probe) restores database and files together and refuses an incomplete set; `migrate`'s pre-migration backup includes files; `deployment.md`, `unraid.md` and the off-host copy instructions name `/data/media` and `/data/backups/media`.
- **T2 — processing: `sharp` (libvips).** Prebuilt binaries for linux-x64 and linux-arm64 (glibc) match the `bookworm-slim` runtime and both release architectures; the current release declares no install script (to verify under `strictDepBuilds`/`allowBuilds` when adding); it decodes JPEG, PNG, WebP, supports `limitInputPixels`, `failOn`, auto-orientation (`rotate()` before output), metadata-free output (default), `flatten`, `resize({ withoutEnlargement: true })` and JPEG quality control; runs on the libuv thread pool (concurrency limited). Pure-JS/WASM codecs were considered: slower and more memory-hungry; client-side resizing is only a convenience and never trusted.
- **T3 — HEIC input (technical decision, not yet supported):** sharp's prebuilt libvips cannot decode HEIC (no HEVC decoder). Options to evaluate: (a) a WASM build of libheif/libde265 (e.g. `libheif-js`) — no native build, memory-safe sandbox, LGPL-3.0 notices, slower and memory-heavy; (b) a custom libvips with libheif/libde265 from Debian — native build in the image, more code to scan (libde265 has a history of memory-safety CVEs), larger image; both involve HEVC patent/licensing questions that must be reviewed. Support may be claimed only after real iPhone tests: camera capture and photo-library uploads, in Safari and Chrome on iOS, with the camera set to *High Efficiency* and to *Most Compatible*. Until then: the HEIC error message above (the limitation is documented in the user guide).
- **T4 — Procedure archive: ZIP read with a streaming, validating reader.** A single-JSON container with base64 images was considered but rejected: up to 200 Steps × 500 KB ≈ 100 MB of images would be parsed in memory. Recommended: `yauzl` (reading; streaming, validates declared vs actual entry sizes, refuses unsafe names) and `yazl` (writing), both MIT and pure JS — maintenance, advisories and install scripts to be reviewed when added, versions pinned. Archive layout: `procedure.json` (the v1 document plus image captions and a manifest of entry names, sizes and SHA-256) and `images/<n>.jpg`. Safe extraction: entries are read into bounded memory, **never written to paths from the archive**; only names listed in the manifest are accepted; no directories, symlinks, encryption, duplicates or unexpected entries; ≤201 entries; per-entry ≤10 MB and total ≤120 MB uncompressed, counted while streaming; compression-ratio limit; hash check; each image re-processed through T2 and charged to the quota; all-or-nothing import.
- **T5 — licence notices and SBOM:** the prebuilt libvips binaries include LGPL-3.0 components and T3 may add LGPL code; the runtime image must carry the licence texts of server-side dependencies (today `third-party-notices.txt` covers only the web bundle — add a server notices file generated from the production dependency tree), and the release SBOM (CycloneDX attestation, 10.4) must list sharp, the libvips binaries, yauzl/yazl and any HEIC decoder; verify with the attested SBOM of a test build.

**Genuine remaining blockers:** only **HEIC support** (T3: legal/patent review of HEVC decoding and real-iPhone testing). It blocks HEIC input, not 14.3 — without it, HEIC uploads are refused with a clear message. Everything else above is implementation work with a chosen direction.

---

## 15 — Tools, Today, the Procedure builder and Grocery lists (accepted 2026-10-01)

**Objective (user, 2026-10-01):** make the app easier to understand and use on desktop and phone, especially for people who struggle with clutter and attention. Organise it around tools: choose what you want to do and focus on that tool. Calendar is an optional planning view; Today brings actionable information together. Reusable Procedures, scheduled Reminders and lightweight Grocery lists stay conceptually distinct. Visual reference: three approved mockups in `assets/mock-ups/` (layout and interaction direction; content illustrative; Dark only — Light delivered to match).

**Relation to earlier work:** replaces the horizontal section navigation (8.0, 8.11) and the long Procedure form (4.2, 4.3, 8.6); reorganises Home (13.9–13.13, 14.2) into Today. Unchanged and reused: every server API and rule of Procedures, Runs, Schedules, Occurrences, reminders, images, Knots, offline execution, import/export. New on the server: Lists only.

### 15.0 Repository instruction updates
**Status:** DONE
**Completed:** 2026-10-01
**Implemented:** `AGENTS.md` — tools in the product objective; vocabulary **List**, **ListItem** ("neither a Procedure nor a Run"); UI/UX rules (navigation, focused editing, concise cards, 44 px targets, 320 px, no claimed autosave, Light = Dark); scope discipline (no further list types, categories or List–Schedule links without a requirement); testing examples (GUEST cannot change a List; builder keeps ids, never saves with unapplied Step changes).
**Security impact:** NONE (documentation).

### 15.1 Stage 1 — Navigation, Settings, Today and theme foundations
**Status:** DONE
**Completed:** 2026-10-01

**Implemented:**
- *Navigation:* desktop sidebar (brand, Workspace selector, Today / Procedures / Reminders / Lists / Calendar, one **Settings** entry at the bottom); below 56 rem a compact header (Workspace selector, Settings button) and a fixed bottom bar with four labelled destinations (Today, Procedures, Lists, More); `/w/{id}/more` leads to Reminders, Calendar and the completed history. The horizontally scrolling navigation is gone. Focused work hides the global navigation: the builder everywhere (own bar with Back), an execution on phones. Skip link; the tools stay reachable from settings pages (they lead to the last used Workspace).
- *Addresses:* every earlier address parses to the same page (`/`, `/account`, `/admin`, `/w/{id}`, `/calendar`, `/history`, `/runs`, `/runs/{id}`, `/procedures`, `/procedures/{id}`, `/members`, `/knots`, `/knot/{token}`, `/invite/…`, `/recover/…`) — pinned in `router.test.ts`. New: `/reminders[/new]`, `/lists[/new|/{id}]`, `/more`, `/settings`, `/procedures/new`, `/procedures/{id}/edit`, `/account/{section}`, `/admin/{section}`. Opening a Procedure from the list now uses its address (Back works); `#share` / `#history` open those panels.
- *Settings:* one menu — Profile & settings, Workspace settings (while a Workspace is open), Server admin (server admins only, marked "Admin only"), Sign out. One layout for all three, split into named sections with their own addresses: Profile (Notifications, Appearance, Password & security, Confirmations), Workspace (General: name, role, leave; Members; Sharing links — the former Knot links page, only with `knot.manage`), Server admin (Workspaces, Invitations, Accounts & recovery, Notification providers, Server & storage, Security log). Members and Knot links are no longer primary navigation entries.
- *Today* (former Home): Continue (Occurrences in progress and other active Runs, with progress and **Continue**), Needs attention (overdue, grouped per Schedule as before), Due today, To buy (lists with open items); calm empty state; quiet links to Calendar (with the count of upcoming dates), Reminders, All Procedures, Completed history. Upcoming, Recently done, Pinned and Recent left Today: upcoming dates → Calendar and Reminders, Recently done → Reminders (folded) and Calendar, Recently used → Procedures page, pin → Procedure ⋯ menu with a ★ mark. Cards are concise: title, one line (when · who), the next action; type, repetition, reminders and notes under ⋯ → Details; **Done** offers Undo in a notice. The All / Assigned to me / Shared filter appears only when something is assigned.
- *Add chooser:* **Add** on Today → Procedure — reusable steps / Reminder — remember one thing / Grocery list — quick shared shopping; a compact panel under the button on desktop, a bottom sheet on phones (a modal `<dialog>`: focus stays inside, Escape and backdrop close, focus returns to the button). Only what the role may create is offered; without any, no button. Each choice opens its creation flow at once (`/procedures/new` — no date needed, `/reminders/new`, `/lists/new`).
- *Themes:* tokens reworked and documented by role — added `surface-raised`, `border-strong` (control edges ≥ 3:1), `danger`, `shadow-raised`, `overlay`, layout tokens for the bottom bar and safe areas. Dark: charcoal page (`#0e0e10`), separate surfaces, warm white text, restrained crimson. Light: white page, soft neutral surfaces, visible borders, deep crimson. Memento Mori kept (pure black). System / Light / Dark / Memento Mori preferences and following the system unchanged. Destructive buttons are outlined in the danger colour (never filled like a primary); success stays green; the header's animated gradient stripe and glow were removed. Admin label "Recent Procedures on Home" → "Recently used Procedures".

**Tests/checks:** `router.test.ts` (all former addresses, new ones, unknown sections, navigation guard), `today-view.test.ts` (order and content of Today, Reminders selection, the five/four destinations, exactly one current destination per page), `AddChooser.test.ts`, `SettingsMenu.test.ts` (entries per role), `contrast.test.ts` (new tokens in all three themes: text on raised surfaces, control edges, danger, state colours on the page; surfaces distinct; danger ≠ accent), `catalog-usage.test.ts` (no unused messages; 46 removed). e2e and screenshots: see 15.4.
**Security impact:** NONE on the server (no route, capability or data flow changed). **Security docs updated:** YES ("Security check: tool navigation, Settings and the Procedure builder").
**Remaining / limitations:** the phone More destination is a page, not a sheet; Today shows lists with open items but no due time for them (Lists have no dates); "Recently used" needs the Home overview request on the Procedures page (one extra request).

### 15.2 Stage 2 — Procedure outline and focused Step editor
**Status:** DONE
**Completed:** 2026-10-01

**Implemented:**
- *Builder* (`/procedures/new`, `/procedures/{id}/edit`; replaces `ProcedureForm`): name; **Details** (description, icon, tags) folded; a default Section "Steps" for new Procedures; Sections can be added, renamed/described, reordered (drag in the rail, or ⋯ Move up/down) and removed (a populated one asks first; Undo restores it). Desktop: Section rail · Steps of the chosen Section · side panel (Step editor, else a compact run preview). Phone: Sections stacked as an accordion.
- *Steps* as compact rows: number, title, chips (Required / optional, Critical, has-image, problem), ⋯ (Edit, Duplicate, Move up/down, Move to another section…, Delete). Inline **Add a step…**: Enter adds and the field stays focused. New-Step defaults unchanged (required on, critical off, skip and N/A reasons optional). **Paste multiple steps**: non-empty lines previewed as titles (bullets/numbers removed) before adding; lines over 200 characters, control characters and more lines than fit the 200-Step limit are reported, nothing is cut. Duplicate, Move, Delete, paste and Section removal can be undone (one level: the outline before the last operation). Drag and drop on desktop (onto a Step, the end of the list, or a Section in the rail); menus and the Step editor's Section field are the keyboard/touch alternative. Ids are preserved on edit and move; duplicates and new items are sent without id.
- *Step editor*: side panel on desktop, a full screen on phones (Back returns to the outline). Section (when there are several), title, instructions, icon, one instruction image with required caption, Required and Critical switches with explanations matching the existing completion and confirmation rules, Advanced rules (skip / N/A reason policies) behind a summary showing the current values. **Apply step** updates the unsaved outline and returns; **Cancel** discards only unapplied changes (asks first). Errors sit at their fields; entered content stays.
- *Saving*: nothing is stored before **Save procedure** (no autosave, no stored draft, and nothing claims otherwise). States shown in words: Not saved yet / No changes / Step has unapplied changes / Unsaved changes / Saving… / Saved. Save is blocked while a Step has unapplied changes. Client-side validation before sending (name, Section names, Step titles, captions, 50/200 limits) with the server validating again. Saves use the existing create/update routes with `expectedRevision`: a newer server version is refused (existing `procedure_conflict` message) and can be loaded deliberately; never overwritten. Leaving with unsaved changes asks first (links, Back/Forward, Workspace switch, sign-out, closing the tab).
- *Preview*: the execution layout from the current editor content in a dialog (full screen on phones); calls no mutating API — no Run, no notification, no history.
- After saving: **Start** (Start now / Schedule…) in the builder bar, with the existing active-Run warning and scheduling. Existing Run snapshots are untouched by edits (server behaviour unchanged, 5.1/5.6).

**Tests/checks:** `procedure-draft.test.ts` (round-trip, default Section, new-Step defaults, change detection, ids on move within/between Sections and on Section reorder, duplicate without id, delete/undo, apply incl. Section change and untouched original, paste preview and its three problem kinds, field validation, limits, save states, save blocked with unapplied Step changes); e2e (validation without sending, leave-guard decline, paste problems, Undo, Apply/Cancel, unapplied-changes state and blocked Save, rules and defaults, keyboard icon choice, preview leaving the Run list empty, Saved at the new address with Start available, 320 px, phone full-screen editor and Back, ids equal before and after editing and moving, populated-Section confirm and Undo).
**Security impact:** NONE on the server. **Security docs updated:** YES (same check as 15.1).
**Remaining / limitations:** Undo is one level and does not cover text edits; an unsaved draft is lost on reload or crash (the browser asks before closing); the conflict case offers "keep my screen" or "load the latest", no merge; a photo uploaded and then cancelled stays unreferenced until housekeeping (24 h); drag and drop is pointer-only by design (menus are the alternative); no drag between Sections on phones.

### 15.3 Stage 3 — Reminder flow and minimum Grocery lists
**Status:** DONE
**Completed:** 2026-10-01

**Implemented:**
- *Reminders*: dedicated destination `/reminders` (standalone Reminders: overdue, today, next 90 days, Recently done folded with Undo) on the existing Schedule/Occurrence/notification implementation — no server change. The schedule dialog (also used for Procedures and for editing) asks for what and when first; Notes, Repeat, Responsible and Reminders are behind summaries showing their current value. Defaults, time-zone handling and notification behaviour unchanged (once, shared, one reminder on the due date, the browser's zone). A field in a folded group that blocks submitting opens the groups.
- *Grocery lists* — no list model existed (checked: domain, schema, routes; "shopping" occurred only as an icon). New vertical: domain `list.ts` (List, ListItem, kind `GROCERY`, limits, normalization of name/item/unit, quantity as a validated decimal string); migration `0026_lists` (generated; `lists`, `list_items`, soft delete, composite FK item → List + Workspace, CHECKs); `list-repository.ts`; use-cases `lists/use-cases.ts`; routes `/api/workspaces/{id}/lists` (list, create, get, rename, delete, restore, add item, update, check, remove, restore item); capabilities `list.view` (all roles) and `list.edit` (USER, EDITOR, ADMIN); audit events `LIST_CREATED/RENAMED/DELETED/RESTORED`. Web: `/lists` overview, `/lists/new`, `/lists/{id}` — add (Enter keeps the field ready), optional quantity and unit, edit, remove, tick/untick, **Undo** for tick, untick, remove and list deletion; purchased items in a collapsible group with who bought them; GUEST read-only; no Start, Required, Critical, Skip or N/A anywhere. Concurrency: transactions, List revision, idempotent check, compare-and-set edits and rename, canonical List in every answer, refresh every 10 s while visible, older answers never applied. Demo data: `test-env/seed.ts` adds a list.

**Tests/checks:** `packages/domain/src/list.test.ts`, `packages/database/src/list-use-cases.test.ts`, `apps/server/src/http/list.test.ts` (table-driven over all nine writes), `route-security.test.ts` (all eleven routes; Home's List unchanged), `policy.test.ts` (exact matrix), `list-model.test.ts`; e2e (create from Add, items, field error keeps input, two devices seeing each other's tick and Undo, conflicting edit refused, remove/undo, rename, Today "To buy", delete/undo, no Procedure controls on the page); `drizzle-kit generate` → no drift.
**Security impact:** MEDIUM — a new Workspace resource with its own routes and capabilities. **Security docs updated:** YES ("Security check: Lists — grocery lists", §3 and §5 lines, migrations 0000–0026).
**Remaining / limitations:** only grocery lists (no categories, no further list types, no link between a List and a Reminder — the mockup's "Buy groceries, today 18:00" card is not a feature); no "clear purchased" action (untick or remove items individually); a deleted List can be restored only through the Undo right after deleting (no list of deleted Lists); item edits and removals are not audit events; changes of others arrive by polling (10 s), not by push; Lists need a connection (no offline queue); no per-action rate limit.

### 15.4 Stage 4 — Responsive and accessibility verification, documentation
**Status:** DONE (real devices and a real screen reader open — see Remaining)
**Completed:** 2026-10-01

**Implemented / verified:** every control at least 44 px high on all widths (buttons, selects, inputs, checkbox rows, bottom bar, menus); no horizontal page overflow from 320 px (wide tables scroll inside their card); safe areas (`viewport-fit=cover`, insets on header, bottom bar, sheets and sticky bars); sticky bars are part of the page flow (the builder's Preview/Save bar, the Step editor's Cancel/Apply bar, Undo notices, the Run dock) and `scroll-padding-bottom` keeps a focused field clear of them; dialogs are native `<dialog>` (focus stays inside, Escape closes, focus returns to the opener); focus returns to the Step row after the Step editor closes and to the field after Add; visible focus ring in every theme; state never by colour alone (overdue badge and "!" marks, chips with words, ✓ and strike-through for purchased, save state in words, current destination by bar + bold + `aria-current`); forced-colours additions for the new navigation, switches and chips; no new animation (the header stripe animation was removed; the remaining Done pop respects reduced motion); all new text in the message catalog; headings stay ordered (the builder provides the level-one heading while the global header is hidden).

**Tests/checks (2026-10-01):** `pnpm lint`, `pnpm typecheck`, `pnpm test` (109 files, 874 tests), `pnpm build`, `pnpm test:e2e` (desktop flow incl. axe WCAG 2.2 A/AA + best-practice checks on the new states: empty Today, add chooser and sheet, builder and Step editor with errors, at 320 px, paste dialog, preview, reminders, lists on desktop and phone, More, workspace settings; no CSP violation), `drizzle-kit generate` (no drift). Axe findings fixed on the way: missing level-one heading and heading order in the builder, a duplicate landmark name on Today, wordmark contrast in Dark. Visual check with a throwaway seeded server: 27 states × desktop 1280, phone 390 and 320 px × Light and Dark = 160 screenshots (`assets/screenshots/ux-refresh/`, untracked), incl. long titles, empty states, validation failures, open menus, chooser, dialogs and editors; the script reports horizontal overflow and console errors — none besides the deliberate validation request.
**Docs updated:** `AGENTS.md`, `docs/development/security.md`, `docs/development/architecture.md`, `docs/user/user-guide.md`, this ledger.
**Security impact:** NONE.
**Remaining / limitations:** not tested on real phones (safe areas, the on-screen keyboard over the sticky bars, the bottom bar in an installed PWA) or with a real screen reader; the `mobile-chromium` e2e project still skips the account flow (phone widths are covered by explicit 320/390 px assertions inside the desktop flow); `README.md`, `docs/admin/deployment.md` and `test-env/README.md` were not changed (no command or deployment change; the upgrade applies migration 0026 through the normal `migrate`); Memento Mori was checked by the token test and the e2e axe run on the account page, not screenshotted; nothing is committed, pushed, released or deployed.

---

## 16 — House management: Documents, links, Contacts, Maintenance, Equipment, text recognition, Mail (planned 2026-10-01; product decisions confirmed 2026-10-01)

**Objective (user, 2026-10-01):** VMN should support managing a house while keeping its focused, ADHD-friendly, tool-based navigation. The tools gain **Documents** first and, in later phases, **Contacts**, **Maintenance**, **Equipment** and **Mail**. Today stays focused on upcoming actions and reminders. Light and Dark, phone and desktop are delivered alike. House management is **optional**: a general-purpose Workspace stays fully useful without any house-specific information.

**Status of this section:** 16.0–16.8 are implemented; 16.9–16.11 remain planned. Each task has its own status and completion note. The product decisions were confirmed by the user on 2026-10-01 and are integrated below (table in 16.12). What is still open is listed in 16.12: technical choices to be settled by evaluation while implementing, and a few product points that the decisions did not cover. Values marked *(engineering default)* are implementation starting points, not product decisions.

**Phases:** 1 — Documents (16.1–16.4) · 2 — links to Procedures, Runs and Reminders; Contacts (16.5, 16.6) · 3 — Maintenance and Equipment (16.7, 16.8) · 4 — text recognition, rule-based suggestions, later optional local AI suggestions (16.9) · 5 — optional IMAP/SMTP Mail and its integrations (16.10, 16.11). Each phase is releasable by itself; no earlier phase depends on a later one, and Documents waits for no decision about OCR, AI, Maintenance or Mail.

### Relation to existing work
**Reused, not re-specified here:**
- Workspaces, Memberships, roles and the central capability table (3.1, 3.2); `authorizeWorkspace` with the in-transaction re-check; "non-member ≡ unknown id → 404"; opaque non-sequential ids.
- Upload security of instruction images (14.3, `security.md` "Security check: instruction images"): content-based format detection, size enforced while receiving, pixel limit before decoding, bounded concurrency, `Origin` check, raw-body upload route, authorised Workspace-scoped serving by id (never by hash), `nosniff`, `Cache-Control: private`, no public or signed URLs; `packages/media` (sharp/libvips, T2), the content-addressed file store under `/data/media` (T1), backup / verify / restore of files (T1), housekeeping with a grace period, decimal units.
- Soft delete and explicit restore (4.5 Procedures, 15.3 Lists) as the pattern; audit events written atomically with the change (5.5); the server security log (5.7) for instance settings and security events.
- Schedules, Occurrences, reminder offsets, recipients and delivery (13.5–13.8, 14.1): the **only** reminder engine. Nothing in this section creates a second one.
- Run snapshots and historical immutability (5.1, 5.6).
- ZIP writing/reading with strict limits (T4: yazl / yauzl), licence notices and SBOM (T5).
- Sealing of server-side secrets with AES-256-GCM derived from `DATA_ENCRYPTION_KEY` (2.4, 13.7).
- Navigation, the Add chooser, focused editing, concise cards, 44 px targets, 320 px, semantic tokens and the contrast test (section 15); tags and the tag filter of Procedures (8.9); message catalog (8.4); polling refresh as used by Lists and Today.

**Deliberately different from instruction images (14.3):** documents keep the **original file byte-for-byte** and are not reduced to a ≤500 KB JPEG — the 10 MB / 1600 px / 500 KB limits and the metadata stripping of 14.3 do **not** apply to document originals; a scan must stay legible. Only derived previews are metadata-free.

**Not duplicated:** instruction images stay as they are (one per Step, 14.3). Completion photos and required evidence (14.5) stay unaccepted: a Run retaining the linked Document version (16.5) is document-version retention, not approval of completion photos. Grocery Lists get no link to Documents (15.3 scope).

**Scope changes recorded in `AGENTS.md` (16.0, done 2026-10-01):** "other attachments" and the five named tools are superseded **for exactly** Documents, Contacts, Maintenance, Equipment and Mail. "No Kanban/boards" (section 14) and "no project-management suite" are superseded **for exactly** the Maintenance status board (16.7) — no boards elsewhere, no custom columns. "No AI features" is superseded **for exactly** optional AI-assisted suggestions on VMN's own infrastructure, disabled by default, planned after OCR (16.9); external processing is neither a default nor an approved option. Still excluded: chat, automatic payments or financial decisions, automatic sending / replying / forwarding of mail, analytics dashboards (no cost totals or charts), external calendar sync, geolocation, QR/NFC, per-folder permissions, personal tool-hiding preferences. The existing deletion rules of Procedures (4.5) and Lists (15.3) are **not** changed by this section.

### Cross-cutting requirements (apply to 16.1–16.11)
**Vocabulary (to add to `AGENTS.md` in 16.0):** tools **Documents, Contacts, Maintenance, Equipment, Mail** (decided). Records: *Folder* — a named, nestable place for Documents; *Document* — one record (title, dates, type, tags, notes) holding one or more ordered files (shown as pages); *original* — the uploaded file, unchanged; *preview* / *converted version* — derived, never the original; *DocumentType*; *Trash*; *Link* — a reference between two records, never a copy; *Contact*; *MaintenanceRecord*; *Equipment*; *Mailbox* (a connected account), *live message* (at the provider), *cached message*, *saved copy* (retained in VMN).

**Optional by design (decided):** each of the five tools is **enabled per Workspace by a Workspace admin**. An enabled tool appears to every member who has a permission for it; a disabled tool appears nowhere (no navigation entry, no fields, no prompts, routes answer as for an unknown resource). There are **no personal preferences for hiding tools**. Disabling a tool hides it and keeps its data; enabling again shows the same data. Enabling / disabling is audited. No folders or records are pre-created. Every house-specific field outside the minimum (Document: title + one file; Contact: name; MaintenanceRecord: title; Equipment: name) is optional.

**Navigation (decided):** the tools follow the existing focused tool-chooser design of section 15. Desktop sidebar: enabled tools are added below the existing ones. Phones keep exactly the **four** bottom destinations (Today, Procedures, Lists, More); Documents and the later tools are reached through **More** — no further bottom-bar destination. How several enabled tools are grouped in the sidebar and on More so that neither becomes a long list is an engineering choice (16.2). The Add chooser offers "Document — keep a scan, PDF or photo" when Documents is enabled and the role may create one. Existing addresses keep working; new ones are added to `router.test.ts`.

**Today stays actionable:** Documents, Contacts, Equipment and Mail add **no** sections to Today. Planned maintenance, warranty expiry and servicing appear on Today only through ordinary Occurrences of the existing Schedules. No "new mail" or "recently added documents" block on Today.

**Permissions (decided for Documents and Contacts; Mail in 16.10):**
- Access is **Workspace-wide**; there are no per-folder permissions.
- **View:** every member, including GUEST, views Documents and Contacts; GUEST may also preview and **download** documents.
- **Manage** (create, upload, edit, move, delete to Trash, restore, link, manage custom types): USER, EDITOR and ADMIN ("users and admins" — EDITOR sits between and holds at least USER's rights everywhere in 3.2). GUEST cannot create, edit or delete.
- **Permanent deletion, enabling tools, lowering the Workspace storage limit:** Workspace ADMIN.
- **Mail:** separate rules — access to Documents never grants access to a Mailbox (16.10).
- Maintenance and Equipment: manage as above; what GUEST sees there is open (P3 in 16.12).
- New capabilities live only in the central table (`packages/permissions`); names are an engineering choice.

**Authorisation (security.md §3, §12 trigger):**
- Every file, preview, thumbnail, download, export, search result, count, suggestion, link target and extracted text is authorised server-side per request, scoped by Workspace id, with the in-transaction re-check for writes. An id of another Workspace resolves to nothing (404), also inside link lists, search results and export archives.
- **A Link never grants access.** A linked record the viewer may not read (in practice: Mail for GUEST, anything in another Workspace, a disabled tool) is not disclosed: no title, no revealing count, no file.
- Storage names (content hashes) are never URLs or capabilities.

**Files (shared by Documents, mail attachments saved as Documents, and exports):**
- The actual content is identified and validated; the file name and declared type are never trusted. Executables, scripts, HTML, SVG, archives, office macros and anything outside the allow-list are refused. Size is enforced while receiving; pixel, page-count, processing-time and concurrency limits apply to every derived representation.
- Nothing uploaded is ever executed or rendered as active content: originals are served only as downloads (`Content-Disposition: attachment`, a fixed safe `Content-Type`, `nosniff`); in-app preview uses derived, inert representations or a sandboxed viewer (HT3).
- Suspicious or unprocessable files: refused with a clear message, nothing stored. Malware-scanning options (none + documented reliance on "never executed, download only"; optional ClamAV via `clamd` as a separate container; quarantine state) are documented and one is chosen (HT6).
- File names are stored as data (normalised, length-limited, control and bidi characters refused as for email addresses in 12.4) and never used as storage paths.

**Storage quota (decided):** **one combined storage quota per Workspace** with a **breakdown by tool** (Procedures' instruction images, Documents, later extracted text and Mail). The **instance (server) admin sets the ceiling** per Workspace; a **Workspace admin may set a lower limit**, never a higher one. Counted: originals, previews and converted versions, versions retained for Runs (16.5), other stored derivatives — and **everything in Trash**. Enforcement is atomic like 14.3; lowering a limit deletes nothing; a full quota refuses new storage and never breaks reading. **Default: 5 GB (5 000 000 000 bytes) per Workspace** (decided). The quota is a **usage limit, not preallocated or reserved disk space**: nothing is set aside on the volume, and the operator remains responsible for providing the disk. This replaces the separate image quota of D11a **when 16.4 is implemented** — until then D11a stays in force, and the change must not reduce the storage any existing Workspace has.

**Audit (decided):** the product audit trail records **changes**, atomically with the change (who, when, what object, what transition): uploads, edits, moves, deletions to Trash, restores, permanent deletions, file add / remove / reorder, type changes, link add / remove, tool enabling, storage-limit changes, Contact / Maintenance / Equipment changes, Mailbox connect / change / disconnect, send, save-to-Documents, remote mailbox changes. **Routine previews and downloads are not audit events.** Security logging stays separate and unchanged in purpose: refused access, rate-limit hits, authentication events and instance-setting changes go to the server security log (5.7), not to the product audit trail, and neither is presented as the other. Audit metadata carries ids and titles where useful — **never** file contents, extracted text, mail bodies or credentials.

**Trash and permanent deletion (decided; applies only to the new house-management records):** deleting moves a record to **Trash**. There is **no automatic expiry**: items stay in Trash until a **Workspace admin explicitly deletes them permanently**, after a clear confirmation. Details in 16.4. Procedures and Lists keep their existing rules.

**Backup, export, restore:** every new file store is covered by `backup` / `verify` / `restore` and the pre-migration backup, with the volume and duration effects documented in `deployment.md` and `unraid.md` (HT2). **Backup retention is documented separately from application deletion:** a permanently deleted file remains in older backups until they rotate, and the UI and user guide never imply otherwise. Exports are user-facing and separate from backups; an export contains only what the exporting user may read.

**Usability and accessibility:** simple words (Folder, Document, Page, Contact, Trash); progressive disclosure (minimum fields first, the rest behind summaries, as in the 15.3 schedule dialog); useful empty states; no colour-only state; keyboard operation for every action incl. reordering and status changes (a control besides drag, as in 15.2); visible focus; 44 px targets; no sideways page scrolling from 320 px; Light, Dark and Memento Mori through tokens with the contrast test extended for any new token; axe on every new state; all text in the message catalog; nothing claims autosave or offline availability that does not exist. None of these tools is planned to work offline (stated in the user guide).

**Security impact of the section (expected):** HIGH for 16.1 (originals of arbitrary content and a new download surface), MEDIUM for 16.5–16.8, HIGH for 16.9 (new parsers, derived sensitive text), CRITICAL for 16.10–16.11 (stored third-party credentials, outbound connections to user-chosen hosts, hostile HTML, sending, remote changes). Each step adds its own "Security check" to `security.md` when implemented.

### 16.0 Repository instruction updates and decisions
**Status:** DONE
**Completed:** 2026-10-01
**Depends on:** nothing — the product decisions needed for Phase 1 are recorded (16.12). Do tasks 2–4 before 16.1 so implementers see the accepted scope.

**Tasks:**
1. DONE (2026-10-01, documentation) — the confirmed product decisions are recorded in 16.12 and integrated into 16.1–16.11.
2. DONE (2026-10-01) — `AGENTS.md`: product objective (optional house management), tools and navigation (enabled per Workspace; phones keep four bottom destinations), vocabulary, scope discipline (the three "for exactly" supersessions and the remaining exclusions listed under *Scope changes* above), testing examples (below).
3. DONE (2026-10-01) — `docs/development/security.md`: an outbound-connection (SSRF) policy before 16.10 (the ledger already requires it for webhooks); checklist lines for byte-identical originals with embedded metadata, previews, Trash and derived text; §12 triggers reviewed for document uploads, mail credentials and HTML mail.
4. DONE (2026-10-01) — `docs/development/architecture.md`: modules and their boundaries (documents, links, contacts, maintenance, equipment, text recognition, mail) inside the modular monolith; no new infrastructure (no Redis, queue service or search server).

**Implemented (documentation only — no code, schema, route or dependency changed):**
- `AGENTS.md`: optional house management in the product objective (five tools, enabled per Workspace by a Workspace admin, Today unchanged, pointer to 16.12); prime directive extended by uploaded files, stored third-party credentials and outbound connections; the section 16 vocabulary; "Schedules are the only reminder engine" and "Run completion never completes a MaintenanceRecord" beside the existing Schedule rule; navigation of optional tools (sidebar, More, four bottom destinations, disabled = nowhere, no personal hiding); scope discipline — the three "for exactly" supersessions (attachments → the five tools; boards → the Maintenance status board; AI → optional local suggestions after OCR, needing their own plan) and the remaining exclusions (per-folder permissions, personal tool hiding, automatic payments and cost totals, mail automation and automatic permanent remote deletion, private-address mail servers, external processing, no Redis / queue service / search server); the rule that open privacy / permission / destructive / scope points (P3–P7) are the user's to decide; the thirteen testing examples below.
- `docs/development/security.md`: planned, unchecked checklist blocks in §3 (tool capabilities, disabled tool ≡ unknown resource, GUEST read-only incl. metadata notice, per-request authorisation of every derived output, Links grant nothing, export scope, permanent deletion, Mail boundary), §5 (byte-identical originals with embedded metadata, content validation and allow-list, limits, originals never rendered, inert metadata-free previews, PDFs, file names, export archives, malware-scanning choice, search, contact imports, derived text, hostile mail) and §8 (store rules, backups, combined quota, "Trash is not deletion", "permanent deletion does not reach backups", Run-retained versions, derived text and mail cache, sealed Mailbox credentials); §9 never-log list extended (Mailbox credentials; contents of Documents, extracted text and mail); §12 triggers reviewed and extended (document uploads are a new review, not an extension of 14.3; new parsers; bulk export and permanent deletion; HTML mail; stored third-party credentials; outbound connections; sending and remote mailbox changes; text recognition and AI); new **§14 "Outbound connections to configurable hosts (SSRF policy)"** — scope, eleven rules (public addresses only with every resolved address classified, no second resolution, strict host input, per-feature port allow-list, mandatory verified TLS, no redirects, bounds, no oracle, explicit capability and instance switch, one implementation, credentials), required negative tests and stated limits; the Telegram check's open risk now points to §14.
- `docs/development/architecture.md`: "House management (Step 16) — planned module boundaries": the tools as vertical slices through the existing layers (like Lists), a dependency sketch, a table of what each module owns / may use / must not do (tool settings, storage, documents, links, contacts, maintenance, equipment, text recognition, mail), cross-module rules (authorisation, one reminder engine, Trash, one way in for files, in-process jobs with claims and leases, polling, one outbound connector, untrusted content) and "no new infrastructure"; the webhook note points to §14; a worker process of the same deployment added to the future extension boundaries.

**Engineering choices made while writing (not product decisions; changeable in the implementing step):** in §14 a host is refused as a whole when **any** of its resolved addresses is not public, and classification is an allow-list of public addresses; `localhost`, single-label names and non-canonical IP forms are refused before lookup; one shared connector guarded by a test. In the architecture: Run-retained Document versions live beside the Run in the links module; quota usage is computed in the writing transaction as in 14.3; all background work stays in the server process.

**Tests/checks:** documentation only — no test, lint or build is affected (no tooling reads these files; checked by search). Cross-read against 16.12: every statement taken into the three files is a recorded decision (H1–H22, P1, P2), a listed engineering default or an explicitly marked open choice (HT1–HT14, P3–P7); nothing open was decided. Section numbers of `security.md` are unchanged (§14 is appended), so existing references stay valid.

**Security impact:** NONE for the running application (no behaviour changed). The security *policy* grew: §14 is new and normative for every future outbound connection to a host entered through the application.
**Security docs updated:** YES.

**Remaining:** every new checklist line in `security.md` is unchecked until its step implements it; the Mail threat model stays with 16.10 task 2 (the policy it needs now exists); §14 says plainly that a self-hosted ntfy / Gotify on a private address could not be connected either — allowing private targets would be a new product decision.

**Testing examples to add:** a Workspace A member cannot read, preview, download, search, export or link a Document of Workspace B; a GUEST can view, download and bulk-export Documents but cannot upload, edit, move or delete one, and a GUEST's export contains nothing from Mail or other content they cannot access; a Link never reveals a record the viewer cannot read; a renamed executable or HTML file is refused as a Document; an original downloads byte-identical to its upload; moving a Folder into its own descendant is refused; only a Workspace admin can permanently delete from Trash; a Run still shows the Document version linked at the time after the Document is edited or permanently deleted; completing a Run never completes a MaintenanceRecord; text-recognition results follow the source Document's permissions; a GUEST has no Mail access; mail credentials never appear in responses or logs; a retried Send never sends twice.

**Acceptance criteria:** the instruction files and this section use the same vocabulary; nothing in them contradicts the decisions in 16.12; no decision is recorded that the user did not make.

### 16.1 Phase 1 — Document storage, upload and processing foundation
**Status:** DONE (released only together with 16.2)
**Completed:** 2026-10-01
**Depends on:** 16.0 (tasks 2–4); 14.3 (media store, processing, backups). No open product decision. The technical choices HT1–HT6 are settled by evaluation as the first task of this step.

**Requirements:**
- **Accepted formats:** PDF, JPEG, PNG and iPhone HEIC/HEIF. Everything else is refused with a message naming the accepted formats. The instance admin can narrow the allow-list, never widen it beyond what the server can validate.
- **Originals (decided):** the uploaded file is stored **byte-for-byte, including embedded metadata**, and **Download original** returns exactly those bytes (same SHA-256). Nothing rewrites, re-encodes, rotates or strips an original.
- **Metadata notice (decided):** the upload screen and the user guide say plainly that originals are kept exactly as uploaded and **may contain location (GPS) or other embedded data** — relevant because every member, including guests, can download them.
- **HEIC/HEIF (decided):** the actual HEIC/HEIF file is uploaded and kept as the original, even if a preview is produced by conversion in the browser. A converted JPEG is **never** labelled or served as the original. How the preview is produced (browser-made preview uploaded alongside and re-validated like any untrusted image, a WASM decoder on the server, or a custom libvips) is HT1; a HEIC the server cannot decode is still validated as HEIC by its container structure and size before it is stored.
- **Derived versions:** thumbnails and preview pages are separate, inert (metadata-free raster images or a sandboxed viewer, HT3), labelled "Preview" or "Converted from HEIC" wherever shown next to an original, regenerable, and never replace the original.
- **Legibility:** preview resolution and compression keep small print on an A4 bill readable when zoomed (the 14.3 floors are too low); the original is always available for download.
- **Limits:** **50 MB (50 000 000 bytes) per file initially, configurable by the instance admin** (decided). *(Engineering defaults:* 50 files per Document, 50 MP per image, 500 pages per PDF for preview generation.*)* Enforced while receiving and before decoding; processing bounded in memory, time and concurrency; a queue, not unbounded parallelism.
- **PDF handling:** validated as PDF by content; encrypted or password-protected PDFs and PDFs with embedded files or JavaScript — refuse, or store download-only without preview (HT4). No PDF is ever rendered with scripting enabled.
- **Upload transport:** desktop file picker and drag-and-drop; phone: photo library and camera (`accept` / `capture` where the browser supports it, file picker as fallback). Per-file progress, clear per-file failure, **Retry** for a failed file without re-uploading the successful ones, cancel. Whether large uploads are resumable/chunked is HT5 (50 MB over a phone connection); an interrupted upload never leaves a half-visible Document.
- **Storage:** immutable files on the data volume with metadata in SQLite, following T1 (content-addressed, written and fsynced before the row commits, deleted only by housekeeping when nothing — no Document, Trash item or Run-retained version — references them and the grace period has passed). Same store as instruction images or a separate one, and how backups cope with the size: HT2.

**Tasks:**
1. DONE — HT1–HT6 evaluated and recorded with reasons (16.12).
2. DONE — Domain (`packages/domain/src/document-file.ts`): formats, limits, name normalisation, download names, original / preview distinction, storage arithmetic.
3. DONE — Migration `0027_document_files`: `document_files`, `document_file_derivatives`, immutability triggers; `workspaces.storage_quota_bytes`; two instance settings.
4. DONE — `packages/media`: document validation (PDF, JPEG, PNG, HEIC container), preview generation (HT1, HT3), limits; the 14.3 pipeline is untouched and is not used for originals.
5. DONE — Upload, preview and download routes; instance-admin settings for the file-size limit and formats through the existing settings API (security-log event; the settings *page* is 16.4 task 2); route-table coverage.
6. DONE — Housekeeping: unreferenced uploads, orphan and staged files; unfinished previews resumed. "Usage verification" needs no job: usage is computed in the transaction, not kept as a counter.
7. DONE — Backup / verify / restore and their documentation (HT2); reverse-proxy body limits and timeouts in `deployment.md` / `unraid.md`.
8. DONE — Dependency review (`mupdf`; `libheif-js` reviewed, then removed — HT1): install scripts, advisories, licences, notices (T5); the SBOM follows from the image at the next release.
9. DONE — `security.md` "Security check: document files (Step 16.1)"; the 16.1 lines of §5 and §8 checked off.

**Acceptance criteria:**
- A 12 MB phone JPEG with EXIF orientation and GPS, a 3-page scanned PDF and a PNG upload successfully; each **downloads byte-identical to the upload** (equal SHA-256, GPS still present in the JPEG), and each has a legible, metadata-free preview shown upright.
- An iPhone HEIC photo is stored as HEIC and downloads byte-identical; its preview is labelled as converted; nothing calls the JPEG the original.
- The upload screen states that originals may contain location or other embedded data.
- Refused with clear messages, nothing stored: a 51 MB file (cut off while receiving), an `.exe` renamed to `.pdf`, an HTML/JPEG polyglot, an SVG, a ZIP, a 20 000 × 20 000 px PNG; encrypted and script-carrying PDFs behave as HT4 decides. After the instance admin sets the limit to 20 MB, a 25 MB file is refused and existing larger files stay readable.
- Signed out → 401; member of another Workspace, non-member, guessed id or known hash → 404, for original, preview and thumbnail alike; a GUEST of the Workspace downloads the original.
- Three files uploaded with the second failing: the first and third are kept, the second shows its error and **Retry** uploads only that one.
- Backup → restore on a fresh volume returns every original byte-identical; `verify` fails when one is missing or altered.

**Checks (required):** validation and bomb tests per format; streaming size enforcement; byte-identity of originals (hash) and metadata-freeness of previews (parsing the stored files); preview legibility fixture (small print); access negative tests incl. hash/id guessing; concurrency and quota races on separate connections; backup/verify/restore; Docker smoke test processing a PDF and a photo in the read-only container; real-iPhone HEIC upload (extends the open T3 matrix).

**Security impact:** HIGH — a new upload and download surface that keeps hostile input as it is, two new parsers, a new storage limit, new capabilities.
**Security docs updated:** YES (`security.md`: §3 / §5 / §8 lines for 16.1, "Security check: document files (Step 16.1)").

**Implemented:**
- **Domain** (`document-file.ts`): the four formats with their only content types and extensions; 50 MB default limit (instance setting 1–100 MB); 50 MP; 500 preview pages; previews ≤ 2400 px, PDF pages at 200 dpi, thumbnails 400 px; original names as data (directory part dropped, NFC, 1–255 code points, control / invisible / bidi characters refused); server-generated download names ending in the detected format; `fitsStorage`; 5 GB default storage limit.
- **Capabilities:** `document.view` (every role, GUEST included — H4) and `document.manage` (USER, EDITOR, ADMIN) in the central table; exact-matrix test updated. The purge and tool-administration capabilities come with 16.2 / 16.4.
- **Schema** (migration 0027, generated + hand-written triggers): `document_files` (Workspace, SHA-256, bytes, detected format, original name, page count, pixel size, password-protected and active-content flags, preview state and attempts, uploader id + display-name snapshot, time; immutable except the preview progress), `document_file_derivatives` (file, PREVIEW / THUMBNAIL, page, hash, size; immutable; no cascade — a file row can only go after its derived rows), `workspaces.storage_quota_bytes` (default 5 000 000 000), `instance_settings.document_max_file_bytes` and `.document_formats` (validated by triggers).
- **Store** (`packages/media/document-file-store.ts`): `/data/documents/<xx>/<sha256>`, `0700` / `0600`; an upload is streamed into `/data/documents/.staging` while it is counted and hashed, fsynced, inspected there, then renamed into place — never buffered in memory or written to `/tmp`; derived files through the same store.
- **Processing** (`document-file-processor.ts`, `document-worker.ts`, `document-worker-host.ts`): signature at offset 0; JPEG / PNG / HEIC header through sharp (HEVC only, no AVIF, no animated PNG, 50 MP before decoding), images containing HTML markup refused; PDFs through MuPDF (pages, password protection, JavaScript / embedded files); previews of JPEG, PNG and PDF as re-encoded metadata-free JPEGs; **no preview for HEIC** (HT1); MuPDF as WebAssembly in one worker thread, one job at a time, terminated after 30 s; memory bounded by the module (2 GiB) with a best-effort watchdog at 1.5 GB of process growth.
- **Use-cases** (`packages/application/src/documents`): `uploadDocumentFile` (authorise → name → stage → inspect → allowed format → draw page 1 → commit → register with the storage limit in one transaction → store preview and thumbnail → queue the rest), `getDocumentFile`, `openOriginal`, `openDerivative`, `documentStorageUsage`, `purgeUnusedDocumentFiles`, `createPreviewQueue` (PENDING / READY / PARTIAL / FAILED / NONE; resumable; three attempts). Three uploads at once per person.
- **HTTP** (`document-file-routes.ts`): `POST /api/workspaces/{id}/document-files` (raw body, name in `X-File-Name`), `GET …/usage`, `GET …/{fileId}`, `…/original` (attachment, detected type, `nosniff`, `no-store`, `sandbox` CSP), `…/thumbnail`, `…/pages/{n}`. Errors: `file_rejected` + reason (413 for `too_large`, else 422), `storage_full` (409, with usage), `too_many_uploads` (429), `file_not_found` (404). `POST /api/admin/settings` accepts `documentMaxFileBytes` and `documentFormats`.
- **Server:** request timeout 15 minutes for the upload route only (a hook keeps 30 s for every other request; idle connections close after 60 s); a refused upload is answered while at most 32 MB of the remaining body are discarded; housekeeping and shutdown wired in `main.ts` / `app.ts`.
- **Backups** (`backup.ts`): `backups/documents` with hard links (copy as fallback), a file hashed when it enters; `verify` / `restore` hash every file; pruning with the backups; rows of expired uploads whose file is already gone are left out, lost previews are re-queued.
- **Docs:** `deployment.md` (volume layout, backup and restore with documents, disk space, hard links, proxy body size and timeouts, no malware scanning), `unraid.md`, `architecture.md` ("Document files (Step 16.1)"), `security.md`. Web: only the catalog messages for the new error codes — no screens yet.

**Decisions made here (engineering; changeable, none is a product decision):** uploads are **not audit events** — the audited change is adding a file to a Document (16.2), as an instruction image upload is not audited but the Procedure save is; identical content uploaded twice gives two file rows (own name and uploader) charged once; a PDF or image that cannot be drawn is refused, while a password-protected PDF and a HEIC the decoder cannot read are kept download-only; previews are made eagerly for up to 500 pages and stop when the Workspace is full (the original is kept); the file name travels in a header rather than the address; `storage_quota_bytes` is introduced now as the home of the combined limit and charges documents only until 16.4.

**Acceptance criteria — result:**
- 12 MB phone JPEG with orientation and GPS, 3-page PDF, PNG: uploaded, each downloads byte-identical (SHA-256; GPS still in the JPEG), each has an upright, metadata-free preview — **met** (HTTP tests).
- HEIC stored as HEIC and downloaded byte-identical — **met** with a `heif-enc` file; **not yet on a real iPhone**. "Its preview is labelled as converted" — **not met, deferred by decision (HT1):** a HEIC has no preview; the API says `preview.unavailable: "format"` and the screen shows "Preview unavailable for this format" (16.2). Nothing calls a JPEG the original — there is none.
- Upload screen states the metadata notice — **met with 16.2** (Add document screen and user guide; asserted by the e2e flow).
- Refusals with clear reasons, nothing stored: 51 MB cut off while receiving, `.exe` as `.pdf`, HTML/JPEG polyglot, SVG, ZIP, 20 000 × 20 000 PNG — **met**; encrypted and script-carrying PDFs behave as HT4 — **met**. Limit lowered by the instance admin: larger files refused, existing ones readable — **met** (tested with 11 MB; the same code path as 20 MB).
- 401 signed out; 404 for other Workspace, non-member, guessed id, known hash (400 for the hash: it is not an id) on original, preview and thumbnail; GUEST downloads — **met**.
- Three files, the second failing: first and third kept, only the second sent again — **met on the server** (independent requests); the Retry control is UI (16.2).
- Backup → restore on a fresh volume byte-identical; `verify` fails for a missing or altered file — **met**.

**Tests/checks:** `pnpm lint`, `pnpm typecheck`, `pnpm test` — 115 files, 933 tests, all passing (new: `document-file.test.ts` in domain 6, `document-file-store.test.ts` 6, `document-file-processor.test.ts` 14, `document-file-use-cases.test.ts` 18, `backup-documents.test.ts` 6, `document-file.test.ts` over HTTP 9; route-table, policy, settings, workspace, notices and error-catalog tests extended). Evaluation runs for HT1–HT5 in a scratch directory (figures in 16.12). `docker build` of the production image and `deploy/smoke-test.sh` passed: a PDF and a HEIC are processed and an upload is staged in the read-only, capability-less container, and the notices list `mupdf` and `libheif-js`. `pnpm audit --audit-level high`: clean (one moderate finding in the dev-only drizzle-kit chain, as before). No e2e or axe run: there is no new screen.
**Not run:** the Trivy image scan and the arm64 smoke test (CI / release workflow); a real-iPhone upload.

**Remaining:**
- Resolved by 16.2 (2026-10-01): the Workspace tool switch, the reference rule that keeps a Document's files, the metadata notice on the upload screen, the per-reason upload messages, the preview wording, previews shown in portions, audit events for files added to or removed from a Document.
- **HEIC previews are deferred** pending a licensing / patent review of HEVC decoding (owner's decision 2026-10-01, HT1). Until then HEIC files are stored and downloadable without a preview, and their image data is not validated beyond the container.
- Real-iPhone matrix for HEIC (Safari and Chrome on iOS, *High Efficiency* and *Most Compatible*, camera and library) — extends the open T3 matrix.
- The instance-admin page for the limit and formats and the storage usage view are 16.4 (the API exists).
- **Parser memory and the container limit (owner's decision 2026-10-01: 4 GiB by default).** The bound that always holds is MuPDF's own 2 GiB WebAssembly maximum (about 2.4 GB for a job in the worst case); the 1.5 GB watchdog is best effort. `deploy/compose.yml` now sets `mem_limit: 4g` and `memswap_limit: 4g`, the Unraid template `--memory=4g --memory-swap=4g`; `deployment.md`, `unraid.md` and `security.md` describe it. **Validated** with the new `deploy/memory-check.sh` + `memory-check.ts` (a built image started with the limit and the Compose hardening; test files made on the spot): a 47 MB scan of 21 pages, a 500-page PDF of 40 MB, a 49-megapixel PDF page, five 48-megapixel photos, PDFs with bitmaps expanding to 0.4 / 1.2 / 2.1 GB, progressive JPEGs of 196 and 400 megapixels, a 30-page PDF of 430 MB bitmaps — uploaded up to three at a time, hostile and ordinary files together, beside two loops of ordinary requests (Today, Procedures, Lists, Documents; about 7 400 requests). Result, twice: **peak 2.9 GB = 68 % of the limit** (kernel figure, page cache included; 1.65 GB in the phase with only ordinary large files; 0.3 GB idle), **no process killed, no restart, no failed request**, ordinary requests median 3 ms, 99 % within 9 ms, slowest 129 ms; every upload stored and previewed (MuPDF draws the large bitmaps without holding them whole), the scan downloaded byte-identical. The 47 MB scan took 145 s for its 21 previews while the other files were processed, 10 s alone. **Still to do before release:** run `deploy/memory-check.sh` on the Unraid host (other CPU, memory and disks); existing Unraid containers need the options added by hand (`unraid.md` says how). The check is not part of CI (it needs several gigabytes and about four minutes). A third run on 2026-10-01 after the restart-policy change: peak 2.95 GB (69 %), same result.
- **Restart policy in the Unraid template (owner's decision 2026-10-01): `--restart=unless-stopped`.** Extra Parameters are now `--init --user 0:0 --security-opt no-new-privileges:true --memory=4g --memory-swap=4g --restart=unless-stopped` (the 4 GiB limit without additional swap is unchanged; Compose always had `restart: unless-stopped`). `unraid.md` explains the behaviour, how existing installations add the options (Edit → Advanced View → Extra Parameters → Apply) and how to verify them; `deployment.md` and `security.md` are updated. **Tested** with the new `deploy/restart-check.sh` on the development machine (Docker 29.8.2, a freshly built image, a throwaway volume, the container started with exactly the template's Extra Parameters, `PUID=99` / `PGID=100`, migrate on start), all three parts passing: (1) *unexpected termination, simulated:* the server process (running as user 99) was killed with SIGKILL from inside the container → Docker restarted the container (RestartCount 0 → 1), the server became ready, and the account (sign-in), the Workspace, the enabled Documents tool and a Folder created before were still there; (2) *a real out-of-memory kill, at a lowered limit:* the same container parameters with `--memory=1g --memory-swap=1g`, then a 2.3 MB PDF holding a 400-megapixel progressive JPEG was uploaded → the kernel killed the server (Docker reported an `oom` event for the container), Docker restarted it, ready again, data intact; (3) *intentional stop:* `docker stop` → still `exited` after 20 s with RestartCount unchanged and no answer on its port; `docker start` → ready, data intact. **What this does not prove:** an out-of-memory kill at the real 4 GiB limit (none of the test files reaches it — the 1 GiB run shows the mechanism, not the 4 GiB case); behaviour on Unraid itself (its Docker version, its Edit / Apply recreation of the container, the Autostart switch, the Tailscale hook starting inside the restarted container); a restart of the Docker service or of the host (Docker documents that `unless-stopped` leaves a manually stopped container stopped; not exercised here); a restart loop when the server cannot start at all (e.g. a failed migration with migrate-on-start — Docker retries with growing pauses until someone stops the container; described in `unraid.md`). **Before release:** run `deploy/memory-check.sh` and `deploy/restart-check.sh` on the Unraid host, and add the options to the existing container there.
- Image size: MuPDF adds about 14 MB unpacked to the production image.

### 16.2 Phase 1 — Folders, Documents and metadata
**Status:** DONE (not released; 16.1 and 16.2 ship together)
**Completed:** 2026-10-01
**Depends on:** 16.1. No open product decision.

**Requirements:**
- **Enabling:** Documents is switched on per Workspace by a Workspace admin (Workspace settings); see *Optional by design*.
- **Folders (decided): nested.** Create, rename, move, delete to Trash, restore. Examples: TARI, Property Tax / IMU, Water, Electricity, Insurance, Repairs, with sub-folders such as Water / 2026 — none pre-created. Sibling folder names are unique (compared case-insensitively after normalisation). *(Engineering defaults:* depth ≤ 10; Documents may also sit at the top level, outside any folder.*)*
- **Moving a Folder** takes its whole subtree along. **Cycles are prevented:** moving a Folder into itself or any of its descendants is refused, checked inside the transaction (also against a concurrent move) and backed by a database guard; a move that would exceed the depth limit or collide with a sibling name is refused with the reason.
- **Deleting a Folder (decided)** moves **the Folder and all its contents** (sub-folders and Documents) to Trash as one unit; the confirmation names the counts. Items already in Trash stay as they were.
- **Restore (decided) preserves hierarchy and contents:** restoring a Folder brings back the subtree exactly as it was when deleted (items that had been deleted separately before stay in Trash). Predictable rules for the edge cases, always stated in the result message:
  - *Name conflict:* if a sibling with the same name now exists, the restored Folder is renamed "*Name* (restored)", then "(restored 2)", …; nothing is merged or overwritten. Documents need no unique title and are restored unchanged.
  - *Missing parent:* if the original parent is in Trash or permanently deleted, the item is restored into the **nearest ancestor that still exists**, otherwise to the top level ("Restored to *Water* because *2024* is in Trash"). Restoring the parent later does not move it again.
  - A single Document or sub-folder can be restored out of a trashed Folder by the same rules.
- **Documents:** one record with **one or more files**. Several photos of one bill are one Document; pages (files) can be reordered (drag, and Move up / Move down for keyboard and touch), added and removed later. Mixing PDFs and photos in one Document is allowed; order is the user's.
- **Fields:** title (required), Folder, optional DocumentType, **document date** (the date on the paper; optional at upload), optional **year** (independent of the document date — a 2026 tax notice may be dated January 2027; defaulting from the date is a convenience the user can change), optional notes, optional tags (the Procedure tag rules, 8.9).
- **Recorded separately, never editable:** uploaded at, uploader (id + display-name snapshot), last modified at / by. Editing metadata or pages changes "last modified", never "uploaded".
- **Types:** built-in bill, receipt, contract, tax notice, manual, warranty, inspection report, correspondence; Workspace-managed custom types (add, rename, retire — a retired type stays on existing Documents), managed by USER and above.
- **Move** a Document to another Folder (single, and multi-select); Links and history stay intact.
- **Creation is light:** choose files → title prefilled from the file name (editable) → Folder → Save; type, dates, notes and tags behind "More details". Nothing is stored as a Document before Save, and nothing claims a draft.
- **Permissions (decided):** GUEST views, previews and downloads; USER, EDITOR, ADMIN manage; no per-folder permissions.
- **Concurrency:** revision on Document and Folder; a stale edit is refused with the existing conflict pattern, never silently overwritten.

**Tasks:**
1. DONE — Domain (`packages/domain/src/document.ts`): Folder tree (placement, cycle and depth rules, sibling names, restore target and name), Document, file order, DocumentType, validation and limits.
2. DONE — Migration `0028_documents`: `workspace_tools`; `document_folders` (parent reference, composite FK incl. Workspace, cycle trigger), `documents`, `document_pages`, `document_types`; Trash columns (who, when, deleted with which Folder); CHECKs and triggers.
3. DONE — Capabilities `document.view` / `document.manage` (16.1) and `workspace.tools.manage`; use cases with in-transaction re-checks; audit events. The purge capability comes with permanent deletion (16.4).
4. DONE — HTTP routes with strict bodies and limits; routes of a disabled tool answer 404; route-table sweep.
5. DONE — Web: tool switch in Workspace settings; Documents in the sidebar and under More; Folder tree with breadcrumbs; Document view (pages, preview, enlarge, download one / all originals); upload flow with the metadata notice; edit, reorder, move (picker), delete with Undo; Trash with Restore; empty states; read-only presentation without `document.manage`.
6. DONE — Demo data in `test-env/seed.ts` (written; not executed — see Tests); user guide.

**Acceptance criteria:**
- **The user's example:** with Documents enabled, a member creates a **Water** folder, uploads three iPhone photos as **one** bill, puts the pages in order, sets its document date, previews each page and downloads its original files.
- In a Workspace where Documents is not enabled, no member sees the tool anywhere and its routes answer 404; after a Workspace admin enables it, every member sees it without any personal setting; a USER cannot enable or disable it.
- Folders nest (*Water / 2026*); moving *Water* into *Water / 2026* is refused; two concurrent moves that would form a cycle — at most one succeeds.
- Deleting *Water* moves the folder, its sub-folders and Documents to Trash; restoring it brings back the same tree and Documents. If a new *Water* exists meanwhile, the restored one is *Water (restored)*. Restoring only *2026* while *Water* is in Trash puts it at the top level and says so.
- Page order survives reload and is the same for other members; reordering works by keyboard and on a phone without drag.
- Uploaded-at and uploader never change when the Document is edited by someone else; last-modified shows that person and time.
- A custom type "Condominium minutes" can be added, used, renamed and retired; retired types remain on old Documents and are not offered for new ones.
- A GUEST opens, previews and downloads a Document; every write route refuses a GUEST and no editing control is shown; a Folder or Document id of another Workspace resolves to nothing.

**Checks:** domain tests incl. property tests of the tree (no cycle after any sequence of moves, deletes and restores; restore rules); use-case tests; permission matrix (`policy.test.ts`); HTTP table tests over every write; conflict and concurrent-move tests; e2e on desktop, 390 px and 320 px in Light and Dark; axe on tree, list, view, upload, reorder, dialogs.

**Security impact:** HIGH together with 16.1 — new Workspace resources, capabilities and a tool switch over sensitive content that guests can read by decision.
**Security docs updated:** YES (`security.md`: §3 lines for 16.2, "Security check: Folders, Documents and the tool switch (Step 16.2)"; the 16.1 check updated).

**Implemented:**
- **Tool switch:** `workspace_tools`; `POST /api/workspaces/{id}/tools` (`workspace.tools.manage`, ADMIN), audited (`WORKSPACE_TOOL_ENABLED` / `_DISABLED`); `authorizeTool` in front of every document and document-file use-case and inside every write; a tool that is off answers `404 tool_not_enabled` to everyone. The enabled tools come with the Workspace and the Workspace list. No personal hiding exists.
- **Folders:** nested (≤ 10 levels, ≤ 1000 per Workspace), sibling names unique without case (NFKC), create / rename / move with subtree / delete to Trash / restore; cycle prevention in the transaction and by a trigger.
- **Documents:** title + 1–50 ordered files; optional type (eight built-in, own types per Workspace with add / rename / retire), document date, year, notes, tags; uploaded at / by immutable, last modified set on every change; revision-checked edits; move single and several; delete to Trash, restore.
- **Trash:** a Folder goes with everything live in it as one unit; restore brings back exactly that; name conflict → "*Name* (restored)", missing parent → nearest existing ancestor or top level, both reported; a part of a trashed Folder can be restored by itself. Nothing is deleted for good and nothing expires (the database refuses deletes).
- **Files become permanent** as pages of a Document (the reference rule in the repository and in the backup); a page taken out is an unused upload again and is removed by housekeeping.
- **Routes** (21): tools, document-folders, documents (incl. `move`, `trash`), document-types — listed in `architecture.md`.
- **Web:** `Documents.tsx`, `DocumentFields.tsx`, `document-model.ts`; routes `/w/{id}/documents…`; sidebar entry and More entry when enabled, four bottom destinations unchanged; Add chooser entry "Document — Keep a scan, PDF or photo"; Tools card in Workspace settings (admins); folder view with breadcrumbs, a folded "All folders" tree, sub-folders, Documents with thumbnail and one line of context that always names its date ("Document date …" / "Uploaded …"); Add document (metadata notice, file chooser with drop zone and camera on phones, per-file progress, failure and Retry, order, title proposed from the first file, folder, "More details"); Document page (facts, pages with previews five PDF pages at a time, enlarge, Download original / all, Move up / down / Remove, Add files, Edit details, Move, Move to Trash with Undo); Trash (Restore, Show contents); "Preview unavailable for this format" for HEIC, notes for password-protected PDFs, pending and failed previews, PDFs with active content. About 190 catalog messages.
- **Docs:** `user-guide.md` (Documents chapter, tools, Workspace settings), `architecture.md`, `security.md`, `test-env/seed.ts`.

**Decisions made here (engineering defaults; changeable):** the tool switch is checked before the capability (a disabled tool is 404 also for a GUEST calling a write); Trash is listed for `document.manage` (those who can restore), not for GUEST; a Folder view lists up to 200 Documents, newest upload first, until 16.3 brings search, sorting and paging; own type names are unique among the types in use; removing a page deletes its file at the next housekeeping (confirmed in the UI); "Download all originals" starts one download per file (the ZIP export is 16.4); the Document's title is proposed from the first file only until the person types one; limits — 50 000 Documents and 100 own types per Workspace, 200 Documents per move.

**Acceptance criteria — result:**
- The user's example (Water folder, three photos as one bill, in order, document date, preview and download of each original) — **met** (use-case, HTTP and e2e tests; the e2e downloads compare bytes).
- Tool not enabled: nowhere in the UI and 404 on its routes; after enabling every member sees it without a personal setting; a USER cannot switch it — **met**.
- Nesting; *Water* into *Water / 2026* refused; two concurrent cycle-forming moves — at most one succeeds — **met**.
- Delete and restore of *Water* with its tree; "*Water* (restored)" when the name is taken; restoring only *2026* puts it at the top level and says so — **met**.
- Page order survives reload and is the same for other members; reordering by keyboard and on a phone without drag — **met** (e2e: keyboard, 390 and 320 px).
- Uploaded at / by never change; last modified shows the editor and time — **met** (also enforced by a trigger).
- Custom type added, used, renamed, retired; stays on old Documents, not offered for new ones — **met**.
- GUEST opens, previews, downloads; every write route refuses a GUEST; ids of another Workspace resolve to nothing — **met** on the server. "No editing control is shown" follows from the capability-driven rendering and is **not covered by an end-to-end run with a guest account** (the e2e flow has a single account).

**Tests/checks:** `pnpm lint`, `pnpm typecheck`, `pnpm test` — 119 files, 985 tests, passing (new: `document.test.ts` domain 13 incl. the randomised tree invariants, `document-use-cases.test.ts` 19, `document.test.ts` HTTP 6, `document-model.test.ts` 11; route-table, policy, workspace, Add chooser, navigation and router tests extended). `pnpm test:e2e`: the Documents part of the flow (tool switch, upload with a refused file, keyboard reorder, byte-identical downloads, HEIC without preview, Trash and restore) with axe at 1280, 390 and 320 px in Light and Dark, no sideways scrolling, no CSP violation — passing. Screenshots of the upload page, the Document page, the folder at 320 px (dark), Trash and the settings were looked at. Production image built and `deploy/smoke-test.sh` passed (see 16.1).
**Not run:** the new part of `test-env/seed.ts` (type-checked only; the same requests are exercised by the HTTP tests). A real screen reader. Real phones.

**Remaining:**
- 16.1 and 16.2 are a unit and are **not released**; nothing is committed.
- ~~**Permanent deletion does not exist yet (16.4)**~~ Done in 16.4 (2026-10-02): a Workspace admin deletes from Trash for good.
- ~~Search, filters, sorting, grid and paging are 16.3; until then a Folder shows its newest 200 Documents.~~ Done in 16.3 (2026-10-02): lists are paged, fifty at a time.
- ~~The storage usage view, the admin page for file size and formats, and the ZIP export are 16.4.~~ Done in 16.4.
- A guest-account run in the browser, and tests on real phones (camera capture, HEIC from an iPhone, the upload over a mobile connection).
- Memento Mori was not checked separately for the new screens (they use existing tokens only; Light and Dark were checked with axe).
- The local test environment (`.var/test-env`) was started once during this step, which applied migrations 0027 and 0028 to its demo database; it was stopped again. Its demo data has no Documents (the seed only runs on a fresh install).

### 16.3 Phase 1 — Recently added, search, filters, sorting, list and grid
**Status:** DONE (released in 0.5.0-beta.1)
**Completed:** 2026-10-02
**Depends on:** 16.2; technical choice HT7 (settled in this step — 16.12).

**Requirements:**
- **Recently added** across all Folders (by uploaded date, newest first).
- **Search** over titles, notes and tags (no file contents until 16.9). Matching rules (case, accents, partial words — German, Italian and English text) and the mechanism (SQLite FTS5 or indexed `LIKE`) are HT7. Items in Trash are never found.
- **Filters:** Folder (with or without its sub-folders), type, year, tags, uploader — combinable, shown as removable chips, reset in one action; applied **on the server** (unlike the 14.4 calendar filters, a Workspace's documents are not a small bounded set).
- **Sort:** document date, uploaded date, title, last modification; ascending / descending. The chosen **date basis is always labelled** on each row ("Document date 12 Mar 2026" / "Uploaded 3 Apr 2026") so two dates are never confused; Documents without a document date sort last under that basis and say "No document date".
- **Pagination:** cursor-based, stable under concurrent inserts, a fixed page size *(engineering default: 50)* with "Show more"; total counts only where cheap and authorised.
- **List and grid:** a list (title, type, date with its label, Folder path, page count) and a grid of thumbnails; both keyboard-navigable with real links/buttons, thumbnails with text alternatives (the title), the choice remembered per viewer (`localStorage` convenience only). The grid is never the only way to tell Documents apart.
- **Empty and failure states:** no documents, nothing in this Folder, no results ("No documents match — clear filters"), failed load with Retry.

**Tasks:**
1. DONE — Read model with server-side filter, sort and cursor; indexes; search per HT7 (migration `0029_document_search`).
2. DONE — Routes; bounded query parameters; the existing global API limit applies (no own limit — a page is one request).
3. DONE — Web: Recently added, search field, filter panel folded until used, sort control with labelled date basis, list/grid switch, "Show more".
4. DONE — Performance fixture: 10 000 Documents in one Workspace (a test, run with the suite).

**Acceptance criteria:**
- **The user's example (continued):** the Water bill is found with type = bill and year = 2026, and its files download from the result.
- Searching "acqua" finds a Document with that word in its notes or tags; search never returns a Document of another Workspace or one in Trash, and reveals no count of them.
- Switching the sort from document date to uploaded date changes the label on every row.
- Paging through 10 000 Documents while another member uploads shows no duplicates and skips nothing already present; each page answers within the bound fixed with the fixture *(engineering default: 500 ms)*.
- List and grid are fully operable by keyboard and pass axe at 320 px in Light and Dark.

**Checks:** read-model tests (filter combinations, sub-folder inclusion, sort stability, cursors under inserts and deletes, isolation); injection attempts through search and sort parameters; e2e; axe; performance fixture.

**Security impact:** MEDIUM — search, filters and filter values are a new read surface over Workspace content (what a query can reveal, also through counts, cursors and timing), and search words now appear in web addresses. No new capability, no new write path, no new dependency.
**Security docs updated:** YES (`security.md`: §5 "Search and sort parameters" checked off, §3 and §8 notes, "Security check: finding Documents (Step 16.3)").

**Implemented:**
- **Matching rules (HT7, `packages/domain/src/document-search.ts`):** text is *folded* before it is compared — compatibility-decomposed (NFKD), accents and other marks removed, lower-cased, `ß` → `ss` — so "Müll" = "MULL", "perché" = "perche", "Straße" = "strasse". A search is split at spaces into at most 8 words (100 characters in all; more is refused, not cut); a Document matches when **every** word occurs **anywhere inside** its title, notes or tags — also inside a longer word ("rechnung" finds "Stromrechnung"), from two letters on, never across title / tag / notes borders. No ranking, no stemming.
- **Schema (migration 0029, generated + one hand-written trigger):** `documents.title_key` (folded title: the sort key for "title"), `tag_keys` (folded tags: the tag filter), `search_text` (folded title, tags and notes, one per line); four partial indexes over live Documents (`workspace_id` + upload time / last change / document date / title key, each with `id`); trigger `documents_search_required` refuses a new Document without the three columns. The columns are written by the application with every create and edit; SQL cannot fold text, so the **`migrate` command fills them** for rows from before 0029 (`fillDocumentSearch`, idempotent, also used by the test databases).
- **Read model (`document-repository.ts`: `findDocuments`, `filterValues`):** always `workspace_id = ?` and "not in Trash", then the filters as bound parameters — Folder (alone, with everything live below it, or "not in a Folder"), type (built-in key or own type id), year, tags (all of them, folded, exact tag), uploader (the name recorded on the Document) and one `LIKE ? ESCAPE '\'` per search word with `%`, `_` and `\` made literal. Order by upload time, last change, document date or title, either way, with the id as tie-break; Documents without a document date come last in both directions. **Keyset paging:** fifty per page; the cursor is the last row's sort value and id, the next page is "strictly after" it — stable under inserts and deletions. The total is counted for the first page only. `filterValues` returns the years, tags (one spelling per tag, most used first, at most 200) and uploader names that live Documents of the Workspace have.
- **Use-cases (`documents.ts`):** `findDocuments` (replaces `listDocuments` and the 200-Document view of 16.2) and `documentFilterValues`, both behind `authorizeTool(…, 'document.view')` like every Documents read.
- **Routes:** `GET /api/workspaces/{id}/documents?q=&folder=<id>|top&sub=1&type=builtin:<key>|custom:<id>&year=&tag=…&uploader=&sort=uploaded|documentDate|title|modified&dir=asc|desc&cursor=` → `{ documents, nextCursor, total }`; `GET …/documents/filters` → `{ filters: { years, tags, uploaders } }`. Strict query schema (unknown parameters → 400), bounded lengths, at most ten `tag` values; the cursor travels as base64url JSON and only its shape is checked. Without parameters the answer is every Document of the Workspace, newest upload first.
- **Web (`Documents.tsx`, `document-model.ts`):** the top level shows the Folders and **Recently added** — every Document, newest first, each row naming its Folder; a Folder shows its own Documents. Above the list: a **search field** (asks once typing pauses, Enter at once), **Sort by** (eight orders in one control), **List / Grid** (remembered in this browser), and **Filters**, folded until opened or in use: Folder (top level: all, "Not in a folder", or one — with "Include sub-folders"; inside a Folder only that checkbox), Type, Year, Tag, Uploaded by — offering only values that exist. Active filters are **chips** that each remove exactly their filter, beside **Clear filters**. The row's date is **named after the order in use** ("Uploaded …", "Document date …" / "No document date", "Changed …"). The count is announced ("3 documents match", "Showing 50 of 120 documents"); **Show more** adds the next fifty. States: no documents yet, nothing directly in this folder, "No documents match" with *Clear search* / *Clear filters* and — inside a Folder — *Search all folders*, and a failed load with *Try again*. Search and filters are kept in the address (`?q=…&year=…`), so Back from a Document returns to the same list and a reload keeps it. Grid tiles are plain links with the thumbnail (text alternative "First page of …"), the title written out and the labelled date. About 55 catalog messages.
- **Docs:** `user-guide.md` (finding documents), `architecture.md` (routes, the read model), `security.md`.

**Decisions made here (engineering; changeable, none is a product decision):**
- **HT7: a folded search column and `LIKE`, not FTS5** — measured, reasons in 16.12.
- **The uploader filter compares the display name recorded on the Document**, not a user id: responses of Documents carry display names only (16.2), and a guest must not receive member ids through a filter. Consequence: a person who changed their display name appears under both names, and two people with the same name are one entry.
- At the top level the list is **all Documents** (16.2 showed only those outside any Folder); "Not in a folder" is a Folder filter. While a search or filter is in use, the sub-folder cards are hidden so the results come first.
- The cursor carries the sort value instead of naming a row (as the 5.7 history cursors do): a row may be moved to Trash between two pages, and paging must survive that. A cursor is only a position inside a query that is already scoped to the Workspace — it grants and reveals nothing; a malformed one, or one made for another order, is `400 invalid_cursor`.
- The list is refreshed by polling (30 s) only while one page is shown; after **Show more** it stays as it is until the search, filters or order change (no silent reshuffling under the reader).
- Tags that differ only by case or accents are one tag in the filter. Filters offer at most 200 values each.

**Acceptance criteria — result:**
- The user's example, continued (Water bill found with type = bill and year = 2026; files download from the result) — **met** (use-case, HTTP and e2e tests; the e2e download compares bytes).
- "acqua" finds a Document with the word in its notes or tags; never one of another Workspace or in Trash, and no count of them — **met** (the total, the filter values and a borrowed cursor are checked as well).
- Switching the sort from document date to uploaded date changes the label on every row — **met** (view-model test and e2e).
- Paging through 10 000 Documents while another member uploads: no duplicates, nothing already present skipped, each page within 500 ms — **met**: four orders × 200 pages with real uploads in between; the slowest request of the whole fixture (pages, seven searches, the filter values) took **14 ms** on the development machine (16 cores, NVMe).
- List and grid fully operable by keyboard and passing axe at 320 px in Light and Dark — **met** (e2e: chip removed with Enter, a grid tile opened with Enter; axe on list, grid, filters open, no results, at 1280 and 320 px in both schemes; no sideways scrolling; search, sort and view controls ≥ 44 px high).

**Tests/checks:** `pnpm lint`, `pnpm typecheck`, `pnpm test` — 121 files, 1013 tests, passing (new: `document-search.test.ts` in domain 7, `document-search-use-cases.test.ts` 15 incl. the 10 000-Document fixture, one HTTP test in `document.test.ts`, 5 in `document-model.test.ts`; the 16.2 tests adapted to the paged listing; the route-table test covers the new route automatically). `pnpm test:e2e` passing (desktop; the account flow is skipped on the mobile project as before). Screenshots of the filtered list, the grid, the empty result and both views at 320 px (Light and Dark) were looked at. Production image built and `deploy/smoke-test.sh` passed (migration 0029 applied by `migrate` in the container). **Mutation checks** (each made a test fail): Trash filter removed; Workspace scope removed; wildcards not escaped; cursor tie-break dropped; "no document date last" dropped; cursor shape unchecked; filter values including Trash (the test had to be strengthened first); search columns not updated on edit. HT7 evaluation: a benchmark in a scratch database (figures in 16.12).
**Not run:** a guest account in the browser; real phones; a real screen reader; Memento Mori separately (existing tokens only); the Trivy scan and arm64 smoke test (CI / release).

**Remaining:**
- **Limits of the matching rules:** no ranking (results follow the chosen order), no stemming (searching "bills" does not find "bill", while "bill" finds "bills"); "ae" does not find "ä"; letters that Unicode does not decompose (ø, æ, ł) are not folded. To revisit with beta feedback.
- **16.9 must re-evaluate the mechanism for recognised text:** a `LIKE` scan reads all searched text of the Workspace; with every Document holding 4 000 characters of notes a search without hits took 139 ms at 50 000 Documents — recognised text is larger. The matching rule (folded text, every word a substring) was chosen so that an FTS5 trigram index can replace the scan there without changing what is found; the cross-Workspace cost measured for FTS5 (16.12) must be solved then.
- Sorted by last change, a Document edited while someone pages can move between pages (inherent to that order).
- Selecting **Documents** in the navigation while a search is in the address does not clear it (the address path is the same); *Clear filters* does.
- The uploader filter by recorded name (see decisions) — a filter by person would need member ids in Document responses, also for guests: to decide if wanted.
- `test-env/seed.ts` was not extended (its one demo Document is found by title, type and year).
- From before: a guest-account run in the browser, real phones.


### 16.4 Phase 1 — Storage usage and limits, export, Trash and permanent deletion
**Status:** DONE (released in 0.5.0-beta.1)
**Completed:** 2026-10-02
**Depends on:** 16.1, 16.2; technical choice HT2. No open product decision.

**Requirements:**
- **Combined quota (decided):** one storage quota per Workspace covering all tools. **Default: 5 GB (5 000 000 000 bytes) per Workspace.** It is a **usage limit, not preallocated or reserved disk space** — no space is set aside, several Workspaces' limits may add up to more than the volume holds, and `deployment.md` / `unraid.md` tell the operator to size and monitor the disk (backups included). **Ceiling:** set per Workspace by the instance admin (*Server admin → Server & storage*; security-log event). **Lower limit:** a Workspace admin may set one at or below the ceiling (audited). Usage is shown to Workspace admins **broken down by tool** — Procedures (instruction images), Documents: originals / previews / retained for Runs / Trash; later Text and Mail — and to members when an upload is refused ("Storage is full: 4.9 GB of 5 GB. Free space or ask an admin."); decimal units as in 14.3.
- **Counted:** originals, previews and converted versions, versions retained for Runs (16.5), other stored derivatives, and **Trash**. Identical content referenced several times in a Workspace is charged once, as in 14.3.
- **Transition from D11a:** the instruction-image quota becomes part of the combined quota. The migration gives every existing Workspace the 5 GB default — larger than every D11a choice (100 MB–1 GB), so no Workspace loses storage; the four fixed choices of D11a are replaced by a configurable value. D11a is marked superseded in 14.6 when this is implemented, not before.
- **Instance-admin settings:** quota ceiling, maximum file size (initially 50 MB), allowed formats — security-log events like `WORKSPACE_IMAGE_QUOTA_CHANGED`.
- **Export (decided):** a **ZIP** containing the **original files in their folder hierarchy**, **machine-readable metadata** (titles, dates, year, type, notes, tags, uploaded at / by, last modified, page order, hashes, and the relevant relationships — links to Procedures, Reminders, Runs and later records, by id and title) and a **readable HTML index** for browsing the export without VMN. **Safety:** archive paths are generated by the server from normalised names (no traversal, no absolute paths, no reserved or control characters, length-limited, collisions numbered) with the stored original name kept in the metadata; the HTML index is static, escapes every value, contains no script, no remote resource and only relative links into the archive. Streamed, not built in memory; bounded size with a clear message when a selection is too large; rate-limited; audited (an export is a deliberate bulk action, unlike a routine download). Scope: a Folder with its sub-folders, a selection, or all Documents; Trash is not exported. The exact schema and how relationships are represented are technical design choices. Import of such an export is not planned.
- **Who may export (decided): every member who can view Documents, including GUEST** — consistent with their Workspace-wide view and download access. A GUEST's export contains the same original files, metadata and HTML index as anyone's. **Authorisation and resource limits apply to every export:** the capability is checked per request and every included record is scoped by Workspace; *(engineering defaults)* one running export per user, a rate limit, and the size bound above.
- **An export never widens access:** relationships are written only for records the exporter may read. A Link to a Mail message, or to any other record the exporter cannot access (GUEST has no Mail access), is left out of the metadata and the index entirely — no id, title, subject, sender or count. Provenance stored on a Document itself (16.11) is part of that Document and is exported with it, as it is visible in the Document.
- **Trash (decided):** one Trash for the house-management records of the Workspace (Folders and Documents; later Contacts, MaintenanceRecords, Equipment), showing what, who deleted it and when, with **Restore** (USER and above, rules in 16.2). **No automatic expiry.** Trash counts toward storage, and the usage view says how much it holds.
- **Permanent deletion (decided):** only a **Workspace admin**, explicitly — single items, a selection, or "Empty Trash". The **confirmation** states the number of items and files, that this cannot be undone, what is kept (next point) and that copies may remain in backups until those rotate. It records an audit event with ids, titles and counts — no content — and removes the records; their files are deleted by housekeeping once nothing references them and the grace period has passed, and their bytes are then released.
- **What survives permanent deletion:** a Document version retained by a Run (16.5) stays readable from that Run and stays charged to storage; Links on other records show "Document permanently deleted on … by …" without content; saved mail copies and imported attachments are Documents and follow the same rules.
- **Backups (documented separately):** application deletion does not remove copies from existing backups; `deployment.md` and the user guide explain backup retention (`BACKUP_KEEP`) and off-host copies as a separate matter.
- **Scope:** this policy applies to the new records only; Procedure (4.5) and List (15.3) deletion are unchanged.

**Tasks:**
1. DONE — Combined usage accounting with the per-tool breakdown and atomic enforcement; migration from the image quota; housekeeping verification.
2. DONE — Instance-admin and Workspace-admin settings UI/API with security-log / audit events.
3. DONE — Export use case, route and UI; archive and HTML-safety tests reusing the T4 hardening.
4. DONE — Trash view, Restore, permanent deletion with confirmation; housekeeping of released files.
5. DONE — User guide and `deployment.md` / `unraid.md`: storage, Trash, permanent deletion versus backups; `security.md` check.

**Acceptance criteria:**
- Two concurrent uploads that each fit alone but not together: exactly one succeeds; lowering a limit below usage deletes nothing and blocks new uploads; reading and downloading keep working when full.
- A new Workspace has a 5 GB limit without any configuration; creating it reserves no disk space (the data volume's free space is unchanged). A Workspace admin can lower the limit below the ceiling but not raise it above; only the instance admin changes the ceiling. After migration every existing Workspace has 5 GB, and none has less instruction-image storage than before.
- The usage view shows the breakdown by tool; moving 300 MB of Documents to Trash leaves total usage unchanged and shows 300 MB under Trash; permanently deleting them releases the space after housekeeping.
- A format removed from the allow-list is refused for new uploads; existing Documents of that format stay readable.
- An export of *Water* contains the three original photos byte-identical under `Water/…`, metadata reproducing title, dates, type, tags, page order and links, and an `index.html` that opens offline in a browser and lists them. A Document titled `../../x<script>` and a file named `CON.pdf` produce safe paths and inert HTML. The export contains nothing from Trash or another Workspace.
- A GUEST exports *Water* and receives the same originals, metadata and index as a USER. Where a Document is linked to a Mail message (Phase 5), the GUEST's export contains no trace of the message, while a USER's export names it. A second export started while the first is running, or beyond the rate limit, is refused with a clear message.
- Items stay in Trash indefinitely; a USER can restore but not permanently delete; a Workspace admin's permanent deletion needs the confirmation and leaves an audit event; a Document version retained by a Run is still shown by that Run afterwards.

**Checks:** quota concurrency, accounting and migration tests; settings authorisation negatives; export content, isolation, path-safety and HTML-escaping tests; export by GUEST incl. omission of Mail and other inaccessible links; export rate and concurrency limits; Trash / restore / purge lifecycle incl. retained versions and referenced files; no time-based purge exists (test); backup interaction documented and tested.

**Security impact:** HIGH — the first destructive operation on user content (permanent deletion), a bulk export that guests may run, one new capability (`document.purge`), a changed resource limit for two tools (instruction images now share the Documents limit), and new admin settings.
**Security docs updated:** YES (`security.md`: §3, §5 and §8 lines for 16.4 checked off; "Security check: storage, export and permanent deletion (Step 16.4)"; the instruction-image and document-file checks point to the combined limit).

**Implemented:**
- **One combined limit (`packages/domain/src/storage.ts`, `packages/database/src/storage-usage.ts`):** a single function, `storageUsageIn`, computes what a Workspace stores — instruction images (the 14.3 rule: used by a Step or a Run, or uploaded within the last day), Document originals, previews, and **Trash** (originals and previews of Documents in Trash) — and the limit in force. Both upload paths (instruction image, Document file) and the preview writer call it **inside their IMMEDIATE transaction**; identical content is charged once per Workspace, and content shared by a live Document and one in Trash counts as live. Nothing is a stored counter.
- **Ceiling and own limit (migration 0030):** `workspaces.storage_quota_bytes` is the **ceiling** (server admin; 100 MB – 1000 GB; `WORKSPACE_STORAGE_CEILING_CHANGED` in the security log), the new `storage_limit_bytes` the **Workspace's own lower limit** (Workspace admin; never above the ceiling — also refused by a trigger; `WORKSPACE_STORAGE_LIMIT_CHANGED` in the audit trail). The limit in force is the lower of the two, also after the ceiling is lowered. `image_quota_bytes` (D11a) stays in the table and is no longer read: every Workspace already had the 5 GB default, more than any image quota, so nobody lost storage. A full Workspace answers `409 storage_full` with used and limit for an image and a Document file alike.
- **Routes:** `GET /api/workspaces/{id}/storage` and `POST …/storage/limit` (`workspace.settings.manage`: Workspace admins) with the breakdown; `GET /api/admin/storage` and `POST /api/admin/storage/{id}/ceiling` (server admins; replace `/api/admin/image-storage…`). `…/images/usage` and `…/document-files/usage` give every member used and limit only.
- **Export (`packages/domain/src/document-export.ts`, `packages/application/src/documents/export.ts`, `packages/import-export/src/documents-archive.ts`):** `GET …/documents/export/check` says how much an export would hold; `GET …/documents/export[?folder=<id> | ?document=<id>…]` streams a ZIP — `index.html`, `metadata.json`, then each original under `<Folder>/…/<Document title>/<NN> - <file name>`, stored uncompressed, opened one at a time. **Every path is generated** (`exportSegment`, `planExportPaths`): separators, reserved, control and invisible characters replaced, leading / trailing dots removed, Windows device names prefixed, 80 code points per segment, collisions numbered without regard to case; the extension is that of the detected format. `metadata.json` (format `vergissmeinnicht.documents-export`, version 1) holds title, Folder, type, document date, year, notes, tags, uploaded / last modified at and by, and per file: page, path, original name, format, bytes, SHA-256 — plus `links: []` per Document until Links exist (16.5). `index.html` is static: every value escaped, percent-encoded relative links only, no script, a `default-src 'none'` policy of its own. For `document.view` — **guests included (P2)**. Bounds: 2 GB and 5 000 files per export (`413 export_too_large` with the numbers), 200 Documents per selection, one running export per person (`429 export_running`), ten requests per fifteen minutes; audited as `DOCUMENTS_EXPORTED` (scope, Folder, counts, bytes). Trash is never exported.
- **Permanent deletion:** capability `document.purge` (ADMIN only); `POST …/documents/trash/purge` with `{ items: [{ kind, id }] }` (1–200) or `{ all: true }`. A Document, or a Folder with exactly what went to Trash with it, is deleted — rows and pages in one transaction with one audit event per item (`DOCUMENT_PURGED`: title, files; `FOLDER_PURGED`: name, folders, documents, files). Something else in Trash that lay inside a deleted Folder (deleted separately, earlier) is **not** taken along: it moves up to that Folder's parent and can still be restored. The files are removed by the existing hourly housekeeping once nothing references them (and their upload is more than a day old), which releases their bytes. The triggers `documents_no_delete` / `document_folders_no_delete` are replaced by `…_delete_only_from_trash`: what is not in Trash can still never be deleted. No code path deletes by time.
- **Web:** *Workspace settings → General → Storage* (admins): used of limit as text and a meter, the lines by tool, the own limit in GB. *Server admin → Server & storage*: every Workspace with the same breakdown and its ceiling; **Document files** (largest file 1–100 MB, accepted formats). Documents: **Export…** in the ⋯ menu of every Folder and of the top level (for everyone, guests too) and **Export selected…** while selecting — a dialog names the size before the download starts; Trash for admins: **Delete permanently…** per entry, a selection, **Empty Trash…**, each behind a confirmation that states how many documents, folders and files, that it cannot be undone, what the history keeps, and that copies may remain in backups. The Step editor's photo line and a refused photo now speak of the Workspace's storage. About 75 catalog messages.
- **Docs:** `user-guide.md`, `deployment.md` ("Workspace storage", backups versus deletion), `unraid.md`, `architecture.md`, `security.md`; D11a marked superseded in 14.6.

**Decisions made here (engineering; changeable — none changes a product decision):**
- **The Workspace's storage view and its own limit use `workspace.settings.manage`** (ADMIN) instead of a new capability; permanent deletion got its own, `document.purge`, because it is the one destructive right.
- **Range of a limit: 100 MB to 1000 GB**, entered in GB in steps of 0.1. The database only insists on "positive" and "own limit ≤ ceiling"; the range is the application's rule.
- **Export bounds: 2 GB and 5 000 files** per export, 200 Documents per selection; larger sets are exported Folder by Folder. The export is a `GET` (a plain download the browser can save while it arrives); the session cookie is `SameSite=Strict`, so another site cannot start one.
- **Archive layout:** one directory per Document, files numbered by page — so equal titles and equal file names never overwrite each other and page order survives outside VMN.
- **Purging a Folder deletes exactly what a restore of it would have brought back** — not other Trash entries that happen to lie inside it.
- **One audit event per purged item**, not per contained Document (as `FOLDER_DELETED` in 16.2).
- The old routes `/api/admin/image-storage…` and the error `image_quota_exceeded` are gone (unreleased clients do not exist; the web client is updated).

**Acceptance criteria — result:**
- Two uploads that fit alone but not together: exactly one succeeds; lowering a limit below usage deletes nothing and blocks new uploads; reading keeps working — **met** (an image and a Document file on two connections; ceiling far below usage).
- New Workspace 5 GB without configuration, nothing reserved; Workspace admin lowers but cannot exceed the ceiling; only the instance admin changes the ceiling; after migration every Workspace has 5 GB and no less image storage — **met**. "Free space unchanged" is shown as "creating a Workspace writes no file"; the migration part follows from 0027's default (5 GB for every row) and D11a's maximum of 1 GB — there is no separate test with a pre-0027 database.
- Usage by tool; Documents moved to Trash leave the total unchanged and appear under Trash; permanent deletion releases the space after housekeeping — **met** (with kilobytes instead of 300 MB).
- A format removed from the allow-list is refused, existing Documents stay readable — **met** (16.1 tests; the settings page is new and covered by e2e).
- Export of *Water*: three originals byte-identical under `Water/…`, metadata with title, dates, type, tags, page order, `index.html` listing them; `../../x<script>` and `CON.pdf` give safe paths and inert HTML; nothing from Trash or another Workspace — **met** (the archive is read back with a ZIP reader; the HTTP and e2e tests find the original bytes in the download). "Links" are an empty list until 16.5. `index.html` was checked structurally (tags, attributes, links), **not opened in a browser by a test**.
- GUEST exports the same as a USER; a second export while one runs, or beyond the rate limit, is refused clearly — **met**. The Mail part applies from Phase 5.
- Items stay in Trash indefinitely; a USER restores but cannot purge; an admin's purge needs the confirmation and leaves an audit event — **met**. "A Document version retained by a Run is still shown" applies from 16.5.

**Tests/checks:** `pnpm lint`, `pnpm typecheck`, `pnpm test` — 127 files, 1045 tests, passing (new: `storage.test.ts` 3 and `document-export.test.ts` 5 in domain, `documents-archive.test.ts` 3, `storage-use-cases.test.ts` 14, `storage.test.ts` over HTTP 3, `storage-model.test.ts` 3, one in `document-model.test.ts`; image, document-file, document, route-table, policy, workspace and error-catalog tests adapted). `pnpm test:e2e` passing (desktop; storage card, export with the ZIP's bytes compared to the uploads, the deletion dialog's wording, the server storage page, axe on each). Production image built and `deploy/smoke-test.sh` passed (migration 0030 applied by `migrate` in the container). **Mutation checks**, each caught by a test: an image upload not checked against the limit; images or Trash left out of usage; the own limit ignored; a limit above the ceiling accepted; the in-transaction re-checks for the ceiling, the own limit and purge removed or weakened; purge naming live Documents or another Workspace's; Trash strays not re-parented; export including Trash or another Workspace; the export bound not enforced; dots, separators or collisions kept in archive paths; HTML not escaped; links not encoded. (Removing only the *outer* check of the ceiling or of purge is not caught by itself — the in-transaction check behind it still refuses; that is the intended second layer.) Screenshots of the storage card, the export and deletion dialogs and the server storage page were looked at.
**Not run:** a guest account in the browser; real phones; a real screen reader; an export near the 2 GB bound (the bound itself is tested with small limits); `deploy/memory-check.sh` with an export running; the Trivy scan and arm64 smoke test (CI / release).

**Remaining:**
- **Before release (owner's list, unchanged):** `deploy/memory-check.sh` and `deploy/restart-check.sh` on the Unraid host; the options on the existing container; 16.1–16.4 ship together.
- **Freed space is not immediate:** a purged file is removed by the hourly housekeeping, and only when its upload is more than a day old (the grace period that keeps backups consistent). The confirmation result says so.
- **A purged file stays in existing backups** until they rotate (`BACKUP_KEEP`) and in off-host copies — stated in the dialog, the user guide and `deployment.md`. VMN cannot erase them.
- An export that loses a file while it is being sent (a Document purged at that moment and already cleaned up) ends as a broken download rather than a silently incomplete archive.
- The export rate limit and "one at a time" are per server process (in memory), like the upload limits.
- 16.5: retained Run versions join the storage breakdown and the reference rule; exports list links; Links show "permanently deleted on … by …".
- `test-env/seed.ts` not extended. A guest-account run in the browser, real phones.


### 16.5 Phase 2 — Links between Documents and Procedures, Reminders and Runs
**Status:** DONE (committed as `aeb4ca9`, part of release 0.5.0-beta.2 — 12.21; P4 resolved 2026-10-02 — see "P4 — removal from a finished Run" below)
**Completed:** 2026-10-02
**Depends on:** 16.2, 16.4 (retained versions in storage and Trash rules); 4.x, 5.1 / 5.6, 14.1; technical choice HT8; product point P4 (removal of retained Run evidence) before the Run part is released.

**Requirements:**
- **References, not copies:** a Link connects a Document to a Procedure, a Reminder, or a Run. A file is never duplicated to make a Link. One generic, typed link model serves the later tools (Contacts, Maintenance, Equipment, Mail) instead of one table per pair (HT8). *(Engineering default:* a Reminder Link points to the Schedule and is shown on its Occurrences.*)*
- **Typical uses:** a bill linked to its payment Reminder; the payment receipt added as further pages of the same Document **or** as a related Document linked to it (both supported; Document ↔ Document "related" Links); an inspection report linked to a maintenance Procedure or to the completed Run that produced it.
- **From a Document (decided):** "Remind me…" lets the user **choose** between **a standalone Reminder linked to the Document** and **scheduling a Procedure** (an existing Procedure is picked; the Schedule is linked to the Document). Both open the existing schedule dialog with the title prefilled; **dates and notification settings are reviewed by the user** before anything is created — nothing is taken silently from metadata. The result is an ordinary Schedule (existing capability `schedule.manage`, existing limits, recipients and notifications).
- **Both directions where useful:** a Document shows its linked records; a Procedure, Reminder / Occurrence and Run show their linked Documents — folded, with counts only of what the viewer may read. Today cards do not grow: a linked Document is reachable from Details.
- **No access through Links:** creating a Link needs read access to both ends and the manage capability; reminder emails and Telegram messages never contain Document content or file links.
- **Runs retain the linked version (decided):** linking a Document to a Run records **the Document version as it is at that moment** — its metadata (title, type, document date, year, notes, tags, page order) and its files, which are immutable and are retained for the Run. The Run shows "Document version linked on … by …" and can open and download exactly those files. **Later edits, moves, deletion to Trash or permanent deletion of the source Document never change what the Run shows**; when the source differs, the Run says so ("The document has changed since" / "The document was deleted on …") and, while the source exists, offers a way to it. The Link is an audited addition beside the Run: the Run snapshot, its Steps and its audit history are never rewritten, and a completed Run stays immutable (5.6). Retained versions count toward storage (16.4). This is document-version retention, **not** completion photos or required evidence (14.5 stays unaccepted). Whether a retained version can ever be removed from a Run (a wrong or sensitive document linked by mistake) is P4 — until answered, a Link on an ACTIVE Run can be removed (audited) and one on a finished Run cannot.
- **When linked records are archived, moved or deleted:** moving a Document keeps its Links; a Document in Trash shows as "in Trash" on the other end and returns with Restore; a deleted Procedure keeps its Links visible from the Document as "Procedure deleted"; an ended Schedule or closed Occurrence keeps its Links as history; a permanently deleted Document leaves the note described in 16.4, and Runs keep their retained version.
- **Not included:** automatic payments, payment status tracking, any automatic financial decision.

**Tasks:**
1. DONE — Domain and migration: link model (HT8) with Workspace-scoped integrity so a cross-Workspace Link cannot exist; Run-link version records (metadata snapshot + file references, immutable).
2. DONE — Use cases: add / remove Link, list both directions with per-end authorisation, "Remind me…" with both choices; reading a retained version through the Run; audit events.
3. DONE — Routes; route-security sweep.
4. DONE — Web: link picker (search within the Workspace), linked-records panels on Document, Procedure, Reminder / Occurrence and Run; retained-version view.
5. DONE — Docs and `security.md` check.

**Acceptance criteria:**
- From a water bill, "Remind me…" → *Reminder* creates "Pay water bill" only after the user has confirmed 30 June and the notification settings; the Reminder's Details show the bill, and the bill shows the Reminder with its status. "Remind me…" → *Procedure* schedules an existing Procedure the same way. Adding the receipt as page 4 or as a related Document both work.
- An inspection report (2 pages) is linked to a completed "Boiler service" Run. The report is then retitled, a page is replaced, it is moved to Trash and permanently deleted: at every stage the Run shows the original title and the original 2 pages, downloadable byte-identical, with a note that the source changed or was deleted. The Run's snapshot, Steps and prior audit events are unchanged by linking.
- A Link to a record of another Workspace cannot be created (404); a viewer without access to one end sees neither its title nor a count that reveals it.
- Deleting the Procedure, ending the Schedule or moving the Document leaves the other end consistent as described above.

**Checks:** cross-Workspace and missing-capability negatives on every link route; disclosure tests on both directions; Run immutability tests (snapshot and audit unchanged); retained-version tests (edit, Trash, purge, housekeeping never deletes a retained file, storage accounting); lifecycle matrix (move / Trash / restore / purge × each linked type); e2e.

**Security impact:** MEDIUM — a new way to reach records that must add no access (it adds none: every record is still read through its own routes), and data that deliberately outlives its source (the version a Run keeps survives permanent deletion of the Document). No new capability.
**Security docs updated:** YES (`security.md`: §3 Links line and §8 retained-version line checked off; "Security check: links and Document versions kept for Runs (Step 16.5)"; export and storage notes).

**Implemented:**
- **Link model (HT8, migration 0031):** one typed table `links` (`from_type`/`from_id` → `to_type`/`to_id`, who and when). A Document is one end; the other is a Procedure, a Schedule (a Reminder or a scheduled Procedure — shown on its Occurrences) or another Document ("related", stored once with the smaller id first). Triggers make sure both ends exist **in the Link's own Workspace** when it is added, that a Link's ends never change, and that a Document cannot be deleted for good while a Link still points to it as present. A purged Document leaves its end **marked as gone** (when, by whom — no title); a Link whose both ends are gone is removed.
- **Document versions kept for Runs:** `run_documents` (the Document's title, type, document date, year, notes and tags as they were, the source Document's id and revision, who linked it and when) and `run_document_files` (its files in page order, referenced — files are immutable). Triggers: never updated; removable only while the Run is ACTIVE; same Workspace as the Run and the files. **Nothing in the Run's own tables is written** — the link is an added `RUN_DOCUMENT_LINKED` event in the Run's history. The reference keeps the files from housekeeping (`unreferenced` in `document-file-repository.ts`, mirrored in `backup.ts`), and they count towards storage under a new line, *kept for executions*, once no Document holds them any more.
- **Use-cases (`packages/application/src/links`):** `listDocumentLinks`, `listLinkedDocuments`, `addDocumentLink`, `removeDocumentLink`, `listRunDocuments`, `linkRunDocument`, `unlinkRunDocument` — all behind the Documents tool switch; reading needs `document.view` plus the view capability of the other kind of record, changing needs `document.manage` plus read access to the other end, re-checked in the transaction. A Document in Trash is named only to those who can open Trash; everyone else learns that *a* Document in Trash is linked.
- **Routes:** `GET|POST …/documents/{id}/links`, `GET …/document-links?procedure=|schedule=`, `POST …/document-links/{id}/delete`, `GET|POST …/runs/{id}/documents`, `POST …/runs/{id}/documents/{id}/remove`. The files of a kept version are served by the existing document-file routes, by file id.
- **Export:** `metadata.json` and `index.html` now name each Document's relationships (Procedure, Reminder, scheduled Procedure, related Document, Run — kind, id, title), leaving out what is deleted, in Trash or gone.
- **Web:** on a Document, a **Linked** section (kind, title, state — "In Trash", "This procedure was deleted", "Ended", next due date, "Deleted for good … by …"), **Link to…** (Procedure, Reminder or scheduled Procedure, Document) and **Remind me…** — the person chooses a Reminder of its own or an existing Procedure, then reviews date and notifications in the usual schedule dialog; only the title is proposed, and nothing exists before that dialog is confirmed. A Procedure, and a Reminder's Details, show **Linked documents (n)** folded away, only where something is linked. An execution shows **Documents (n)** below its Steps: each kept version with its details, "Document version linked on … by …", its files, and a note when the Document has changed, is in Trash or was deleted for good; **Link a document…** for those who manage Documents. Where the Documents tool is off, none of this appears. About 60 catalog messages.

**Decisions made here (engineering; changeable):**
- **HT8 — one generic typed table with integrity triggers** (reasons in 16.12).
- **Run links are not rows of `links`** but their own immutable tables: they are a retained version, not a reference.
- A Run keeps **one** version per Document; the same Document cannot be linked twice to one Run.
- **Limits:** 50 Links per Document, 20 Documents per Run.
- "Remind me…" creates the Schedule and then the Link (two requests); if the second fails the Schedule exists unlinked and the dialog says so.
- A note about a Document deleted for good can be removed like any Link.
- With the Documents tool switched off, kept versions are hidden like everything else of the tool (and return when it is switched on again).

**Acceptance criteria — result:**
- "Remind me…" → Reminder creates "Pay water bill" only after date and notifications were confirmed; the Reminder's Details show the bill and the bill shows the Reminder with its state; → Procedure schedules an existing Procedure the same way; the receipt as a further page or as a related Document — **met** (use-case, HTTP and e2e tests; the Procedure variant by use-case test only).
- An inspection report linked to a completed Run, then retitled, a page replaced, moved to Trash and permanently deleted: the Run shows the original title and both pages byte-identical at every stage, with a note; the Run's row, Steps and earlier audit events are unchanged — **met**. For a permanently deleted source the note carries no date (the kept version is immutable and records nothing afterwards).
- A Link to a record of another Workspace cannot be created (404), also not by raw SQL; a viewer without access to one end sees neither its title nor a revealing count — **met**.
- Deleting the Procedure, ending the Schedule or moving the Document leaves the other end consistent — **met** (lifecycle test: move, end, delete, Trash, restore, purge).

**Tests/checks:** `pnpm lint`, `pnpm typecheck`, `pnpm test` — 129 files, 1056 tests, passing (new: `link-use-cases.test.ts` 8, `link.test.ts` over HTTP 2, one in `document-model.test.ts`; route-table and storage tests extended). `pnpm test:e2e` and the production image with `deploy/smoke-test.sh` passing. Screenshots of the Document's Linked section and of an execution with a kept Document were looked at. **Mutation checks**, each caught: a target of another Workspace accepted; a trashed Document's title shown to guests; the in-transaction guard removed; kept files not protected from housekeeping; the finished-Run check removed; Links not marked on purge; Run and linked-Document lookups without Workspace scope; kept versions not counted in storage (after strengthening the test); a gone Document still named.
**Not run:** a guest account in the browser; real phones; a screen reader; the Procedure variant of "Remind me…" in the browser.

**Remaining:**
- ~~**P4 (owner)**~~ — decided and implemented on 2026-10-02, see below.
- A permanently deleted source Document shows on the Run without the date of deletion.
- Linking to a Run is offered on the execution's page, not from the Document.
- 16.6 onwards: Contacts, Maintenance and Equipment add their record types to the link triggers.


#### P4 — removal from a finished Run (decided and implemented 2026-10-02)
**Decision (owner, 2026-10-02):** a **Workspace admin may remove a Document version retained by a finished Run, with an audit entry and a permanent removal note.** Requirements given with it: admin only, enforced on the server with Workspace isolation; explicit confirmation and a non-empty reason; the dialog explains that this removes the retained attachment from this Run; a permanent "Document removed" entry (who, when, why) that holds no sensitive document content; no more access to the retained files and details through that Run, downloads and exports included; the original Document, versions kept by other Runs, Run results and earlier history unchanged; storage reclaimed only when nothing else references the files; backups follow the existing retention; the rule for ACTIVE Runs stays.

**Implemented:**
- **Capability** `run.document.remove` — ADMIN only (matrix test). Checked by the use-case (`removeRunDocumentFromFinishedRun`, after the Documents tool switch) and again inside the removing transaction.
- **Route** `POST /api/workspaces/{id}/runs/{rid}/documents/{id}/remove-kept` with the strict body `{ reason, confirm: true }`: the confirmation must be the literal `true`; the reason is required, 1–500 characters, plain text without control or bidi characters. Refused with `409 run_still_active` while the Run is ACTIVE (the ordinary `…/remove`, for anyone who manages Documents, is unchanged), `404 link_not_found` for an unknown, already removed or foreign version.
- **Migration 0032** (0031 untouched): table `run_document_removals` — Workspace, Run, the removed version's id, reason, number of files, who had linked it and when, who removed it and when. **Nothing of the document:** no title, type, dates, notes, tags, source Document id or file reference. Triggers: a note can only be written for an existing version of a finished Run of the same Workspace; a note is never updated or deleted; and the two delete triggers of 0031 are replaced — a kept version (and its file references) can be deleted while the Run is ACTIVE, **or when its removal note exists**; otherwise never.
- **One transaction:** write the note → delete the version's file references and the version → for each of its files that **nothing else references** (no Document page, no other Run's version) delete the file's row and its preview rows → write the audit event `RUN_DOCUMENT_REMOVED` with the Run's id and `{ reason, files }` (no title, no Document id). Such a file can no longer be opened through any route from that moment and no longer counts towards storage; its bytes are deleted by the hourly housekeeping after the usual grace period (unless identical content is stored under another row). Files that a Document or another Run still holds are left exactly as they are, and stay counted.
- **What the Run shows afterwards:** the version is gone from `GET …/runs/{rid}/documents`; in its place the `removals` list carries the note — to everyone who can see the Run. The Run's history gains one entry, "removed a document that this finished execution kept — reason". Exports no longer name the Run among the Document's relationships; the Document's own Linked section no longer lists the Run.
- **Unchanged by a removal** (tested by comparing before and after): the Run's row, Sections, Steps and every earlier audit event; the source Document (title, pages, revision); versions other Runs keep, byte for byte.
- **Web:** on a finished execution, admins see **Remove from this execution…** on a kept document. The dialog says what is removed, what stays (the document itself, other executions' versions, results, earlier history, and the note), that the earlier history entry keeps the title, and that backup copies stay until backups are replaced; it requires a reason and a ticked "I understand that this cannot be undone" before the button is enabled. Afterwards a **Document removed** note (removed when and by whom, reason, how many files, when and by whom it had been linked) stays in the list. Linking to a finished execution now says that only an admin can remove it again.

**Tests/checks:** use-case test (admin removes; USER, guest, outsider and another Workspace's admin refused; no confirmation, empty, blank, over-long and bidi reasons refused; a version of another Run refused; ACTIVE Run refused and still removable the ordinary way; role lost between check and transaction; raw SQL delete without a note refused; note content, audit entry and API answer free of title, notes, tags, file names, Document id and file id; Run row, Steps, detail and earlier events equal before and after; the other Run's version byte-identical; the Document untouched; export relationships; storage equal while another Run still needs the files, reduced when the last reference goes; the unreferenced file 404 at once, its bytes gone after housekeeping, the Document's own page still served; notes cannot be updated or deleted). HTTP test (401 / 403 / 404 per role and Workspace, `Origin`, six malformed bodies, reason rules, the note in the listing, history order, Document and its file still served). Route-table sweeps include the new route. e2e: the dialog's wording, the disabled button until reason and confirmation, the note, no download links left; axe on both states. **Mutation checks**, each caught: both admin checks weakened; the in-transaction guard alone weakened; confirmation not required; reason not validated; no Workspace scope; files still needed elsewhere released; unneeded files not released; the title kept in the audit entry; an ACTIVE Run accepted. (Removing only the outer capability check is not caught by itself: the in-transaction guard still refuses.)
**Results:** `pnpm lint`, `pnpm typecheck`, `pnpm test` (129 files, 1057 tests) passed. `pnpm test:e2e` passed (desktop flow incl. the removal; the account flow is skipped on the mobile project as before). Production image built and `deploy/smoke-test.sh` passed (migrations 0031 and 0032 applied by `migrate` in the container). Screenshots of the dialog and of the note were looked at. **Not run:** a guest or non-admin account in the browser, real phones, a screen reader; the Trivy scan and arm64 smoke test (CI / release).

**Limitations (stated in the dialog or the user guide where they concern the person):**
- **The earlier history entry keeps the Document's title.** "linked the document “…” (this version is kept)" was written when the Document was linked, and audit history is never rewritten. The removal note and the removal entry carry no title, but a title that is itself sensitive stays readable in that earlier entry.
- **Backups:** files and the removed version's details remain in existing backups until they rotate (`BACKUP_KEEP`) and in off-host copies.
- A released file's bytes stay on the server's disk until housekeeping has run and the grace period has passed — unreachable through the application, readable by an operator with shell access.
- The reason is free text kept for good; nothing stops an admin from writing sensitive content into it (the field says not to).
- If the removed version's files are still pages of the Document, they remain available through the Document — by design: only the Run's copy of the details and its hold on the files are removed.
- Removal needs the Documents tool to be switched on.

### 16.6 Phase 2 — Contacts
**Status:** DONE (2026-10-02; committed as `aeb4ca9`, part of release 0.5.0-beta.2 — 12.21)
**Depends on:** 16.0; 16.4 for Trash; 16.5 for links (Contacts without links can ship before it). No open product decision.

**Requirements:**
- **Workspace Contacts** for plumbers, electricians, Comune offices, utility providers, insurers and other people or organisations; enabled per Workspace like every tool. A Contact is **not** a User and never grants access.
- **Fields:** name (the only required field — a person or an organisation), organisation, role / category, any number of email addresses and phone numbers (each with an optional label), optional postal address, website, notes. Creation is one field plus Save; everything else behind "More details".
- **Permissions (decided):** every member including GUEST views Contacts; USER, EDITOR, ADMIN create, edit, delete and import; GUEST cannot change them. Contact export: USER and above (the GUEST bulk-export decision covers Documents).
- **Search and filter** by name, organisation, category, phone and email; same pagination pattern as 16.3.
- **Actions:** email (`mailto:`) and telephone (`tel:`) links built only from validated values; website links restricted to `http` / `https`, opened with `noopener noreferrer`. With Mail (16.10) enabled and permitted, "Write" may open the composer instead.
- **Links** to Documents, Procedures, and later MaintenanceRecords and Equipment (16.5 model).
- **Possible duplicates** are pointed out (same normalised email or phone, or very similar name) when creating, importing and on the Contact — **never merged automatically** (decided). A manual merge is not planned.
- **Import / export (decided): CSV and vCard (`.vcf`)**, both directions. An import is strict, size- and count-limited and **shows a preview and the possible duplicates before anything is saved**; the user chooses per duplicate to import anyway or leave it out — nothing is merged or silently discarded. CSV export neutralises spreadsheet formulas; vCard values are escaped; vCard photos and other embedded binaries are ignored on import.
- **Deletion:** to Trash, Restore, permanent deletion by a Workspace admin (16.4); a Contact in Trash or permanently deleted shows as "deleted contact" on linked records.
- **Privacy:** Contacts are personal data of third parties, visible to all members by decision; included in exports and in permanent deletion.

**Tasks:**
1. DONE — Domain, migration, capabilities, use cases, audit events.
2. DONE — Routes; search / filter read model.
3. DONE — Web: Contacts in the sidebar and under More, list, quick create, detail with actions and linked records, duplicate hints.
4. DONE — CSV and vCard import (preview, duplicates) and export; parser review.
5. DONE — Docs and `security.md` check. (Demo data: `test-env/seed.ts` switches the tool on for the Household and creates examples — added on 2026-10-02 with release 0.5.0-beta.2, after an earlier note here wrongly said the repository had no demo data.)

**Acceptance criteria:** a plumber is created with only a name and later gets two phone numbers; tapping a number on a phone opens the dialler; a contact with an existing email address shows "Possibly the same as …" and both remain; a `.vcf` and a CSV with 200 contacts each show a preview with 3 possible duplicates before saving and store exactly what the user confirmed; exported CSV and vCard re-import to the same data; a `javascript:` website or a formula-like name does no harm in the UI or the exports; a GUEST sees Contacts and every write route refuses them; other-Workspace ids resolve to nothing.

**Checks:** validation (email, phone, URL schemes, control characters); duplicate detection cases; CSV and vCard import fuzz and limits (encodings, folded lines, huge fields, embedded binaries); export injection; permission and isolation negatives; e2e and axe.

**Security impact (expected):** MEDIUM (third-party personal data; two import parsers).

**Implemented (2026-10-02):**
- **Tool and capabilities.** `CONTACTS` is the second optional tool (Workspace settings → Tools; off by default; switching it off hides everything and deletes nothing; every route then answers `404 tool_not_enabled` for every role). Four capabilities in the central table: `contact.view` (every role, guests included), `contact.manage` (USER, EDITOR, ADMIN: create, edit, delete to Trash, restore, link, import), `contact.export` (USER, EDITOR, ADMIN — not a GUEST), `contact.purge` (ADMIN only). Every write re-checks the actor's current role and the tool switch inside its `IMMEDIATE` transaction.
- **Domain** (`packages/domain/src/contact.ts`): only the name is required (1–200). Organisation (≤200), role / category (≤60, free text), up to 10 email addresses and 10 phone numbers each with an optional label (≤40), postal address as free text (≤500), website (≤500), notes (≤4000). No control or bidi characters anywhere. An email address follows the account rule; a phone number is digits with spaces and `+ ( ) - . /`, 3–20 digits, kept as written; a website must be an absolute `http` / `https` address without user name or password ("example.org" is taken as `https://example.org`) — `javascript:`, `data:`, `file:` and every other scheme are refused. The same address or number twice on one Contact is one entry.
- **Migration 0033** (`contacts`, `contact_keys`): CHECKs for the bounds and for "website is http(s) or empty"; triggers — identity (Workspace, creator, creation time) immutable; a Contact can be deleted only from Trash; a Contact cannot be deleted while a Link still points to it unmarked; the Link trigger of 0031 is replaced (as it announced) to also allow Document → Contact and Contact → Procedure, both ends still in the Link's own Workspace. `workspace_tools` is rebuilt for the new tool name (data copied). 0031 and 0032 are untouched.
- **Finding:** by name, organisation, category, email address and phone number (also by its digits alone: "0471123456" finds "+39 0471 12-34-56") — folded text and `LIKE … ESCAPE` as in 16.3, every word must match; filter by category; fifty per page by name with a keyset cursor. Notes and the postal address are not searched. Never anything in Trash or of another Workspace.
- **Actions:** `tel:` and `mailto:` links are built **by the server** from checked values (`tel:` from the digits and `+` only; `mailto:` percent-encoded so nothing can add headers) and sent as `href`; the web client uses a link only if it has the expected scheme (`safeHref`), otherwise the value is plain text. A website opens in a new tab with `rel="noopener noreferrer"`.
- **Possible duplicates** — the same email address, the same phone number (without formatting; `00…` equals `+…`), or the same name (without case, accents or punctuation, words in any order: "Rossi, Mario" = "MARIO ROSSI") — are pointed out while typing, after saving, on the Contact and in an import. **Nothing is merged and nothing is refused**; both Contacts stay. Compared only within the Workspace and never with Trash.
- **Import** (CSV and vCard, `packages/import-export`): two requests. `POST …/contacts/import/preview` takes the file as the raw body, reads it **only after the actor is authorised**, and answers every entry as it would be saved, with its possible duplicates (existing Contacts and earlier entries of the same file), the entries that cannot be imported with the reason, and the columns / properties that were not used — **and saves nothing**. `POST …/contacts/import` then saves exactly the entries the person confirmed, each checked again by the same rules, all or nothing, one audit event. Limits: 1 MiB, 1000 contacts per import, 10 000 characters per value, 300 columns. Decoding: UTF-8 (with or without BOM), UTF-16 with BOM, otherwise Windows-1252; NUL bytes → "not a text file". CSV: comma, semicolon or tab; quoted fields with doubled quotes and line breaks; an unclosed quote or text after a closing quote refuses the file; the header row is required — this app's own columns and the usual names of address-book exports are recognised. vCard 2.1 / 3.0 / 4.0: folded lines, escapes, quoted-printable, grouped labels, bare types; every card must open and close; **photos, logos, sounds, keys and any base64 value are skipped without being decoded**. In the preview a possible duplicate starts unticked ("left out unless you tick it").
- **Export** (`GET …/contacts/export?format=csv|vcard`, `contact.export`): every Contact not in Trash as one download (`Content-Disposition: attachment`), rate-limited, audited with format and number. CSV: a value that starts with `=`, `+`, `-`, `@`, tab, carriage return or `'` gets a leading apostrophe (and loses exactly that on import), quotes doubled. vCard 3.0: `\`, `,`, `;` and line breaks escaped, lines folded at 75 bytes. Both re-import to the same data (tested field by field).
- **Trash and permanent deletion:** deleting moves a Contact to Trash (Undo right afterwards); restore from Trash; a Workspace admin deletes for good — one or all of Trash — after a confirmation that says what stays behind. Nothing leaves Trash by itself.
- **Links:** Contact ↔ Procedure (new) and Document ↔ Contact (the existing Document links, with `contact` as a further kind of record). Shown on the Contact, on the Procedure ("Contacts (n)" with the number to call) and in the Document's Linked section. A Link is a reference: nothing is copied, nobody gains access. **A Contact in Trash or deleted for good shows as "a deleted contact" — never by name.** With Contacts switched off, Documents show no Contact links; with Documents switched off, Contacts work without them.
- **Audit:** `CONTACT_CREATED / _UPDATED / _DELETED / _RESTORED / _PURGED`, `CONTACTS_IMPORTED / _EXPORTED`, `CONTACT_LINK_ADDED / _REMOVED`. **They carry the Contact's id and counts — never a name, an address or a number** (also `DOCUMENT_LINK_ADDED / _REMOVED` leave a linked Contact's name out): history is never rewritten, and a Contact can be deleted for good. After a permanent deletion a test searches every table of the database for the name, organisation, address, email, phone and notes and finds nothing.
- **Web:** Contacts in the sidebar below Documents and under More on phones; list with one-field quick create ("More details…" opens the full form), search, category filter, the first phone number as a call link on each card; Contact page with call / write / website links, address, notes, the duplicate hint and linked records; edit dialog with any number of phone and email rows; import page; Trash; ⋯ menu with import, the two exports and Trash. Guests see everything and get no changing control.

**Choices made while implementing (each the cautious reading of the requirement; say so if you want one changed):**
- History entries about Contacts hold no name (see Audit). The requirement says Contacts are "included in permanent deletion"; a name in an entry that can never be rewritten would defeat that.
- A Contact in Trash is not named on linked records either (the requirement says "shows as deleted contact").
- "Very similar name" means the same words regardless of order, case, accents and punctuation — not misspellings.
- ~~A national and an international spelling of one phone number are not recognised as the same.~~ **Changed by the owner on 2026-10-02 ("Match them"):** two numbers are also pointed out as possibly the same when they share their **last eight digits** ("0471 123456" / "+39 0471 123456"; "030 1234567" / "+49 30 1234567"). Numbers with fewer than eight digits are compared as a whole only. Two different lines can share eight digits — it is a hint, nothing is merged. `migrate` rewrites the comparison keys of existing Contacts (`fillContactKeys`); no schema change.
- A vCard with several postal addresses or web addresses: the first is imported and the preview says that further ones were not used (a Contact has one of each).
- An import entry that breaks a rule (for example a phone number with "ext. 4") is listed as "cannot be imported" with the reason; it is not imported in part.
- Notes and the postal address are not searched.

**Tests/checks:** `packages/domain/src/contact.test.ts` (rules, phone and website cases, keys, search text, cursor); `packages/import-export/src/contacts.test.ts` (decoding; CSV rows, refusals, address-book columns, formula neutralisation; vCard 2.1 / 3.0 / 4.0, embedded binaries, malformed cards, escaping and folding; export → import round trip in both formats; 3000 rounds of generated input and 500 of random bytes — each ends in drafts or a coded refusal); `packages/database/src/contact-use-cases.test.ts` (the acceptance cases; search and paging; duplicates; every read and write for GUEST, non-member and the other Workspace; a role lost and the tool switched off between check and write; Trash, restore, permanent deletion and "nothing of the person left in any table"; a 202-entry CSV and vCard preview with 3 possible duplicates, saving exactly the confirmed 198, all-or-nothing, the Workspace limit; "never parses for someone who may not import"; export and re-import; links both ways, database refusal of cross-Workspace links, deleted Contact unnamed); `apps/server/src/http/contact.test.ts` (tool off → 404; status codes per role, session, `Origin`; malformed bodies; import preview refusals incl. 413; export headers and content; Trash and purge; nothing of a Contact in the server log); route-table sweeps extended (session, non-member, child ids under another Workspace, malformed ids); capability matrix; `apps/web/src/contact-model.test.ts`; e2e (the whole flow incl. the `tel:` link, a refused `javascript:` website, duplicate hint, import preview, CSV download, Trash, permanent deletion, tool off; axe on eight states in light, dark and at 320 px; no sideways scrolling at 320 px). **Mutation checks:** 46 single mutations of permission checks, Workspace scoping, Trash rules, audit content, link rules, validation, both parsers, both writers and the link building — 43 caught directly; the other three (the outer permission check of export and of permanent deletion, and the Workspace filter of the first duplicate query) are each backed by a second check that still refuses, and breaking both layers at once is caught. One gap found and closed this way: no test demoted an admin between the check and a permanent deletion — added.
**Results:** `pnpm lint`, `pnpm typecheck` and `pnpm test` (134 files, 1095 tests) passed. `pnpm build` and `pnpm test:e2e` passed (desktop flow incl. Contacts; the account flow is skipped on the mobile project as before). Production image built and `deploy/smoke-test.sh` passed (migration 0033 applied by `migrate` in the container). Screenshots of the Contact page, the form, the import preview and the list at 320 px and in dark mode were looked at; two layout faults found that way were fixed (the import summary ran its sentences together; a list that is itself a card had no padding — also on the Document page's Linked section). **Not run:** real phones, a guest or non-admin account by hand, a screen reader; the Trivy scan and arm64 smoke test (CI / release).

**Limitations and remaining work:**
- **Not tried on a real phone:** that tapping a number opens the dialler is verified as "the link is `tel:` + digits", not on a device. Guest and non-admin accounts, and a screen reader, were not tried by hand in the browser either.
- English only, like the rest of the app. CSV column names of German and Italian address books are recognised only for the most common ones; unknown columns are named in the preview.
- No manual merge of duplicates (not planned), no bulk delete, no selection for export (always all Contacts), no import of groups, birthdays, photos or structured addresses.
- The reason an import entry cannot be imported names the first broken rule only.
- With "Write" there is only `mailto:` — the Mail composer arrives with 16.10. Links to MaintenanceRecords and Equipment arrive with 16.7 / 16.8.
- The Documents ZIP export (16.4) does not list linked Contacts among a Document's relationships.
- Backups keep deleted Contacts until they rotate (stated in the dialog and in `deployment.md`).
- A Contact that is linked to a Procedure and then deleted for good leaves a line "a deleted contact" on that Procedure until someone who manages Contacts removes it.

**Security impact:** MEDIUM — a new permission boundary (four capabilities, one tool switch), third-party personal data visible to every member, two parsers of hostile input, two export formats, and links that become `tel:` / `mailto:` / web addresses. See `security.md` "Security check: Contacts (Step 16.6)".

### 16.7 Phase 3 — Maintenance
**Status:** DONE (2026-10-02; committed as `aeb4ca9`, part of release 0.5.0-beta.2 — 12.21)
**Depends on:** 16.4 (Trash), 16.5 (links), 16.6 (responsible Contact); 14.1 (Schedules); product point P3 (what GUEST sees) before release.

**Requirements:**
- **MaintenanceRecord:** title, category, date, status, description, optional responsible Contact, optional cost with currency. Cost is a recorded fact (validated decimal string + ISO 4217 code, no arithmetic across currencies); **no totals, budgets, charts or payment handling**. *(Engineering default:* categories are Workspace-managed like DocumentTypes.*)*
- **Statuses (decided): Planned, In progress, Completed, Cancelled** — shown as word + glyph, never colour alone. Planned work is unmistakably distinct from completed work; a planned record may have a target date, a completed one carries its completion date.
- **Views (decided): a Kanban Board and a List.**
  - *Board:* one column per status; **dragging a card to another column changes its status**. The same change is available through an **accessible status control** on every card and on the record (a labelled menu / select, keyboard- and touch-operable, announced to assistive technology) — drag is never the only way. On narrow screens the board shows one status at a time with a labelled switcher (or the List); the page never scrolls sideways. Columns are the four statuses only: no custom columns, swimlanes, limits or assignee boards.
  - *List:* chronological history with filters (category, status, Equipment, Contact, year) and the 16.3 pagination.
  - Status changes are audited, refused when stale (revision), and appear for other members by the existing polling pattern. Every transition between the four statuses is allowed (reopening a Completed or Cancelled record is a normal, audited change).
- **Completion is manual (decided).** A record becomes Completed only when a user sets it. **Runs may be linked as references; completing (or aborting) a Run never changes a MaintenanceRecord**, and completing a record never touches a Run, an Occurrence or a Reminder. No data is copied out of a Run snapshot.
- **Evidence:** invoices, photos and inspection reports are **Documents linked** to the record (16.5) — no second upload path. Completing offers "Add or link evidence" and never requires it.
- **Links** to Equipment (16.8), Procedures, Runs, Contacts and Documents.
- **Recurring maintenance** uses the existing Schedules: "Remind me…" on a record creates an ordinary Reminder or a Schedule of a linked Procedure (the 16.5 choice). **No separate reminder engine**, no second kind of due date that notifies. Today shows such work only through its Occurrences.
- Trash, Restore, permanent deletion as 16.4; audit as elsewhere.

**Tasks:**
1. DONE — Domain (statuses, transitions, cost), migration, capabilities, use cases, audit events.
2. DONE — Routes and read models (board, list).
3. DONE — Web: Maintenance in the sidebar and under More, Board with drag and the status control, List with filters, record view with evidence and links, create / complete flows.
4. DONE — Docs and `security.md` check. (Demo data: `test-env/seed.ts` switches the tool on for the Household and creates examples — added on 2026-10-02 with release 0.5.0-beta.2, after an earlier note here wrongly said the repository had no demo data.)

**Acceptance criteria:** "Boiler service" is created as Planned and appears in the Planned column and in the List; dragging it to In progress changes its status for everyone; the same change works with the keyboard through the status control and on a 320 px phone without drag or sideways scrolling; a Reminder created from it appears on Today when due; a "Boiler service" Run linked to it is completed — the record **stays In progress** until a user sets Completed, then shows its completion date, the technician as Contact, the linked invoice and 120.00 EUR; a Cancelled record is visibly not Completed; filters by Equipment and year return exactly the matching records; no screen shows a sum of costs; two members changing the same card at once — one succeeds, the other sees the current state.

**Checks:** state and validation tests; "Run completion changes no MaintenanceRecord" and "record completion changes no Run / Occurrence" tests; link and permission negatives; "one reminder engine" test (no notification originates outside Schedules); board keyboard and screen-reader checks, drag e2e, 320 px; axe.

**Security impact (expected):** MEDIUM.

**Decided for this step (owner, 2026-10-02):** **P3 for Maintenance — a GUEST sees every MaintenanceRecord, costs included, read-only.** (Equipment and serial numbers are asked again with 16.8.) The remaining requirements were confirmed with the task: optional tool; the four statuses; Board and List; drag plus an accessible alternative; completion only by hand; existing links reused, granting nothing.

**Implemented (2026-10-02):**
- **Tool and capabilities.** `MAINTENANCE` is the third optional tool (off by default; switched off it is hidden for everyone, every route answers `404 tool_not_enabled` for every role, and nothing is deleted). Capabilities of its own in the central table — nothing is inferred from Documents or Contacts: `maintenance.view` (every role incl. GUEST — P3), `maintenance.manage` (USER, EDITOR, ADMIN: create, edit, change status, link, delete to Trash, restore), `maintenance.purge` (ADMIN). Every write re-checks the actor's current role and the tool switch inside its `IMMEDIATE` transaction.
- **MaintenanceRecord** (`packages/domain/src/maintenance.ts`): title (1–200, the only required field), category (≤60, free text), date ("planned for", optional), description (≤4000), responsible Contact (optional), cost (optional). **Cost** is decimal text — up to 12 digits and up to 3 decimals, a comma accepted and written as a point, no sign, no exponent, no thousands separators — with an ISO 4217 code from a fixed list. It is stored and shown exactly as written; **nothing is ever calculated from it**: no route, answer or screen holds a sum, total, average or conversion (tested).
- **Statuses:** `PLANNED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED` — and no others (CHECK constraint). A new record is Planned. **The status changes only through `POST …/maintenance/{id}/status`**, asked for by a person with `maintenance.manage`: every change between the four is allowed (reopening included), each is audited (`MAINTENANCE_STATUS_CHANGED` with from, to and the completion date), a request with a stale revision is refused (`409 maintenance_conflict`), so is "the status it already has". **Completed carries a completion date** — the person's "today" unless they give the day — **and nothing else does** (CHECK constraint: a completion date exactly while the status is Completed), so Cancelled can never look Completed. Editing a record cannot change its status (the edit route refuses the field).
- **Completion is manual.** No code path outside that route writes `maintenance_records`: the Run, Occurrence and Schedule repositories do not reference the table, and the Maintenance repository writes only `maintenance_records`, `links` and `audit_events`. A linked Run that is completed or aborted leaves the record byte for byte as it was; creating, changing, completing, deleting, restoring and purging a record leaves every other table untouched (both tested by comparing rows before and after).
- **Migration 0034** (`maintenance_records`; 0031–0033 untouched): CHECKs for the bounds, the four statuses, "completion date ⇔ Completed", the cost shape and "amount and currency together"; triggers — identity immutable; deleted only from Trash; not deleted while a Link still points to it unmarked; the responsible Contact, when set or changed, must be a Contact of the same Workspace that is not in Trash; the Link trigger is replaced once more to allow MaintenanceRecord → Document / Procedure / Run / Schedule within one Workspace. `workspace_tools` is rebuilt for the new tool name (data copied).
- **Board** (`GET …/maintenance/board`): the four statuses, each with its total and up to fifty cards (what is still to do soonest first, what is over latest first). **List** (`GET …/maintenance`): newest first by the day a record is filed under (completion day, else its date, else the day it was created), search over title, category and description, filters by status, category, responsible Contact and year, fifty per page with a keyset cursor.
- **Links** (the `links` table of 16.5, one more kind of record): a record → Documents (evidence: invoices, photos, reports — no second upload path), Procedures, Runs and Schedules. Adding one needs `maintenance.manage` **and** the right to read the other end (for a Document also the Documents tool); listing shows only ends the viewer may read; each tool removes only its own Links. A Document shows the record it is evidence for in its Linked section (unnamed while the record is in Trash; "deleted for good" afterwards). **The responsible Contact** is a field of the record, shown as a link to the Contact; a Contact in Trash or deleted for good is "a deleted contact" and the record stays. With Contacts switched off nothing of Contacts appears with Maintenance and who is responsible is kept, not lost; with Documents switched off evidence links are neither listed nor addable.
- **Recurring work:** "Remind me…" on a record opens the existing dialog (a Reminder, or a schedule of a Procedure), creates an ordinary Schedule and links it. There is no second reminder engine: the record's own date notifies nobody, and Today shows such work only through its Occurrences.
- **Trash, restore, permanent deletion** as elsewhere: delete moves to Trash (Undo), restore brings status, completion date and links back, a Workspace admin deletes for good from Trash after a confirmation; nothing leaves Trash by itself.
- **Audit:** `MAINTENANCE_CREATED / _UPDATED / _STATUS_CHANGED / _DELETED / _RESTORED / _PURGED`, `MAINTENANCE_LINK_ADDED / _REMOVED` — titles, statuses and ids; never the description, the cost or a Contact's name.
- **Web** (`Maintenance.tsx`, `maintenance-model.ts`): Maintenance in the sidebar below Contacts and under More on phones. One-field create ("Add as planned") with "More details…". **Board:** four columns; a card is its title (opens the record), one line of context, and a **status control** — a labelled select ("Status of “Boiler service”") on every card, in every List row and on the record, operable by keyboard, touch and screen reader; **dragging a card to another column** does the same for pointer users. Every change is announced in a polite live region. Below 60 rem the board shows **one status at a time**, chosen with a labelled switcher that shows each status with its count; nothing scrolls sideways at 320 px. The board refreshes every 15 seconds while visible (not during a drag). A refused stale change says "Someone else changed this record meanwhile…" and shows the current state. Statuses are always a word with a glyph (○ ▶ ✔ ✕); Cancelled is also struck through. Completing announces "… is now Completed" with **Add or link evidence** — offered, never required. Record page with status, dates ("Completed on …", "Planned for …", "Was planned for …" — always saying which), category, Contact, cost as written, description and the Linked section. Guests see everything and get no control that changes anything.

**Choices made while implementing (say so if you want one changed):**
- **Categories are free text with the Workspace's existing categories offered as suggestions** (as for Contacts), not a managed list like DocumentTypes — the plan called managed categories an engineering default; this is the simpler form and adds no admin screen.
- **Filter by Equipment** is not there: Equipment arrives with 16.8 and brings the filter with it.
- **Links to Contacts** are the responsible-Contact field only; further Contacts cannot be linked to a record.
- A record in Trash is not named on a Document it was evidence for.
- The completion date defaults to the person's local "today" (sent by the browser); another day can be given through the API but the screens do not ask for it — reopen and edit is not needed for the common case, and a date field on completion can follow if wanted.
- The board shows at most fifty cards per column and says how many more are in the List.

**Tests/checks:** `packages/domain/src/maintenance.test.ts` (the four statuses; all 16 transitions; completion date rules; content and cost validation; filing day; query, cursor, link targets); `packages/database/src/maintenance-use-cases.test.ts` (Planned → board and List; status changes by hand; two people at once — one succeeds, one is refused and nothing is overwritten; a stale edit; database CHECKs; **a linked Run completed or aborted leaves the record unchanged**; **record changes leave every other table unchanged** — the "one reminder engine" test; Contact and cost; filters by status, category, Contact and year returning exactly the matches; no sum anywhere; deleted Contact unnamed; Contacts and Documents switched off; paging and column bounds; every read and write for GUEST, non-member and the other Workspace; role lost and tool switched off between check and write; Trash, restore, permanent deletion, "nothing leaves Trash by itself"; links to Documents, Procedures, Runs and Schedules, database refusal across Workspaces, each tool removing only its own Links); `apps/server/src/http/maintenance.test.ts` (tool off → 404 whatever other tools are on; status codes per role, session and `Origin`; malformed and over-specified bodies; stale change `409`; a Run completed over HTTP leaves the record equal; link refusals; Trash and purge; no route name suggests a sum); route-table sweeps and capability matrix extended; `apps/web/src/maintenance-model.test.ts`; e2e — the acceptance flow: Planned on the board, **drag to In progress**, the status control **with the keyboard**, the board **at 320 px** with the switcher and without sideways scrolling, a Contact, a refused non-numeric amount, a linked execution that does not complete the record, linked evidence, a Reminder that appears on Today, Completed by hand with completion date, Contact, invoice and "120.00 EUR", a Cancelled record, List filters, no "total" on the page, Trash with Undo and permanent deletion, tool off; axe on the board (light, dark, 320 px), the dialog, the record and the List. **Mutation checks:** 42 single or paired mutations of permission checks, Workspace and Trash scoping, staleness, tool switches, Contact rules, audit content, link rules, the status and cost rules and the phone-number rule — 39 caught at first; two gaps closed with new tests (a stale edit; Maintenance removing another tool's Link); the remaining one (the repository's own Documents-tool check when linking evidence) is backed by the use-case check, which is caught.
**Results:** `pnpm lint`, `pnpm typecheck` and `pnpm test` (138 files, 1120 tests) passed. `pnpm build` and `pnpm test:e2e` passed (desktop flow incl. Maintenance; the account flow is skipped on the mobile project as before). Production image built and `deploy/smoke-test.sh` passed (migration 0034 applied by `migrate` in the container). Screenshots of the board (light at 1280 px, dark, and at 320 px) and of the record page were looked at; two things were changed after looking: the "in progress" glyph (the first choice did not render in the page font) and the phone switcher (four stacked buttons became a two-by-two grid). **Not run:** real phones, a guest or non-admin account by hand, a screen reader; the Trivy scan and arm64 smoke test (CI / release).

**Limitations and remaining work:**
- **Not tried by hand:** real phones (touch drag is deliberately not relied on — the status control is the touch way), a guest or non-admin account in the browser, a screen reader. The keyboard path is tested through the browser's native select.
- Dragging needs a pointer and a wide screen; on narrow screens only the status control exists (by design).
- Other members' changes appear on the board within 15 seconds, on the List and the record on reload.
- No Equipment link or filter yet (16.8); no reverse listing of linked records on a Procedure, an execution or a Contact page (a Document does show it).
- The Documents ZIP export (16.4) does not list linked MaintenanceRecords.
- English only. Costs are not formatted by locale — shown exactly as recorded, by decision.
- Backups keep deleted records until they rotate.

**Security impact:** MEDIUM — a new permission boundary (three capabilities, one tool switch) that guests can read including costs, a state machine whose changes must be attributable and never automatic, and one more kind of record in the shared link table. See `security.md` "Security check: Maintenance (Step 16.7)".

### 16.8 Phase 3 — Equipment
**Status:** DONE (2026-10-04)
**Depends on:** 16.4, 16.5, 16.6; 16.7 may follow or precede (each links to the other when both exist); 14.1; product point P3 before release.

**Requirements:**
- **Equipment:** name (required), category, location, manufacturer, model, optional serial number, purchase date, optional warranty expiry, notes. Examples: boiler, fridge / freezer, washing machine, chimney, router, water meter. *(Engineering default:* location is free text with suggestions from values already used; categories Workspace-managed.*)*
- **Linked Documents:** manuals, warranties, receipts, photos (16.5); **linked** service Contacts, MaintenanceRecords and Procedures.
- **Reminders** for warranty expiry and servicing through the existing reminder system: offered explicitly ("Remind me before the warranty ends") with dates and notification settings reviewed by the user; changing the warranty date later **offers** to update the Reminder, never changes it silently.
- **Search and filter** by name, category, location, manufacturer; 16.3 pagination.
- Serial numbers never appear in notification texts. Trash, Restore, permanent deletion as 16.4; audit.

**Tasks:**
1. DONE — Domain, migration 0037, capabilities, use cases, audit events.
2. DONE — Routes and read model, including both-direction Maintenance links and Equipment filtering.
3. DONE — Web: Equipment in the sidebar and under More, list, detail with documents, contacts, dated maintenance history and explicitly reviewed reminders.
4. DONE — User/admin/architecture documentation, fictional demo data and `security.md` check.

**Acceptance criteria:** a boiler is created with only its name, later gets model, serial number and a warranty expiry; its manual and receipt are linked Documents (not re-uploaded); "Remind me 1 month before the warranty ends" creates a normal Reminder visible in Reminders and the Calendar after the user confirmed it; its detail page lists two MaintenanceRecords chronologically; deleting the service Contact leaves "deleted contact" on the boiler; all isolation and permission negatives hold.

**Checks:** validation; link lifecycle; reminder creation only via Schedules; permission and isolation negatives; e2e; axe.

**Implemented:** Equipment is the eighth selectable Workspace tool, off by default, with metadata CRUD, name paging, literal search, category/location/manufacturer filters and suggestions, Trash/Restore/admin permanent deletion and atomic audit. Existing manuals/receipts, Contacts, Procedures, MaintenanceRecords and Schedules are referenced, never copied. Maintenance supports Equipment links and filtering; either detail page displays both link directions and maintenance dates/statuses. Warranty and servicing proposals use ordinary Schedule dialogs; a changed warranty offers review and never updates an existing Schedule silently. All roles may read serial numbers; only USER and above manage. Serial numbers/notes stay out of search, audit and generated reminder text. Categories use free text with Workspace suggestions, as for Maintenance, rather than a separate managed category table (engineering choice).

**Contacts follow-up:** existing vCard 3.0 export now supplies standard closed-map telephone/email TYPE labels as well as custom labels, retaining escaping, UTF-8 folding and CRLF. The Contacts overview offers “Export for iPhone / Android…” with .vcf download and import instructions. No sync, cloud credentials or external processing was added.

**Checks:** 146 Vitest files / 1154 tests passed (27.30 s); Playwright 3 passed / 1 intentionally skipped (1.9 min), including Equipment lifecycle, linked actual Documents/Maintenance, warranty proposal/update cancellation, phone-width navigation, Light/Dark layout and axe checks. Typecheck, lint, web build, schema generation (53 tables; no drift) and whitespace checks passed. Security negatives cover every disabled Equipment route for all roles, guest writes, foreign Workspace ids/links/filters, stale revisions, audit rollback, transactional role/tool rechecks, raw DB integrity, deleted Contact privacy and linked-content preservation. The final review additionally refuses Equipment/Maintenance unlink requests while the other endpoint’s tool is disabled. A dedicated populated beta.3 → 0037 migration check preserves every flag, a nonzero tool revision and audit history, leaves Equipment off, and passes integrity/FK checks; the existing populated beta.2 backup/restore test also passes through all current migrations.

**Remaining / limitations:** physical iPhone/Android .vcf import and a real screen reader remain manual checks; automated .vcf round-trip and responsive browser checks are not device validation. No live Unraid upgrade/deployment was performed. Existing Documents ZIP omissions for Contacts/Maintenance also cover Equipment relationships. Reverse Maintenance listing on Procedure/Run/Contact pages remains deferred. Reminder creation and Equipment linking are separate explicit requests; a failed link leaves the independently created Reminder in Reminders.

**Security impact:** MEDIUM — new routes, metadata and cross-tool permission boundaries, protected by existing authenticated/CSRF/capability/Workspace/tool controls; no new credentials, file store or outbound connection. Controls and checks are recorded in `security.md`.

### 16.9 Phase 4 — Text recognition, rule-based suggestions, later optional local AI (later)
**Status:** TODO (later phase)
**Depends on:** 16.1–16.4 (Documents work completely without it); 16.5 for reminder suggestions; technical choices HT9, HT10 (and HT14 for the AI part); product point P5.

**Requirements:**
- **Own infrastructure only (decided):** text recognition runs on VMN's own infrastructure. No document, page or extracted text leaves the server. External processing is neither a default nor an approved option; there is no setting for it.
- **Extraction (decided):** embedded PDF text where present; OCR for scans and photos where it is not; at least **English, German and Italian**. The engine and where it runs (in-process, a worker process or an optional container of the same deployment; language data shipped in the image) are HT9.
- **Derived, not original:** extracted text is a derived representation of a file; the upload is never altered. It is hidden from search as soon as its Document is in Trash, deleted with it on permanent deletion (except where a Run retains the version, 16.5), regenerable, counted in the combined quota and covered by backup.
- **Processing states** per file: not processed / queued / processing / done / failed / not applicable, visible on the Document; **Retry** for failed jobs. Whether recognition starts automatically on upload or on request, and whether it can be turned off per Workspace or Document, is P5.
- **Background processing and limits:** a persistent job table with atomic claiming, leases and bounded attempts (the 13.5 / 14.1 delivery pattern — no external queue); limits on pages, pixels, time and memory per job, concurrency (one or two jobs) and a per-Workspace backlog; hostile files must not exhaust the server; jobs survive restarts and never run twice concurrently.
- **Search:** recognised text becomes searchable alongside titles, notes and tags (extends 16.3; mechanism HT7), with result snippets. **Permissions are those of the source Document** for the text, the snippets and the mere existence of a hit.
- **Rule-based suggestions first (decided):** title, document date, type, amount, supplier, payment due date where feasible, derived by deterministic rules and patterns, shown with their source ("from the text on page 1"), each accepted or dismissed individually. **User confirmation is required** before a suggestion creates a Reminder or changes important metadata: no field is overwritten, no Contact and no Reminder is created by a suggestion alone; a suggested due date leads into the schedule dialog where dates and notifications are reviewed. Extracted values and confirmed values are stored and displayed distinctly ("Suggested" vs the confirmed field); corrections are kept and never overwritten by reprocessing.
- **Optional AI-assisted suggestions, later (decided as a plan, not built with OCR):** an optional addition after OCR and rule-based suggestions work. **Disabled by default**; enabled deliberately (by whom: fixed when planned, at least the instance admin, since it consumes server resources); runs **on VMN's own infrastructure** — no external model service; same confirmation rule, same permissions, same "suggested vs confirmed" display; clearly marked as AI-generated. Feasibility of a local model on the target hardware (e.g. the Unraid host), model licence and resource limits are HT14. Document and mail text given to a model is untrusted data and can never trigger an action. This part needs its own detailed plan and `AGENTS.md` scope entry before any implementation.
- **Untrusted input:** recognised text is data — escaped on output, never interpreted as markup, commands or instructions by any later processing.
- **Basic Documents work without OCR or AI** — both can be absent, disabled or failing with no effect on Phases 1–3.

**Tasks:**
1. TODO — Settle HT9 / HT10 and P5; dependency, licence and image-size review; SBOM.
2. TODO — Job table, worker, limits, states, retry; housekeeping of derived text.
3. TODO — Extraction (embedded text, OCR) for the three languages; fixtures per language.
4. TODO — Search extension with snippets and authorisation.
5. TODO — Rule-based suggestions with confirmation UI, provenance and the extracted / confirmed distinction.
6. TODO — Settings; privacy documentation (what is processed, where, what is stored); `security.md` check.
7. TODO (later, separate plan) — Optional local AI-assisted suggestions: HT14 evaluation, detailed plan, `AGENTS.md` scope entry, then implementation behind a switch that is off by default.

**Acceptance criteria:** with recognition disabled or failing, every Phase 1–3 function behaves exactly as before; a photographed Italian water bill becomes findable by a word printed on it, a German insurance PDF with embedded text is indexed without OCR; a failed job shows "Text could not be read" with Retry and the Document stays fully usable; a suggested due date creates a Reminder only after the user confirms it in the schedule dialog; a suggested title replaces nothing until accepted, and a corrected field survives reprocessing; a non-member gets no hit, snippet or count; moving the Document to Trash removes its text from search immediately; a 500-page scan cannot starve the server (limits and queue hold); **recognition makes no network connection** (verified in the read-only container with egress blocked); a fresh installation has no AI processing of any kind active.

**Checks:** engine fixtures in three languages; job claiming / lease / restart tests; resource-limit and bomb tests; search authorisation negatives incl. snippets; suggestion-never-applies-itself tests; derived-data deletion; egress test.

**Security impact (expected):** HIGH (new native or large parsers on hostile input; derived sensitive text).

### 16.10 Phase 5 — Mail: Mailboxes, reading and sending (optional, later)
**Status:** TODO (optional later phase — a substantial module of its own)
**Depends on:** 16.0 task 3 (outbound-connection policy in `security.md` **before** any code); task 1 below (component evaluation) before any design is fixed; 16.1 for attachment handling. Documents, Contacts and every other tool work without it. Technical choices HT11–HT13; product point P6.

**Requirements:**
- **Separate from transactional email (9.1):** the server's own SMTP for invitations and reminders is untouched and never used to send user mail; a Mailbox never sends reminders.
- **Shared Mailboxes only (decided):** a Mailbox belongs to the Workspace. There are no private (per-user) Mailboxes initially.
- **Permissions (decided):** USER, EDITOR and ADMIN read messages, download attachments, compose and send. **GUEST has no Mail access at all** — no tool entry, no messages, no counts, 404 on every Mail route. **Access to Documents grants nothing in Mail.** Connecting, changing and disconnecting a Mailbox and handling its credentials need administrator permission (Workspace ADMIN planned — P6). The capabilities stay separate in the central table (read, download attachments, compose, send, administer) so the mapping can change later without touching use cases. A server admin never reads mail through the UI.
- **Connections (decided):** standard IMAP (reading) and SMTP (sending) to **public mail servers** — e.g. a Hetzner mailbox — with configurable host, port and security. **Not supported initially: LAN, VPN-only or private-address mail servers.** VMN and its stored data stay on our infrastructure; connecting to the configured provider is the expected and only outbound path of this tool.
- **Outbound-connection / SSRF policy (prerequisite):** hosts are resolved by the server and **every resolved address is validated** before each connection — loopback, private, link-local, CGNAT, unique-local, multicast, metadata and other internal ranges are refused, for IPv4 and IPv6, including IPv4-mapped forms; the connection is made to the validated address (no second resolution that could differ — DNS rebinding); allowed ports are limited to the mail ports; no redirects; timeouts and size limits; error messages do not reveal internal network details; the instance admin can disable Mail for the whole server.
- **Transport and authentication:** implicit TLS or STARTTLS with certificate verification required; cleartext refused; no certificate exceptions. Password / app-password mechanisms first; provider limitations (providers that require OAuth or have disabled basic authentication cannot be connected) are documented in the user guide; OAuth 2.0 is a possible later addition and must then not become a login identity for VMN.
- **Credentials:** sealed at rest (AES-256-GCM from `DATA_ENCRYPTION_KEY`, bound to the Mailbox id, as the Telegram token in 13.7); accepted only in a JSON body; never returned by any API, never logged, never in audit or security-log metadata, never in error messages. **Disconnect** deletes the stored credentials at once. Changing host or user requires re-entering the secret.
- **Reading:** folders, message list, message view, threads where feasible (by `References` / `In-Reply-To`; a flat list is the fallback), attachments, read / unread state. **Search and filter** by sender, date, subject, unread and has-attachment — on the server (IMAP SEARCH) or on the cache, per HT11.
- **Composing:** drafts, reply, reply-all, forward, attachments (uploads through the 16.1 validation and limits; existing Documents per 16.11). Where drafts live is HT12; nothing claims a saved draft that is not saved.
- **Explicit Send (decided):** sending is always an explicit user action through SMTP. Before sending, the screen shows the Mailbox, every recipient (To, Cc, Bcc, with a warning for reply-all) and every attachment with its size. No scheduled, automatic or rule-based sending, replying or forwarding. Per-Mailbox and per-user send rate limits.
- **Sent-folder handling:** documented behaviour — whether VMN appends the sent message to the Sent folder via IMAP, relies on the provider, or detects which — HT12.
- **Failures and ambiguity:** rejected recipients and server errors are shown precisely. If the connection drops after the message was handed over but before the server confirmed, the outcome is **unknown** and is shown as such ("We cannot tell whether this message was sent. Check the Sent folder before sending again.") — never retried automatically. Each send attempt has a persistent record and a stable `Message-ID` chosen before the first attempt, so a deliberate retry is recognisable and the UI cannot double-send by double-click or reload.
- **Remote mailbox changes (decided):** **read / unread, moves between folders and deletions are synchronised with the real mail server.**
  - The UI says clearly — at the first use and in the Mailbox's description — that these actions **change the real mailbox** for everyone who uses it, in VMN or any other mail program. Opening a message marks it read on the server (stated; "Mark as unread" is available).
  - **Ordinary Delete moves the message to the configured server Trash** — the Mailbox's Trash folder, proposed from the IMAP special-use `\Trash` attribute where the server announces one and otherwise set by an administrator in the Mailbox settings. The move is synchronised with the real mailbox like any other move.
  - **If no Trash folder is configured, Delete remains unavailable** for that Mailbox, with the reason shown, **until an administrator configures it**. There is no fallback to permanent deletion.
  - **The application must not automatically permanently delete or expunge messages:** no emptying of the remote Trash, no retention rule, no clean-up job. (Removing the source entry as the technical second half of a move on servers without a native move command is part of the move, not a permanent deletion: the message exists in the target folder first.)
  - **Explicit permanent remote deletion** (a user deliberately deleting for good, e.g. from the Trash folder) is **not approved for the initial implementation** and is not offered; its behaviour remains a later decision (P7).
  - **Saving a copy or an attachment locally leaves the remote message unchanged** (not moved, not deleted, not flagged).
  - VMN changes the remote mailbox only on a user's action — never by itself, by rule or by schedule.
  - **Errors and conflicts are visible:** an action that the server refuses, or that meets a message meanwhile moved, deleted or changed elsewhere, is reported on that message, the list is refreshed to the server's state, and nothing is silently retried into a different result; pending and failed actions are shown, not hidden. The server is authoritative.
- **Synchronisation and cache:** what is cached (headers only, bodies on demand, attachments on demand), for how long and how much (HT11); pagination of folders and lists; background polling interval and IMAP IDLE or not; limits on Mailboxes per Workspace, connections per Mailbox, message and attachment sizes; reconnect with backoff; a clear "Reconnect needed" state when credentials stop working (no endless retries that lock the account at the provider). **The cache is not an archive** (decided): it may be dropped and re-fetched at any time and is deleted at disconnect; what VMN keeps is only what a user explicitly saved (16.11). Cached mail counts toward the combined quota under Mail.
- **Safe rendering:** email is hostile input. HTML mail is sanitised with a strict allow-list and shown in a sandboxed frame without scripts, forms, plugins or same-origin access, under a CSP that blocks all network loads; **remote images and other remote content are blocked by default** with a per-message "Load images" action; links are shown with their real target and open with `noopener noreferrer`; `cid:` images only from validated attachments; a plain-text view is always available. Attachments are never opened inline as active content: download-only with a safe type, or previewed through the 16.1 pipeline. Header values are decoded and escaped; display names cannot spoof addresses (the address is always shown).
- **Future processing:** mail text and attachments stay untrusted in 16.9, including any later AI suggestions — content is data, never instructions; no action is triggered by message content.
- **Audit:** connect, change, disconnect, send, save a copy / save to Documents, remote moves and deletions. Never bodies, credentials or attachment contents. Reading a message and changing read / unread are not audit events (like previews and downloads of Documents).

**Tasks:**
1. TODO — **Technical evaluation before building Mail (decided):** assess existing maintained open-source components or projects for IMAP/SMTP access, message (MIME) parsing and safe HTML rendering. For each candidate: **licence compatibility with this repository (AGPL-3.0)**, security record and handling of hostile input, maintenance and release activity, suitability for self-hosting inside the modular monolith (no extra required service), integration effort, install scripts and SBOM impact — and **whether it allows the required links between messages and Documents, Contacts and house records** (stable message references, attachment access, provenance). The outcome and its reasons are recorded here (HT13). **No project is selected without this investigation, and it is not assumed that an entire embedded webmail application is necessary** — libraries behind VMN's own permission model are the alternative to be weighed.
2. TODO — Threat model for Mail in `security.md`, and the Mail-specific values of the outbound-connection policy (ports, limits, capability). The policy itself exists since 16.0 (`security.md` §14, 2026-10-01).
3. TODO — Domain, migration: Mailboxes, sealed credentials, cache, send records, remote-action records; capabilities.
4. TODO — IMAP adapter (connect, list, fetch, search, flags, move, special-use folders) behind a port; fakes for tests.
5. TODO — SMTP send adapter for Mailboxes, send records, ambiguous-outcome handling, Sent-folder behaviour.
6. TODO — Sync worker (claimed jobs, backoff, limits), cache and housekeeping; remote-change synchronisation with visible errors and conflicts.
7. TODO — Routes; route-security sweep; rate limits.
8. TODO — Web: Mail in the sidebar and under More, Mailbox setup with provider notes, folder and message lists, safe message view, composer with the pre-send review, real-mailbox notices, error / conflict / reconnect states.
9. TODO — Docs (user guide, deployment, provider limitations), `security.md` check.

**Acceptance criteria:** a public Hetzner-style mailbox connects only over verified TLS; a host resolving to `127.0.0.1`, `10.0.0.5`, `192.168.1.10`, `169.254.169.254`, `[::1]` or an IPv4-mapped private address is refused, also when the name changes its answer between check and connection; the password is in no response, log line, audit event or error; a GUEST finds no Mail entry and gets 404 on every Mail route, also with a message id copied from a USER; a USER reads and sends but cannot change the Mailbox settings; a message with `<script>`, event handlers, a form, a tracking pixel, CSS exfiltration and a `javascript:` link renders inert, loads nothing remote and violates no CSP; "Load images" affects that message only; Send shows all recipients and attachments first and sends once — a double click, a reload during sending and a dropped connection after hand-over never produce a second message, and the last case is reported as unknown; marking read, moving and deleting appear in another mail client connected to the same mailbox, and Delete puts the message into the provider's Trash; with no Trash folder configured, Delete is unavailable with an explanation until an administrator configures one, then works; VMN permanently deletes or expunges nothing by itself and offers no permanent-delete action; a message moved elsewhere by another client while a VMN user tries to move it produces a visible conflict and the list shows the server's state; saving an attachment leaves the remote message untouched; wrong credentials lead to "Reconnect needed" after bounded attempts; disconnecting removes credentials and cache immediately; with Mail not enabled, every other tool is unaffected.

**Checks:** fake IMAP / SMTP servers in tests (TLS failures, slow and hostile servers, oversized and malformed MIME, header injection, encoded-word tricks, missing special-use folders, concurrent changes by a second client); sanitiser corpus; CSP / e2e test that no remote request leaves the browser; credential-leak tests over responses, logs and audit; SSRF tests against the policy incl. rebinding and IPv6 forms; permission matrix incl. GUEST on every route; send-idempotency and ambiguous-outcome tests; no-automatic-permanent-deletion test (no expunge outside a completed move, no emptying of Trash, no permanent-delete route); sync restart and lease tests; quota tests.

**Security impact (expected):** CRITICAL.

### 16.11 Phase 5 — Mail integration with the house tools
**Status:** TODO (optional later phase)
**Depends on:** 16.10; 16.5 (links), 16.6 (Contacts); 16.7 / 16.8 for their link targets; 16.9 optional.

**Requirements:**
- **Three kinds, kept distinct in words and in the data model (decided):** the **live message** (at the provider; may change or vanish), the **cached message** (VMN's temporary copy; removable at any time, never an archive) and the **saved copy** (explicitly retained in VMN; stays). The UI never implies that a cached message is kept.
- **Save an email as a local copy (decided):** a user explicitly saves a message; the saved copy is kept in VMN and can be **linked to house records** (Folders / Documents, Contacts, Equipment, MaintenanceRecords, Procedures, Reminders — the 16.5 model). **Save attachments to Documents:** the user selects attachments and a Folder; each goes through the full 16.1 validation, limits and quota like an upload (an attachment the allow-list refuses is refused here too, with the reason) and is stored byte-for-byte as an original.
- **Provenance (decided):** saved copies and imported attachments record sender, recipients, message date and subject (and the Mailbox and `Message-ID`), shown on the record and kept in exports.
- **Audience change is explicit before saving (decided):** saved copies and attachments placed into Documents **follow Documents permissions** — every Workspace member including guests can then view and download them, although guests cannot see the Mailbox. The save dialog says so before the user confirms ("This will be visible to everyone in the Workspace, including guests"), every time.
- **Kept after disconnect or remote removal (decided):** saved copies and imported attachments remain, with their provenance, after the Mailbox is disconnected or the remote message is moved or deleted. Links to messages that were not saved show "Message no longer available"; the cache is deleted at disconnect. How a saved copy is represented (a Document holding the message, or its own record under Documents permissions) is a technical choice (HT11).
- **Saving leaves the remote message unchanged** (16.10).
- **Possible duplicates** (same content hash already in the Workspace, or the same message or attachment saved before) are pointed out before saving with the choice to open the existing one, add anyway, or cancel — **never silently discarded** and never silently merged.
- **Create a Contact or a Reminder from a message** with user review: the Contact form prefilled from the sender (duplicate hints from 16.6); "Remind me…" as in 16.5 with dates and notifications reviewed by the user. Nothing is created without Save.
- **Message links** use a stable reference (`Message-ID` plus Mailbox, not an IMAP UID). A member without Mail access (GUEST) sees through such a Link nothing of an unsaved message — neither subject nor sender.
- **Outgoing attachments from existing files:** a Document can be attached only if the sender may read and download it at the moment of sending (re-checked in the send transaction); the pre-send review lists it like any other attachment.
- **No automation:** no automatic sending, forwarding, replying, filing or payment processing; no rule engine.

**Tasks:**
1. TODO — Message references and Links; saved-copy model with provenance.
2. TODO — Save a copy / save attachments to Documents with the audience notice and duplicate hints.
3. TODO — Contact / Reminder from a message.
4. TODO — Attach existing Documents with send-time authorisation.
5. TODO — Web flows, docs, `security.md` check.

**Acceptance criteria:** two PDF attachments of a utility's email are saved into **Electricity** after the dialog stated that all members including guests will see them; the Documents show sender, recipients, date and subject and download byte-identical to the attachments; the remote message is unchanged (still unread if it was, same folder); saving one again points to the existing Document and stores a second only if the user chooses so; an `.html` attachment is refused with the 16.1 message; a GUEST opens the saved Document but gets 404 for the message and sees no subject of unsaved linked messages; after the Mailbox is disconnected and after the remote message is deleted, the saved copy and the Documents remain with their provenance, and an unsaved linked message says it is no longer available; the UI labels live, cached and saved distinctly; a member whose access to a Document was removed between composing and sending cannot send it; a Reminder created from a message exists only after the user confirmed its date.

**Checks:** provenance round-trip incl. export; audience-notice present on every save path; duplicate cases; authorisation at send time (TOCTOU); disclosure tests through Links for GUEST; disconnect / removal lifecycle; remote-unchanged test after saving.

**Security impact (expected):** HIGH (moves content across the Mail and Documents permission boundary, by explicit user action).

### 16.12 Decisions for section 16
**Product decisions (confirmed by the user on 2026-10-01; integrated above).** Numbers are those of the original open list; the questions were mapped by meaning.
| # | Decision |
|---|---|
| H1 | Tool names: **Documents, Contacts, Maintenance, Equipment, Mail** |
| H2 | **Workspace admins enable optional tools** per Workspace; an enabled tool appears to everyone with the appropriate permissions; **no personal tool-hiding preferences** |
| H3 | Follow the existing focused tool-chooser design; **no additional mobile bottom-bar destination** — Documents (and later tools) are reached through More on phones |
| H4 | Documents and Contacts: **all members view**; **GUEST views and downloads documents and views contacts** but cannot create, edit or delete; **USER (incl. EDITOR) and ADMIN manage** under the existing role model; **Workspace-wide access, no per-folder permissions**. Mail has its own rules (H19) |
| H5 | **Audit changes** (uploads, edits, moves, deletions, restores, relevant administrative changes); **routine previews and downloads are not audited**; security logging is kept and kept distinct from product auditing |
| H6 | **Originals preserved byte-for-byte including embedded metadata**; downloads return them unchanged; previews / converted versions are separate; users are told originals may contain GPS or other metadata; **HEIC/HEIF originals are kept** even if the preview is converted in the browser, and a converted JPEG is never called the original (processing approach: HT1) |
| H7 | **One combined storage quota per Workspace with a breakdown by tool**; instance admin sets ceilings, Workspace admins may set lower limits; counts originals, previews, retained versions and other derivatives; **Trash counts**. Default **5 GB per Workspace** (P1) |
| H8 | **50 MB per file initially, configurable by the instance admin** |
| H9 | **Nested folders**; deleting a Folder moves it and its contents to Trash; restore preserves hierarchy and contents with predictable rules for name conflicts and missing parents (16.2); folder moves prevent cycles |
| H10 | **A Run retains the Document version linked at the time**, files and metadata; later edits or deletion never change historical Run evidence; this is **not** approval of completion photos (14.5) |
| H11 | **No automatic expiry**; items stay in Trash until a **Workspace admin explicitly deletes them permanently** with clear confirmation; retained Run evidence and saved records survive as specified (16.4, 16.5); backup retention documented separately; **scoped to the new house-management records** — Procedure and List deletion rules unchanged |
| H12 | Export: **ZIP with originals in their folder hierarchy**, machine-readable metadata (titles, dates, notes, tags, relationships) and a **readable HTML index**; safe file names and HTML; schema and relationship representation are technical choices; every member who can view Documents may export, incl. GUEST (P2) |
| H13 | From a Document the user **chooses between a standalone Reminder linked to the Document and scheduling a Procedure**; dates and notification settings are reviewed by the user; the existing scheduling system is reused |
| H14 | Contacts: **CSV and vCard (`.vcf`) import and export**; imports show a preview and possible duplicates before saving; **no automatic merge** |
| H15 | **OCR on our own infrastructure**; embedded PDF text where available, OCR where needed; **OCR and rule-based suggestions first**; **optional AI-assisted suggestions later, disabled by default, also on our infrastructure**; external processing is not a default and not an approved option; confirmation before creating reminders or changing important metadata; Documents work without OCR or AI |
| H16 | Maintenance statuses **Planned, In progress, Completed, Cancelled**; **Kanban Board and List** views; dragging a card between columns changes the status, with an accessible status control as well; **completion is manual**; Runs are linked as references and never complete maintenance automatically |
| H19 | **Workspace-shared Mailboxes only** initially; **USER (incl. EDITOR) and ADMIN read and send; GUEST has no Mail access**; Document access grants no Mailbox access; saved copies and attachments in Documents follow Documents permissions, with the audience change stated before saving; configuration and credentials need administrator permission |
| H20 | **Public IMAP/SMTP servers only** (e.g. a Hetzner mailbox); **no LAN, VPN-only or private-address servers** initially; the outbound-connection / SSRF policy stays a prerequisite, incl. validation of resolved addresses and protection of internal services |
| H21 | Emails can be **explicitly saved as local copies linked to house records**; saved copies and attachments imported into Documents **remain after disconnection or remote removal**; caches are not archives; live, cached and saved are distinct in UI and data model; provenance (sender, recipients, date, subject) preserved |
| H22 | **Read / unread, moves and deletions are synchronised with the real mail server**, clearly communicated; ordinary Delete moves messages to the configured server Trash, and stays unavailable until an administrator configures one; **the application never automatically permanently deletes or expunges**; explicit permanent remote deletion is not approved initially (P7); saving locally leaves the remote message unchanged; sync errors and conflicts are visible; sending stays an explicit action through SMTP |
| P1 | **Default combined storage quota: 5 GB per Workspace**; the instance admin configures the ceiling, Workspace admins may set a lower limit; a **usage limit, not preallocated or reserved disk space**; combined accounting unchanged (documents, instruction images, previews, retained versions, derivatives, Trash) |
| P4 | **A Workspace admin may remove a Document version retained by a finished Run, with an audit entry and a permanent removal note** (decided 2026-10-02): explicit confirmation and a non-empty reason; the note shows who, when and why and holds nothing of the document; the original Document, other Runs' versions, Run results and earlier history stay unchanged; while a Run is ACTIVE the existing removal rule applies (16.5) |
| P3 | **A GUEST may view everything of Maintenance and Equipment, read-only** — Maintenance incl. costs (decided 2026-10-02, implemented in 16.7); **Equipment incl. costs and serial numbers** (decided 2026-10-02 with the request for release 0.5.0-beta.2; implemented in 16.8). Manage = USER and above; permanent deletion = ADMIN |
| P2 | **GUEST members may bulk-export Documents** (originals, metadata, HTML index), consistent with their view/download access; authorisation and resource limits apply; an export never exposes Mail records or other linked content the exporter cannot access |
| — | New (Mail): a **technical evaluation of existing maintained open-source components** precedes building Mail (16.10 task 1, HT13); nothing is selected without it and an embedded webmail application is not assumed |

**Settled as engineering defaults (not product questions; changeable while implementing, recorded in the step's completion note):** record names (Folder, Document, Page, Trash, Mailbox); capability names; grouping of tools in the sidebar and on More; folder depth and top-level Documents; per-Document file count, pixel and page limits; page sizes; a Reminder Link points to the Schedule (former H13 detail); no manual contact merge (former H14 detail); Workspace-managed categories for Maintenance and Equipment, free-text location with suggestions (former H16 / H17 details); no offline use of these tools (former H18); no certificate exceptions and no OAuth initially (former H20 details); opening a message marks it read on the server (former H22 detail); no export import; contact export for USER and above; one running export per user.

**Still open — product points for later phases.** P1–P4 are resolved (table above); **nothing here concerns Phase 1.** Each is named because it touches privacy, permissions, destructive behaviour or scope and must not be decided silently.
| # | Question | Needed before | Planned unless decided otherwise |
|---|---|---|---|
| P5 | Text recognition: **automatic on upload or only on request**; opt-out per Workspace or per Document | starting 16.9 | — |
| P6 | Mail administration: **Workspace ADMIN** connects and manages Mailboxes (with an instance-wide off switch for the server admin) — or the instance admin only? Are recipient addresses of sent mail recorded in the audit trail or only their number? | starting 16.10 | Workspace ADMIN; recipient count only |
| P7 | **Explicit permanent remote deletion** of mail by a user (e.g. deleting from the server Trash): whether it is offered at all, to whom, and with what confirmation | only if wanted after the initial Mail implementation | not offered; VMN never permanently deletes or expunges automatically |

**Technical choices — open, settled by evaluation inside the named step and then recorded here with reasons (as T1–T5 were). They are engineering work, not questions to the user, unless an evaluation finds that an option changes privacy, permissions or scope.**

*Phase 1 — HT1–HT6 settled on 2026-10-01 in 16.1, HT7 on 2026-10-02 in 16.3, by evaluation in this repository (versions as installed; timings on the development machine, 16 cores, NVMe):*
- **HT1 — HEIC preview: deferred — no HEIC decoder is shipped; HEIC originals are accepted, validated from their container, stored and downloaded unchanged, and show "Preview unavailable for this format" (owner's decision, 2026-10-01).** *Evaluated:* the bundled libvips (sharp 0.35.5: libheif 1.23.5 with AV1 only) reads a HEIC's container and dimensions but cannot decode HEVC; `libheif-js` 1.23.2 (libheif + libde265 as WebAssembly, LGPL-3.0, no dependencies, no install script, a community build without publish provenance) decoded a 12 MP `heif-enc` photo in about 1.0 s with about 250 MB of memory and was integrated in the parser worker thread. *Why it was removed again:* decoding HEIC means shipping an HEVC decoder; HEVC is patent-encumbered and the licensing / patent review that T3 already asked for has not been done — not an engineering question, so it went to the owner, who chose to defer. The dependency and the decoding path are gone; a test and the container smoke test assert that no HEVC decoder is in the runtime tree. *Validation without decoding:* the `ftyp` brand at offset 0 plus libvips' reading of the container (format `heif`, compression `hevc`, dimensions ≤ 50 MP) — the coded image data itself is not checked. *If the review allows it later,* the options evaluated stay: `libheif-js` in the worker thread (preferred: sandboxed in WebAssembly, regenerable previews, works for files that arrive without a browser); a browser-made preview (only where the browser decodes HEIC, not regenerable, one more untrusted upload); a custom libvips with libde265 (native, unsandboxed). Files stored meanwhile need no migration: their previews can be made when a decoder exists.
- **HT2 — store and backups: an own content-addressed store `/data/documents` (not shared with `/data/media`), backed up into `/data/backups/documents` by hard links.** *Why separate:* different rules (originals of any accepted format up to 100 MB, streamed; no `.jpg` names) and separate housekeeping — the image housekeeping deletes every file in its directory that no image row uses. *Why hard links:* T1 copies each referenced file once into the backup store; for gigabytes that doubles the disk use and reads everything. Files are immutable, and backups normally sit on the same volume, so a link costs nothing: measured, 20 × 50 MB linked in < 1 ms, against 0.6 s to read and hash that gigabyte (SSD; roughly 10 s per GB on one hard disk). Fallback to a copy across file systems. A file is hashed once, when it enters the backup store; a scheduled backup otherwise checks presence and size only (the old behaviour — hashing everything inside the server process at every backup — would block it for seconds per gigabyte); `verify` and `restore` hash everything. *What a linked backup is and is not* (documented in `deployment.md` / `unraid.md`): it keeps a file that the application deleted until the backups rotate, and it is no protection against a failing disk — that is the off-host copy, as before. Derived previews are included (free with links; a restore needs no re-rendering).
- **HT3 — in-app preview: page images rendered on the server by MuPDF 1.28.1 (WebAssembly, Artifex's npm package), shown as ordinary images.** *Checked:* opens, classifies and draws the test PDFs in 30–190 ms per page; detects password protection, JavaScript and embedded files; no dependencies, no install script, SLSA provenance; AGPL-3.0-or-later, compatible with this AGPL-3.0-only project. *Why not a PDF viewer in the browser (pdf.js in a sandboxed frame):* hostile PDFs would be parsed in every member's browser, the CSP would have to allow workers and blob URLs, and thumbnails, the grid (16.3) and text recognition (16.9) need server-side pages anyway. *Why not the browser's built-in viewer:* it needs the original served inline — against "originals are downloads only" — and phones have no consistent inline viewer. **The CSP is unchanged.** Pages are drawn at 200 dpi within 2400 px (an A4 page: 1653 × 2339), without annotations, widgets or scripts; images are previewed by libvips at ≤ 2400 px. MuPDF also extracts text — a candidate for HT10.
- **HT4 — problematic PDFs: stored, never refused for these reasons.** A password-protected PDF is kept download-only without preview (a bank statement someone wants to file is legitimate). PDFs with JavaScript or embedded files are kept and flagged, with normal previews: electronic invoices (ZUGFeRD / Factur-X) embed their XML, and forms carry scripts — refusing them would refuse ordinary household documents. This is safe because the original is never rendered by VMN and the preview is a picture of the page.
- **HT5 — large uploads: one streamed request per file, no chunked or resumable protocol.** The body is streamed to the data volume while counted (never buffered), with 15 minutes for an upload — 100 MB needs about 0.9 Mbit/s, the 50 MB default about 0.45 — and one request per file gives per-file progress, failure and retry. A resumable protocol would add server-side state for partial uploads, their own quota accounting and clean-up, and another attack surface, for files that are mostly 1–12 MB (phone photos and scans). To revisit if real use on phones shows failures. A refused upload is answered cleanly while a bounded rest of the body is discarded. Proxy settings are in `deployment.md`.
- **HT6 — malware scanning: none.** Uploaded files are never executed or rendered, originals leave only as downloads, and only four validated formats are stored; a signature scanner adds little for PDFs and photos, while `clamd` needs more than a gigabyte of memory on the Unraid target and must not become a required service. No quarantine state. The limitation is stated in `deployment.md` and `security.md`. A scanner could later sit between receiving and registering a file; nothing was built for it.

- **HT7 — search: a folded text column per Document and `LIKE`, scoped to the Workspace; no FTS5 for Phase 1.** *Matching:* text is folded by the application (NFKD, marks removed, lower case, `ß` → `ss`) into `documents.search_text`; a search is folded the same way and each of its words must occur somewhere in that text (`LIKE '%word%'` with literal `%` / `_`). *Evaluated* with better-sqlite3 13.0.3 (SQLite 3.53.4, FTS5 compiled in) on a scratch database of 50 000 Documents in one Workspace and 10 000 in another (German / Italian / English words, compounds, 40 % with about 200 characters of notes): `LIKE` on the folded column, FTS5 `unicode61 remove_diacritics 2` with prefix queries, FTS5 `trigram`. *Results:* first page of a common word — `LIKE` 0.06 ms, unicode61 17 ms, trigram 22 ms (the `LIKE` query walks the upload-time index — checked with `EXPLAIN QUERY PLAN` — and stops after fifty matches; the FTS5 queries have to join and sort every match first); a word nobody has — `LIKE` 13 ms at 50 000 and 2.4 ms at 10 000 (it reads the Workspace's text once), FTS5 0.01 ms; counting 11 000 matches — `LIKE` 12 ms. Index size: 26 MB (unicode61) and 45 MB (trigram) on top of a 30 MB table. Worst case, every Document with 4 000 characters of notes (a 531 MB table): `LIKE` without hits 139 ms at 50 000, 29 ms at 10 000; FTS5 170–240 ms for a common word. *Why `LIKE`:* (1) **it finds what people expect** — words inside compounds ("rechnung" in "Stromrechnung": prefix search missed 1 180 of 10 918 such Documents) and two-letter terms (the trigram tokeniser cannot match fewer than three characters); (2) **it only ever reads rows of the asking Workspace** — an FTS5 index is one structure for all Workspaces: the query for the 10 000-Document Workspace took 125–190 ms because of the *other* Workspace's content, against 0.07–29 ms with `LIKE`; besides being slower, that makes response time depend on other Workspaces' documents (a timing side channel, see `security.md`); (3) no virtual table, shadow tables or sync triggers in migrations, backups and restores, and nothing to rebuild; (4) well inside the 500 ms bound at the 50 000-Document limit. *Costs accepted:* a search reads all searched text of the Workspace (linear, bounded by the Document limit and the 4 000-character notes); no ranking, no stemming; folding is application code, so the three derived columns are filled by `migrate` for old rows and guarded by a trigger for new ones. *For 16.9* (recognised text, far more text per Document) the scan must be re-measured; an FTS5 trigram index has the same "substring of folded text" semantics for words of three letters or more and is the candidate — with its cross-Workspace cost to be solved there.

*Later phases (do not block Documents):*
- **HT8 (settled 2026-10-02 in 16.5) — link model: one generic, typed table `links` with integrity triggers; Run-retained versions in their own tables.** *Options:* a table per pair (Document–Procedure, Document–Schedule, …); one table with a nullable foreign-key column per record type; one table with typed ends (`type`, `id`). *Why typed ends:* later tools add record types (Contact, MaintenanceRecord, Equipment, saved mail) and links between them; with typed ends a new type is a replaced trigger, while a column per type needs a Workspace-scoped composite foreign key that SQLite can only add by rebuilding the table, and a table per pair multiplies tables, queries and audit paths. *Integrity without polymorphic foreign keys:* a `BEFORE INSERT` trigger requires both ends to exist in the Link's Workspace (a cross-Workspace Link cannot exist, tested with raw SQL), an update trigger freezes the ends, and a delete trigger on `documents` refuses to remove a Document that a Link still shows as present — permanent deletion marks the end as gone first. Procedures, Schedules and Runs are never deleted from the database, so their ends cannot dangle. *Run versions* are not Links: they copy the Document's details and reference its immutable files in `run_documents` / `run_document_files`, immutable by trigger, beside the Run and never in its tables.

| # | Phase | Question | Notes |
|---|---|---|---|
| HT9 | 4 | Recognition engine and placement | Local engine with English, German and Italian data; in-process, child process or optional container of the same deployment; effect on image size, memory (the Unraid target) and both release architectures; licences and SBOM |
| HT10 | 4 | PDF text extraction | Library for embedded text; overlaps with HT3 if a PDF library is added there |
| HT14 | 4 (later) | Local AI suggestions | Whether a local model is feasible on the target hardware; runtime, model licence, resource limits, isolation; only after OCR and rule-based suggestions |
| HT11 | 5 | Mail cache, search and saved copies | Headers-only cache with on-demand bodies versus fuller cache; cache lifetime and whether it is in backups; IMAP SEARCH versus local index; IDLE versus polling; representation of a saved copy |
| HT12 | 5 | Drafts and Sent | Drafts in VMN or in the mailbox; APPEND to Sent versus provider behaviour and how to detect it |
| HT13 | 5 | Mail components | The evaluation of 16.10 task 1: existing open-source components or projects for IMAP/SMTP, MIME parsing and safe rendering — licence compatibility (AGPL-3.0), security, maintenance, self-hosting, integration effort, support for links to Documents, Contacts and house records (nodemailer is already used for 9.1 with file and URL content loading disabled) |

**Prerequisites by phase:**
- **Phase 1 (Documents): complete** — 16.0, 16.1, 16.2 (2026-10-01), 16.3 and 16.4 (2026-10-02); HT1–HT7 settled; released in 0.5.0-beta.1. HEIC previews are deferred (HT1).
- **Phase 2:** 16.5 done (2026-10-02, HT8 settled; P4 decided and implemented the same day); 16.6 done (2026-10-02) — Phase 2 complete; next 16.7 (Phase 3).
- **Phase 3: complete.** 16.7 done (2026-10-02), 16.8 done (2026-10-04); P3 implemented for both.
- **Phase 4:** HT9, HT10, P5; HT14 and a separate plan before any AI work.
- **Phase 5:** the outbound-connection policy in `security.md` (§14, written in 16.0), the component evaluation (HT13), HT11, HT12, P6.

---

## 17 — Documentation, optional Workspace tools and a more encouraging Today (accepted 2026-10-02)

**Objective (user):** bring documentation up to date with the broader product; make the README a short entry point to audience-specific guides; let Workspace admins choose every tool, all off by default; make Today more interesting with useful statistics and a sense of progress rather than a feeling of having missed something.

**Scope:** tool controls, Today changes and product screenshots below were implemented on 2026-10-04. The requirements were accepted before implementation. This section supersedes the fixed core navigation of 15.1 and the “actionable only / no recently done” Today requirement for exactly the progress overview in 17.2. It extends the optional-tool rule of section 16 to all functional tools. It does not approve cost reporting, budgets, rankings, external analytics or a general analytics dashboard.

### 17.0 Documentation organisation and README
**Status:** DONE  
**Completed:** 2026-10-02

**Implemented:** moved `docu` into `docs/admin`, `docs/user` and `docs/development`; added audience indexes and a root documentation index. README now introduces the broader product, removes the outdated ADHD headline and extensive duplicated setup/feature detail, and links to the guides. Updated repository references, relative Markdown links and product objectives. No mockup is presented as a screenshot. Section 17 records new requirements and screenshot follow-up.

**Tests/checks:** local Markdown destinations and anchors checked; stale `docu/` references checked; `git diff --check`. Documentation-only; application tests not required.

**Security impact:** NONE — no executable behaviour, permissions, configuration defaults or endpoints changed. Planned checks are added to the security policy for 17.1–17.2.  
**Security docs updated:** YES (planned requirements only).  
**Remaining:** old external links to `docu` need updating by their owners. Implementation and remaining validation limits are recorded below.

### 17.1 Every Workspace tool is optional
**Status:** DONE (review branch, 2026-10-04)

**Implemented:** Procedures (including Runs, history, Knots and instruction images), Reminders, Lists and Calendar join Documents, Contacts and Maintenance in Workspace-admin tool settings. New Workspaces have no enabled tools. Migration 0035 adds a revision; 0036 enables the four previously available core tools for existing Workspaces while preserving house flags and audit history. Settings writes require the seen revision; stale/ABA writes return 409, no-ops preserve history, and flag/revision/audit commit atomically.

Central application capability/tool checks and transactional repository guards protect mutations. Source-aware Schedule queries filter before pagination; standalone Reminders work without Procedures, and Procedure schedules work without Reminders. Calendar is only a view. Today, links, exports and retained-only Run files omit disabled sources; SSE closes after disable, Knots fail uniformly and offline replay retains pending device changes with an explanation. Desktop/phone navigation and cross-tool controls follow flags; phone navigation has two to four labelled destinations. All-tools-off Today offers admin setup or a member explanation. Disable preserves records and quota.

Workers recheck sources at selection, claiming and immediately before provider send. Normal deliveries pause; reenable supersedes unprocessed notifications older than 24 hours atomically with the flag, without changing Occurrences. Mixed catch-up summaries remove unavailable members without blocking enabled sources. Older grouped notifications follow existing bounded outage catch-up/drop semantics; recurrence anchors and deduplication keys are preserved. Documents previews pause without attempts/quota changes and resume the same file. Review also fixed upload-registration disable races and GUEST disclosure of trashed Document titles/deleting actors in Maintenance links.

**Checks:** final validation below, with fresh/upgrade migration fixtures, stale/concurrent/no-op/audit rollback settings, exhaustive registered core route sweep, disabled streams, retained-only originals, cross-tool links, preview pause/resume and normal/mixed-summary notification regressions. Existing feature tests explicitly enable core tools in fixtures; production defaults remain off.

**Security impact:** HIGH — extends server tool boundaries and source-aware background delivery. No new role, credential or outbound host type. See security §15. **Remaining:** Equipment and Mail are unavailable until implemented; translations for new text use English fallback. Physical-device/screen-reader and real production-data upgrade checks remain unperformed.

**Requirements:**
- A **Workspace ADMIN** chooses which functional tools are enabled in Workspace settings: **Procedures (including Runs and completed history), Reminders, Lists, Calendar, Documents, Contacts, Maintenance, Equipment and Mail**. Equipment and Mail controls become available when those tools are implemented; enabling a flag must never expose an unfinished tool.
- **Every tool defaults off for newly created Workspaces**, including Procedures, Reminders, Lists and Calendar. No templates, lists or folders are silently created. Today, Workspace selection, membership and settings are structural views and remain reachable, with a calm setup state and a direct “Choose tools” action for admins. Other members see that no tools have been enabled, without an inaccessible setup action.
- On upgrade, preserve existing Workspaces' currently available core tools and their existing house-tool flags. Do not hide historical data or interrupt existing obligations merely because the new default is off. Record migration behaviour and test fresh and upgraded Workspaces separately.
- Disabled means absent everywhere: sidebar, phone navigation, More, Add chooser, search, links, Calendar entries, Today cards and counts. Guard **every associated server route and feed**, not just its landing page; disabled resources answer like unknown resources for every role. No titles or revealing counts through enabled tools. Enabling never grants a role or membership.
- Disabling keeps all records, files, Runs, Occurrences and audit history; re-enabling restores access to the same data. Record who enabled/disabled each tool and when. Trash and storage accounting still count retained data; disabling is not a way to reclaim quota.
- Dependencies must be explicit: Calendar shows only content from enabled source tools; Reminders owns standalone Reminders, while scheduling a Procedure belongs to Procedures. Disabling Reminders must not silently disable scheduled Procedures. Links are hidden if either end is unavailable, without deleting links or Run-retained versions.
- Before disabling Procedures or Reminders, explain that its scheduled items disappear and **outbound notifications for those items stop while it is off**. Preserve recurrence anchors and history; re-enable uses existing catch-up limits (≤24 h, older notifications dropped), with no notification flood or silent completion. Workers re-check flags before sending, including queued jobs. Disabling Calendar affects its view only, not scheduling or delivery. Mail disable must stop access and background mailbox sync, retain saved copies and credentials securely, and not mutate the provider's messages.
- Desktop and phone navigation contain only enabled tools. Keep Today and More reachable; omit disabled Procedures/Lists rather than showing dead bottom-bar destinations. Define and verify an accessible compact phone layout with no more than four labelled destinations. This supersedes section 15's requirement for exactly four fixed destinations where tools are off.
- Central capability/tool policy applies to writes, reads, SSE, offline replay, exports, files and background work. Explain a disabled tool when an offline queue cannot sync; retain pending device changes and never bypass the server gate.

**Required checks:** fresh defaults; upgrade preservation; ADMIN vs USER/EDITOR/GUEST and cross-Workspace writes; stale concurrent settings updates; every disabled-tool route, feed and cross-tool count; no leaks through Calendar, Today, Links, Knots, retained Run documents or exports; notification and sync workers while disabled and after re-enable; offline replay; data and quota unchanged after disable/re-enable; Light/Dark and keyboard/phone navigation down to 320 px.

**Security impact:** HIGH — server-enforced tool boundaries, aggregate visibility and background-delivery rules are implemented and documented.

### 17.2 Today: progress, activity and useful statistics
**Status:** DONE (review branch, 2026-10-04)

**Implemented:** a compact text-based progress card shows completed Occurrences today, completed Runs this week, active Runs and due today; unavailable measures are omitted. Occurrence dates use each Schedule’s time zone (including DST). Run reporting uses the explicitly labelled UTC Monday–Sunday range, because Workspaces have no reporting-time-zone setting. Measures stay separate. Only canonical COMPLETED states count; undo/reopen removes entries. All/Assigned to me/Shared applies to counts, activity and next actions; unlinked Runs are Shared. Recent completions use bounded SQL queries (ten per source, ten merged), and the compact card displays the latest three. A linked completed Run is represented by its completed Occurrence. Occurrence links open a read-only authorised history view. No costs, rankings, percentages or external analytics.

**Checks:** completion/undo, linked deduplication, selected-filter/role/Workspace scope, disabled sources, UTC week rollover, Schedule local midnight and DST regressions. Actual desktop/phone captures in both themes and 320 px overflow checks; semantic token contrast tests and browser accessibility checks pass. **Security impact:** MEDIUM — new aggregate/history reads enforce active membership, capability, tool and selected scope in database queries. **Remaining:** live physical-device and screen-reader checks remain unperformed; week reporting intentionally uses UTC.


**Requirements:**
- Today remains the Workspace landing page and a useful place to act, with a welcoming **progress summary**, a small recent-accomplishments area and the next actions. It should convey both “what we have done” and “what is next”.
- Start with a few clearly labelled counts from existing data: **completed Occurrences today**, **completed Runs this week**, **active Runs**, and **due today**. Use the Workspace/Schedule time-zone rules consistently and label the date range; define the reporting boundary before implementation where Schedules use different time zones. Runs and Occurrences are separate measures: never add them into one “tasks completed” total that double-counts a scheduled Run. Skipped, cancelled, N/A and aborted are never reported as completed work.
- Show a concise **Recently completed** list of Runs and Occurrences with title, completion time and a permitted detail/history link. Deduplicate a scheduled Run and its linked Occurrence in this list. Undo/reopening must update counts and activity from canonical state; no fabricated achievements.
- Put due items and Continue within easy reach. Keep overdue obligations visible and actionable in a neutrally worded “Needs attention” group; no large failure banner, red page background or repeated guilt messages. Critical warnings retain their safety treatment. Do not mark missed items completed or hide them merely to improve the mood.
- An empty day is a valid state: “Nothing due today”, optional recent progress and an appropriate next action. Never show a meaningless 0% progress ring when nothing is scheduled. A Workspace with all tools off shows the setup state from 17.1 rather than zero-filled statistics.
- Summary and activity reflect the selected Workspace, current visibility and any All / Assigned to me / Shared filter. Labels state the scope. Omit disabled or unauthorised tools entirely, including their counts; no Mail, recent-Document or cost widgets. House-management work reaches Today through the existing Schedule/Occurrence model.
- Keep statistics compact and mobile-friendly, with accessible text equivalents, semantic theme tokens and a small restrained visual accent. No streak pressure, leaderboards, member comparisons, productivity scores, financial charts, telemetry or external analytics.

**Required checks:** count semantics and linked-Run deduplication; completion/undo/reopen; day/week boundaries and DST; empty/new Workspaces; active and overdue states; role/filter/Workspace scope and disabled-source tools; efficient bounded queries; keyboard, screen reader, Light/Dark, phone and 320 px layout. Record the final design and screenshots, and update the user guide only once implemented.

**Security impact:** MEDIUM — aggregate queries and activity views enforce the same access as their underlying records.

### 17.3 Current product screenshots
**Status:** DONE (review branch, 2026-10-04)

**Implemented:** six optimised WebP captures from the real local fictional demo under `assets/screenshots/workspace-tools-2026-10-04/`, with a capture guide and compact README section. `test-env/capture-screenshots.ts` prepares only missing fictional content through authenticated APIs and records viewport/theme/check metadata in the temporary capture directory. Existing owner assets remain unstaged. **Checks:** visual review of every selected image, no credentials/token URLs/private data, no alerts or horizontal overflow, desktop 1440×1000 and phone 390×844; Today/settings/More also checked at 320 px in both themes. **Security impact:** LOW — reviewed public fictional assets, no new runtime feature. **Remaining:** screenshots represent this review branch, not a deployed release.


Capture a small, reviewed set from the actual app using `test-env` fictional demo data: Today (after 17.2), Procedure builder, phone Run execution, and optional Documents/Maintenance. Include desktop and phone, Light and Dark; use realistic helpful content, no real users, house documents, credentials, token URLs or notifications. Store only selected, optimised images under `assets/screenshots/` with a short capture guide identifying the version, seed, viewport and theme. Distinguish implemented UI from `assets/mock-ups` design references; never fabricate screenshots. Keep bulk QA captures and temporary outputs out of git. Add a compact screenshot section to the README after visual review.

**Final validation (2026-10-04):** `pnpm test` — 141 files / 1136 tests passed; `pnpm typecheck`, `pnpm lint`, production build and `git diff --check` passed. Browser suite: three passed, one intentionally skipped (long mobile account flow; mobile smoke runs). Fictional demo captures and 320 px overflow checks passed. Earlier expanded-role failures were fixed and rerun; one concurrent QA run exceeded the existing 500-page preview timeout, and the final full suite passed without changing the timeout. Dependency audit: one moderate transitive esbuild development-server advisory, zero high/critical; documented in security §15, remains open. Existing ~752 kB web chunk warning remains. No physical-device/screen-reader, real production-data migration, Unraid/container resource validation or deployment performed. New strings use existing English fallback in other locales.

**Required checks:** actual UI/version matches the guide, readable text at README size, no private data or secrets, correct relative image paths and useful alt text.

**Security impact:** LOW — public assets use fictional demo data; no new application feature.

### 17.4 Stabilize CI and reduce validation time
**Status:** DONE (2026-10-04; `3de6fa5`, merged through PR #15)

**Implemented:** runtime PCRE2 upgraded via signed Debian repositories, with minimum fixed-version assertion (10.42-1+deb12u2); both native scanner gates remain. Quality and browser CI jobs run in parallel with image validation; aggregate `check` requires success from every job. Duplicate web build removed. Ordinary test fixtures reuse closed, real-migrated empty-schema bytes in independent private DBs; no production/crypto settings or tests removed.

**Checks so far:** unchanged local suite 1136 tests took 32.7 s; same suite with template fixtures took 29.1 s (~11% reduction in this one paired measurement; varies with load). Prior CI quality step took 1m52, browser 2m01; stabilized PR CI took 3m00 versus 5m18 before (~43% faster observed). Its unit/integration step took 1m11 versus 1m52 (~37% faster), including two added regressions. Different runs/runners/load prevent treating these as guarantees. Added fixture-isolation/FK/mode regression and populated beta.2 backup→upgrade→restore→upgrade regression, both pass; typecheck/lint pass. Built image holds fixed PCRE2; container smoke checks pass. Real migrator/schema generation checked separately. Final local suite: 143 files / 1138 tests passed; typecheck/lint, production image build/smoke and `git diff --check` passed. Schema generation reports no drift. PR CI run 37214175964 passed quality, browser, both native image smoke/scans and aggregate gate; no fixable HIGH/CRITICAL image finding.

**Security impact:** MEDIUM — runtime dependency patch and fail-closed CI execution; no new product attack surface. Full controls/checks in security §15. **Remaining:** release publication recorded in 12.22; physical-device, screen-reader and live Unraid checks remain outside this run.

---

## 11 — Licensing

### 11.1 AGPL-3.0
**Status:** DONE
**Completed:** 2026-09-27

Add canonical GNU Affero General Public License v3 text and appropriate package/project license metadata.

**Security impact:** LOW — one new public read-only endpoint that returns only static configuration.

**Implemented:**
- `LICENSE`: canonical text from `https://www.gnu.org/licenses/agpl-3.0.txt` (SHA-256 `0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0`, compared with the SPDX `AGPL-3.0-only` text: identical apart from `http`/`https` in URLs).
- Package metadata: every `package.json` (root, apps, packages) already declares `"license": "AGPL-3.0-only"` (verified).
- AGPL §13 (network use): `SOURCE_CODE_URL` (optional, `https` only, default the upstream repository), public `GET /api/about` → `{ license, sourceCodeUrl }`, and a footer on every page (also before sign-in) with "Source code" linking there (falls back to upstream if the request fails).
- README "License" section; deployment table documents `SOURCE_CODE_URL` for operators of modified versions.

**Tests/checks:** config test (default, custom https URL, http/`javascript:`/garbage rejected), `about.test.ts` (public, no-store), e2e smoke test asserts the footer link before sign-in; `pnpm lint`, `pnpm typecheck`, `pnpm test`.

**Security docs updated:** N/A (no credentials or permissions involved).

**Remaining:** no per-file license headers (the root `LICENSE` plus package metadata cover the project); ~~third-party notices~~ collected into the web build since 10.4 (`/third-party-notices.txt`).

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
