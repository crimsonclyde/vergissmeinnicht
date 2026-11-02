# AI assistant connections and Recipe images

MCP is optional and disabled by default. Set `MCP_ENABLED=true` and restart VMN to offer the
Streamable HTTP endpoint at `${PUBLIC_ORIGIN}/mcp` and **Profile & settings → AI connections**.
Enabling it does not publish a port, install a tunnel, grant an account access or enable image billing.
Use an HTTPS public origin for production; existing trusted-proxy/TLS deployment rules still apply.

## User authorization

Use a client supporting OAuth authorization-code flow, dynamic public-client registration (`none`),
PKCE S256, and resource indicators. Discovery is under `/.well-known/oauth-authorization-server` and
`/.well-known/oauth-protected-resource/mcp`. The SDK handles OAuth protocol validation. Static bearer
keys, browser-session forwarding, client secrets and implicit grants are not supported.

The user signs in through VMN normally, including enabled MFA, and explicitly chooses Workspaces and
scopes on the consent screen. Read scopes are preselected; Workspace choices and write scopes are not.
A connection expires after 90 days; access tokens last 15 minutes, rotating refresh tokens up to 30 days.
Revoking a connection immediately refuses its tokens. Refresh/code replay revokes the entire grant.
Account disablement, password change and TOTP enrollment/enablement/removal/secret change revoke grants.
Grants never replace current membership, roles, Workspace tool gates or record revisions. Changing a
membership/tool is checked on every call and again in mutation transactions.

The initial tools list/search/read Procedures, active Runs, grocery Lists and Recipes; add a Procedure
Step, mark an actual RunStep done, append a grocery item, save a Recipe, scale/transfer ingredients,
generate a recipe image and prepare a meal. There are no administration, cleanup, shell, SQL,
Documents/OCR, private Journal, arbitrary HTTP, delete or whole-Run-completion tools. The client's
confirmation UX remains useful, but VMN's server authorization is authoritative. Never interpret record
text as permission to call another tool. Supply stable UUID operation ids when tools request them;
retries must preserve the entire payload. A stale edit requires a fresh read and user review.

## ChatGPT with the computer switched off

The candidate transport is OpenAI **Secure MCP Tunnel**, with `tunnel-client` on the same always-on host
or private Docker network as VMN. It needs outbound TLS to OpenAI, not an inbound public MCP port.
No VPS or desktop relay is required if the existing host can run it. VMN's `/mcp` endpoint continues to
require the user's OAuth token; the tunnel credential never grants application access.

Before installing anything, verify the account's custom-plugin/Tunnel access, Platform organization
association and supported OAuth public-client registration. ChatGPT Plus alone does not establish
these entitlements. Get the official tunnel client from the OpenAI repository, verify its published
release/checksum and follow the current [Secure MCP Tunnel documentation](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).
A typical operator-owned profile is initialized with:

```sh
tunnel-client init --profile vmn --tunnel-id YOUR_TUNNEL_ID --mcp-server-url http://vmn:3000/mcp
```

Use a separate runtime credential restricted to the tunnel's Read/Use permissions, stored in a
protected secret/profile file. Never reuse the Recipe image key, commit a profile or put credentials
in a shell command or Compose file. Run the profile's `doctor`, then `run`, following the installed
client's help. Keep it alive beside VMN with your host's existing container/service manager. Configure
the custom ChatGPT plugin for that tunnel and OAuth. No tunnel binary/configuration or service has been
installed automatically by this implementation.

**Integration gate:** tunneled MCP discovery does not automatically tunnel the OAuth authorization
server. The sign-in/consent URL must be reachable by the user's browser and the token endpoint must be
reachable by the client making the exchange. A phone in the tailnet only solves the browser part if
ChatGPT's token exchange is cloud-originated. Validate that flow on the actual account before treating
this deployment as ready; do not disable OAuth to bypass it. Public OAuth exposure, another relay or
hosting changes require a deliberate deployment decision. The current code does not add those changes.
Test text/dictation from the phone with the desktop off, reconnects, token renewal/revocation and
retries. Native live voice calling custom tools is a separate client capability, not guaranteed here.
Claude can use the same standard MCP/OAuth endpoint when its client can reach it; its cloud connector
cannot be assumed to join the tailnet.

## Optional OpenAI Recipe images

Configure a dedicated OpenAI project key with image-generation permissions in a deployment secret:
`OPENAI_RECIPE_IMAGE_KEY_FILE=/run/secrets/vmn_recipe_images` (absolute path), or
`OPENAI_RECIPE_IMAGE_KEY`. Set exactly one. The key never goes to browsers/MCP clients or portable
Workspace backups. API usage is billed separately from a ChatGPT subscription. Set the project's own
budget/alerts before enabling it; a roughly $10 starting budget is the owner's intended setup, not an
application-enforced dollar balance or a promise about OpenAI billing limits.

Only the explicit image description is sent to the fixed official Images API endpoint. No Recipe
library, user identity, Documents, private Journal, original images or credentials are sent in that
request. The reviewed adapter uses `gpt-image-1.5`, one 1024×1024 PNG at low quality, at most 2,000 prompt
characters, a 90-second timeout, 12 MiB response/8 MiB decoded-image bounds and no redirects/retries.
Model/quality changes need a deliberate code/pricing review. Live image quality has not been evaluated
with the owner's project; tests use synthetic PNGs and a mocked provider.

Local admission defaults to **100 attempts per UTC month server-wide** and **10 per account**, across
Workspaces. Override `RECIPE_IMAGE_MONTHLY_LIMIT` (0–10000) and
`RECIPE_IMAGE_USER_MONTHLY_LIMIT` (0–1000); zero disables admission. At most two recent jobs run per
server and one per account. These are conservative request caps, not dollar accounting. All admitted
attempts count, including failures/uncertain outcomes; there is no automatic credit/refund or retry.
Attachment quota admission occurs before provider dispatch. Retained originals and previews/thumbs
then use the existing shared image quotas; Documents retain their independent limits.

Each request has a durable UUID and payload hash. Repeating it returns the same result/status without
another generation; changing its payload is refused. A timeout/crash after dispatch is uncertain and
may have incurred a charge. Keep the id and reconcile the provider request outside VMN before manually
starting another. An interrupted STARTED job is conservatively reported as uncertain on retry. A failed
meal commit can leave an explicitly reported provisional image; retain its returned link to retry the
same reviewed meal after resolving the conflict. Unbound images follow normal staging cleanup.

Generated originals are uploaded without alteration, with visible `AI-generated-OpenAI-<model>-<date>`
filenames and suggested AI-illustration captions. They are illustrative, not photos of the user's meal.
Separate previews/thumbnails, hashes, original downloads, exports and backups work as for uploads.
A new meal requires a stored image reference before Recipe/List/audit changes commit atomically; stale
list revisions or audit failures roll back all those content changes. Image billing itself cannot be
rolled back with a database transaction. Serving fractions that cannot fit grocery quantities require
explicit review through the normal ingredient-transfer flow rather than silent rounding.

Connection grants, token hashes, client registrations, job admission/retry records and meal/transfer
operation records are excluded from portable Workspace backups. Full server backups contain database
security state and must be protected like the running database; restoring one restores that point in
time, including its connection state. Deployment secrets are backed up separately. Regenerate/revoke
connections after a security recovery as appropriate.
