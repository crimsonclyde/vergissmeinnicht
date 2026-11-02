# Recipes and MCP — assessment and implementation proposal

2026-11-02. Owner requested both features and selected **recipe library plus grocery-list transfer**.
Owner clarified the first MCP release: **ordinary user tasks through a client such as Claude**, including
Procedure authoring, Run execution, shopping entries and recipe/image creation plus serving-scaled
shopping. Read and write scope is requested, with no administration. The design below incorporates
that direction; runtime implementation, OAuth/SDK selection and image-source integration remain work.

## What the repository already supplies

VMN is a Fastify/React/SQLite modular monolith. Workspace tools are bundled registrations, with
server-side capabilities and transaction-time actor/tool guards. There is no existing machine-client
authentication, OAuth authorization server, MCP route or API-key lifecycle. `Principal` is currently
resolved only from the authenticated session cookie (`apps/server/src/http/session.ts`). The current
same-origin/CSRF policy must remain intact for all browser routes.

Notes/Journal supplies reusable CommonMark/GFM editing and rendering. Attachments now separates HTTP,
application admission, consumer policy, metadata, storage and processing. Immutable consumer policy keys
prevent a weaker consumer from reading another feature's files. Quotas already aggregate attachments
per charged user, and shared files also count toward Workspace storage. A Recipe consumer needs its own
reviewed authorization, reference/lifecycle and backup adapter; borrowing Journal routes or its gate
would defeat the purpose of separation. Current cleanup deliberately retains unregistered policies.

Lists already supports ordinary grocery items with an optional positive decimal quantity (up to five
integer digits and three decimals), optional unit (16 characters), title (120 characters) and a 300-item
cap. Existing mutations/replay are authorized and audited, but the public application port has no
atomic recipe-to-list batch command. Repeated calls to add-item would permit partial transfers and
ambiguous retries; use a bounded atomic batch with a stable operation id instead.

Relevant seams: `packages/domain/src/list.ts`, `packages/application/src/lists/use-cases.ts`,
`packages/application/src/ports/list-repository.ts`, `packages/database/src/actor-guard.ts`,
`apps/web/src/tool-registry.ts`, `apps/web/src/markdown`, `packages/application/src/attachments`,
`packages/database/src/attachment-repository.ts` and the Workspace backup classification/restore paths.

## Recipes — proposed first version

A separate optional **Recipes** Workspace tool, off initially, with the existing Guide/classic menu,
personal order and phone More behavior. All current members read; USER/EDITOR/ADMIN manage, GUEST is
read-only, following Notes/Lists policy. Disabling hides routes and retains records. No new Today card,
notifications, meal-planning calendar, nutrition calculation or inventory. AI clients may supply recipe
content through the same validated creation command; VMN does not need an embedded text model.

A recipe has a title, optional description, servings, preparation/cooking time, bounded ordered
ingredients, Markdown instructions, tags, optional source link and original photographs. Search covers
title/ingredients/tags. Use explicit Save, optimistic revision checks and actor/time history; archive
is reversible. Keep domain Recipe separate from Procedure/Run and Note even though the editor is shared.

Initial ingredient fields: name, optional decimal amount, optional unit and optional preparation note.
Preserve nonnumeric wording such as “to taste” in the note; never coerce it to zero or guess an amount.
Owner now explicitly requires serving-based scaling. Preserve the base recipe and compute a shopping
projection using target servings / base servings in shared server-side domain code, with exact decimal/
rational arithmetic. Scale numeric ingredient amounts, preserve “to taste” wording and units, and never
infer unit conversions or dietary substitutions. If a result cannot be represented in the existing
List quantity precision/range, disclose it and resolve that value explicitly rather than truncating it.
Store bounded, versioned structured ingredient data
plus canonical CommonMark instructions. No proprietary inline ingredient syntax is necessary.

Use the shared image subsystem with `recipes` policy and typed Recipe references. Same original-byte,
derivative, SHA-256, quota and download guarantees apply. The user's central image allowance applies
across new attachment consumers, rather than giving each tool an independent allowance. Add consumer
registration to cleanup and full/Workspace recovery deliberately. No external source-page scraping or
remote-image fetching in the first version; a source URL is just a link.

### Grocery-list transfer — owner selected

1. Open a saved Recipe and choose **Add ingredients to grocery list**.
2. Select an existing grocery List in the same Workspace. Both tools must be on and the current actor
   must have Recipe read and List edit capabilities. Reading a Recipe never grants List write access.
