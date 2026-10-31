# Release 42 — implementation plan for review

**Prepared:** 2026-10-31. **Status:** planning only; no production implementation authorized. This plan follows the [full interactive prototype](full-guide-prototype.md) and [read-only readiness audit](readiness-audit.md). The owner chose Constellation and requested a full prototype first. “Continue” resumes that preparation; it does not override the earlier instruction not to implement or publish.

Owner-counted release **41** is published; the next is the special **42nd**. Its final treatment, semantic version and publication remain undecided. A prototype is evidence for design review, not release readiness.

## Accepted design and proposed implementation choices

The accepted direction is a one-column, image-led galactic Guide inspired by *The Hitchhiker’s Guide to the Galaxy*, with recognizable everyday objects inside translucent cards. Keep the fireplace, supermarket and Tesla-coil meanings; Water plants remains a Reminder and Power remains an Equipment illustration. Remove visible DON'T PANIC/42 branding. Put navigation, time and compact weather at the top; pressing time/weather opens the larger view. Future users can change card backgrounds and translucency in theme settings. Existing themes should continue to work. Production implementation remains a separate decision.

The concrete storage model, route names, default opacity, rollout mechanism and final navigation structure below are **proposals**, not newly accepted requirements. The prototype's Glass/Starfield controls and 50% starting value do not change real user preferences. The old approved PNG is preserved byte-for-byte; later owner feedback governs the newer prototype.

## Work packages and exit evidence

| Package | Proposed change after implementation authorization | Exit evidence |
| --- | --- | --- |
| 1. Shared destination model | Derive both shells and the Guide from existing `navigation.ts` and current enabled tools/personal order. Keep existing route addresses and ordinary links. Introduce no cross-tool search or generic mutation API. | Route/action inventory; deep links, Back/Forward, keyboard/focus and all-tools-off walkthrough. |
| 2. Theme-independent shell | Add the top layout over existing screens, with labelled Guide disclosure, Workspace selector and reachable account/Workspace settings. Keep focused editing guards and Back; do not copy the standalone HTML into the app. | Desktop/phone/reflow review across themes, including focused Run/builder and unsaved-work cases. |
| 3. Optional Space presentation | Add a reviewed theme identifier across domain/API/database allowlists, first paint and theme selectors. Bundle optimized original artwork with neutral missing-image fallback. Keep semantic tokens separate from decoration. | Migration/upgrade and old-client preference checks, theme contrast, image-failure and first-paint tests. |
| 4. Clock/weather presentation | Reuse existing clock formatting and forecast hook/data contract; replace the Today glance presentation only where selected. Preserve personal visibility, units and server/provider gates. Reuse existing account Weather details before proposing another route. | Visibility/no-request tests, cached/offline and provider-unavailable states, condition mapping and accessible labels. |
| 5. Card appearance | Add reviewed owner-only bounded preferences for the new card style/opacity. Reuse Places' validation principles without replacing its saved settings. Explicit Save/Cancel/reset; failure leaves saved appearance unchanged. | Persistence/isolation/invalid-value tests, backup exclusion, account-switch cleanup and contrast at opacity endpoints. |
| 6. Tool and execution parity | Apply the presentation to existing tools and Run screens incrementally, preserving commands and history. Keep file/security/recovery flows on working screens while their visual parity is checked. | Capability/state coverage below; canonical-save/conflict/Undo and offline regression evidence. |
| 7. Reversible rollout | Make the existing shell available during a separately approved rollout, independent of theme. Both shells use identical routes/providers/data stores. | Switching without losing drafts/queues/preferences; error recovery and deployment fallback rehearsal. |

Each package should remain independently reviewable. Do not couple a new background to a backend rewrite, new infrastructure, broader API response, provider call or upload path. Completion of one package is not permission to publish the 42nd release.

## Navigation decisions to resolve before package 1

The prototype's Today/Continue/Guide row is a design study. Existing personal order puts Today first and all enabled tools in the person's order; the phone bar has the first two enabled personal choices and More last. The latest top-menu preference changes placement but does not by itself approve removing those shortcuts or replacing their semantics.

