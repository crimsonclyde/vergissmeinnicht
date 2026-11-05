# Secure MCP Tunnel OAuth compatibility review

Review date: 2026-11-05. Status: **owner approved the minimal issuer correction, targeted tests and
deployment documentation; local implementation is recorded in ledger 36.7. Live integration remains
unapproved and untested.** The assessment below preserves the original findings and proposed gates;
G1 is addressed by reusing the SDK-generated issuer in PRMD, with no resource or origin change.

## Recommendation

Keep `PUBLIC_ORIGIN` and the browser authorization/consent flow on private Tailscale HTTPS. First test a tunnel whose MCP target is that **same HTTPS origin**, rather than `http://vmn:3000/mcp`. The reviewed public tunnel client can discover and register the same-origin machine endpoints without VMN advertising tunnel-specific URLs. No public application listener or authentication exception is needed.

Propose one small, client-independent metadata correction and additional protocol tests after approval. Do not add configurable token/registration URLs, resource aliases, or Harpoon URI support to VMN preemptively. An internal Docker MCP target with OAuth on a different origin is an alternative requiring a newer forwarding capability that is present on upstream `master` but absent from the latest public release inspected here.

This is source-supported compatibility, **not a successful hosted integration**. Account eligibility, the deployed tunnel-service shim, issuer/resource treatment, DCR request shape, token rotation and browser handoff must still pass the isolated test below. Failure is not permission to expose OAuth publicly or relax VMN authorization.

## Reviewed versions and evidence

VMN checkout: `4d6136fcb36e36e8c2e87f9bfd5cc84c341f45ae`; installed MCP TypeScript SDK **1.32.2**. Inspected:

- [OAuth adapter](../../apps/server/src/mcp/oauth.ts), [MCP transport](../../apps/server/src/mcp/http.ts), [account consent routes](../../apps/server/src/http/mcp-account-routes.ts), [repository](../../packages/database/src/mcp-repository.ts), [composition](../../apps/server/src/composition.ts).
- [Origin guard](../../apps/server/src/http/origin-guard.ts), [logging](../../apps/server/src/logging.ts), [consent UI](../../apps/web/src/McpConnections.tsx), [sign-in shell](../../apps/web/src/App.tsx), [existing MCP tests](../../apps/server/src/http/mcp.test.ts), installed SDK router and authorization/token/registration handlers.
- `AGENTS.md`, this project's execution ledger, security policy, relevant architecture section 36 and [operator guide](../admin/mcp.md). The owner's running Tailscale host/configuration was not accessed.

Official upstream sources were fetched, not inferred from search snippets:

