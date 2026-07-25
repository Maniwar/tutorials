/* ═══════════════════════════════════════════════════════════════════════════
   THE SAME FACT, EVERY PLACE IT IS PRINTED.

   contradiction-sweep.js checks one panel against its own arithmetic. This one
   checks the SURFACES against EACH OTHER: the Plan-truth bars, the Plan vs
   actual roll-up cards, the spend curve's footer, the earned-value figures and
   the health check all restate the same handful of numbers, and the defect that
   matters is any two of them disagreeing on one screen.

   It runs against fixtures/crm-rollout.json, a real export with the shape the
   sample has never had: a baseline taken after the work started, so activities
   finish before their own baseline windows ever open.
   ═══════════════════════════════════════════════════════════════════════════ */
const { requirePlaywright, chromePath, APP, FIXTURE } = require('./_harness');
const { chromium } = requirePlaywright();
const fs = require('fs');
const DATA = FIXTURE();

(async () => {
  const b = await chromium.launch({headless:true,args:['--no-sandbox'],executablePath: chromePath()});
  const page = await b.newPage({viewport:{width:1440,height:1200}});
  page.on('dialog', d => d.accept());
  const errs=[]; page.on('pageerror', e=>errs.push(e.message));
  await page.goto(APP,{waitUntil:'load'});
  await page.evaluate(data => { hydrate(data); calculate(); }, DATA);
  await page.waitForTimeout(700);

  const R = await page.evaluate(() => {
    const bad = [];
    const say = (a, b2) => bad.push(a + ' :: ' + b2);
    const hb = hasBaseline();
    const today = stripTime(new Date()).getTime();
    const near = (x, y, tol) => Math.abs(x - y) <= (tol == null ? 2 : tol);
    const num = s => { const m = String(s).replace(/,/g, '').match(/-?[\d.]+/); return m ? +m[0] : NaN; };

    // ── the single source of truth, computed once, from the stored fields ──
    const AC = leafTasks().reduce((s, t) => s + actualCostOf(t), 0);
    const PV = accrualAt(pvSpread(hb, leafTasks()).segs, today);
    const EV = earnedValue();
    const BAC = budgetAtCompletion(hb);
    const bv = budgetVerdict(AC, PV, EV, BAC);
    const truth = { AC, PV, EV, BAC, gap: bv.gap, cv: bv.cv, tone: bv.tone };

    // ── 1. Plan-truth budget bar ───────────────────────────────────────────
    const pt = planTruthData();
    const bud = pt.rows.find(r => r.key === 'budget');
    const sch = pt.rows.find(r => r.key === 'sched');
    if (bud.delta && !/on the plan/.test(bud.delta) && !near(num(bud.delta), Math.abs(bv.gap), 2))
      say('Plan-truth budget bar', 'prints ' + bud.delta + ' against a recomputed gap of ' + money(bv.gap));
    if (bud.actTxt && !near(num(bud.actTxt), AC, 2))
      say('Plan-truth budget bar', 'says ' + bud.actTxt + ' booked; the tasks sum to ' + money(AC));
    if (bud.planTxt && !near(num(bud.planTxt), PV, 2))
      say('Plan-truth budget bar', 'says ' + bud.planTxt + ' due by today; PV recomputes to ' + money(PV));

    // ── 2. the SPEND CURVE footer restates the bar ─────────────────────────
    let curveSaid = null;
    try {
      const c = pt.curve;
      if (c) {
        curveSaid = { pv: c.pv, ac: c.ac };
        if (!near(c.ac, AC, 2)) say('Spend curve', 'says ' + money(c.ac) + ' booked; tasks sum to ' + money(AC));
        if (!near(c.pv, PV, 2)) say('Spend curve', 'says ' + money(c.pv) + ' due by today; PV recomputes to ' + money(PV));
        if (!near(c.ac - c.pv, bv.gap, 2))
          say('Spend curve', 'its own gap ' + money(c.ac - c.pv) + ' disagrees with the bar\'s ' + money(bv.gap));
      }
    } catch (e) { say('Spend curve', 'threw: ' + e.message); }

    // ── 3. PLAN VS ACTUAL roll-up cards must not contradict those bars ─────
    switchTab('baseline'); renderBaseline();
    const cardsHost = document.getElementById('baselineContainer');
    const cards = [...cardsHost.querySelectorAll('.bl-cards .stat-card')].map(el => ({
      label: (el.querySelector('.label') || {}).textContent || '',
      text: el.textContent.replace(/\s+/g, ' ').trim(),
      deltaColour: (() => { const d = [...el.children].find(x => /font-weight:700/.test(x.getAttribute('style') || ''));
        return d ? getComputedStyle(d).color : null; })()
    }));
    const budCard = cards.find(c => /Budget/.test(c.label));
    const schCard = cards.find(c => /Schedule/.test(c.label));
    const scpCard = cards.find(c => /Scope/.test(c.label));
    if (budCard) {
      // it must quote the SAME gap as the bar, in the same direction
      const m = budCard.text.match(/([\d,]+(?:\.\d+)?)\s+(above|below) the plan to date/);
      if (m) {
        const v = num(m[1]) * (m[2] === 'above' ? 1 : -1);
        if (!near(v, bv.gap, 2))
          say('Plan vs actual · Budget card', 'says ' + m[0] + '; the Plan-truth bar says ' + money(bv.gap));
      } else if (Math.abs(bv.gap) > Math.max(1, BAC * 0.005)) {
        say('Plan vs actual · Budget card', 'states no gap while the bar states ' + money(bv.gap));
      }
      // and it must not colour the project red when the bar does not
      const red = /rgb\(\s*2[0-2]\d\s*,\s*[0-5]?\d\s*,/.test(budCard.deltaColour || '');
      if (red && bv.tone !== 'bad')
        say('Plan vs actual · Budget card', 'renders red while budgetVerdict says "' + bv.tone + '"');
    }
    /* A CARD'S PAIR AND ITS DELTA MUST SHARE A REFERENCE. This is the check
       that was missing when the Budget card read "$54,293 → $27,900" above
       "$26,760 above the plan to date": every figure was individually correct
       and the card as a whole said two unrelated things. The rule is arithmetic
       — whatever the delta claims must be recoverable from the pair above it. */
    if (budCard) {
      const pair = budCard.text.match(/([\d,]+(?:\.\d+)?)[^\d]*?→\s*\$?\s*([\d,]+(?:\.\d+)?)/);
      const dm = budCard.text.match(/([\d,]+(?:\.\d+)?)\s+(above|below) the plan to date/);
      if (pair && dm) {
        const left = num(pair[1]), right = num(pair[2]);
        const delta = num(dm[1]) * (dm[2] === 'above' ? 1 : -1);
        if (!near(right - left, delta, 2))
          say('Plan vs actual · Budget card', 'reads "' + money(left) + ' → ' + money(right)
            + '" but its delta says ' + dm[0] + ' — the pair and the delta use different references');
      }
    }
    if (schCard && sch.delta) {
      // both describe the committed finish moving; they may word it differently
      // but must not disagree on WHETHER it moved
      const cardMoved = /late vs baseline|early vs baseline/.test(schCard.text);
      const barMoved = !/end date held|on the baseline/.test(sch.delta);
      if (cardMoved !== barMoved)
        say('Plan vs actual · Schedule card', 'says "' + schCard.text.slice(-40)
          + '" while the Plan-truth bar says "' + sch.delta + '"');
    }
    if (schCard && sch.delta) {
      // and when both name a COUNT of displaced activities it must be the same one
      const cardN = (schCard.text.match(/(\d+)\s+activit/) || [])[1];
      const barN = (String(sch.delta).match(/(\d+)\s+off/) || [])[1];
      if (cardN && barN && cardN !== barN)
        say('Plan vs actual · Schedule card', 'counts ' + cardN + ' activities moved; the bar counts ' + barN);
      if (!cardN && barN)
        say('Plan vs actual · Schedule card', 'is silent while the bar reports ' + barN + ' activities off their own dates');
    }
    if (scpCard) {
      const scp = pt.rows.find(r => r.key === 'scope');
      const cardUnchanged = /scope unchanged/.test(scpCard.text);
      const barUnchanged = /unchanged/.test(scp.delta || '') || Math.abs(scp.pct || 0) < 0.01;
      if (cardUnchanged !== barUnchanged)
        say('Plan vs actual · Scope card', 'says "' + (cardUnchanged ? 'unchanged' : 'changed')
          + '" while the Plan-truth bar says "' + scp.delta + '"');
    }

    // ── 4. per-activity: the table's cost delta vs the drill-in's overrun ──
    (bud.drivers || []).forEach(d => {
      const t = tasks.find(x => x.id === d.id);
      const planCost = hb && t.baseCost != null ? t.baseCost : taskCost(t);
      const act = actualCostOf(t);
      // for FINISHED work the table's signed delta is exactly the drill-in's overrun
      if ((t.percentComplete || 0) >= 100 && !near(act - planCost, d.over, 1))
        say(t.name, 'Plan vs actual shows ' + money(act - planCost) + ' over/under; the drill-in says '
          + money(d.over));
    });

    // ── 5. the health check must not contradict the panel ──────────────────
    const lint = lintPlan();
    const overFindings = lint.filter(f => /Cost/.test(f.area) && /over/i.test(f.finding));
    if (overFindings.length && bv.tone === 'good')
      say('Health check', 'reports a cost overrun while the budget verdict is "good"');

    // ── 6. every money figure the panel prints must parse ──────────────────
    switchTab('analytics'); renderAnalytics();
    const stray = [...document.querySelectorAll('#view-analytics *')]
      .filter(el => el.children.length === 0 && /\$\s*NaN|\bNaN\b|Infinity|undefined/.test(el.textContent || ''))
      .map(el => (el.textContent || '').trim().slice(0, 60));
    stray.forEach(s => say('Analytics tab', 'prints a broken figure: "' + s + '"'));

    return { contradictions: bad, truth: {
        booked: Math.round(AC), dueByToday: Math.round(PV), earned: Math.round(EV),
        envelope: Math.round(BAC), gap: Math.round(bv.gap), cv: Math.round(bv.cv), tone: bv.tone },
      curveSaid, cards: cards.map(c => ({ label: c.label.trim(), text: c.text.slice(0, 90) })),
      barBudget: bud.delta, barSchedule: sch.delta };
  });

  R.pageErrors = errs.slice(0, 8);
  console.log(JSON.stringify(R, null, 1));
  await b.close();
})();