Proposed production mapping: put the existing personal shortcuts in the top area, make the Guide disclosure expose all enabled destinations in saved order, and show Continue only when an authorized active Run exists. Final labels and the phone More/Guide relationship need owner review against the prototype. An implementation must not silently replace the saved order with the prototype's fixed list.

Workspace selection, account/Profile/security/sign-out, Workspace settings/members/plugins, completed history and Trash must remain directly discoverable. Private Journal stays under account scope. Moon remains a Today card and Gamification is never a tool destination. No tool disabled in the Workspace appears in navigation or leaks a title/count via a shortcut.

## Complete behavior coverage

| Surface | Required preserved behavior and states |
| --- | --- |
| Today | Personal visibility/order/size/density; Attention, Continue, Next, Lists, Bring, Maintenance, recent accomplishments, progress, Calendar and Moon. Distinguish loading, genuine empty, all-tools-off and failure. The prototype's four sample cards do not cap production content. |
| Procedures and Run | Authoring, stable Step ids, instruction images, Required/Critical, distinct Pending/Done/Skipped/Not Applicable, reasons/confirmation preferences, Undo, actor/time, Complete/Abort, immutable snapshots and retained Documents. Never claim queued/failed writes are server-saved. |
| Reminders/Calendar | Source-aware tool gates, Occurrence status, assignments, projected dates, Schedule time zones and keyboard month/agenda navigation. No automatic Run creation, hourly scheduling feature or external sync. |
| Lists/Bring | Existing edit roles, List quantities/units, purchase Undo and offline List queue; Bring revisions, relevance and direct-delete Undo. Bring gains no offline writes or inventory semantics. |
| Documents/Contacts | Existing upload/type/size limits, originals/previews, folders, search, Links, imports/exports and Trash. No generated record imagery, completion photos or new upload route. |
| Maintenance/Equipment | Four fixed Maintenance statuses, existing costs without totals, linked records, Equipment compatible parts/details; no monitoring, automatic payment or utility data model. |
| Journal | Explicit Save, search/archive, immutable scope and separate shared/private entry collections; no Workspace/server-admin override of private entries. |
| Account/administration | Login/TOTP/recovery, session expiry, invitations, membership changes, backups/restore, credentials and source/license offer remain available through existing authorized flows. Decorative simplification must not remove confirmation/error information. |
| Cross-cutting | Guest read-only controls, foreign/disabled resources, revoked membership, stale revisions, slow/failed requests, reconnect/refetch, account/Workspace switching and unsaved navigation. No gesture-only or hover-only operation. |

## Clock and weather contract

`TodayClock.tsx` already formats the current minute, handles visibility changes and respects saved 12/24-hour presentation. Retain full date/time for assistive technology without announcing every minute. The header changes placement, not Schedule time zones. Preserve Witch Forest's detailed sundial presentation where appropriate.

`TodayWeather.tsx` currently fetches only when wanted, keys cached data by account/Workspace, accepts a recent offline fixture only on network failure and suppresses unshowable data. Preserve those boundaries. Never fetch merely because the new header exists. Personal opt-out/server-off/no location yields no forecast control; setup remains reachable through Profile. A weather request in flight when switching scope must not display the old scope's answer.

The main control displays the provider's condition icon and temperature in the person's unit. Its accessible name includes the written condition and relevant freshness, rather than relying on an icon. Support every existing condition, including unknown/missing data; Sun/Fog/Rain/Snow are review examples, not an exhaustive enum. Stale data must be distinguishable without opening details (a compact badge/accessibility text is sufficient). The larger view retains location, source/model attribution, age/fallback and supported forecast fields; do not invent the prototype's four-day forecast when a provider has fewer days. Expanded-view route/disclosure semantics and restoration of focus/Back require implementation review.

## Appearance compatibility and storage proposal

