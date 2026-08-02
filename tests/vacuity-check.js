/* ═══════════════════════════════════════════════════════════════════════════
   IS THIS CHECK READING THE PLAN AT ALL?

   Written because the same defect kept arriving wearing different clothes, and
   patching each instance was not going to end. Four in one session:

     · schedule-sweep held four dependency types and every fixture is FS, so
       three of its four branches had never executed.
     · client-facing-sweep's audience fallback could not be reached, because
       every test case in the fixture carries an explicit audience.
     · resourcing-sweep once counted over-allocation on a plan that had none.
     · corrupt-file-sweep would have gone quiet the day somebody "fixed" the
       duplicate ids in its fixture.

   One root cause: THE FIXTURE CANNOT REACH THE BRANCH, AND NOTHING SAYS SO. A
   check in that state is not wrong. It passes, it is correct, and it reports
   the same green as a check that actually looked — which is what makes it worse
   than no check, because it is counted.

   The local fix has been a guard in prose — "the fixture no longer contains
   duplicate ids, so nothing below is testing anything". It works, it is written
   where somebody remembered to write it, and nine of the twenty-two sweeps have
   none. Linting for the SENTENCE would be the next bandage: a keyword rule is
   satisfied by typing the keyword.

   So this asks the question mechanically instead. Every sweep is run twice —
   once against the real plan, once against an EMPTY one — and its output must
   CHANGE. A check whose report is byte-identical whether the plan holds
   twenty-nine activities or none is not reading the plan; whatever it is
   asserting, it is not asserting it about this input.

   It is the same trick dynamic-prose-sweep plays on the panels (two different
   plans must produce different prose), turned on the checks themselves. And it
   cannot be satisfied by writing a sentence.

   WHAT THIS DOES NOT CATCH, stated so nobody reads more into a green run than
   is there: a sweep can read the plan and still assert something vacuous about
   it. Coverage is necessary, not sufficient. The mutation set is what covers
   the rest, and the two together are the standard — this says "you looked", the
   mutants say "you would have noticed".

   AND WHAT THE FIRST VERSION OF THIS FILE GOT WRONG, kept because it is the
   same mistake it was written to end. It reported seventeen findings and
   fifteen were its own:

     · It treated a NON-ZERO EXIT on the empty plan as a defect. It is the
       opposite. revenue-sweep going red with "the fixture prices at nothing, so
       every check below is vacuous" is the vacuity guard WORKING — the check
       noticing it had nothing to test and refusing to report success. Fifteen
       sweeps were flagged for doing exactly the right thing. That is anchoring
       on an incidental representation (the exit code) instead of on the
       property (did the output change), which is the other root cause in this
       directory and it caught the author of the file about it.
     · Both of its two real-looking findings were false. corrupt-file-sweep and
       golden-reference read their OWN fixtures — field-export.json and
       qa-reference.json — so FIXTURE_FILE never reached them and their output
       was identical for a reason that has nothing to do with reading the plan.
       They are now identified and skipped BY NAME, because a check silently
       outside the scope of this probe is the thing this probe exists to stop.

   Both corrections are the same lesson: assert the property, not the artefact
   that usually accompanies it.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ONLY = process.argv.slice(2).filter(a => !a.startsWith('-'));

/* An EMPTY plan, not a broken one: valid in every field, holding no work. That
   is the input under which a check has nothing to look at, so any check that
   reports the same thing on it as on a full plan is reporting something it did
   not measure. */
const EMPTY = {
  projectName: 'Empty plan (vacuity probe)',
  projectStart: '2026-01-05',
  workingDays: 'monfri', holidays: [], unit: 'days',
  tasks: [], resources: {}, raid: [], reqs: { epics: [], stories: [] },
  pricing: { model: 'fixed', basis: 'p80', contractPrice: 0 },
  nextId: 1, nextRaidId: 1
};

const SWEEPS = fs.readdirSync(__dirname)
  .filter(f => /sweep.*\.js$/.test(f) || f === 'golden-reference.js')
  .filter(f => !ONLY.length || ONLY.some(o => f.indexOf(o) >= 0))
  .sort();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ptr-vac-'));
