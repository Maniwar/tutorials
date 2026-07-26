/* ═══════════════════════════════════════════════════════════════════════════
   THE ONE TEST THAT CANNOT BE FOOLED BY A CONFIDENT MISTAKE.

   The seven semantic sweeps check that the application agrees with itself, and
   with a recompute written after reading its source. That catches a great deal
   — every defect found so far — but it has one blind spot by construction: an
   error absorbed into both the app and the recompute agrees with itself
   perfectly.

   This is the fixture that closes it. fixtures/qa-reference.json is a five
   activity plan whose inputs were chosen so that every derived number is a
   whole number a person can check on paper: three-point estimates that make TE
   exact, round day rates, a calendar starting on a Monday with no holidays, and
   a typed contract price so nothing depends on a random simulation. The
   expected values in fixtures/qa-reference.expected.json were derived from
   those inputs by hand and carry their arithmetic with them.

   Failures here are not style. Every one of them means a number the app shows
   you is wrong.
   ═══════════════════════════════════════════════════════════════════════════ */
const { requirePlaywright, chromePath, APP } = require('./_harness');
const { chromium } = requirePlaywright();
const fs = require('fs'), path = require('path');
const FIX = path.resolve(__dirname, '..', 'fixtures', 'qa-reference.json');
const EXP = path.resolve(__dirname, '..', 'fixtures', 'qa-reference.expected.json');
const DATA = JSON.parse(fs.readFileSync(FIX, 'utf8'));
const E = JSON.parse(fs.readFileSync(EXP, 'utf8'));

