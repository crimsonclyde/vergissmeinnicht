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

There are no approved current product screenshots for the README. The brand illustration is not an application screenshot, and mockups are design references. Step [17.3](steps.md#173-current-product-screenshots) tracks a small, reproducible set of screenshots from a seeded demo instance, with fictional data, desktop and phone layouts, and Light and Dark themes. Add screenshots to the README only after visual review; keep the larger QA capture set out of git.
