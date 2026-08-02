# Probes — these OBSERVE. They never fail.

Everything one directory up is a check: it decides something and sets an exit
code, and the commit gate believes it. Everything in here is the opposite. These
scripts load a plan, put the app into a particular state, and print what they
see. They contain no assertions and they always exit 0.

They live in their own directory because that distinction was invisible while
they sat beside the checks. `budget-split.js` and `raid-outcomes.js` are 473
lines between them, they were written up in the checks README alongside the real
sweeps, and they set no exit code at all — so the directory read as though it
held coverage that nothing executed and nothing could ever report. That is the
same shape as the seven sweeps that once printed contradictions and exited 0: a
red finding arriving as a tick.

They are kept rather than deleted because they are still the fastest way to
answer "what does the panel actually do in this state" — which is what they were
written for, and what a check is bad at. Read their output; do not count them.

If something in here turns into a property worth holding, move the property into
a sweep, where a violation costs somebody a commit.

- `budget-split.js` — the budget driver rows over four states: early and under,
  early and over, late and under, late and over, plus the drill-in layout at
  three viewport widths.
- `raid-outcomes.js` — outcomes, the cause/watch chip split, the form, the table
  and the RAID panel at three viewport widths.

Run either with `node tests/probes/<name>.js` from the repo root.
