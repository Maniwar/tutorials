const { chromium } = require('playwright-core'); const fs = require('fs');
function chrome(){const r='/opt/pw-browsers';for(const d of fs.readdirSync(r))if(/chromium/i.test(d)){const p=r+'/'+d+'/chrome-linux/chrome';if(fs.existsSync(p))return p;}}
(async () => {
  const b = await chromium.launch({headless:true,args:['--no-sandbox'],executablePath:chrome()});
  const page = await b.newPage({viewport:{width:1440,height:1000}});
  page.on('dialog', d => d.accept());
  const errs=[]; page.on('pageerror', e=>errs.push(e.message));
  await page.goto('file:///home/user/tutorials/pert-gantt-tracker.html',{waitUntil:'load'});
  await page.evaluate(() => { loadSample(); });
  await page.waitForTimeout(500);
  const R = {};

  // Build the exact shape of the reported case: a baseline whose windows have
  // barely opened, work finished early, every activity UNDER its own budget.
  const setup = (factor) => page.evaluate((f) => {
    loadSample(); calculate(); setBaseline(); calculate();
    leafTasks().filter(t => !t.milestone).slice(0, 5).forEach(t => {
      t.percentComplete = 100;
      t.actualStart = fmtISO(new Date()); t.actualFinish = fmtISO(new Date());
      t.autoActualCost = false;
      t.actualCost = Math.round((taskCost(t) || 1000) * f);
    });
    calculate();
    return planTruthData().rows.find(r => r.key === 'budget');
  }, factor);

  // ── EARLY AND UNDER BUDGET IS NOT A PROBLEM ────────────────────────────
  R.earlyUnder = await page.evaluate(async () => {
    loadSample(); calculate(); setBaseline(); calculate();
    leafTasks().filter(t => !t.milestone).slice(0, 5).forEach(t => {
      t.percentComplete = 100;
      t.actualStart = fmtISO(new Date()); t.actualFinish = fmtISO(new Date());
      t.autoActualCost = false; t.actualCost = Math.round((taskCost(t) || 1000) * 0.95);
    });
    calculate();
    const bud = planTruthData().rows.find(r => r.key === 'budget');
    const d = (bud.drivers || [])[0];
    const t = tasks.find(x => x.id === d.id);
    const budg = plannedCostOf(t, hasBaseline());
    const ev = budg * ((t.percentComplete || 0) / 100);
    const ac = actualCostOf(t);
    return { figure: d.txt, tone: d.tone, sub: (d.sub || '').replace(/<[^>]+>/g, ''),
             underItsBudget: ac < ev,
             toneIsNotBad: d.tone !== 'bad',
             saysAhead: /ahead of its dates/.test(d.sub || ''),
             saysUnder: /under its own budget/.test(d.sub || ''),
             // the identity the whole fix rests on
             identity: Math.abs((d.timing + d.over) - (ac - (function(){
               try { return accrualAt(pvSpread(hasBaseline(), [t]).segs, stripTime(new Date()).getTime()); }
               catch (e) { return 0; } })())) < 0.01 };
  });

  // ── GENUINELY OVER ITS OWN BUDGET STILL READS RED ──────────────────────
  R.reallyOver = await page.evaluate(() => {
    loadSample(); calculate(); setBaseline(); calculate();
    leafTasks().filter(t => !t.milestone).slice(0, 5).forEach(t => {
      t.percentComplete = 100;
      t.actualStart = fmtISO(new Date()); t.actualFinish = fmtISO(new Date());
      t.autoActualCost = false; t.actualCost = Math.round((taskCost(t) || 1000) * 1.6);
    });
    calculate();
    const bud = planTruthData().rows.find(r => r.key === 'budget');
    const d = (bud.drivers || [])[0];
    const t = tasks.find(x => x.id === d.id);
    return { tone: d.tone, sub: (d.sub || '').replace(/<[^>]+>/g, ''),
             isBad: d.tone === 'bad', saysOver: /over its own budget/.test(d.sub || ''),
             overIsPositive: d.over > 0,
             overAllocated: Math.abs(d.over - (actualCostOf(t) - plannedCostOf(t, hasBaseline()))) < 1 };
  });

  // ── ON BUDGET AND ON ITS DATES SAYS SO ─────────────────────────────────
  R.exactly = await page.evaluate(() => {
    loadSample(); calculate(); setBaseline(); calculate();
    // several booked at EXACTLY their own budget, so the list is populated and
    // every row's second half is genuinely zero
    leafTasks().filter(x => !x.milestone).slice(0, 5).forEach(t => {
      t.percentComplete = 100; t.autoActualCost = false;
      t.actualCost = plannedCostOf(t, hasBaseline());
      t.actualStart = fmtISO(new Date()); t.actualFinish = fmtISO(new Date());
    });
    calculate();
    const bud = planTruthData().rows.find(r => r.key === 'budget');
    const ds = bud.drivers || [];
    return { found: ds.length > 0, tone: ds[0] ? ds[0].tone : null,
             over: ds[0] ? Math.round(ds[0].over) : null,
             everyOverIsZero: ds.every(d => Math.abs(d.over) < 1),
             noneBad: ds.every(d => d.tone !== 'bad'),
             saysOnItsDatesOrAhead: ds.every(d => /ahead of its dates|exactly what it was budgeted/.test(d.sub || '')),
             neverSaysOverBudget: ds.every(d => !/over its own budget/.test(d.sub || '')) };
  });

  // ── THE NOTE NO LONGER CLAIMS A SUM THAT IS NOT TRUE ───────────────────
  R.sumClaim = await page.evaluate(() => {
    loadSample(); calculate(); setBaseline(); calculate();
    leafTasks().filter(t => !t.milestone).slice(0, 5).forEach(t => {
      t.percentComplete = 100;
      t.actualStart = fmtISO(new Date()); t.actualFinish = fmtISO(new Date());
      t.autoActualCost = false; t.actualCost = Math.round((taskCost(t) || 1000) * 0.95);
    });
    calculate();
    const bud = planTruthData().rows.find(r => r.key === 'budget');
    const today = stripTime(new Date()).getTime(), hb = hasBaseline();
    const pd = t => { try { return accrualAt(pvSpread(hb, [t]).segs, today); } catch (e) { return 0; } };
    const shown = (bud.drivers || []).reduce((s, d) => {
      const t = tasks.find(x => x.id === d.id); return s + (actualCostOf(t) - pd(t)); }, 0);
    const barGap = leafTasks().reduce((s, t) => s + actualCostOf(t), 0)
      - accrualAt(pvSpread(hb, leafTasks()).segs, today);
    const note = (bud.driverNote || '').replace(/<[^>]+>/g, '');
    const rest = barGap - shown;
    const restShown = (note.match(/other ([+−]\$[\d,]+)/) || [])[1];
    return { rowsActuallySum: Math.abs(rest) < 1,
             noteClaimsTheyAddUp: /Between them they account for the whole of the bar/.test(note),
             noteNamesTheRemainder: /the rest of the plan accounts for the other/.test(note),
             // whichever it says, it must be the true one
             claimIsCorrect: (Math.abs(rest) < Math.max(1, Math.abs(shown) * 0.02))
               === /Between them they account for the whole of the bar/.test(note),
             restShown, restReal: (rest > 0 ? '+' : '−') + '$' + Math.abs(Math.round(rest)).toLocaleString(),
             tellsReaderWhichLine: /Read the second line, not the first/.test(note),
             noLongerAssertsAddUp: !/so these add up to it/.test(note) };
  });

  // ── THE OTHER TWO DIMENSIONS ARE UNTOUCHED ─────────────────────────────
  R.otherDims = await page.evaluate(() => {
    const rows = planTruthData().rows;
    const sch = rows.find(r => r.key === 'sched'), scp = rows.find(r => r.key === 'scope');
    return { schHasDrivers: !!(sch.drivers || []).length || sch.state === 'needs',
             schNoSub: (sch.drivers || []).every(d => d.sub === undefined),
             scpNoSub: (scp.drivers || []).every(d => d.sub === undefined),
             schNoTone: (sch.drivers || []).every(d => d.tone === undefined) };
  });

  // ── IT RENDERS, AND THE SECOND LINE IS ON THE PAGE ─────────────────────
  R.render = await page.evaluate(() => {
    switchTab('analytics');
    renderAnalytics();
    const host = document.getElementById('planTruth') || document.body;
    document.querySelectorAll('.ptr-drv').forEach(d => d.open = true);
    const subs = [...document.querySelectorAll('.ptr-drv-sub')];
    const vals = [...document.querySelectorAll('.ptr-drv-v')];
    return { subsRendered: subs.length, valsRendered: vals.length,
             sampleSub: subs.length ? subs[0].textContent.trim().slice(0, 70) : null,
             anyGreenFigure: vals.some(v => v.classList.contains('ptr-drv-v-good')),
             noButtonInButton: !document.querySelector('.ptr-drv-row button') };
  });

  for (const w of [375, 768, 1440]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.evaluate(() => { renderAnalytics(); document.querySelectorAll('.ptr-drv').forEach(d => d.open = true); });
    await page.waitForTimeout(160);
    R['w'+w] = await page.evaluate(() => {
      const doc = document.documentElement;
      const li = [...document.querySelectorAll('.ptr-drv-li')];
      const overflowing = li.filter(x => x.scrollWidth > x.clientWidth + 1).length;
      return { overflow: doc.scrollWidth - doc.clientWidth, rows: li.length,
               rowsOverflowing: overflowing,
               subsVisible: [...document.querySelectorAll('.ptr-drv-sub')]
                 .filter(x => x.getBoundingClientRect().width > 0).length };
    });
  }

  R.pageErrors = errs.slice(0, 8);
  console.log(JSON.stringify(R, null, 1));
  await b.close();
})();
