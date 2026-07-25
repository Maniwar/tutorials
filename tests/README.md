# Probes

Headless Playwright probes for `pert-gantt-tracker.html`. Run any of them with
`node tests/<name>.js` from the repo root; each prints JSON and exits 0.
`_harness.js` finds playwright-core and the pre-installed Chromium wherever the
runner put them, so the probes are not tied to one working directory.

## The two sweeps

Both load `fixtures/crm-rollout.json` — a real export, with the shape the sample
data has never had: a baseline taken after the work started, so activities
finish before their own baseline windows ever open. Every defect found by
reading a screenshot rather than the DOM has needed that shape to appear.

`contradiction-sweep.js` checks one panel against its own arithmetic. It
recomputes every figure independently from the stored fields and asserts on
what the panel MEANS, not what it does: no row may read as a fault unless the
finished work actually cost more than it was budgeted, a red RAID chip must
have an issue or a turned risk behind it, the printed delta must equal AC − PV,
and the driver list's claim about summing to the bar must be the true one.

`cross-surface-sweep.js` checks the surfaces against EACH OTHER. The Plan-truth
bars, the Plan vs actual roll-up cards, the spend curve and the health check all
restate the same handful of numbers, and the defect that matters is any two of
them disagreeing on one screen. It also enforces that a card's pair and its
delta share a reference — the check that was missing when the Budget card read
"$54,293 → $27,900" above "$26,760 above the plan to date", where every figure
was individually correct and the card as a whole said two unrelated things.

`client-facing-sweep.js` checks what LEAVES THE BUILDING — the status report,
the SOW draft, the exports, and whether client-safe mode actually withholds
what it claims to. A number wrong on a screen costs an argument; the same
number wrong in a status report costs money. It caught the report quoting
earned value with no mention of what had been booked, and reporting "variance
on plan" while four activities sat 81 activity-days off their own baselines.

## Read the colour, not the class

`contradiction-sweep.js` reads `getComputedStyle`, not `className`. A class list
can be correct while the colour that lands is wrong: `.ptr-drv-crit` is declared
later at the same specificity and once repainted an under-budget row red for a
fact about the schedule. An assertion on the class name passed; the screen was
still wrong.

## Feature probes

`budget-split.js` — the budget driver rows over four states: early and under,
early and over, exactly on budget, and whether the sum claim is the true one.

`raid-outcomes.js` — outcomes, the cause/watch chip split, the form, the table,
persistence including old files with no outcome field, and "raise the issue it
became".
