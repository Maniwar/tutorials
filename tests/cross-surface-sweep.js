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

  /* money() is LOCAL to planTruthData(); the global formatter is fmtMoney().
     Eleven calls here used the wrong one, and every single one sat inside the
     branch that REPORTS a finding — so this sweep threw at the exact moment it
     had something to say, and never once on a healthy build. Combined with the
     missing exit code below, a real contradiction produced a stack trace, an exit
     status of 0, and a tick in the commit gate. */
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
      say('Plan-truth budget bar', 'prints ' + bud.delta + ' against a recomputed gap of ' + fmtMoney(bv.gap));
    if (bud.actTxt && !near(num(bud.actTxt), AC, 2))
      say('Plan-truth budget bar', 'says ' + bud.actTxt + ' booked; the tasks sum to ' + fmtMoney(AC));
    if (bud.planTxt && !near(num(bud.planTxt), PV, 2))
      say('Plan-truth budget bar', 'says ' + bud.planTxt + ' due by today; PV recomputes to ' + fmtMoney(PV));

    // ── 2. the SPEND CURVE footer restates the bar ─────────────────────────
    let curveSaid = null;
    try {
      const c = pt.curve;
      if (c) {
        curveSaid = { pv: c.pv, ac: c.ac };
        if (!near(c.ac, AC, 2)) say('Spend curve', 'says ' + fmtMoney(c.ac) + ' booked; tasks sum to ' + fmtMoney(AC));
        if (!near(c.pv, PV, 2)) say('Spend curve', 'says ' + fmtMoney(c.pv) + ' due by today; PV recomputes to ' + fmtMoney(PV));
        if (!near(c.ac - c.pv, bv.gap, 2))
          say('Spend curve', 'its own gap ' + fmtMoney(c.ac - c.pv) + ' disagrees with the bar\'s ' + fmtMoney(bv.gap));
      }
    } catch (e) { say('Spend curve', 'threw: ' + e.message); }

    // ── 3. PLAN VS ACTUAL roll-up cards must not contradict those bars ─────
    switchTab('baseline'); renderBaseline();
    const cardsHost = document.getElementById('baselineContainer');
    const cards = [...cardsHost.querySelectorAll('.bl-cards .stat-card')].map(el => ({
      label: (el.querySelector('.label') || {}).textContent || '',
      text: el.textContent.replace(/\s+/g, ' ').trim(),
      /* THE DELTA, not the pair. Both are font-weight:700, and `.find` returns
         the FIRST — which is the "$14,779 due by today → $27,900" line, painted
         the ordinary text colour on every plan there has ever been. So the
         red-when-the-verdict-is-not-bad check below read an element that cannot
         go red, and could not fail: a build that painted every Budget card
         critical passed it. The delta is the one carrying dColor(), and it is
         identified by what it SAYS rather than by its position, because the
         position is exactly what went wrong. */
      deltaColour: (() => {
        const d = [...el.children].find(x => /(above|below|on) the plan to date|vs baseline|scope unchanged/i
          .test(x.textContent || ''));
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
          say('Plan vs actual · Budget card', 'says ' + m[0] + '; the Plan-truth bar says ' + fmtMoney(bv.gap));
      } else if (Math.abs(bv.gap) > Math.max(1, BAC * 0.005)) {
        say('Plan vs actual · Budget card', 'states no gap while the bar states ' + fmtMoney(bv.gap));
      }
      // and it must not colour the project red when the bar does not
      if (budCard.deltaColour == null)
        say('Plan vs actual · Budget card', 'its delta line could not be located, so the colour check below '
          + 'read nothing and proved nothing — that is the state it was in when it was reading the value '
          + 'pair instead');
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
          say('Plan vs actual · Budget card', 'reads "' + fmtMoney(left) + ' → ' + fmtMoney(right)
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
        say(t.name, 'Plan vs actual shows ' + fmtMoney(act - planCost) + ' over/under; the drill-in says '
          + fmtMoney(d.over));
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

  /* ═══ THE ARTEFACT CHAIN ══════════════════════════════════════════════════
     The dictionary could draw the SCHEDULE chain and nothing else, so a plan
     could be perfectly linked and still have an activity consuming something
     nobody makes. This checks the map that answers the other question, and it
     checks the two ways the map itself can lie: a classifier that waves through
     "Analysis", and inputs that are RETYPED rather than derived — a copy drifts
     from the schedule the moment somebody renames a deliverable. */
  const io = await page.evaluate(() => {
    const out = {};
    const leaf = leafTasks().filter(t => !t.isSummary && !t.milestone);
    const t0 = leaf[0], keep = t0.deliverable;
    const cases = [['', 'missing'], ['Analysis', 'vague'], ['Documentation', 'vague'],
      ['Findings', 'vague'], ['TBD', 'vague'], [t0.name, 'vague'],
      ['Signed engagement charter', 'ok'],
      ['Ranked friction-theme table with ticket counts', 'ok']];
    out.wrong = cases.filter(([v, want]) => { t0.deliverable = v; return deliverableFit(t0).level !== want; })
      .map(([v, want]) => JSON.stringify(v) + ' wanted ' + want + ' got ' + (t0.deliverable = v, deliverableFit(t0).level));
    t0.deliverable = keep;
    const ms = tasks.find(t => t.milestone);
    out.milestoneFlagged = ms ? deliverableFit(ms).level !== 'na' : null;

    // inputs must be DERIVED from the predecessor's live deliverable
    const asTask = pd => tasks.find(x => Number(x.id) === Number(pd.id));
    const withPred = leaf.find(t => effectivePreds(t).map(asTask).some(p => p && !p.milestone
      && String(p.deliverable || '').trim()));
    out.hadPredCase = !!withPred;
    if (withPred) {
      const up = taskInputs(withPred).filter(i => i.kind === 'upstream');
      out.upstreamEmpty = !up.length || up.some(i => !i.text || !i.from);
      const src = up[0].from, k2 = src.deliverable;
      src.deliverable = 'ZZ MARKER ARTEFACT';
      out.notDerived = !taskInputs(withPred).some(i => i.text === 'ZZ MARKER ARTEFACT');
      src.deliverable = k2;
    }
    // findings never point at a phase or a milestone — those cannot be fixed
    const f = ioFindings();
    out.unfixable = f.filter(x => { const t = tasks.find(y => y.id === x.id); return !t || t.isSummary || t.milestone; }).length;
    out.kinds = [...new Set(f.map(x => x.kind))];
    // and the map is actually drawn
    switchTab('wbs'); renderWBS();
    const html = document.getElementById('wbsContainer').innerHTML;
    out.noInputsColumn = !/>Inputs</.test(html);
    out.bannerMissing = f.length > 0 && !/gap.? in the input\/output chain/.test(html);
    // the stated field survives a save/load
    const t2 = leaf[1]; t2.inputs = 'ZZ stated input';
    hydrate(JSON.parse(JSON.stringify(serialize())));
    out.roundTripLost = (tasks.find(x => x.id === t2.id) || {}).inputs !== 'ZZ stated input';
    return out;
  });
  R.ioMap = io;
  if (io.wrong && io.wrong.length)
    R.contradictions.push('IO map :: the deliverable classifier is wrong on ' + io.wrong.length
      + ' case(s): ' + io.wrong.join('; '));
  if (io.milestoneFlagged)
    R.contradictions.push('IO map :: a milestone is flagged for having no deliverable — a milestone is a date, '
      + 'and a finding nobody can fix buries the ones they can');
  if (!io.hadPredCase)
    R.contradictions.push('IO map :: the fixture has no activity waiting on a named deliverable, so the '
      + 'derived-input checks below read nothing and would pass on any build');
  if (io.upstreamEmpty)
    R.contradictions.push('IO map :: an activity waiting on a named deliverable shows no upstream input — '
      + 'the predecessor link is not being resolved to its task');
  if (io.notDerived)
    R.contradictions.push('IO map :: renaming an upstream deliverable did not change the downstream input, '
      + 'so the map is a COPY of the schedule rather than a view of it, and drifts the moment anything moves');
  if (io.unfixable)
    R.contradictions.push('IO map :: ' + io.unfixable + ' finding(s) point at a phase or milestone');
  if (io.noInputsColumn)
    R.contradictions.push('IO map :: the WBS dictionary draws no Inputs column, so the map exists only in memory');
  if (io.bannerMissing)
    R.contradictions.push('IO map :: gaps were found and the dictionary shows no banner naming them');
  if (io.roundTripLost)
    R.contradictions.push('IO map :: a stated input did not survive a save/load round trip');

  R.pageErrors = errs.slice(0, 8);
  console.log(JSON.stringify(R, null, 1));
  await b.close();
  /* FAIL when something was found. This file printed its contradictions and
     exited 0, which made it decorative: the commit gate and the mutation harness
     both judge by exit code, so a red finding here read as a tick. Seven of the
     seventeen sweeps were in that state, and it only surfaced when two deliberate
     defects were planted, reported by name in this output, and still reported as
     SURVIVED by mutation-engine. A check that cannot fail is worse than no check,
     because it is counted. */
  if ((R.contradictions || []).length || errs.length) process.exitCode = 1;
})();
