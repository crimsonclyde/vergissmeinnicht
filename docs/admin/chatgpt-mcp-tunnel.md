# Connect a private VMN instance to ChatGPT

Use this runbook to connect VergissMeinNicht (VMN) to ChatGPT with OpenAI Secure MCP Tunnel,
or give it to ChatGPT or Codex to guide the setup. The known working combination was
**VMN 0.12.1 and tunnel-client v0.0.19 on Unraid**, with VMN served privately over Tailscale HTTPS.
The live test confirmed ChatGPT OAuth sign-in, tool discovery, scoped grocery reads and writes,
and saving a pictured Recipe with a serving-scaled grocery transfer.

Run the tunnel client on an always-on machine that can reach VMN. It polls OpenAI over outbound
HTTPS. The VMN endpoint can stay private and the setup computer can be switched off. OpenAI
still receives the data returned by tool calls. [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)

## Prompt to copy into ChatGPT or Codex

Attach this page, or give the assistant its repository path, `docs/admin/chatgpt-mcp-tunnel.md`.
Fill in whatever you already know. Use placeholders for identifiers you prefer to keep private.

```text
Help me connect my private VergissMeinNicht instance to ChatGPT through OpenAI Secure MCP Tunnel.
Use the attached VMN runbook and check the current official OpenAI docs and tunnel-client help.

VMN version and host type:
Private HTTPS VMN origin (no path):
Tunnel-client host and version, if already running:
Intended OpenAI Platform organization and ChatGPT workspace:
Test VMN Workspace and grocery List:
What I tried and the exact error, if any:

Inventory and reuse my existing setup first. Tell me which checks you can run and give me
one precise local command or browser action for each check you cannot run. Keep SSH access
limited to the VMN container and its tunnel checks. Have me enter credentials, sign in, and
review consent in my own browser. Never request secrets, raw Docker inspect output, or full
OAuth callback URLs. Keep the VMN listener private and verify TLS.

Check private HTTPS from the browser and the tunnel container separately. Check the exact
MCP URL, OAuth discovery, tunnel readiness and dispatch, and ChatGPT plugin tool exposure as
separate checkpoints. If consent succeeds but linking fails, correlate sanitized HTTP
statuses by UTC time. Report the first failed checkpoint before changing configuration.

Use OAuth dynamic client registration and one test VMN Workspace with Workspace and Lists read
scopes. Finish with a real ChatGPT tool call that finds and reads the chosen grocery List.
Ask which Workspace or List I mean if several match. Report only the list name and item count.
```

Codex can help inspect a terminal or browser it can access. In a chat without that access,
run the commands locally and give the assistant only status codes and redacted observations.
A Codex-assisted setup and a ChatGPT tool call are separate checkpoints. For direct use from
Codex, verify support in the specific Codex surface and OpenAI organization you intend to use,
then repeat the OAuth and tool-call checks there. The VMN live test used ChatGPT.

## 1. Check the three access boundaries

- **VMN.** Use a version with the OAuth discovery corrections in 0.12.1 or later. The instance
  operator sets `MCP_ENABLED=true` and restarts VMN using its normal deployment process. Keep
  `PUBLIC_ORIGIN` at the real private HTTPS origin, such as `https://vmn.example-tailnet.ts.net`.
  Enable Lists in the test VMN Workspace and prepare a grocery List the test account can read.
