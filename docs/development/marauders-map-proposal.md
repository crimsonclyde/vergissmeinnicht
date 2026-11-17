# Marauder’s Map — design review

17 November 2026 · Proposed for owner review

Marauder’s Map gives a Workspace one shared collection for ordinary stops and places to explore. The sidebar says **Map**. The desktop browse view pairs pins with a compact list. On phones, Map and List are two views of the same search. A pin opens a small card with a destination action and a path to details. Closing details returns to the prior view, viewport, selected place and filters.

## Decisions for review

| Decision | Recommendation |
| --- | --- |
| Categories | Seed Food & drink, Shopping, Historic site, Urbex, Trailhead and Other. Give Workspaces their own stable category rows and taxonomy setting from the start, with only the built-in names and icons exposed in the first release. Offer custom Workspace tags immediately. Make category customization a later setting if the built-ins prove insufficient. |
| Sharing | Keep favorites, Want to go, dates, ratings, notes and visit photos owner-only in the first release. Consider explicit sharing of a single visit separately, with a reviewable choice of fields and photos and a way to revoke the share. |
| Garmin | Ship copyable WGS 84 decimal pairs. Add GPX waypoints if device use justifies the extra UI. Export selected saved points with distinct names such as `Gerbontina` and `Gerbontina – Trailhead`, with approximate points clearly identified before export. Route or track export needs its own sources and decision. |
| Basemap | Prefer MapLibre GL JS with an operator-installed regional OSM-derived PMTiles bundle served from the VMN origin. Serve style, glyphs and sprites locally, size the extract and zoom bounds for the region, and review the licenses and attribution for each layer. Add a licensed elevation layer for hillshade only when the operator installs one. |

