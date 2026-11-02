# Notes, personal Journal and shared attachments

Architectural assessment, 2026-11-02. Status: **owner approved implementation; delivered foundations and integration**.
Source: owner's Journal/Notes/Markdown proposal and additional image-preservation requirements.
The owner additionally requested separation of the uploader for future reuse.

## Recommendation

Create a feature-independent attachment subsystem in the modular monolith. Separate upload transport,
attachment application rules, file storage and feature authorization. Reuse proven Documents primitives
through explicit ports; do not make other tools call Documents routes or require its tool switch.
Preserve existing Documents APIs, files, limits, OCR and recovery. Journal and Notes are the first new
consumers. No new storage service, remote processing or physical deduplication is needed initially.

Release 42 is released, not a future milestone. Keep its Guide menu, explicit classic fallback,
focused editing, themes, personal ordering and tool gates. Current owner count is 43; the next release
would be 44. This assessment does not prepare or authorize publication/deployment.

## Existing implementation assessment

| Area | Current behavior and evidence | Consequence |
| --- | --- | --- |
| Document originals | `packages/application/src/documents/files.ts`, `packages/media/src/document-file-store.ts`: streamed staging, SHA-256 while receiving, immutable committed bytes; original download separate from derivatives | Strong foundation for the new service; keep byte preservation |
| Document policy | `packages/domain/src/document-file.ts`: decimal 50 MB default, server-admin 1–100 MB; PDF/JPEG/PNG/HEIC allowlist, which admins may narrow | Do not replace with the new 20 MB image setting |
| Document processing | `packages/media/src/document-file-processor.ts`: signature/parser validation, markup rejection, 50 MP limit; 2400 px preview, 400 px thumbnail; HEIC download-only pending decoder review | Share validation/processing primitives behind category policies, not the Documents domain contract |
| Upload transport | `apps/server/src/http/document-file-routes.ts`: octet-stream, filename header, streamed receive, bounded discard on refusal; application limit enforced during staging; three uploads/person concurrently in the use case | Extract reusable transport/staging pieces, retain authorization before accepting bytes and after asynchronous work |
| Workspace accounting | `packages/database/src/storage-usage.ts`, `packages/domain/src/storage.ts`: 5 GB default combined Workspace limit; originals, previews, OCR/corrections, Trash and Run-retained files count; identical hashes charged once per Workspace | Retain existing semantics; new per-user logical accounting must be a separate policy |
| Existing physical reuse | Document store already stores identical hashes once; immutable image store also uses hashes | Do not remove legacy reuse or accidentally enable it for new private attachments |
| Other images | `packages/media/src/image-processor.ts`, `packages/domain/src/media.ts`: 10 MB input; Procedure image stored as a metadata-free JPEG up to 500 KB; avatars/Places also keep processed output | These paths cannot supply originals that were previously discarded; leave them intact initially |
| Journal | `packages/domain/src/journal/index.ts`, `packages/database/src/journal/repository.ts`, `apps/web/src/modules/journal/README.md`: separate shared/private tables, mandatory civil date, plain text, explicit Save, optimistic revision conflicts, archive, 1,000-entry scope bound | Preserve existing text as text, dates, scope, authorship and archive state; a revision counter is not revision history |
| Journal privacy | `/api/account/journal` derives owner from session; shared JOURNAL tool requires membership and gate; USER/EDITOR/ADMIN manage, GUEST reads | Server-admin status confers no application bypass into personal entries |
| Backups | `packages/database/src/backup.ts`: full-server database/files; `workspace-backup-tables.ts` explicitly exports shared Journal and excludes private Journal; Document originals included, Workspace derivatives regenerated | Extend both recovery paths deliberately; never infer export scope from physical files |
| Restore | `packages/database/src/workspace-restore.ts`: migration-level validation, explicit id classification, fresh ids, historical identities, hostile-package checks, atomic new Workspace | New tables, optional dates/content versions and attachment references need older-package upgrade logic |
| UI | React 19/Vite, plain textarea Journal; `AppShell.tsx` Add capabilities currently cover Procedure/Reminder/List/Document; shared Journal navigable and private Journal in Profile | Reuse shell/menu infrastructure; add explicit scope labels without another permanent sidebar |

