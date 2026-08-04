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
        /* ACCEPTED only, on both sides. The header stopped summing the whole
           log once change orders gained states — an issued one is a request and
           a rejected one is a refusal, and adding either into "cumulative"
           reports scope nobody agreed as scope that was. This check summed
           everything and would now disagree with a header that is right. */
        const cum = coAccepted().reduce((s, c) => s + (c.finishDelta || 0), 0);
        const m = txt.match(/agreed:\s*([+\-−]?\d+)\s*days/);
        if (!m)
          say('Change order', 'the history header no longer states an agreed schedule total, so the figure '
            + 'this check exists to reconcile is not on screen');
        else if (parseInt(m[1].replace('−', '-'), 10) !== cum)
          say('Change order', 'the history states an agreed ' + m[1] + ' days against '
            + cum + ' across the accepted entries in the log');

        // ── 10. THE LOG SURVIVES SAVE AND LOAD ───────────────────────────
        ran('10·logSurvives');
        /* Compared POST-hydrate against POST-hydrate. hydrate normalises a log
           entry — it coerces the state against the known set and defaults the
           fields a file written before states existed does not carry — so
           comparing the in-memory array to the one that comes back reports the
           normalisation as data loss. The property is that saving and loading
           is STABLE, not that hydrate is the identity function, and the second
           round trip is where that becomes visible. */
        hydrate(JSON.parse(JSON.stringify(serialize()))); calculate();
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
    /* async, because drafting a change order is. The block was synchronous
       until it needed to raise one, and `await` inside a non-async arrow is a
       syntax error that takes the whole file out rather than failing a check —
       a sweep that will not parse reports nothing at all. */
    const r = await page.evaluate(async () => {
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

      /* ── 3d. THE EVIDENCE FIELD CAN ACTUALLY BE FILLED ──────────────────
         It shipped in the model, in serialize, in hydrate and in the round-trip
         check, and the only setter took it from an options argument the single
         caller never passed. A field that accepts, stores and reloads a value
         nobody can enter is indistinguishable from one that does not exist,
         except that it reads as though the evidence is being recorded. So the
         assertion is REACHABILITY, not persistence — persistence was never the
         part that was broken. */
      {
        const anyTc = tasks.filter(isTestCase)[0];
        const plain = leafTasks().find(t2 => !isTestCase(t2) && !t2.milestone);
        openEditModal(anyTc.id, true);
        const row = document.getElementById('mTcRow');
        const ev = document.getElementById('mTcEvidence');
        out.evidenceFieldExists = !!ev;
        out.evidenceRowShownOnTc = !!row && row.style.display !== 'none';
        if (!ev) fail.push('there is no way to type acceptance evidence anywhere in the editor, so tcEvidence '
          + 'stores and reloads a value nobody can enter');
        else if (!out.evidenceRowShownOnTc)
          fail.push('the evidence field is in the document and hidden on a test case, which is the one kind of '
            + 'activity it is for');
        else {
          ev.value = 'probe/AC-evidence.pdf';
          /* The estimate is normalised through the form before saving, and that
             is not tidying. An earlier section of this check tripled a most-
             likely estimate past its own pessimistic bound, and saveActivity
             CORRECTLY refuses that — so the save was rejected on a rule about
             PERT triples and this check reported it as "typing evidence does not
             reach the activity", which is a product defect that did not exist.
             A check must not inherit state from the section above it and then
             blame the product for the consequences. */
          document.getElementById('mO').value = '1';
          document.getElementById('mM').value = '2';
          document.getElementById('mP').value = '3';
          /* And logged effort, because recording a result marks the case
             finished and the form then requires effort against any progress —
             correctly, since progress with no time spent is the shape that
             makes every variance read zero. Two separate rules refused this
             save and both of them were the product being right. */
          document.getElementById('mActualEffort').value = '0.5';
          saveActivity();
          /* Whether the modal is still OPEN, not whether editingId is still set
             — closeModal closes the overlay and deliberately leaves editingId
             alone, so keying the refusal off that variable reported a refusal
             on a save that had plainly worked. Anchored to an incidental
             representation of "the form is still up", which is the exact
             pattern this repo now has a probe for, written by the person who
             wrote the probe. */
          const ov = document.getElementById('modal');
          if (ov && ov.classList.contains('active')) {
            fail.push('saving the editor was refused and the form stayed up, so nothing below this point '
              + 'tested the evidence field');
            closeModal();
          }
          const back = tasks.find(t2 => t2.id === anyTc.id);
          out.evidenceSaved = back.tcEvidence;
          if (back.tcEvidence !== 'probe/AC-evidence.pdf')
            fail.push('typing evidence into the editor and saving did not reach the activity — it holds "'
              + back.tcEvidence + '"');
        }
        if (plain) {
          openEditModal(plain.id, true);
          const r2 = document.getElementById('mTcRow');
          out.evidenceHiddenOnPlain = !r2 || r2.style.display === 'none';
          if (!out.evidenceHiddenOnPlain)
            fail.push('a result-and-evidence row is offered on an ordinary build activity, where a test result '
              + 'means nothing');
          closeModal();
        }
      }

      /* ── 3e. A FAILURE IS CHASEABLE, AND ONCE ───────────────────────────
         Raising a defect existed only on the path where results arrive by
         PASTE. Recording a fail in the app — which is how a tester works —
         produced a red mark and nothing to act on: the same defect with two
         doors and one of them wired. */
      {
        const tc2 = tasks.filter(isTestCase)[1] || tasks.filter(isTestCase)[0];
        const before = raid.length;
        tcSetResult(tc2.id, 'fail');
        out.raidAfterFail = raid.length - before;
        if (raid.length === before)
          fail.push('recording a test case as FAILED opened nothing in the RAID log — the failure is a number '
            + 'with nothing tracking it, while the same result arriving by paste raises a defect');
        const linked = raid[raid.length - 1];
        if (raid.length > before && linked.taskId !== tc2.id)
          fail.push('the defect raised by a failing test is not linked to the case that failed');
        tcSetResult(tc2.id, 'fail');
        out.raidAfterSecondFail = raid.length - before;
        if (raid.length - before > 1)
          fail.push('re-running the same failing case opened a SECOND defect — three attempts at one broken '
            + 'thing is one defect with three attempts');
      }

      /* ── 3f. DELIVERED IS NOT ACCEPTED, AND ONLY ONE IS BILLABLE ─────────
         The money-in surface could only ask whether finished work had been
         invoiced. With a real result to read it can ask the question before
         that one. */
      {
        const tc3 = tasks.filter(isTestCase)[0];
        tc3.owner = leafTasks().map(t2 => t2.owner).find(o2 => o2 && !isClientResource(o2) && getBillRate(o2) > 0)
          || tc3.owner;
        tc3.invoiced = 1200;
        tcSetResult(tc3.id, 'fail');
        const rec = revenueRecord(leafTasks());
        out.doneUnacceptedN = rec.doneUnacceptedN;
        out.billedUnacceptedN = rec.billedUnacceptedN;
        if (!rec.doneUnacceptedN)
          fail.push('an activity finished with a FAILED test case against it is not counted as delivered-'
            + 'but-unaccepted, so the panel can only tell you whether finished work was invoiced and never '
            + 'whether the client agreed it was finished');
        if (!rec.billedUnacceptedN)
          fail.push('work invoiced with a failed test case against it is not flagged — that is the invoice '
            + 'that comes back');
        tcSetResult(tc3.id, 'pass');
        const rec2 = revenueRecord(leafTasks());
        out.unacceptedAfterPass = rec2.doneUnacceptedN;
        if (rec2.doneUnacceptedN >= rec.doneUnacceptedN)
          fail.push('passing the failing case did not clear the delivered-but-unaccepted count, so the flag '
            + 'never goes away and stops being read');
      }

      /* ── 3g. AN ISSUED CHANGE ORDER IS A REQUEST, NOT REVENUE ────────────
         The header used to sum the whole log. With only accepted entries in it
         that is indistinguishable from summing the accepted ones, which is why
         a mutant restoring the old behaviour survived the first version of this
         check: the case that tells them apart has to be BUILT. So one is issued
         and deliberately left unsigned. */
      {
        const v0 = pushVersion('sow', 'issue-probe baseline');
        const g2 = leafTasks().find(t2 => !t2.milestone && (t2.te || 0) > 0);
        g2.m = (Number(g2.m) || 1) + 5; calculate();
        await draftChangeOrder();
        issueChangeOrder();
        const issued = coLog[coLog.length - 1];
        out.issuedState = issued && issued.state;
        out.issuedTouchedBaseline = issued && issued.toV != null;
        if (!issued || issued.state !== 'issued')
          fail.push('issuing a change order did not log it as issued — the log cannot tell what you have '
            + 'ASKED for from what you have been given');
        if (issued && issued.toV != null)
          fail.push('issuing a change order rolled the contract baseline, so the next one will diff from '
            + 'scope the client has not signed and will stop asking for it');
        renderCoHistory();
        const hdr = (document.getElementById('coHistory') || {}).textContent || '';
        const agreed = coAccepted().reduce((s2, c2) => s2 + (c2.priceDelta || 0), 0);
        const all = coLog.reduce((s2, c2) => s2 + (c2.priceDelta || 0), 0);
        out.agreedVsAll = [Math.round(agreed), Math.round(all)];
        if (Math.abs(agreed - all) < 1)
          fail.push('the issued change order carries no price, so agreed-versus-everything cannot be told '
            + 'apart here and this check proves nothing');
        else if (hdr.indexOf(fmtMoney(Math.abs(all))) >= 0 && hdr.indexOf(fmtMoney(Math.abs(agreed))) < 0)
          fail.push('the history header states ' + fmtMoney(Math.abs(all)) + ', which is the whole log '
            + 'including scope nobody has signed — an issued change order is a request and reporting it as '
            + 'cumulative impact turns a request into revenue');
        if (!/out for signature/i.test(hdr))
          fail.push('nothing on the history says a change order is still out for signature, so the '
            + 'difference between asked-for and agreed is invisible on the surface people read');

        /* NO STATE IS A ONE-WAY DOOR. superseded had an empty transition list,
           so one mis-click was permanent and the only way back was editing
           storage by hand. Reported by exactly that. Asserted over ALL FOUR
           rather than for the one that was broken: the property is "every state
           has a way out", and checking only the state that failed once is how
           the next dead end ships. */
        const stuck = Object.keys(CO_STATES).filter(k => {
          const probe = { no: 'probe', state: k, diff: [] };
          return !/→ /.test(coStateCell(probe));
        });
        out.deadEndStates = stuck;
        if (stuck.length)
          fail.push('the change-order state(s) ' + stuck.join(', ') + ' offer no transition at all — a state '
            + 'reached by one click and unreachable from is a trap, and every one of these is reversible in '
            + 'the real world');

        /* THE LINE PRICES CAN BE WITHHELD AND THE TOTAL CANNOT MOVE. Hiding a
           line's price is a commercial choice about what a client is shown; if
           it also changed an arithmetic total it would be a way to send a
           document that does not add up. */
        const target = coLog[coLog.length - 1];
        if ((target.diff || []).length) {
          const sumBefore = target.lineSum;
          const priceBefore = target.priceDelta;
          /* Read what the DRILL-IN SAYS, not what the record stores. The first
             version of this compared target.lineSum before and after, which the
             withholding code never touches — so a build that recomputed the
             displayed total from the SHOWN lines only passed it. The stored
             figure was never the thing at risk; the printed one was, because
             that is the number a client is handed. Located by its own label,
             which is the right way to resolve a cell and survives a restyling. */
          const statBy = lbl => {
            const card = [...document.querySelectorAll('#coModalBody .stat-card')]
              .find(c2 => ((c2.querySelector('.label') || {}).textContent || '').trim() === lbl);
            return card ? ((card.querySelector('.value') || {}).textContent || '').trim() : null;
          };
          coOpen(target.no);
          const shownSumBefore = statBy('Sum of its lines');
          const shownPriceBefore = statBy('Price impact');
          coSetAllPrices(0);
          out.withheld = (target.hidePrice || []).length;
          const shownSumAfter = statBy('Sum of its lines');
          out.shownTotals = [shownSumBefore, shownSumAfter];
          if (shownSumBefore == null)
            fail.push('the change-order drill-in states no "Sum of its lines" at all, so what the client is '
              + 'handed cannot be checked against what the record holds');
          else if (shownSumBefore !== shownSumAfter)
            fail.push('withholding the line prices changed the total the drill-in PRINTS (' + shownSumBefore
              + ' → ' + shownSumAfter + ') — hiding decides what a client is shown and must never change the '
              + 'arithmetic they are asked to accept');
          if (shownPriceBefore != null && statBy('Price impact') !== shownPriceBefore)
            fail.push('withholding the line prices moved the printed price impact');
          out.totalsHeld = target.lineSum === sumBefore && target.priceDelta === priceBefore;
          if (!out.withheld)
            fail.push('withholding every line price on a change order with ' + target.diff.length
              + ' lines recorded none as withheld — the control does nothing');
          if (!out.totalsHeld)
            fail.push('withholding the line prices moved the totals (' + sumBefore + ' → ' + target.lineSum
              + ') — hiding decides what a client is SHOWN and must never change what is true');
          const modal = (document.getElementById('coModalBody') || {}).textContent || '';
          if (modal.indexOf(String(target.diff.length)) < 0)
            fail.push('the drill-in does not state how many lines the change order carries');
          if (!/withheld|aggregate/i.test(modal))
            fail.push('every price is withheld and the drill-in does not say so anywhere');
          coSetAllPrices(1);
          out.restoredPrices = (target.hidePrice || []).length === 0;
          if (!out.restoredPrices) fail.push('showing every price again left some withheld');
          closeCoModal();
        }

        /* THE DRILL-IN EXISTS AND CARRIES THE RECORD. Everything below was
           stored and reachable from nowhere: the narrative lived in a native
           title tooltip on a <tr>, and the typed line set lived nowhere at all. */
        renderCoHistory();
        const rowsOpen = [...(document.getElementById('coHistory') || document.createElement('div'))
          .querySelectorAll('tbody tr')].filter(tr => /coOpen/.test(tr.getAttribute('onclick') || '')).length;
        out.openableRows = rowsOpen;
        if (!rowsOpen)
          fail.push('no row in the change-order history opens anything — the narrative and the typed line '
            + 'set are both on the record and reachable from nowhere on the page');
        coOpen(coLog[0].no);
        const dtl = (document.getElementById('coModalBody') || {}).textContent || '';
        out.drillInChars = dtl.length;
        if (dtl.length < 150)
          fail.push('the change-order drill-in draws almost nothing (' + dtl.length + ' chars) — opening it '
            + 'is not the same as it saying anything');
        if (coLog[0].detail && dtl.indexOf(String(coLog[0].detail).slice(0, 30)) < 0)
          fail.push('the drill-in does not show the change order’s own narrative');
        closeCoModal();
      }

      /* ── 3i-b. TWO DOCUMENTS, ONE BOX, AND A WAY BETWEEN THEM ───────────
         The SOW and the change order shared one container and the last one
         drawn won. Getting back to the other meant regenerating it — which on
         the SOW side also re-rolls the contract baseline, so the only route
         back to a document was an action with a side effect on the contract.
         Reported by use: "how can i go between viewing the change order and the
         SOW that was there before ect?" */
      {
        await generateSOW();
        const sowLen = String(sowDraft || '').length;
        const g3 = leafTasks().find(t2 => !t2.milestone && (t2.te || 0) > 0);
        g3.m = (Number(g3.m) || 1) + 3; calculate();
        await draftChangeOrder();
        const box = () => (document.getElementById('sowContainer') || {}).innerHTML || '';
        /* NOT /Change Order/. The SOW contains a change-CONTROL clause that
           says the words "change order" in prose, so matching on them is true
           of both documents and the check would pass on a build with no switch
           at all. The discriminator is the change order's own ACTION STRIP —
           approveChangeOrder is drawn with that document and with nothing else
           on this page. Anchored on a control rather than on wording for the
           same reason this directory has a whole probe about it. */
        const isCo = () => /approveChangeOrder/.test(box());
        out.docTabs = [...document.querySelectorAll('#docSwitch button')].map(b2 => b2.textContent.trim());
        if (out.docTabs.length < 2)
          fail.push('with both a SOW and a change-order draft in hand the page offers ' + out.docTabs.length
            + ' way(s) to choose between them — one box, two documents, and no switch');
        if (!isCo())
          fail.push('drafting a change order did not put it in the document box');
        if (String(sowDraft || '').length !== sowLen)
          fail.push('drafting a change order changed the stored SOW — the two documents are sharing state, '
            + 'not just a container');
        setDocView('sow');
        out.backToSowWithoutRegenerating = !isCo() && box().length > 400;
        if (!out.backToSowWithoutRegenerating)
          fail.push('switching back to the SOW did not bring it back, so the only route to it is '
            + 'regenerating — an action that also re-rolls the contract baseline');
        setDocView('co');
        if (!isCo())
          fail.push('switching back to the change order did not bring it back');
      }

      /* ── 3i-c. THE SOW HAS A HISTORY AND THE ORIGINAL SURVIVES ──────────
         It was one mutable string: generating overwrote it, editing overwrote
         it, and the version a client was sent existed nowhere afterwards. */
      {
        const original = String(sowDraft || '');
        out.sowVersionsAfterGenerate = sowVersions.length;
        if (!sowVersions.length)
          fail.push('generating the SOW kept no version of it, so the document a client was sent is gone the '
            + 'moment the next one is generated');
        sowDraft = original + '<p>a hand edit</p>';
        sowPushVersion('edited by hand');
        await generateSOW();                       // the overwrite that used to be final
        out.editSurvivedRegeneration = sowVersions.some(v2 => /a hand edit/.test(v2.html));
        if (!out.editSurvivedRegeneration)
          fail.push('regenerating the SOW destroyed the edited version — the confirm() warns that edits will '
            + 'be replaced and then leaves them nowhere, which is a warning about data loss rather than a '
            + 'history');
        out.originalReachable = sowVersions.some(v2 => v2.html === original);
        if (!out.originalReachable)
          fail.push('the ORIGINAL generated SOW is no longer among the kept versions — "go back to the '
            + 'original" is the request this history exists for');
        const edited = sowVersions.find(v2 => /a hand edit/.test(v2.html));
        if (edited) {
          sowRestoreVersion(edited.n);
          out.restored = /a hand edit/.test(String(sowDraft || ''));
          if (!out.restored) fail.push('restoring a SOW version did not put it back');
          out.currentStillKept = sowVersions.length >= 3;
          if (!out.currentStillKept)
            fail.push('restoring did not keep the draft it replaced, so a restore cannot be undone');
        }
        // the cap must never drop the first
        const firstHtml = sowVersions[0].html;
        for (let i = 0; i < SOW_VERSION_CAP + 8; i++) { sowDraft = 'filler ' + i; sowPushVersion('filler'); }
        out.cappedAt = sowVersions.length;
        out.firstSurvivedTrim = sowVersions[0].html === firstHtml;
        if (sowVersions.length > SOW_VERSION_CAP)
          fail.push('the SOW history grew past its own cap (' + sowVersions.length + ')');
        if (!out.firstSurvivedTrim)
          fail.push('trimming the SOW history dropped the FIRST version — the one version that must survive '
            + 'any trim is the original, because that is what the history is for');
      }

      /* ── 3h. A VERSION CAN BE OPENED, AND GONE BACK TO ────────────────
         The chain could diff any two and reverse a change order, and could not
         show you one — so "the plan as we agreed it" was answerable only by
         reading a diff and doing the arithmetic yourself.

         The assertion that matters most here is NOT that the restore works. It
         is that it leaves the actuals alone. A version stores what was
         promised; progress, actual dates, logged effort and anything invoiced
         are what HAPPENED, and a restore that quietly deletes them destroys the
         record of work people did in order to tidy up a plan. That is the one
         failure in this feature that would be unrecoverable, so it is the one
         asserted first. */
      {
        const vv = pushVersion('sow', 'restore-probe');
        const w3 = leafTasks().filter(t2 => !t2.milestone && (t2.te || 0) > 0);
        const vic = w3[0], wasM3 = vic.m, wasOwner3 = w3[1].owner;
        vic.m = (Number(wasM3) || 1) * 3; w3[1].owner = (w3[1].owner === 'QA' ? 'PMO' : 'QA');
        // real progress that must survive
        vic.percentComplete = 40; vic.actualStart = '2026-08-01';
        vic.actualEffort = 2.5; vic.invoiced = 900;
        const newId = Math.max(nextId, ...tasks.map(t2 => t2.id)) + 1;
        nextId = newId + 1;
        tasks.push(makeTask({ id: newId, name: 'Added after the probe version', o: 1, m: 2, p: 3,
          parentId: vic.parentId, predecessors: [], owner: 'QA', units: 100 }));
        /* And something that DEPENDS on it, on a SUMMARY. A leaf's links are
           overwritten from the snapshot during the restore, so a dangling one
           can never survive there and a check that puts it on a leaf exercises
           nothing — which is how the pruning mutant survived the first attempt.
           A summary is not in the snapshot at all (it stores leaves), so its
           links are never restored and are the only place a pointer to a
           deleted activity can outlive the restore. */
        const summary = tasks.find(t2 => t2.isSummary && t2.id !== vic.parentId);
        if (summary) summary.predecessors = (summary.predecessors || [])
          .concat([{ id: newId, type: 'FS', lag: 0 }]);
        else fail.push('this plan has no summary to hang a link on, so the dangling-link prune was not tested');
        calculate();
        const nBefore = leafTasks().length;

        /* renderBaseline FIRST, then open the version. The panel is built two
           ways — inline while the tab renders, and by paintVersionCompare when a
           picker moves — and rendering after opening rebuilt it through the
           inline path, so a mutant that removed the view from the REPAINT path
           survived. The order here is the one a person produces: the tab is
           already up when they click open. */
        switchTab('baseline'); renderBaseline();
        versionView(vv.v);
        const vh = document.getElementById('versionCompareBl');
        out.viewRows = vh ? vh.querySelectorAll('.vc-view tbody tr').length : 0;
        if (!out.viewRows)
          fail.push('opening a version drew no activities — the chain can still only be diffed, not read');
        if (vh && !/COMMITTED, not as it ran/.test(vh.textContent || ''))
          fail.push('the as-of view does not say that a version holds what was promised rather than what '
            + 'happened, so a reader will look for dates and actuals that are deliberately not in it');
        versionView(vv.v);
        if (vh && vh.querySelectorAll('.vc-view').length)
          fail.push('the as-of view cannot be closed again');

        versionRestore(vv.v);
        const back = tasks.find(t2 => t2.id === vic.id);
        out.restoredEstimate = Math.abs((back.m || 0) - wasM3) < 1e-9;
        out.restoredOwner = tasks.find(t2 => t2.id === w3[1].id).owner === wasOwner3;
        out.removedAdded = !tasks.some(t2 => t2.name === 'Added after the probe version');
        out.actualsKept = { pct: back.percentComplete, start: back.actualStart,
                            eff: back.actualEffort, inv: back.invoiced };
        if (!out.restoredEstimate)
          fail.push('restoring a version left the estimate at ' + back.m + ' against the ' + wasM3
            + ' the version recorded');
        if (!out.restoredOwner) fail.push('restoring a version did not put the owner back');
        if (!out.removedAdded)
          fail.push('an activity added after the version survived a restore to it, so "go back to what we '
            + 'agreed" leaves scope nobody agreed in the plan');
        if (nBefore <= leafTasks().length)
          fail.push('the restore removed nothing at all');
        /* THE UNRECOVERABLE ONE. */
        if (back.percentComplete !== 40 || back.actualStart !== '2026-08-01'
            || back.actualEffort !== 2.5 || back.invoiced !== 900)
          fail.push('restoring a version destroyed the ACTUALS on an activity — progress ' + back.percentComplete
            + ', actual start "' + back.actualStart + '", effort ' + back.actualEffort + ', invoiced '
            + back.invoiced + '. A version is what was promised; deleting what happened in order to tidy up a '
            + 'plan is the one failure here nobody can undo');
        const last = planVersions[planVersions.length - 1];
        out.safetyVersion = last && last.label;
        if (!last || !/before restoring/i.test(last.label || ''))
          fail.push('the plan as it stood was not saved as a version before being overwritten, so a restore '
            + 'cannot itself be undone');
        // and no dangling links survive, or the schedule will not compute
        const liveIds = new Set(tasks.map(t2 => t2.id));
        const dangling = tasks.reduce((n2, t2) =>
          n2 + (t2.predecessors || []).filter(pr => !liveIds.has(pr.id)).length, 0);
        if (summary && !tasks.some(t2 => t2.id === summary.id))
          fail.push('the summary the probe hung a link on was itself deleted, so nothing below tested pruning');
        out.danglingAfterRestore = dangling;
        if (dangling)
          fail.push(dangling + ' predecessor(s) point at activities the restore deleted — a dangling link is '
            + 'a schedule that will not compute');
      }

      /* ── 3i. RESTORE PUTS THE CRITERIA BACK, NOT ONLY THE ACTIVITIES ────
         The contradiction this closes: the tool raises a finding when a
         criterion is reworded after somebody signed for it, and for one session
         could not undo it. Detecting a problem you refuse to fix is worse than
         not detecting it, because the reader assumes there is a way through.
         The assertion is that the DRIFT CLEARS — not that some text matches —
         because drift is the thing the finding is about. */
      {
        const vc = pushVersion('sow', 'criteria-probe');
        const soC = recordSignoff('story', ((reqs && reqs.stories) || [])[0].id, 'Client', '');
        const sc = ((reqs && reqs.stories) || [])[0];
        const wasText = sc.ac[0].text, wasN = (sc.ac || []).length;
        sc.ac[0].text = String(wasText) + ' AND exports to PDF';
        sc.ac.push({ id: 'AC-PROBE.9', text: 'added after the contract', type: 'happy' });
        out.driftBeforeRestore = signoffDrift().length;
        if (!out.driftBeforeRestore)
          fail.push('rewording a signed criterion raised no drift, so nothing below tested the repair');
        versionRestore(vc.v);
        const back = ((reqs && reqs.stories) || []).find(x => String(x.id) === String(sc.id));
        out.driftAfterRestore = signoffDrift().length;
        out.acTextBack = back && back.ac[0].text === wasText;
        out.acCountBack = back && (back.ac || []).length === wasN;
        if (out.driftAfterRestore)
          fail.push('restoring the version the sign-off was taken against left ' + out.driftAfterRestore
            + ' criteri(on) still drifted — the plan went back and the wording did not, so the tool raises a '
            + 'finding it cannot act on');
        if (!out.acTextBack) fail.push('a reworded acceptance criterion was not restored to its agreed wording');
        if (!out.acCountBack)
          fail.push('a criterion added after the version survived a restore to it, so the agreed set is not '
            + 'what comes back');
      }

      /* ── 3j. THE HISTORY IS BOUNDED, AND NOTHING LOAD-BEARING IS DROPPED ─
         A version is a full copy of the plan — measured at 23 KB against a plan
         of 388 KB — and one is taken on every commitment. Unbounded, that is a
         save that quietly stops working, which is the failure shape this
         codebase refuses everywhere else. But a cap that drops the wrong thing
         is worse than none: a change order or a sign-off pointing at a version
         that is not in the file breaks the comparison AND the drift check, and
         both would fail silently. */
      {
        const beforeN = planVersions.length;
        for (let i = 0; i < VERSION_CAP + 20; i++) setBaseline();
        out.versionsAfterFlood = planVersions.length;
        out.versionCap = VERSION_CAP;
        if (planVersions.length > VERSION_CAP + 5)
          fail.push('after ' + (VERSION_CAP + 20) + ' commitments the chain holds '
            + planVersions.length + ' versions against a cap of ' + VERSION_CAP
            + ' — each one is a full copy of the plan, so this grows the file without bound');
        const dangling = (coLog || []).filter(c => (c.fromV && !versionByNo(c.fromV))
                                               || (c.toV && !versionByNo(c.toV))).length
          + (signoffs || []).filter(so2 => so2.v && !versionByNo(so2.v)).length;
        out.danglingPointers = dangling;
        if (dangling)
          fail.push(dangling + ' change order(s) or sign-off(s) point at a version the trim dropped — the '
            + 'comparison and the drift check both go silently blind, which is worse than a bigger file');
        if (!planVersions.some(v2 => v2.kind === 'sow'))
          fail.push('the contract baseline was trimmed out of the history');
        if (!planVersions.some(v2 => v2.kind === 'signoff'))
          fail.push('a version a sign-off was taken against was trimmed out of the history');
        out.trimmedCount = planVersions[0] && planVersions[0].trimmed;
        if (beforeN + VERSION_CAP + 20 > planVersions.length && !out.trimmedCount)
          fail.push('versions were dropped and nothing records how many, so the gaps in the numbering are '
            + 'unexplained and the history reads as if it were complete');
        // and the commitment history must not offer a button into a trimmed one
        switchTab('baseline'); renderBaseline();
        const blh = document.getElementById('view-baseline');
        const dead = [...blh.querySelectorAll('button')]
          .filter(b2 => /what moved/i.test(b2.textContent || ''))
          .filter(b2 => { const m2 = (b2.getAttribute('onclick') || '').match(/compareFromVersion\((\d+)/);
                          return m2 && !versionByNo(Number(m2[1])); }).length;
        out.deadCompareButtons = dead;
        if (dead)
          fail.push(dead + ' commitment row(s) offer to show what moved since a version that has been '
            + 'trimmed — a dead control reads as a broken comparison rather than as a bounded history');
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

      /* ── 5. A CLIENT SIGNS A PHASE, NOT FOURTEEN STORIES ────────────────
         The record held one story or the whole engagement, and neither is the
         unit anybody accepts: a SOW is written in deliverables, an invoice
         follows them, and expressing "Design is done" as fourteen story
         sign-offs is fourteen records of something else.

         Four properties, and the last is the one a naive implementation
         misses. A phase sign-off has to notice a story RE-TRACED OUT of it —
         the drift loop walks what is in the plan now, so a story that left the
         signed phase simply stops being visited and takes its criteria out of
         the signed set in silence. That is the easiest way to quietly shrink
         what was accepted, which makes it worth its own assertion. */
      s0.ac[0].text = String(s0.ac[0].text || '').replace(' AND exports to PDF', '');
      signoffs.length = 0;
      const phase = tasks.filter(t => tasks.some(x => x.parentId === t.id))
        .map(t => ({ t: t, n: ((reqs && reqs.stories) || []).filter(s2 => {
          const ids = new Set([t.id].concat(allDescendants(t.id).map(x => x.id)));
          return storyWbsIds(s2).some(id => ids.has(id));
        }).length }))
        .filter(x => x.n > 0).sort((a2, b2) => b2.n - a2.n)[0];
      if (!phase) { out.wbsSignoff = 'SKIPPED-no-phase-carries-a-story'; }
      else {
        const soW = recordSignoff('wbs', String(phase.t.id), 'Client sponsor', 'phase gate');
        out.wbsSignoff = { phase: phase.t.name, stories: phase.n, v: soW.v };
        if (soW.scope !== 'wbs')
          fail.push('a sign-off recorded against a WBS element came back as scope "' + soW.scope
            + '" — the level a client actually signs is not being stored as itself');
        const lbl = signoffRefLabel('wbs', soW.ref);
        out.wbsLabel = lbl;
        if (!lbl || /^\d+$/.test(lbl) || /no longer in the plan/.test(lbl))
          fail.push('the sign-off record renders as "' + lbl + '" — an id on a printed acceptance record '
            + 'is not a record of anything');
        const cov = signoffCoverage(soW);
        out.wbsCoverage = cov;
        if (!cov.stories)
          fail.push('a phase carrying ' + phase.n + ' traced stories rolled up to ZERO stories at sign-off, '
            + 'so the record covers nothing it claims to');
        if (signoffDrift().length)
          fail.push('a phase sign-off reported drift the instant it was taken');
        // reword INSIDE the phase → drift
        const inside = ((reqs && reqs.stories) || []).find(s2 => {
          const ids = new Set([phase.t.id].concat(allDescendants(phase.t.id).map(x => x.id)));
          return storyWbsIds(s2).some(id => ids.has(id)) && (s2.ac || []).length;
        });
        if (inside) {
          const was = inside.ac[0].text;
          inside.ac[0].text = String(was) + ' AND a second thing';
          out.wbsDriftOnReword = signoffDrift().length;
          if (!out.wbsDriftOnReword)
            fail.push('a criterion inside a signed PHASE was reworded and nothing noticed — the phase sign-off '
              + 'is recording a name and a date and measuring nothing');
          inside.ac[0].text = was;
          // and re-trace it OUT of the phase
          const links = storyWbsIds(inside).slice();
          setStoryLinks(inside, []);
          const outDrift = signoffDrift();
          out.wbsDriftOnRetrace = outDrift.map(d2 => d2.kind);
          if (!outDrift.some(d2 => /moved out|deleted/.test(d2.kind)))
            fail.push('a story was re-traced OUT of a signed phase and the sign-off did not notice — its '
              + 'criteria left the accepted set silently, which is the quietest way to shrink what a client '
              + 'agreed to');
          setStoryLinks(inside, links);
        }
        // a PROJECT sign-off must never report a move-out: nothing can leave it
        signoffs.length = 0;
        recordSignoff('project', '', 'Client', '');
        const pd = signoffDrift().filter(d2 => /moved out/.test(d2.kind)).length;
        if (pd)
          fail.push('a whole-engagement sign-off reported ' + pd + ' stories as having moved out of its '
            + 'scope — there is nowhere outside it for anything to move to');
      }
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
