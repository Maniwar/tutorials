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
    find: '      reqsBaseline = null;\n      saveLocal(); renderBaseline();',
    with: '      /* mutant: feature set kept */\n      saveLocal(); renderBaseline();' },

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
];

const CHECKS = QUICK ? ['run-test-plan.js']
  : ['run-test-plan.js', 'golden-reference.js', 'contradiction-sweep.js',
     'schedule-sweep.js', 'drawn-surfaces-sweep.js', 'pricing-sweep.js',
     'resourcing-sweep.js', 'persistence-sweep.js', 'export-sweep.js', 'undo-sweep.js', 'baseline-sweep.js', 'cross-surface-sweep.js', 'task-editor-sweep.js',
     'client-facing-sweep.js'];

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
  'margin': 'pricing-sweep.js'
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

async function judge(m, i) {
  const n = SRC.split(m.find).length - 1;
  if (n !== 1) return { m, skipped: true, why: 'its anchor matches ' + n + ' times in the source, '
    + 'so this mutant cannot be trusted to have applied' };
  const file = path.join(tmp, 'mutant-' + i + '.html');
  fs.writeFileSync(file, SRC.replace(m.find, m.with));
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

  let survived = 0;
  results.forEach(r => {
    if (r.skipped) { survived++; console.log('SKIPPED  ' + r.m.what + '\n         ' + r.why); }
    else if (r.by) console.log('CAUGHT   ' + r.m.what + '\n         → ' + r.by);
    else { survived++; console.log('SURVIVED ' + r.m.what
      + '\n         nothing in the suite noticed. This identity is unguarded.'); }
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(survived
    ? '\n' + survived + ' of ' + MUTANTS.length + ' mutants survived — the suite has holes there.'
    : '\nall ' + MUTANTS.length + ' mutants were caught.');
  process.exitCode = survived ? 1 : 0;
})();
