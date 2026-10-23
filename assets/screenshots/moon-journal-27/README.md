# Moon and Journal — section 27

Captured from the isolated fictional demo on 2026-10-23. No production data or credentials. Each image is a compressed WebP; the independently generated forest assets are the existing 25.3 art.

`checks.json` records 30 full-page checks: Moon on Today and the shared Journal editor, Light/Dark/Memento Mori/Tokyo Nights/Witch Forest, at 320/390/1440 px. Final results have zero horizontal overflow, axe violations or page errors. The initial Dark screenshot review found the existing Today eyebrow below contrast; the semantic-token correction was rechecked and Dark captures/results replaced. Navigation pacing keeps the screenshot run below the normal API rate limit.

`moon-local-*` shows the shared fictional Triora location with calculated moonrise/moonset; `moon-card-*` is the matching card detail. `local-moon-checks.json` records three more viewport/accessibility checks and the calculated text at capture time; forced colours hides the decorative SVG. The local day can have no rise or set, and the UI handles that explicitly.

The full account Playwright flow verifies explicit journal Save, reload, escaped script-like text, archive/restore, private/shared separation and unsaved-edit navigation warnings. Read-only guest and other-user/admin negatives, transactional revocation and backup exclusions are covered in HTTP/database tests. Private journal entries are not real-user content and are never included in these shared-journal screenshots.

These are browser checks, not physical-device performance or screen-reader certification. Snapshot time is the real time of each capture. The demo is left in Witch Forest with Moon and Journal enabled so the owner can review them; no running production installation was modified.
