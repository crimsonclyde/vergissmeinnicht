# The Daily Planet API (internally "Gazette", steps.md 43)

The Daily Planet (internally the Gazette) is an optional Workspace tool (`GAZETTE`). VMN stores, validates and shows editions; it
never fetches news, forecasts or prices itself. An edition is written by an assistant through MCP
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
| `POST /watchlist/prices` | `gazette.publish` | `{observations: [{itemId, price, checkedAt, verified?, source?, url?}]}` → `{recorded}`; all or nothing |

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
- `watchlist`: `items[]` of `{id, name, currency, change, verified, price?, checkedAt (required with a
  price), typical?, target?, history?, ...}`: a snapshot for the edition; the persistent watchlist is
  separate.
- `rich`: `{body (Markdown), tables?: [{caption?, columns[], rows[][]}]}`.
- Text is plain or Markdown; HTML tags are refused. Links are https with a dotted host and no user
  info. The stored edition is at most 600 kB; the request body at most 1 MiB.
- An edition may be written for a kept day or tomorrow. Publishing replaces that date's published
  edition in one transaction; a refused edition leaves the published one untouched.

## Sample data

[`docs/examples/gazette-edition.json`](../examples/gazette-edition.json) is a complete request body
for `POST /editions` (generated from `sampleGazetteEdition` in `packages/domain/src/gazette-sample.ts`;
every source is `example.org` and every headline is marked as a sample). To seed a development
Workspace, switch The Daily Planet on in Plugins, change `content.date` to today in its time zone,
and send the file with an Editor's session, or ask a connected assistant to publish it with
`publish_gazette_edition`.
