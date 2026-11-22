# Ask VMN inside VergissMeinNicht

Server admin → **AI** (`/admin/connections`) separates **Ask VMN**, chat inside VMN,
from **External assistants**, the existing ChatGPT/MCP integration. Each has its own
configuration and status. Ask VMN works with `MCP_ENABLED=false` and an offline tunnel.
Installing this version enables neither native chat nor Workspace lookup automatically.
Existing grants, consent return addresses, file approvals, diagnostics and backups survive.
The Daily Planet continues to use its existing external assistant grants.

## Enable on Unraid

Ask VMN is included in 0.17.3 and remains disabled until configured.
Create a **dedicated OpenAI project API key**, with permission to create Responses. Keep
this key separate from the tunnel runtime key and from keys used by other applications.
Enter it directly into a protected file on the operator's machine; do not paste it into
VMN, chat, shell history, reports or a Docker environment screenshot.

With the standard Unraid VMN template:

| Setting | Exact value |
| --- | --- |
| Host secrets directory | `/mnt/user/appdata/vergissmeinnicht/secrets` |
| Container path | `/run/secrets` (read-only; already in the template) |
| New host file | `/mnt/user/appdata/vergissmeinnicht/secrets/ask_vmn_openai` |
| Container variable | `ASK_VMN_OPENAI_KEY_FILE=/run/secrets/ask_vmn_openai` |
| File owner and mode | `99:100`, `0400` with the standard PUID/PGID |
| Secrets directory mode | `0700`, owner `99:100` |
| MCP / tunnel | No change required; MCP may remain off |

After saving the key in that file, these commands set its permissions without displaying it:

```sh
chown 99:100 /mnt/user/appdata/vergissmeinnicht/secrets/ask_vmn_openai
chmod 0400 /mnt/user/appdata/vergissmeinnicht/secrets/ask_vmn_openai
```

Apply the saved template and restart VMN. If using different PUID/PGID, the file must be
readable only by that application identity. An existing installation can add the optional
variable manually; updating the template does not enable chat. `ASK_VMN_OPENAI_KEY` is
supported for secret-injecting environments, but do not set it together with `_FILE`.
There is no default key, no reuse of the tunnel key and no image-generation key.
Outbound HTTPS goes only to `https://api.openai.com/v1/responses`; redirects are refused.

In Server admin → AI → Ask VMN:

1. Check that the **dedicated chat credential** says configured. This checks presence only.
2. Choose a monthly cap in USD (for example **5.00**), enable Ask VMN and explicitly Save.
   The supported model is pinned to `gpt-5.4-mini-2026-03-17`; the selector documents that choice.
3. Optionally run **Test OpenAI (billable)**. It sends `Reply with OK.` and checks an actual
   completed streamed Responses API request using the configured key/model. It consumes the
   same allowance as chat, sends no Workspace records, and makes a separately billed API call.
   A successful test describes that test, not future availability or ChatGPT/tunnel health.
4. To allow lookups, enable the server lookup switch and Save. A Workspace admin must also
   explicitly allow Ask VMN in **Workspace settings → Plugins → Ask VMN**. The same switch is
   available under the chat's Workspace policy disclosure. It is off for every Workspace
   on upgrade and for newly created/restored Workspaces. The existing Workspace-wide **AI assistants allowed** switch must also remain on. Members then choose lookup mode in chat.

OpenAI receives submitted questions, prior messages in that conversation, and the limited
matching excerpts used to answer a Workspace question. General mode sends no Workspace
records or Workspace identifier. API usage is billed separately from ChatGPT Plus. VMN sets
`store:false` and does not use provider-hosted conversations; this does not promise that the
provider has no retention under its own applicable data policy. Read the provider terms for
your project. VMN does not send files, private Journal entries or private Recipes.

## Spending and failure states

