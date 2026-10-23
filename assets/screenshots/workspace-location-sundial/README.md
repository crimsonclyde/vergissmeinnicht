# Shared Workspace location and sundial review — 2026-10-23

Fictional isolated demo only. Place/model/forecast requests were intercepted in the browser; no live provider used. Original demo shared location and personal Weather settings were restored after capture. All captures use reduced motion. Clock digital time is unchanged.

- [Location desktop](workspace-desktop.webp), [Location phone](workspace-phone.webp)
- [Personal opt-in desktop](profile-desktop.webp), [Personal opt-in phone](profile-phone.webp)
- [Engraved sundial close-up](sundial-desktop.webp), [forced colours](forced-colors.webp)
- Today: [320](today-320x740.webp), [375](today-375x812.webp), [430](today-430x932.webp), [768](today-768x1024.webp), [1024](today-1024x768.webp), [1440](today-1440x1000.webp), [2560 ultrawide](today-2560x1080.webp), [844×390 landscape](today-844x390.webp).

`checks.json`: no horizontal overflow at any size and no page errors. This is desktop Chromium emulation, not physical iPhone/Android performance testing.

Verification: full Vitest 180 files / 1433 tests pass; root/all-package typecheck; repository lint; production build; existing desktop account browser flow including location Save/Clear/reload, personal opt-in persistence and axe; two focused forest browser checks (3 tests total, 2.1 minutes). The full suite required loopback listener permission for the existing SMTP/SSE tests. Subsequent focused checks (2 files / 15 tests) cover the final current-account reread, including disabling an account during provider work. The final UI smoke capture also verifies rounded canonical values after Save and that editing clears the previous Saved notice. Existing large JS chunk warning and dependency audit findings are unchanged.

The dial has a narrower engraved bronze rim, slate face, one clear gnomon and upright Roman numerals. The previous overlapping shadow, blur, moss blobs and ivy are gone. Minor marks disappear on phones. It remains decorative; digital time is authoritative. Shared location is admin-managed and included in Workspace backups; use of it is a separate personal opt-in in Weather. Deployment requires normal migration 0051; local demo already migrated. Work remains uncommitted on main, with no release or PR.
