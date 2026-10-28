# Dependency security review — 2026-10-28

Scope: this repository's resolved pnpm workspace graph, including runtime, development and optional dependencies. `pnpm audit --json` queried the npm advisory registry before and after updating; it reported 22 initial findings (7 low, 13 moderate, 1 high, 1 critical), then no known advisories (442 resolved dependency entries). No suppressions added. Raw local snapshots: `/tmp/vmn-bring-dependency-audit.json` and `/tmp/vmn-bring-dependency-after.json` (temporary verification artifacts).

| Dependency | Before | Reviewed pin after | Findings addressed |
|---|---|---|---|
| Better Auth and its matching adapters | 1.7.6 | 1.7.14 | OAuth/Magic Link/Proxy authentication and PostgreSQL adapter rate limits |
| Fastify | 5.12.5 | 5.12.7 | Header property-name validation bypass |
| Nodemailer, including SMTP test dependency | 10.0.10 | 10.2.1 | Address parsing, injection/interpretation and parser complexity |
| Vitest / mocker | 5.0.1 | 5.0.5 | Mock registration code injection and Windows traversal |
| ip-address | 10.7.2 | 10.7.5 | IPv6 zone parsing complexity |
| fast-uri 3 / 4 | locked older 3.x / 4.x | 3.1.9 / 4.2.3 | URI parsing and validation advisories |
| esbuild below esbuild-kit/core-utils | 0.18.20 | 0.25.12 | Development-server request/response exposure |

Runtime and dev manifests retain exact pins. Narrow overrides keep transitive fixes on the existing major lines; the esbuild override only affects the deprecated esbuild-kit tooling branch. `pnpm install` passed existing supply-chain policy, and a later audit returned exit status 0. No new runtime feature or exposure is enabled by these updates.

Authentication assessment: VMN uses local password authentication and optional TOTP through explicit allowlisted server calls. Better Auth's general HTTP handler is not mounted; there are no social/Generic OAuth, OAuth Proxy or Magic Link plugins. The high/critical advisory preconditions are therefore absent in the current design; the dependency was nevertheless patched. The PostgreSQL adapter advisory is also outside VMN's SQLite setup. These are scope assessments, not evidence that untested upstream paths are secure.

Upstream sources:

- [Better Auth Magic Link/OAuth](https://github.com/advisories/GHSA-965c-763c-88jm) and [OAuth Proxy](https://github.com/advisories/GHSA-r4xp-prcw-77qf); [adapter rate limits](https://github.com/advisories/GHSA-44jh-23m7-hpcf).
- [Fastify header validation](https://github.com/advisories/GHSA-389g-gv7q-r4x8).
- Nodemailer advisories: [8c8m](https://github.com/advisories/GHSA-8c8m-p3m8-cjg8), [m943](https://github.com/advisories/GHSA-m943-m63m-w62w), [85x2](https://github.com/advisories/GHSA-85x2-q946-cp5h), [4ffr](https://github.com/advisories/GHSA-4ffr-jq9g-5ffx), [g73g](https://github.com/advisories/GHSA-g73g-hqqh-jr95).
- Vitest [mock registration](https://github.com/advisories/GHSA-qxg6-89mg-rqv8) and [Windows traversal](https://github.com/advisories/GHSA-xp26-3454-mjgp).
- [ip-address parsing](https://github.com/advisories/GHSA-rxp7-6hxx-x8q5); fast-uri [w74x](https://github.com/advisories/GHSA-w74x-v6f9-j3xg), [xhq7](https://github.com/advisories/GHSA-xhq7-xmqj-769h), [wjr9](https://github.com/advisories/GHSA-wjr9-j795-jxcr), [333x](https://github.com/advisories/GHSA-333x-w4r6-6crp).
- [esbuild development server](https://github.com/advisories/GHSA-67mh-4wv8-2f99).

Validation passed: full unit/integration suite (197 files / 1,530 tests), then final focused API/domain/migration/restore/card/contrast/catalog checks (71 tests) and direct SQL/migration checks (8 tests); typecheck, lint, production build, frozen-lockfile install, schema-drift/whitespace checks and final account browser workflow (1 passed, 2.8 minutes). The added hostile Bring restore test also passed within the 24-test restore suite. Final outcomes are recorded in `steps.md` sections 20 and 32. Audit results are time-sensitive; repeat before a release. Deprecated esbuild-kit loader/core-utils remain upstream Drizzle tooling dependencies. No container OS/native-library scan, image signing verification, complete package-source/provenance audit, physical-device or screen-reader certification was performed here. No release or live deployment was performed.
