# Probes

Headless Playwright probes for `pert-gantt-tracker.html`. Run with
`node tests/<name>.js` from the repo root; each prints JSON and exits 0.

`contradiction-sweep.js` is the one that matters most. It loads
`fixtures/crm-rollout.json` — a real export, with the shape the sample data
has never had: a baseline taken after the work started, so activities finish
before their own baseline windows ever open. Every defect found by reading a
screenshot rather than the DOM has needed that shape to appear.

It asserts nothing about what the code does. It recomputes every figure
independently from the stored fields and checks that what the panel SAYS
agrees with what the arithmetic MEANS — no row may read as a fault unless the
finished work actually cost more than it was budgeted, a red RAID chip must
have an issue or a turned risk behind it, the bar's printed delta must equal
AC − PV, and the driver list's claim about summing to the bar must be the
true one.

It also reads `getComputedStyle`, not `className`. A class list can be
correct while the colour that lands is wrong: `.ptr-drv-crit` is declared
later at the same specificity and once repainted an under-budget row red for
a fact about the schedule. An assertion on the class name passed; the screen
was still wrong.