| Existing choice | Compatibility gate |
| --- | --- |
| System/Light/Memento Mori | Same actions/layout/hierarchy, restrained everyday art; retain stored `dark` alias and System resolution. No automatic rewriting of saved ids. |
| Tokyo Nights/Witch Forest | Keep their own scenes, readable surface tokens and established motion/clock behavior; no forced Space cutouts. Reduced motion/forced colors take priority. |
| Munich/Triora/London/Scotland | Preserve `user_place_preferences`, per-person/per-Workspace backgrounds/focal points and saved `cardOpacity`. Existing missing opacity defaults to 100; the prototype's 50 is not an upgrade default. |
| Personal photo/No image | Reuse existing authorized photo path only; no new background upload. No image hides decorative scene/card artwork while keeping every control and status. |
| New optional Space | Explicit opt-in; no reassignment of existing themes. Glass/Starfield are bundled presentation choices, not remote URLs or custom CSS. |

Propose a small versioned account-owned presentation record for the new shell, with fixed enums and integer opacity 0–100. Review account-wide defaults versus per-Workspace overrides before choosing its schema; changing a shared Workspace setting is not approved. Keep existing Places settings authoritative within Places. Do not silently copy settings between users, Workspaces or themes.

Before persistence, specify strict API/body limits, SQL validation/migration, missing-field defaults, old-client partial-update behavior and own-account-only access. Preferences stay outside Workspace backups; logout/account switch clears local mirrors and in-flight updates. The server accepts values, never CSS/URLs/HTML. Update `security.md` and negative tests with that implementation. No such record or route is added by this plan.

Opacity changes background paint only. Text, focus rings and controls stay opaque; a protected caption/backing must pass contrast over the brightest/darkest bundled art at 0, intermediate and 100%. Forced colors uses solid system surfaces. A transparent preview cannot stand in for a contrast proof over arbitrary photos.

## Accessibility, assets and fallback gates

Keep semantic landmarks, visible labels, logical DOM/tab order, 44 × 44 px touch targets and no horizontal overflow from 320 px. Check 200% text/400% zoom, safe areas, phone keyboard, keyboard-only Guide open/close, Escape and focus return. Focused editing retains Back/unsaved guards. Reduced motion stops atmosphere/transitions; hidden pages pause nonessential work. Validate with screen readers and physical iOS/Android before release readiness.

Proposed asset budgets for review: no external runtime assets/fonts/scripts; lazy-load nonvisible tool illustrations; at most 500 KB compressed decorative transfer on initial phone Today, at most 150 KB per tool illustration and 350 KB per responsive background. Do not preload every Guide image. Measure total transfer, decode cost and scrolling on a modest phone; adjust artwork before raising a budget. The exact 2.27 MB reference PNG is documentation only. The prototype's CDN runtime and inline assets must not enter production or weaken CSP. Record final asset provenance and approved usage before release.

The fallback is a presentation choice, not a database downgrade or second app. It must stay accessible without Space artwork loading, preserve browser addresses, and use the same canonical providers and offline stores. Do not reload while a draft/queued write might be lost. Deployment fallback must retain additive schema compatibility and documented backup/restore procedures; never operate an old server against a newer unsupported schema.

## Validation and readiness status

Current evidence: the existing prototype has its documented walkthrough and 20 axe scans from 2026-10-30. The 2026-10-31 preparation reruns focused existing theme/contrast/Today/Places/account-preference tests; results are recorded in ledger 34.6. These validate the baseline, not the proposed interface. No full production suite, new browser/device run, advisory scan or performance measurement is claimed by this plan.

After implementation authorization, each package needs focused regression checks, then the exact candidate must pass repository lint/typecheck/unit/browser, CSP, theme/contrast/reflow, role/tool isolation, offline replay/account cleanup, preference migration/upgrade and Workspace/server backup/restore. Run native amd64/arm64 smoke/security gates for a release candidate; publication remains a separate owner decision.

**Readiness:** the prototype is available for review and the incremental plan is concrete. Production remains pending final navigation/storage/fallback decisions, authorization, implementation and the evidence above. **Security surface changed by this task:** NO; security-policy update N/A. No application changes, migration, merge, tag, release or deployment.
