# Places artwork — Open horizon (31)

Current defaults: **Munich**, **Triora**, **London**, **Scotland**. The old country theme identifiers stay unchanged so saved preferences survive.

- Munich uses the owner-supplied “Munich to Lake Garda Panorama.png” (2026-10-25). Its original is unchanged; only compressed/resized derivatives ship.
- Triora, London and Scotland were generated with the built-in imagegen tool, using that panorama as a style reference. Triora has a small mountain village, woodland and ground mist; London a riverside pub and small stone lion; Scotland an imagined northern coast with standing stones. They are artistic scenes, not geographical/archaeological claims.
- Exact prompts and generation provenance: [design review](../../../../docs/development/places-design-review.md#revised-artwork-and-provenance).
- Each `art/<id>/landscape-*.webp` set contains wide (maximum 1536 px), small (1024 px), portrait (768 × 1152) and phone (480 × 720) variants. The initial approved portrait versions are crops. Only the selected responsive variant loads. Wide files are approximately 237–424 kB; phone variants are smaller.
- `countries/<id>-art.ts` references these files. `artwork.lights` is optional and unused for these landscapes. Old façade files and `assets/places/` are retained as historical source, not loaded by the current presets.
- Mist, fireflies, a bee and leaves are separate transform/opacity decoration. They pause when hidden and stop under reduced motion. They are absent over a personal photo or No image. No provider or device location is queried for decoration.

## Adding a place now

Add an append-only domain id and reviewed migration for persisted theme allowlists, four compressed image variants, a declarative config with all semantic tokens in both schemes and framing/effects, and translated labels. Never rename stored ids. Verify contrast, responsive assets, forced colours, reduced motion, personal-photo/No image fallbacks and own-account preference isolation. Keep prompts/provenance and the execution ledger current.

## Archived section 30 specification

The following describes the superseded initial façades and their procedural renderer, retained for historical context.

# Places artwork and countries (section 30)

## Status of the artwork

The four façades shipped now (Germany, Italy, UK, Scotland) are **interim artwork**. They are drawn by
code (`assets/places/scene-<id>.mjs`, procedural SVG with paper grain, washes and hand-wobbled lines),
then rendered once to WebP. They are original, contain no stock imagery, no flags and no landmarks, and
are good enough to judge layout, colour and readability. They are **not** the final painted artwork:
replace them with commissioned or hand-painted pictures to the specification below when available. The
app does not change: only the WebP files are swapped.

Render again after changing a scene:

```bash
node assets/places/render.mjs            # all countries
node assets/places/render.mjs de --preview   # one country, plus preview PNGs in assets/places/ (git-ignored)
```

## Specification for final artwork

Per country, two compositions of the **same** scene, each at two sizes, WebP (quality ~80):

| File | Size | Use |
|---|---|---|
| `wide.webp` | 1920 × 1280 | desktop, tablets in landscape |
| `wideSmall.webp` | 1280 × 853 | small laptops; theme swatch |
| `portrait.webp` | 960 × 1536 | phones (≤ 37.5 rem wide or taller than 4:5) |
| `portraitSmall.webp` | 600 × 960 | small phones |
| `lights-*.webp` | same four sizes | only the lit windows, on transparent; fades in after sunset |

Budget: ≤ 450 KB for the four day files of one country together, ≤ 350 KB for the four light files.

Composition:

- An **everyday residential street façade**, seen straight on at eye level from across the street: the
  building of a normal person, not a monument. No people, no cars in focus, no readable signs, no flags,
  no brand names, no landmark that pins one city.
- The calm middle band (roughly 25–75 % of the height) is where page content sits: keep it low in
  contrast. Detail belongs in the edges, the roofline and the ground floor.
- Daylight that is neutral and slightly overcast; the app adds warmth, dusk and night on top (tint,
  vignette, light layer), so do not paint a sunset into the picture.
- The portrait version is recomposed for a phone (door and one window column in the middle), not just
  cut from the wide picture.
- Painterly and serious: gouache or watercolour on paper, muted, never cartoon, never kitsch.

Style per country (the palette tokens in `countries/<id>.ts` follow the same direction):

- **Germany — Berlin/Leipzig Altbau.** Gründerzeit stucco façade, tall double casement windows, cornice
  and balcony with wrought iron, a courtyard gate; charcoal, muted brick red, antique gold, warm cream.
- **Italy — Ligurian townhouse.** Tall narrow house in faded ochre and terracotta, painted window frames
  (trompe-l'œil), green louvred shutters, a small balcony with plants; olive/sage, terracotta,
  limestone, parchment.
- **UK — London Victorian terrace.** Stock brick, white stucco ground floor, sash windows, a black
  railing and front steps, a panelled door with a fanlight; navy, burgundy, stone, fog grey.
- **Scotland — Edinburgh stone tenement.** Grey sandstone ashlar, slate roof with dormers, a common
  stair door, chimney stacks; Saltire blue (muted), slate, moss, mist.

A painter's brief can be written from the above; for image generation, a prompt of the form
"gouache painting of an ordinary [style] residential façade seen straight on across a quiet street,
overcast daylight, muted [palette], paper texture, no people, no text, no flags, no landmarks" is a
starting point. Generated pictures must be reviewed for invented text, signs and logos, and their
licence must allow redistribution under the project's AGPL-3.0 distribution.

## Adding a country

1. **Domain:** add the id to `PLACE_IDS` in `packages/domain/src/places.ts`.
2. **Database:** `pnpm db:generate --name places_<id>` (the theme CHECK constraints are generated from
   the theme list); commit the migration and update the expected migration in the backup tests.
3. **Artwork:** add `assets/places/scene-<id>.mjs` (or painted files) and render to
   `apps/web/src/places/art/<id>/`; add `countries/<id>-art.ts` importing the eight files.
4. **Configuration:** `countries/<id>.ts` — name and hint keys, style, light and dark tokens (every
   token in `PLACE_TOKEN_NAMES`, plain `#rrggbb`), gradients, focal points, default overlay and
   vignette, effects. Register it in `registry.ts` (TypeScript insists on every id).
5. **Text:** `appearance.places-<id>` and `appearance.places-<id>Hint` in `i18n/en.ts`.
6. **Tests:** `contrast.test.ts` and `places.test.ts` pick the country up from the registry; run them.