3. Choose target servings and preview the scaled, selectable ingredients and editable name/quantity/unit values against existing List limits.
   Display unrepresentable amounts explicitly; do not truncate a unit/name or silently discard wording.
4. Confirm the exact selected additions. Append unchecked ordinary ListItems; do not silently merge
   similarly named foods, add quantities, convert units or re-open purchased items. These are copies,
   so later Recipe edits do not change someone's shopping List.
5. Apply the entire batch and required audit atomically, rechecking current membership, both tool gates,
   source/target revisions and the item cap. A stable operation id makes retries return the same result.
   If the source or destination changed, rebuild the preview rather than altering the reviewed batch.

Offer deliberate removal of the transferred batch only while its items remain unchanged; otherwise
show the changed items and let the user decide. No automatic deletion of grocery items after cooking.
No cross-Workspace transfer or offline batch replay initially. Existing individual offline List changes
keep their existing semantics. No new gamification award for copying ingredients as a bulk action.

### Portability and validation

Workspace backups include Recipe records and original files and exclude private Journal content.
Older supported packages without Recipes restore normally; restore rebuilds ids/references and earns
no points. Portable export is readable Markdown plus original images and structured ingredients in
standard JSON; evaluate schema.org Recipe JSON-LD for metadata, not as a new import/scraping service.

Tests: every role/tool boundary, foreign ids, stale edits, revoked membership, hostile Markdown/images,
original fidelity, shared quota accounting, old/current backup round trips, guest List writes, tool
disabling during transfer, changed source/List, item limits, audit rollback and concurrent/retried batch
confirmation. Browser checks: real recipe creation/edit, ingredients preview/edit/selection, retry and
conflict behavior, 320px/light/dark, keyboard and axe. Fixtures remain fictional.

## MCP — user-task scope selected by owner

An MCP endpoint is an adapter to reviewed application commands and queries. It must not become direct
SQL access, a shell, an arbitrary HTTP proxy, a database cleanup endpoint or a second implementation of
business rules. No extra queue, model server or distributed deployment is required for this adapter.

MCP does not perform speech recognition. A voice-capable client would transcribe/interpret the user's
request and call the same typed tools. Keep microphone capture and speech/model selection out of VMN's
first MCP implementation. Explicitly tell users which client/provider receives returned content.

### Transport and authentication options

- **Local desktop client:** stdio adapter with a dedicated scoped user credential, obtaining no database
  files, browser cookie or operator credential. Its calls still reach the authoritative application
  authorization layer. Do not grant access merely because the process is local or uses a VPN.
- **Remote client:** Streamable HTTP under HTTPS, with the MCP authorization/discovery flow and an
  established OAuth implementation. VMN has no such grant lifecycle today; select/review a maintained
  implementation first. Browser login and optional TOTP authorize a connection; this is delegated
  access for the existing internal User, not a new external login/account-linking provider.
- Shared typed handlers can support both later. Choose the first transport from the actual target
  client, not by inventing an unneeded local daemon or publishing an unauthenticated endpoint.

HTTP must validate Origins, token audience/resource and scope; no arbitrary reflected CORS or cookie
CSRF bypass. Separate browser and machine authentication policies explicitly. Never pass through client
provider tokens or accept an MCP session id as authorization. Validate credentials on every request,
including resumed streams; token/grant ids alone grant nothing.

### Delegated access

A connection is personally authorized, expiring, revocable, named and bounded to explicit Workspaces
and operations. Its effective permission is the intersection of current user capability, enabled tool,
Workspace policy and connection grant. Enforce that intersection again in mutation transactions and
bulk-plan application, so removal/demotion/disabling/revocation takes effect immediately. Do not accept
an actor id from tool arguments. TOTP challenge, disabled/IMPORTED identity and account recovery rules
must remain authoritative; identity recovery needs an explicit connection-revocation policy.

Instance switch off by default; no grants issued merely by enabling it. A Workspace policy for exposing
shared data to an external AI client needs an explicit owner decision; a member's grant cannot silently
reverse the existing Documents external-processing restriction. Exclude private Journal, originals,
OCR text, secrets, credentials, account administration and security settings initially. Broad access to
“everything the user can see” is not the default. Personal/private access needs a separate explicit
scope decision and never follows from Workspace admin rights.

