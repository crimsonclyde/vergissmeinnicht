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

Exact supported Node and dependency versions will be pinned when the application skeleton is created.

## Target workflow

```bash
git clone https://github.com/crimsonclyde/vergissmeinnicht.git
cd vergissmeinnicht
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm dev
```

These commands are target names until Step 1.1 actually creates them.

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

## Required scripts

Once Step 1.1 is implemented, provide stable scripts for:

- `pnpm dev`
- `pnpm build`
- `pnpm test`
- `pnpm test:e2e`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm db:generate`
- `pnpm db:migrate`

When commands change, update this document and `docu/steps.md`.
