# Oblique garden sundial — 25.4 correction, 2026-10-23

The owner's photo is an art-direction reference; no photo pixels were used. The plate is a horizontal object seen obliquely, with a fixed raised iron gnomon and a changing cast shadow. The stone plinth, metal face, daylight VI–XII–VI arc, sun engraving and botanical marks all lie in the same projected ground plane. No metal hand rotates. The night shadow is an atmospheric convention, explicitly permitted by the owner; digital time remains authoritative.

[Card](sundial-card.webp) · [Vector detail at 4× browser pixel density](sundial-detail.webp)

Shadow positions: [06:00](shadow-6.webp), [12:00](shadow-12.webp), [17:00](shadow-17.webp), [21:00](shadow-21.webp), Europe/Berlin. `checks.json` records four distinct shadow paths with unchanged gnomon markup, no page errors, no horizontal overflow at all eight viewport sizes, and a hidden dial under forced colours. Motion preference was Reduce. Digital clock/layout were retained.

Today captures: [320](today-320x740.webp), [375](today-375x812.webp), [430](today-430x932.webp), [768](today-768x1024.webp), [1024](today-1024x768.webp), [1440](today-1440x1000.webp), [2560](today-2560x1080.webp), [844×390 landscape](today-844x390.webp).

Fictional local demo only; forecast requests intercepted, with no live weather provider needed. Sharp only encodes the screenshots; the shipped dial is native SVG, with no raster dependency. Minor etching hides on narrow phones. No animated filters or new continuous animation.

Checks: repository lint, web typecheck, production build, contrast/theme tests (2 files / 14 tests), plus the browser assertions above. No claim of physical device/GPU testing. Security surface unchanged. Changes remain uncommitted on main. The earlier face-on clock interpretation shown in `../workspace-location-sundial/` is superseded by these images.
