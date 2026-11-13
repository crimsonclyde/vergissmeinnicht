# AI assistant connections and Recipe images

MCP is optional and disabled by default. Set `MCP_ENABLED=true` and restart VMN to offer the
Streamable HTTP endpoint at `${PUBLIC_ORIGIN}/mcp` and **Profile & settings → AI connections**.
Enabling it does not publish a port, install a tunnel, grant an account access or enable image billing.
Use an HTTPS `PUBLIC_ORIGIN` for production; it may remain private Tailscale HTTPS. Existing
trusted-proxy/TLS deployment rules still apply.

## User authorization

Use a client supporting OAuth authorization-code flow, dynamic public-client registration (`none`),
PKCE S256, and resource indicators. Discovery is under `/.well-known/oauth-authorization-server` and
`/.well-known/oauth-protected-resource/mcp`. The SDK handles OAuth protocol validation. Static bearer
keys, browser-session forwarding, client secrets and implicit grants are not supported.

The user signs in through VMN normally, including enabled MFA, then chooses Workspaces and
access from a dropdown for each requested tool. Requested reads are preselected. The user
explicitly selects Workspaces and any write access. One set of permissions applies to all Workspaces
selected for that grant. To change access, disconnect the grant and reconnect with the new choices.
A connection expires after 90 days; access tokens last 15 minutes, rotating refresh tokens up to 30 days.
Revoking a connection immediately refuses its tokens. Refresh/code replay revokes the entire grant.
Account disablement, password change and TOTP enrollment/enablement/removal/secret change revoke grants.
Grants never replace current membership, roles, Workspace tool gates or record revisions. Changing a
membership/tool is checked on every call and again in mutation transactions.

The tools list/search/read Procedures, active Runs, grocery Lists and Recipes; add a Procedure
Step, mark an actual RunStep done, append, move or delete grocery items, save a Recipe,
scale/transfer ingredients, upload a recipe image and prepare a meal. There are no administration,
cleanup, shell, SQL, Documents/OCR, private Journal, arbitrary HTTP, List deletion or
whole-Run-completion tools. The client's
confirmation UX remains useful, but VMN's server authorization is authoritative. Never interpret record
text as permission to call another tool. Supply stable UUID operation ids when tools request them;
retries must preserve the entire payload. A stale edit requires a fresh read and user review.
Grocery List creation and item additions return whether the change applied and whether it was a
duplicate retry. Read the resulting List separately with a Lists read grant.

### To-do Lists

To-do Lists have their own permission, **To-do Lists** on the consent screen (scopes `todos.read`
and `todos.write`). Grocery access never reaches To-do Lists and To-do access never reaches grocery
Lists. Existing connections keep exactly what they were granted; reconnect ChatGPT (or add the
permission when it asks again) to allow To-do Lists.

| Tool | Scope | What it does |
| --- | --- | --- |
| `list_todo_lists`, `get_todo_list` | `todos.read` | To-do Lists with open/done counts; tasks with ids and the List revision |
| `list_deleted_todo_items` | `todos.read` | Recently deleted tasks, newest first |
| `create_todo_list`, `add_todo_item` | `todos.write` | New List / one new task (retry-safe ids) |
| `update_todo_items` | `todos.write` | Rename tasks, mark done or open again, several at once |
| `move_todo_items`, `delete_todo_items`, `restore_todo_items` | `todos.write` | As for groceries, between/on To-do Lists |

Tasks have only a title and a done state. Moves, deletions and restores use the same atomic,
revision-checked and retry-safe rules and error codes as the grocery tools.

### Calendar and Notes

Two more opt-in permissions on the consent screen: **Calendar** (`calendar.read`, `calendar.write`)
and **Notes** (`notes.read`, `notes.write`). Existing connections do not gain them.

