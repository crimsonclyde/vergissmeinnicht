# Journal module

This is a bundled feature module in the modular monolith. It does not load third-party code at runtime.

- `packages/domain/src/journal/index.ts`: versioned, bounded content contract and `JOURNAL_TYPES` registry.
- `packages/application/src/journal/index.ts`: authorization, owner/Workspace scope, use cases and repository port.
- `packages/database/src/journal/repository.ts`: scoped persistence, transaction-time permission rechecks, revisions and value-free audit.
- `apps/server/src/http/journal-routes.ts`: explicit authenticated HTTP registrations, strict request bounds and normal CSRF protection.
- This directory: list/editor and `ENTRY_RENDERERS`, the presentation registry for entry types.

Start with `note` version 1: title, civil entry date and plain text. New entry types need an explicit domain parser/contract and renderer; if the persisted contract changes, ship a schema migration and backup compatibility tests. Reuse the existing scope, authorization, revision, audit and HTTP boundaries. Adding a type does not require rewriting navigation, authentication, Runs, Procedures or unrelated tools. Register only reviewed built-in code; never interpret content as markup, a module path, SQL or executable code.

Private entries are account-owned and kept in `private_journal_entries`; shared entries live in `journal_entries`. Scope/ownership/kind/version/creation identity cannot change in place. Do not add a private-to-shared conversion without an explicit product/privacy decision. Workspace exports include only the shared table; private entries remain present in full server backups. Shared records restore with historical identity attribution. Disabling the Workspace tool preserves shared entries; the private account journal is independent.

The first version has explicit Save, 30-entry pages, bounded title/body/search, a 1,000-entry limit per scope, search, stale-write conflicts and reversible archive. No autosave, offline drafts, attachments, rich text, notifications or permanent-delete endpoint. New navigation prompts before leaving unsaved changes; reload/closing uses the browser's standard warning. A failed save leaves the editor text in memory.
