# Witch Forest 25.3 — local visual review

Captured 2026-10-23 from the isolated fictional test environment at 127.0.0.1:3200. These are demo accounts/records, not production data. Baseline is main commit `9754cc6` (Witch Forest 25.2); after captures are the uncommitted 25.3 implementation on main, as requested by the owner. The actual application's controls, content hierarchy and theme tokens are retained. Clock time changes between captures.

| Viewport | Before | After |
| --- | --- | --- |
| 320 × 740 | [Before](before-today-320x740.webp) | [After](after-today-320x740.webp) |
| 375 × 812 | [Before](before-today-375x812.webp) | [After](after-today-375x812.webp) |
| 430 × 932 | [Before](before-today-430x932.webp) | [After](after-today-430x932.webp) |
| 768 × 1024 | [Before](before-today-768x1024.webp) | [After](after-today-768x1024.webp) |
| 1024 × 768 | [Before](before-today-1024x768.webp) | [After](after-today-1024x768.webp) |
| 1440 × 1000 | [Before](before-today-1440x1000.webp) | [After](after-today-1440x1000.webp) |
| 2560 × 1080 | [Before](before-today-2560x1080.webp) | [After](after-today-2560x1080.webp) |
| 844 × 390 landscape | [Before](before-today-844x390.webp) | [After](after-today-844x390.webp) |

Additional after captures: [phone Run](after-run-320.webp), [phone Step](after-step-320.webp), [desktop Run](after-run-1440.webp), [desktop Step](after-step-1440.webp), [forced colours](after-colors-active.webp), [normal colours](after-colors-none.webp). Screenshots use reduced motion for repeatable visual comparison. The PNG capture bytes were encoded to WebP with the repository's existing sharp package; no application pixels were retouched. `before-checks.json` and `after-checks.json` record zero horizontal overflow and no page errors at every size; forest descendants fell from 316 to 20.

## Verification

- `pnpm lint`: pass.
- `pnpm typecheck`: pass across all packages.
- `pnpm build`: pass; existing large JS chunk warning remains. Total JS slightly smaller than baseline; new scene artwork is separately served, not embedded in JS. Wide forest 205 kB, medium 96 kB, portrait 30/66 kB, alpha ivy 43 kB. Browser checks verify that only the selected responsive forest variant is requested and other themes load none of these assets.
- Existing Vitest suite: 178 files / 1420 tests pass. Five new astronomy tests pass; targeted web suite 4 files / 23 tests passes (including those five).
- `pnpm exec playwright test e2e/forest.spec.ts`: 4 tests pass across desktop/mobile Chromium. Covers all eight viewport sizes, correct image selection, axe, reduced motion, normal fog motion, simulated visibility pause/resume, forced colours, decorative semantics, no anonymous personal-settings read, no external browser request, and no forest load in Light.
- `pnpm exec playwright test e2e/account.spec.ts --project=desktop-chromium`: 1 existing end-to-end flow passes (2.1 minutes), including saved Witch Forest selection, 25.2 reduced-motion and forced-colours checks, and the rest of the account/application flow.
- `pnpm audit --prod --json`: completed, nonzero due to five advisories in existing packages (four moderate, one low; no high/critical and no SunCalc advisory). No unrelated dependency upgrades included.

## Composition and motion

Independently generated botanical woodland replaces procedural silhouettes, a cottage and pumpkin. Ancient trunks frame a deep valley with mixed trees and a nearly lost ruin; natural mist creates depth. A static painting carries bark and undergrowth detail; a separate transparent ivy layer, short mist translations, sparse fireflies and faint silver light provide reusable atmosphere without large animated tree layers. Ten seeded fireflies (six on narrow phones) have independent wander/glow periods; each glow has long dark intervals. Only opacity and transform animate, with no JS frame loop, SVG filters or new backdrop filters. Hidden pages pause motion and the astronomy timer.

Locally calculated moon illumination affects a faint wash, not text/card surfaces. The authenticated viewer's existing personal Weather location supplies the horizon calculation; no Workspace location, geolocation, external astronomy service or new card. The baseline remains complete offline, before sign-in and without coordinates.

## Limits and changed files

Visual inspection and browser emulation are not physical phone or GPU performance measurements. Real iOS/Android smoothness and platform font choice remain for device testing. The largest raster is 1536 px wide; ultrawide displays use cover without changing proportions, so fine detail softens. A changed personal location is picked up on reload or return of window focus (settings reads limited to once per minute). No new setting or API contract.

Implementation: `apps/web/src/ForestScene.tsx`, `forest-light.ts`, `forest-light.test.ts`, `witch-forest.css`, `witch-forest/old-*.webp`, and artwork provenance in `witch-forest/ARTWORK.md`; `App.tsx`/`main.tsx` now mount the scene with the current account lifecycle. `apps/web/package.json` and `pnpm-lock.yaml` pin SunCalc. `e2e/forest.spec.ts` adds focused browser checks. Documentation: development ledger, security checklist, architecture and user guide. No release, commit, push or pull request was created; work is on main per the owner's preference.
