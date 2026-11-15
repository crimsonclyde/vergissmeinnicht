# The Daily Planet API (internally "Gazette", steps.md 43)

The Daily Planet (internally the Gazette) is an optional Workspace tool (`GAZETTE`). VMN stores, validates and shows editions; it
never fetches news or prices itself. Since 43.7 it does write the weather section: see
[Weather](#weather-437). An edition is written by an assistant through MCP
(see [AI assistant connections](../admin/mcp.md#the-daily-planet-gazette)) or by a signed-in client through
the REST API below. All paths are under `/api/workspaces/{workspaceId}/gazette`.

| Method and path | Capability | Body / answer |
| --- | --- | --- |
| `GET /today` | `gazette.view` | `{today, preview}`: the Dashboard projection of the newest published edition (`null` if none) |
| `GET /settings` | `gazette.view` | `{settings, revision, today, oldest}` |
| `POST /settings` | `gazette.manage` | `{settings, expectedRevision}` |
| `GET /editions` | `gazette.view` | `{today, editions}`: kept editions; drafts only for publishers |
| `GET /editions/{YYYY-MM-DD}?state=published\|draft` | `gazette.view` (drafts: `gazette.publish`) | `{edition}` |
| `GET /editions/id/{id}` | as above | `{edition}` |
| `POST /editions` | `gazette.publish` | `{operationId?, content, publish, expectedRevision?}` → 201 `{edition, duplicate: false}`, 200 on a retry (`duplicate: true`) |
| `POST /editions/id/{id}/publish` | `gazette.publish` | `{expectedRevision}`: publish a draft (validated again against the current sections) |
| `POST /editions/id/{id}/delete` | `gazette.publish` | drafts only → 204 |
| `GET /watchlist` | `gazette.view` | `{items}` with `latest` and `history` (oldest first) |
| `POST /watchlist` | `gazette.publish` | `{item}` → 201 |
| `POST /watchlist/{id}` | `gazette.publish` | `{item, expectedRevision}` (archive with `active: false`) |
| `POST /watchlist/import` | `gazette.publish` | `{items}` with 1–50 reviewed EUR reference products → `{created, updated, skipped}`; no network requests |
| `POST /watchlist/{id}/delete` | `gazette.manage` | `{expectedRevision}`; permanently removes an archived product and its observations → 204 |
| `GET /header` | `gazette.manage` | `{settings, revision}` with mode, fixed id and ordered images with focal points |
| `POST /header` | `gazette.manage` | `{settings, expectedRevision}` |
| `POST /header/images?revision=N&replace=ID` | `gazette.manage` | Raw image bytes; omit `replace` to append |
| `GET /header/images/{id}` | `gazette.view` | Workspace-scoped, re-encoded JPEG |
| `POST /header/images/{id}/delete` | `gazette.manage` | `{expectedRevision}` → updated header settings |
| `POST /header/override` | `gazette.manage` | `{date, imageId, expectedRevision}`; use null for bundled woodland; published editions only → 204 |
| `POST /watchlist/prices` | `gazette.publish` | `{observations: [{itemId, price, checkedAt, verified?, source?, url?, shipping?, vatIncluded?}]}` → `{recorded}`; all or nothing. `shipping` ≥ 0 (0 = free, omitted = not known); offers compare by `price + shipping` |
| `GET /weather?date=YYYY-MM-DD` | `gazette.view` | Today or tomorrow (default today): `{date, place, settings, plan, result, verification}`; 30 requests per 10 minutes per person |

Cookie-authenticated writes need the usual same-origin request (CSRF origin check). Errors are
`{error: code}` with a `field` path for validation, e.g. `edition.sections[1].items[0].url`.

## Edition format (version 1)

```text
{ version: 1, date: "YYYY-MM-DD", title?, greeting?, intro? (Markdown),
  sections: [ { sectionId, type, summary? (Markdown), ...by type } ] }
```

- `sectionId` must be a section of the Workspace settings with the same `type`; unknown sections or
  mismatched types are refused, never guessed. Sections appear in the settings' order.
- `articles`: `items[]` of `{id, title, summary, url, source, publishedAt, language?, relevance?,
  security?: {package, identifier, advisoryUrl?, severity, relevance, verification}}`. Ids and URLs
  are unique within the edition.
- `weather`: `locations[]` of `{name, region, days[{date, condition, high, low, precipitationMm
  (number or {min, max}), windKmh?, gustKmh?, disagreement?}], comparison?: {metric, rows[{source,
  values[]}]}, warnings?, sources[{name, url}] (at least one), fetchedAt?, note?}`. Name the source
  actually used; WeatherOnline.de has no permitted data access, so it is not used.
- `watchlist`: `items[]` of `{id, name, currency, typical?, shop?, url?, variant?, price?,
  checkedAt?, verified?, change?, discountThreshold?, target?, history?, ...}`: a snapshot for the
  edition; the persistent watchlist is separate. For a reference-only item supply `typical` and
  omit `price`, `checkedAt`, `verified` and `change`. If a price is present, supply its check time.
  Only verified values appear as current offers. The percentage compares with `typical`, not the
  previous day's price. The highlight uses the product override or the Workspace default (15%).
- `rich`: `{body (Markdown), tables?: [{caption?, columns[], rows[][]}]}`.
- Text is plain or Markdown; HTML tags are refused. Links are https with a dotted host and no user
  info. The stored edition is at most 600 kB; the request body at most 1 MiB.
- An edition may be written for a kept day or tomorrow. Publishing replaces that date's published
  edition in one transaction; a refused edition leaves the published one untouched.

## Header snapshots and price provenance

New publications select a header once. Daily mode uses the edition date, random mode draws once per
publication, and sequential advances on each new published edition. A republish or change of crop
does not change an existing snapshot. Replacing an image keeps its original crop and bytes for past
editions until retention or an explicit edition override removes their last reference. Deleting a
gallery image sends editions using that image back to the bundled artwork. Full database backups
retain custom backgrounds; portable Workspace backups omit decorative images, settings and snapshots.

Watchlist imports use a checked Amazon.de product URL's ASIN, or an exact name/variant/shop/URL match
when there is no ASIN. Currency, condition and market must also match. Imports update only the
reference of an active matching record. The minimum EUR filter (20 by default) applies to known
references in imports; unknown references and manual creation are allowed. VMN does not retrieve
wishlists or seller data. A verified observation is a claim from the person or assistant who entered
it. Compare equivalent products using the total including VAT and shipping and keep the seller and
check time. A low means the lowest sourced, verified observation in the retained window, not an
all-time market low.

## Sample data

[`docs/examples/gazette-edition.json`](../examples/gazette-edition.json) is a complete request body
for `POST /editions` (generated from `sampleGazetteEdition` in `packages/domain/src/gazette-sample.ts`;
every source is `example.org` and every headline is marked as a sample). To seed a development
Workspace, switch The Daily Planet on in Plugins, change `content.date` to today in its time zone,
and send the file with an Editor's session, or ask a connected assistant to publish it with
`publish_gazette_edition`.

## Weather (43.7)

When `settings.weather.automatic` is on (the default), every write or publish of an edition dated
today or tomorrow rebuilds each enabled weather section on the server from the **Workspace location**
(`workspaces.location`); the client's `summary` is kept and everything else it sent for that section
is replaced. Older dates keep the weather section of the stored edition. Operation ids hash the
client's content, so a retry stays idempotent even though VMN's forecast changed.

Section fields (all optional, so editions written before 43.7 still parse):

- `status`: `ok`, `no_location` (no Workspace location; `locations` is empty) or `unavailable`
  (every forecast source failed or server weather is off). `generatedBy: "vmn"`.
- Location: `place {latitude, longitude, elevation, timeZone}`, `models[]` (per-source days for the
  comparison table), `sources[]` with `role` (`forecast`, `warnings`, `reference`), `model` and
  `retrievedAt`.
- Day: `highRange`/`lowRange` and a `{min, max}` `precipitationMm` when independent model families
  disagree (temperature > 3 °C apart, rain > max(2 mm, 50 %)), `precipitationProbability`,
  `confidence` (`high`, `medium`, `low`; day 4 onward is always `low`) and a plain-text `note`.
- Warning: `onset`, `expires`, `kind`; level `info` for "no alert" messages.

Region plans (fixed hosts, see security.md):

| Region | Forecast sources | Warnings | References (links only) |
| --- | --- | --- | --- |
| Liguria | ItaliaMeteo ARPAE ICON-2I, DWD ICON-EU, ECMWF IFS (Open-Meteo); MET Norway | AllertaLiguria zone level, Meteoalarm Liguria | ARPAL bulletin, Meteo 3R, OMIRL |
| Germany | DWD ICON-D2, ICON-EU, ECMWF IFS (Open-Meteo); DWD MOSMIX (Bright Sky); MET Norway | DWD (Bright Sky) | DWD |
| Rest of Europe / world | ICON-EU (Europe), ECMWF IFS, NOAA GFS; MET Norway | – | – |

Same-family sources (MET Norway ≈ ECMWF; ICON-D2 ≈ ICON-EU) are averaged before families are
weighted. With `learn` on, forecasts and DWD station observations (≤ 25 km, ≤ 300 m elevation gap,
lapse-rate corrected) are kept 60 days and each source's weight is scaled by median MAE / its MAE
(0.5–1.5) per lead bucket, once it has 5 samples and 2 peers.