Store secrets according to established library primitives: high entropy, hash at rest where usable,
short-lived access tokens, safe refresh/revocation, no URL/query credentials, no credential logging.
User sees/revokes connections in account settings; server admins can disable the integration without
reading private content. Full backups contain only necessary protected credential state; portable
Workspace backups exclude all client credentials, grants, tokens and cleanup plans.

### Tool catalog and cleanup proposal

Start with enabled-tool discovery, scoped search/read and the explicit user tasks below. Read/write
access is now requested, not a read-only final product. Normal clearly requested bounded additions or
step updates must not require the bulk-cleanup review workflow. Reuse existing validation, revisions,
audit and limits. No “execute anything” or “update arbitrary table” tool. Recipe transfer uses the same
reviewed application command as the UI, not a loop of independent AI writes.

For bulk cleanup, recommend **propose → review in VMN → apply**. Store an expiring plan bound to the
actor, client, Workspace, exact operations and expected revisions. A normal authenticated VMN user
reviews the exact diff; a model-supplied `confirmed: true` is not consent. Plans apply once, reauthorize
and reject stale scope/content. Preserve originals and historical Runs. Start with reversible archive
or organization changes, not permanent deletion, automatic merging or physical attachment deduplication.
A spoken “clean things up” requests a proposal; it does not identify records to destroy.

Instructions inside Notes/Recipes/Documents or tool results are untrusted content, never authority to
invoke another tool or widen a grant. MCP tool annotations are hints to clients, not server security
boundaries. Expose only bounded necessary fields; redact credentials/content from diagnostic logs and
record attributable client/action/result events without storing entire model prompts or private bodies.

### Phases and tests

1. Implement Recipes, serving projection and atomic Recipe-to-List transfer, with the shared image policy
   and recovery adapters; no embedded text/image model is required for the ordinary Recipes UI.
2. Implement reviewed revocable delegation and a standard MCP adapter, targeting Claude compatibility
   without hard-coding Claude into domain/application logic. Review maintained SDK/auth libraries first.
3. Expose discovery/read and the requested authoring/execution/shopping/meal writes with existing
   capability, revision, idempotency and audit rules. Validate against an actual supported client.
4. Add client-owned voice interaction using these same tools; treat bulk cleanup as a later optional
   catalog, not the purpose of the first release.

Tests include anonymous/wrong-audience/expired/revoked grants, refresh replay, foreign Workspaces and
objects, role/tool changes between preview and commit, MFA/disabled/imported identities, connection
isolation, JSON-RPC validation/size/rate bounds, Origin/DNS-rebinding checks, token redaction, prompt
injection fixtures, accidental private/OCR/original exposure, backup exclusions, stale/replayed cleanup
plans, audit rollback and duplicate invocation. Add integration tests with the chosen real MCP SDK
client; do not claim voice support from protocol unit tests alone.

## Selected everyday workflows — owner clarification, 2026-11-02

| Request | Authoritative application operation |
| --- | --- |
| “Add a step to the leaving-home Procedure” | Resolve the Workspace and Procedure; add a stable new Step under the selected Section using the expected Procedure revision. Preserve other Step ids and all existing historical Runs. Requires the user's existing procedure.edit capability (EDITOR/ADMIN), even through MCP. |
| “Step X is done” | Resolve the actual active Run and RunStep; use the existing execution state transition/audit command. Do not mark a Procedure definition complete or silently start/complete a whole Run. Ordinary USER execution rights apply; Required/Critical/skip rules remain authoritative. |
| “Add milk to the shopping list in Home” | Resolve an authorized Workspace/List, normalize the item and add it once. Ask only if the destination or quantity is ambiguous; a previously selected connection default can supply a clear destination. |
| “I want pancakes for four” | Find a suitable existing Recipe or accept a structured recipe proposed by the client; resolve/store an image, compute ingredients for four servings, then save the new Recipe (if needed) and apply the reviewed/requested shopping batch. |

The client interprets language; VMN resolves canonical ids and validates actual commands. Return concise
results with record links, actual servings/quantities and what changed, suitable for a spoken response.
“User tasks” does not grant the literal USER role Procedure-authoring rights it lacks in the web app.

### Meal workflow and image handling

- Reuse an existing chosen Recipe when appropriate instead of silently generating duplicates. If base/
  target servings or the destination are missing and no explicit default exists, ask for that detail.
- The AI client may propose new recipe text/ingredients. Store editable recipe data, not a prompt or a
  model-dependent executable format. Label generated content/provenance where applicable.
