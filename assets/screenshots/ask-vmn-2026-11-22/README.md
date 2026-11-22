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

Final verification on the updated checkout: **259 Vitest files / 1,985 tests passed**.
Both CI desktop/mobile browser suites pass, including the native/MCP combinations, keyboard
close/reopen, phone touch, the real Note link, failure/retry and Stop. Light and Dark, reduced
motion, horizontal overflow and automated accessibility checks are covered. Backend provider
responses and SSE are mocked; authorization, budget concurrency, database migration, source
records and destination routes use real application code. Lint, typechecks, production build,
frozen install and dependency security gates pass (two existing moderate advisories).

[CI](https://github.com/crimsonclyde/vergissmeinnicht/actions/runs/45077828635) ·
[Signed image release and populated upgrade verification](https://github.com/crimsonclyde/vergissmeinnicht/actions/runs/45078606718).
No live OpenAI request, billing test, physical iPad or screen-reader certification is claimed.

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

Final current-main backend regression: **259 files / 1,985 tests passed**. Responses are mocked;
local source records and application routes are real. Release CI verifies the complete browser
suites and both native production images; see ledger section 50.1 for publication evidence.