- **OpenAI Platform.** Select the organization that owns the tunnel. Its operator needs
  **Tunnels Read + Manage** to create or edit it. The runtime key and plugin operator need
  **Tunnels Read + Use**. Associate the tunnel with the intended ChatGPT workspace as well as
  the Platform organization. [OpenAI tunnel permissions and associations](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels#permissions-and-access)
- **ChatGPT.** Use the intended workspace in ChatGPT on the web. Verify that workspace policy
  lets the account add and use a custom MCP server. [OpenAI custom MCP server setup](https://developers.openai.com/api/docs/guides/custom-mcp-server)

These are separate permissions. The tunnel runtime key authenticates the poller to OpenAI.
The VMN user signs in separately and consents to specific VMN Workspaces and actions.

## 2. Verify the private HTTPS path

Open VMN in the actual browser that will handle authorization. On a phone, that browser
also needs a working route to VMN. For a Tailscale setup, check that the device is on the
tailnet and can sign in normally, including MFA if enabled.

Run these checks from the network context of `tunnel-client`, not merely from the host
shell. A Docker bridge can have different DNS and routes from the host. Use the existing
container network or an operator-approved probe in the same namespace.

```sh
vmn_origin='https://vmn.example-tailnet.ts.net'
curl -sS --max-time 10 -o /dev/null -w '%{http_code}\n' "$vmn_origin/mcp"
curl -fsS --max-time 10 "$vmn_origin/.well-known/oauth-protected-resource/mcp"
curl -fsS --max-time 10 "$vmn_origin/.well-known/oauth-authorization-server"
```

Expect **401** from unauthenticated `/mcp` and **200 JSON** from both discovery URLs. Check
that `resource` is exactly `https://vmn.example-tailnet.ts.net/mcp`, the first
`authorization_servers` entry equals the authorization server's `issuer` including its
trailing slash, and the advertised authorization, registration and token URLs are on the
same HTTPS origin. Use normal certificate verification. If DNS or TLS fails, fix that
private path before changing the tunnel target.

## 3. Start the tunnel and verify dispatch

Create or reuse a tunnel in Platform. Use the official tunnel client and check
`tunnel-client help quickstart` for the installed version. Configure the runtime key
through a protected operator-managed secret. Keep it separate from VMN OAuth and any
optional Recipe image API key. [OpenAI tunnel client setup](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels#set-up-tunnel-client)

Point the main MCP target at the **exact private HTTPS VMN origin plus `/mcp`**.
The live failure used an internal Docker HTTP target while VMN advertised HTTPS OAuth
URLs. The poller was ready, but discovery and account linking failed. With v0.0.19,
same-origin HTTPS let the client register the OAuth machine targets used by the hosted
flow. The user's browser still opened VMN directly for sign-in and consent. Keep the
default poll channels for that version so the OAuth machine requests can be dispatched.
[Docker configuration and OAuth details](mcp.md#same-origin-https-for-v0019)

Run `tunnel-client doctor --profile vmn --explain` for a named profile, or the equivalent
with `--config` for a file-based deployment. Start the poller and check its local
`/readyz` and dispatch state. An HTTP 200 from readiness confirms the poller is ready.
Check actual dispatch during a discovery or tool-call attempt as a separate step. Keep
the admin and health listener local and raw HTTP logging off.

On Unraid, a container created from the shell may have no template edit button. Review its
actual command, config mounts, network mode and restart policy locally. If you replace a
dedicated poller to change the target, preserve that launch configuration and keep the
previous container stopped for rollback until the new one passes readiness and a live
call. Run one poller for the test. Avoid sharing raw container inspection output, which
can include environment secrets.

Persist shared Docker networking in the Unraid template. If the tunnel uses a dedicated
network such as `vmn-mcp`, select that same network in VMN's saved **Network Type**.
A one-off `docker network connect` is lost when Unraid recreates the container.
After any recreation, verify both a live MCP read and VMN readiness; readiness alone
does not prove the tunnel can reach its upstream. On Anubis, the 2026-11-10 diagnostic
recreation exposed a saved Bridge setting while OpenAI-Tunnel used `vmn-mcp`.
Saving Custom : vmn-mcp restored a successful live `list_workspaces` call.
 [Docker example](mcp.md#docker-configuration-assumptions-example-only)

## 4. Connect and prove it works in ChatGPT

1. In ChatGPT on the web, open **Plugins → Add custom MCP server**. Name it **vmn** if that
   name is available. Select **Tunnel**, select the intended tunnel, and choose **OAuth**
   with **Dynamic Client Registration**. VMN supports public-client DCR (`none`) with
   PKCE, so leave static OAuth credentials unset. Review the notice and create the plugin.
   [OpenAI custom MCP server setup](https://developers.openai.com/api/docs/guides/custom-mcp-server)
2. Connect the plugin and sign in to VMN. In VMN consent, select just the intended test
   Workspace and the read permissions **Workspaces: names and my role** and **Read grocery
   Lists**. Return to ChatGPT and verify the plugin shows tools. Check tool enablement in
   plugin details and refresh after server changes.
3. In a new chat, type `@` and select the plugin. Ask it to list the authorized Workspaces,
   find the grocery List in the intended Workspace, and read it. The following prompt
   verifies the call without printing grocery contents.

   > Use @vmn to list my authorized Workspaces and find the grocery List in my test Workspace.
   > Ask me to choose if more than one Workspace or List matches. Read the selected List and
   > report only its name and item count. Make no changes.

A successful call should be visible in ChatGPT and in the corresponding VMN MCP request
statuses. If you need writes, separately approve the relevant Lists or Recipes write
scopes. Verify a single agreed test write by reading it back, then clean it up in VMN.
The original pictured-meal test used the VMN Recipe editor. From VMN 0.13.2, a Recipes write
grant can also use the ChatGPT upload widget to select and send a downloaded photo through MCP.
After refreshing the tools, verify that the client displays the picker and read back the saved
Recipe and cover. [Recipe image upload](mcp.md#upload-an-image-generated-in-chatgpt)

## Verify an upgrade with test data

Refresh the plugin's tools in ChatGPT after upgrading VMN, then open a fresh chat. Use
disposable Workspaces and lists for the following checks. Give two authorized Workspaces a
List named **Shopping**, and give one of them a second grocery List. Keep a third Workspace
out of the grant. Run the write checks only after separately approving Lists write access.

| Ask ChatGPT | Expected result |
| --- | --- |
| “Add test tea to Shopping.” | ChatGPT asks which Workspace. Both Shopping lists stay unchanged. |
| “Add test tea to my grocery list in Test Kitchen.” | With two Lists in Test Kitchen, ChatGPT asks which List. Neither List changes. |
| “Add one test tea to Shopping in Test Kitchen.” | Only Shopping in Test Kitchen receives one item. Read it back and verify the other lists in VMN. |
| “Read Shopping in the unselected test Workspace.” | ChatGPT reports it cannot access that Workspace. It does not substitute another Shopping list. |
| “Mark Prepare done.” when two authorized active Runs have a Prepare Step | ChatGPT asks which Run before marking anything done. |
| “Add this Recipe's ingredients to Shopping in Test Kitchen.” without a serving count in the conversation | ChatGPT asks how many servings before adding groceries. |
| “Move test tea and test milk from Shopping to my second List in Test Kitchen.” | ChatGPT reads both Lists, names the two items and the destination and waits for your OK. After it, one call moves both; quantities and checked state are kept and no duplicate appears. |
| “Delete the checked items from Shopping in Test Kitchen.” | ChatGPT lists exactly those items and waits for your OK. After it, only they are deleted; unchecked items stay. |

Record only pass/fail and the first failed checkpoint. Remove the test item in VMN and
disconnect the disposable grant when finished. A lost ChatGPT response can still leave a
completed write in VMN. Check the destination before retrying, and preserve the original
operation ID if the client can retry the same call. If checking token renewal, repeat the
read after the initial 15-minute access token expires without reconnecting. Verify the
token exchange and subsequent tool call using their status and UTC time.

## Recover an existing connection

- **Expired or disconnected.** Reconnect from the assistant and review the VMN consent
  again. Confirm the new grant in **AI connections** and repeat the grocery read.
- **OAuth completes, but the tool catalog looks stale after an upgrade.** Refresh the
  plugin in ChatGPT, check tool enablement and try a fresh chat. Confirm the expected
  scopes in VMN. To change them, disconnect the old grant and reconnect with the intended
  access.
- **A tunnel change broke a working connection.** Stop the replacement poller, restore
  the known-good launch configuration, and start only that poller. Check readiness and
  the upstream before retrying the grocery read. A tunnel rollback is separate from a
  VMN application or database rollback.

## Troubleshoot the first failed checkpoint

In VMN, open **Profile & settings → AI connections → Run local checks**. The report gives
the browser's endpoint statuses, whether the discovery metadata matches, and counts of your
active grants with and without a recorded token exchange. Use **Copy diagnostics** to share
it. An issued token is evidence of OAuth exchange. The grocery read still verifies the
assistant can use it.

On the Docker host, an operator with Docker and network namespace access can run this
read-only diagnostic from a trusted VMN checkout. Substitute your container names and
HTTPS origin. The host needs Bash, Docker, curl, jq, nsenter and timeout.

```sh
bash deploy/mcp-diagnostics.sh VergissMeinNicht OpenAI-Tunnel https://vmn.example-tailnet.ts.net
```

Run it just after one failed attempt. It reports container state, recognizable image
versions, loopback readiness on the default port, upstream HTTPS and discovery, and recent
allowlisted VMN route statuses with UTC timestamps. The upstream probe uses the tunnel
network namespace with the host's curl, DNS configuration and CA store. If it disagrees
with the tunnel client's own checks, inspect the container's resolver and trust store.
An empty log sample can also mean request logging is unavailable, outside the time window,
or cut off by the sample limit. Use the tunnel client's local status to verify polling and
dispatch when the HTTP statuses alone leave that unclear.

| Symptom | Check next |
| --- | --- |
| Tunnel missing in ChatGPT | Check the association with the **ChatGPT workspace**, the Platform organization's Tunnels Use permission, and workspace policy for custom MCP servers. |
| Poller running, but readiness or polling fails | Check runtime key permissions, tunnel identity and outbound HTTPS to OpenAI. Container process state alone is insufficient. |
| Ready, but OAuth discovery fails or DCR is unavailable | Check the configured upstream from the poller's network. Verify same-origin HTTPS, certificate validation, the unauthenticated MCP challenge, both metadata documents and the default OAuth dispatch channel. |
| VMN consent succeeds, then ChatGPT reports an account connection error | Note the UTC time of one retry. Correlate status codes for `POST /api/account/mcp/approve`, `POST /token` and `POST /mcp`. If consent is 200 and no token request arrives, inspect OAuth dispatch. If `/token` arrives and fails, inspect redacted failure classes for DCR, callback, PKCE and resource binding. |
| Plugin exists but shows zero tools | Check its selected tunnel, OAuth connection, grant scopes, and tool enablement. Refresh plugin details and try a fresh chat. The old registration in our test stayed empty after the tunnel fix. A fresh registration on the same working tunnel exposed tools. |
| Create button is disabled or the name already exists | Fill in the name and review the trust notice. If the name is taken, inspect the existing plugin first. Reuse it if its tunnel and OAuth settings match, or use a distinct diagnostic name. |
| Tools show, but records or writes are missing | Check the VMN consent grant, current membership and role, the Workspace tool switches, and the selected Workspace and List. Grant only the scopes needed for the intended task. |

For assisted diagnostics, prefer a local operator or a temporary, expiring SSH key with a
forced command that returns only fixed VMN and tunnel status fields. If you use one, keep
it available through the agreed test window and retire it when done. Share UTC times,
route paths and statuses. Keep tokens, authorization codes, callback query strings, raw
payloads and unrelated server logs out of the chat. To retire a test connection, revoke
the grant under VMN **Profile & settings → AI connections** and remove the diagnostic
plugin. If the tunnel and runtime key were dedicated to that test, stop the poller and
retire them too.