- The image must be actual validated uploaded bytes from the user/client or a deliberately configured
  image-generation/source integration. Store it through the same original-preserving attachment service,
  with normal ownership, size/quota/type checks. No unbounded remote-URL fetcher or invented stock photo.
- Claude alone does not inherently supply photo-generation capability; supporting an image requires an
  available image tool/provider or supplied file. This is an integration dependency to resolve, not a
  reason to silently substitute a placeholder and report that the pictured recipe is finished.
- Stage/validate images before canonical writes. Keep incomplete meal preparation explicit; do not report
  success with a missing image or a partial shopping list. Recipe creation/reference binding, List batch,
  operation result and audit must commit atomically under both tools' current guards. Existing Recipes
  are not changed just to shop for a different serving count.
- Tie a stable operation id to the normalized payload and caller/scope. Retried speech/tool requests with
  the same id must not create a second Recipe, duplicate uploads/charges or duplicate grocery entries;
  reusing an id for a different payload is refused. Changed source/List revisions require reconciliation.
- Ordinary explicitly requested writes can use the client interaction/confirmation appropriate to that
  task and the authorized grant. Bulk archive/merge/deletion still requires its distinct reviewed-plan
  policy; it must not become a blocking dialog for “add milk” or “step X is done”.

### Connection and privacy scope

Claude is the initial compatibility example; keep the protocol client-independent. Streamable HTTPS +
OAuth is the recommended first remote connector path. A separately supported local stdio path can serve
private-network installations later without exposing the whole server or changing user capabilities.
Remote Claude connectors are reached from Anthropic's infrastructure; do not promise that a cloud
connector can reach a LAN/VPN-only VMN server. Deployment reachability remains an installation choice.

Owner authorizes designing external-client assistance for the selected user task data: permitted
Procedure definitions/Run execution context, grocery Lists and Recipes, within selected Workspaces.
This narrowly extends the previous no-AI scope for that delegated interaction. It does not authorize
reading Documents/OCR, private Journal, contacts, credentials/security settings or unrelated Workspace
records. Owner subsequently selected OpenAI API image generation with a dedicated project key and an initial
roughly $10 budget; see the decision below. No other provider, image scraping or unrelated outbound AI
processing follows from that choice. Desktop versus independent-phone connectivity remains the practical
transport decision, not whether write support or pictured Recipes are wanted.

No external model call, public endpoint, stored API key, new recipe table or migration is created by this plan.
The existing Notes/Journal implementation remains intact. No release/deployment; owner count remains
43, next 44, and the special Release 42 dedication is preserved.

## Primary protocol references (checked 2026-11-02)

- [MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP tools and user interaction](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)

