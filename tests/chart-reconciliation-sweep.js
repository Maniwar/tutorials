/* ════════════════════════════════════════════════════════════════════════════
   DO THE CHARTS ADD UP.

   Every other sweep asks whether a figure is right. This one asks whether the
   pictures RECONCILE with the figures stated beside them — the question a
   reader actually has when a bar says +$25,620 and a list under it shows five
   numbers.

   Each check is an identity that must hold on any plan, not a value that
   happens to be true on one:

     the reconciliation rows, plus cost with no activity, are the budget bar
     booked minus plan-to-date IS that bar, computed independently
     the spend curve ends at the envelope it claims to phase
     the percentiles are ordered, and P80 really has 80% of runs at or below it
     the resource headline is the sum of its own per-person rows
     the billing rows add to the billing total, which is projectCost()

   Run against both fixtures, so an identity that holds only on a tidy plan is
   still caught by the messy one.
   ═══════════════════════════════════════════════════════════════════════════ */
const { requirePlaywright, chromePath, APP, FIXTURE } = require('./_harness');
const { chromium } = requirePlaywright();
const fs = require('fs'), path = require('path');
const CRM = FIXTURE();
const QA = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '..', 'fixtures', 'qa-reference.json'), 'utf8'));
/* A real export. Neither of the other two fixtures has a single activity added
   after its baseline, so the scope-verdict check below never ran on them — it sat
   there green and vacuous. This one carries twenty-two: twelve test cases the
   generator created and ten it re-estimated, against a feature set that never
   moved, which is exactly the shape the verdict exists to name. */
const FIELD = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '..', 'fixtures', 'field-export.json'), 'utf8'));

