# Focused Journal and Notes screens — 2026-11-03

Owner direction: usability is the second product priority after security. The first compact form pass
(35.2) kept too many unrelated tasks in one phone view. The owner prefers separate screens.

## Research and decision

[Day One's iOS entry guide](https://dayoneapp.com/guides/day-one-ios/creating-entries-in-day-one-for-ios/)
shows a quick route into writing and secondary media actions that recede once writing starts. This is a
current product example, not a requirement to copy its autosave, location, AI or media features.
[NN/g's progressive disclosure guidance](https://www.nngroup.com/articles/progressive-disclosure/)
separates frequent actions from optional secondary screens and stresses clear labels and shallow
navigation. The guidance is established research (2006), not a newly published 2026 study.
[Material's full-screen dialog guidance](https://m2.material.io/develop/web/components/dialogs)
supports focused compact-screen tasks with explicit completion and return controls. VMN uses ordinary
in-page sections rather than nested modal dialogs.

Applied design: one entry, three directly reachable screens:

- **Write:** title, Visual/Markdown mode, a compact formatting bar and the text. Save directly here.
- **Details:** date, collection, tags, pinning, optional autosave and saved-entry/history/export actions.
- **Images & links:** existing original-image upload/reuse and authorized Workspace reference picker.

This is optional task navigation, not a mandatory wizard. Users need no metadata or attachment step
for a simple entry. Back from a secondary screen returns to writing; Back from writing returns to the
library through the existing unsaved guard. Screen controls expose the current screen programmatically.
A single draft and mounted editor retain unsaved content and selection during screen changes. Source
switching finishes editor initialization/teardown in order. Hidden invalid fields are revealed before
focus; revisiting a historical revision returns to writing. Secondary screens move focus without
scrolling their heading underneath the sticky action bar.

On phones, bold/italic/heading/list and More form one row with targets of at least 44 × 44 px. More
reveals quote/Undo/Redo. The full desktop toolbar remains. The action bar stays visible while scrolling.
No automatic title, changed privacy policy, new autosave default, offline write queue, tracking,
provider or persistence promise is introduced.

## Verification and limits

The ledger 35.3 records final automated results. Browser coverage exercises 320 and 390 px layouts,
a reduced-height phone viewport, actual text editing and formatting, metadata and image screens,
native validation across hidden fields, unsaved cancellation, private consent/recovery, exports,
light/dark captures, six-theme axe checks and the shared Recipe editor. Reduced viewport height is a
layout simulation, not physical iOS/Android keyboard or screen-reader certification. Original owner
mock-ups and unrelated screenshot assets remain untouched.


## Owner-approved refinement (35.4)

The owner rejected the three-tab phone form after review and approved the staged mockup in this chat:
Title only → visual writing only → optional Details → explicit Save. This supersedes the phone design
above; desktop retains direct screens. The approved follow-up requests icon actions in an iPhone-like
bottom bar, a reusable presentation component for future tool adoption, Cancel and existing encouraging
Gamification overlays. The implementation keeps collection creation as an editable picker with
suggestions from the loaded authorized library page, retains attachments/references in an optional
Details disclosure, and preserves opaque source with a read-only phone preview. Physical keyboard,
screen-reader and low-memory device review remain separate from automated viewport checks.