This is a source audit and focused baseline, not a load test or certification of every existing parser.
The current photo pathways intentionally discard originals; the new preservation contract must never
claim otherwise for legacy files.

## Shared service and storage boundaries

Proposed boundaries follow existing Presentation → Application → Domain → Infrastructure layers:

1. **HTTP upload adapter:** session/CSRF/rate limits, bounded stream, aborts and transport errors.
   Receives a server-resolved category/target, not a client-controlled permission or storage path.
2. **Attachment application service:** authorizes consumer operations, selects policy, reserves quota,
   stages/validates bytes, registers immutable originals and derivatives, manages references and cleanup.
3. **Domain policy:** allowed formats, category limits, accounting and lifecycle invariants; no Fastify,
   filesystem, SQLite, editor or Documents dependency.
4. **Consumer policy adapters:** reviewed bundled handlers for `authorizeUpload`, `authorizeRead`,
   `authorizeAttach`, `authorizeDetach` and retention. Recheck current user/member/tool and revision
   inside mutations. No arbitrary callbacks or plugin code accepted from a request.
5. **Storage port:** opaque keys and streaming `stage`, `commit`, `open`, `stat`, `delete` operations,
   explicit integrity/durability/error contract. Local adapter initially. No filesystem path escapes
   the adapter; workers receive controlled local staging handles, not a required domain pathname.
   A later object-store adapter can stage locally for processors; no S3 dependency now.
6. **Processor port:** inspect original and derive inert previews with bounded resources. No permission
   to overwrite an original. Background work uses persisted state and the existing in-process pattern.

Suggested module homes: domain `attachments`, application `attachments` and ports, database attachment
repositories, media storage/processing adapters, server HTTP adapter, web shared uploader and editor.
Keep generic byte handling separate from Documents-specific PDF/OCR/page logic. Extract only what is
actually used, with characterization tests; avoid a universal plugin engine or speculative backend.

Documents remains a consumer of its existing contracts initially. Its adapters may delegate to extracted
low-level code after parity tests, while routes, schema, hash store and policy stay compatible. New
attachments use random physical object keys, not hash-based coalescing. A narrow legacy adapter can
access old stores; it must not make the new service dependent on Documents authorization.

## Identity, scope and reference lifecycle

Proposed records (names illustrative, not migration specifications):

- `attachments`: random UUID, exactly one scope (account owner or Workspace), uploader attribution,
  category, original filename as bounded data, claimed MIME as untrusted metadata, detected type and
  server-selected MIME, original bytes, private storage key, SHA-256, timestamps and lifecycle state.
- `attachment_derivatives`: attachment id, kind, recipe/version, dimensions, byte size, independent
  object key/hash and generation state. The original key/hash/bytes cannot be updated by processing.
- `attachment_references`: typed consumer target and revision, attachment id and matching immutable
  scope. Use explicit validated foreign-key target relations, not unchecked polymorphic ids.
- Separate quota settings/overrides and durable upload reservations. SQL checks backstop scope,
  nonnegative sizes, valid states and immutable ownership; foreign keys enforce known targets.

Every original/preview/download/list/reuse/export request checks the consuming record's current
authorization. An attachment id, hash, reference or preview URL grants no access. A provisional upload
is visible only to its uploader under the originating scope and gate. A committed upload is not readable
merely because the requester uploaded it once; live target permissions still apply.

Initial reuse is within the same account-private scope or the same Workspace and supported category,
with source-read and destination-write checks. No reference from Workspace content to a private Journal
attachment, no cross-Workspace reference, and no private-to-shared scope mutation. Any future explicit
copy operation would create separately owned objects after a separate privacy decision.

References from current content, saved revisions and archived content keep bytes alive. Removing an
image from the editor removes a current reference only after save; historical references remain.
Replacement creates a new attachment/reference rather than overwriting original bytes. Proposed unused
upload grace is the existing 24 hours. Archived entries retain attachments indefinitely under current
archive semantics; no new permanent-delete endpoint or revision expiry is implied.

