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

        /* THE CAP MUST NEVER TAKE THE ORIGINAL.
           It used to: shift() dropped the first entry, so past forty
           commitments baselineOriginal() returned the oldest SURVIVOR and the
           panel called it the original — measuring "not against the original
           commitment" from a commitment that was not the original, and
           under-reporting the reset count by however many had been dropped. A
           feature whose entire job is to stop a moved commitment hiding, hiding
           a moved commitment.

           The first probe of this could not see it: forty-six baselines taken
           on one afternoon from one plan produce forty-six IDENTICAL entries, so
           the oldest survivor matched the original on every field and the check
           passed on the broken build. Each commitment has to be
           DISTINGUISHABLE, which is why the plan grows between them. */
        resetUndo();
        baselineLog = []; baselineDate = '';
        setBaseline();
        const trueFirst = { at: baselineLog[0].at, env: baselineLog[0].envelope, ts: baselineLog[0].ts };
        const grow = leafTasks().find(x => !x.milestone && !x.isSummary);
        const N = 46;
        for (let i = 1; i < N; i++) {
          if (grow) { grow.o += 1; grow.m += 1; grow.p += 1; recompute(); }
          setBaseline();
        }
        out.cappedLen = baselineLog.length;
        out.cappedResetCount = baselineResetCount();
        if (baselineLog.length > 41)
          say('Baseline history', 'the log grew to ' + baselineLog.length + ' entries against a cap of 40');
        const kept = baselineLog[0];
        if (!kept || kept.ts !== trueFirst.ts || Math.abs(kept.envelope - trueFirst.env) > 0.5)
          say('Baseline history', 'past the cap the log no longer holds the ORIGINAL commitment — it holds an '
            + 'envelope of ' + Math.round((kept || {}).envelope) + ' where the original committed '
            + Math.round(trueFirst.env) + ', so every "against the original" figure is measured from the wrong '
            + 'commitment');
        const orig2 = baselineOriginal();
        if (!orig2 || Math.abs(orig2.envelope - trueFirst.env) > 0.5)
          say('Baseline history', 'baselineOriginal() past the cap returns an envelope of '
            + Math.round((orig2 || {}).envelope) + ' and the original committed ' + Math.round(trueFirst.env));
        if (baselineResetCount() !== N)
          say('Baseline history', N + ' baselines were taken and the panel reports '
            + baselineResetCount() + ' — the cap is swallowing resets out of the count the row leads with');
        // and the table must not have a silent hole in it
        switchTab('baseline'); renderBaseline();
        const shown = (document.getElementById('view-baseline') || document.body).textContent;
        if (baselineLog.length < N && !/commitments? between the original/.test(shown))
          say('Baseline history', 'the table is missing ' + (N - baselineLog.length) + ' commitment(s) and says '
            + 'nothing about it, so the reset count above will not match the rows anyone can count');
      }

      /* ═══ TICKING SOMETHING COMPLETE MUST NOT INVENT ITS DATES ══════════════
       Reported from use: ticking a 5.17-day activity complete in one gesture
       stamped today into BOTH actual start and actual finish. The plan then
       asserted a five-day activity ran for one day — 24 calendar days early
       against its baseline, and a duration a fifth of the estimate archived to
       the bank, every figure arithmetic on a date the tool made up.

       The mechanism is the ordering, which is why this checks the ONE-GESTURE
       path rather than setting the fields directly: 0% straight to 100%
       satisfies both "it has started" and "it has finished", and the started
       rule ran first, stamped today, and left the finished rule with a start
       already present. Any check that set 50% first and then 100% would pass on
       the broken build. */
    ran('actualsFromCheckOff');
    (() => {
      const t = leafTasks().find(x => !x.isSummary && !x.milestone && !x.actualStart && !x.actualFinish
        && (x.percentComplete || 0) === 0 && unitToWorkingDays(x.te || 0) > 3);
      if (!t) { say('Check-off', 'no multi-day unstarted activity on this plan, so the date inference is '
        + 'untested — the whole point is an activity whose duration is longer than a day'); return; }
      const durD = unitToWorkingDays(t.te || 0);
      out.checkOffTask = t.name; out.checkOffDurDays = Math.round(durD * 100) / 100;
      updatePct(t.id, 100);
      out.checkOffStart = t.actualStart; out.checkOffFinish = t.actualFinish;
      if (!t.actualStart || !t.actualFinish) { say('Check-off', 'ticking complete left an actual date empty'); return; }
      const sd = new Date(t.actualStart + 'T00:00:00'), fd = new Date(t.actualFinish + 'T00:00:00');
      const span = workingDaysBetween(sd, fd, getHolidaySet()) + 1;
      out.checkOffSpan = span;
      if (span <= 1)
        say('Check-off', 'ticking a ' + (Math.round(durD * 10) / 10) + '-day activity complete recorded it as '
          + 'starting and finishing on the SAME day — the plan then reports it finishing far early against its '
          + 'baseline and archives a duration nobody observed');
      if (Math.abs(span - Math.round(durD)) > 1)
        say('Check-off', 'the inferred span is ' + span + ' working days against a planned ' + Math.round(durD)
          + ' — the back-dating is not using the activity\'s own duration');
      // the finish is OBSERVED and must be today; only the start is a guess
      if (t.actualFinish !== fmtISO(new Date()))
        say('Check-off', 'the actual finish is ' + t.actualFinish + ', not today — that one IS observed');
      /* AND IT SAYS THE START IS A GUESS. A date the tool worked out, presented
         with the same weight as one somebody recorded, is how an invented figure
         reaches the estimate bank wearing a record's clothes. */
      if (!t.actualStartInferred)
        say('Check-off', 'the back-dated start is not flagged as inferred, so nothing downstream can tell a '
          + 'date the tool worked out from one a person recorded');
      // a one-day activity is the case where same-day IS right
      const s1 = leafTasks().find(x => !x.isSummary && !x.milestone && !x.actualStart
        && (x.percentComplete || 0) === 0 && unitToWorkingDays(x.te || 0) <= 1);
      if (s1) {
        updatePct(s1.id, 100);
        out.shortSameDay = s1.actualStart === s1.actualFinish;
        if (!out.shortSameDay)
          say('Check-off', 'a one-day activity was back-dated anyway, so the inference is applied where there '
            + 'is nothing to infer');
      }
    })();

    /* ═══ COMPLETE, WITH NOBODY HAVING WRITTEN DOWN WHEN ════════════════════
       A different gap from a miss, and it had no surface: an activity can sit
       at 100% with both dates empty and every panel treats it as done. It
       matters because every figure on this tab is measured FROM those dates —
       blank, the row falls back to the forecast and reports "0 days against its
       baseline" for the reason that nothing was measured at all. */
    ran('undatedCompletions');
    (() => {
      const undated = undatedCompletions();
      out.undatedCount = undated.length;
      switchTab('baseline'); renderBaseline();
      const txt = (document.getElementById('baselineContainer') || {}).innerText || '';
      const shown = /no actual dates recorded/i.test(txt);
      out.undatedBannerShown = shown;
      if (undated.length && !shown)
        say('Undated completions', undated.length + ' completed ' + (undated.length === 1 ? 'activity has' : 'activities have')
          + ' no actual dates and the panel says nothing — those rows report 0 days against their baseline '
          + 'because nothing was measured, which is indistinguishable from landing exactly on plan');
      if (!undated.length && shown)
        say('Undated completions', 'the panel warns about undated completions and there are none');
      if (undated.length) {
        // and the offered repair actually dates it
        const id = undated[0].id, nm = undated[0].name;
        stampActualsFromPlan(id);
        const t2 = tasks.find(x => x.id === id);
        if (!t2.actualStart || !t2.actualFinish)
          say('Undated completions', '"Use the planned dates" left "' + nm + '" undated');
        else if (!t2.actualStartInferred)
          say('Undated completions', 'dating an activity from its plan does not flag the start as inferred');
      }
    })();

    return { contradictions: bad, counts: out };
    }, label);
  };

  /* ═══ VERSIONS, ACCEPTANCE, AND THE DIFF THAT SITS ON BOTH ═══════════════
     Three layers, checked in the order they depend on each other, because that
     is the order they had to be built in: a change order is only meaningful
     against a real version, and whether a difference is drift or agreed depends
     on what was accepted.

     Every case below is CONSTRUCTED. None of these conditions exists in a
     committed fixture — nothing is renamed, no test case carries a result,
     nobody has signed anything — so a check that merely looked at a loaded plan
     would pass against a build with any of it removed. The setup is asserted
     before anything is concluded from it. */
  const chain = await (async () => {
    const bad = [], note = {};
    const say = x => bad.push('Version chain :: ' + x);
    await page.evaluate(d => { hydrate(d); calculate(); }, CRM);
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      const out = {}, fail = [];
      const v1 = pushVersion('sow', 'test baseline');

      /* ── 1. A RENAME IS A RENAME ────────────────────────────────────────
         The defect that motivated the whole layer: identity was the name
         string, so renaming an activity produced a removal and a priced
         addition — two line items on a document a client signs, for a change
         that moved nothing. */
      const w = leafTasks().filter(t => !t.milestone && (t.te || 0) > 0);
      if (w.length < 3) { fail.push('the fixture has fewer than three estimated activities, so nothing below was built'); return { fail, out }; }
      const wasName = w[0].name;
      w[0].name = wasName + ' (reworded)';
      calculate();
      const dRename = planDiff(v1.snap, snapshotPlan());
      out.renameKinds = dRename.map(x => x.kind);
      if (!dRename.length) fail.push('renaming an activity produced no diff at all, so the diff is not reading names');
      if (dRename.some(x => x.kind === 'added') || dRename.some(x => x.kind === 'removed'))
        fail.push('renaming one activity produced an add and/or a remove — identity is still the name, so a '
          + 'client gets two priced line items for a change that moved nothing');
      if (!dRename.some(x => x.kind === 'renamed'))
        fail.push('renaming an activity produced ' + dRename.map(x => x.kind).join(', ')
          + ' and no rename record');
      w[0].name = wasName; calculate();

      /* ── 2. THE DIFF SEES MORE THAN THREE FIELDS ────────────────────────
         The old comparison was name, effort, milestone. Rewire the network,
         move every owner, pin every date, and it reported no differences —
         which is how scope stops being billable without anyone deciding to
         give it away. */
      const before = snapshotPlan();
      w[1].owner = (w[1].owner === 'PMO' ? 'QA' : 'PMO');
      w[2].startNoEarlier = '2026-09-01';
      w[2].units = (Number(w[2].units) || 100) === 50 ? 75 : 50;
      calculate();
      const dFields = planDiff(before, snapshotPlan());
      out.fieldKinds = dFields.map(x => x.kind).sort();
      ['reassigned', 'date-pinned', 'reallocated'].forEach(k => {
        if (!dFields.some(x => x.kind === k))
          fail.push('changing the ' + k.replace('-', ' ') + ' of an activity is invisible to the diff, so a '
            + 'change order raised on this plan would say nothing about it');
      });

      /* ── 3. ACCEPTANCE IS NOT COMPLETION ────────────────────────────────
         A test case at 100% used to mean the criterion was covered. It means
         somebody spent the time. */
      const tcs = tasks.filter(isTestCase);
      out.testCases = tcs.length;
      if (!tcs.length) { fail.push('the fixture has no test cases, so nothing about acceptance was tested'); return { fail, out }; }
      const ac = tcAcOf(tcs[0]);
      if (!ac) fail.push('the first test case verifies no criterion, so the rollup below has nothing to roll up');
      updatePct(tcs[0].id, 100);
      const doneNoResult = acAcceptance(ac);
      out.stateWhenDoneButUnrun = doneNoResult.state;
      if (doneNoResult.state === 'accepted')
        fail.push('a test case marked 100% complete with NO result recorded reports its criterion as accepted '
          + '— finishing the activity is being read as the test passing, which is the defect this layer exists for');
      tcSetResult(tcs[0].id, 'fail');
      out.stateAfterFail = acAcceptance(ac).state;
      if (acAcceptance(ac).state !== 'failed')
        fail.push('a criterion whose test case FAILED reports "' + acAcceptance(ac).state
          + '" — a failure has to be a failure, not a shade of partial, because it is the one state that '
          + 'means finished work and unaccepted scope at the same time');
      tcSetResult(tcs[0].id, 'pass');
      out.stateAfterPass = acAcceptance(ac).state;
      out.retestsCounted = acAcceptance(ac).retests;
      if (acAcceptance(ac).state !== 'accepted')
        fail.push('a criterion whose every test case passed reports "' + acAcceptance(ac).state + '"');
      if (!(acAcceptance(ac).retests >= 1))
        fail.push('a case run twice records no re-test — "passed" and "passed on the second attempt" are the '
          + 'same fact in this file, and the second one is the one that predicts the next estimate');

      /* ── 3b. A PRICED LINE CARRIES ITS OWN MONEY ────────────────────────
         The change order's total has to be the sum of its lines, and a line can
         only carry money if the snapshot stores what the activity is CHARGED
         at. The first version stored the baselined cost, which on any plan with
         a schedule baseline is frozen and identical in both snapshots — so
         every re-estimated line priced at exactly zero and the document said
         "not priced" about work that had visibly doubled. */
      const beforePrice = snapshotPlan();
      const grow = leafTasks().find(t => !t.milestone && (t.te || 0) > 0
        && taskParticipants(t).some(pr => !isClientResource(pr.name) && getBillRate(pr.name) > 0));
      if (!grow) fail.push('no activity on this plan is billed at a rate, so line pricing was not tested');
      else {
        grow.m = (Number(grow.m) || 1) * 3; calculate();
        const dPrice = planDiff(beforePrice, snapshotPlan()).filter(x => x.kind === 're-estimated');
        out.pricedLine = dPrice.length ? Math.round(dPrice[0].priceDelta) : null;
        if (!dPrice.length) fail.push('tripling an estimate produced no re-estimated line');
        else if (!(Math.abs(dPrice[0].priceDelta) > 1))
          fail.push('an activity billed at a real rate tripled its estimate and its change-order line carries '
            + 'a price impact of ' + dPrice[0].priceDelta + ' — the line cannot be added up, so the change '
            + 'order is a total nobody can check');
      }

      /* ── 3c. THE COMPARISON IS DRAWN, NOT MERELY COMPUTABLE ─────────────
         Every fact needed to answer "what moved since we agreed this" was
         already stored before the compare view existed, and the commitment
         history ended at a sentence — "nothing changed", "the one before it
         recorded no totals". A sentence is where a reader stops. So the check
         is that the table EXISTS with a row per change, not that planDiff can
         return one: a diff nothing renders is the same as no diff.

         Read out of the painted DOM rather than out of the function, because
         computed-and-never-appended is a failure this repo has shipped before
         and no arithmetic check can see it. */
      setBaseline();
      const w2 = leafTasks().filter(t => !t.milestone && (t.te || 0) > 0);
      w2[0].owner = (w2[0].owner === 'QA' ? 'PMO' : 'QA');
      calculate();
      switchTab('baseline'); renderBaseline();
      const cmpHost = document.getElementById('versionCompareBl');
      out.compareHostDrawn = !!cmpHost;
      if (!cmpHost) fail.push('the version comparison is not on the Plan vs actual tab at all — the commitment '
        + 'history still ends at a sentence');
      else {
        const sels = cmpHost.querySelectorAll('select');
        out.comparePickers = sels.length;
        if (sels.length < 2) fail.push('the comparison offers ' + sels.length + ' picker(s) — you cannot choose '
          + 'which two versions to compare, which is the whole request');
        const btns = [...document.querySelectorAll('#view-baseline button')]
          .filter(b2 => /what moved/i.test(b2.textContent || ''));
        out.perRowButtons = btns.length;
        /* Reported AND guarded. The first version pushed the finding and then
           clicked btns[btns.length - 1] anyway — on a build where no row offers
           the button that is undefined, so the sweep threw inside page.evaluate
           and died before printing anything. A check that crashes instead of
           reporting is a check that reports nothing, and it fails hardest
           exactly on the builds it was written to catch. */
        if (!btns.length) fail.push('no commitment row offers to show what moved since it, so the comparison '
          + 'can only be reached by hunting for it');
        else btns[btns.length - 1].click();
        const rows = cmpHost.querySelectorAll('tbody tr').length;
        out.compareRowsDrawn = rows;
        if (!rows) fail.push('an owner was changed after the newest commitment and the comparison drew no rows '
          + '— it is computing a diff and painting nothing');
        if (!/owner/i.test(cmpHost.textContent || ''))
          fail.push('the drawn comparison does not name the field that moved');
      }

      /* ── 4. SIGN-OFF IS AGAINST A VERSION, NOT A DATE ───────────────────
         Otherwise a criterion reworded the day after signing is invisible. */
      const s0 = ((reqs && reqs.stories) || [])[0];
      if (!s0 || !(s0.ac || []).length) { fail.push('no story with criteria, so sign-off drift was not tested'); return { fail, out }; }
      const so = recordSignoff('story', s0.id, 'Client UAT Lead', '');
      out.signoffVersion = so.v;
      if (!so.v) fail.push('a sign-off was recorded against no version, so nothing can say later what was signed');
      if (signoffDrift().length)
        fail.push('drift was reported the instant the sign-off was taken — a record that disagrees with itself '
          + 'at the moment it is written');
      s0.ac[0].text = String(s0.ac[0].text || '') + ' AND exports to PDF';
      const drift = signoffDrift();
      out.driftAfterReword = drift.length;
      if (!drift.length)
        fail.push('an acceptance criterion was reworded AFTER it was signed for and nothing noticed — the '
          + 'client agreed to different words from the ones the plan now holds');
      return { fail, out };
    });
    (r.fail || []).forEach(say);
    return { contradictions: bad, counts: r.out };
  })();

  const qa = await sweep('QA reference', QA);
  const crm = await sweep('Real export', CRM);
  const R = { contradictions: [].concat(qa.contradictions, crm.contradictions, chain.contradictions),
              qaCounts: qa.counts, crmCounts: crm.counts, versionsAndAcceptance: chain.counts,
              pageErrors: errs.slice(0, 8) };
  console.log(JSON.stringify(R, null, 1));
  await b.close();
  if (R.contradictions.length || errs.length) process.exitCode = 1;
})();
