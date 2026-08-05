/* ═══════════════════════════════════════════════════════════════════════════
   WHICH ASSERTIONS HAVE NEVER FIRED?

   The mutation engine proves that a CHECK FILE can go red. That was the right
   question when the worry was a whole sweep gone vacuous, and it is far too
   coarse now: baseline-sweep is fifteen hundred lines and catches most of the
   mutant set, so "baseline-sweep has been the catcher" says nothing whatever
   about the ninety-odd individual assertions inside it. An assertion nobody
   ever aimed a mutant at is an assertion with no evidence behind it, and this
   session produced five defects that lived in exactly that gap:

     · a negative case built on a subject an earlier block had already touched,
       so it reported the product for answering correctly
     · an assertion on a derived list that also filtered on the condition being
       tested, so the mutant's change was masked and the check stayed green
     · a filter on `te` immediately after a hydrate — a derived field, zero
       until the next calculate() — which selected nothing and passed
     · an assertion anchored to markup that was later redrawn
     · a mutant neutered by a refactor, surviving because there was nothing left
       to catch rather than because something was unguarded

   Each was found by the engine or by printing an intermediate count. None was
   found by reading. So the useful instrument is not another kind of probe: it
   is knowing WHICH SENTENCES have ever been the one that fired.

   ── HOW ──────────────────────────────────────────────────────────────────

   Every sweep reports findings as strings, and every one of those strings is a
   sentence somebody wrote. So the sentences are the identifiers. This reads
   two things:

     1. the assertion texts that EXIST — extracted from the string literals
        passed to say()/fail.push()/bad.push() in each check file
     2. the assertion texts that have FIRED — from tests/.mutation-journal.json,
        which the mutation engine now writes on every run, recording the output
        of each catching run instead of throwing it away

   Everything in (1) and not in (2) is an assertion carrying no evidence. That
   is not the same as a broken assertion, and this file is a PROBE precisely
   because the difference matters: plenty of these guard conditions no mutant
   expresses, and a gate that failed on them would just be turned off. It
   reports; a person decides which of them are worth a mutant.

   ── WHAT IT CANNOT SAY ───────────────────────────────────────────────────

   An assertion that HAS fired is proven only against the mutants that fired it
   — it can still be wrong in a direction nothing has tested. And matching is by
   text, so a check whose message is built entirely from computed values has no
   stable identity here and is reported as never-fired even when it is doing its
   job. Both are stated in the output rather than left for the reader to
   discover.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs'), path = require('path');

const DIR = path.resolve(__dirname, '..');
const JOURNAL = path.join(DIR, '.mutation-journal.json');

/* The literal PREFIX of an assertion message. Checks build their sentences by
   concatenating a literal with computed values — "the history states " + n +
   " rows" — so the first literal is the stable part and the numbers are not.
   Anything under 24 characters is dropped: too short to be an identity, and
   short fragments collide across files. */
function assertionsInFile(src) {
  const out = [];
  const re = /(?:say2?|fail\.push|bad\.push|say)\s*\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*(?:,\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"))?/g;
  let m;
  while ((m = re.exec(src))) {
    // say('Area', 'the sentence') — the SECOND literal is the assertion
    const lit = (m[3] != null || m[4] != null) ? (m[3] != null ? m[3] : m[4])
                                              : (m[1] != null ? m[1] : m[2]);
    if (!lit) continue;
    const t = lit.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, ' ').trim();
    if (t.length >= 24) out.push(t);
  }
  return [...new Set(out)];
}

/* Fired texts carry the area prefix and the computed tail; existing texts are
   the literal fragment. So the match is "does the fired text CONTAIN the
   literal", on a normalised form — one space, no case. */
const norm = s => String(s).replace(/\s+/g, ' ').trim().toLowerCase();

(function () {
  if (!fs.existsSync(JOURNAL)) {
    console.log(JSON.stringify({ note: 'no mutation journal yet — run `node tests/mutation-engine.js` '
      + 'once (a filtered run is enough to create it, a full run is needed to draw conclusions)' }, null, 1));
    return;
  }
  const j = JSON.parse(fs.readFileSync(JOURNAL, 'utf8'));
  const fired = [];
  (j.rows || []).forEach(r => (r.findings || []).forEach(f => fired.push(norm(f))));

  const files = fs.readdirSync(DIR)
    .filter(f => /sweep.*\.js$/.test(f) || f === 'golden-reference.js' || f === 'run-test-plan.js')
    .sort();

  const rows = [], never = [];
  files.forEach(f => {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8');
    const all = assertionsInFile(src);
    const hit = all.filter(a => { const n = norm(a); return fired.some(x => x.indexOf(n) >= 0); });
    rows.push({ check: f, assertions: all.length, everFired: hit.length,
                proven: all.length ? Math.round(100 * hit.length / all.length) + '%' : '—' });
    all.filter(a => !hit.includes(a)).forEach(a => never.push({ check: f, says: a.slice(0, 110) }));
  });

  const tot = rows.reduce((s, r) => s + r.assertions, 0);
  const hitTot = rows.reduce((s, r) => s + r.everFired, 0);
  console.log(JSON.stringify({
    journal: { at: j.at, full: !!j.full, ran: j.ran, of: j.of },
    caveat: j.full ? undefined
      : 'THIS JOURNAL IS FROM A FILTERED RUN, so almost everything below reads as unproven for want of '
        + 'mutants that were never attempted. Run the engine unfiltered before believing any of it.',
    totals: { assertions: tot, everFired: hitTot,
              proven: tot ? Math.round(100 * hitTot / tot) + '%' : '—' },
    byCheck: rows,
    neverFired: never
  }, null, 1));
  console.log('\n' + hitTot + ' of ' + tot + ' assertions have been the one that went red at least once.'
    + '\nThe rest carry no evidence — which is not the same as being wrong. Read the list and decide '
    + 'which\ndeserve a mutant; an assertion nobody can make fail is the thing this directory exists to '
    + 'find.');
})();