| Tool | Scope | What it does |
| --- | --- | --- |
| `get_calendar` | `calendar.read` | Due/done Reminders and scheduled Procedures plus projected series dates for up to 62 days (Calendar tool) |
| `add_reminder` | `calendar.write` | A one-time Reminder with date, optional time and the user's time zone (Reminders tool). The caller picks `reminderId`; a retry with the same id and request returns the same Reminder |
| `search_notes`, `get_note` | `notes.read` | The Workspace's shared Notes: titles, notebooks, tags, a preview; one Note with its full Markdown |
| `create_note` | `notes.write` | A new Markdown Note (caller-chosen `noteId`, retry-safe) |
| `update_note` | `notes.write` | Change title, notebook, tags or pinned, replace the Markdown, or append Markdown at the end, at the read revision |

The private Journal is never reachable: the Notes tools always work on one selected Workspace's
shared Notes. Notes keep their revision history as in the app.

### Recipe fields and archive

With **Recipes write** access, `update_recipe_fields` changes only the named fields of a Recipe at
its read revision (title, servings, tags, categories, prep/cook minutes, source, private, the whole
ingredient list, the instructions, or `appendInstructions`); everything else, including the photo,
stays as it is. `archive_recipe` archives a Recipe or brings it back; nothing is deleted.
`search_recipes` takes `archived: true` to find archived Recipes.

### Errors

Every failed tool call has `isError: true`, a short text and `structuredContent.error` with a
stable `code` and a fixed `message` (never record content), plus `fields` (argument paths),
`itemIds` or a refused file `host` where that helps.

| Code | Meaning |
| --- | --- |
| `permission_denied` | Scope, role or Workspace not allowed for this connection. Nothing changed. |
| `tool_disabled` | The VMN tool (Lists, Recipes, …) is switched off in the Workspace. Nothing changed. |
| `tool_unavailable` | The tool is not offered to this connection. |
| `not_found` | Unknown, deleted, or another Workspace's record. Nothing changed. |
| `stale_revision` | The record changed since it was read: read again, review, retry with a new operation id. Nothing changed. |
| `limit_reached` | A Workspace or record limit. Nothing changed. |
| `invalid_arguments` / `invalid_value` | Arguments do not match the schema / a value breaks a rule (`fields` names it). Nothing changed. |
| `run_not_active` | The Run is finished. Nothing changed. |
| `not_confirmed` | The change may have happened (for example access was revoked during the call). Read again and retry only with the same operation id and payload. |

Tool-specific codes stay as before: the grocery batch codes below, `recipe_cover_required`,
`invalid_recipe`, the ChatGPT file codes (`file_source_invalid`, …, `file_reference_required`) and
the image codes (`attachment_*`).

### Move and delete grocery items

With **Lists write** access, `move_grocery_items` moves chosen items from one grocery List to
another grocery List of the same Workspace, and `delete_grocery_items` deletes chosen items
(checked or not) from one grocery List. Each is one atomic operation: every named item is moved or
deleted, or nothing changes.

| Tool | Required arguments | Answer |
| --- | --- | --- |
| `move_grocery_items` | `workspaceId`, `sourceListId`, `destinationListId`, `itemIds` (1–100), `operationId`, `expectedSourceRevision`, `expectedDestinationRevision` | `outcome: "MOVED"`, `duplicate`, `movedItemIds`, `sourceList` and `destinationList` with their new revisions |
| `delete_grocery_items` | `workspaceId`, `listId`, `itemIds` (1–100), `operationId`, `expectedRevision` | `outcome: "DELETED"`, `duplicate`, `deletedItemIds`, `list` with its new revision |

- The assistant reads the Lists with `get_grocery_list` (needs **Lists read**), shows exactly
  what will change, waits for the user's approval and then calls the tool once with the read
  revisions. It does not ask again after an explicit approval of that exact change.
- Moved items keep their ids, titles, quantities, units and checked state and are appended to the
  destination. Entries with the same title are never merged or replaced.
