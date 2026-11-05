# Clock / Weather artwork

2026-11-04 integration: `InstrumentPicture.tsx` now uses the transparent clock cutout and condition-specific
Weather WebP derivatives documented in [WEATHER-VARIANTS.md](WEATHER-VARIANTS.md). `weather.webp` is
retained as the original style reference, not used as a live condition painting. The 2026-11-05 extension
adds matching cloudy, partly cloudy, fog and sleet paintings. Unknown/absent conditions and failed image
loads use native symbols. The exhaustive mapping and prompts are in WEATHER-VARIANTS.md. One shared Celestial card
surface replaces the old opaque study backdrop. Existing personal background/opacity settings control
both cards through `sky-card.css`; the cutouts, text and clock hands remain fully opaque.
The historical source/edit notes below describe the original split artwork.

`clock.webp` and `weather.webp` — original locally bundled art for the owner-approved combined Today card,
created with the built-in image-generation tool on 2026-11-03. No runtime generator, upload or remote
image request. Final source assets: `apps/web/src/applets/art/clock.webp` and `weather.webp`, each 700 × 700
RGBA WebP, lossless, with a transparent background. They are the left and right halves of the approved 1400 × 700
study, split at x = 700. The flat navy backdrop, enclosed navy pockets beside the orbit rings, the warm-dark sun
glow and the sky stars are removed, so the card supplies the background. Removal was a colour key against the
border colour (RGB 6,13,31), with a stricter key in the rock base. The digital readings are real HTML; painted art
carries no user/location data.
The left dial has no painted hands: native SVG hands rotate from the same device minute as the digital
clock. The right picture is a decorative Weather emblem, not a live observation or warning; actual
conditions and unavailable/cached data remain explicit text. Each picture is its own square file, so the two halves
scale identically without a shared panel crop. No new third-party stock asset/license.

The owner approved the original two-part study in chat. Original generation prompt is preserved in
`docs/design/clock-weather-combined-review.md`. Final surgical edit prompt (built-in tool):

> Use case: precise-object-edit. Edit target: the provided approved two-part Clock / Weather artwork. Make exactly one surgical change: REMOVE THE TWO CLOCK HANDS from the left pocket-watch dial, reconstructing the dark navy dial texture and fine concentric gold orbital engravings behind them. Keep the small central gold spindle/pivot. The dial must have NO hands, no pointers, no arrows. Keep all existing hour tick marks, clock casing, crown, brass finish, orbital rings, stone, light, stars, and the entire right sun/cloud/rain illustration unchanged. Preserve the exact two equal halves, object centers, scale and straight-on dial geometry. Preserve the wide 2:1 composition and dark bottom area, with no text, no logo, no frame, no new object. This blank dial will receive real time-driven clock hands as native UI marks, so do not move or resize the dial or add replacement static hands.

Retain original/generated images non-destructively in the thread's generated-image storage. Deployment
consumes only this reviewed compressed copy. Artwork was visually checked before and after compression.
