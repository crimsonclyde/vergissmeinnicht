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

## 0 — Foundation and project rules

### 0.1 Repository documentation
**Status:** DONE

**Objective:** Establish the product strategy, agent rules, security rules, local-development documentation, deployment direction, and visual identity.

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
**Status:** TODO

**Objective:** Choose the smallest mature web stack that supports strong authentication, server-side authorization, SQLite, realtime collaboration, testing, and PWA-friendly responsive UI.

**Acceptance criteria:**
- framework/runtime/package manager documented;
- security/auth libraries selected based on active maintenance and established practice;
- database/migration library selected;
- realtime approach selected;
- rationale added to architecture documentation;
- no unnecessary distributed components.

**Security impact:** HIGH — authentication/session and dependency choices.

---

## 1 — Application foundation

### 1.1 Modular application skeleton
**Status:** TODO

**Objective:** Establish Presentation, Application, Domain, and Infrastructure boundaries.

**Acceptance criteria:**
- no raw DB access from UI components;
- domain code does not depend on UI or DB framework;
- test/lint/typecheck commands exist;
- CI can run them.

**Security impact:** MEDIUM — boundaries must keep authorization server-side.

### 1.2 Configuration and secret handling
**Status:** TODO

**Objective:** Establish safe environment/config handling.

**Acceptance criteria:**
- no real secrets in repository;
- safe example configuration only;
- startup fails safely for missing production secrets;
- logs redact security-sensitive values.

**Security impact:** CRITICAL.

---

## 2 — Identity and authentication

### 2.1 Internal User model
**Status:** TODO

**Objective:** Create stable internal User identity independent of login provider.

**Acceptance criteria:**
- opaque UUID;
- display name;
- normalized login/email identifiers;
- status and timestamps;
- architecture supports multiple linked authentication methods.

**Security impact:** CRITICAL.

### 2.2 Local password login
**Status:** TODO

**Objective:** Secure local username/email + password authentication.

**Acceptance criteria:**
- established auth/password library;
- Argon2id or reviewed equivalent;
- secure server-side sessions;
- secure cookie settings;
- session fixation prevention;
- login rate limiting;
- generic authentication errors;
- audit events for relevant account/security actions.

**Security impact:** CRITICAL.

### 2.3 TOTP MFA
**Status:** TODO

**Objective:** Optional TOTP second factor.

**Acceptance criteria:**
- cryptographically strong seed;
- enrollment must be verified before enabling;
- protected storage;
- recovery codes;
- recovery codes hashed;
- OTP attempt rate limiting;
- MFA session state cannot be bypassed;
- enable/disable/reset actions audited.

**Security impact:** CRITICAL.

### 2.4 External identity provider abstraction
**Status:** DEFERRED

**Objective:** Prepare for future Apple, GitHub, and Microsoft sign-in.

**Acceptance criteria when activated:**
- provider identities link to internal User UUID;
- explicit, safe account-linking rules;
- state/nonce/PKCE as required;
- provider tokens handled as secrets.

**Security impact:** CRITICAL.

---

## 3 — Workspaces and ACLs

### 3.1 Workspace and Membership
**Status:** TODO

**Objective:** Implement Workspace as the main collaboration/security boundary.

### 3.2 Roles and policies
**Status:** TODO

**Objective:** Implement Guest, User, Editor, Admin capabilities through centralized server-side policies.

**Required tests:** cross-Workspace denial and role escalation denial.

**Security impact:** CRITICAL.

---

## 4 — Procedure authoring

### 4.1 Procedure CRUD
**Status:** TODO

Create/edit/delete reusable Procedures with title, description, icon, tags, and UUID.

### 4.2 Sections and Steps
**Status:** TODO

Support ordered Sections and Steps with title, description, icon, required/optional behavior, critical confirmation behavior, and reason policy.

### 4.3 Drag and drop
**Status:** TODO

Reorder Sections/Steps while preserving stable identifiers.

### 4.4 Duplicate / JSON import-export
**Status:** TODO

Canonical JSON must include `schemaVersion`; imported data is untrusted and must be validated.

**Security impact:** HIGH for import parser/input validation.

---

## 5 — Run execution

### 5.1 Create immutable Run snapshot
**Status:** TODO

Starting a Procedure creates a historical Run snapshot independent of future Procedure changes/deletion.

### 5.2 Step state machine
**Status:** TODO

Implement:
- PENDING
- DONE
- SKIPPED
- NOT_APPLICABLE

with reason policies and undo.

### 5.3 Run lifecycle
**Status:** TODO

Implement:
- ACTIVE
- COMPLETED
- ABORTED

Required Steps must satisfy completion rules before completion.

### 5.4 Audit trail
**Status:** TODO

Every relevant mutation records actor User UUID, actor display name where appropriate, timestamp, event, reason/transition metadata.

**Security impact:** HIGH — integrity and attribution.

---

## 6 — Collaboration

### 6.1 Realtime active Run updates
**Status:** TODO

Multiple authorized users can work on one Run and see canonical updates quickly.

**Acceptance criteria:**
- server remains source of truth;
- reconnect refetches canonical state;
- revision/version supports missed/conflicting updates;
- remote changes expose actor/time where useful.

### 6.2 Optimistic UI
**Status:** TODO

Instant visual feedback with safe rollback on rejected writes.

---

## 7 — Knots / shared entry links

### 7.1 Authenticated Knot links
**Status:** TODO

Use:
`/knot/{opaque-token}`

Token is high entropy, revocable, optionally expiring, redacted from logs, and does not replace authentication.

**Security impact:** CRITICAL.

---

## 8 — UX and theming

### 8.1 Responsive authoring/execution
**Status:** TODO

Desktop-first creation; smartphone-first Run execution.

### 8.2 State presentation
**Status:** TODO

Pending, Done, Skipped, and Not Applicable use color plus icon/text semantics.

### 8.3 Theme system
**Status:** TODO

Semantic tokens with System, Light, Dark. Future named themes such as `Memento Mori` must not require business-component rewrites.

### 8.4 PWA/offline tolerance
**Status:** DEFERRED

Important eventual scenario: a Procedure may itself contain “turn off router/network”.

---

## 9 — Operations

### 9.1 Container image
**Status:** TODO

Single-instance self-hostable image with non-root runtime where practical and persistent SQLite volume.

### 9.2 Backup/restore
**Status:** TODO

Document consistent SQLite backup and tested restore.

### 9.3 Production hardening
**Status:** TODO

HTTPS, proxy trust, security headers, dependency scanning, health checks, safe secret injection.

**Security impact:** CRITICAL.

---

## Completion template

Agents should append/update task entries with:

**Status:** DONE  
**Completed:** YYYY-MM-DD  
**Implemented:** short factual summary  
**Tests/checks:** commands or checks performed  
**Security impact:** NONE / LOW / MEDIUM / HIGH / CRITICAL  
**Security docs updated:** YES / NO / N/A  
**Remaining:** any known follow-up
