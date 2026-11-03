# Runtime, dependency and Claude advisory review — 2026-11-03

Scope: repository/runtime configuration, current npm advisory results, official Node releases and
Claude/Cursor notices; limited read-only local tooling and known-indicator inventory. No live VMN host,
other computer, account or historical endpoint telemetry was accessed. No incident is inferred from
an outdated version alone.

## Node/Brotli — affected production base, candidate patched

The Dockerfile pinned Node **24.21.0**, before the October 21 security release. The Node maintainers
identify malformed Brotli input as a possible memory corruption/RCE path (CVE-2026-111497), alongside
DNS, TLS, HTTP-agent, snapshot entropy and permission-model fixes in the same release. Fixed 24.22.1
was followed by 24.22.2 with V8 follow-ups. Sources: [October security notice](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases),
[24.22.1 changes](https://nodejs.org/en/blog/release/v24.22.1),
[24.22.2 follow-up](https://nodejs.org/en/blog/release/v24.22.2).

VMN's allowlisted weather HTTP adapter uses native fetch, which can decode compressed upstream
responses before the application's decoded-byte cap. Fixed endpoints, TLS and size limits reduce
exposure but do not patch a vulnerable decoder; no direct `brotliDecompress` call is necessary for
an outbound response path. No arbitrary public Brotli-decoding request route was found. This is a
source exposure assessment, not proof of exploitation or proof that every transitive parser is safe.

Changes: Docker base and `.nvmrc` are now **24.22.2**; package engines exclude older Node 24 and EOL
Node 25 (`^24.22.2 || >=26.12.1`). Official Docker registry index, inspected for amd64 and arm64:

`sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c`

The exact base reports Node 24.22.2, OpenSSL 3.5.9, Brotli **1.2.0**. That Brotli string is expected:
Node 24.22.1 cherry-picks the fix into its vendored Brotli; library-version-only comparison would give
the wrong result. The official Node release/patch provenance is the basis for assessment. The separate
development host reports Node 26.12.1/Brotli 1.2.1; it never established safety of the old Docker base.

A disposable local candidate build and existing image smoke test cover native dependency loading,
migration, bootstrap, backup, readiness and scheduled backup. Existing image scan/signing/upgrade
release gates remain required. No live container was inspected or changed: existing installations
remain on their own installed image until an operator deploys a patched build. A source edit cannot
retroactively fix v0.10.0-beta.0. No independent container OS/advisory scan is claimed by this review. The local sharp inventory
reports sharp 0.35.5/libvips 8.18.7 and does not expose a Brotli version; that inventory is not a
comprehensive advisory assessment of its native libraries.

## npm graph — development minimatch fixed

Initial `pnpm audit --json`: **1 moderate**, minimatch 10.2.6, dev-only via ESLint/config-array and
TypeScript-ESLint. [CVE-2026-118764 / GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)
concerns attacker-controlled glob expansion at optimization level 2. VMN users cannot supply lint
configuration through application routes. Production was not affected through this dev-only branch.

Narrow `minimatch@10: 11.0.1` override removes that branch. The
[upstream changelog](https://raw.githubusercontent.com/isaacs/minimatch/v11.0.1/changelog.md)
was reviewed: v11 changes the matching engine and removes makeRe/AST APIs; these are not used by the
resolved lint callers. Lint/typecheck/build exercise those callers. The version was published October
27, meeting the existing 24-hour age policy; provenance/script protections remain unchanged. Existing
runtime glob already resolves patched minimatch 11.0.3 and is not overridden. Frozen install passes.

Final full and production-only audits each report **0 known advisories**. This is time-sensitive
registry evidence, not certification that packages contain no vulnerabilities or malicious code.
Temporary raw snapshots are under `/tmp/vmn-security-2026-11-03-*.json`; counts are recorded here so
review does not rely on those temporary files. Final regression results are in ledger 32.1.

## Claude tooling — incident distinguished from plugin vulnerability

The user's morning briefing did not supply a specific article; the two relevant recent reports are:

- [Cursor's October 29 notice](https://prod.cursor.com/blog/claude-code-extension-security-notice):
  tampered `anthropic.claude-code` extension **2.1.312 / 2.1.313**, Windows/macOS, distributed through
  Cursor's marketplace during the stated October 29 window. Known payload attempts SSH persistence.
  [Microsoft's investigation](https://www.microsoft.com/en-us/security/blog/2026/10/30/inside-malicious-claude-code-branded-cursor-extension-persistent-ssh-backdoor/)
  distinguishes that channel from npm and Visual Studio Marketplace. Affected installations need
  investigation of persistence; merely uninstalling/updating is insufficient. No remediation script
  was downloaded or executed here.
- [Anthropic GHSA-pq7j-f95f-qfcv](https://github.com/anthropics/claude-code/security/advisories/GHSA-pq7j-f95f-qfcv):
  plugin commit-pin bypass, fixed in **2.1.179**. Also reviewed the
  [Edit TOCTOU advisory](https://github.com/anthropics/claude-code/security/advisories/GHSA-5xjx-9qx6-jcrv),
  fixed in **2.1.251**.

This Linux workspace host reports Claude Code **2.1.302**, newer than both advisory fixes. No installed
Claude extension was found in its local Cursor extensions directory (VS Code directory absent), and
its Claude plugin inventory had no plugin entries. Read-only checks found none of the listed
`.config/.smt`, `.config/.smtk`, `/tmp/.stk_*` or macOS LaunchAgent artifacts; the local authorized_keys
file was absent. Only metadata/exact indicator matches were reported; no credentials or key content
were printed. These limited checks neither establish past installation history nor clear other
machines, browser extensions, Desktop/Cowork apps or the user's live Unraid host.

No Anthropic SDK, Claude plugin or editor extension is part of the VMN runtime dependency graph.
Its optional MCP endpoint delegates existing server capabilities; it does not install client plugins.
Existing grants/revocation/Workspace/tool gates remain essential if a client is ever compromised.
