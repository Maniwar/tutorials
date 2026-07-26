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

`pricing-sweep.js` checks the money you QUOTE — the least-guarded money
surface and the one where being wrong costs most, since a margin figure is
what you decide to sign on. It recomputes revenue independently (bill rate ×
effort × units, client-kind people billing nothing) rather than calling
`laborRevenue()`: a check that shares a function with the thing it checks
agrees by construction and proves nothing. It runs five states the sample
never reaches — fixed fee with and without a typed price, T&M with a
not-to-exceed cap, a plan priced below cost, and a plan where nobody has a
day rate — plus the client-kind, rate-card-currency and stale-simulation
paths. It found no defects, which given the T&M cap-versus-fee bug this
panel once had is worth having on the record.

Note what it taught about testing rather than about the app: the first
version called `calculate()` after editing a bill rate, and `calculate()`
re-runs the Monte Carlo — so it refreshed the exact staleness the detector
exists to catch and reported a false positive. The paths that genuinely go
stale are the UI setters that deliberately do not recompute (`setBillRate`,
`setKind`), and those are what it exercises now.

`resourcing-sweep.js` checks the panel that answers "can we commit to this
date". The unit is the trap: `computeResourceLoad` counts (person × day)
PAIRS over capacity, not days and not people, and those differ the moment two
people are over on the same date. It found the Level button reporting
"Over-allocated days" and the Resources tab — the screen you open in order to
fix the problem — never stating the total at all.

Two things it taught about writing these. It first tested PTO on a COMPLETED
activity, where the "finished conflicts are history" rule correctly suppressed
it, and reported a bug that was not there. And every count check ran green
against a fixture with zero over-allocation, which is vacuous — so it now
CONSTRUCTS a conflict across two people and several days and makes each
surface account for it.

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