(async () => {
  const b = await chromium.launch({headless:true,args:['--no-sandbox'],executablePath: chromePath()});
  const page = await b.newPage({viewport:{width:1440,height:1200}});
  page.on('dialog', d => d.accept());
  const errs=[]; page.on('pageerror', e=>errs.push(e.message));
  await page.goto(APP,{waitUntil:'load'});
  await page.evaluate(d => { window.__fix = d; hydrate(d); calculate(); }, DATA);
  await page.waitForTimeout(800);

  const actual = await page.evaluate(() => {
    const hb = hasBaseline(), today = stripTime(new Date()).getTime();
    const acts = {};
    leafTasks().forEach(t => {
      acts[t.name] = {
        te: t.te, variance: t.variance, es: t.es, ef: t.ef, ls: t.ls, lf: t.lf,
        slack: t.slack, critical: !!t.isCritical,
        startDate: t.startDate ? fmtISO(t.startDate) : null,
        finishDate: t.finishDate ? fmtISO(t.finishDate) : null,
        cost: taskCost(t),
      };
    });
    // revenue per activity, the same definition the spec uses
    leafTasks().forEach(t => {
      const days = t.milestone ? 0 : unitToWorkingDays(t.te || 0);
      acts[t.name].revenue = taskParticipants(t).reduce((s, pr) =>
        s + (isClientResource(pr.name) ? 0 : getBillRate(pr.name) * days * pr.units / 100), 0);
    });
    const f = pricingFigures();
    const rl = computeResourceLoad();
    const AC = leafTasks().reduce((s, t) => s + actualCostOf(t), 0);
    const PV = accrualAt(pvSpread(hb, leafTasks()).segs, today);
    const EV = earnedValue();

    // the second resourcing scenario: the same overlap, with C still in flight
    const c = tasks.find(t => t.name === 'C Docs');
    const savedPct = c.percentComplete, savedAC = c.actualCost;
    c.percentComplete = 0; c.actualCost = 0;
    calculate();
    const rl2 = computeResourceLoad();
    const live = { days: rl2.overResourceDays, people: rl2.resourcesOver.slice(),
      dates: [...new Set(Object.values(rl2.perResource).flatMap(R => R.overDays || []))].sort() };
    c.percentComplete = savedPct; c.actualCost = savedAC;
    calculate();

    // the span the plan actually occupies, and whether the panel explains it
    const hol = getHolidaySet();
    const fin = latestFinish(leafTasks());
    let span = 0, d0 = new Date(projectStartDate());
    while (fin && stripTime(d0) <= stripTime(fin)) {
      if (isWorkingDay(d0, hol)) span++; d0.setDate(d0.getDate() + 1);
    }
    switchTab('analytics'); renderAnalytics();
    const dec = h => { const x = document.createElement('div');
      x.innerHTML = String(h).replace(/<[^>]+>/g, ' '); return (x.textContent || '').replace(/\s+/g, ' '); };
    const anaTxt = dec(document.getElementById('view-analytics').innerHTML);
    const cpmLine = (anaTxt.match(/Deterministic \(CPM\) duration:[^:]{0,200}/) || [''])[0].trim();
    const explains = /marked on the next working day|spans one day more/i.test(cpmLine);

    // and what the finish becomes with no milestone at all
    const savedTasks = tasks.slice();
    tasks = tasks.filter(t => !t.milestone);
    calculate();
    const finNoMs = latestFinish(leafTasks());
    const finishWithoutMilestone = finNoMs ? fmtISO(finNoMs) : null;
    tasks = savedTasks; calculate();

    return {
      spanWorkingDays: span, cpmLine, cpmLineExplainsTheExtraDay: explains,
      finishWithoutMilestone,
      activities: acts,
      projectDurationDays: Math.max(0, ...leafTasks().map(t => t.ef), 0),
      criticalPath: leafTasks().filter(t => t.isCritical).sort((a, b) => a.es - b.es).map(t => t.name),
      projectCost: projectCost(), projectRevenue: f.detRev, price: f.price, marginPct: f.margin,
      evm: { pv: PV, ev: EV, ac: AC, cv: EV - AC, svMoney: EV - PV, gapAgainstPlanToDate: AC - PV },
      resourcingAsShipped: rl.overResourceDays,
      resourcingWithCUnfinished: live,
    };
  });

  // ── compare ────────────────────────────────────────────────────────────
  const fails = [];
  const near = (a, b2, tol) => Number.isFinite(a) && Number.isFinite(b2) && Math.abs(a - b2) <= (tol == null ? 1e-6 : tol);
  const cmp = (what, exp, got, tol) => {
    if (typeof exp === 'boolean' || typeof exp === 'string') {
      if (exp !== got) fails.push(`${what}: expected ${JSON.stringify(exp)}, got ${JSON.stringify(got)}`);
      return;
    }
    if (!near(exp, got, tol)) fails.push(`${what}: expected ${exp}, got ${got}`);
  };

  Object.keys(E.activities).forEach(name => {
    const e = E.activities[name], g = actual.activities[name];
    if (!g) { fails.push(`${name}: the plan does not contain this activity`); return; }
    ['te', 'es', 'ef', 'ls', 'lf', 'slack', 'cost', 'revenue'].forEach(k => {
      if (e[k] != null) cmp(`${name}.${k}`, e[k], g[k]);
    });
    if (e.variance != null && g.variance != null) cmp(`${name}.variance`, e.variance, g.variance, 1e-9);
    cmp(`${name}.critical`, e.critical, g.critical);
    if (e.startDate) cmp(`${name}.startDate`, e.startDate, g.startDate);
    if (e.finishDate) cmp(`${name}.finishDate`, e.finishDate, g.finishDate);
  });

  cmp('project.durationDays', E.projectDurationDays, actual.projectDurationDays);
  cmp('project.criticalPath', JSON.stringify(E.criticalPath), JSON.stringify(actual.criticalPath));
  cmp('project.cost', E.projectCost, actual.projectCost);
  cmp('project.revenue', E.projectRevenue, actual.projectRevenue);
  cmp('project.price', E.price, actual.price);
  cmp('project.marginPct', E.marginPct, actual.marginPct, 1e-9);

  ['pv', 'ev', 'ac', 'cv', 'svMoney', 'gapAgainstPlanToDate'].forEach(k =>
    cmp(`evm.${k}`, E.evm[k], actual.evm[k], 0.01));

  /* THE MILESTONE CONVENTION, PINNED. Three independent derivations put E on
     17 March; the app puts it on the 18th, deliberately, because a sign-off is
     an event attended after the work rather than the instant it stops. The
     choice is defensible either way — what is not is making it silently, so the
     panel must NAME the extra day. */
  if (E.milestoneDayConvention) {
    cmp('milestone.spanWorkingDays', E.milestoneDayConvention.workingDaysFromStartToProjectFinish,
        actual.spanWorkingDays);
    cmp('milestone.workDays', E.milestoneDayConvention.workingDaysOfActualWork, actual.projectDurationDays);
    if (!actual.cpmLineExplainsTheExtraDay)
      fails.push('milestone.explained: the CPM line prints "' + actual.cpmLine
        + '" — the span is one working day longer than the duration and the line does not say why');
    cmp('milestone.withoutIt', E.milestoneDayConvention.withoutTheMilestone.projectFinish,
        actual.finishWithoutMilestone);
  }

  cmp('resourcing.asShipped.overAllocatedResourceDays',
      E.resourcing.asShipped.overAllocatedResourceDays, actual.resourcingAsShipped);
  cmp('resourcing.withCUnfinished.overAllocatedResourceDays',
      E.resourcing.withCUnfinished.overAllocatedResourceDays, actual.resourcingWithCUnfinished.days);
  cmp('resourcing.withCUnfinished.people',
      JSON.stringify(E.resourcing.withCUnfinished.people),
      JSON.stringify(actual.resourcingWithCUnfinished.people));
  cmp('resourcing.withCUnfinished.dates',
      JSON.stringify(E.resourcing.withCUnfinished.dates),
      JSON.stringify(actual.resourcingWithCUnfinished.dates));

  const checks = Object.keys(E.activities).length * 11 + 6 + 6 + 4;
  console.log(JSON.stringify({
    fixture: 'qa-reference',
    checksRun: checks,
    failures: fails,
    passed: fails.length === 0,
    actual,
    pageErrors: errs.slice(0, 8),
  }, null, 1));
  await b.close();
  if (fails.length || errs.length) process.exitCode = 1;
})();
