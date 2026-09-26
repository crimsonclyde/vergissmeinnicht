# Local Development

## Selected stack

- Node.js
- TypeScript
- Fastify 5
- React + Vite
- Better Auth
- Drizzle ORM
- SQLite
- pnpm
- Vitest
- Playwright

Versions:

- Node.js **24 LTS** (`.nvmrc`; `engines >=24.11.0`). Newer Node releases work for local development.
- pnpm **12.6.0** (pinned via `packageManager` in `package.json`). Install e.g. with `npm install -g pnpm@12.6.0`. Node 25+ no longer ships Corepack.
- All dependency versions are pinned exactly; `pnpm-lock.yaml` is committed.

## Supply-chain settings

`pnpm-workspace.yaml` enforces:

- `allowBuilds`: only listed packages may run install scripts. A new native/scripted dependency fails install until it is reviewed and added.
- `minimumReleaseAge: 1440`: versions younger than 24 h are not installed.
- `trustPolicy: no-downgrade`: install fails if a package's publish trust evidence drops. Exceptions are exact versions with a written justification.

## Workflow

```bash
git clone https://github.com/crimsonclyde/vergissmeinnicht.git
cd vergissmeinnicht
pnpm install
pnpm db:migrate
pnpm exec playwright install chromium   # once, for pnpm test:e2e
pnpm dev
```

`.env.example` and validated configuration follow in Step 1.2. Until then the server reads `HOST` (default `127.0.0.1`), `PORT` (default `3000`) and `NODE_ENV`; `pnpm db:migrate` reads `DATABASE_PATH` (default `.var/vergissmeinnicht.sqlite`).

`pnpm dev` starts the Fastify API (`node --watch`, port 3000) and the Vite dev server (proxying `/api` to the API) in parallel.

## Principles

- ordinary development must not require external SaaS;
- development exercises real ACL/auth rules;
- do not ship a production-capable "disable auth" mode;
- local SQLite data lives under an ignored runtime path such as `.var/`;
- migrations define schema changes;
- safe seed/demo data should create multiple roles/workspaces for authorization tests;
- no production credentials in fixtures.

## Email development

Production invitations require email delivery.

The application should expose an email adapter. Self-hosted baseline is configurable SMTP.

Development may use a local mail sink such as Mailpit/MailHog or a dev adapter that captures messages locally, but production code must never silently use a fake mail transport.

## Scripts

| Script | Purpose |
| --- | --- |
| `pnpm dev` | API + Vite dev server |
| `pnpm build` | Build production web assets (`apps/web/dist`) |
| `pnpm start` | Production server (serves API + built web assets); run `pnpm build` first |
| `pnpm test` | Vitest unit/integration tests |
| `pnpm test:e2e` | Builds web assets, then runs Playwright smoke tests against the production server on port 3100 |
| `pnpm lint` | ESLint incl. architecture boundary rules |
| `pnpm typecheck` | `tsc` for every package |
| `pnpm db:generate` | Generate a migration from `packages/database/src/schema.ts` |
| `pnpm db:migrate` | Apply committed migrations |

The server runs TypeScript directly via Node's built-in type stripping; only erasable TypeScript syntax is allowed (`erasableSyntaxOnly`), and relative imports use `.ts` extensions.

## Architecture boundaries

Boundaries are enforced by pnpm (packages can import only declared dependencies) and by ESLint `no-restricted-imports` rules in `eslint.config.js`. Do not weaken these rules to make an import work; move the code to the right layer instead.

When commands change, update this document and `docu/steps.md`.