- Deleting is the same as removing an item in VMN: the item can be restored.
- Retrying with the same `operationId` and the same arguments returns the first answer with
  `duplicate: true` and changes nothing. A new request needs a new `operationId`.
- Refusals carry `structuredContent.error.code`: `permission_denied`, `list_not_found` (also for
  another Workspace's or a To-do List), `same_list`, `kind_mismatch`, `stale_revision` (read the
  List again and review), `invalid_items` (with the unusable `itemIds`: unknown, already deleted
  or on another List), `duplicate_item_ids`, `operation_reused`, `limit_reached`,
  `invalid_operation_id` or `invalid_arguments`. Nothing changed in any of these cases.

Refresh VMN's tools in ChatGPT after upgrading so the two tools appear.

### Edit, tick off and restore grocery items

With **Lists write** access, `update_grocery_items` changes items of one grocery List in one
atomic operation: rename, change quantity or unit (or clear them with `null`), tick off as bought
(`checked: true`) or put back on the list (`checked: false`). `list_deleted_grocery_items` (needs
only **Lists read**) shows the recently deleted items of a List, and `restore_grocery_items` puts
chosen ones back at their old places with their quantity, unit and checked state.

| Tool | Required arguments | Answer |
| --- | --- | --- |
| `update_grocery_items` | `workspaceId`, `listId`, `items` (1–100, each `itemId` plus any of `title`, `quantity`, `unit`, `checked`), `operationId`, `expectedRevision` | `outcome: "UPDATED"`, `duplicate`, `updatedItemIds`, `list` with its new revision |
| `list_deleted_grocery_items` | `workspaceId`, `listId` | the List's `id`, `title`, `revision` and up to 100 `deletedItems` (newest first, with `deletedAt` and `deletedBy`) |
| `restore_grocery_items` | `workspaceId`, `listId`, `itemIds` (1–100), `operationId`, `expectedRevision` | `outcome: "RESTORED"`, `duplicate`, `restoredItemIds`, `list` with its new revision |

- Fields left out of an item edit stay as they are. Ticking an item that is already ticked keeps
  the first tick. To-do tasks are not reachable through these grocery tools.
- When the user says what they bought, the assistant ticks those items off without asking again;
  it asks only when it is unclear which items are meant.
- Retries and refusals work as for move and delete. Extra codes: `empty_edit` (an item edit names
  no field) and `invalid_item_values` (empty title, a quantity that is not a positive number, or a
  unit that is too long). For a restore, `invalid_items` names ids that are not deleted items of
  that List.
- In the web app, deleted items appear under **Recently deleted** at the end of each List, with
  an undo button per item, for everyone who may edit the List.

## ChatGPT with the computer switched off

Start with the [private VMN to ChatGPT runbook](chatgpt-mcp-tunnel.md) for setup, a copyable
assistant prompt and live troubleshooting.

The verified transport is OpenAI **Secure MCP Tunnel**, with `tunnel-client` on the same always-on host
or private Docker network as VMN. It needs outbound TLS to OpenAI, not an inbound public MCP port.
No VPS or desktop relay is required if the existing host can run it. VMN's `/mcp` endpoint continues to
require the user's OAuth token; the tunnel credential never grants application access.

