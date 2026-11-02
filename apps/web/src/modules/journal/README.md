# Notes and Journal module

Bundled code in the modular monolith. Stored `JOURNAL` remains the optional shared Workspace gate;
its UI label is Notes. Private Journal stays account-owned and independent of Workspace selection.
Legacy routes/order/tool choices survive. Native Guide and classic fallback are both supported.

Version 1 remains literal legacy text; version 2 is UTF-8 CommonMark/GFM with nullable date, collection,
tags and pinning. `parseJournalContent` validates both. Convert is explicit. Never interpret old text
as Markdown automatically or drop unsupported source. The shared Milkdown adapter captures canonical
transactions synchronously, uses native checklist semantics and theme-token highlighting, and retains
source mode after image insertion. No remote image/service/AI/math execution is enabled.

Application/database writes recheck ACTIVE actor, owner or current Workspace tool/capability and
expected revision. Personal writes additionally require per-user/version privacy acknowledgement.
Private tables, drafts and attachment references are excluded from Workspace backups; no admin API
bypass, scope conversion or private Workspace picker/backlink exists. Events contain no entry content
or private identifiers. Private API paths are redacted in request logs.

Drafts are author-only server recovery, one slot per account per library; existing recovery requires
an explicit choice, and a different entry cannot silently replace that slot. They are not offline
browser storage or published entries. Explicit Save remains; autosave is opt-in. Immutable revisions
retain attachment references and conflicts preserve current editor text. Bounds: 1,000 entries per
scope, 50,000 body characters and 1,000 revisions per entry.

`attachments` application ports/HTTP transport/media storage and processors are feature-independent.
The reviewed `journalAttachmentPolicy` adapter supplies write guards and reference visibility; a stored
immutable policy key prevents another future consumer from reading these files with a weaker gate.
The Journal adapter owns typed shared/private binding tables and validates same-scope accessible ids.
Original and derivative keys are separate, quota admission uses durable reservations, and hashes are
private integrity facts. Other features require their own registered authorization and lifecycle
adapters; new permissions or cross-scope sharing do not follow from uploader reuse.

Exports are readable Markdown/ZIP plus original image bytes and metadata. AST-based remapping changes
real destinations only, preserving code and unknown text. Workspace recovery classifies all tables,
remaps fresh ids and excludes private content. Supported older packages upgrade explicitly. Physical
deduplication, portable import, broader backlinks and additional syntax stay deferred.
