# Gamification

One bundled module serves every tool. Workspace admins enable `GAMIFICATION` through the existing Plugins settings; new Workspaces start off, migration 0058 preserves existing behavior by enabling existing Workspaces. Private Journal uses the account's separate `privateGamification` preference (on by default, matching prior behavior). Neither switch changes permissions, operational progress indicators, stored history or earned points.

## Add a celebration

Add one trusted entry to `CELEBRATION_STYLES` in `celebrations.tsx`: an ephemeral unique id, optional display name and a `render()` function. Selection is uniform across entries. The provider handles server confirmation, scope, dismissal and timeout. Styles contain presentation only: no requests, points, tracking, storage or authorization. Character art is local, transparent WebP; metadata/provenance is in `../../companions/ARTWORK.md`. New non-name text belongs in the i18n catalog.

Use semantic color tokens and keep the status/dismiss control readable in all themes. Decoration must not intercept pointer events, move focus or cause sideways scrolling. Stop motion under `prefers-reduced-motion`; hide purely decorative particles under forced colors. No downloaded code or user-selected renderer. Extend the browser's deterministic-style coverage for a new rendering behavior.

## Add a rewarding action

Extend the fixed `progressPoints` policy in the domain, then call `awardProgress` inside the already-authorized mutation/audit transaction with an explicit Workspace or private-account scope. Most tools already use `recordAuditEvent`; Lists and Journal have dedicated guarded hooks. Never award from a renderer, a client request, a restore/import, or a successful HTTP response alone. Add authorization, disabled-switch, replay/deduplication and rollback tests for a new action.

The ledger still holds only hashed logical-action keys, owner, bounded points and server time. Disabled/capped actions consume zero-point deduplication marks so later undo/re-completion or re-enabling cannot reward old actions. No content or plain source/Workspace id is added. Lifetime totals and marks are excluded from Workspace backups; the shared Workspace flag is included. Full server backups retain all of them.

`ProgressProvider` listens to successful mutation paths, refreshes the own-account aggregate and current canonical Workspace flag, and celebrates only a positive server-total difference after a mutation in the displayed scope. Initial load, focus, polling and scope changes never celebrate old progress. Failed gate reads suppress decorations. Equipment has no special local cheer, and guided Runs retain their normal confirmed-state navigation without separate cheers, confetti or vibration.
