/* ═══════════════════════════════════════════════════════════════════════════
   NO STATIC LINE MAY EXPLAIN A DYNAMIC THING.

   The panels in this product do not just show numbers, they narrate them:
   "this is not a scope change, all 22 changed rows are test cases", "the plan
   catches up on Aug 14, 2026", "$14,200 of the gap is timing, $1,100 is
   overrun". Prose like that is worth far more than a bare figure — and it is
   also the easiest thing in the codebase to fake. A sentence typed once, from
   one run of one plan, reads exactly like a sentence that was computed. It is
   correct on the plan it was written against and quietly wrong on every other
   plan forever, and nothing else in this suite would notice: the numbers it
   describes are still computed correctly, the DOM still renders, no assertion
   is violated.

   The property that separates the two is simple and mechanical. Run two
   materially different plans through the same screens. Every claim that states
   money or a date must come out DIFFERENT, because the plans are different. A
   claim that survives both, character for character, is not reading the plan.

   Two carve-outs, both narrow and both necessary or the check reports noise:

     TODAY IS THE SAME DAY IN BOTH RUNS. A caption that says "as of Jul 30,
     2026" is honestly dynamic and legitimately identical. Today's date is
     stripped from the tokens before a line is judged; if nothing else numeric
     is left, the line was never a claim about the plan.

     A LEGEND IS NOT A CLAIM. "$/hr", "0-5 days" and similar carry digits
     without asserting anything about this engagement, so a claim needs a money
     figure of three digits or more, or a real calendar date.

   The two plans are the two committed fixtures, and the second is then pushed
   further — every estimate tripled, a fixed cost added to every activity, the
   baseline re-cut, half the work marked complete and money booked against it —
   so that the schedule, the budget, the earned value and the variance all
   differ, not merely the activity names.
   ═══════════════════════════════════════════════════════════════════════════ */
const { requirePlaywright, chromePath, APP, FIXTURE } = require('./_harness');
const { chromium } = requirePlaywright();
const fs = require('fs'), path = require('path');
const FIELD = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '..', 'fixtures', 'field-export.json'), 'utf8'));

// the surfaces that narrate. Tasks and WBS are grids, not prose, and are covered
// by drawn-surfaces-sweep; these four are where the sentences live.
const TABS = ['analytics', 'baseline', 'resources', 'gantt'];

(async () => {
  const b = await chromium.launch({headless:true,args:['--no-sandbox'],executablePath: chromePath()});
  const page = await b.newPage({viewport:{width:1500,height:1300}});
  page.on('dialog', d => d.accept());
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(APP, {waitUntil:'load'});

  const harvest = async (setup, arg) => {
    await page.evaluate(setup, arg);
    await page.waitForTimeout(500);
    return page.evaluate(tabs => {
      const CLAIM = /\$[\d,]{3,}|\d{4}-\d\d-\d\d|[A-Z][a-z]{2} \d{1,2}, \d{4}/;
      const TOKEN = /\$[\d,]{3,}(?:\.\d+)?|\d{4}-\d\d-\d\d|[A-Z][a-z]{2} \d{1,2}, \d{4}/g;
      /* today, in both shapes the product prints it. fmtNice uses the browser
         locale's short month, so ask the browser rather than assuming. */
      const now = new Date();
      const iso = now.toISOString().slice(0, 10);
      const nice = now.toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' });
      const claims = [];
      tabs.forEach(tab => {
        try { switchTab(tab); } catch (e) { claims.push(tab + ' :: THREW ' + e.message); return; }
        // roll everything open — a collapsed <details> hides the sentences
        document.querySelectorAll('#view-' + tab + ' details').forEach(d => d.open = true);
        const root = document.getElementById('view-' + tab);
        if (!root) return;
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
          acceptNode: n => /^(script|style)$/i.test((n.parentElement || {}).tagName || '')
            ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
        let n;
        while ((n = w.nextNode())) {
          const v = (n.nodeValue || '').replace(/\s+/g, ' ').trim();
          if (v.length < 13 || !CLAIM.test(v)) continue;
          const toks = (v.match(TOKEN) || []).filter(t => t !== iso && t !== nice);
          if (!toks.length) continue;          // it only ever said "today"
          claims.push(tab + ' :: ' + v);
        }
      });
      return claims;
    }, TABS);
  };

  const A = await harvest(d => { hydrate(d); calculate(); }, FIXTURE());
  const B = await harvest(d => {
    hydrate(d); calculate();
    leafTasks().forEach(t => { if (!t.isSummary) { t.o *= 3; t.m *= 3; t.p *= 3;
      t.fixedCost = (t.fixedCost || 0) + 500; } });
    recompute(); setBaseline();
    leafTasks().forEach(t => { if (!t.isSummary) { t.percentComplete = 50;
      t.autoActualCost = false; t.actualCost = 999; } });
    calculate();
  }, FIELD);

  const bad = [];
  const setB = new Set(B);
  const identical = A.filter(x => setB.has(x));

  /* A run that harvested nothing proves nothing, and would go green forever the
     day a selector changes. This is the check checking itself. */
  if (A.length < 5 || B.length < 5)
    bad.push('the sweep harvested ' + A.length + ' claims from plan A and ' + B.length
      + ' from plan B — under five means the panels did not render or the tab ids moved, and every '
      + 'comparison below is vacuous');

  identical.forEach(c => bad.push('this line is character-identical on two completely different plans, '
    + 'so it is not reading either of them: "' + c.slice(0, 150) + '"'));

  console.log(JSON.stringify({
    claimsOnPlanA: A.length, claimsOnPlanB: B.length,
    identicalAcrossBothPlans: identical.length,
    contradictions: bad, pageErrors: errs.slice(0, 6)
  }, null, 1));
  await b.close();
  if (bad.length || errs.length) process.exitCode = 1;
})();
