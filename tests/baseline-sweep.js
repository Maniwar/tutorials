/* ═══════════════════════════════════════════════════════════════════════════
   THE REFERENCE EVERY VARIANCE IS MEASURED AGAINST.

   A baseline is not a number on a screen. It is the denominator under every
   other number on every other screen: schedule variance, cost variance, earned
   value, the spend curve, feature scope, and the change orders a client signs.
   Get the roll wrong and nothing looks broken — the plan simply reports itself
   against the wrong past, confidently and self-consistently. That is the exact
   failure class this suite was built for, and it was uncovered here.

   Two moments matter, and they are the only two that write a reference:

     setBaseline()        freezes dates, effort, cost and the agreed feature set
                          at one instant. If those four are captured at
                          different moments, the schedule story and the money
                          story are told about different plans.

     approveChangeOrder() logs the signed change and ROLLS the SOW baseline
                          forward, so the next change order lists only what
                          happened after this one. A roll that does not happen
                          makes every future change order re-bill scope the
                          client already approved.

   The standard throughout is that immediately after a reference is taken there
   is nothing to report against it — zero variance, no scope drift, an empty
   change order. A baseline that shows variance the instant it is set is
   measuring against something other than what it captured.
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
    await page.waitForTimeout(500);
    return page.evaluate(async lbl => {
      const bad = [];
      const say = (w, x) => bad.push(lbl + ' · ' + w + ' :: ' + x);
      const out = { ran: [] };
      const ran = k => out.ran.push(k);
      const iso = d => d ? fmtISO(new Date(d)) : null;

      // ── 1. A FRESH BASELINE HAS NOTHING TO REPORT AGAINST ITSELF ────────
      ran('1·zeroVarianceAtCapture');
      setBaseline(); calculate();
      const off = [];
      leafTasks().forEach(t => {
        if (iso(t.baseStart) !== iso(t.startDate)) off.push(t.name + ' start');
        if (iso(t.baseFinish) !== iso(t.finishDate)) off.push(t.name + ' finish');
        if (Math.abs((t.baseTe || 0) - (t.te || 0)) > 1e-9) off.push(t.name + ' effort');
        if (Math.abs((t.baseCost == null ? 0 : t.baseCost) - taskCost(t)) > 0.5) off.push(t.name + ' cost');
      });
      if (off.length)
        say('Baseline', 'the instant it was taken, ' + off.length + ' field(s) already differ from '
          + 'the plan it captured: ' + off.slice(0, 3).join(', '));
      if (!hasBaseline()) say('Baseline', 'setBaseline ran and hasBaseline() still says there is none');
      if (baselineDate !== fmtISO(new Date()))
        say('Baseline', 'stamped "' + baselineDate + '" for a baseline taken today');

      // ── 2. THE FEATURE SET IS FROZEN AT THE SAME INSTANT ────────────────
      // One button, one moment. If the stories are captured at a different time
      // from the dates, "scope grew" and "we are late" describe different plans.
      ran('2·featureSetSameInstant');
      const st = ((reqs && reqs.stories) || []);
      const fs0 = featureScope();
      if (st.length) {
        if (!fs0.hb) say('Baseline', 'froze the dates and the money but captured no feature set');
        if (fs0.added.length || fs0.removed.length || fs0.grew.length)
          say('Baseline', 'reports scope drift the instant the scope was committed: '
            + fs0.added.length + ' added, ' + fs0.removed.length + ' removed, '
            + fs0.grew.length + ' grown');
        if (fs0.baseStories !== fs0.nowStories || fs0.baseAcs !== fs0.nowAcs)
          say('Baseline', 'captured ' + fs0.baseStories + ' stories / ' + fs0.baseAcs
            + ' criteria from a plan holding ' + fs0.nowStories + ' / ' + fs0.nowAcs);
        if (fs0.at !== baselineDate)
          say('Baseline', 'the feature set is stamped ' + fs0.at + ' and the schedule baseline '
            + baselineDate + ' — two references, two moments');
      }

      // ── 3. A CHANGE AFTER THE BASELINE SHOWS UP AS EXACTLY THAT CHANGE ──
      // The reference must not move with the plan. Re-estimate one activity and
      // the variance must be the size of the re-estimate and nothing else.
      ran('3·varianceIsTheChange');
      const sid = leafTasks().find(t => !t.milestone && !t.isSummary).id;
      const t3 = tasks.find(t => t.id === sid);
      const wasTe = t3.te, wasBase = t3.baseTe;
      t3.o += 4; t3.m += 4; t3.p += 4;      // +4 units on every leg is +4 on TE
      calculate();
      const now3 = tasks.find(t => t.id === sid);
      if (Math.abs((now3.baseTe || 0) - wasBase) > 1e-9)
        say('Baseline', 'editing an activity moved its BASELINE effort from ' + wasBase
          + ' to ' + now3.baseTe + ' — the reference is tracking the plan instead of holding still');
      if (Math.abs((now3.te - now3.baseTe) - 4) > 1e-6)
        say('Baseline', 'added 4 units of effort and the variance against baseline reads '
          + (now3.te - now3.baseTe).toFixed(2));
      // and the other activities must be untouched by someone else's edit
      const bled = leafTasks().filter(t => t.id !== sid
        && Math.abs((t.te || 0) - (t.baseTe || 0)) > 1e-6);
      if (bled.length)
        say('Baseline', 'editing one activity opened a variance on ' + bled.length
          + ' other(s), e.g. "' + bled[0].name + '"');

      // ── 4. RE-BASELINING ADOPTS THE PLAN AS IT NOW STANDS ───────────────
      ran('4·reBaseline');
      setBaseline(); calculate();
      const still = leafTasks().filter(t => Math.abs((t.te || 0) - (t.baseTe || 0)) > 1e-9);
      if (still.length)
        say('Baseline', 're-baselining left ' + still.length + ' activit(ies) carrying an effort '
          + 'variance against the plan just captured, e.g. "' + still[0].name + '"');

      // ── 5. THE REFERENCE SURVIVES SAVE AND LOAD ─────────────────────────
      // baseStart/baseFinish are written as ISO strings and read back as dates.
      // Lose them and every variance silently reads zero — the plan reports
      // itself perfectly on track.
      ran('5·survivesSaveLoad');
      const beforeIds = leafTasks().map(t => t.id + ':' + iso(t.baseStart) + ':' + iso(t.baseFinish)
        + ':' + (t.baseTe || 0).toFixed(4) + ':' + (t.baseCost == null ? 'null' : t.baseCost.toFixed(2)));
      const bDate = baselineDate, bReqs = JSON.stringify(reqsBaseline);
      hydrate(JSON.parse(JSON.stringify(serialize()))); calculate();
      const afterIds = leafTasks().map(t => t.id + ':' + iso(t.baseStart) + ':' + iso(t.baseFinish)
        + ':' + (t.baseTe || 0).toFixed(4) + ':' + (t.baseCost == null ? 'null' : t.baseCost.toFixed(2)));
      if (beforeIds.join('|') !== afterIds.join('|')) {
        const i = beforeIds.findIndex((v, k) => v !== afterIds[k]);
        say('Baseline', 'the reference does not survive save and load — e.g. "' + beforeIds[i]
          + '" came back "' + afterIds[i] + '"');
      }
      if (baselineDate !== bDate)
        say('Baseline', 'the baseline date was ' + bDate + ' and came back ' + baselineDate);
      if (JSON.stringify(reqsBaseline) !== bReqs)
        say('Baseline', 'the committed feature set does not survive save and load');
      if (!hasBaseline())
        say('Baseline', 'a baselined plan reloads reporting that it has no baseline');

      // ── 6. CLEARING REMOVES ALL FOUR REFERENCES AND THE FEATURE SET ─────
      // A half-cleared baseline is worse than either state: some activities
      // report variance and some do not, on one screen.
      ran('6·clearIsComplete');
      const keep = JSON.stringify(serialize());
      clearBaseline(); calculate();
      const left = leafTasks().filter(t => t.baseStart || t.baseFinish
        || t.baseTe != null || t.baseCost != null);
      if (left.length)
        say('Baseline', 'clearing left a reference on ' + left.length + ' activit(ies), e.g. "'
          + left[0].name + '"');
      if (hasBaseline()) say('Baseline', 'cleared, and hasBaseline() still says there is one');
      if (reqsBaseline) say('Baseline', 'cleared the dates and money and kept the committed feature set');
      hydrate(JSON.parse(keep)); calculate();

      // ── 7. AN APPROVED CHANGE ORDER IS LOGGED ONCE, EXACTLY ─────────────
      ran('7·changeOrderLogged');
      sowBaseline = snapshotSowBaseline();
      const logBefore = coLog.length;
      const sid7 = leafTasks().find(t => !t.milestone && !t.isSummary).id;
      const t7 = tasks.find(t => t.id === sid7);
      t7.o += 3; t7.m += 3; t7.p += 3;
      calculate();
      await draftChangeOrder();
      const pend = draftChangeOrder._pending;
      if (!pend) say('Change order', 'drafting produced no pending change to approve');
      else {
        approveChangeOrder();
        if (coLog.length !== logBefore + 1)
          say('Change order', 'approving one change order wrote ' + (coLog.length - logBefore)
            + ' entries to the log');
        const e = coLog[coLog.length - 1];
        if (e.finishDelta !== pend.finishDelta || e.priceDelta !== pend.priceDelta
            || e.no !== pend.no)
          say('Change order', 'the logged entry does not match the change that was approved: '
            + JSON.stringify({ logged: { no: e.no, f: e.finishDelta, p: e.priceDelta },
                               approved: { no: pend.no, f: pend.finishDelta, p: pend.priceDelta } }));
        if (draftChangeOrder._pending)
          say('Change order', 'approval left the draft pending — pressing approve twice would log it twice');

        // ── 8. APPROVAL ROLLS THE BASELINE FORWARD ───────────────────────
        // The whole point: the NEXT change order must list only what happens
        // after this one. If the roll does not happen, every future change
        // order re-bills scope the client already signed for.
        /* Two halves, and only together do they test the roll.

           With nothing changed since approval there must be NO next change
           order — the product says "no differences vs the SOW baseline" and
           declines, which is the roll having happened. Asserting only that is
           weak: a draft function that never produced anything would also pass.

           So then change something NEW and draft again. That one must appear,
           and it must list ONLY the new change. If the baseline did not roll,
           the second change order re-lists the activity the client already
           signed for and bills it twice. */
        ran('8·rollForward');
        draftChangeOrder._pending = null;
        await draftChangeOrder();
        if (draftChangeOrder._pending)
          say('Change order', 'with nothing changed since approval, a further change order was '
            + 'still drafted claiming ' + draftChangeOrder._pending.finishDelta + ' days and '
            + draftChangeOrder._pending.priceDelta + ' — the baseline did not roll, so it is '
            + 're-billing scope the client already approved');

        const firstName = tasks.find(t => t.id === sid7).name;
        const other = leafTasks().find(t => !t.milestone && !t.isSummary && t.id !== sid7);
        if (!other) out.ran.push('8·PARTIAL-only-one-editable-activity');
        else {
          other.o += 5; other.m += 5; other.p += 5;
          calculate();
          draftChangeOrder._pending = null;
          await draftChangeOrder();
          const p2 = draftChangeOrder._pending;
          if (!p2) say('Change order', 'a real change made after approval produced no change order');
          else {
            if (p2.no === pend.no)
              say('Change order', 'the second change order reuses the number ' + p2.no);
            if (p2.detail.indexOf(other.name) < 0)
              say('Change order', 'the change made after approval is missing from the change order: '
                + '"' + p2.detail + '"');
            if (p2.detail.indexOf(firstName) >= 0)
              say('Change order', 'the second change order re-lists "' + firstName + '", which was '
                + 'approved in ' + pend.no + ' — the baseline did not roll and the client is being '
                + 'billed for it twice');
          }
        }
        draftChangeOrder._pending = null;

        // ── 9. THE HISTORY TOTALS ARE THE SUM OF THE HISTORY ─────────────
        ran('9·historyTotals');
        renderCoHistory();
        const el = document.getElementById('coHistory');
        const txt = el ? el.textContent.replace(/\s+/g, ' ') : '';
        const cum = coLog.reduce((s, c) => s + (c.finishDelta || 0), 0);
        const m = txt.match(/cumulative:\s*([+\-−]?\d+)\s*days/);
        if (m && parseInt(m[1].replace('−', '-'), 10) !== cum)
          say('Change order', 'the history states a cumulative ' + m[1] + ' days against '
            + cum + ' in the log');

        // ── 10. THE LOG SURVIVES SAVE AND LOAD ───────────────────────────
        ran('10·logSurvives');
        const logJson = JSON.stringify(coLog);
        hydrate(JSON.parse(JSON.stringify(serialize()))); calculate();
        if (JSON.stringify(coLog) !== logJson)
          say('Change order', 'the signed change-order history does not survive save and load');
      }

      /* ── 11. THE COMMITMENT HISTORY ────────────────────────────────────────
         Pressing 📌 Set baseline used to overwrite the only reference in the
         file, so the original commitment stopped existing the moment it was
         replaced and nothing on screen could tell a plan that has held its dates
         from one that has moved them three times and measures itself against the
         third. The log exists to answer that, which makes three things
         load-bearing: it must record every commitment, it must survive save and
         load (or it is a session-only fiction), and exactly ONE entry may be
         marked current — the first version marked by DATE and put the badge on
         both of two same-afternoon resets. */
      ran('11·commitmentHistory');
      {
        const n0 = baselineResetCount();
        setBaseline();
        if (baselineResetCount() !== n0 + 1)
          say('Baseline history', 'taking a baseline did not add an entry to the commitment log');
        const first = baselineLog.filter(e => e.kind === 'set')[0];
        // move the plan, then commit again: the log must show the commitment moving
        const t2 = leafTasks().find(x => !x.milestone && !x.isSummary);
        if (t2) { t2.o *= 3; t2.m *= 3; t2.p *= 3; recompute(); }
        setBaseline();
        const sets = baselineLog.filter(e => e.kind === 'set');
        const cur = sets[sets.length - 1];
        if (sets.length < n0 + 2) say('Baseline history', 'the second commitment was not recorded');
        if (t2 && !(cur.envelope > first.envelope || cur.effort > first.effort || cur.finish !== first.finish))
          say('Baseline history', 'the plan grew between two commitments and the log records them as identical, '
            + 'so a re-baseline that gave something away is indistinguishable from one that did not');
        const orig = baselineOriginal();
        if (!orig) say('Baseline history', 'with two commitments taken, the original is still not identifiable — '
          + 'a plan cannot say whether it is measured from the start or from the last reset');
        else if (orig === cur) say('Baseline history', 'the "original commitment" and the current one are the '
          + 'same entry, so the distinction the panel draws is not real');
        // exactly one row wears "current"
        switchTab('baseline'); renderBaseline();
        const marks = (document.getElementById('view-baseline') || document.body).textContent
          .split('· current').length - 1;
        out.currentMarks = marks;
        if (marks !== 1) say('Baseline history', marks + ' rows of the commitment history are marked "current" — '
          + 'exactly one is, and marking by date puts the badge on every reset taken the same day');
        // it is a stored fact, not a session one
        const logJson2 = JSON.stringify(baselineLog);
        hydrate(JSON.parse(JSON.stringify(serialize()))); calculate();
        if (JSON.stringify(baselineLog) !== logJson2)
          say('Baseline history', 'the commitment history does not survive save and load');
        // clearing LOGS rather than truncating, or the record of what was once
        // promised disappears with the reference to it
        const beforeClear = baselineLog.length;
        clearBaseline();
        if (baselineLog.length <= beforeClear)
          say('Baseline history', 'clearing the baseline shortened the commitment history — what was once '
            + 'promised is no longer knowable');
        out.logLen = baselineLog.length;
      }

      return { contradictions: bad, counts: out };
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
