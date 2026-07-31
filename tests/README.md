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

`schedule-sweep.js` checks the date you COMMIT to — the planning half, where
a wrong figure costs the commitment rather than an argument. It recomputes the
PERT formula, the four network identities (EF−ES, LF−LS, slack both ways),
every dependency edge against its own type and lag, whether the critical path
is a continuous chain that reaches the finish, whether every scheduled date
lands on a working day, and whether the Monte Carlo mean matches the
deterministic finish (Beta-PERT with lambda 4 has a mean of exactly TE, so a
gap is proof the sampler and the forward pass disagree — measured drift is
0.31%).

It found the reserves guidance promising that a committed date "carries 80%
confidence". A P80 is a DURATION and a date is a whole working day, so the
date absorbs more of the distribution than the percentile it was cut from —
82.8% on this plan. Conservative, never the other way, but wrong in the
direction that costs money: you buy more reserve than you meant to.

`ai-boundary-sweep.js` checks what the model is ALLOWED to say — with no API
key, and none needed. The app's AI safety is not the model behaving; it is the
CATALOGUE handed to the model (the only ids it may reference) and the
VALIDATORS that drop anything coming back which cannot resolve. Both are pure
functions of local state plus a response object, so every response here is
hand-written adversarially: invented panels, fabricated citations,
hallucinated ids, owners not on the roster, RAID types the log does not have,
scores off the 1–5 scale, fix verbs the tool cannot perform, and injected
markup.

All of it holds. Every drop is reported by name rather than silently. The
capture path fills the form and never writes to the register. Screen-share
mode bites inside ptDigest, before a request body is built, so no money is in
the text even in principle. And the sweep asserts it made ZERO outbound
requests — if it ever calls out, it is not the thing it claims to be.

One deliberate non-finding: an injected sentence is KEPT. Dropping text for
containing frightening words is keyword filtering and fails on the first
phrasing you did not anticipate. The protection is that a reading has no
execution power and is escaped when drawn — so the sweep proves the escaping
instead of trusting it.

`dynamic-prose-sweep.js` checks that no sentence is FAKING it. The panels do
not just show numbers, they narrate them — "this is not a scope change, all 22
changed rows are test cases", "the gap closes Aug 11, 2026", "$18,279 of it is
overrun". That kind of line is the most valuable thing on the screen and the
easiest thing in the codebase to fake, because a sentence typed once from one
run of one plan is indistinguishable from a computed one: correct on the plan it
was written against and quietly wrong on every other plan forever. Nothing else
here would notice — the numbers it describes are still computed correctly, the
DOM still renders, no arithmetic identity is violated.

The property is mechanical. Run two materially different plans through
Analytics, Plan vs actual, Resources and the Gantt narrative, and harvest every
text node stating money or a calendar date. They must all come out DIFFERENT,
because the plans are different. One that survives both character for character
is not reading either. Two carve-outs, because otherwise it reports noise:
today's date is the same day in both runs and is stripped before a line is
judged, and a legend ("$/hr") is not a claim, so a claim needs three digits of
money or a real date. It also fails if either plan yields under five claims —
a run that harvested nothing proves nothing, and would go green forever the day
a container id changed.

`navigation-sweep.js` checks two things a person other than you depends on.

**The address bar.** Nine tabs and no history: drilling from Analytics into an
activity and on into Plan vs actual left Back meaning "leave the application",
so a mis-click cost the session, the URL never said where you were, and a link
to the Gantt could not be sent. Every tab writes a fragment now, and the sweep
holds all four directions — forward navigation writes one, Back and Forward walk
them, the entry with NO fragment is the first tab rather than a press that
visibly does nothing, and a fragment present at load opens that tab after the
plan is computed rather than before. Every tab is round-tripped, so one of them
cannot go quietly unaddressable.

**The worklist.** It answers "what can this person start now", and it answered
with a truncated name and a date: on a plan of generated test cases every row
read "TC AC-11.3 - edge: mo...", which identifies nothing. The state of the work
was absent and so was the open RAID entry raised against it, sitting in the same
file. The properties are asked rather than the layout: a row names its activity
fully enough to act on, states what is happening to it, names what it waits on
WITH the owner of that, and carries any open RAID entry — and the copied
document holds the same facts in both clipboard flavours.

Two notes on the checks themselves. The RAID case is CONSTRUCTED, because no
committed fixture happens to carry an open entry against an unfinished leaf: the
sample's two open entries sit on a completed activity and on a summary, so a
check that merely looked would pass on a build that never reads RAID at all. And
indistinguishable names are compared within one person's table, not across the
panel — a shared activity legitimately appears on several cards, and the first
version of that check called three such rows a defect.

