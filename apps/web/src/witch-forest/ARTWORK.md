# Old Forest 25.3 artwork provenance

Generated independently with the built-in imagegen tool on 2026-10-23. The user's visual reference informed the art direction; no screenshot pixels or application UI were used in the assets.

## Woodland prompt

```text
Use case: stylized-concept
Asset type: independent woodland environmental artwork for a dark web application, landscape 3:2 composition.
Create an ancient European woodland at night in dark botanical naturalism with subtle folklore atmosphere. This is ART ONLY, no application UI, no cards, no typography, no icons, no borders, no screenshot.
Massive weathered oak trunks at extreme left and right edges, deeply fissured bark, irregular twisting asymmetrical branches reaching across upper corners, occasional broken limbs, moss, organic climbing ivy with varied leaf sizes, exposed roots, ferns and rocks in lower corners. Mixture of broadleaf trees and occasional distant conifers. Quiet open central view into deep woodland, groups of distant trees fading progressively into naturally pooled silvery mist. Faint overgrown fragment of a stone arch far down in the valley, very small and nearly lost in fog, never focal. No cottage, no pumpkins, no lit windows. No visible moon disc (illumination will be layered in code). Cold silver light from upper right beyond frame.
Sophisticated textured painterly realism, credible natural trees, muted moss and desaturated sage, near-black forest green and deep blue-black. Dark restrained nocturnal palette but enough tonal separation to see bark and botanical detail. Slightly darker and quieter than a cinematic fantasy painting. Top central half especially dark and visually quiet behind application content. Atmospheric depth not horizontal bands or triangular hills. No faces, humans, humanoid branches, creatures, horror, magical particles, saturated colors, or watermarks. Frame naturally continues beyond image edges; do not add a vignette border.
```

## Botanical foreground prompt

```text
Use case: stylized-concept
Asset type: transparent botanical foreground layer for ancient woodland web theme.
An organic sparse climbing ivy spray along the LEFT EDGE, growing from a slender weathered branch in the TOP LEFT corner, with thin twisting stems branching irregularly downward and toward the right. Natural varied ivy leaf shapes, sizes and orientations, occasional overlapping leaves, tiny exposed tendrils. Deep muted moss and desaturated sage leaves, almost-black stems, very restrained cold moonlight edges, botanical painterly realism, detailed adult dark folklore naturalism, NOT vector clip art. Leaves concentrated at top left and left edge, most of canvas empty transparent, feather out naturally toward the bottom and right. Narrow vertical composition. No tree trunk, no background forest, no text, no frame, no UI. Genuine transparent background. No evenly spaced string of leaves or repetitive vines. Artwork designed to blend into a near black green night forest, calm and understated.
```

## Production assets

- `old-forest-wide.webp`: 1536 × 1024, 204,896 bytes.
- `old-forest-medium.webp`: 1024 × 683, 95,716 bytes.
- `old-forest-portrait-480.webp`: 480 × 640, 30,142 bytes.
- `old-forest-portrait-768.webp`: 768 × 1024, 66,436 bytes.
- `old-ivy.webp`: 360 × 540, alpha retained, 42,932 bytes.

WebP encoded with the repository's existing sharp dependency (quality 76–78, no embedded metadata). Portrait variants are independent crops of the artwork, chosen through a responsive picture; CSS uses object-fit: cover. Larger source PNGs are authoring outputs, not shipped assets. No external runtime image service, canvas or SVG filter. The forest perspective is painted into one static layer, with separate botanical, light, star, shade, mist and firefly layers. This avoids large independently composited tree textures. The ivy is reused at the sidebar edge and upper right; no tiling.
