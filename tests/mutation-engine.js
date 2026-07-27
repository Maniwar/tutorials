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
           node tests/mutation-engine.js --quick   (test plan only, no sweeps)
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');

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
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ptr-mut-'));
const run = (script, appFile) => {
  try {
    execFileSync(process.execPath, [path.join(__dirname, script)],
      { cwd: ROOT, env: Object.assign({}, process.env, { APP_FILE: appFile }),
        stdio: 'pipe', timeout: 180000 });
    return null;                       // exit 0 — nothing noticed
  } catch (e) {
    const out = String(e.stdout || '') + String(e.stderr || '');
    return out.trim() || 'exited non-zero';
  }
};

const CHECKS = QUICK ? ['run-test-plan.js']
  : ['run-test-plan.js', 'golden-reference.js', 'contradiction-sweep.js',
     'schedule-sweep.js', 'drawn-surfaces-sweep.js', 'pricing-sweep.js',
     'resourcing-sweep.js', 'persistence-sweep.js', 'cross-surface-sweep.js', 'task-editor-sweep.js',
     'client-facing-sweep.js'];

let survived = 0;
MUTANTS.forEach((m, i) => {
  const n = SRC.split(m.find).length - 1;
  if (n !== 1) {
    console.log('SKIPPED  ' + m.what + '\n         its anchor matches ' + n
      + ' times in the source, so this mutant cannot be trusted to have applied');
    survived++;
    return;
  }
  const file = path.join(tmp, 'mutant-' + i + '.html');
  fs.writeFileSync(file, SRC.replace(m.find, m.with));

  const caught = [];
  for (const c of CHECKS) {
    const out = run(c, file);
    if (out) { caught.push(c); break; }   // one red check is enough
  }
  if (caught.length) console.log('CAUGHT   ' + m.what + '\n         → ' + caught[0]);
  else { console.log('SURVIVED ' + m.what
    + '\n         nothing in the suite noticed. This identity is unguarded.'); survived++; }
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(survived
  ? '\n' + survived + ' of ' + MUTANTS.length + ' mutants survived — the suite has holes there.'
  : '\nall ' + MUTANTS.length + ' mutants were caught.');
process.exitCode = survived ? 1 : 0;
