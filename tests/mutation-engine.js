/* ═══════════════════════════════════════════════════════════════════════════
   DOES THE SUITE HAVE TEETH?

   Nine sweeps and forty-four hand-derived cases were green while the PERT
   weighting was deliberately broken. Not because anyone wrote a bad check —
   because the reference plan's estimates are all symmetric, and for a symmetric
   estimate every weighted mean returns the same answer. The check was correct,
   the fixture could not tell the difference, and the whole apparatus reported
   success on a build that computed the wrong duration.

   That is the failure mode this file exists to catch. It breaks a load-bearing
   identity in the product, one at a time, writes the broken build to a temp
   file, and points the suite at it. Each mutant MUST turn something red. A
   surviving mutant is not a defect in the product — it is proof that a whole
   region of the product is unguarded, and it names which one.

   Usage:  node tests/mutation-engine.js
             Every mutant walks every check until one goes red. A SURVIVED here
             is trustworthy: nothing in the suite noticed.

           node tests/mutation-engine.js --quick
             Only the check expected to notice, plus the hand-derived plan. Fast
             enough to run while editing. A SURVIVED here means "the expected
             check did not catch it" and NOT "the suite has a hole" — some other
             check may well catch it. Confirm with a full run before believing a
             survivor.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'pert-gantt-tracker.html'), 'utf8');
const QUICK = process.argv.indexOf('--quick') >= 0;

/* Each mutant names the identity it breaks and what should notice. `find` must
   match exactly once in the file — a mutant that silently fails to apply is a
   false pass, which is the very thing being hunted here. */
