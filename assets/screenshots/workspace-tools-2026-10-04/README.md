# Actual product screenshots — 2026-10-04

These six images show the implemented app, not design mock-ups. Source: `a217b65f5397a132f38d275c0ab927b161877db6` on `development/optional-tools-review` (steps 17.1–17.2), with the matching production web build. Capture completed 2026-10-04T15:18:05.503Z. This is a review-branch capture, not evidence of a deployed release.

The existing isolated `test-env` fictional Demo Household was preserved. Missing fictional Contacts/Maintenance and one sample Document were added through authenticated APIs; one Reminder occurrence and one Run were completed to demonstrate canonical progress. The sample Document uses the media test `three-pages.pdf` fixture; it is labelled “Sample water bill” and is not a real bill. The active “Leave the house” Run remains pending. Accounts, people and records are fictional. No credential, Knot token URL, private document content or notification inbox is captured.

| Image | Viewport | Theme |
|---|---|---|
| [today-desktop-light.webp](today-desktop-light.webp) | 1440 × 1000 | Light |
| [today-phone-dark.webp](today-phone-dark.webp) | 390 × 844 | Dark |
| [builder-desktop-dark.webp](builder-desktop-dark.webp) | 1440 × 1000 | Dark |
| [run-phone-light.webp](run-phone-light.webp) | 390 × 844 | Light |
| [documents-desktop-light.webp](documents-desktop-light.webp) | 1440 × 1000 | Light |
| [maintenance-phone-dark.webp](maintenance-phone-dark.webp) | 390 × 844 | Dark |

Reproduce from an installed local fictional demo (never a real instance):

```sh
pnpm build
node test-env/capture-screenshots.ts
```

The helper targets only `http://127.0.0.1:3200`, reads ignored demo credentials locally and enables the seven implemented tools in Demo Household. It prepares missing examples through authorised APIs, retains existing demo content, paces requests under the normal rate limit, and signs out afterward. Outputs default to `/tmp/vmn-ui-review`; `VMN_CAPTURE_DIR` can select another temporary directory. Only selected optimised WebP images were copied here (quality 90); bulk QA captures, metadata, credentials and Playwright reports stay out of git.

All six selected images were visually reviewed for content, readable text, theme/state indicators and sensitive data. Capture checks require no alerts, no lost sign-in and no horizontal overflow. Today, Settings and More were additionally checked at 320 × 768 in both themes; public sign-in was checked at 320 pixels. The phone Today keeps Continue before recent completions. Browser automation is not a physical-device or screen-reader test. Pre-existing owner screenshots and `assets/mock-ups/` are separate and unchanged.
