# Objectives and Strategy

## Mission

Vergissmeinnicht helps people reliably execute repeatable real-world procedures and retain trustworthy evidence of what was done.

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

### 4. ADHD-friendly execution
The Run UI must reduce memory burden: strong state contrast, minimal ambiguity, large touch targets, clear progress, easy undo, and obvious completion.

### 5. Desktop authoring / mobile execution
Complex Procedures should be pleasant to build on desktop and effortless to execute on a phone.

### 6. General-purpose domain
Casa Nostra is the first use case, not the architecture. The same system should fit maintenance, inspections, onboarding/offboarding, deployments, packing, opening/closing routines, and other repeatable procedures.

### 7. Simple self-hosting
Start with a modular monolith and SQLite. Prefer operational simplicity over speculative scale.

## Product model

`Workspace -> Procedure -> Section -> Step`

Starting a Procedure creates:

`Run -> RunStep snapshots + AuditEvents`

Procedure definitions may be edited/deleted. Historical Runs remain intact.

## UX direction

Pending and completed items should be unmistakable.

Color is supportive, not exclusive:
- Pending: danger/red treatment + pending icon/text
- Done: success/green treatment + check + actor/time
- Skipped / Not Applicable: distinct semantic treatment and optional/required reason

## Brand

The project is named **Vergissmeinnicht**, German for the forget-me-not flower and literally “forget me not.”

The visual motif is a forget-me-not flower with a knotted stem.

Named visual themes can have personality (for example **Memento Mori**) while the component system itself uses semantic design tokens.
