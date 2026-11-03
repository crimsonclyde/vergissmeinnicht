# Clock / Weather artwork

`clock-weather.webp` — original locally bundled art for the owner-approved combined Today card,
created with the built-in image-generation tool on 2026-11-03. No runtime generator, upload or remote
image request. Final source asset: `apps/web/src/applets/art/clock-weather.webp`, 1400 × 700 WebP,
quality 85, 69,960 bytes. The digital readings are real HTML; painted art carries no user/location data.
The left dial has no painted hands: native SVG hands rotate from the same device minute as the digital
clock. The right picture is a decorative Weather emblem, not a live observation or warning; actual
conditions and unavailable/cached data remain explicit text. The shared asset avoids separate panel
art scaling; each half crops one exact 700 × 700 portion. No new third-party stock asset/license.

The owner approved the original two-part study in chat. Original generation prompt is preserved in
`docs/design/clock-weather-combined-review.md`. Final surgical edit prompt (built-in tool):

> Use case: precise-object-edit. Edit target: the provided approved two-part Clock / Weather artwork. Make exactly one surgical change: REMOVE THE TWO CLOCK HANDS from the left pocket-watch dial, reconstructing the dark navy dial texture and fine concentric gold orbital engravings behind them. Keep the small central gold spindle/pivot. The dial must have NO hands, no pointers, no arrows. Keep all existing hour tick marks, clock casing, crown, brass finish, orbital rings, stone, light, stars, and the entire right sun/cloud/rain illustration unchanged. Preserve the exact two equal halves, object centers, scale and straight-on dial geometry. Preserve the wide 2:1 composition and dark bottom area, with no text, no logo, no frame, no new object. This blank dial will receive real time-driven clock hands as native UI marks, so do not move or resize the dial or add replacement static hands.

Retain original/generated images non-destructively in the thread's generated-image storage. Deployment
consumes only this reviewed compressed copy. Artwork was visually checked before and after compression.