| Reference | Revision and purpose |
| --- | --- |
| [OpenAI Secure MCP Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) | Live documentation accessed 2026-11-05: private network requirements, product setup and OAuth caveat. |
| [Latest public release v0.0.19](https://github.com/openai/tunnel-client/releases/tag/v0.0.19) | Published 2026-10-30; resolved source `01d67bb4da0d8359b808b4761f8db171ab682cd7`. Release availability must be rechecked before an approved test. |
| [Released architecture](https://github.com/openai/tunnel-client/blob/01d67bb4da0d8359b808b4761f8db171ab682cd7/docs/architecture.md#oauth-protected-mcp) | Browser authorization and machine endpoint shim contract. |
| [Released registration policy](https://github.com/openai/tunnel-client/blob/01d67bb4da0d8359b808b4761f8db171ab682cd7/pkg/runtimeharpoon/host_registration.go#L321) | Same-origin resource/source records seed registration; separately discovered origins do not automatically gain forwarding. |
| [Current source](https://github.com/openai/tunnel-client/commit/fb43d565373123433b02b4972e734514e9f37875) | `master` at review: `fb43d565373123433b02b4972e734514e9f37875`, 2026-11-05. Not evidence that this source is in a released binary or deployed hosted service. |
| [Discovery](https://github.com/openai/tunnel-client/blob/fb43d565373123433b02b4972e734514e9f37875/pkg/oauth/resource_meta.go), [AS metadata](https://github.com/openai/tunnel-client/blob/fb43d565373123433b02b4972e734514e9f37875/pkg/oauth/auth_meta.go), [URL bundle](https://github.com/openai/tunnel-client/blob/fb43d565373123433b02b4972e734514e9f37875/pkg/oauth/hostbundle.go) | Challenge and well-known candidates, issuer diagnostics and endpoint-role records. |
| [Current registration policy](https://github.com/openai/tunnel-client/blob/fb43d565373123433b02b4972e734514e9f37875/pkg/runtimeharpoon/host_registration.go#L404), [configuration](https://github.com/openai/tunnel-client/blob/fb43d565373123433b02b4972e734514e9f37875/docs/configuration.md#oauth-forwarding-origins) | Separate discovery and forwarding approvals. |
| [Response transformation](https://github.com/openai/tunnel-client/blob/fb43d565373123433b02b4972e734514e9f37875/pkg/runtimeharpoon/transform.go#L58) | Exact registered URL rewriting and protected-resource audience preservation. Identical resource-preservation logic exists in the inspected release. |
| [Separate-origin upstream test](https://github.com/openai/tunnel-client/blob/fb43d565373123433b02b4972e734514e9f37875/e2e/oauth_forwarding_e2e_test.go#L185) | Real client binaries against a mock tunnel service, including canonical resource preservation and refusal of unapproved endpoints/redirects. Not a real ChatGPT OAuth test. |
| [Connector limitations](https://github.com/openai/tunnel-client/blob/fb43d565373123433b02b4972e734514e9f37875/docs/connectors.md), [Docker deployment](https://github.com/openai/tunnel-client/blob/fb43d565373123433b02b4972e734514e9f37875/docs/deployment/docker.md) | Transport limits and image/provenance guidance. |

## Existing protocol compared with the tunnel

Use `P = https://vmn.<tailnet>.ts.net` as an illustrative origin, not an actual deployment address. VMN normalizes `PUBLIC_ORIGIN` to a URL origin without a trailing slash; its resource is exactly `P/mcp`.

| Area | VMN today | Compatibility assessment |
| --- | --- | --- |
| Unauthenticated MCP | `/mcp` rejects missing/invalid bearer with 401 and `WWW-Authenticate: Bearer resource_metadata="P/.well-known/oauth-protected-resource/mcp"`. Browser cookies alone do not work. | Matches tunnel challenge discovery. Do not make initialize or tools/list anonymous. |
| Protected-resource metadata | Path-specific GET; `resource=P/mcp`, `authorization_servers=[P]`, supported scopes. | Path matches discovery candidates. Root fallback is not necessary while this path/challenge works. |
| AS metadata | GET `/.well-known/oauth-authorization-server`; SDK emits issuer `P/`, HTTPS `/authorize`, `/token`, `/register`, `/revoke`; code + refresh grants, S256. VMN advertises only `none` for token/revocation client auth. | Endpoints and grants fit the shim. **Issuer string mismatch with `[P]` is confirmed**; see G1. |
| Authorization | SDK validates registered client/redirect, code response, S256 and scope; provider creates a 10-minute pending request and 302 to `P/account/connections?request=<opaque-id>`. | Browser stays on tailnet. Normal sign-in/MFA then authenticated, same-origin consent API; no session cookie is required by the tunnel. |
| Consent/callback | Explicit Workspace/scope choice; decline returns `access_denied`; approved callback receives state and a five-minute code. | Product callback must match the registered HTTPS URI. Do not treat illustrative test callback paths as OpenAI's actual current callback contract. |
| DCR | POST JSON, public clients explicitly specifying `token_endpoint_auth_method=none`; at most five safe HTTPS/loopback redirects; UUID client id; no secret. Rate and total registration limits. | Shim can carry registration POSTs. Whether the selected hosted product sends this public-client metadata needs observation. Missing auth method defaults in the SDK to a secret-based mode which VMN refuses. |
| PKCE/exchange | SDK verifies S256 verifier, then atomic repository exchange checks client, redirect, resource and expiry. Duplicate form keys refused, body bound 16 KiB. | Keep standard form POST bytes, verifier and redirect intact through Harpoon. No OpenAI-specific cryptographic logic needed. |
| Resource binding | Authorization defaults an omitted resource to `P/mcp`; any explicit other resource is refused. Token/refresh permit omission but reject an explicit foreign resource; access-token verification also checks the stored resource. | Secure default; shim-facing transport addresses must not become extra accepted audiences. Hosted round-trip remains unverified; see G4. |
| Refresh | Opaque hashed credentials; 15-minute access, rotating refresh up to 30 days, grant maximum 90 days. Refresh accepts omitted scope or exactly the existing scope set, not a subset. Reuse revokes the grant. | Refresh goes through the same token endpoint. Product must retain the newest refresh token. Concurrent refresh/retry and narrowed-scope behavior need testing, not weaker replay rules. |
| Revocation/permissions | Owned revoke plus OAuth `/revoke`; account/security changes revoke grants. Every tool rechecks current actor, selected Workspaces, roles and tool gates, including mutation transactions. | Tunnel credential grants no VMN access. Transport must preserve these checks and forward only the user's bearer to MCP. |
| Origin/logging | Machine endpoints permit absent Origin or existing explicit allowed origins; cookie consent still requires exact `PUBLIC_ORIGIN`. Query strings and bearer/cookie headers are redacted; request bodies are not request-logged. | No reason to broaden Origin/proxy trust. Capture synthetic-secret logging negatives and check upstream raw logging/history remain off. |

Refresh rotates refresh credentials; existing access tokens retain their own expiry unless the grant is revoked. Code replay revocation occurs only after the SDK's PKCE check reaches the repository. The current tests exercise refresh replay, not every code-replay/error path.

## Discovery, Harpoon and the browser/machine split

The client probes the configured MCP URL for a challenge, then tries the advertised resource metadata and path/root well-known candidates. Discovery is constrained to operator-trusted origins. From the resource document it uses **only `authorization_servers[0]`**, fetches AS metadata and builds tagged URL records for the resource/source, AS/issuer, metadata URL, token, registration, revocation and optional JWKS/introspection endpoints. The metadata's authorization endpoint is deliberately absent from the auto-registration list. [Discovery and URL bundle source](https://github.com/openai/tunnel-client/blob/fb43d565373123433b02b4972e734514e9f37875/pkg/oauth/hostbundle.go#L294).

Harpoon registers admitted exact targets with OAuth roles/groups. Its response transformation replaces matching issuer/AS/machine endpoint URLs with generated `harpoon://` labels. The hosted service maps supported labels to its OAuth shim routes. This URI scheme is verified **inside this transport**, not a standard redirect URI or a new VMN endpoint contract. VMN must continue emitting ordinary HTTPS URLs. The auto-registered authorization endpoint stays HTTPS and direct to the browser. Public/unregistered machine URLs remain direct; successful discovery alone does not prove a token endpoint is tunneled. [Released architecture](https://github.com/openai/tunnel-client/blob/01d67bb4da0d8359b808b4761f8db171ab682cd7/docs/architecture.md#oauth-protected-mcp).

At the Harpoon layer the protected-resource `resource` field is explicitly preserved, unlike ordinary registered URLs. The hosted service also has connector-facing discovery/challenge rewriting. Public source and mock-service tests do not establish the exact final resource and issuer values used by this account's hosted OAuth caller. Validate all layers, without accepting a tunnel URL as a new audience merely because it appears in discovery. [Transformation](https://github.com/openai/tunnel-client/blob/fb43d565373123433b02b4972e734514e9f37875/pkg/runtimeharpoon/transform.go#L97).

For the preferred topology:

1. Browser and tunnel container can both reach `P` with certificate verification.
2. Tunnel MCP target is `P/mcp`; PRMD source/resource and OAuth endpoints share this origin.
3. The released registration policy seeds its OAuth host/origin policy from same-origin PRMD resource/source records. This admits the machine endpoints even when a `.ts.net` hostname is not classified as a private IP.
4. Browser visits `P/authorize` and VMN consent normally; OpenAI handles the callback/code and calls the shimmed token endpoint; final exchange originates from the tunnel host.
5. MCP calls carry the issued user bearer; refresh/revoke use the registered machine targets.

Thus **the private authorization endpoint can remain browser-facing**, provided the actual browser/WebView joins the tailnet and the selected product supports the discovered shim. The phone's network access does not establish the tunnel container's DNS/ACL/routing access, or vice versa.

## Exact gaps and blockers

| ID | Evidence/status | Smallest response |
| --- | --- | --- |
| G1 | **Confirmed VMN metadata inconsistency:** AS `issuer` is `P/`, PRMD AS entry is `P`. A pure installed-SDK metadata evaluation reproduced the trailing slash. Upstream accepts issuer mismatch diagnostically, so a hosted failure from this is **not confirmed**. | After approval, derive the PRMD AS entry from the same canonical issuer used to generate metadata. Keep resource `P/mcp`, cookie Origin `P`, browser paths and stored grant binding unchanged. Add exact-string tests. |
| G2 | **Confirmed topology/configuration blocker:** with target `http://vmn:3000/mcp`, VMN advertises a different HTTPS origin `P`. Without explicit discovery trust, advertised metadata/AS requests are blocked. Trust alone does not authorize forwarding those separate-origin endpoints. | Prefer same-origin HTTPS target. Do not change `PUBLIC_ORIGIN` to Docker HTTP. |
| G3 | **Confirmed release capability gap for G2:** v0.0.19 lacks `harpoon.oauth_forward_origins`. Current master has it; host suffix classification or generic configured targets are not equivalent to discovery-generated OAuth records. | For a later approved separate-origin test, select a verified released artifact containing that capability, or separately review a source build. Configure both `mcp.oauth_trusted_origins: [P]` and `harpoon.oauth_forward_origins: [P]`, including PRMD source origin. No wildcard `.ts.net` approval. Do not assume master-only flags work in v0.0.19. |
| G4 | **Live-test gate:** hosted issuer comparison and `resource` values across authorization, exchange and refresh are not proven. An explicit outer tunnel/Harpoon resource will fail VMN's exact binding. | Inspect sanitized URL shape/audience assertions using synthetic accounts. Preserve the canonical audience; seek documented shim behavior/upstream correction before any VMN resource configuration proposal. No arbitrary aliases or ignored resource checks. |
| G5 | **Live-test gate:** DCR must request `none`; no evidence here that the actual product always does. Secret-based or CIMD-only registration is unsupported by VMN. | Select the product's DCR/public-client mode. If unavailable, stop and report its exact supported mode; do not introduce static bearer keys or silently accept confidential clients. |
| G6 | **Live-test gate:** refresh rotation, retry after lost response, scope omission/equality and grant expiry. VMN deliberately refuses narrowed refresh scope and replay. | Test the product's actual behavior. Keep replay revocation; reauthorize after an ambiguous refresh rather than reuse its old credential. Scope policy changes need a separate concrete proposal if required. |
| G7 | **Unverified operational prerequisites:** browser/WebView tailnet reachability, container HTTPS/DNS/ACL reachability, tunnel/ChatGPT association, Read/Use permissions, readiness with expected MCP 401. | Validate on a separate tunnel and empty sandbox. No infrastructure was inspected or changed in this review. |
| G8 | **Confirmed documentation/test gaps:** admin guide describes generic reachability but omits the known machine endpoint shim, origin distinction and release gap; existing tests do not assert full metadata or hosted transport behavior. | Update guide and add targeted tests only after review. Use the plan below; do not call the current installation compatible solely from unit tests. |

No source evidence establishes a mandatory change to VMN's authorization-code, PKCE, bearer verification or Workspace logic. Same-origin operation avoids the separate-origin release gap. Tailscale IPv4 uses CGNAT rather than RFC1918; do not rely on private-IP classification to solve registration.

## Proposed implementation scope, after approval

1. Correct issuer serialization once in `oauth.ts`, reusing the canonical issuer for discovery. No database migration or change to existing grant resource values.
2. Extend focused protocol tests and add browser consent/MFA coverage. Keep core OAuth SDK-owned and client-independent.
3. Correct `docs/admin/mcp.md` to explain direct browser authorization, shimmed machine endpoints, release-pinned configuration and the actual validated topology. Replace the current illustrative Docker-HTTP target as the preferred recipe with same-origin HTTPS. Update security-policy evidence with actual results.
4. Prepare an operator-owned Docker profile only after the topology and released client are approved. Keep new trust configuration in the tunnel client. Do not add OpenAI dependencies or runtime endpoint-rewriting code to VMN.

Only if testing proves an unsolved gap should a separate follow-up propose generic endpoint/resource configuration. Such a proposal must define strict HTTPS validation, canonical issuer/audience rules, backward-compatible defaults and negative tests before implementation. No speculative configuration is requested for this phase.

## Automated test strategy (not implemented in this review)

Extend `apps/server/src/http/mcp.test.ts`, or split protocol cases into `mcp-oauth.test.ts` if clearer. Use the production-configured test harness, fresh databases and synthetic credentials. No provider/tunnel network calls in ordinary unit tests; no new dependencies needed for VMN tests.

| Group | Required assertions |
| --- | --- |
| Discovery | Enabled: exact challenge URL, AS issuer, PRMD AS entry, resource, endpoint paths, scopes, S256/code/refresh and only `none`. Disabled: all MCP/metadata/OAuth paths unavailable. Malicious Host/forwarded headers cannot affect metadata or redirects. |
| Issuer/resource | Exact matching canonical issuer strings; `/mcp` remains the resource. Valid explicit resource and omission work; foreign origin, path, trailing-slash variant and synthetic tunnel/Harpoon audiences fail authorization/exchange/refresh. Never produce a usable token or grant on refusal. |
| Authorization redirects | No code before authenticated approval; only registered callback accepted; state preserved verbatim; consent redirect stays at configured private origin. Denial returns `access_denied` and state without a code. Unknown client/unsafe callback must not redirect to attacker. Missing/plain/wrong S256 and invalid scopes fail. |
| DCR | JSON public registration yields 201, UUID id, approved redirects and no secret; omitted/secret-based method, unsafe schemes/credentials/fragments, excess redirects and oversize input refused. Exercise loopback rules through SDK matching. Registering grants no application access. |
| Token | Real form exchange with verifier/client/redirect/resource succeeds; wrong/missing verifier, client or redirect, expired code and duplicate form fields fail. Test code replay and resulting revocation; assert no token creation on failed verification and transaction rollback on failure. Responses remain no-store. |
| Refresh | New access and refresh values, expected lifetime caps; replacement works, old refresh replay revokes the grant/new token. Test wrong client/resource, ungranted/narrowed scope, expiration and concurrent refresh; document that a replay can revoke the winning result. Test `/revoke`, owned revoke and account disable/security-event revocation. |
| Consent/auth boundaries | No cookie or MFA challenge-only cookie cannot approve/read consent; invalid/missing Origin cannot approve with a session. Other user's revoke, foreign Workspace, removed membership, guest writes, disabled tool and stale revision remain denied. Tokens never replace current authorization. |
| Secret handling | Capture logs using sentinel code/verifier/access/refresh values and exercise success/error/replay; none appear in VMN logs or security-event metadata. Inspect only expected token responses/callback in memory; avoid assertion dumps containing these fields. |

Add a separate opt-in transport integration suite after approval. Run pinned official client containers against VMN plus a local mock control plane (or the upstream harness); exercise queued discovery, tagged target registration, issuer/resource transformations, DCR POST JSON, token/refresh POST form bodies, normal MCP bearer forwarding and blocked unknown targets/redirects. Test same-origin and separate-origin configurations with negative trust/forwarding cases. Keep this outside routine VMN unit runs and do not vendor a fork of the OAuth implementation. A mock-hosted test cannot replace the real product check.

Browser tests must complete the flow from a logged-out browser through password + enabled TOTP, explicit Workspace/read-scope consent and callback; also cover decline, pending-request expiry and reauthorization. Preserve the consent request across sign-in; no success is inferred from layout or a 302 alone.

## Isolated Docker integration and rollback plan for Unraid

**Plan only. Do not run these steps before approval.** No host package installation, Unraid template edit, firewall/Serve/Funnel change, production-network attachment, production database copy or production secret reuse is part of this review. Docker already supplied by Unraid is sufficient; verify that prerequisite later.

1. **Isolation prerequisites:** choose a dedicated test tunnel/connector and least-privileged runtime credential. Use an empty VMN test instance with unique secrets, disposable volumes, synthetic users/Workspaces and one user with TOTP. Image billing, email/Telegram delivery and unrelated tools stay unconfigured/off. Never mount production `/data`, Tailscale state, Docker socket or host filesystem into the tunnel container.
2. **Private HTTPS prerequisite:** the sandbox needs its own browser-reachable, certificate-valid tailnet HTTPS origin `P_test`, accessible from the test tunnel container as well. Reuse an already approved test route if available. If none exists, stop for a separate private test-routing design/approval; do not repoint the production origin, attach to its namespace or publish ports to make the test work. Local mocked HTTPS tests can proceed separately without contacting OpenAI.
3. **Artifact verification:** recheck official release availability and supported Platform download; pin a verified version/digest with the required features, record source commit and provenance/SBOM. Do not use floating `latest`, a fictitious sample version, or assume master equals a release. Do not run bundled Cloudflare/another public relay. Confirm selected image user/entrypoint and permission requirements before writing the eventual Compose file.
4. **Restricted container:** one active poller, separate test project/network, no published ports, non-root user, read-only root, drop capabilities, no-new-privileges, bounded memory/CPU/PIDs and a small temporary writable area. Read-only mount the private profile/key (key file readable only by that UID); no credential values in Compose, arguments, shell history or output. Health/admin binds loopback inside the container; do not set remote UI access. Validate hardening against the selected image rather than weakening it for convenience.
5. **Profile candidate:** initialize/validate using the selected image's CLI help. The following is a configuration excerpt for review, not a complete executable deployment. The image entrypoint already includes `run`; invoke `doctor` using an explicit entrypoint override if needed, avoiding `run run`.

   ```yaml
   control_plane:
     tunnel_id: REPLACE_WITH_DEDICATED_TEST_TUNNEL
     api_key: file:/run/secrets/tunnel-runtime-key
   mcp:
     server_urls:
       - channel: main
         url: https://REPLACE_WITH_PRIVATE_SANDBOX_ORIGIN/mcp
   health:
     listen_addr: 127.0.0.1:8080
   log:
     level: info
   ```

   Target the same `P_test` as the sandbox's `PUBLIC_ORIGIN`. Set `LOG_HTTP_RAW_UNSAFE=false` and `HARPOON_CAPTURE_PAYLOADS=false` in the container environment. No static MCP `Authorization` extra header. Retain default main/Harpoon routing; do not send Harpoon internal initialize traffic to VMN. For the alternative separate-origin topology, add both exact-origin lists only when the pinned artifact supports them; prefer HTTPS throughout, with no plaintext override.

6. **Preflight evidence:** from the container verify DNS, certificate trust and reachability, unauthenticated MCP 401/challenge, both metadata documents and the expected OAuth target catalog. Expected roles include metadata/AS issuer, token, registration and revocation; `/authorize` must remain the private browser URL. Check `doctor`, polling and readiness; distinguish an expected protected MCP probe from discovery/catalog failure. Keep raw HTTP logging, payload call history and trace capture off. Record only status, route shape, role counts, versions and pass/fail assertions.
7. **Hosted product test:** attach only the dedicated test tunnel, choose OAuth/DCR and complete sign-in/TOTP/consent from a tailnet-connected browser/phone. Confirm exact issuer/resource handling using synthetic-only assertions and sanitized evidence; never paste HAR files, callback queries, token responses or screenshots of credentials. Perform only `list_workspaces` and a synthetic read. Verify unselected Workspace denial. Test refresh after access expiry, revoke, tailnet loss, poller restart/reconnect and ambiguous token-response failure. Reauthorize after replay/uncertain refresh. No write or paid image test is needed for this compatibility gate.
8. **Acceptance:** require successful browser MFA/consent, DCR, exchange, canonical resource, authenticated read, refresh and revoke; no public origin, credential leakage or authorization bypass. A ready poller alone is insufficient. Store a redacted result matrix separating VMN tests, mock transport tests and real product observations. If the client tries a private unshimmed endpoint from the cloud, stop with that exact blocker.

**Rollback:** stop/remove only the test poller first; revoke the synthetic VMN connection and disable/delete the test connector/tunnel, then revoke its dedicated runtime key so a stopped process cannot reconnect. Remove only the test containers, volumes and secret/profile files using the recorded project names; preserve a minimal sanitized result report. Removal of a connector alone is not VMN token revocation. Do not restore or roll back the production database: nothing in this plan touches it. Direct Tailscale-only VMN remains available throughout. On an aborted test, perform the same credential cleanup. If later downgrading a separate-origin client, remove unsupported flags/YAML and stop the old poller before replacement; lost forwarding is a failed integration, never justification for public OAuth exposure.

## Initial review checks and subsequent approval

- Read-only local code/installed SDK review and official source fetches at pinned revisions; latest public release compared with current master.
- Pure SDK metadata evaluation confirms root issuer trailing-slash serialization. VMN overrides the SDK's default auth-method advertisement to `none`; no client secret was generated by this evaluation.
- Existing regression command: `pnpm exec vitest run apps/server/src/http/mcp.test.ts apps/server/src/logging.test.ts` — **2 files / 25 tests passed**. These are existing tests, not the proposed new coverage or evidence of live tunnel compatibility.
- Documentation diff/link checks recorded in ledger 36.7. No application code, tests, dependencies, configuration, infrastructure or running service changed; no credentials requested, tunnel created, host software installed or external product call made.

Security surface changed by this report: **NO**. An approved tunnel test would introduce a separate runtime credential and an external transport of MCP content and OAuth artifacts; OpenAI handles callback codes, token responses, access/refresh credentials in the supported product flow. TLS does not make those artifacts local-only. The runtime key is separate from VMN OAuth and from Recipe image billing. This data path must be part of the reviewed test authorization; keep excluded Documents/private Journal/admin content excluded. See [upstream trust-boundary matrix](https://github.com/openai/tunnel-client/blob/fb43d565373123433b02b4972e734514e9f37875/docs/architecture.md#auth-and-data-flow-matrix).

**Review decision recorded:** the owner approved the narrowly scoped G1 metadata correction, targeted
automated tests and deployment documentation. The implementation uses released v0.0.19 assumptions;
no master-only configuration is adopted. Final local results and remaining gates are recorded in
ledger 36.7 and [operator guidance](../admin/mcp.md). Live Docker integration remains a separate approved
execution step once the private sandbox route and pinned client are concrete. No deployment or release
is proposed; owner milestone remains 53, next release 54, with the special 42nd release/dedication preserved.
