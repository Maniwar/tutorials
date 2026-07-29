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

(async () => {
  const b = await chromium.launch({headless:true,args:['--no-sandbox'],executablePath: chromePath()});
  const page = await b.newPage({viewport:{width:1440,height:1200}});
  page.on('dialog', d => d.accept());
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(APP, {waitUntil:'load'});

  const sweep = async (label, data) => {
    await page.evaluate(d => { hydrate(d); calculate(); }, data);
    await page.waitForTimeout(600);
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
  const R = { contradictions: [].concat(qa.contradictions, crm.contradictions),
              qaCounts: qa.counts, crmCounts: crm.counts,
              pageErrors: errs.slice(0, 8) };
  console.log(JSON.stringify(R, null, 1));
  await b.close();
  if (R.contradictions.length || errs.length) process.exitCode = 1;
})();