(async () => {
  const b = await chromium.launch({headless:true,args:['--no-sandbox'],executablePath: chromePath()});
  const page = await b.newPage({viewport:{width:1440,height:1200}});
  page.on('dialog', d => d.accept());
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(APP, {waitUntil:'load'});

  const sweep = async (label, data) => {
    await page.evaluate(d => { hydrate(d); calculate(); }, data);
    await page.waitForTimeout(600);
    /* The panel has to be DRAWN for the geometry checks below. Every other check
       in this file works from planTruthData(), which is the right level for an
       arithmetic identity and blind to what is painted — a mutant that stacked
       the budget segments so the visible bar ended past the figure in the badge
       survived this whole suite for exactly that reason. */
    await page.evaluate(() => { switchTab('analytics'); renderAnalytics(); });
    await page.waitForTimeout(500);
    return page.evaluate(lbl => {
      const bad = [];
      const say = (w, x) => bad.push(lbl + ' \u00b7 ' + w + ' :: ' + x);
      const note = {};
  
  
  const D=planTruthData(), bud=D.rows.find(x=>x.key==='budget');

  // 1. reconciliation table vs the bar
  const R=bud.recon;
  note.reconRows=R.rows.length;
  note.barGap=Math.round(R.barGap);
  /* residual is DEFINED as barGap − sum, so "rows + residual = bar" is true by
     construction and can never fail — it was a check that could not fail, in a
     sweep written to catch exactly that. Found by dropping a row from the table
     and watching this stay green: the residual silently absorbed it.

     What must actually hold is COVERAGE — every activity carrying a gap appears
     in the table — and that the residual is genuinely unattributable money
     rather than a row that went missing. */
  if (Math.abs(R.sum + R.residual - R.barGap) > 1)
    say('Reconciliation', 'rows+residual ' + Math.round(R.sum + R.residual) + ' vs bar ' + Math.round(R.barGap));
  {
    const shown = new Set(R.rows.map(x => x.id));
    const evOf2 = t => plannedCostOf(t, hasBaseline()) * ((t.percentComplete || 0) / 100);
    const missing = leafTasks().filter(t => {
      if (shown.has(t.id)) return false;
      const spread2 = pvSpread(hasBaseline(), [t]);
      const g = actualCostOf(t) - accrualAt(spread2.segs, stripTime(new Date()).getTime());
      return Math.abs(g) > 0.5;
    });
    note.uncovered = missing.length;
    if (missing.length)
      say('Reconciliation', missing.length + ' activit(ies) move the bar and are absent from the table, '
        + 'e.g. "' + missing[0].name + '" — the residual is hiding them rather than naming them');
  }

  /* 1b. THE SPLIT BAR MUST STILL STATE THE GAP.
     The Budget bar's length is a SUM — timing (EV − PV) plus overrun (AC − EV) —
     drawn as two segments so a large neutral timing figure stops reading as a
     large problem. Two ways that can go wrong and neither shows up as an error:
     the parts can stop adding to the whole, and the DRAWN far end can disagree
     with the badge. The second one actually happened: the segments stacked
     naively, so an under-budget overrun drew back over the tip of the timing bar
     and the longest thing on screen ended at the timing figure while the badge
     and the percentage stated the net. */
  const hb2 = hasBaseline();
  if (Array.isArray(bud.segs) && bud.segs.length) {
    const sum = bud.segs.reduce((n, s) => n + s.pct, 0);
    note.segPcts = bud.segs.map(s => +s.pct.toFixed(3));
    note.segSum = +sum.toFixed(3);
    note.budPct = +(bud.pct || 0).toFixed(3);
    if (Math.abs(sum - (bud.pct || 0)) > 0.01)
      say('Budget bar', 'the segments add to ' + sum.toFixed(2) + '% and the bar states '
        + (bud.pct || 0).toFixed(2) + '% — the parts no longer make the whole');
    // and the identity they claim to be: gap = timing + overrun
    const evNow2 = leafTasks().reduce((s2, t) => s2 + plannedCostOf(t, hb2) * ((t.percentComplete || 0) / 100), 0);
    const acNow2 = leafTasks().reduce((s2, t) => s2 + actualCostOf(t), 0);
    const pvNow2 = accrualAt(pvSpread(hb2, leafTasks()).segs, stripTime(new Date()).getTime());
    const ref2 = leafTasks().reduce((s2, t) => s2 + plannedCostOf(t, hb2), 0);
    const wantTiming = (evNow2 - pvNow2) / ref2 * 100, wantOver = (acNow2 - evNow2) / ref2 * 100;
    if (Math.abs(bud.segs[0].pct - wantTiming) > 0.01)
      say('Budget bar', 'the timing segment is ' + bud.segs[0].pct.toFixed(2) + '% and EV−PV is '
        + wantTiming.toFixed(2) + '% — the neutral part is not the timing');
    if (bud.segs[1] && Math.abs(bud.segs[1].pct - wantOver) > 0.01)
      say('Budget bar', 'the overrun segment is ' + bud.segs[1].pct.toFixed(2) + '% and AC−EV is '
        + wantOver.toFixed(2) + '% — the coloured part is not the overrun');
  }

  // 1c. THE CATCH-UP DATE IS A LOOKUP, SO IT HAS TO BE THE RIGHT DAY.
  // The panel tells the reader the gap closes on a named date and that nothing
  // has to be done about it. If that date is off, the panel is talking someone
  // out of an alarm on a promise it cannot keep. accrualAt is monotonic, so the
  // answer is exactly characterised: at the date the curve has reached the
  // booked total, and the day before it has not.
  {
    const hb3 = hasBaseline();
    const segs3 = pvSpread(hb3, leafTasks()).segs;
    const ac3 = leafTasks().reduce((s2, t) => s2 + actualCostOf(t), 0);
    const cu = ptrCurveCatchesUp(segs3, ac3, new Date());
    note.catchUp = cu.on ? fmtISO(cu.on) : (cu.never ? 'never' : 'already there');
    if (cu.on) {
      const atIt = accrualAt(segs3, cu.on.getTime());
      const dayBefore = accrualAt(segs3, cu.on.getTime() - 86400000);
      if (!(atIt >= ac3 - 0.5))
        say('Budget bar', 'the panel says the gap closes ' + fmtISO(cu.on) + ' but the curve is only at '
          + Math.round(atIt) + ' there, against ' + Math.round(ac3) + ' booked');
      if (dayBefore >= ac3 + 0.5)
        say('Budget bar', 'the gap had already closed before ' + fmtISO(cu.on)
          + ' — the date named is later than the real crossing');
      if (cu.days !== Math.max(0, Math.round((cu.on.getTime() - stripTime(new Date()).getTime()) / 86400000)))
        say('Budget bar', 'the "days from now" figure does not match the date beside it');
    } else if (cu.never) {
      const total3 = segs3.reduce((n, g) => n + (g.c || 0), 0);
      if (total3 >= ac3 - 0.5)
        say('Budget bar', 'the panel says the curve never reaches the booked total, but the plan sums to '
          + Math.round(total3) + ' against ' + Math.round(ac3) + ' booked');
    }
  }

  /* 1d. WHAT IS DRAWN MUST END WHERE THE BADGE SAYS.
     The one thing the data-level checks above cannot see. When the timing and
     overrun segments point in OPPOSITE directions the solid bar has to stop at
     the net and the hollow "given back" band has to start there — touching, not
     overlapping. Stacking them naively drew the band back OVER the tip of the
     solid bar, so the longest mark on the row ended at the timing figure while
     the badge and the percentage beside it stated the net. Every identity above
     still held; only the picture lied. Expressed as a relationship between the
     two drawn spans, so it needs no knowledge of the axis scale. */
  {
    const row = document.querySelector('.ptr-row[data-dim="budget"]');
    const plot = row && row.querySelector('.ptr-plot');
    const pw = plot ? plot.getBoundingClientRect().width : 0;
    if (!plot) say('Budget bar', 'the budget row is not on the page, so nothing below tested the drawing');
    else if (!(pw > 50)) note.plotWidth = Math.round(pw);   // panel not laid out; geometry unreadable
    else {
      const pb = plot.getBoundingClientRect();
      const span = el => { const r = el.getBoundingClientRect();
        return { a: (r.left - pb.left) / pw * 100, b: (r.right - pb.left) / pw * 100 }; };
      const segEls = [...plot.querySelectorAll('.ptr-seg')];
      const solid = segEls.filter(e => !e.classList.contains('ptr-return')).map(span);
      const ret = segEls.filter(e => e.classList.contains('ptr-return')).map(span);
      note.drawnSolid = solid.map(s2 => [+s2.a.toFixed(1), +s2.b.toFixed(1)]);
      note.drawnReturn = ret.map(s2 => [+s2.a.toFixed(1), +s2.b.toFixed(1)]);
      if (segEls.length && !solid.length)
        say('Budget bar', 'the bar is drawn entirely as give-back bands with no solid part, so it states no gap');
      ret.forEach(rb => {
        solid.forEach(sb => {
          const overlap = Math.min(rb.b, sb.b) - Math.max(rb.a, sb.a);
          if (overlap > 0.3)
            say('Budget bar', 'the hollow give-back band overlaps the solid bar by '
              + overlap.toFixed(1) + '% of the axis — the solid bar therefore ends past the gap stated in the '
              + 'badge, so the longest mark on the row contradicts the number beside it');
        });
      });
      // and the two spans have to actually meet, or there is a gap of nothing
      // between the bar and the band that reads as a third quantity
      if (ret.length === 1 && solid.length) {
        const far = Math.max.apply(null, solid.map(s2 => Math.max(s2.a, s2.b)));
        const near = Math.min.apply(null, solid.map(s2 => Math.min(s2.a, s2.b)));
        const touches = Math.abs(ret[0].a - far) < 0.6 || Math.abs(ret[0].b - near) < 0.6;
        if (!touches)
          say('Budget bar', 'the give-back band does not start where the solid bar ends ('
            + ret[0].a.toFixed(1) + '% against ' + far.toFixed(1) + '%) — the space between them means nothing');
      }
    }
  }

  /* 1e. "IS THIS A SCOPE CHANGE?" MUST BE ANSWERED, AND ANSWERED CORRECTLY.
     The scope bar measures EFFORT. Re-running the test-plan generator adds and
     re-estimates test cases, which moves effort while the committed criteria sit
     exactly where they were — a completely different conversation from agreeing
     to build something more, and the only one of the two that owes a change
     order. A reader looking at twelve new rows, every one a generated test case,
     asked the question outright, because the bar said +1.7% and the decisive
     clause was buried at the end of the third sentence.

     The dangerous half is the CONVERSE: this verdict must never appear when real
     scope moved, because "no change order is due" is the most expensive sentence
     on the page to get wrong. So it is tested in both directions. */
  {
    const scp = D.rows.find(x => x.key === 'scope');
    const hb4 = hasBaseline();
    const moved4 = leafTasks().filter(t => !t.isSummary && (t.baseTe == null
      || Math.abs((Number(t.te) || 0) - (Number(t.baseTe) || 0)) > 1e-9));
    const allTc = moved4.length > 0 && moved4.every(isTestCaseTask);
    const fs4 = featureScope();
    const held = fs4.hb && !fs4.added.length && !fs4.removed.length && fs4.netAcs === 0;
    note.scopeMoved = moved4.length;
    note.scopeMovedAllTestCases = allTc;
    note.scopeFeatureSetHeld = held;
    note.scopeVerdict = scp && scp.deltaVerdict ? scp.deltaVerdict : null;
    if (hb4 && allTc && held && scp && scp.state !== 'flat') {
      if (!/not new scope/i.test(scp.deltaVerdict || ''))
        say('Scope bar', moved4.length + ' activities moved and every one is a generated test case against an '
          + 'unchanged feature set, and the row does not say so — a reader has to work out from three separate '
          + 'clauses whether they owe a change order');
      if (!/not a scope change/i.test(scp.note || ''))
        say('Scope bar', 'the verdict is on the readout and the note never states it');
      if (scp.unpriced)
        say('Scope bar', 'the row calls test-case regeneration UNPRICED SCOPE — an accusation that a team gave '
          + 'work away, when the committed criteria never moved');
    }
    /* the converse, on a plan where real scope was added */
    const victim = leafTasks().find(t => !t.isSummary && !isTestCaseTask(t) && t.baseTe != null);
    if (hb4 && victim) {
      const keepTe = { o: victim.o, m: victim.m, p: victim.p };
      victim.o += 5; victim.m += 5; victim.p += 5;
      recompute();
      const scp2 = planTruthData().rows.find(x => x.key === 'scope');
      note.scopeVerdictAfterRealGrowth = scp2 && scp2.deltaVerdict ? scp2.deltaVerdict : null;
      if (scp2 && /not new scope/i.test(scp2.deltaVerdict || ''))
        say('Scope bar', 'a NON-test-case activity was re-estimated upward by 5 units and the row still says '
          + '"verification work, not new scope" — it is clearing a change order that may well be owed');
      Object.assign(victim, keepTe);
      recompute();
    }
  }

  /* 1e2. "AHEAD OF ITS DATES" HAS TO NAME THE DATES.
     The row stated a consequence and withheld its cause: "$8,233 ahead of its
     dates" with nothing saying the work finished on 24 July against a baseline
     of 12 August, which is the entire reason the money sits ahead of the curve.
     Reported as "it doesn't say in the activity what the target date of finish
     should have been". A timing figure without its two dates is a number the
     reader has to take on trust. */
  {
    const timed = (bud.drivers || []).filter(r => /(ahead|behind) of its dates/.test(r.sub || ''));
    note.timingRows = timed.length;
    const withDates = timed.filter(r => /against a (baseline|plan) of/.test(r.sub || ''));
    note.timingRowsNamingDates = withDates.length;
    timed.forEach(r => {
      const t = tasks.find(x => x.id === r.id);
      const hasRef = t && (t.baseFinish || isRealDate(t.finishDate));
      const hasAct = t && (t.actualFinish || isRealDate(t.finishDate));
      if (!hasRef || !hasAct) return;               // nothing to compare; the row says so
      if (!/against a (baseline|plan) of/.test(r.sub || ''))
        say('Budget drill-in', '"' + String(r.sub).replace(/<[^>]+>/g, '').slice(0, 60)
          + '" states money moved by timing and never names the two dates that moved it — the reader is '
          + 'told the consequence and has to take the cause on trust');
      else if (!/(early|late|on the day)/.test(r.sub || ''))
        say('Budget drill-in', 'the row names both dates and never says which way or by how much');
    });
  }

  /* 1f. A CAPPED LIST MUST OWN UP TO BEING A SAMPLE.
     The drill-in slices to the worst five and threw the pre-cut count away, so a
     row saying "22 activities moved" sat above a disclosure badge reading 5 and a
     note reading "top 5" — three numbers about one set with nothing saying the
     last two are a sample of the first. Asked about directly. */
  D.rows.forEach(r => {
    if (!Array.isArray(r.drivers) || !r.drivers.length) return;
    if (r.drivers.matched == null)
      say(r.dim + ' drill-in', 'the driver list does not record how many activities matched before the cap, '
        + 'so nothing on screen can say whether five is all of them or the worst five of twenty-two');
    else if (r.drivers.matched < r.drivers.length)
      say(r.dim + ' drill-in', 'it claims ' + r.drivers.matched + ' matched and shows ' + r.drivers.length);
  });
  note.driverCounts = D.rows.filter(r => (r.drivers || []).length)
    .map(r => r.key + ':' + r.drivers.length + '/' + (r.drivers.matched == null ? '?' : r.drivers.matched));

  /* …and the DRAWN badge has to be the one carrying that count. The three lines
     above interrogate planTruthData(), which is where `matched` is recorded —
     and a build whose renderer computes its badge as `totalN = shownN`, throwing
     the pre-cut count away at the last moment, passes all three. The data is
     impeccable and the reader still sees 22 on the row and 5 in the disclosure.
     Same lesson as the budget segments: an arithmetic identity is blind to what
     is painted, so ask the painting. */
  {
    const host = document.getElementById('planTruth') || document.getElementById('view-analytics');
    const drawn = host ? [...host.querySelectorAll('details.ptr-drv')] : [];
    const withDrv = D.rows.filter(r => (r.drivers || []).length);
    note.drawnDrillIns = drawn.length;
    if (drawn.length !== withDrv.length)
      say('Drill-in', withDrv.length + ' row(s) computed a driver list and ' + drawn.length
        + ' disclosure(s) were drawn, so the pairing below cannot be trusted');
    else drawn.forEach((el, i) => {
      const r = withDrv[i];
      const badge = Number(((el.querySelector('.ptr-drv-n') || {}).textContent || '').replace(/[^\d]/g, ''));
      const shown = el.querySelectorAll('.ptr-drv-list > li').length;
      const want = r.drivers.matched || r.drivers.length;
      if (badge !== want)
        say(r.dim + ' drill-in', 'the badge reads ' + badge + ' and ' + want + ' activities matched — the row '
          + 'above states a figure covering all ' + want + ' and the disclosure beside it offers a smaller '
          + 'number as though that were the whole set');
      const cap = (el.textContent || '').replace(/\s+/g, ' ');
      if (want > shown && !new RegExp('top\\s*' + shown + '\\s*of\\s*' + want).test(cap))
        say(r.dim + ' drill-in', 'it shows ' + shown + ' of ' + want + ' and never says the list is a sample');
    });
  }

  // 2. spend curve: does its "at today" equal the Budget row's pair?
  const hb=hasBaseline(), today=stripTime(new Date()).getTime();
  const spread=pvSpread(hb, leafTasks());
  const pvNow=accrualAt(spread.segs, today);
  const acNow=leafTasks().reduce((s,t)=>s+actualCostOf(t),0);
  note.curvePvAtToday=Math.round(pvNow); note.bookedTotal=Math.round(acNow);
  if (Math.abs((acNow-pvNow)-R.barGap)>1)
    say('Spend curve','booked − plan-to-date is '+Math.round(acNow-pvNow)+' and the bar says '+Math.round(R.barGap));

  // 3. curve endpoint must be the envelope it claims
  const end=accrualAt(spread.segs, 8.64e15);
  note.curveEndpoint=Math.round(end);
  const env=leafTasks().reduce((s,t)=>s+plannedCostOf(t,hb),0);
  note.envelope=Math.round(env);
  if (Math.abs(end-env)>1) say('Spend curve','ends at '+Math.round(end)+' against an envelope of '+Math.round(env));

  // 4. Monte Carlo: percentiles ordered, mean within the range, P80 count honest
  const m=mcResult;
  if(m){ note.p50=+m.p50.toFixed(1); note.p80=+m.p80.toFixed(1); note.p95=+m.p95.toFixed(1);
    if(!(m.min<=m.p50 && m.p50<=m.p80 && m.p80<=m.p90 && m.p90<=m.p95 && m.p95<=m.max))
      say('Monte Carlo','percentiles are not in order');
    const under=m.durations.filter(v=>v<=m.p80).length/m.durations.length;
    note.actuallyUnderP80=+(under*100).toFixed(1);
    if(Math.abs(under-0.8)>0.02) say('Monte Carlo','P80 has '+(under*100).toFixed(1)+'% of runs at or below it');
    if(!(m.mean>=m.min&&m.mean<=m.max)) say('Monte Carlo','the mean is outside its own range');
  }

  // 5. resource chart: person-day pairs vs the per-person breakdown
  const rl=computeResourceLoad();
  const perSum=Object.values(rl.perResource).reduce((s,R2)=>s+((R2.overDays||[]).length),0);
  note.overResourceDays=rl.overResourceDays; note.perPersonOverDays=perSum;
  if (rl.overResourceDays!==perSum)
    say('Resources','the headline says '+rl.overResourceDays+' over-capacity person-days and the per-person rows add to '+perSum);

  // 6. billing table totals vs projectCost
  const bd=billingData();
  const rowCost=bd.rows.reduce((s,x)=>s+x.cost,0)+(bd.fixedTotal||0);
  note.billingTotal=Math.round(bd.totCost); note.billingRowsSum=Math.round(rowCost);
  if (Math.abs(rowCost-bd.totCost)>1) say('Billing','rows add to '+Math.round(rowCost)+' and the total says '+Math.round(bd.totCost));
  if (Math.abs(bd.totCost-projectCost())>1)
    say('Billing','the billing total is '+Math.round(bd.totCost)+' and projectCost() is '+Math.round(projectCost()));

      return { contradictions: bad, counts: note };
    }, label);
  };

  const qa = await sweep('QA reference', QA);
  const crm = await sweep('Real export', CRM);
  const fld = await sweep('Field export', FIELD);
  const R = { contradictions: [].concat(qa.contradictions, crm.contradictions, fld.contradictions),
              qaCounts: qa.counts, crmCounts: crm.counts, fieldCounts: fld.counts,
              pageErrors: errs.slice(0, 8) };
  console.log(JSON.stringify(R, null, 1));
  await b.close();
  if (R.contradictions.length || errs.length) process.exitCode = 1;
})();