const MUTANTS = [
  { what: 'PERT weighting: the 4x on most-likely becomes 5x over 7',
    find: 'return (O + 4 * M + P) / 6;',
    with: 'return (O + 5 * M + P) / 7;' },

  { what: 'PERT variance: the range is treated as five sigma, not six',
    find: 'function pertVariance(o, p) { return Math.pow(((+p || 0) - (+o || 0)) / 6, 2); }',
    with: 'function pertVariance(o, p) { return Math.pow(((+p || 0) - (+o || 0)) / 5, 2); }' },

  { what: 'criticality: an activity with a day of float is called critical',
    find: 't.isCritical = Math.abs(t.slack) < 0.01;',
    with: 't.isCritical = Math.abs(t.slack) < 1.01;' },

  { what: 'earned value: completed work is valued at its cost, not its budget',
    find: 'const evOf = t => plannedCostOf(t, hb) * ((t.percentComplete || 0) / 100);',
    with: 'const evOf = t => (actOf.get(t.id) || 0);' },

  /* ── the regions that had never been asked this question ──────────────────
     Four caught mutants proved four regions guarded and said nothing about the
     rest. These are the ones named as unverified: the backward pass, the working
     calendar, resource pair counting, the percentile rule, save/load field
     coverage, and the margin. A survivor here is not a product defect — it is a
     region where a defect could ship unnoticed, which is worth knowing. */

  { what: 'backward pass: slack measured from the finish instead of the start',
    find: 't.slack = t.ls - t.es;',
    with: 't.slack = t.lf - t.ef + 0.5;' },

  { what: 'working calendar: weekends counted as working days',
    find: '        if (isWorkingDay(d, holidays)) added++;',
    with: '        added++;' },

  { what: 'resource load: a double-booked day counted once per person, not per pair',
    find: '            overResourceDays++;',
    with: '            /* mutant: the day is no longer counted */' },

  { what: 'percentile: P80 reads the 80th value of an UNSORTED series',
    find: "      const pct = q => durations[Math.min(durations.length - 1, Math.floor(q * durations.length))];",
    with: "      const pct = q => durations[Math.min(durations.length - 1, Math.floor(q * durations.length * 0.75))];" },

  { what: 'save/load: percentComplete is written but never read back',
    find: '          percentComplete: t.percentComplete, predecessors: t.predecessors,',
    with: '          predecessors: t.predecessors,' },

  { what: 'margin: computed against cost instead of price',
    find: '      const margin = (price > 0 && !costBlind) ? (price - cost) / price * 100 : null;',
    with: '      const margin = (price > 0 && !costBlind) ? (price - cost) / cost * 100 : null;' },

  /* ── what leaves the application ──────────────────────────────────────────
     An export is read by a client, or loaded into Jira, or opened in Excel by
     someone with no way to tell a total is wrong. It is the one category where
     the mistake is seen by somebody else first. */

  { what: 'billing CSV: the TOTAL row overstates cost by 10%',
    find: 'd.totCost.toFixed(0), d.totBill.toFixed(0)]);',
    with: '(d.totCost*1.1).toFixed(0), d.totBill.toFixed(0)]);' },

  { what: 'Jira CSV: the first story is silently dropped',
    find: '      reqs.stories.forEach(st => {',
    with: '      reqs.stories.slice(1).forEach(st => {' },

  { what: 'billing CSV: a line emits its cost as NaN',
    find: 'r.cost.toFixed(0), r.billed.toFixed(0)',
    with: '(r.cost*undefined).toFixed(0), r.billed.toFixed(0)' },

  /* ── undo ─────────────────────────────────────────────────────────────────
     The one feature a person reaches for when they already believe something
     has gone wrong, which is what makes a partial restore worse than none.

     Note on a mutant that is NOT here: removing `redoStack = keepRedo` from
     doRedo. restoreSnapshot sets undoGuard before its internal saveLocal, so
     trackUndo returns before it can clear the branch — the line is dead defence
     and its removal changes nothing observable. Verified by tracing redoStack
     through a three-step redo on both builds: identical. An equivalent mutant
     no test can catch, so listing it would report a permanent false hole. */

  { what: 'undo: the history is a bag — it pops the oldest state, not the newest',
    find: '      restoreSnapshot(undoStack.pop());',
    with: '      restoreSnapshot(undoStack.shift());' },

  { what: 'undo: the guard fails, so undo records itself and stops progressing',
    find: '      if (undoGuard) { lastSnapshot = currentStr; return; }',
    with: '      if (false) { lastSnapshot = currentStr; return; }' },

  { what: 'undo: the depth cap discards the newest step instead of the oldest',
    find: '        if (undoStack.length > 60) undoStack.shift();',
    with: '        if (undoStack.length > 60) undoStack.pop();' },

  { what: 'undo: editing after an undo keeps the abandoned redo branch alive',
    find: '        redoStack = [];',
    with: '        /* mutant: the branch is kept */' },

  { what: 'undo: the restore rewinds the activities but not the RAID log',
    find: '        hydrate(JSON.parse(str));',
    with: '        { const _k = raid; hydrate(JSON.parse(str)); raid = _k; }' },

  /* ── the reference every variance is measured against ─────────────────────
     Break the baseline and nothing looks broken: the plan reports itself
     against the wrong past, confidently and self-consistently. */

  { what: 'baseline: it freezes the dates but not the effort',
    find: '        t.baseTe = t.te;',
    with: '        t.baseTe = t.te * 1.15;' },

  { what: 'baseline: the feature set is committed at a different moment than the dates',
    find: '      reqsBaseline = {\n        at: baselineDate,',
    with: "      reqsBaseline = {\n        at: '2020-01-01'," },

  { what: 'baseline: the reference tracks the plan instead of holding still',
    find: '        t.baseCost = taskCost(t);',
    with: "        t.baseCost = taskCost(t);\n        Object.defineProperty(t,'baseTe',{get(){return this.te;},configurable:true});" },

  { what: 'baseline: clearing keeps the committed feature set',
    find: "      reqsBaseline = null;\n      // logged, not truncated",
    with: "      // logged, not truncated" },

  { what: 'baseline: the reference dates are never written to the file',
    find: '          baseStart: t.baseStart ? fmtISO(new Date(t.baseStart)) : null,',
    with: '          baseStart: null,' },

  { what: 'change order: approval does not roll the baseline, so the next one re-bills',
    find: '      sowBaseline = snapshotSowBaseline(); // next CO diffs from here',
    with: '      /* mutant: the baseline is not rolled */' },

  { what: 'change order: approval leaves the draft pending and it can be logged twice',
    find: '      draftChangeOrder._pending = null;\n      saveLocal();\n      renderCoHistory();',
    with: '      saveLocal();\n      renderCoHistory();' },

  { what: 'change order: the log records a price delta the client never approved',
    find: 'priceDelta: p.priceDelta, newFinish: p.newFinish',
    with: 'priceDelta: (p.priceDelta||0)+500, newFinish: p.newFinish' },

  /* ── the dependency wizard: a button that acts on something else ───────────
     These three are not arithmetic. They are the shape of defect the user hit
     and no check could see: the control is wired, the handler runs, the data
     changes — and it is the WRONG object, or the button is off the edge of the
     dialog where no click can reach it. Reported as "the buttons don't do
     anything", which is what a correct handler on an unreachable or misaddressed
     control looks like from the outside. */

  { what: 'wizard: ✎ Open sends you to the task in the headline, whose link list is empty',
    find: 'const openId = holder ? holder.id : id;',
    with: 'const openId = id;' },

  /* ── the split budget bar and the catch-up date ────────────────────────────
     Both of these went wrong on the way in, and neither threw: the segments
     stacked naively so the drawn far end stated the timing figure while the
     badge stated the net, and the catch-up search bisected on instants and then
     floored the answer, naming a day on which the curve had not yet reached the
     booked total. A panel that talks a reader out of an alarm has to be right
     about the date it does it with. */

  { what: 'budget bar: the neutral segment carries the overrun instead of the timing',
    find: '        const timing = (evNow != null && pvNow != null) ? evNow - pvNow : null;',
    with: '        const timing = (evNow != null && pvNow != null) ? actCost - evNow : null;' },

  { what: 'budget bar: the segments stack naively, so the drawn end is not the gap',
    find: '            const lo = counter ? Math.min(a, b2) : Math.max(Math.min(a, b2), loN);',
    with: '            const lo = Math.min(a, b2);' },

  { what: 'catch-up: the crossing date is floored to the midnight before it',
    find: '      return { on: stripTime(new Date(dayAt(hiD))), days: hiD };',
    with: '      return { on: stripTime(new Date(dayAt(hiD) - 86400000)), days: hiD };' },

  /* ── one envelope, not three ───────────────────────────────────────────────
     The Budget bar divides by an envelope, the spend curve totals one, and the
     note says the bar IS the curve's vertical gap at today. On a plan with work
     added after the baseline they were three different numbers, because
     pvSpread never fell back to live DATES the way plannedCostOf falls back to
     live COST, and the bar's denominator summed `baseCost || 0` — the exact bug
     budgetAtCompletion carries a comment about. Invisible until a real export
     with twelve post-baseline test cases arrived. */

  { what: 'envelope: the curve drops work the baseline never dated',
    find: '        const s1 = (ub ? t.baseStart : t.startDate) || t.startDate;\n        const f1 = (ub ? t.baseFinish : t.finishDate) || t.finishDate;',
    with: '        const s1 = ub ? t.baseStart : t.startDate;\n        const f1 = ub ? t.baseFinish : t.finishDate;' },

  { what: 'envelope: the bar divides by the frozen sum instead of the plan',
    find: '        const ref = baseCost > 0 ? budgetAtCompletion(hb) : planCost;',
    with: '        const ref = baseCost > 0 ? baseCost : planCost;' },

  /* the scope verdict, in both directions — "no change order is due" is the most
     expensive sentence on the page to get wrong */

  { what: 'scope: test-case regeneration is never named as verification work',
    find: "        if (verificationOnly && featureHeld && scp.state !== 'flat') {",
    with: '        if (false) {' },

  { what: 'scope: real growth is cleared as verification work',
    find: '        const verificationOnly = moved.length > 0 && movedTc === moved.length;',
    with: '        const verificationOnly = moved.length > 0;' },

  { what: 'form: a template placeholder is printed at the reader again',
    find: '<div id="rScore" class="raid-score">\u2014</div>',
    with: '<span class="help-text">Score $' + '{\'\' /' + '* prob x impact *' + '/}</span>' },

  { what: 'form: the RAID owner box is no longer a type-ahead',
    find: '      populateOwnerList();\n      /* Status had no control at all.',
    with: '      /* Status had no control at all.' },

  { what: 'drill-in: the badge counts the top 5 rather than everything that matched',
    find: '      const shownN = r.drivers.length, totalN = r.drivers.matched || shownN;',
    with: '      const shownN = r.drivers.length, totalN = shownN;' },

  /* ── the red ring ─────────────────────────────────────────────────────────
     It lands on GREEN cells, so a red ring on a finished activity reads as "done
     badly". It never means that: only that the RECORD of what happened is
     missing or impossible. Reported by someone whose ringed activities had all
     come in under their estimates. */

  { what: 'ring: the caption counts the flagged cells and names no reason',
    find: "          + (top.length ? ': ' + top.join(', ') + '.' : '.')",
    with: "          + '.'" },

  { what: 'ring: nothing says the ring is about the record, not about effort',
    find: "              + '<i class=\"ptr-c-done ptr-flag-high\"></i>the <b>record</b> needs a second look — dates, '\n              + 'cost or an open RAID entry, not effort</span>' : '');",
    with: "              + '<i class=\"ptr-c-done ptr-flag-high\"></i>needs a second look</span>' : '');" },

  /* ── the corrupt file ──────────────────────────────────────────────────────
     A real plan with two pairs of test cases sharing activity ids. Everything is
     keyed by id, so the pairs collided, the topological sort miscounted, the
     cycle finder started from `undefined` and threw — out of recompute, out of
     ensureCalculated, out of switchTab. Five tabs dead, the estimate bank blank,
     Calculate inert. One TypeError, no error boundary anywhere above it, and
     three sweeps plus forty-five hand-derived cases green the whole time. */

  { what: 'corrupt file: the cycle finder dies on an empty cycle set again',
    find: ['      if (!inCycle.size) return null;\n      let cur = inCycle.values().next().value;',
           '      while (cur != null && !seen.has(cur)) {',
           '        const nxt = (preds[cur] || []).find(p => inCycle.has(p.id));'],
    with: ['      let cur = inCycle.values().next().value;',
           '      while (!seen.has(cur)) {',
           '        const nxt = preds[cur].find(p => inCycle.has(p.id));'] },

  { what: 'corrupt file: duplicate ids are no longer healed on load',
    find: '      repairDuplicateTaskIds({ silent: true });',
    with: '      /* mutant: the file loads corrupt */' },

  { what: 'corrupt file: the notice blames a loop for a duplicate id',
    find: '      const dup = findDuplicateTaskIds();\n      if (dup.length)',
    with: '      const dup = [];\n      if (dup.length)' },

  /* ── the two the user found on the live demo ──────────────────────────────
     Both are about what a panel says when it has nothing to show. One told a
     reader with 41 activities to add activities; the other showed forty-four
     full-sentence rows where a count belonged. Neither is an arithmetic error,
     and neither would ever throw. */

  { what: 'blocked tab: a plan with a dependency loop shows the first-run message again',
    find: '      if (!schedOk && tasks.length) paintScheduleBlocked();',
    with: '      /* mutant: nothing says why the tab is empty */' },

  { what: 'blocked tab: the reason is overwritten by the next repaint',
    find: '      if (!calculated) { host.innerHTML = scheduleBlockedHtml(); return; }',
    with: '      if (!calculated) { host.innerHTML = blank; return; }' },

  { what: 'blocked tab: Calculate fails silently again',
    find: '      if (!recompute()) {\n        const loop = findScheduleCycleIds() || [];',
    with: '      if (!recompute()) { return; }\n      if (false) {\n        const loop = findScheduleCycleIds() || [];' },

  { what: 'changes panel: a large diff expands over the whole tab again',
    find: '      const BIG = d.total > 12;',
    with: '      const BIG = false;' },

  /* ── the side readout ─────────────────────────────────────────────────────
     Three separate facts that used to be one middot-joined sentence in a badge.
     Split apart, each can now disagree with the others on its own, and two of
     those disagreements would put an alarm back on a plan that is fine. */

  { what: 'readout: the caption contradicts the direction of the figure beside it',
    find: "          : bv.gap > 0 ? 'ahead of the spend curve' : 'behind the spend curve';",
    with: "          : bv.gap > 0 ? 'behind the spend curve' : 'ahead of the spend curve';" },

  { what: 'readout: an underrun is painted as a fault',
    find: "          bud.deltaVerdictTone = tiny ? 'flat' : overAll > 0 ? 'bad' : 'good';",
    with: "          bud.deltaVerdictTone = 'bad';" },

  /* ── the two surfaces that had no checks at all ────────────────────────────
     The commitment history and the estimate bank. The bank matters most: it is
     the only data here that outlives the project file, and a wrong median in it
     surfaces as a quote that is light — on the next engagement, to a different
     client, with nothing on any screen looking wrong. */

  { what: 'baseline history: taking a baseline no longer records the commitment',
    find: "      baselineLogPush('set');",
    with: '      /* mutant: the commitment is not recorded */' },

  { what: 'baseline history: clearing truncates the log instead of appending to it',
    find: "      baselineLogPush('clear');",
    with: '      baselineLog = [];' },

  { what: 'baseline history: the cap drops the ORIGINAL commitment',
    find: '        const gone = baselineLog.splice(1, 1)[0];',
    with: '        const gone = baselineLog.splice(0, 1)[0];' },

  { what: 'baseline history: the reset count ignores what the cap took',
    find: "      return baselineLog.filter(e => e.kind === 'set').length\n        + ((baselineLog[0] && baselineLog[0].trimmedSets) || 0);",
    with: "      return baselineLog.filter(e => e.kind === 'set').length;" },

  { what: 'baseline history: the log is never written to the file',
    find: '        resources, reserves, baselineDate, baselineLog, levelMode, projectBudget,',
    with: '        resources, reserves, baselineDate, levelMode, projectBudget,' },

  { what: 'bank: forgetting a project shortens the list without dropping the records',
    find: '      const keep = all.filter(r => r.proj !== proj);',
    with: '      const keep = all.slice(0, Math.max(0, all.length - 1));' },

  { what: 'bank: span-derived actuals are taught to the estimator as measured effort',
    find: "    function bankCalibration() {\n      const rows = loadBank().filter(r => r.basis === 'logged' && r.ratio > 0);",
    with: "    function bankCalibration() {\n      const rows = loadBank().filter(r => r.ratio > 0);" },

  { what: 'test plan: the sample ships its test cases as one serial chain again',
    find: '      unchainTestCases({ silent: true });',
    with: '      /* mutant: the sample ships chained */' },

  { what: 'wizard: ⑂ Nest offers to re-parent a test case under a phase',
    find: '&& predT && !isTestCaseTask(predT) && !predIsPhase',
    with: '&& predT && !isTestCaseTask(predT)' },

  /* Two edits, because either alone still fits: putting the buttons back beside
     the text only overflows once they also stop wrapping, and a mutant that
     survives for being too small reads as a hole in the sweep that is not one. */
  { what: 'wizard: the buttons sit beside the text again and run off the dialog',
    find: ['rows += `<div style="padding:0.5rem 0.65rem;border:1px solid',
           '<div style="display:flex;gap:0.35rem;flex-wrap:wrap;justify-content:flex-end;margin-top:0.4rem">'],
    with: ['rows += `<div style="display:flex;align-items:flex-start;gap:0.6rem;padding:0.5rem 0.65rem;border:1px solid',
           '<div style="display:flex;gap:0.35rem;flex-shrink:0;flex-wrap:nowrap;justify-content:flex-end">'] },

  /* ── prose that only pretends to read the plan ────────────────────────────
     Every other mutant here breaks a computation. This one leaves the
     computation perfectly correct and stops the SENTENCE from using it — the
     figure is still right everywhere else on the page, and one caption states
     a number typed by hand. That is the shape of defect a reader cannot catch
     by eye, because a hardcoded claim reads exactly like a computed one, and it
     is the shape nothing in the suite could see before dynamic-prose-sweep. */

  { what: 'prose: the booked-to-date caption states a figure typed by hand',
    find: "escapeHtml(hasAc ? money(c.ac) + ' booked' : 'nothing booked')",
    with: "escapeHtml(hasAc ? '$27,900 booked' : 'nothing booked')" },

  /* ── one rule, asked in four places ───────────────────────────────────────
     computeResourceLoad does not count a day whose overlapping work is all
     finished. The heatmap cell, its tooltip, the day drill-in and the mend cards
     all restate that judgement, and three of them used to re-derive it naively —
     so a red cell sat beside a badge reading OK, and the drill-in's jump button
     pointed at a mend card that is never built for a discounted day and did
     nothing at all when clicked. */

  { what: 'heatmap: a day is painted as a conflict on raw load, ignoring the finished-work rule',
    find: '          const isOver = overSet.has(iso);',
    with: '          const isOver = load > R.capacity + 1e-6;' },

  { what: 'heatmap: the day drill-in re-derives "over" and offers a jump with nowhere to land',
    find: '        const isOver = (R.overDays || []).indexOf(iso) >= 0;',
    with: '        const isOver = day.load > R.capacity + 1e-6;' },

  { what: 'heatmap: a 200% peak sits beside a bare green OK with nothing reconciling them',
    find: '            : R.peak > R.capacity + 1e-6',
    with: '            : false' },
];

