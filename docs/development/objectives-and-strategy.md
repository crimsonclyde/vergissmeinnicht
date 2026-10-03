# Objectives and Strategy

## Mission

VergissMeinNicht helps households and teams remember everyday responsibilities, carry out repeatable procedures together, and retain trustworthy history. Workspaces bring together distinct tools for Procedures, Reminders, Lists and optional house management.

It should answer:

1. What still needs to be done?
2. What was done?
3. Who did it and when?
4. Was anything intentionally skipped or not applicable?
5. Was the whole procedure actually completed?

## Main objectives

### 1. Security first
Security is a product feature and the highest implementation priority.

### 2. Trustworthy history
Historical Runs must preserve the procedure snapshot, actor attribution, reasons, and timestamps.

### 3. Collaboration
Several authorized people can work on one Run together and see updates promptly.

### 4. Clear, supportive everyday use
Reduce memory burden with manageable steps, clear actions, large touch targets, progress and easy undo. These benefits apply to everyone; ADHD remains an influence on the design rather than the headline definition of the product. The planned Today refresh balances what needs attention with what has already been accomplished, without guilt, streaks or rankings (step 17.2).

### 5. Desktop authoring / mobile execution
Complex Procedures should be pleasant to build on desktop and effortless to execute on a phone.

### 6. General-purpose domain
No single use case shapes the architecture. The same system should fit households as well as maintenance, inspections, onboarding/offboarding, deployments, packing, opening/closing routines, and other repeatable procedures.

### 7. Simple self-hosting
Start with a modular monolith and SQLite. Prefer operational simplicity over speculative scale.

## Workspace tools (accepted direction, not yet implemented)

A Workspace admin chooses its functional tools: Procedures (including Runs), Reminders, Lists, Calendar, Documents, Contacts, Maintenance, Equipment and Mail. All are off in new Workspaces; Today, Workspace selection and settings remain available. Existing data is preserved when a tool is disabled. Rollout and dependencies are specified in step 17.1; the current implementation only switches the implemented house-management tools.

## Product model

`Workspace -> Procedure -> Section -> Step`

Starting a Procedure creates:

`Run -> RunStep snapshots + AuditEvents`

Procedure definitions may be edited/deleted. Historical Runs remain intact.

## UX direction

Pending and completed items should be unmistakable.

Color is supportive, not exclusive:
- Pending: clear pending icon/text; reserve strong danger treatment for critical risks, rather than treating every unfinished item as failure
- Done: success/green treatment + check + actor/time
- Skipped / Not Applicable: distinct semantic treatment and optional/required reason

## Brand

The project is named **VergissMeinNicht** (short **VMN**), after *Vergissmeinnicht*, German for the forget-me-not flower and literally “forget me not.” The capitalisation makes the three words — and the abbreviation VMN used in technical identifiers — visible. Package, image and file names stay lower-case (`vergissmeinnicht`) where tooling requires it.

The visual motif is a forget-me-not flower with a knotted stem.

Named visual themes can have personality (for example **Memento Mori**) while the component system itself uses semantic design tokens.