Cleanup first marks an unreferenced record in a transaction, forbids new references to marked records,
then deletes bytes and finalizes accounting idempotently. Upload/cleanup leases prevent races. Failed
or cancelled staging is removed immediately where possible; crashes leave bounded, expiring staging
and reservation records reconciled on startup/housekeeping. Never delete an object that a live reference,
retained revision or protected backup snapshot still needs. Full-backup retention is independent of live
deletion, as today.

## Original preservation and previews

Drag/drop, paste and file selection send the original File/Blob bytes. Do not use the older browser
photo-reencoding helper. A clipboard image's original is the blob actually supplied by the clipboard;
do not claim to recover an earlier camera file or metadata the clipboard already discarded.

Stream-count and SHA-256 hash the exact uploaded bytes. Validate without modifying them; atomically
commit the original before publishing its ready row. Refuse SVG/HTML/executables, active or malformed
payloads and unsupported formats. Initial new-category allowlist recommendation: JPEG and PNG,
matching proven Document decoding. WebP requires extending and testing the shared validator; HEIC
remains subject to the existing decoder/licensing decision. Never transcode a format just to admit it.
Admins may narrow only the compiled, reviewed allowlist.

Generate metadata-free raster preview/thumbnail objects independently using versioned recipes. Start
with the proven 50 MP header limit and 2400/400 px dimensions; cap encoded output bytes, decoded
dimensions, parallelism, pending queue length, elapsed processing time and memory. Sharp concurrency
limits alone are not a hard timeout: establish a cancellable worker boundary before exposing new
processing, verify it in the actual deployment image, and share a bounded resource budget with existing
processing. No external processor or browser-supplied trusted derivative.

Preview failure reports unavailable/retryable state; it cannot replace or corrupt a validated original.
Regeneration writes a new derivative object then swaps its row atomically. Downloads always offer the
unchanged original as an attachment with detected safe MIME, generated filename, no-store, nosniff and
existing sandbox headers. Inline previews use only authorized inert derivatives. Warn on shared uploads
that original metadata, including possible GPS information, is available to authorized members.

## Configurable quotas and accounting

All units are decimal, consistent with current Documents settings: MB = 1,000,000 bytes.

| Setting | Recommendation | Scope |
| --- | --- | --- |
| New image upload maximum | 20 MB | Journal/Notes image category only, server-admin configurable within a tested hard ceiling |
| Default image allowance | 500 MB | Per authenticated uploader, combined across new Journal/Notes images in all Workspaces |
| Individual override | Optional explicit byte allowance, including zero to stop new uploads | Server admin; absence inherits default |
| Types | JPEG/PNG initially; admin can narrow reviewed types | New image category, independent of Document formats |
| Server storage cap | Configurable absolute byte limit plus free-space floor; choose at installation from measured capacity | Aggregate managed live stores, retained derivatives, orphans and in-flight reservations; no arbitrary fixed default that reduces existing capacity |

Logical user usage is original bytes plus every retained derivative, once per logical attachment;
multiple references to that attachment do not charge again. Independently uploaded identical bytes do
charge separately. Archived content, revisions and provisional uploads count. Replacement/regeneration
reserves peak storage while old and new objects coexist; quotas are released only after actual cleanup.
Display originals, derivatives, reserved, used and remaining; report which limit refused an upload.
Lowering a quota deletes nothing and never blocks reading/exporting existing content.

Workspace Notes attachments also count toward the existing Workspace combined limit, without changing
the calculation for legacy Documents. This is two admission constraints, not two physical copies.
Private Journal files never enter Workspace usage. The uploader is the proposed stable billing identity
for new live uploads; leaving a Workspace does not transfer ownership or erase shared attachments.
Workspace-authorized managers handle retention; quota overrides support exceptional cases. No ordinary
user's usage page reveals filenames or records in Workspaces they can no longer access.

Restored shared attachments count toward the restored Workspace and global cap, with a distinct
Workspace-recovery accounting bucket, not a historical identity, original uploader account or guessed
email match. Further uploads use normal user quotas. This exception needs approval with the plan and
explicit usage reporting; it prevents failed restores due to a new admin's 500 MB allowance.