Before installing anything, verify the account's custom-plugin/Tunnel access, Platform organization
association and supported OAuth public-client registration. ChatGPT Plus alone does not establish
these entitlements. Follow the [Secure MCP Tunnel documentation](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
and the [compatibility review](../development/mcp-tunnel-oauth-review.md). The configuration below
targets released **tunnel-client v0.0.19**, source
`01d67bb4da0d8359b808b4761f8db171ab682cd7`; it has been checked against that release's
[Dockerfile](https://github.com/openai/tunnel-client/blob/01d67bb4da0d8359b808b4761f8db171ab682cd7/Dockerfile)
and [configuration reference](https://github.com/openai/tunnel-client/blob/01d67bb4da0d8359b808b4761f8db171ab682cd7/docs/configuration.md).
The same-origin HTTPS topology passed live hosted OAuth and tool calls on Unraid with VMN 0.12.1.
The Docker hardening example below was reviewed against the release source and needs its own validation.

### Same-origin HTTPS for v0.0.19

Keep VMN's existing `PUBLIC_ORIGIN`, for example `https://vmn.example-tailnet.ts.net`. Configure the
tunnel's MCP target as that exact origin plus `/mcp`, rather than an internal Docker HTTP address.
Both the user's browser and the tunnel container must independently resolve/reach this HTTPS address
and verify its certificate. A Docker bridge does not itself join the tailnet or supply its DNS.
Do not alter proxy trust, disable TLS verification, publish ports or reuse VMN's Tailscale state to
solve a routing failure. Verify the intended private path in a separately authorized sandbox first.

VMN publishes the canonical issuer with its root slash (`https://vmn.example-tailnet.ts.net/`) in
both discovery documents; the resource remains exactly `https://vmn.example-tailnet.ts.net/mcp`.
Authorization, registration and token URLs remain HTTPS on that origin, without an extra path slash.
No tunnel identifier or Harpoon URI is emitted by VMN.

The released client registers known same-origin OAuth machine targets. The supported hosted shim can
carry registration/token/revocation requests through Harpoon while browser authorization stays at
VMN's private `/authorize` and `/account/connections`. It does not tunnel the whole authorization
server. An unregistered HTTPS machine endpoint remains direct and may fail from a cloud OAuth caller.
See the released [OAuth flow](https://github.com/openai/tunnel-client/blob/01d67bb4da0d8359b808b4761f8db171ab682cd7/docs/architecture.md#oauth-protected-mcp).

Do not use `harpoon.oauth_forward_origins`, `HARPOON_OAUTH_FORWARD_ORIGINS` or
`--harpoon.oauth-forward-origin`: **v0.0.19 does not have that capability**. Discovery trust alone
does not grant forwarding to the different HTTPS origin advertised by an internal Docker HTTP target.
Do not substitute host-suffix wildcards, generic Harpoon targets or application-side URI rewriting.

### Docker configuration assumptions (example only)

No deployment is authorized by these examples. For an approved isolated test, verify the official
v0.0.19 artifact/provenance and pin its digest before starting it. The released image includes
`ENTRYPOINT ["/usr/bin/tunnel-client", "run"]`; Compose `command` supplies flags, not another `run`.
The Dockerfile's `EXPOSE 8080` does not publish a host port. Keep the loopback health listener and
omit `ports`, host networking and remote UI access.

An operator-owned `tunnel-client.yaml` uses the released schema (replace only the placeholders):

```yaml
control_plane:
  tunnel_id: REPLACE_WITH_DEDICATED_TEST_TUNNEL
  api_key: file:/run/secrets/tunnel-runtime-key
mcp:
  server_urls:
    - channel: main
      url: https://vmn.example-tailnet.ts.net/mcp
health:
  listen_addr: 127.0.0.1:8080
log:
  level: info
```

Leave poll channels unset to preserve the released default main/Harpoon handling; configuring only
`main` would disable the machine OAuth route. No static MCP bearer/header injection is configured.
The runtime credential is separate from VMN user OAuth and the Recipe image key; it needs Tunnels
Read/Use only. Reference an operator-managed protected key file; never put its value in YAML,
Compose, command arguments or chat. No key is created by VMN or by this documentation.

A reviewable Compose excerpt for the later test is:

```yaml
services:
  tunnel-client:
    image: ghcr.io/openai/tunnel-client:v0.0.19 # Replace with its verified immutable digest before use.
    command: ["--config", "/run/config/tunnel-client.yaml"]
    user: "65532:65532"
    read_only: true
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    pids_limit: 128
    mem_limit: 256m
    cpus: 1.0
    tmpfs:
      - /tmp:rw,noexec,nosuid,size=16m,uid=65532,gid=65532,mode=0700
    environment:
      LOG_HTTP_RAW_UNSAFE: "false"
      HARPOON_CAPTURE_PAYLOADS: "false"
    volumes:
      - type: bind
        source: ./tunnel-client.yaml
        target: /run/config/tunnel-client.yaml
        read_only: true
        bind:
          create_host_path: false
      - type: bind
        source: /absolute/operator-owned/tunnel-runtime.key
        target: /run/secrets/tunnel-runtime-key
        read_only: true
        bind:
          create_host_path: false
```

The source Dockerfile does not select a non-root user; the excerpt selects a numeric UID explicitly.
Both mounted files and their paths must be readable by that UID, with the key restricted to it. The
read-only/temp/resource bounds are proposed hardening to validate with the selected image, not
observed runtime results. No Docker socket, production data, Tailscale state, host-root mount or
Cloudflare companion is needed. Do not launch a public relay bundled in the image. No restart policy
is enabled for this temporary test; use one poller and stop it explicitly on failure/completion.

For a non-container profile, the equivalent initialization uses the same private HTTPS target:

```sh
tunnel-client init --profile vmn --tunnel-id YOUR_TUNNEL_ID --mcp-server-url https://vmn.example-tailnet.ts.net/mcp
```

Run `doctor` before the test runtime. With the container image, override the entrypoint to
`/usr/bin/tunnel-client` for `doctor --config /run/config/tunnel-client.yaml --explain` or CLI help;
otherwise Docker appends these after `run`. Keep runtime health/admin access within the container's
loopback namespace. Do not open a port just to inspect readiness.

**Integration gate:** local tests verify VMN metadata equality, DCR, code/PKCE exchange, exact resource
binding, token refresh/rotation/replay, MFA and current authorization. They do not verify the hosted
service's shim or this Docker/Unraid network. Before calling the integration ready, confirm discovery
and the OAuth-role target catalog, browser MFA/consent, actual DCR `none`, canonical issuer/resource
through exchange/refresh, a read-only synthetic call and revocation. The hosted product must retain
the newest refresh token. VMN accepts omitted or identical refresh scopes; narrowing is refused.
After an uncertain refresh, reauthorize instead of replaying the old token, which revokes the grant.
MCP content and OAuth artifacts pass through OpenAI; private listeners do not mean local-only data.
Live initial linking and scoped reads and writes passed. Hosted refresh after expiry and revocation
remain separate checks. The detailed isolated test and rollback
plan is in the [review](../development/mcp-tunnel-oauth-review.md#isolated-docker-integration-and-rollback-plan-for-unraid).
Test text/dictation from the phone with the desktop off, reconnects, token renewal/revocation and
retries. Native live voice calling custom tools is a separate client capability, not guaranteed here.
Claude can use the same standard MCP/OAuth endpoint when its client can reach it; its cloud connector
cannot be assumed to join the tailnet.

On abort/completion, stop only the test poller, revoke the synthetic VMN grant, remove the dedicated
test connector/tunnel and revoke its runtime key, then remove test-only files/volumes. A stopped
poller or deleted connector alone does not revoke VMN credentials. No production DB rollback is needed;
the existing Tailscale-only installation must remain untouched.

## Using VMN from ChatGPT

**Profile & settings → AI connections** lists each connection's grant, expiry and token-exchange
status. **Run local checks** produces a copyable report with the browser's endpoint statuses and
aggregate exchange counts. For the Docker host report and the end-to-end grocery read, see the
[troubleshooting runbook](chatgpt-mcp-tunnel.md#troubleshoot-the-first-failed-checkpoint).

When more than one authorized Workspace or grocery List matches, the assistant should ask
which one to use. Name both in the request to skip that question. For a meal, pick a recipe,
provide the serving count, and say which ingredients you already have. VMN scales the
quantities for the grocery List. For a Procedure edit, name the Procedure and Section.
When marking a Step done, identify the active Run and Step if their names are ambiguous.

To use a picture generated in ChatGPT, copy the image where the client offers that action.
In the VMN Recipe editor, open **Images and originals** and choose **Paste copied image**.
If clipboard image access is unavailable, upload the saved PNG or JPEG with the file picker.
The editor inserts the local attachment reference. Supply that reference to ChatGPT for
the meal tool if ChatGPT is saving the Recipe. The editor upload requires a signed-in VMN
session with Recipe write access.

Users can give ChatGPT a single request to create a pictured Recipe in a named Workspace.
VMN does not generate images. For a Recipe found on the web, ChatGPT creates a picture with its
own native image generation. For a cookbook import, ChatGPT extracts the original photo. Both
paths upload the actual image file to VMN, then save the Recipe and verify its cover:

1. Search for an existing Recipe to avoid duplicates (`search_recipes`).
2. Generate the image with the assistant's own image generation, if it has one.
3. Upload the actual image file with `upload_recipe_image_file` and `recipeId: null`.
4. Use the returned attachment reference as `coverImage`.
5. Put the returned Markdown image in the Recipe instructions.
6. Create the Recipe with `create_recipe` and `requireImage: true`.
7. Read the Recipe back with `get_recipe` and verify the saved cover.

If generation or upload fails, the assistant reports it and does not create the Recipe without
the required image. It must never invent image references, file paths or upload success. VMN
needs no OpenAI API key for any of this, and the VMN Recipe editor still accepts photos uploaded
by hand.

### Removed: server-side image generator (36.17)

The optional VMN image generator (`generate_recipe_image`, the **Create an AI recipe image**
panel and its OpenAI provider) was removed because ChatGPT kept assuming VMN creates the image.
`OPENAI_RECIPE_IMAGE_KEY`, `OPENAI_RECIPE_IMAGE_KEY_FILE`, `RECIPE_IMAGE_MONTHLY_LIMIT` and
`RECIPE_IMAGE_USER_MONTHLY_LIMIT` are no longer read; a container that still sets them starts
normally, and the secret file can be deleted. Images the generator created earlier are ordinary
Recipe attachments (named `AI-generated-OpenAI-<model>-<date>.png`) and keep working as covers,
previews, downloads, exports and backups. The old `recipe_image_jobs` table is left untouched
and unused.

Connection grants, token hashes, client registrations and meal/transfer
operation records are excluded from portable Workspace backups. Full server backups contain database
security state and must be protected like the running database; restoring one restores that point in
time, including its connection state. Deployment secrets are backed up separately. Regenerate/revoke
connections after a security recovery as appropriate.


### Discovery routing (0.12.1)

Both `/.well-known/oauth-authorization-server` and its trailing-slash variant return identical
200 `application/json` metadata. The same applies to `/.well-known/oauth-protected-resource/mcp`
and its trailing-slash variant. Unknown discovery paths return 404 JSON, never the web app shell;
discovery remains unavailable when MCP is disabled. The issuer (including its root slash),
`/authorize`, `/token`, `/register` and `/mcp` URLs have not changed.

Registration continues to use the SDK's RFC 7591 JSON protocol: successful public-client registration
returns 201 JSON with `client_id`, issue time and the actual registered metadata, without a client
secret or an application grant; invalid metadata returns 400 JSON. Clients must explicitly request
`token_endpoint_auth_method: "none"`. RFC 7591 section 2 defaults omission to `client_secret_basic`,
which VMN does not support; rejecting omission preserves the existing public-only requirement.
The server selects and returns `authorization_code`/`refresh_token` grants and `code` responses;
section 3.2.1 allows replacing requested metadata. Unsupported optional metadata is not retained.
HTTPS (or HTTP loopback) redirects, no credentials/fragments, input bounds, rate limits, PKCE,
authenticated consent/MFA and Workspace authorization all remain enforced.
See [RFC 7591 sections 2 and 3](https://www.rfc-editor.org/rfc/rfc7591.html).
This protocol review and local regression coverage do not establish hosted tunnel interoperability
or require public access; the isolated live-integration gates above still apply.

## Upload an image generated in ChatGPT

ChatGPT uses `upload_recipe_image_file`, described in the next section. The picker and base64
upload below remain for other MCP clients.

Refresh the VMN tool list after upgrading. Recipe write access exposes `open_recipe_image_upload`
and `upload_recipe_image`. In a ChatGPT client that renders the upload widget, open the tool for the
chosen Workspace and existing Recipe (or use a null Recipe ID for a new Recipe). Download the
generated JPEG or PNG from ChatGPT, select that original in the widget and press **Upload original
to VMN**. Continue in the chat with the returned reference. The assistant includes the Markdown in
the Recipe instructions, selects the returned reference as the cover and reads the Recipe back.
The signed-in VMN Recipe editor also accepts the file if the client does not display the widget.

Programmatic MCP clients can call `upload_recipe_image` with the actual RFC 4648 base64 bytes,
`fileName`, `workspaceId`, nullable `recipeId` and a UUID `operationId`. Send the exact same
arguments on retries. The MCP route accepts originals up to 20 MB, subject to any lower VMN upload
limit and storage quotas. For a separate proxy, allow around 27 MB on `/mcp` for the encoded upload.
Ordinary calls remain limited to 128 KiB. The photo upload uses no VMN image-generation API key.
Availability and upload size over a particular hosted ChatGPT or tunnel configuration require a live
check. [OpenAI documentation for the ChatGPT tool bridge](https://developers.openai.com/plugins/reference)

## Manage List covers

After upgrading, reconnect the MCP client with the **List cover images** permission
(`lists.covers.write`) for the Workspaces you choose. Existing grocery grants keep their
original scope. Use `list_cover_targets` to select a Shopping or To-do List and get its
current revision. `open_list_cover_upload` opens the picker in clients that support it.
Programmatic clients can call `upload_list_cover` with the List ID, original JPEG or PNG bytes
as canonical base64, the filename and a stable operation ID. It uses the same 20 MB MCP
ceiling and shared quotas as Recipe photos.

Use `set_list_cover` with the reviewed revision and the uploaded attachment ID to set or
replace the cover. Send a null cover ID to remove it. Only perform the change the user
requested. The tool returns the saved revision and cover ID. Hosted picker support depends
on the client. The signed-in List appearance editor provides an upload path in VMN.

## Recipe categories

Recipe content takes an optional `categories` array from a fixed list: `starter`, `soup`,
`salad`, `main`, `side`, `dessert`, `baking`, `breakfast`, `snack`, `sauce`, `drink`,
`cocktail`. A Recipe may have several. The server instructions ask the assistant to set at
least one for every new Recipe and to keep existing categories on edits. `get_recipe` and
`search_recipes` return `categories` (empty for older Recipes). `search_recipes` also takes
`categories` (matches any of them) and `sort` (`newest`, `updated`, `title`). An unknown
category is refused.

## Upload an image already available in ChatGPT

ChatGPT uploads the image file first with `upload_recipe_image_file` (`openai/fileParams`),
then saves the Recipe with the returned reference as `coverImage` and the returned Markdown in
the instructions (see the workflow above). With `requireImage: true`, nothing is saved without
a cover. JPEG, PNG and WebP are accepted; VMN converts WebP to PNG. Since 36.17,
`create_recipe` and `prepare_recipe_meal` no longer take an `image` file, and
`set_recipe_image` was removed: for an existing Recipe, upload with its `recipeId` and save it
with `save_recipe`. List covers use `upload_list_cover_file` and then
`set_list_cover`.

The two everyday flows:

- **Recipe from a PDF**: attach the PDF and ask ChatGPT to save the recipe with its photo.
  ChatGPT extracts the original photo as a separate image file and uploads it.
- **Recipe from a question or link**: ChatGPT creates a picture with its own image generation
  and uploads it.

After upgrading, refresh the VMN tools in ChatGPT and open a fresh chat. ChatGPT then sees
the file routes `upload_recipe_image_file` and `upload_list_cover_file`. The base64 tools
(`upload_recipe_image`, `upload_list_cover`) and the picker tools stay available to other MCP
clients.

VMN downloads the file from ChatGPT's temporary storage link. It accepts
`files.oaiusercontent.com`, regional hosts such as `sdmntprdenmarkeast.oaiusercontent.com`
or `sdmntswcentralus.oaiusercontent.com`, and the Azure storage account
`oaisdmntprnortheu.blob.core.windows.net`. If ChatGPT uses another storage host, the tool
error names it (for example `Refused host: oaisdmntprwesteurope.blob.core.windows.net`) and
the server log records it. After checking that it is an OpenAI storage host, add it to the
container variable `MCP_CHATGPT_FILE_HOSTS` (comma-separated exact names, up to 10, only
below `oaiusercontent.com` or `blob.core.windows.net`) and restart the container. No new
release is needed.

Error codes:

- `file_reference_required` means VMN did not receive a valid file object.
- `file_source_invalid` means the object's download URL was malformed or unsafe.
- `file_origin_unsupported` means the storage host is not accepted yet; see above.
- `file_unavailable` means the file host refused the link or no longer serves it.
  Ask ChatGPT for a fresh link for the same file and keep the operation ID.
- `file_download_failed` means VMN could not complete the download.
- `recipe_cover_required` means `requireImage` was set but no image arrived.

For cookbook imports, leave `source` empty unless you have an HTTP or HTTPS URL.
Keep a cookbook title or PDF filename in the instructions. Put a positive number,
fraction or supported descriptive amount such as “etwas”, “a pinch”, “to taste” or
“q.b.” in `amount`. Preserve the wording in the recipe's language. For “etwas
Tomatenmark / Paprikasauce”, use `amount: "etwas"`, `name: "Tomatenmark / Paprikasauce"`
and an empty unit. Use the ingredient note for preparation details. Serving changes
carry descriptive amounts through as written. Set the recipe's `servings` and the
requested target to null when the source gives no serving count. The projection then
reports `baseServings: null` and uses the amounts as written. Delegated Shopping List transfers store numeric quantities,
so transferred items with a descriptive amount have an empty quantity by default.

The base64 and picker tools remain available. VMN does not extract photos from a PDF in
this flow. Whether ChatGPT can expose a newly extracted file and which host it uses for
that file require live verification. [OpenAI file input documentation](https://developers.openai.com/plugins/reference#define-file-inputs)

For existing Recipes, read the current Recipe and use `save_recipe` at its reviewed
revision. Add the returned image Markdown, replace only the selected image after a
successful upload, or remove only that image's Markdown. Update or omit `coverImage`
if it referred to the replaced or removed image. Read the Recipe back to verify the
result. Earlier originals follow the existing Recipe attachment retention policy.


## Default Recipe creation workflow (0.13.10)

New Recipes are public in VMN's authenticated shared cookbook by default.
Set `content.private: true` only for a requested Private Recipe; on edits keep the
existing setting. Existing Recipes and old operation retries are not republished.
Public does not mean an anonymous internet page. MCP access still requires the
home Workspace in the connection grant.

For a web recipe, ChatGPT uses its own image tool. For a cookbook PDF, ChatGPT
extracts the recipe and original photo. Both prefer native `upload_recipe_image_file`
with the actual JPEG/PNG. Only a client capable of passing real bytes programmatically
should use the base64 fallback. The optional VMN server generator is not part of
these workflows. Confirm the upload, save with `requireImage: true`, image Markdown
and the returned cover reference, then read back the cover and privacy choice.
Refresh the connected VMN tools after deploying 0.13.10 so ChatGPT receives these
updated tool descriptions, schemas and server instructions.
