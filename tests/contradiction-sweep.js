/* ═══════════════════════════════════════════════════════════════════════════
   THE REAL PLAN, NOT THE SAMPLE.

   Every defect reported from a screenshot so far has needed the same shape to
   become visible: a baseline taken after the work started, so activities finish
   before their own baseline windows ever open. loadSample() has never had that
   shape, which is why the probes were all green while the screen was wrong.

   This runs against the actual export. It asserts nothing about what the code
   does — it recomputes every figure independently, from the stored fields, and
   checks that what the panel SAYS agrees with what the arithmetic MEANS.
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
  await page.waitForTimeout(600);
  const R = {};

  R.loaded = await page.evaluate(() => ({
    name: projectName, tasks: tasks.length, baseline: baselineDate,
    calculated: calculated, raid: (raid || []).length,
    finishedBeforeTheirBaselineOpens: leafTasks().filter(t =>
      (t.percentComplete || 0) >= 100 && t.baseStart && t.actualFinish
      && t.actualFinish < fmtISO(t.baseStart)).length
  }));

  // ═══ CONTRADICTION SWEEP ═══════════════════════════════════════════════
  // Recompute from stored fields, then compare against what the panel claims.
  R.sweep = await page.evaluate(() => {
    const bad = [];
    const say = (where, what) => bad.push(where + ' :: ' + what);
    const hb = hasBaseline();
    const today = stripTime(new Date()).getTime();
    const pvOf = t => { try { return accrualAt(pvSpread(hb, [t]).segs, today); } catch (e) { return 0; } };
    const data = planTruthData();
    const bud = data.rows.find(r => r.key === 'budget');
    const sch = data.rows.find(r => r.key === 'sched');

    // ── 1. no row may READ as a fault unless its own work actually cost more ──
    (bud.drivers || []).forEach(d => {
      const t = tasks.find(x => x.id === d.id);
      const AC = actualCostOf(t), BUDG = plannedCostOf(t, hb);
      const EV = BUDG * ((t.percentComplete || 0) / 100), PV = pvOf(t);
      const over = AC - EV, timing = EV - PV;
      const tol = Math.max(1, BUDG * 0.005);
      if (d.tone === 'bad' && over <= tol)
        say(t.name, 'coloured as a fault but finished work cost ' + fmtMoney(Math.round(-over)) + ' LESS than budgeted');
      if (d.tone === 'good' && over > tol)
        say(t.name, 'coloured as good but is ' + fmtMoney(Math.round(over)) + ' over its own budget');
      if (Math.abs((timing + over) - (AC - PV)) > 0.01)
        say(t.name, 'the two halves do not add back to the figure shown');
      if (Math.abs(d.over - over) > 0.01 || Math.abs(d.timing - timing) > 0.01)
        say(t.name, 'the panel and an independent recompute disagree on the split');
      // the second line must name the same direction the arithmetic has
      if (over > tol && !/over its own budget/.test(d.sub || '')) say(t.name, 'is over budget and does not say so');
      if (over < -tol && !/under its own budget/.test(d.sub || '')) say(t.name, 'is under budget and does not say so');
    });

    // ── 2. a red RAID chip must be a fault; a watch chip must not be ────────
    tasks.forEach(t => {
      const cause = raidCauseChipFor(t.id), watch = raidWatchChipFor(t.id);
      const isFault = raidHasFaultCause(t.id);
      if (/class="raid-chip"/.test(cause) && !isFault)
        say(t.name, 'shows a red RAID chip with no issue, materialised risk or broken assumption behind it');
      if (/raid-watch-chip/.test(watch) && raidForTask(t.id, true).filter(raidWatches).length === 0)
        say(t.name, 'shows a watch chip with nothing being watched');
      // the offer to log a cause must appear exactly when no fault is recorded
      const group = raidChipsFor(t.id, () => ptrRaidBtn(t.id, t.name, 'x'));
      if (isFault && /ptr-log-btn/.test(group))
        say(t.name, 'offers to log a cause when one is already recorded');
      if (!isFault && !/ptr-log-btn/.test(group))
        say(t.name, 'has no recorded cause and does not offer to record one');
    });

    // ── 3. the bar's own arithmetic, recomputed ────────────────────────────
    const AC = leafTasks().reduce((s, t) => s + actualCostOf(t), 0);
    const PV = accrualAt(pvSpread(hb, leafTasks()).segs, today);
    const EV = earnedValue();
    const bv = budgetVerdict(AC, PV, EV, budgetAtCompletion(hb));
    /* The badge now carries a VERDICT as well as the gap — "+$21,664 spent
       ahead of the curve · finished work $2,517 under budget" — because the gap
       alone read as an alarm on a plan that is ahead and under. So the check
       reads the leading figure specifically rather than stripping every digit
       out of the whole string, which would have swallowed the verdict's number
       and compared a concatenation against the gap. */
    if (!/^[+−]\$?[\d,]+ (spent ahead of the curve|behind the curve)|^on the plan to date/.test(bud.delta || ''))
      say('Budget bar', 'delta is not in the expected form: ' + bud.delta);
    const lead = String(bud.delta || '').split('·')[0];
    const shownDelta = Number(lead.replace(/[^0-9.]/g, '')) * (/−/.test(lead) ? -1 : 1);
    if (bud.delta && /\d/.test(lead) && Math.abs(shownDelta - bv.gap) > 2)
      say('Budget bar', 'prints ' + bud.delta + ' but AC−PV recomputes to ' + fmtMoney(Math.round(bv.gap)));
    // the bar says "timing not overspend" only when that is actually true
    const saysTiming = /Timing, not overspend/.test(bud.note || '');
    if (saysTiming && bv.overValue)
      say('Budget bar', 'says "Timing, not overspend" while booked cost IS above the value of the work done');
    if (!saysTiming && bv.overCurve && !bv.overValue)
      say('Budget bar', 'is above the curve but not above earned value, and does not say it is timing');

    // ── 4. the driver list's sum claim must be the true one ────────────────
    const shown = (bud.drivers || []).reduce((s, d) => {
      const t = tasks.find(x => x.id === d.id); return s + (actualCostOf(t) - pvOf(t)); }, 0);
    const rest = bv.gap - shown;
    const claimsWhole = /account for the whole of the bar/.test(bud.driverNote || '');
    if (claimsWhole && Math.abs(rest) > Math.max(1, Math.abs(shown) * 0.02))
      say('Budget list', 'claims the rows account for the whole bar; they miss ' + fmtMoney(Math.round(rest)));
    if (!claimsWhole && Math.abs(rest) <= Math.max(1, Math.abs(shown) * 0.02))
      say('Budget list', 'names a remainder that is actually zero');

    // ── 5. every activity flagged must have something behind it ────────────
    leafTasks().forEach(t => {
      activityFlags(t).forEach(f => {
        if (f.code === 'raid-turned' && !raidForTask(t.id, true).some(r => raidExplains(r) && raidOutcomeOpts(r.type)))
          say(t.name, 'flagged as carrying a turned risk with none recorded');
        if (f.code === 'raid-unanswered' && !raidForTask(t.id, true).some(raidUnanswered))
          say(t.name, 'flagged for an unanswered outcome with none outstanding');
      });
    });

    return { contradictions: bad,
      figures: { booked: Math.round(AC), planToDate: Math.round(PV), earned: Math.round(EV),
                 envelope: Math.round(budgetAtCompletion(hb)), gap: Math.round(bv.gap),
                 cv: Math.round(bv.cv), tone: bv.tone },
      barDelta: bud.delta, schDelta: sch.delta,
      rows: (bud.drivers || []).map(d => ({ n: d.name, fig: d.txt, tone: d.tone,
              sub: (d.sub || '').replace(/<[^>]+>/g, '') })) };
  });

  /* ═══ THE COLOUR THAT ACTUALLY LANDS ═════════════════════════════════════
     The class list was right and the screen was still wrong: .ptr-drv-crit is
     declared later at the same specificity, so it repainted an under-budget row
     red for a fact about the schedule. Asserting on className would have passed.
     This reads getComputedStyle, which is what the reader's eye actually gets. */
  await page.evaluate(() => { switchTab('analytics'); renderAnalytics();
    document.querySelectorAll('.ptr-drv').forEach(d => d.open = true); });
  await page.waitForTimeout(300);
  R.colour = await page.evaluate(() => {
    const rgb = el => getComputedStyle(el).color;
    const bud = planTruthData().rows.find(r => r.key === 'budget');
    const byName = new Map((bud.drivers || []).map(d => [d.name, d]));
    const lists = [...document.querySelectorAll('.ptr-drv-list')];
    // the budget list is the one whose rows carry a second line
    const list = lists.find(l => l.querySelector('.ptr-drv-sub')) || lists[0];
    const wrong = [], seen = [];
    [...(list ? list.querySelectorAll('.ptr-drv-li') : [])].forEach(li => {
      const v = li.querySelector('.ptr-drv-v');
      const name = (li.textContent.match(/[\d.]+\s+([A-Za-z][^$\n]*?)\s*\$/) || [])[1];
      const d = [...byName.values()].find(x => li.textContent.indexOf(x.name) >= 0);
      if (!v || !d) return;
      const c = rgb(v);
      const isRed = /rgb\(\s*(1[89]\d|2[0-5]\d)\s*,\s*([0-5]?\d)\s*,/.test(c);
      const isGreen = /rgb\(\s*([0-5]?\d)\s*,\s*(1[0-4]\d|[6-9]\d)\s*,/.test(c);
      seen.push({ n: d.name, tone: d.tone, colour: c, isRed, isGreen });
      // the one rule that matters: red must mean the finished work cost more
      if (isRed && d.tone !== 'bad') wrong.push(d.name + ' renders RED with tone ' + d.tone
        + ' (over its own budget by ' + Math.round(d.over) + ')');
      if (d.tone === 'good' && isRed) wrong.push(d.name + ' came in UNDER budget and renders red');
      if (d.tone === 'bad' && !isRed) wrong.push(d.name + ' is over its own budget and does not render red');
    });
    return { rows: seen, wrong };
  });

  // ── what the page actually looks like ──────────────────────────────────
  await page.evaluate(() => { switchTab('analytics'); renderAnalytics();
    document.querySelectorAll('.ptr-drv').forEach(d => d.open = true); });
  await page.waitForTimeout(400);
  const box = await page.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find(x => /BUDGET/.test(x.textContent || '')
      && x.className && String(x.className).indexOf('ptr-row') >= 0);
    const host = el || document.querySelector('.ptr-rows') || document.body;
    host.scrollIntoView({ block: 'center' });
    const r = host.getBoundingClientRect();
    return { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: Math.min(1400, r.width + 16),
             height: Math.min(1100, r.height + 16) };
  });
  await page.screenshot({ path: '/tmp/claude-0/-home-user-tutorials/25183f3a-3bd2-5763-a346-97c18137195f/scratchpad/shot_budget.png',
                          clip: box.width > 40 && box.height > 40 ? box : undefined });

  R.pageErrors = errs.slice(0, 8);
  console.log(JSON.stringify(R, null, 1));
  await b.close();
})();