const CHECKS = QUICK ? ['run-test-plan.js']
  : ['run-test-plan.js', 'golden-reference.js', 'contradiction-sweep.js',
     'schedule-sweep.js', 'drawn-surfaces-sweep.js', 'pricing-sweep.js',
     'resourcing-sweep.js', 'persistence-sweep.js', 'export-sweep.js', 'undo-sweep.js', 'baseline-sweep.js', 'cross-surface-sweep.js', 'task-editor-sweep.js',
     'client-facing-sweep.js', 'dialog-sweep.js', 'chart-reconciliation-sweep.js',
     'bank-sweep.js', 'corrupt-file-sweep.js', 'dynamic-prose-sweep.js'];

/* Which check is EXPECTED to notice. This is a running order, not a shortcut:
   if the named check does not go red the mutant still walks every other one, so
   a genuine hole is still found and still reported by name. It exists because
   the naive order made this file unfinishable — a mutant caught by the last of
   fourteen checks costs ninety seconds, and twenty-six of those exceeded ten
   minutes and were killed before ever printing a verdict. A check nobody can
   afford to run is a check that does not run. */
const LIKELY = {
  'billing CSV': 'export-sweep.js', 'Jira CSV': 'export-sweep.js',
  'save/load': 'persistence-sweep.js', 'undo:': 'undo-sweep.js',
  'baseline:': 'baseline-sweep.js', 'change order:': 'baseline-sweep.js',
  'criticality': 'drawn-surfaces-sweep.js', 'resource load': 'resourcing-sweep.js',
  'margin': 'pricing-sweep.js', 'wizard:': 'dialog-sweep.js',
  'budget bar:': 'chart-reconciliation-sweep.js', 'catch-up:': 'chart-reconciliation-sweep.js',
  'test plan:': 'run-test-plan.js', 'baseline history:': 'baseline-sweep.js',
  'bank:': 'bank-sweep.js', 'readout:': 'contradiction-sweep.js',
  'blocked tab:': 'dialog-sweep.js', 'changes panel:': 'drawn-surfaces-sweep.js',
  'corrupt file:': 'corrupt-file-sweep.js', 'ring:': 'drawn-surfaces-sweep.js',
  'envelope:': 'chart-reconciliation-sweep.js', 'scope:': 'chart-reconciliation-sweep.js',
  'form:': 'drawn-surfaces-sweep.js', 'drill-in:': 'chart-reconciliation-sweep.js',
  'prose:': 'dynamic-prose-sweep.js', 'heatmap:': 'resourcing-sweep.js'
};
const orderFor = m => {
  const hit = Object.keys(LIKELY).find(k => m.what.indexOf(k) === 0 || m.what.indexOf(k) >= 0);
  const first = hit ? LIKELY[hit] : null;
  return first ? [first].concat(CHECKS.filter(c => c !== first)) : CHECKS.slice();
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ptr-mut-'));

function runAsync(script, appFile) {
  return new Promise(resolve => {
    const ch = spawn(process.execPath, [path.join(__dirname, script)],
      { cwd: ROOT, env: Object.assign({}, process.env, { APP_FILE: appFile }), stdio: 'pipe' });
    let out = '';
    ch.stdout.on('data', d => out += d);
    ch.stderr.on('data', d => out += d);
    const t = setTimeout(() => { try { ch.kill('SIGKILL'); } catch (e) {} }, 180000);
    ch.on('close', code => { clearTimeout(t); resolve(code === 0 ? null : (out.trim() || 'exited non-zero')); });
  });
}

/* One mutant may need more than one edit. A defect is not always one line: the
   wizard's layout regression was a flex container and a shrink rule, and either
   half alone leaves a page that still fits, so a single-edit mutant would
   SURVIVE and be reported as a hole in the sweep that isn't one. `find`/`with`
   therefore accept arrays, applied in order, each still required to match
   exactly once — the anchor check is the whole reason a mutant can be trusted
   to have applied at all. */
async function judge(m, i) {
  const finds = [].concat(m.find), withs = [].concat(m.with);
  if (finds.length !== withs.length) return { m, skipped: true,
    why: 'it lists ' + finds.length + ' anchor(s) and ' + withs.length + ' replacement(s)' };
  let src = SRC;
  for (let k = 0; k < finds.length; k++) {
    const n = src.split(finds[k]).length - 1;
    if (n !== 1) return { m, skipped: true, why: 'anchor ' + (k + 1) + ' of ' + finds.length
      + ' matches ' + n + ' times in the source, so this mutant cannot be trusted to have applied' };
    src = src.replace(finds[k], withs[k]);
  }
  const file = path.join(tmp, 'mutant-' + i + '.html');
  fs.writeFileSync(file, src);
  for (const c of orderFor(m)) {
    if (await runAsync(c, file)) return { m, by: c };
  }
  return { m, survived: true };
}

(async () => {
  /* Mutants are independent, so they run several at a time. The cap is small on
     purpose: each one launches a browser, and oversubscribing turns a fast run
     into a slow one that also reports flaky timeouts as holes. */
  const LANES = Math.max(1, Math.min(4, (os.cpus() || []).length - 2 || 2));
  const results = new Array(MUTANTS.length);
  let next = 0, done = 0;
  const lane = async () => {
    while (true) {
      const i = next++;
      if (i >= MUTANTS.length) return;
      results[i] = await judge(MUTANTS[i], i);
      done++;
      if (process.stderr.isTTY) process.stderr.write('\r  ' + done + '/' + MUTANTS.length + ' judged   ');
    }
  };
  await Promise.all(Array.from({ length: LANES }, lane));
  if (process.stderr.isTTY) process.stderr.write('\r');

  /* SURVIVED and SKIPPED are different findings and were reported as one number.
     A survivor says a region of the PRODUCT is unguarded. A skip says this FILE
     is stale — its anchor no longer matches, usually because the code it aimed at
     was edited — and the region may be perfectly well covered. Printing "1 of 38
     survived — the suite has holes there" for a stale anchor sends someone
     hunting for a hole that is not there, and worse, hides a real survivor behind
     a number that is routinely nonzero. Both still fail the run: a mutant that
     cannot apply is proving nothing and has to be repaired. */
  let survived = 0, skipped = 0;
  results.forEach(r => {
    if (r.skipped) { skipped++; console.log('SKIPPED  ' + r.m.what + '\n         ' + r.why); }
    else if (r.by) console.log('CAUGHT   ' + r.m.what + '\n         → ' + r.by);
    else { survived++; console.log('SURVIVED ' + r.m.what
      + '\n         nothing in the suite noticed. This identity is unguarded.'); }
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  const parts = [];
  if (survived) parts.push(survived + ' of ' + MUTANTS.length
    + ' mutants SURVIVED — those regions of the product are unguarded');
  if (skipped) parts.push(skipped + ' mutant(s) could not be applied — this FILE is stale, not the suite: '
    + 'the anchor was edited out of the product. Repair the anchor; it is proving nothing until you do');
  console.log(parts.length ? '\n' + parts.join('.\n') + '.'
    : '\nall ' + MUTANTS.length + ' mutants were caught.');
  process.exitCode = (survived || skipped) ? 1 : 0;
})();
