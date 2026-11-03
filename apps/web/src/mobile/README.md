# Shared phone editing controls

`useCompactLayout()` and the stylesheet use the same 40rem breakpoint. This is presentation only.

Mount one `MobileActionBar` during focused compact editing. Pass secondary `actions` and one `primary`
action: a stable id, translated accessible label, bundled `UiIconName`, disabled state, and callback or
native submit/form association. Use the existing centralized Tabler `UiIcon` registry: identical
24px artwork and 1.75 stroke across actions, without adding an icon font or another icon family. Back, Next, Save, Cancel and other reviewed tool actions use the same
surface; the consuming feature owns their meaning, capabilities, validation and unsaved guard. Keep
secondary actions few enough for 320px; use an existing disclosure for larger menus. Avoid destructive
icons without the feature's ordinary confirmation policy.

The bar portals to the body to avoid transformed theme containers. It measures its height and the
visual viewport, lifts above the keyboard, retains the existing iOS drift correction, and clears all
observers/listeners/root properties on unmount. End spacing keeps page content and the licence footer
reachable. It renders native buttons with names/tooltips and 48px minimum targets; colors are tokens.

Gamification remains `ProgressProvider`'s responsibility. The shared phone stylesheet positions its
overlay above the bar/keyboard and lets decorative content pass pointer events through. Buttons in
this bar never award points themselves or create success messages before a server response.

Consumers: Notes/personal Journal, staged Procedure authoring and Recipe authoring. The Procedure outline uses five
equal 48px icon buttons (Back, Cancel, Section, Step, Next); primary emphasis changes color, not size.
Other tools can adopt the component without importing
Journal state or changing any server permission. Browser coverage lives in `e2e/phone-journal.ts`, `e2e/phone-procedure.ts` and `e2e/phone-recipe.ts`;
keyboard geometry and zoom/drift negatives are in `viewport-drift.test.ts`. Real iOS/Android keyboard
and screen-reader behavior still needs physical-device review.

## Shared staged editing flow

`usePhoneEditorFlow({ stages, busy, onReveal? })` supplies the compact breakpoint, current stage,
Next/Back, visited stages, form/heading refs, and native invalid-field recovery. Use stable ordered
stage names, `data-editor-stage="name"` on each panel, and `hidden={compact && stage !== 'name'}`.
Wire the form's invalid capture to `onInvalid`; Next validates just the current panel, while final
native submission validates all fields and reveals the first invalid panel/disclosure. `onReveal`
lets a feature select a nested item (e.g. a Recipe ingredient). `PhoneFlowHeading` provides the same
progress wording and focus target. Stage changes preserve mounted inputs; visited stages support
lazy rich-editor initialization. No saved draft, mutation, permission or reward is implied.

The feature still owns its draft, save command, unsaved guard, optional fields and success handling.
Its submit handler advances before the last phone stage and saves only on the last stage. Back on the
first stage calls the supplied cancellation policy. This is a small presentation layer, not a schema
form generator. Recipes and Reminders/Procedure schedules use it now; Journal and the Procedure
builder already share the bar and can migrate their flow mechanics separately without changing UX.

For a native modal, render `MobileActionBar withinDialog` inside the dialog: a body portal would sit
outside its focus/inert boundary. The compact dialog must occupy the viewport without a transform.
Portal the dialog itself if its opener may be hidden at another breakpoint. The bar registry gives
modal bars priority, temporarily hides a background editing bar and restores it when the modal closes,
including measured clearance and observer cleanup. Default nonmodal bars still portal to the body.

Document creation also uses this layer (Files → Title → Details), with its existing upload adapter;
file selection and upload controls stay on Files and do not acquire new storage semantics.

`PhoneEditorDialog` composes this flow for modal editors. Supply stages (`id`, translated `title`),
a dirty comparison, submit/close callbacks and a render function receiving the compact stage or
`undefined` on desktop. Keep fields mounted and stage panels marked as above. The dialog owns busy,
errors, native modal focus and dirty dismissal/departure guards; the feature owns API/revision/data
semantics. Document details and single-record Move are the first consumers. Do not nest a second
navigation guard owner inside it. Destructive confirmations remain separate reviewed interactions.

Equipment, Maintenance, Contacts, Bring and Lists also use PhoneEditorDialog. `submitDisabled` carries
feature-specific final-save predicates; native stage validation handles required fields on Next.
A successful mutation callback that navigates must intentionally bypass its now-stale dirty guard,
only after the command succeeds. Preserve inline quick-add and existing offline/domain adapters.