- [Claude remote connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [Claude image capabilities](https://support.claude.com/en/articles/9002504-can-claude-produce-images)

## OpenAI images and tailnet connectivity — owner follow-up (2026-11-02)

Owner selected OpenAI API image generation using a project key and suggested an initial $10 budget.
Use a dedicated OpenAI API project/key; VMN invokes the image endpoint server-side, supplies only the
recipe image prompt and stores validated generated bytes through the original-preserving attachment
pipeline. Claude never receives the provider key. Configure it as a protected deployment secret or a
sealed server-side credential with reviewed access; never in browser storage, source control, logs,
portable Workspace backups or tool output. Display generated provenance. This explicitly approved
recipe-image flow does not authorize sending Documents/OCR, private Journal or unrelated data to OpenAI.

Choose bounded quality/size/model settings, one image initially, reuse existing Recipe images and
implement generation count/spend admission with concurrency reservations. Persist a stable generation
job/result before allowing retries; handle uncertain billed/time-out results explicitly instead of
blindly issuing duplicate paid generations. Do not promise exact $10 billing from an approximate
budget, or unlimited images from ChatGPT subscription access. Record provider usage/estimated cost,
model and result independently of private prompt bodies.

Current official pricing example, not a final model commitment: GPT Image 1.5 medium 1024-square image
output is $0.034, so $10 covers about 294 image outputs before text input, retries and other charges.
Verify model availability/pricing again when implementing; older models may retire. Recipe image
quality should be evaluated against actual generated fixtures before choosing the default. No generation
or paid request was made during this assessment.

Connectivity clarification: Claude Desktop local MCP/desktop extensions run a local adapter. Such an
adapter can call VMN through that computer's tailnet connection, subject to routing/ACLs, HTTPS and VMN
user authentication. This is different from adding a remote connector in Claude settings: those calls
originate at Anthropic, including on phones, so being on the same tailnet does not by itself give the
cloud connector access. A standard stdio-to-VMN adapter is the proposed private desktop route; it calls
reviewed application endpoints with a scoped credential, not the database or a forwarded browser cookie.

Current Cowork documentation also describes local connectors on web/mobile through an open Claude
Desktop app. Treat that as a desktop-mediated mode to validate against the actual account/app version,
not direct phone-to-tailnet MCP and not a promise of phone access with the computer off. A selected
remote connector would need deliberately reachable HTTPS; no public tunnel or tailnet exposure is
configured by this decision. Remaining product choice: must mobile work independently with no desktop
running, or is a desktop bridge acceptable? Network reachability never replaces user authorization.

Sources checked:
- [OpenAI image API/pricing guide](https://developers.openai.com/api/docs/guides/image-generation)
- [OpenAI project permissions](https://developers.openai.com/api/docs/guides/rbac)
- [Claude local MCP setup](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)
- [Claude remote connector network requirements](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [Cowork desktop-mediated local connectors](https://support.claude.com/en/articles/15520349-use-claude-cowork-on-web-desktop-and-mobile)

## ChatGPT candidate and outbound private tunnel (2026-11-02)

Owner also has ChatGPT Plus and asks about using ChatGPT, including a possible Hetzner VPS on the
tailnet. Current official OpenAI documentation supplies a better private-transport candidate than
requiring a desktop to remain on: **Secure MCP Tunnel**. No account eligibility or setup is verified yet.

ChatGPT supports custom MCP plugins with read/write tools, subject to account/workspace restrictions.
Plugins available to an account can run on web/desktop/mobile unless marked Desktop only. Do not equate
this with a guarantee that a particular live voice mode can call every custom tool; test text/dictation
and the actual mobile workflow separately. Keep the ordinary application commands client-independent.

Secure MCP Tunnel runs `tunnel-client` inside the network that can already reach VMN. It opens outbound
HTTPS to OpenAI, receives queued MCP work and forwards it locally; the private MCP server needs no public
listener or inbound firewall opening. Proposed placement: beside the existing always-on VMN container,
calling its private Docker-network MCP endpoint. It does not need the owner's desktop or Tailscale if
both services already share that private network. A companion process/container remains necessary for
tunnel transport; it runs on the always-on server, not a user's switched-off computer.

The tunnel requires a Platform tunnel identity, a scoped runtime credential and the right ChatGPT/
Platform organization association and permissions. Those capabilities must be checked on the owner's
actual account; Plus alone is not evidence that every tunnel/custom-plugin feature is enabled. Use a
separate least-privileged tunnel credential, not the Recipe image provider key. VMN still authenticates
the delegated User and checks per-tool/Workspace/capability/revision/idempotency; tunnel identity is not
application authorization. OAuth discovery can traverse the tunnel, but the authorization server's
reachability must be designed and tested separately. A tunnel never grants VMN administrator operations.

A VPS is optional: run the same outbound tunnel client on a VPS that can reach VMN over the tailnet,
or run VMN there if deliberately migrating hosting. Neither arrangement needs a public inbound MCP
port for Secure MCP Tunnel. A publicly exposed MCP endpoint with source-IP firewall restrictions is a
different transport choice and still needs application authentication; no source-IP allowlist or public
exposure is approved/configured here. Prefer using the existing always-on host before buying another
server, migrating the application or operating an unnecessary network hop.

Recommended evaluation order: verify account custom-plugin/Tunnel access; implement ordinary VMN MCP
and auth; validate the tunnel on the existing container host; test authorized mobile user operations with
the desktop off. API image generation remains on the separately configured OpenAI project budget. No
assumption that a ChatGPT subscription automatically pays for server calls using that API key.

Sources checked 2026-11-02:
- [Add a custom MCP server](https://developers.openai.com/api/docs/guides/custom-mcp-server)
- [Secure MCP Tunnel: outbound transport, credentials and account associations](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
- [Plugins across web, desktop and mobile](https://learn.chatgpt.com/docs/plugins)
- [Voice availability and host requirements](https://learn.chatgpt.com/docs/features/voice)

This is an architecture recommendation based on documentation, not a tested installation. No VPS
purchased, account changed, tunnel created, secret read, subscription charged or network exposed.
