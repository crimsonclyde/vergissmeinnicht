# Development documentation

Read [AGENTS.md](../../AGENTS.md) before making changes. It contains the mandatory contribution and completion workflow.

- [Local development](local-development.md) — prerequisites, commands and the test environment.
- [Architecture](architecture.md) — module boundaries, storage and application behaviour.
- [Security policy and checks](security.md) — normative policy and required negative tests.
- [Project steps](steps.md) — authoritative implementation ledger, accepted decisions, validation and remaining work.
- [Objectives and strategy](objectives-and-strategy.md) — product goals and design direction.

## Documentation maintenance

Keep user instructions in `docs/user`, operator instructions in `docs/admin`, and engineering specifications in `docs/development`. The root README introduces the product and links here; avoid copying setup instructions or exhaustive feature lists into it. Update the guides when behaviour changes and record completion evidence in the ledger.

## Screenshots

Six reviewed actual-app screenshots from fictional demo data are in [the capture guide](../../assets/screenshots/workspace-tools-2026-10-04/README.md) and the root README. They show steps 17.1–17.2 on desktop and phone in Light/Dark. Mock-ups remain design references; bulk QA captures and credentials stay out of git.
