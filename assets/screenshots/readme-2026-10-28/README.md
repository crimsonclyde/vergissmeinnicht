# README gallery — 2026-10-28

These are screenshots of the running production build, not mock-ups. All records belong to **Northstar studio**, a fictional Workspace created in the isolated local `test-env` instance. No production database, real account, credential, user photo or personal document was used. The Documents pages are the repository's media-test PDF fixture; record names and Journal content are fictional. Places artwork is the existing bundled artwork, with its provenance recorded in `apps/web/src/places/ARTWORK.md`.

The gallery describes the current source tree, including Bring and the refreshed everyday themes; it is not evidence of a published release or a live deployment.

## Capture

Start the isolated demo using `test-env/install.sh`, then run:

```bash
node test-env/capture-readme.ts
```

The script signs in to the fictional demo, creates/uses Northstar studio through normal authorized APIs, and captures all 16 views. Existing populated fixtures are reused. A first-run interruption during fixture setup may need the unfinished fictional Workspace to be tidied before another full capture. It never prints the demo password, session cookies, credentials or token links. No database shortcut or fake browser response is used. It only mutates the isolated demo data and its own admin's personal presentation preferences.

To refresh selected images after a complete capture:

```bash
VMN_CAPTURE_ONLY=lists-phone,journal node test-env/capture-readme.ts
```

Captures use reduced motion, the device's light scheme for Places, 1440 × 1000 desktop / 390 × 844 phone viewports, WebP quality 87, and ordinary app controls. Screenshots are not composited, retouched or generated. The script additionally checks both everyday themes at 320 × 844 and verifies legacy `dark` account/Workspace preferences resolve to Memento Mori without rewriting the stored Workspace value. Fixtures have no notification offsets or weather-provider setup; no external weather request is needed.

| Image | Theme id | Viewport |
|---|---|---|
| `today-memento.webp` | memento-mori | 1440 × 1000 |
| `today-light.webp` | light | 1440 × 1000 |
| `procedures.webp` | light | 1440 × 1000 |
| `builder.webp` | light | 1440 × 1000 |
| `equipment.webp` | memento-mori | 1440 × 1000 |
| `documents.webp` | light | 1440 × 1000 |
| `journal.webp` | light | 1440 × 1000 |
| `run-phone.webp` | memento-mori | 390 × 844 |
| `bring-phone.webp` | light | 390 × 844 |
| `lists-phone.webp` | memento-mori | 390 × 844 |
| `tokyo-nights.webp` | tokyo-nights | 1440 × 1000 |
| `old-forest.webp` | witch-forest | 1440 × 1000 |
| `munich.webp` | places-de | 1440 × 1000 |
| `triora.webp` | places-it | 1440 × 1000 |
| `london.webp` | places-uk | 1440 × 1000 |
| `scotland.webp` | places-scotland | 1440 × 1000 |

## Verification

[`checks.json`](checks.json) records 18 views: all gallery captures and the two minimum-width checks, each without horizontal overflow or WCAG A/AA axe violations, plus no browser page errors and successful compatibility checks. Desktop and phone screenshots were visually inspected, including both everyday themes, guided execution, the builder, Documents, Equipment, the opened List and Journal entry. Theme token tests also cover every text/surface pair, the tinted page corner and icon ink. Physical-device and real screen-reader certification remain unperformed.
