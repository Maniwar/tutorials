/* ═══════════════════════════════════════════════════════════════════════════
   TEST PLAN — PART ONE: THE NUMBERS.

   Each case carries its DESIGN INTENT (what the app is meant to do and why),
   its EXPECTED value, and the check that produces the ACTUAL. The readable
   plan is generated from this file, so the document and the checks cannot
   drift apart — two artefacts stating one fact is the exact failure this whole
   suite exists to catch.

   Every expected value is derived from the QA reference plan's inputs by hand
   and shown with its arithmetic, so a reader can disagree with the EXPECTATION
   rather than only with the result.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

// A case: { id, area, intent, expect, from, check(ctx) -> actual }
// `ctx` is the page-evaluated snapshot built by the runner.
module.exports = [

  // ── PERT estimation ────────────────────────────────────────────────────
  { id: 'N1', area: 'PERT estimation',
    title: 'Expected duration is the PERT weighted mean',
    intent: 'A three-point estimate exists so the plan carries a range rather than a guess. '
          + 'TE = (O + 4M + P) / 6 weights the most likely outcome four times, which is what '
          + 'makes it a Beta-PERT mean and lets the Monte Carlo agree with the deterministic pass.',
    expect: { 'A Design': 3, 'B Build': 5, 'C Docs': 2, 'D Test': 4, 'E Sign-off': 0 },
    from: '(2+12+4)/6=3 · (4+20+6)/6=5 · (1+8+3)/6=2 · (1+16+7)/6=4 · milestone=0',
    check: c => map(c.activities, a => a.te) },

  { id: 'N2', area: 'PERT estimation',
    title: 'Activity variance is the squared sixth of the range',
    intent: 'Variance drives the sensitivity ranking and the critical-path sigma. '
          + '((P - O) / 6)^2 treats the O-to-P span as roughly six standard deviations, '
          + 'which is the assumption the whole three-point method rests on.',
    expect: { 'A Design': 1/9, 'B Build': 1/9, 'C Docs': 1/9, 'D Test': 1 },
    from: '((4-2)/6)^2 = 1/9 · ((6-4)/6)^2 = 1/9 · ((3-1)/6)^2 = 1/9 · ((7-1)/6)^2 = 1',
    tol: 1e-9,
    check: c => map(c.activities, a => a.variance, ['E Sign-off']) },

  // ── The network ────────────────────────────────────────────────────────
  { id: 'N3', area: 'Critical path method',
    title: 'Forward pass: each activity starts when its last predecessor finishes',
    intent: 'ES is the latest EF among predecessors. If the forward pass ever violates its own '
          + 'edges the finish date is fiction and nothing downstream would notice.',
    expect: { 'A Design': '0→3', 'B Build': '3→8', 'C Docs': '3→5', 'D Test': '8→12', 'E Sign-off': '12→12' },
    from: 'A has no predecessor. B and C both wait on A (EF 3). D waits on B (EF 8). E waits on D and C.',
    check: c => map(c.activities, a => a.es + '→' + a.ef) },

  { id: 'N4', area: 'Critical path method',
    title: 'Backward pass: each activity must finish before its earliest successor must start',
    intent: 'LF is the smallest successor LS, or the project finish where there is no successor. '
          + 'This is what turns a set of durations into float.',
    expect: { 'A Design': '0→3', 'B Build': '3→8', 'C Docs': '10→12', 'D Test': '8→12', 'E Sign-off': '12→12' },
    from: 'C\'s only successor is E at LS 12, so C may finish as late as 12 and start as late as 10.',
    check: c => map(c.activities, a => a.ls + '→' + a.lf) },

  { id: 'N5', area: 'Critical path method',
    title: 'Total slack agrees whether measured from the start or the finish',
    intent: 'Slack must equal LS - ES AND LF - EF. If those two disagree the backward pass is '
          + 'inconsistent with the forward pass and every float figure on the Gantt is wrong.',
    expect: { 'A Design': 0, 'B Build': 0, 'C Docs': 7, 'D Test': 0, 'E Sign-off': 0 },
    from: 'C: LS 10 - ES 3 = 7, and LF 12 - EF 5 = 7. The others are on the critical path.',
    check: c => map(c.activities, a => a.slack) },

  { id: 'N6', area: 'Critical path method',
    title: 'An activity is critical exactly when it has no float',
    intent: 'Critical must be the same statement as zero slack, in both directions. A plan that '
          + 'marks a slack-bearing activity critical over-constrains every decision made from it; '
          + 'one that misses a zero-slack activity hides what actually moves the date.',
    expect: { 'A Design': true, 'B Build': true, 'C Docs': false, 'D Test': true, 'E Sign-off': true },
    from: 'Only C carries float, so only C is not critical.',
    check: c => map(c.activities, a => a.critical) },

  { id: 'N7', area: 'Critical path method',
    title: 'The critical path is a continuous chain that reaches the finish',
    intent: 'It is presented as a PATH, so a reader traces it expecting each activity to feed the '
          + 'next. A disconnected set of zero-slack activities displayed as a sequence is the '
          + 'classic CPM presentation bug.',
    expect: ['A Design', 'B Build', 'D Test', 'E Sign-off'],
    from: 'A(0-3) → B(3-8) → D(8-12) → E(12). No gaps, and it ends where the project ends.',
    check: c => c.criticalPath },

  { id: 'N8', area: 'Critical path method',
    title: 'Project duration is the largest earliest finish',
    intent: 'The plan is as long as its longest chain, not the sum of its parts.',
    expect: 12,
    from: 'D finishes at 12; nothing finishes later.',
    check: c => c.projectDurationDays },

  // ── The calendar ───────────────────────────────────────────────────────
  { id: 'N9', area: 'Working calendar',
    title: 'Durations map onto working days, skipping weekends',
    intent: 'Effort is counted in working days and a commitment is made in calendar dates. The '
          + 'translation must skip weekends or every date quoted to a client is early.',
    expect: { 'A Design': '2026-03-02→2026-03-04', 'B Build': '2026-03-05→2026-03-11',
              'C Docs': '2026-03-05→2026-03-06', 'D Test': '2026-03-12→2026-03-17' },
    from: 'B occupies indices 3,4,5,6,7 = Thu 05, Fri 06, Mon 09, Tue 10, Wed 11 — the weekend is skipped.',
    check: c => map(c.activities, a => a.startDate + '→' + a.finishDate, ['E Sign-off']) },

  { id: 'N10', area: 'Working calendar',
    title: 'A milestone is marked the working day after the work it follows',
    intent: 'DELIBERATE, and the choice is contestable — three independent derivations put this '
          + 'a day earlier. A sign-off is an event somebody attends after the work is finished, '
          + 'not the instant the work stops, so dating go-live on the same day the last build '
          + 'task ends would promise a client something nobody does. Because it is a choice, the '
          + 'panel must SAY so — see B17.',
    expect: '2026-03-18',
    from: 'D finishes Tue 17 Mar; E is marked Wed 18 Mar. The plan spans 13 working days and holds 12.',
    check: c => c.activities['E Sign-off'].finishDate },

  // ── Money ──────────────────────────────────────────────────────────────
  { id: 'N11', area: 'Cost',
    title: 'Activity cost is day rate times duration times allocation',
    intent: 'Cost is what delivery consumes. It is derived rather than typed so it cannot drift '
          + 'from the plan it prices.',
    expect: { 'A Design': 3000, 'B Build': 2500, 'C Docs': 1000, 'D Test': 4000, 'E Sign-off': 0 },
    from: 'Alice $1,000 x 3 · Bob $500 x 5 · Bob $500 x 2 · Alice $1,000 x 4 · milestone $0',
    check: c => map(c.activities, a => a.cost) },

  { id: 'N12', area: 'Cost',
    title: 'A client-side person costs nothing and bills nothing',
    intent: 'The client\'s own people appear in the plan because they consume calendar time and '
          + 'can be double-booked — but they are not your cost and you do not invoice for them. '
          + 'Counting them either way overstates the engagement.',
    expect: { cost: 4000, revenue: 8000 },
    from: 'D is worked by Alice AND Cleo. Cleo is client-side, so D prices on Alice alone.',
    check: c => ({ cost: c.activities['D Test'].cost, revenue: c.activities['D Test'].revenue }) },

  { id: 'N13', area: 'Pricing',
    title: 'Revenue is bill rate times duration, and the totals add up',
    intent: 'Revenue and cost are two different rates over the same effort. Keeping them separate '
          + 'is what makes margin a real number rather than a mark-up assumption.',
    expect: { cost: 10500, revenue: 21000 },
    from: 'cost 3,000+2,500+1,000+4,000 · revenue 6,000+5,000+2,000+8,000',
    check: c => ({ cost: c.projectCost, revenue: c.projectRevenue }) },

  { id: 'N14', area: 'Pricing',
    title: 'Margin is the share of the price that is not cost',
    intent: '(price - cost) / price, computed on the price you will actually invoice. Computing it '
          + 'on a not-to-exceed cap instead was a real defect in this panel once: it reported '
          + '54.8% where the true figure was 37.7%.',
    expect: 50,
    from: '(21,000 - 10,500) / 21,000 = 10,500 / 21,000 = exactly one half',
    tol: 1e-9,
    check: c => c.marginPct },

  // ── Earned value ───────────────────────────────────────────────────────
  { id: 'N15', area: 'Earned value',
    title: 'Planned value is what the baseline said would be finished by today',
    intent: 'PV is the spend curve evaluated at today. It answers "where should we be", and it is '
          + 'the only one of the three that knows about dates.',
    expect: 10500,
    from: 'Today is months after this plan finished, so the whole baselined envelope is due.',
    check: c => c.evm.pv },

  { id: 'N16', area: 'Earned value',
    title: 'Earned value is the budgeted worth of the work actually finished',
    intent: 'EV prices completed work at what it was BUDGETED, not what it cost. That is what lets '
          + 'AC - EV isolate the overrun from the timing.',
    expect: 6500,
    from: 'A 3,000 x 100% + B 2,500 x 100% + C 1,000 x 100% + D 4,000 x 0%',
    check: c => c.evm.ev },

  { id: 'N17', area: 'Earned value',
    title: 'Actual cost is what has been booked',
    intent: 'AC is money out of the door. It carries no opinion about whether the work was worth it.',
    expect: 7000,
    from: '3,000 + 3,500 + 500 + 0',
    check: c => c.evm.ac },

  { id: 'N18', area: 'Earned value',
    title: 'The two measures point in OPPOSITE directions, and both are reported',
    intent: 'THE CASE THIS PLAN WAS BUILT FOR. Activity D is budgeted at $4,000 and never started, '
          + 'so the project sits $3,500 under the spend curve while the work that DID finish came '
          + 'in $500 over its budget. A panel reporting only the first number calls a cost overrun '
          + 'a saving. Both must be available and the difference must be explainable.',
    expect: { cv: -500, svMoney: -4000, gap: -3500 },
    from: 'CV = EV 6,500 - AC 7,000 = -500 (over on work done). '
        + 'SV = EV 6,500 - PV 10,500 = -4,000 (behind). '
        + 'gap = AC 7,000 - PV 10,500 = -3,500 (under the curve).',
    check: c => ({ cv: c.evm.cv, svMoney: c.evm.svMoney, gap: c.evm.gapAgainstPlanToDate }) },

  { id: 'N19', area: 'Earned value',
    title: 'The three quantities reconcile: the gap is timing plus overrun',
    intent: 'gap = (EV - PV) + (AC - EV) is an identity, not a coincidence. It is the identity the '
          + 'budget drill-in was rebuilt around, because without it a row cannot be split into the '
          + 'half that costs nothing and the half that does.',
    expect: true,
    from: '(-4,000) + (+500) = -3,500. Timing plus overrun equals the gap.',
    check: c => Math.abs((c.evm.svMoney + (c.evm.ac - c.evm.ev)) - c.evm.gapAgainstPlanToDate) < 0.01 },

  // ── Resourcing ─────────────────────────────────────────────────────────
  { id: 'N20', area: 'Resourcing',
    title: 'A conflict where all the overlapping work is finished is not counted',
    intent: 'DELIBERATE. Bob genuinely stands at 200% on 5 and 6 March, so a first-principles '
          + 'reading says two over-allocated resource-days — and that is what an independent '
          + 'derivation produced. The app reports zero because both activities are complete: you '
          + 'cannot un-double-book a week that has already happened, and a finding you cannot act '
          + 'on trains people to ignore the ones they can.',
    expect: 0,
    from: 'B and C are both 100% complete, so the overlap is history.',
    check: c => c.resourcingAsShipped },

  { id: 'N21', area: 'Resourcing',
    title: 'The same overlap IS counted while the work is still in flight',
    intent: 'The counterpart to N20, and the reason N20 is a rule rather than a bug. Counted as '
          + '(person x day) PAIRS: one person over on two days is two.',
    expect: { days: 2, people: ['Bob'], dates: ['2026-03-05', '2026-03-06'] },
    from: 'Set C back to 0% and Bob is over on Thu 5 and Fri 6 March: 2 pairs, 1 person, 2 dates.',
    check: c => c.resourcingWithCUnfinished },
];

// helpers — kept here so the case list stays readable
function map(obj, fn, skip) {
  const out = {};
  Object.keys(obj).forEach(k => { if (!skip || skip.indexOf(k) < 0) out[k] = fn(obj[k]); });
  return out;
}
