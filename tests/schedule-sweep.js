/* ═══════════════════════════════════════════════════════════════════════════
   THE DATE YOU COMMIT TO.

   Everything swept so far is the REPORTING half — what happened. This is the
   planning half: the network that produces the date somebody signs against.
   A wrong figure here does not cost an argument in a status meeting, it costs
   the commitment itself.

   Every identity below is recomputed from the stored fields — O/M/P, the
   dependency list, the working calendar — rather than read back off the task
   objects, because a forward pass checked against its own output agrees by
   construction. Where the app and the recompute disagree, the recompute is
   only evidence; where the app disagrees with ITSELF, that is the finding.
   ═══════════════════════════════════════════════════════════════════════════ */
const { requirePlaywright, chromePath, APP, FIXTURE } = require('./_harness');
const { chromium } = requirePlaywright();
const DATA = FIXTURE();

(async () => {
  const b = await chromium.launch({headless:true,args:['--no-sandbox'],executablePath: chromePath()});
  const page = await b.newPage({viewport:{width:1440,height:1200}});
  page.on('dialog', d => d.accept());
  const errs=[]; page.on('pageerror', e=>errs.push(e.message));
  await page.goto(APP,{waitUntil:'load'});
  await page.evaluate(data => { window.__fixture = data; hydrate(data); calculate(); }, DATA);
  await page.waitForTimeout(900);

  const R = await page.evaluate(() => {
    const bad = [];
    const say = (a, b2) => bad.push(a + ' :: ' + b2);
    const near = (x, y, tol) => Math.abs(x - y) <= (tol == null ? 1e-6 : tol);
    /* Entities must be DECODED, not just stripped of tags. Four of this plan's
       twelve critical activities have "&" in their names ("Kick-off & Discovery",
       "Go-Live & Hypercare", …), which the DOM serialises as &amp; — so a naive
       strip reported the panel listing 8 of 12 and blamed the panel. */
    const strip = h => { const d = document.createElement('div');
      d.innerHTML = String(h || '').replace(/<[^>]+>/g, ' ');
      return (d.textContent || '').replace(/\s+/g, ' '); };
    const leaves = () => leafTasks().filter(t => !t.isSummary);

    // ═══ 1. TE IS THE PERT FORMULA, ON EVERY WORK PACKAGE ══════════════════
    leaves().forEach(t => {
      if (t.milestone) {
        if (!near(t.te || 0, 0, 1e-9))
          say(t.name, 'is a milestone with a duration of ' + t.te + ' — a checkpoint has no duration');
        return;
      }
      const o = Number(t.o) || 0, m = Number(t.m) || 0, p = Number(t.p) || 0;
      if (!(p > 0)) return;                       // no estimate is its own finding elsewhere
      const te = (o + 4 * m + p) / 6;
      if (!near(t.te, te, 1e-6))
        say(t.name, 'TE is ' + t.te + ' where (O + 4M + P) / 6 = ' + te.toFixed(4));
      if (o > m || m > p)
        say(t.name, 'has O ' + o + ', M ' + m + ', P ' + p + ' — the three points are out of order, and '
          + 'TE is only meaningful when O ≤ M ≤ P');
      // the variance the sensitivity ranking is built on
      const varr = Math.pow((p - o) / 6, 2);
      if (t.variance != null && !near(t.variance, varr, 1e-6))
        say(t.name, 'variance ' + t.variance + ' where ((P − O) / 6)² = ' + varr.toFixed(4));
    });

    // ═══ 2. THE NETWORK'S OWN IDENTITIES ═══════════════════════════════════
    leaves().forEach(t => {
      if (!near(t.ef - t.es, t.te, 1e-6))
        say(t.name, 'EF − ES = ' + (t.ef - t.es).toFixed(4) + ' against a duration of ' + t.te);
      if (!near(t.lf - t.ls, t.te, 1e-6))
        say(t.name, 'LF − LS = ' + (t.lf - t.ls).toFixed(4) + ' against a duration of ' + t.te);
      if (!near(t.slack, t.ls - t.es, 1e-6))
        say(t.name, 'slack ' + t.slack + ' is not LS − ES (' + (t.ls - t.es).toFixed(4) + ')');
      if (!near(t.slack, t.lf - t.ef, 1e-6))
        say(t.name, 'slack ' + t.slack + ' is not LF − EF (' + (t.lf - t.ef).toFixed(4) + ')');
      if (t.slack < -1e-6)
        say(t.name, 'has NEGATIVE slack (' + t.slack.toFixed(2) + ') — the network is over-constrained and '
          + 'the finish date it produces is not achievable');
      // critical means zero slack, in both directions
      const zero = Math.abs(t.slack) < 0.01;
      if (t.isCritical !== zero)
        say(t.name, 'is marked ' + (t.isCritical ? 'critical' : 'not critical') + ' with a slack of ' + t.slack);
    });

    // ═══ 3. EVERY DEPENDENCY IS ACTUALLY RESPECTED ═════════════════════════
    // FS with lag L means successor.ES ≥ predecessor.EF + L. If the forward pass
    // ever violates its own edges the date is fiction, and nothing else here
    // would notice.
    let edges = 0, violated = 0;
    leaves().forEach(t => {
      (t.predecessors || []).forEach(p => {
        const pid = (typeof p === 'object') ? p.id : p;
        const type = ((typeof p === 'object') ? p.type : 'FS') || 'FS';
        const lag = ((typeof p === 'object') ? (Number(p.lag) || 0) : 0);
        const pred = tasks.find(x => x.id === pid);
        if (!pred || pred.isSummary) return;
        edges++;
        let need;
        switch (type) {
          case 'SS': need = pred.es + lag; if (t.es < need - 1e-6) { violated++;
            say(t.name, 'starts at ' + t.es.toFixed(2) + ' on an SS link from "' + pred.name
              + '" that requires ' + need.toFixed(2)); } break;
          case 'FF': need = pred.ef + lag; if (t.ef < need - 1e-6) { violated++;
            say(t.name, 'finishes at ' + t.ef.toFixed(2) + ' on an FF link from "' + pred.name
              + '" that requires ' + need.toFixed(2)); } break;
          case 'SF': need = pred.es + lag; if (t.ef < need - 1e-6) { violated++;
            say(t.name, 'finishes at ' + t.ef.toFixed(2) + ' on an SF link from "' + pred.name
              + '" that requires ' + need.toFixed(2)); } break;
          default:   need = pred.ef + lag; if (t.es < need - 1e-6) { violated++;
            say(t.name, 'starts at ' + t.es.toFixed(2) + ' before its FS predecessor "' + pred.name
              + '" finishes at ' + need.toFixed(2)); }
        }
      });
    });

    /* ═══ 3b. AND THE THREE LINK TYPES NOBODY HAS EVER SCHEDULED ═══════════
       The block above holds four link types and, on every committed fixture,
       has only ever executed one. crm-rollout carries 26 dependencies and
       field-export 31, and all 57 of them are FS — so the SS, FF and SF
       branches were dead code inside a passing check, and the forward and
       backward passes could compute those three however they liked with the
       suite green. That is the same shape as the PERT weighting: a check that
       is correct and a fixture that cannot tell the difference.

       So the links are CONSTRUCTED here. One of each type, with a non-zero lag
       so an implementation that ignores lag is caught too, rewritten onto real
       activities in the loaded plan and rescheduled. The identities are the
       textbook ones and are asserted independently of how the app computes
       them: SS means the successor may not START before the predecessor starts
       (plus lag), FF that it may not FINISH before the predecessor finishes,
       SF that it may not FINISH before the predecessor starts.

       The coverage assertion at the end is the load-bearing half. Without it
       this whole block goes quietly vacuous the moment the rewiring stops
       taking — which is precisely the state it was written to end. */
    const linkCover = { built: {}, checked: {}, floors: {}, violations: [] };
    (() => {
      const saved = JSON.stringify(tasks.map(t => ({ id: t.id, predecessors: t.predecessors })));
      // pick leaves that already have a predecessor, so rewiring changes a TYPE
      // rather than inventing a dependency the plan does not have
      const wired = leaves().filter(t => (t.predecessors || []).length
        && (t.predecessors || []).some(p => {
          const pid = (typeof p === 'object') ? p.id : p;
          const pr = tasks.find(x => x.id === pid);
          return pr && !pr.isSummary && !pr.milestone;
        }) && !t.milestone);
      const types = ['SS', 'FF', 'SF'];
      if (wired.length < types.length) {
        say('Link types', 'the fixture has only ' + wired.length + ' rewireable dependency(ies), so the '
          + 'SS/FF/SF branches cannot be exercised — this check is vacuous and must not be trusted');
        return;
      }
      types.forEach((ty, i) => {
        const t = wired[i];
        const first = (t.predecessors || [])[0];
        const pid = (typeof first === 'object') ? first.id : first;
        t.predecessors = [{ id: pid, type: ty, lag: 2 }];
        linkCover.built[ty] = t.name;
      });
      if (!recompute()) { say('Link types', 'the plan will not schedule with SS/FF/SF links present'); }
      else {
        types.forEach(ty => {
          const t = leaves().find(x => (x.predecessors || []).some(p => p && p.type === ty));
          if (!t) { say('Link types', 'the ' + ty + ' link did not survive the reschedule, so nothing was tested'); return; }
          const p = (t.predecessors || []).find(q => q && q.type === ty);
          const pred = tasks.find(x => x.id === p.id);
          if (!pred) { say('Link types', 'the ' + ty + ' predecessor vanished'); return; }
          linkCover.checked[ty] = t.name + ' ← ' + pred.name;
          const lag = Number(p.lag) || 0;
          let need, got, what;
          if (ty === 'SS') { need = pred.es + lag; got = t.es; what = 'start'; }
          else if (ty === 'FF') { need = pred.ef + lag; got = t.ef; what = 'finish'; }
          else { need = pred.es + lag; got = t.ef; what = 'finish'; }
          /* EQUALITY, not a lower bound. The first version of this asked only
             that the successor start no EARLIER than the constraint, and an SS
             link scheduled as though it were FS passed it — treating SS as FS
             puts the successor LATER, which satisfies a one-sided test
             perfectly. A dependency type that is silently stricter than it says
             pushes out the committed date, and the reader sees a plan that is
             merely pessimistic rather than wrong.
             The rewiring above left exactly ONE predecessor and this is the only
             floor, so the link is the binding constraint and the pass has no
             licence to place the activity anywhere else. The two other floors
             the forward pass honours are excluded explicitly rather than
             assumed away. */
          /* THREE floors, not one. The forward pass honours a levelling delay,
             a start pin, and — the one this check first forgot — the project
             start itself: `if (start < 0) start = 0`. An SF link whose lag puts
             the required START before day zero is therefore NOT the binding
             constraint, and the first version of this reported the shipped
             build for it (Solution Design, required finish 4.00, actual 6.33,
             because its required start was −2.33 and got clamped). The check was
             wrong, not the app. Where the clamp binds, the assertion that still
             holds is the one-sided one plus the clamp itself. */
          const reqStart = (ty === 'SS') ? need : need - (t.te || 0);
          const otherFloor = (t.levelDelay || 0) > 0 || t.startNoEarlier;
          const clamped = reqStart < -1e-6;
          linkCover.floors[ty] = otherFloor ? 'levelling/pin' : clamped ? 'project start' : 'the link';
          if (otherFloor) {
            say('Link types', t.name + ' carries a levelling delay or a start pin, so the ' + ty
              + ' link is not the binding constraint and this case proves nothing — pick another activity');
          } else if (clamped) {
            if (Math.abs(t.es) > 1e-6)
              say(t.name, 'has a ' + ty + ' link requiring a start of ' + reqStart.toFixed(2)
                + ', which is before the project begins, so it must be clamped to 0 — it starts at '
                + t.es.toFixed(2));
            if (got < need - 1e-6)
              say(t.name, 'has a ' + ty + ' link from "' + pred.name + '" requiring it to ' + what
                + ' no earlier than ' + need.toFixed(2) + ' — it ' + what + 'es at ' + got.toFixed(2));
          } else if (Math.abs(got - need) > 1e-6) {
            linkCover.violations.push(ty);
            say(t.name, 'has a ' + ty + ' link from "' + pred.name + '" with a lag of ' + lag
              + ' as its ONLY constraint, so it must ' + what + ' at exactly ' + need.toFixed(2)
              + ' — it ' + what + 'es at ' + got.toFixed(2)
              + (got > need ? ' (later than the link requires: the type is stricter than it says, and the '
                  + 'committed date is pushed out for a reason nothing on the screen gives)'
                : ' (earlier than the link requires: the dependency is not being honoured at all)'));
          }
          /* and the LAG has to be read. With lag dropped the constraint sits
             `lag` units earlier, and that is a different number from the one
             asserted above — so this is already covered by the equality. Kept as
             an explicit note so nobody re-adds a weaker lag test believing it
             was missing. */
        });
      }
      // put the plan back before anything downstream reads it
      const orig = JSON.parse(saved);
      orig.forEach(o => { const t = tasks.find(x => x.id === o.id); if (t) t.predecessors = o.predecessors; });
      recompute();
      /* The equality only runs where the LINK is the binding floor, so a run in
         which every constructed link is clamped to the project start would
         report three ticks having tested nothing stricter than "not negative".
         At least one has to be genuinely link-bound, and it is named in the
         output so a reader can see which. */
      const bound = types.filter(ty => linkCover.floors[ty] === 'the link');
      linkCover.linkBound = bound;
      if (!bound.length)
        say('Link types', 'every constructed link was clamped by the project start, so the equality that '
          + 'catches a type scheduled as a STRICTER type never ran — this check is one-sided again');
      const missing = types.filter(ty => !linkCover.checked[ty]);
      if (missing.length)
        say('Link types', missing.join('/') + ' were never actually scheduled, so those branches of this '
          + 'check proved nothing — the same vacuum they were in before this block existed');
    })();

    // ═══ 4. THE CRITICAL PATH IS A CHAIN, NOT A SET ════════════════════════
    /* A critical "path" that is really a disconnected set of zero-slack
       activities is the classic CPM presentation bug: it reads as a sequence,
       and a reader traces it expecting each to feed the next. */
    const crit = leaves().filter(t => t.isCritical && !t.milestone).sort((a, b) => a.es - b.es);
    let broken = 0;
    for (let i = 1; i < crit.length; i++) {
      const prev = crit[i - 1], cur = crit[i];
      // the chain is continuous if cur starts no later than prev finishes
      if (cur.es > prev.ef + 1e-6) { broken++; }
    }
    /* A PLAN WITH WORK HAS A CRITICAL PATH. Both assertions below are gated on
       `crit.length &&`, so a build where NOTHING comes back critical satisfies
       them by having nothing to check — a clean report and an empty one read
       identically.

       Said plainly about its own worth: a mutant that marks nothing critical is
       caught by the per-activity assertion above ("zero slack and not marked
       critical"), not by this. So this line closes no hole that is currently
       open; it makes the GATE explicit, so the day the per-activity assertion
       is loosened this does not silently become the last thing standing. It is
       exactly the kind of assertion the coverage probe will list as never
       having fired, and that listing will be correct. */
    if (leaves().some(t => !t.milestone && (t.te || 0) > 0) && !crit.length)
      say('Critical path', 'not one activity came back critical on a plan that has estimated work — every '
        + 'assertion about the path below is gated on there being one, so a build that marks nothing '
        + 'critical passes them all by having nothing to look at');
    if (crit.length && broken)
      say('Critical path', broken + ' gap' + (broken === 1 ? '' : 's') + ' in the chain of '
        + crit.length + ' zero-slack activities — it is presented as a path and is not continuous');
    const projEf = Math.max(0, ...leaves().map(t => t.ef), 0);
    if (crit.length && !near(Math.max(...crit.map(t => t.ef)), projEf, 1e-6))
      say('Critical path', 'ends at ' + Math.max(...crit.map(t => t.ef)).toFixed(2)
        + ' while the project ends at ' + projEf.toFixed(2) + ' — the path does not reach the finish');

    // ═══ 5. THE DATE IS THE DURATION, ON WORKING DAYS ══════════════════════
    const rv = computeReserves();
    if (!near(rv.cpmUnits, projEf, 1e-6))
      say('Reserves', 'CPM duration ' + rv.cpmUnits + ' against a network finish of ' + projEf.toFixed(4));
    if (rv.committedUnits < rv.cpmUnits - 1e-6)
      say('Reserves', 'the committed date is EARLIER than the raw CPM finish — contingency cannot be negative');
    if (rv.totalUnits < rv.committedUnits - 1e-6)
      say('Reserves', 'the total date is earlier than the committed date — management reserve cannot be negative');
    // and the three dates must be ordered the same way as the three durations
    const ord = (a, b2) => (a && b2) ? (a.getTime() <= b2.getTime()) : true;
    if (!ord(rv.cpmDate, rv.committedDate) || !ord(rv.committedDate, rv.totalDate))
      say('Reserves', 'the CPM, committed and total DATES are not in the same order as their durations');
    // every scheduled date must land on a working day
    const hol = getHolidaySet();
    let nonWorking = 0;
    leaves().forEach(t => {
      if (t.milestone || !t.startDate || !t.finishDate) return;
      if (!isWorkingDay(t.startDate, hol)) { nonWorking++;
        say(t.name, 'starts on ' + fmtISO(t.startDate) + ', which is not a working day'); }
    });

    // ═══ 6. MONTE CARLO ════════════════════════════════════════════════════
    runMonteCarlo();
    const mc = mcResult;
    const mcOut = {};
    if (mc) {
      mcOut.iters = mc.iters;
      // percentiles must be monotonic — a P80 below a P50 is a sorting bug
      if (!(mc.p50 <= mc.p80 + 1e-9 && mc.p80 <= mc.p90 + 1e-9 && mc.p90 <= mc.p95 + 1e-9))
        say('Monte Carlo', 'percentiles are not monotonic: P50 ' + mc.p50.toFixed(2) + ', P80 '
          + mc.p80.toFixed(2) + ', P90 ' + mc.p90.toFixed(2) + ', P95 ' + mc.p95.toFixed(2));
      if (mc.min > mc.p50 + 1e-9 || mc.max < mc.p95 - 1e-9)
        say('Monte Carlo', 'the min/max do not bracket the percentiles');
      /* Beta-PERT with lambda = 4 has E[duration] = (O + 4M + P) / 6 = te exactly,
         so the MEAN of the simulated project durations must land on the
         deterministic CPM finish. A gap is not sampling noise — it is proof the
         sampler and the forward pass disagree about the same network. */
      const drift = Math.abs(mc.mean - projEf) / Math.max(1e-9, projEf);
      mcOut.mean = +mc.mean.toFixed(3); mcOut.deterministic = +projEf.toFixed(3);
      mcOut.driftPct = +(drift * 100).toFixed(2);
      if (drift > 0.03)
        say('Monte Carlo', 'the mean simulated duration is ' + mc.mean.toFixed(2)
          + ' against a deterministic CPM finish of ' + projEf.toFixed(2) + ' (' + (drift * 100).toFixed(1)
          + '% apart) — Beta-PERT with lambda 4 has a mean of exactly TE, so these must agree');
      // criticality is a probability
      const badCrit = leaves().filter(t => t.criticality < -1e-9 || t.criticality > 1 + 1e-9);
      badCrit.forEach(t => say(t.name, 'criticality is ' + t.criticality + ', which is not a probability'));
      // anything critical in the deterministic pass should be critical often
      const detCritNeverSimulated = leaves().filter(t => t.isCritical && !t.milestone && (t.criticality || 0) === 0);
      if (detCritNeverSimulated.length)
        say('Monte Carlo', detCritNeverSimulated.length + ' activit' + (detCritNeverSimulated.length === 1 ? 'y is' : 'ies are')
          + ' on the deterministic critical path and critical in ZERO of ' + mc.iters
          + ' simulations: ' + detCritNeverSimulated.slice(0, 3).map(t => t.name).join('; '));
      /* DURATION SPACE IS NOT DATE SPACE. A P80 duration maps onto a working
         calendar, so the confidence attached to the DATE is not the confidence
         attached to the duration. The panel has to lead with one of them and say
         which — quoting a date and a percentage that were computed in different
         spaces is how a commitment gets made at the wrong confidence. */
      const p80Date = durationToDate(mc.p80);
      mcOut.p80 = +mc.p80.toFixed(2);
      mcOut.p80Date = p80Date ? fmtISO(p80Date) : null;
      const atOrBefore = mc.durations.filter(d => {
        const dt = durationToDate(d); return dt && p80Date && dt.getTime() <= p80Date.getTime(); }).length;
      mcOut.dateSpaceConfidence = +(atOrBefore / mc.durations.length * 100).toFixed(1);
      mcOut.durationSpaceConfidence = 80;
      /* The app must agree with an independent count of the same thing, and no
         sentence may assert the NOMINAL percentile against a DATE — that is the
         duration-space number wearing date-space clothes. */
      const appSays = dateConfidencePct(mc.p80);
      if (appSays == null) say('Monte Carlo', 'dateConfidencePct returns nothing with a simulation loaded');
      else if (Math.abs(appSays - mcOut.dateSpaceConfidence) > 0.2)
        say('Monte Carlo', 'dateConfidencePct says ' + appSays.toFixed(1) + '% for the P80 date; an '
          + 'independent count says ' + mcOut.dateSpaceConfidence + '%');
      // sizing from P80 must then report what the committed date is worth
      setContingencyFromP80();
      const cc = committedDateConfidence();
      mcOut.committedConfidence = cc == null ? null : +cc.toFixed(1);
      if (cc == null) say('Reserves', 'the committed date carries no computable confidence after sizing from P80');
      else if (cc < 79.9)
        say('Reserves', 'sizing contingency from P80 produced a committed date carrying only '
          + cc.toFixed(1) + '% — less than the percentile it was cut from');
    }

    // ═══ 7. WHAT THE PANEL SAYS ABOUT ALL OF IT ════════════════════════════
    switchTab('analytics'); renderAnalytics();
    const host = document.getElementById('view-analytics');
    const txt = host ? strip(host.innerHTML) : '';
    if (/NaN|Infinity|undefined/.test(txt)) say('Analytics tab', 'prints a broken figure');
    // the deterministic finish it prints must be the one the network produced
    const shownDur = txt.match(/Deterministic \(CPM\) duration:\s*([\d.]+)/);
    if (shownDur && !near(+shownDur[1], projEf, 0.05))
      say('Analytics tab', 'prints a CPM duration of ' + shownDur[1] + ' against a network finish of '
        + projEf.toFixed(2));
    /* NO SENTENCE MAY PROMISE THE NOMINAL PERCENTILE FOR A DATE. A P80 duration
       maps onto a whole working day, so the date it produces carries more than
       80% — conservative, but still the wrong number attached to the thing the
       reader commits to. */
    const overclaims = (txt.match(/committed date[^.]{0,80}?80% confidence|date[^.]{0,40}?carries 80% confidence/gi) || []);
    overclaims.forEach(q => say('Analytics tab', 'promises a date "' + q.trim().slice(0, 70)
      + '" — the percentile was computed in duration space and the date carries more'));
    // and the critical path it lists must be the zero-slack set
    const namesShown = crit.filter(t => txt.indexOf(t.name) >= 0).length;
    if (crit.length && namesShown < crit.length)
      say('Analytics tab', 'lists ' + namesShown + ' of the ' + crit.length + ' zero-slack activities in the critical path');

    hydrate(JSON.parse(JSON.stringify(window.__fixture))); calculate();

    return { contradictions: bad, linkTypes: linkCover,
             counts: { leaves: leaves().length, edges, violated, critical: crit.length, nonWorking },
             projectFinish: +projEf.toFixed(3),
             reserves: { cpm: +rv.cpmUnits.toFixed(2), committed: +rv.committedUnits.toFixed(2),
                         total: +rv.totalUnits.toFixed(2) },
             mc: mcOut };
  });

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