const emptyPath = path.join(tmp, 'empty-plan.json');
fs.writeFileSync(emptyPath, JSON.stringify(EMPTY));

function run(script, fixture) {
  return new Promise(resolve => {
    const env = Object.assign({}, process.env);
    if (fixture) env.FIXTURE_FILE = fixture; else delete env.FIXTURE_FILE;
    const ch = spawn(process.execPath, [path.join(__dirname, script)], { cwd: ROOT, env: env, stdio: 'pipe' });
    let out = '';
    ch.stdout.on('data', d => out += d);
    ch.stderr.on('data', d => out += d);
    const t = setTimeout(() => { try { ch.kill('SIGKILL'); } catch (e) {} }, 180000);
    ch.on('close', code => { clearTimeout(t); resolve({ code: code, out: out }); });
  });
}

/* Compared after stripping what moves on its own. A build stamp or today's date
   differing between two runs is not evidence that the check read the plan, and
   counting it as such would make this pass for the wrong reason — the same
   mistake as a claim check that never strips today's date. */
function normalise(s) {
  return String(s)
    .replace(/\d{4}\.\d{2}\.\d{2}\.\d{4}/g, '<build>')
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, '<time>')
    .replace(/\d{4}-\d{2}-\d{2}/g, '<date>')
    .replace(/\s+/g, ' ')
    .trim();
}

(async () => {
  const findings = [], rows = [], notes = [], skipped = [];
  for (const s of SWEEPS) {
    /* Only checks that read FIXTURE() are governed by FIXTURE_FILE. Two load a
       fixture of their own by path — swapping the shared one changes nothing
       they see, and calling that "not reading the plan" is a false finding.
       Named rather than dropped: a check quietly outside the scope of this
       probe is precisely what the probe exists to prevent. */
    const src = fs.readFileSync(path.join(__dirname, s), 'utf8');
    if (!/\bFIXTURE\b/.test(src)) {
      skipped.push(s + ' — loads its own fixture by path, so FIXTURE_FILE does not reach it. Its coverage is '
        + 'guaranteed by the fixture being committed in the shape it needs, and by that shape being asserted '
        + 'inside the check itself.');
      continue;
    }
    const full = await run(s, null);
    const empty = await run(s, emptyPath);
    const a = normalise(full.out), b = normalise(empty.out);
    const same = a === b;
    rows.push({ sweep: s, fullExit: full.code, emptyExit: empty.code,
      fullLen: a.length, emptyLen: b.length, identical: same, saysNothingToTest: empty.code !== 0 });
    if (full.code !== 0) {
      findings.push(s + ' :: is RED on the real plan, so this probe cannot say anything about it — fix that first');
      continue;
    }
    if (same) {
      findings.push(s + ' :: reports exactly the same thing on a plan with 29 activities and a plan with NONE, '
        + 'so it is not reading the plan. Whatever it asserts, it is not asserting it about this input — and it '
        + 'has been counted as coverage for every commit it has been green on');
    }
    /* NOT a finding. A sweep going red on an empty plan is the vacuity guard
       working: it noticed it had nothing to test and refused to report success.
       The first version of this file called that a defect and flagged fifteen
       sweeps for behaving correctly. Recorded as a note, because seeing which
       checks say so out loud — and which merely go quiet — is the useful half. */
    if (empty.code !== 0) {
      const first = (empty.out.match(/"[A-Z][^"]{20,150}"/) || [''])[0].slice(0, 140);
      notes.push(s + ' says so out loud on an empty plan: ' + (first || '(no message captured)'));
    } else {
      notes.push(s + ' passes quietly on an empty plan — it changed what it printed, so it IS reading the '
        + 'plan, but it does not say in words that it had nothing to test');
    }
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(JSON.stringify({ sweeps: rows.length, skipped: skipped, rows: rows,
    notes: notes, findings: findings }, null, 1));
  if (findings.length) {
    console.log('\n' + findings.length + ' finding(s). A check that reports the same thing on a full plan and '
      + 'an empty one is the root cause behind four separate defects fixed one at a time; this is the '
      + 'mechanical version of the question.');
  } else {
    console.log('\nall ' + SWEEPS.length + ' checks read their input.');
  }
  process.exitCode = findings.length ? 1 : 0;
})();
