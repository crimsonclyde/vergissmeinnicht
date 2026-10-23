# Carved stone sundial face — 25.4, owner follow-up 2026-10-23

Entirely native SVG: no image is used in the dial. The owner requested a more stone-like face, a blood drop and a rune. Mineral grain uses one small static pattern, with hand-drawn pits, hairline fractures and rim chips over a muted stone gradient. The fictional branching rune has offset dark/light strokes to suggest a recessed carving. One small dark crimson blood drop is still, with no splatter or pulsing. All new colours use Witch Forest semantic tokens. The raised iron gnomon stays fixed; only the cast shadow responds to time.

[High-density vector detail](sundial-detail.webp) · [Actual card](sundial-card.webp)

Shadows: [06:00](shadow-6.webp), [12:00](shadow-12.webp), [17:00](shadow-17.webp), [21:00](shadow-21.webp). Browser assertions verified four distinct shadow paths, identical fixed-gnomon markup, no page errors, no horizontal overflow at 320/375/430/768/1024/1440/2560 px or 844×390 landscape, and a hidden dial in forced colours. Captures use reduced motion and the fictional local demo; forecast requests intercepted. The high-density detail is a 4× device-pixel-density browser rendering of the SVG, not an upscaled low-resolution image.

Checks: focused ESLint, web typecheck, production build, contrast/theme tests (2 files / 14 tests), plus the browser assertions recorded in `checks.json`. No real-device/GPU performance claim. No security-surface change: decorative SVG/CSS only, no request, storage, credential, permission or database change. No extra dependency, external font, image, animated filter or continuous animation. Digital time remains authoritative. Ledger and user guide updated. Uncommitted on main.

Earlier appearance: `../witch-forest-sundial-oblique/`.
