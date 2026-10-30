# Release 42 — Approved visual direction

> **Status:** Visual direction approved; interactions and implementation details remain exploratory. This folder is a design reference, not an instruction to start the redesign.

## Reference image

Expected asset: `space-interface-concept.png` — the approved desktop/mobile mockup from the 2026-10-30 design conversation.

**Note:** The image is not yet checked into this branch. The binary asset must be added before this documentation PR is merged. Do not replace it with a newly generated approximation.

## What is approved

- A serious, cinematic deep-space atmosphere with restrained starfields, planetary horizons and subtle light.
- A small, understated cat may provide occasional personality; it is not a cartoon mascot.
- No left sidebar or conventional dashboard shell.
- Time/date, Weather, Procedures, Calendar and other tools work as independent, focused experiences.
- Clear practical controls with very little unnecessary labeling or filler text.
- Thoughtful phone *and* desktop layouts, not a shrunk desktop page.
- A contextual interaction mechanism is a research goal; the specific control, gestures and transitions are **not** yet decided.
- The space appearance should be an **optional theme**. The new interaction architecture must be theme-independent and accessible.

## What is NOT approved or specified

- Pixel-perfect layout, gradients, planets, illustration assets, iconography or exact controls.
- The orbital spheres as the final navigation mechanism.
- Replacing every screen with an icon-only interface.
- A new chatbot, cloud AI dependency or automatic autonomous actions.
- Replacing existing backend, permissions, offline capabilities, history or stored data.

## Preparation-phase instruction for Codex

Read this brief and the reference image as context during the **read-only Release 42 readiness audit**. Do not implement the design, refactor components or change production behaviour until explicitly approved.

The next tasks are (1) audit architecture and constraints; (2) prototype navigation/contextual interaction separately; (3) specify accessible and responsive behaviour; (4) plan an incremental rollout with a fallback to the existing interface.

**Release numbering:** the next owner-counted Release 42 is reserved for the major experience milestone. No tag, image or published release during preparation.