Admission sequence: reserve bounded original/derivative headroom in an IMMEDIATE transaction; check
current user, scope, current policy, user quota, Workspace quota if applicable and global budget together.
Do not hold a database transaction open while receiving/decoding. Unknown-length input reserves the
maximum allowed size; streamed enforcement refuses excess regardless of Content-Length. Renew leases
while active; expired leases cannot commit. Recheck permissions, policy, byte counts, leases and quotas
in the commit transaction; audit and reference updates commit atomically. Apply the same reservation
protocol to derivative creation, import and restore. Concurrent limit changes cannot admit excess.

Reconcile global physical accounting against every managed store, including legacy files, staging and
orphans. Configure enforcement only after an administrator sees current usage; over-cap installations
remain readable and can reclaim storage. The global cap may intentionally stop new legacy uploads when
configured, but does not silently rewrite their per-file or Workspace limits. Backups/temp exports need
separate disk headroom and bounded admission; backups are not charged repeatedly to a user's quota.
Document hard-link accounting and copy fallbacks in the capacity report. A configured cap and disk
free-space check are complementary; unmanaged filesystem growth can still exhaust a volume.

Use existing Server & storage administration for defaults, individual overrides and aggregates. Display
usage by user/category and largest consumers, not private filenames, hashes, entry ids/titles, thumbnails
or references. No new admin content browser. Server admins retain technical access to unencrypted disk
and full backups, but no private Journal API bypass. Audit configuration changes without content.

## Markdown editor assessment

Recommend a **Milkdown-based proof of compatibility**, behind one VMN editor interface, before selecting
a pinned release. Its CommonMark and GFM presets fit Markdown as canonical storage. The application
must still implement menus, source switching, persistence, attachment handling and accessibility.
This is an architectural recommendation, not a claim of verified round trips or React 19 compatibility.

Alternatives: Tiptap has an official Markdown integration, currently labelled beta; Lexical provides
Markdown transformer APIs, requiring assessment of the requested GFM coverage. Neither alternative
eliminates preservation testing. No cloud conversion or collaboration service is needed.

Official sources reviewed on 2026-11-02:

- [Milkdown getting started](https://milkdown.dev/docs/guide/getting-started)
- [Milkdown Kit: CommonMark and GFM presets](https://milkdown.dev/docs/guide/using-milkdown-kit)
- [Tiptap Markdown](https://tiptap.dev/docs/editor/markdown)
- [Lexical Markdown transformers](https://lexicaljs.org/docs/packages/lexical-markdown)

Gate selection on license/advisory/maintenance review, React/Vite integration, bundle and mobile memory,
keyboard/screen-reader operation, all theme contrast and an executable round-trip corpus. Cover H1–H6,
marks, ordered/unordered/task lists, table cell escaping/alignment, quotes/rules, links/reference
definitions, inline/fenced code with language, images/alt/title, Unicode and unknown extensions.

Store UTF-8 CommonMark+GFM, never editor JSON/HTML as the sole persistent representation. Keep the
exact source until an explicit edit; preserve unsupported nodes as opaque source or stay in source
mode with a clear explanation. Do not silently serialize away unknown syntax, raw HTML or reference
definitions. Raw HTML remains non-executing. Use a safe AST renderer, allowlisted link protocols,
no remote-image fetch/proxy, no data/SVG images or dynamic code execution. Syntax highlighting loads
only bundled language support. Mermaid/math/callouts/footnotes/collapsible sections remain future work.

WYSIWYG default with source mode, undo/redo, shortcuts/slash commands, visual GFM table editing,
interactive task lists, optional transient outline and deterministic heading anchors/derived TOC.
GFM has no standard TOC/caption block: generate the TOC as a view or ordinary Markdown links, and use
ordinary adjacent Markdown text for captions rather than hidden proprietary syntax.

## Notes, Journal, privacy and UI integration

Proposed **Notes is the existing shared Journal evolved and renamed in the UI**, avoiding two overlapping
Workspace libraries. Keep stored JOURNAL flag, existing API/route aliases and personal navigation order
working; do not activate tools on upgrade. Preserve shared records, attribution and existing links.
If the owner intends Notes as an additional tool, settle that before schema/navigation changes.

Preserve existing `journal.manage` policy: USER/EDITOR/ADMIN write; GUEST reads. The proposal's
“Workspace editors” is interpreted as holders of that existing capability, not a silent USER demotion.
Private Journal stays account-scoped and usable without a selected Workspace. Never search or offer it
through Workspace references, autocomplete or backlinks; ownership/scope cannot change in place.

Personal first access displays the exact requested notice:

> **Your personal Journal**
>
> Your Journal belongs to your personal account, not to a workspace. Other users cannot access your entries.
>
> Your entries are not encrypted and may be accessed by server administrators.
>
> **Agree & Continue**

Store acknowledgement version/timestamp per authenticated user; check it server-side before any new
Journal content/draft/revision/upload save. Existing entries remain stored and are never auto-accepted
or converted. Gate first access with the notice; no content writes or draft persistence before consent.
Re-acknowledge only on a material notice change. Do not add an administrator browsing feature.

Main Add (+): **Note — Workspace** when the active Workspace tool/capability permits it;
**Journal entry — Personal** for the active account, routed through acknowledgement. Personal user menu
also links Journal; Notes has its Workspace library. Preserve Guide and classic fallback paths. Focused
editor has a generous writing area, compact toolbar, visual/source switch, image insertion/management,
scope label, explicit save state and optional outline, with no permanent sidebar.

Add optional dates, collections/notebooks, tags, pinning, recent lists and scoped full-text search in
separate increments with bounded inputs/pagination. Start with existing SQLite scoped search; assess
whether FTS is justified with fixtures before changing indexes. No external search service. Add true
immutable revision snapshots and stale-write handling, including task-list toggles. Autosave must only
show Saved after server acknowledgement; conflicts must not overwrite either version. Explicit Save
remains available. Prefer server-side recoverable drafts initially, account/scope authorized and gated
by consent, with no persistent browser cache of private content. Offline drafts would require a later
explicit device-storage/privacy policy and cleanup tests; existing offline Runs/Lists remain unchanged.

## Portable references, exports and imports

Proposed canonical Markdown attachment destination: relative `attachments/<attachment-uuid>.<ext>`.
Resolve it through the scoped reference table, never by path access or a public static directory.
Parse Markdown structurally when exporting/restoring; do not regex-replace matching text in code blocks.
Internal record links use a documented app-reference form with readable labels; resolve only accessible
targets. On export resolve included records to relative files; preserve other labels/reference ids
without fetching or disclosing hidden targets. No automatic network lookup on paste/import.

Individual content exports as `.md` when self-contained, otherwise a ZIP; collections and Journal archives
use a ZIP with a predictable structure:

```text
notes/                         # journal/ for a personal archive
  garden-<local-key>.md
  attachments/<local-key>.jpg
  metadata.json
```

UTF-8 Markdown uses portable relative image paths. Safe collision-proof archive names are generated,
not derived directly from titles or upload paths. Original image bytes/metadata are included; previews
are optional convenience only and never substitute for originals. Manifest version 1 records useful
title/date/tags/collection metadata, detected type, original filename, size and SHA-256; public format
documentation accompanies implementation. Optional simple YAML front matter is supported only with a
safe parser/bounds, never required and never executable. Ordinary Markdown remains readable without it.
Current content is the default export; an explicitly requested history archive includes referenced old
originals too. Exports recheck authorization and cannot follow private or foreign references.

Keep **portable export/import** separate from `.vmnbackup`. Personal archives never restore via Workspace
recovery. Workspace backups include shared Notes/revisions/references and their originals only; private
entries, drafts, notice acceptance, user quota overrides and private files are excluded. Full-server
backup/verify/restore includes all committed private/shared originals and requisite metadata. Document
derivatives continue to regenerate after Workspace restore. New attachment previews should also be
regenerated; originals must hash identically after either recovery path.

Investigate Markdown/ZIP import after exports stabilize. Limit accepted layouts; reject traversal,
absolute/Windows paths, links, duplicate/normalized-colliding names, encrypted archives, excessive entry
counts/sizes/ratios, malformed UTF-8 and missing/out-of-package references. Never fetch remote images.
Preview import and confirm exactly once, enforce destination capability/consent/quota, generate fresh
ids, validate every image and commit content/references atomically. No partial saved collection on
failure. Preserve unsupported syntax in source; do not silently drop it.

## Migration and compatibility

Use additive, versioned migrations after approval. Preserve private/shared separation and every existing
entry's literal text. Existing plain text containing Markdown punctuation must not acquire formatting
silently: retain an explicit legacy-text content version until the owner edits/converts it, with an
equivalent escaped Markdown export. Retain dates as optional values rather than erasing them.

Classify every new table for Workspace export/exclusion, every person/id/reference column for restore,
and every schema/content-version change for old packages. Extend restore validation and normalization,
not just `isRestorableLevel`. Rewrite attachment destinations only in parsed Markdown destinations to
new package/local ids. Pre-feature backups legitimately lack new data; current backups must include
required new files/rows. Preserve pre-0052 Journal compatibility and Release 42 migration-level packages.
Unsupported newer packages/databases remain refused without modification.

Quota reservations, temporary files and job leases are runtime state; full-server recovery reconciles
them before services start. Restores must preflight disk, verify hashes and enforce quota in the final
transaction. Keep historical identities attribution-only, no personal ownership, membership, awards,
notifications or implicit account matching. Retain all existing backup hostility and round-trip gates.
Do not migrate legacy Document files or discard their stored hashes to introduce the new subsystem.

## Deferred deduplication

Compute and retain SHA-256 on every new original and retained derivative from the first upload. Keep
hashes private: no “already exists” response, global hash lookup, timing shortcut or reduced quota
charge that reveals someone else's content. New objects remain physically independent initially;
legacy content-addressed stores retain their existing behavior.

Future administrator-only optimization may report physical versus logical bytes, duplicate candidates
and estimated savings without private content metadata. Introduce a separate immutable blob identity
and transactional logical-reference mapping only after measured benefit, crash/concurrency analysis and
privacy review. Each attachment's scope, original metadata, ownership, authorization, quota and lifecycle
stay independent even if physical bytes later share storage. Live/retained/backup references and active
upload leases prevent premature removal; reference counts require transactional maintenance plus
reconciliation, not a standalone counter. Opt-in, reversible migration and integrity checks are gates.
No physical deduplication or admin optimization screen is part of the initial delivery.

## Phases and acceptance gates

| Phase | Work | Exit gate |
| --- | --- | --- |
| 0 — assessment | This source audit, proposed contracts/policies and compatibility plan | Owner approval, including Notes rename, role interpretation, billing/recovery policy and cap setup |
| 1 — shared foundation | Extract tested byte transport/storage primitives, define service/consumer ports, separate metadata/references, preserve originals and generate bounded derivatives | Byte/hash/EXIF fidelity, independent regeneration, authorized reference lifecycle, unchanged Documents/legacy API tests |
| 2 — quotas and integrity | Durable reservations, 20 MB/500 MB defaults, overrides, global cap/free-space admission, usage UI/admin aggregates; hashes already computed in phase 1 | Concurrent uploads/derivatives/imports cannot exceed limits; cleanup/crash reconciliation; no private metadata in admin responses |
| 3 — recovery foundation | Full-server originals, versioned Workspace schema/restore extension and portable attachment path contract | Old/current hostile backups, private exclusions, byte-identical restore and normalized round trip |
| 4 — shared editor | Milkdown compatibility spike; shared editor/renderer, source preservation and export codec | Required CommonMark/GFM corpus, unknown syntax preservation, no script/network execution, accessible mobile/theme behavior |
| 5 — Notes and Journal | Privacy acknowledgement, Notes evolution, optional dates, Add/user-menu integration, revisions/drafts/autosave then organization | No pre-consent write, private isolation, scoped search, conflict recovery, no false save state; Guide/classic/tool/offline regressions |
| 6 — portability/integrations | Single/collection exports; bounded confirmed import after format stabilizes; permission-aware @ references/backlinks | Readable external Markdown/images; hostile archive negatives; no private/foreign target discovery |
| Later | Assess legacy upload migrations and optional physical deduplication/admin optimization | Measured benefit and separate reviewed migration/security plan |

Security and recovery work are part of every phase, before enabling a consumer. Hashes belong in the
initial upload pipeline even though storage optimization comes later. Other tools gain infrastructure
seams only: this does not authorize new Procedure/Reminder/Maintenance/Contact attachment fields.

## Security and regression strategy

Required new negatives are tracked as **planned, unchecked** in `security.md` section 35. In particular:
guest writes; foreign/disabled ids and previews; private scope forgery; revoked membership/tool/consent
between upload and commit; hidden records via picker/search/backlinks; raw HTML/URL attacks; size without
Content-Length; animation/pixel/decode/queue bombs; concurrent quota/range changes; revision references
versus deletion; rollback on audit failure; failed-stage cleanup and restart leases; guessed hashes;
backup leakage, malicious imports and old-package upgrades. Include SQL invariant and HTTP route sweeps.

Existing baseline performed for this assessment:

```sh
pnpm exec vitest run packages/media/src/document-file-store.test.ts packages/media/src/document-file-processor.test.ts packages/database/src/storage-use-cases.test.ts packages/database/src/workspace-backup-tables.test.ts apps/server/src/http/journal.test.ts --maxWorkers=2
```

Result: **5 files, 45 tests passed** (2026-11-02). This verifies existing behavior only. No new service,
editor, quota, preservation migration or backup extension is implemented/tested yet. Future changes
require matching unit/integration/negative tests, populated old-version upgrades and recovery, lint,
typecheck/build, contrast and browser/mobile Guide/classic checks. Physical device and screen-reader
validation remain distinct from automated evidence.

## Implementation status (2026-11-02)

Owner approved proceeding after this assessment. Phases 1–5 and the export/linking parts of phase 6 are implemented with shared Notes and
personal Journal, portable exports, the separate uploader, exact originals/independent derivatives,
configurable quotas, hashes, revisions/drafts and backup upgrades. The original audit below describes
the pre-change baseline; current architecture and behavior are in architecture.md and the user guide.

Initial image policy is JPEG/PNG, 20 MB/file and 500 MB/person (decimal), configurable with individual
overrides. Original plus retained preview/thumbnail bytes count once per logical attachment; separate
uploads count separately even if hashes match. Workspace shared files also use existing Workspace
allowance. Restored shared files charge Workspace/global storage and retain historical attribution,
without charging an imported account. A global cap is optional, counts managed image/document/media
objects plus durable attachment reservations, and does not silently replace legacy Documents limits.
It excludes database/WAL, export/restore archives and independent backup copies; monitor physical disk
and provision staging/backup headroom. Restore validates staged data under existing archive/free-space
limits and checks the final managed cap atomically, rather than leasing all extraction disk capacity.

One author-only recoverable draft slot per library is explicit; source beyond supported syntax remains
in source mode. Regeneration can repair the stored derivative recipe without changing its hash or
original; new recipes require a reviewed migration. Imports, comprehensive backlinks/broken-reference
management, additional syntax/formats and physical deduplication remain investigated/deferred.
No release, live deployment or physical device/screen-reader certification is part of this change.

Editor dependency review: Milkdown Crepe/Kit 7.23.0, react-markdown 10.1.0 and remark-gfm 4.0.1 are
MIT licensed. Versions are pinned. CodeMirror/Lezer and mdast/micromark provide local parsing and
highlighting. No remote stylesheet/font/script loads are required. AI and math execution are disabled;
the unused KaTeX dependency is still patched. Production advisory audit is clean. The production build
reports large editor/language chunks; lazy loading contains their startup cost, but a low-memory physical
phone performance assessment remains future validation rather than a claim of this browser suite.