Regional tiles require storage, bandwidth and a periodic refresh, with no provider key or hosted usage quota. Keep visible OpenStreetMap attribution plus any required producer attribution. A managed vector service lowers operator maintenance but introduces terms, usage quotas, possible billing and disclosure of the viewer’s IP and viewed tile areas. The public OSM tile service has a usage policy and no availability guarantee. Keep it out of default configuration. The same-origin design uses bounded HTTP Range reads for the configured archive, with no runtime upstream proxy. If the region is missing, WebGL is unavailable or tiles fail, List, filters, details, saved coordinates, manual entry and Go continue working. [MapLibre PMTiles example](https://maplibre.org/maplibre-gl-js/docs/examples/pmtiles-source-and-protocol/) · [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/) · [OSM attribution guidance](https://osmfoundation.org/wiki/Licence/Licence_and_Legal_FAQ)

**Nearby needs a narrow scope decision.** AGENTS.md currently excludes geolocation. The mockup simulates the declined or unavailable branch. Recommend initial browse around a selected saved locality or manually panned viewport. To enable Nearby, explicitly approve a one-shot browser request on tap. Use the result only for viewport centering and local straight-line distances, with a separate source-backed walking estimate when available. Keep the device coordinates in ephemeral browser memory, out of API parameters, logs, backups and MCP. The browser would send only a coarse map bounds query to VMN. Keep the control useful on denial, timeout and insecure origins by offering town selection and manual browse.

## Fit with VMN

- **Navigation and design.** Add an off-by-default Workspace tool through the existing tool registry and Workspace admin settings. Add Map to [the classic sidebar and a Guide tool group](../../apps/web/src/navigation.ts). Phone uses Tools or a personally ordered shortcut. Reuse shared controls, disclosures, focus management, i18n and [theme tokens](../../apps/web/src/theme.ts). Keep Light, Memento Mori, Places, Witch Forest and Tokyo Nights at feature parity. The mockup shows three appearances and a selected bottom shortcut.
- **Server boundary.** Add Fastify route adapters over shared application use cases, domain validation and Drizzle/SQLite repositories. Use [central capabilities](../../packages/permissions/src/index.ts) and `authorizeTool`: ACTIVE member, Workspace gate, then capability. Every role can read shared places when enabled. Recommend EDITOR and ADMIN create, edit, import, archive and restore shared records, following the Gazette editor precedent. ADMIN owns taxonomy and tool settings. USER and above can write their own visit state, following the private Journal pattern. GUEST stays read-only. Recheck current membership, capability, tool and live grant inside each write transaction. Refuse foreign or disabled resources as unknown, including covers, filters, points and MCP discovery. Disabling retains records.
- **Media and history.** Reuse the [shared attachment pipeline](security.md#35-notes-personal-journal-and-shared-attachments-2026-11-02) with new consumer policies for a shared place cover and an owner-only visit attachment. Show local metadata-free derivatives and apply existing type, byte, quota and processing checks. Downloadable originals can contain location metadata, so review who may access shared originals and make that visibility clear on upload. Bind images only to authorized same-scope references. Offer reversible archive using revisions and same-transaction audit, with no permanent purge in initial scope. Audit shared changes by IDs and action, omitting exact coordinates, URLs, notes and image metadata.
- **Portable backup.** Extend the [Workspace table allowlist](../../packages/database/src/workspace-backup-tables.ts), attachment reachability query and [restore classification](../../packages/database/src/workspace-restore.ts) for shared places, stable taxonomy, points, joins, approaches, sources, archive state and referenced shared originals. Remap every entity and reference including preferred point links and historical authors. Classify private state, visit photo bindings, device position, tile data, cache and retry receipts outside the portable package. Test old-level compatibility, cross-Workspace package references, shared-point identity after remapping, byte equality and complete rollback. Full server backup follows its existing operator policy.

## Logical data model

Use opaque UUIDs, tenant-qualified foreign keys, bounded and validated fields, explicit nullable unknowns and indexed Workspace queries. Required draft fields are name and primary category (Other is a valid default), with author, times and revision supplied by the server. A draft can be a shared saved record with missing details.

| Record | Fields and constraints |
| --- | --- |
| Place | `id`, `workspace_id`, required name and category ID, nullable locality, address, summary, HTTPS website, readable hours and hours checked date, cover attachment, original submitted URL, and approach ID. Creation/update actors and timestamps, revision and nullable archive timestamp. Private and shared data live in separate tables. |
| Point, PlacePoint | Point has Workspace, ID, label, WGS 84 finite latitude and longitude in inclusive ranges ±90 and ±180, `exact` or `approximate`, optional source/provenance and optional uncertainty radius. “Exact” denotes a specific recorded location and does not certify the source. PlacePoint joins same-Workspace IDs with a role of destination, parking or trailhead. Unique on place, point and role. A partial unique index permits one preferred link per place. A place can have zero points and a point can be reused. Shared point edits show the affected places. |
| Category, Tag, PlaceTag | One mandatory category per Place. Stable starter keys and approved icons. Tags are Workspace-defined with a unique normalized label within the Workspace. A unique join uses stable tag IDs. Renaming the Tag row immediately updates every related place and filter. |
| Approach | Workspace row with label, optional route reference, walking minutes and distance, terrain, notes, route access status, checked date and supporting sources. Several Places can reference it. Keep building access and site-specific hazards or restrictions with the Place, with their own dates and sources. Keep a reported hazard distinct from a current verified condition. |
| Source, place identity | Zero or more Source rows per Place with submitted HTTPS URL, optional title, publisher, checked date and bounded field-support notes. Store the original submitted URL unchanged as validated text. Canonical URL or provider/name and external ID live separately as typed matching keys with Workspace-local uniqueness for reliable place identities. A multi-place article belongs to each record as a source and does not identify any single place. |
| Personal state, Visit | Unique state on Workspace, place and user for Favorite and Want to go. Visit has its own UUID, owner, Workspace, place, optional local calendar date and note, nullable bounded 1–5 rating, and optional private attachment links. One row per visit supports repeat visits. Marking without a date creates a visit with a null visit date. UI shows “Visited · date unspecified” and keeps the record’s creation time separate. No aggregate scores or public counts. |

**Example records.** Sample café has Food & drink, locality Triora, Vegetarian options, a contextual photo and one preferred destination point. Gerbontina has Urbex, locality Creppo, a reported destination at **44.00166, 7.71564**, and a distinct preferred Creppo village start at **44.00785, 7.71568**. Creppo is a sourced locality coordinate used to illustrate the start. An exact trail entrance or parking spot remains unverified. Bruzzi and Drondo can reference the same start and Approach with empty destination sets. Merli stores a Perallo-area approximation and a dated report of a narrow, damaged path. Case Bondazzo stores the official itinerary and has zero points. [OSM Creppo node](https://www.openstreetmap.org/node/332047708) · [Comune di Triora](https://www.comune.triora.im.it/Menu?IDDettaglio=229720) · [Park’s Creppo–Gerbonte reference](https://www.parks.it/parco.alpi.liguri/dettaglio.php?id=25088) · [Merli first-hand report](https://latopinadellavalleargentina.com/2019/11/11/la-frazione-abbandonata-di-merli/) · [Park’s Triora–Realdo itinerary](https://www.parks.it/parco.alpi.liguri/iti_dettaglio.php?id_iti=5111&idp=5106)

**Browse queries.** Use separate Workspace-scoped, bounded and paginated queries for list and visible markers. Apply category and stable tag IDs before projection and look up personal filters only under the actor’s ID. Match normalized name, locality and tag labels using parameterized queries. Index active places, category and tags, and workspace/latitude/longitude for points. Split antimeridian bounds when needed, cap marker responses and cluster at wider zoom. Deduplicate shared points and present their matching places on selection. Keep the list independent of map bounds by default, with an explicitly available “search this area” action that labels places without a known destination. A zero-point place remains searchable and openable.

**Directions.** Use encoded Google Maps directions URLs with `api=1`. Omit origin so Maps handles it after the explicit click. Prefer the selected navigation point, then an exact destination or a verified saved address or provider ID. An approximate area opens an area view. An unresolved URL remains a deliberate “Open original link” action. The coordinate sheet labels each point and repeats its confidence. Initial town centering can use the Workspace location or saved locality/point suggestions. Initial geocoding and routing services are unnecessary. [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started)

## Manual entry and delegated import

Use a short form with name, default category, tags and an optional pin, coordinate pair or original link. Details disclosures cover approach, access and sources. An unresolved URL is saved as a reference and can be complemented with coordinates later. Use HTTPS URLs with bounded lengths, no userinfo, safe link rendering and explicit click-through. Keep arbitrary URL resolution and article research in the authorized client. VMN does not dereference pasted links or embed third-party photos, HTML or previews. Any future server geocoding, resolution, or delegated media transfer needs its own outbound and privacy review.

Add proposed MCP scopes `map.read` and `map.write` through explicit, revocable Workspace grants. Use strict schemas, bounded responses and the [existing structured MCP results and errors](../../apps/server/src/mcp/tools.ts). Keep private visits and photos out of delegated scopes. Treat article text, record content and tool results as data. Resolve an ambiguous Workspace to a user choice before any access. Proposed operations:

- `search_places` returns paged shared results and possible matches. `get_place` returns canonical shared fields, revision, points and sources. Return allowed category/tag IDs in scope.
- `preview_place_import` validates and reports per-field provenance and uncertainty, reviewed revision for possible updates, and exact, ambiguous, unresolved and ready outcomes. It makes no writes.
- `create_place` and `update_place_fields` share the web use cases. A bounded `import_places` can apply that same contract per item. Direct save is available when the user explicitly asks to add entries. Default updates fill missing fields. Explicit replacement names the fields and requires the current revision. Omitted fields and manual edits survive.
- Match by external place ID or conservatively normalized provider URL first, using a Workspace unique constraint. Name, locality and nearby coordinates only nominate possible matches. Keep ambiguous items for review while processing independent authorized items. Use a stable operation ID per item plus canonical payload hash in a receipt scoped to Workspace, actor and operation. Commit receipt, record, joins and audit together in an IMMEDIATE transaction. Replay the same receipt after checking live grants. Reusing an ID with different content returns conflict. If an item has no reliable external identity, reconcile with a fresh search after the bounded receipt window before trying again.
- Return created, updated, already matched, needs review, unresolved or rejected per item with safe reason codes. Read back successful IDs. A useful report is “Saved Case Bondazzo with its route source and no pin. Gerbontina needs match review. Six links are awaiting their original URLs.”

Example proposed `create_place` payload with illustrative IDs. An existing Creppo Point ID can be reused in Bruzzi or Drondo. The caller supplies a source for each factual claim and may omit unknown details.

```json
{
  "workspaceId": "728eacde-3f08-4d41-9d28-97f691969d16",
  "operationId": "557b41b2-856f-4aa5-b417-32878a58aeaa",
  "place": {
    "name": "Gerbontina",
    "categoryKey": "urbex",
    "locality": "Creppo",
    "points": [
      {
        "role": "destination",
        "preferred": false,
        "newPoint": {
          "label": "Gerbontina · reported ruin pin",
          "latitude": 44.00166,
          "longitude": 7.71564,
          "precision": "exact",
          "provenance": "Coordinates supplied in the brief, unverified"
        }
      },
      {
        "role": "trailhead",
        "preferred": true,
        "pointId": "cd2ba08f-d8a2-43fc-adc8-32e3eaf5cab3"
      }
    ],
    "sources": [
      {
        "url": "https://www.parks.it/parco.alpi.liguri/dettaglio.php?id=25088",
        "publisher": "Parco Naturale Regionale delle Alpi Liguri",
        "supports": ["Creppo–Gerbonte approach", "hamlet name"]
      }
    ]
  }
}
```

## Review scope

The interactive mockup uses projected OSM road, path, river and woodland data with a contextual Triora photo. The café is fictional. The attachment mentions six Google Maps links without supplying their URLs, so the import screen reserves six unresolved slots. Pin dropping uses three demonstration locations, and import write/readback and device location are simulated. These are design artifacts awaiting review. [Triora photograph by Davide Papalini, resized, CC BY-SA 3.0](https://commons.wikimedia.org/wiki/File:Triora-IMG_0227.JPG) · [CC BY-SA 3.0 license](https://creativecommons.org/licenses/by-sa/3.0/)

Before implementation, settle geolocation, verify the trail start for practical navigation, and review new dependencies, decisions and negative tests. Cover disabled/revoked gates including mid-write, foreign IDs and composite references, private visit and media leaks, concurrent receipt retries, stale revision conflicts, malicious URL/attachment inputs, backup exclusion and restore remapping. Exercise keyboard and touch at 320 px in light and dark, map contrast/focus, tile outage and physical phone or Garmin handoff.

## Implementation follow-up

The approved design is implemented in the local codebase under section 44. Map is opt-in per
Workspace. The selected town and saved Workspace location center the map, subject to installed
basemap coverage. The initial release uses built-in categories with custom tags, private visits,
WGS 84 copying, and operator-installed PMTiles. Approval to use device geolocation, visit sharing
and GPX exports remains separate. [Deployment](../admin/deployment.md#optional-marauders-map-basemap) ·
[MCP setup](../admin/mcp.md#marauders-map) · [User guide](../user/user-guide.md#marauders-map)