The cap is a **VMN admission limit based on estimates**, not an OpenAI invoice or project-wide
billing limit. Billing periods are UTC calendar months, assigned when VMN admits the turn.
A turn admitted just before midnight stays in that admission month, including a response
finishing in the next month. Other applications, taxes, currency conversion and provider price
changes are outside the estimate. Also configure the dedicated OpenAI project's billing limits.

The reviewed price table is $0.75 per million input tokens and $4.50 per million output tokens
for the pinned model, forcing Standard processing (`service_tier: default`) and ignoring cached-input discounts. Prices
live in `packages/application/src/ask.ts`, the model allowlist in the server adapter/settings,
and the setup copy. Changing the model or prices requires a reviewed code update and a new
reservation-bound check; arbitrary operator-entered models/prices are deliberately unavailable.
[Model and pricing](https://developers.openai.com/api/docs/models/gpt-5.4-mini),
[Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create).

Every turn and connection test reserves **$0.10** in a SQLite IMMEDIATE transaction **before**
contacting the provider. All accounts/tabs share the server cap; an account has at most one
active turn. A request ID can be admitted only once. A fresh ID/retry still needs a fresh
reservation. Deleting chat does not delete charges. Lowering the cap stops new admission;
responses already admitted keep their reservation and may finish.

At most two provider calls run in a turn: one forced read-only search plus an answer, or one
general answer. There are no automatic retries, parallel tool calls, writes, browsing or MCP
calls. Each call has at most 2,048 output tokens. Input JSON is bounded to 6,000 UTF-16 code
units before search and 10,000 after excerpts (at most 24/40 KB UTF-8), with a fixed short
instruction/tool envelope. $0.10 safely exceeds the combined worst-case token cost at these
prices. Provider streams are bounded to 1 MiB and a turn to 90 seconds.

Known completed usage replaces the reservation with the rounded-up token estimate. A failed,
stopped, disconnected, malformed or otherwise uncertain turn retains the full reservation.
A process restart never refunds an unresolved reservation. The pending count includes such
unresolved attempts; a 120-second activity lock allows another turn after an interrupted
process, while the money remains charged. Operators cannot clear reservations through the UI.
A new month starts a new allowance; deleting/restoring the server database can lose billing
history, so use normal backup discipline. The cap assumes all processes use the same database.

- **Off:** no provider request is made.
- **Credential missing:** configure the dedicated mount; no provider request is made.
- **Monthly allowance cannot cover another request:** less than $0.10 remains available;
  existing reservations count even when actual provider usage is unknown.
- **Provider request failed:** the key may lack permission/credit, the network may have failed,
  or the provider may have refused/returned an invalid stream. Raw provider errors never reach
  reports. Check the OpenAI project separately without sharing its key, then retry deliberately.
- **Workspace context unavailable:** a current membership, policy, tool or referenced record
  changed. Start a new conversation after resolving access; old context is never silently reused.

Usage reports contain only month, estimated/reserved cost, request count and unresolved count.
They do not expose accounts, prompts or conversations. Conversations are private to their owner,
including from VMN server/Workspace administrators through the application. Full server backups
necessarily contain the database; portable Workspace backups exclude chats, policies and billing.
An owner can delete a conversation, or **all my conversations**, including histories that have
become inaccessible after membership loss. Provider-side retention and older server backups
are unaffected by local deletion.

## External assistants

The second section retains the existing grants and pending OAuth consent, acting account,
Workspaces, allowed actions, expiry/disconnect, file-source review, and copy/report diagnostics.
**AI safety backups** lists the automatic whole-server backups protecting external write actions.
A failed backup prevents the external change. Restore remains an operator CLI action. Technical checks and the
[tunnel runbook](chatgpt-mcp-tunnel.md) are behind their own disclosure. MCP enablement remains an
operator environment setting. Native chat availability and tests say nothing about tunnel health.

If chat is switched off later, owners with saved history still have the Ask VMN entry to read
and delete it. New sends are disabled. Workspace context restrictions continue to apply.

[Reviewed desktop and phone examples](../../assets/screenshots/ask-vmn-2026-11-22/README.md) use fictional data and mocked answers.