Two later additions to it, both about a summary with no way out. The worklist
card capped three groups and discarded finished work at the DATA layer, so
"and 6 more" was the end of the road — the caps are a view setting now, and the
sweep tests "Show every row" alone against the one person whose group is over
the cap, because the first version switched on the hidden groups at the same
time and compared totals, which rise either way. The drill-in is checked against
the person with the MOST work: picking the first person with any finished row
gave a target whose every group sat under the cap, so a build that capped the
drill-in to three rows passed — the view that exists BECAUSE the card caps was
itself capped, invisibly.

`ai-boundary-sweep.js` gained the +AC path for the same reason it holds the RAID
catalogue: the model's reply is the untrusted part. An AC id is an IDENTITY —
test cases point at it, the traceability matrix is keyed on it, the SOW quotes it
— so the case that matters is a reply that re-emits an id already in use. Ids are
assigned locally and the reply's are ignored; the sweep stubs a model that hands
back existing ids, an invalid type and an empty criterion, and asserts nothing
that existed moved, changed, or collided.

`bank-sweep.js` gained the dimension that survives the engagement. The bank
could calibrate by activity kind, work type and role, and could not answer the
question that recurs every time the same subcontractor turns up on another
engagement: does THAT firm's work run over. A role cannot answer it (two firms
both field "integration developers") and an individual's name usually cannot
either, because people rarely repeat across clients while the partner does.

Three properties, and the first one matters most: the company has to reach the
ARCHIVED row. Everything else in this file builds its rows by hand, so a build
that never records a company when it archives a real plan would pass every
synthetic case while the calibration sat correct about data that never arrives.
The check sets a company on the roster, asks the archiver for its rows, and
requires the field. Then: work shared between two firms counts for BOTH — `org`
is the owner's company and `orgs` is every company that touched the activity,
and the two are asserted separately because accepting either would let the set
that makes joint work count twice go missing unnoticed. And what the calibration
learns has to reach the PROMPT, since a signal computed and never sent
calibrates nothing.

## The written test plan

`node tests/run-test-plan.js` runs 42 cases and writes two documents:

- **`TEST-PLAN.md`** — the plan alone. Every case states the DESIGN INTENT (what
  the app is meant to do and why), the EXPECTATION, and where the expectation
  came from. Readable and arguable before anything executes.
- **`TEST-RESULTS.md`** — the same document with the ACTUAL result and a verdict
  against each case.

Both are GENERATED from `tests/plan/cases-numbers.js` and
`tests/plan/cases-behaviour.js`. A written plan maintained separately from the
checks it describes drifts, and then the document says one thing while the suite
does another — which is the exact failure this suite exists to catch, so it would
be poor form to build it in here. Edit the cases; never edit the markdown.

21 cases cover the NUMBERS, against the QA reference plan, where every expected
value is derived by hand and shown with its arithmetic. 21 cover the BEHAVIOUR,
because numbers can all be right while the screen still lies — every defect in
this app's recent history was of that shape: an assumption shown as a cause, work
finishing early shown as an overrun, a duration percentile attached to a date, a
person-day count called a calendar day.

Two cases document DELIBERATE choices rather than requirements, so that nobody
rediscovers them as bugs: N10/B17 (a milestone is marked the working day after
the work it follows, and the panel must say so) and N20/N21 (a conflict where all
the overlapping work is finished is not counted, but the same overlap in flight
is).

Worth knowing how it earned its keep on the first run: it failed one case, and
the case was wrong, not the app. B8 demanded that every driver row name both its
halves — but a row with no overrun should not print "$0 ahead of its dates". You
could read that expectation and disagree with it, which is the whole point of
writing the plan down instead of only the assertions.

## The golden reference — the one test self-consistency cannot fake

Everything above checks that the application agrees with ITSELF, and with a
recompute written after reading its source. That has caught every defect so
far, but it has one blind spot by construction: an error absorbed into both the
app and the recompute agrees with itself perfectly and nothing notices.

`golden-reference.js` closes it. `fixtures/qa-reference.json` is a five-activity
plan whose inputs were picked so every derived number is a whole number a person
can check on paper — three-point estimates that make TE exact ((2+12+4)/6 = 3),
round day rates, a calendar starting on a Monday with no holidays, and a TYPED
contract price so nothing depends on a random simulation.
`fixtures/qa-reference.expected.json` holds the answers, derived from those
inputs by hand and carrying their arithmetic with them, so you can audit the
expectation without rerunning anything.

71 checks. A failure here is never style — it means a number the app shows you
is wrong.

Two things the plan is shaped to catch specifically:

**The two cost measures pointing opposite ways.** Activity D is budgeted at
$4,000 and never started, so the plan sits $3,500 UNDER the spend curve while
the work that DID finish came in $500 OVER what it was budgeted. A panel
reporting only the first number calls a cost overrun a saving.

**The rule that finished conflicts are history.** Bob genuinely works B and C at
100% each on 5 and 6 March, so a first-principles reading says two
over-allocated resource-days. The app reports zero, correctly: both are complete
and you cannot un-double-book a week that already happened. The fixture asserts
BOTH — zero as shipped, and two when C is set back to unfinished — so the rule
is pinned rather than rediscovered.

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
