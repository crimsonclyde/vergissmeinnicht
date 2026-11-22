# Ask VMN review — 2026-11-22

Fictional household data in the real local VMN React/Fastify/SQLite application.
Desktop: 1440 CSS px. Phone: 320 CSS px with a touch-enabled Pixel 7 browser profile.
Admin uses VMN's enforced Memento Mori management theme; chat captures show Dark and Light.

| View | Desktop | Phone |
| --- | --- | --- |
| Server admin → AI | [Open](admin-desktop.png) | [Ask VMN](admin-ask-phone.png) · [External assistants](admin-phone.png) |
| Workspace chat and verified Note link | [Dark](chat-desktop-dark.png) | [Light](chat-phone-light.png) |

The active **Household ChatGPT** grant is synthetic, created/exchanged through VMN's real
MCP repository using the fictional operator, Workspace and callback. It demonstrates acting
account, permissions, expiry and disconnect controls. No external assistant was connected.
The chat credential intentionally remains unconfigured. Chat answer events are intercepted
fictional provider output; the oven Note and the destination record page are real local fixtures.
No live OpenAI request, charge, real household content or operator secret is included.

Pre-update verification: complete Playwright suite 40 passed / 2 intentional skips; final focused chat
rerun 4 passed (plus 6 chat/OAuth checks after the mobile grant-row correction), covering all native/MCP on/off combinations, keyboard close/reopen, actual
phone touch, verified Note link, provider and HTTP failure recovery, and Stop. Both Light and
Dark, reduced motion, no horizontal overflow and automated accessibility checks are covered.
Backend authorization, private-source exclusion, context revocation, spending concurrency,
cancellation and upgrade tests use an injected provider; Responses parsing uses synthetic SSE.
Pre-update full Vitest: 245 files / 1,921 tests passed, with an additional focused provider check after
the final completed/nonempty response guard. Lint, typecheck, production build and the dependency
security checks pass (two pre-existing moderate audit advisories; no new dependency).

Reproduce captures with the repository browser fixtures:

```sh
pnpm build
pnpm exec playwright test --grep 'Ask VMN chat and admin' --workers=1
```

The complete 20-image on/off/theme/phone-section matrix is generated under ignored
`.var/ask-browser-evidence/`. These five selected originals are the review handoff.
Physical iPad/iOS keyboard, real screen reader, actual OpenAI output/billing and production
Unraid deployment remain manual checks. See [operator setup](../../../docs/admin/ask-vmn.md).

Captures refreshed after updating this checkout in place to 0.17.2 main. The current four
chat/admin browser flows pass; the release ledger records the final regression and CI results.
