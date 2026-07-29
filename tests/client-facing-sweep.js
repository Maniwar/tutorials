/* ═══════════════════════════════════════════════════════════════════════════
   WHAT LEAVES THE BUILDING.

   The other two sweeps check screens. This one checks the artefacts that go to
   a CLIENT — the status report, the SOW draft, the exports — because a number
   that is wrong on a screen costs an argument and the same number wrong in a
   status report costs money. It also checks that client-safe mode actually
   withholds what it claims to.

   Runs against fixtures/crm-rollout.json.
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
  await page.evaluate(data => { hydrate(data); calculate(); }, DATA);
  await page.waitForTimeout(700);

  const R = await page.evaluate(() => {
    const bad = [];
    const say = (a, b2) => bad.push(a + ' :: ' + b2);
    const hb = hasBaseline();
    const today = stripTime(new Date()).getTime();
    const strip = h => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    const nums = s => (String(s).match(/\$[\d,]+(?:\.\d+)?/g) || []).map(x => +x.replace(/[$,]/g, ''));

    // the same single source of truth the panel uses
    const AC = leafTasks().reduce((s, t) => s + actualCostOf(t), 0);
    const PV = accrualAt(pvSpread(hb, leafTasks()).segs, today);
    const EV = earnedValue();
    const BAC = budgetAtCompletion(hb);
    const bv = budgetVerdict(AC, PV, EV, BAC);

    // ═══ 1. THE STATUS REPORT ═══════════════════════════════════════════════
    clientSafeReports = false;
    const rep = strip(buildStatusReportHtml());

    // a) does it report what has actually been SPENT? EV without AC is half a story
    const saysEarned = /earned value to date/i.test(rep);
    const saysBooked = /booked|actual cost|spent to date/i.test(rep);
    if (saysEarned && !saysBooked)
      say('Status report', 'reports earned value to date but never what has actually been booked ('
        + fmtMoney(AC) + ') — a client reading it cannot see the spend');

    // b) whatever it calls "planned", it must be the envelope the panel measures against
    const m = rep.match(/planned \$([\d,]+)/i);
    if (m) {
      const claimed = +m[1].replace(/,/g, '');
      if (Math.abs(claimed - BAC) > 2)
        say('Status report', 'says planned ' + fmtMoney(claimed) + ' while the Plan-truth panel measures against '
          + fmtMoney(BAC) + (hb ? ' (the baselined envelope)' : '') + ' — two references, one project');
    }

    // c) its baseline variance must agree with the Plan-truth schedule bar
    const pt = planTruthData();
    const sch = pt.rows.find(r => r.key === 'sched');
    const repVar = rep.match(/variance ([+-]?\d+)d (late|early)/i);
    const barVar = String(sch.delta || '').match(/([+-]?\d+)\s*(?:calendar )?d(?:ays)? (late|early)/i);
    if (repVar && barVar) {
      const a = +repVar[1] * (/late/i.test(repVar[2]) ? 1 : -1);
      const b2 = +barVar[1] * (/late/i.test(barVar[2]) ? 1 : -1);
      if (a !== b2) say('Status report', 'says the baseline variance is ' + repVar[0]
        + ' while the Plan-truth bar says ' + sch.delta);
    }
    if (repVar && /end date held|on the baseline/.test(String(sch.delta)) && +repVar[1] !== 0)
      say('Status report', 'reports ' + repVar[0] + ' while the Plan-truth bar says the end date held');
    /* A HELD END DATE IS NOT A STILL PLAN — in the document that gets forwarded.
       The report said "variance on plan" while four activities sat 81
       activity-days off their own baselines, because both ends of its comparison
       are a max over the whole plan. Where the bar counts displacement the report
       must not be silent about it. */
    const barMovedN = (String(sch.delta).match(/(\d+)\s+off/) || [])[1];
    if (barMovedN) {
      const repN = (rep.match(/(\d+)\s+activit(?:y|ies)\s+(?:is|are)\s+off/) || [])[1];
      if (!repN) say('Status report', 'says "' + (rep.match(/variance [^•]{0,30}/i) || [''])[0].trim()
        + '" while the Plan-truth bar reports ' + barMovedN + ' activities off their own dates');
      else if (repN !== barMovedN)
        say('Status report', 'counts ' + repN + ' activities off their own dates; the bar counts ' + barMovedN);
    }
    // and the money line must name what was BOOKED, not only what was earned
    const repBooked = rep.match(/\$([\d,]+) booked to date/);
    if (repBooked && Math.abs(+repBooked[1].replace(/,/g, '') - AC) > 2)
      say('Status report', 'says ' + repBooked[0] + ' while the tasks sum to ' + fmtMoney(AC));

    // d) nothing broken in the numbers
    if (/NaN|Infinity|undefined|\$\s*,/.test(rep)) say('Status report', 'contains a broken figure');

    // ═══ 2. CLIENT-SAFE MODE MUST ACTUALLY WITHHOLD ═════════════════════════
    clientSafeReports = true;
    const safeRep = strip(buildStatusReportHtml());
    const leaked = nums(safeRep);
    if (leaked.length)
      say('Client-safe status report', 'still prints ' + leaked.length + ' money figure'
        + (leaked.length === 1 ? '' : 's') + ': ' + leaked.slice(0, 4).map(money).join(', '));
    if (/margin|day rate|bill rate|cost/i.test(safeRep) && /\$/.test(safeRep))
      say('Client-safe status report', 'mentions cost with a currency symbol present');
    // and it must still be a usable report, not an empty one
    if (safeRep.length < 200) say('Client-safe status report', 'is nearly empty — it withheld the report, not the money');
    clientSafeReports = false;

    // ═══ 3. THE SOW DRAFT ═══════════════════════════════════════════════════
    let sow = null;
    try {
      const src = (typeof sowSkeletonData === "function") ? sowSkeletonData() : null;
      if (src) {
        sow = { assumptions: (src.assumptions || []).length, exclusions: (src.exclusions || []).length,
                risks: (src.risks || []).length };
        // an assumption that BROKE is no longer an assumption you are relying on
        const brokenListed = (src.assumptions || []).filter(a =>
          (raid || []).some(r => r.type === 'Assumption' && r.title === a.text && raidOutcomeOf(r)
            && raidOutcomeOf(r).v === 'broken'));
        if (brokenListed.length)
          say('SOW draft', brokenListed.length + ' assumption(s) listed as things you are relying on have '
            + 'already been recorded as BROKEN: ' + brokenListed.map(a => a.text).slice(0, 2).join('; '));
        // a risk that materialised is not a risk
        const turnedRisks = (src.risks || []).filter(title =>
          (raid || []).some(r => r.type === 'Risk' && r.title === title && raidOutcomeOf(r)
            && raidOutcomeOf(r).v === 'materialised'));
        if (turnedRisks.length)
          say('SOW draft', turnedRisks.length + ' risk(s) listed as things that MIGHT happen have already '
            + 'materialised: ' + turnedRisks.slice(0, 2).join('; '));
      }
    } catch (e) { say('SOW draft', 'threw: ' + e.message); }

    // ═══ 4. EXPORTS RESTATE THE SAME FACTS ══════════════════════════════════
    const grab = fn => { let cap = null; const real = window.download;
      window.download = (n, body) => { cap = body; };
      try { fn(); } catch (e) { cap = 'THREW: ' + e.message; } finally { window.download = real; }
      return cap; };
    const raidCsv = grab(() => exportRaidCSV());
    if (typeof raidCsv === 'string' && /^THREW/.test(raidCsv)) say('RAID CSV', raidCsv);
    else if (typeof raidCsv === 'string') {
      // every entry in the log must appear in the export
      const lines = raidCsv.split('\n').length - 1;
      if (lines !== (raid || []).length) say('RAID CSV', 'exports ' + lines + ' rows for '
        + (raid || []).length + ' entries');
      // and an outcome recorded on screen must be in the file
      (raid || []).forEach(r => {
        const o = raidOutcomeOf(r);
        if (o && raidCsv.indexOf(o.lbl) < 0) say('RAID CSV', '"' + r.title + '" is recorded as "'
          + o.lbl + '" and that does not appear in the export');
      });
    }

    // ═══ 5. THE AI READING NARRATES THE SAME PANEL ══════════════════════════
    try {
      const reading = strip(ptReadingHtml('base'));
      if (/NaN|Infinity|undefined/.test(reading)) say('AI reading', 'contains a broken figure');
    } catch (e) { say('AI reading', 'threw: ' + e.message); }

      /* ── AUDIENCE: EXPLICIT BEATS INFERRED, AND UNKNOWN IS NOT "CLIENT" ──
         testCaseAudience ignored the test case's own audience field and looked
         up the story instead, then answered 'client' when no story matched. On
         the real export that made all ten test cases — every one of them
         carrying audience:"internal" on the task — report as client-facing, so
         the client filter showed 10 of 10 internal admin cases.

         Two invariants, and both are about which way a default fails. A typed
         audience must win: it is the one answer a person gave on purpose. And an
         audience nobody can determine must not be presented as client-facing —
         the cost of hiding a client case is a moment's confusion, the cost of
         showing an internal one is an internal note in front of the client. */
      const aud = {};
      {
        const tcs = tasks.filter(t => isTestCaseTask(t));
        aud.testCases = tcs.length;
        let ignored = 0, guessedClient = 0;
        tcs.forEach(t => {
          const got = testCaseAudience(t);
          if ((t.audience === 'client' || t.audience === 'internal') && got !== t.audience) ignored++;
          const acId = ((t.name.match(/^TC\s+([A-Za-z0-9_.-]+)/i) || [])[1] || '').toLowerCase();
          const linked = acId && ((reqs && reqs.stories) || [])
            .some(x => (x.ac || []).some(a => a.id.toLowerCase() === acId));
          if (!linked && !t.audience && got === 'client') guessedClient++;
        });
        if (ignored)
          say('Audience', ignored + ' test case(s) carry an explicit audience that is overridden by an '
            + 'inferred one — the value somebody typed on purpose is losing to a guess');
        if (guessedClient)
          say('Audience', guessedClient + ' test case(s) verify no criterion and carry no audience, and '
            + 'are reported CLIENT-FACING anyway — an unknown answered in the direction that puts '
            + 'internal notes in front of a client');
        aud.internal = tcs.filter(t => testCaseAudience(t) === 'internal').length;
        aud.client = tcs.filter(t => testCaseAudience(t) === 'client').length;
        aud.unclassified = tcs.filter(t => testCaseAudience(t) === 'unclassified').length;
      }


    return { contradictions: bad, audience: aud,
      truth: { booked: Math.round(AC), dueByToday: Math.round(PV), earned: Math.round(EV),
               envelope: Math.round(BAC), livePlan: Math.round(projectCost()),
               projectBudgetField: projectBudget, gap: Math.round(bv.gap) },
      reportSays: { planned: (rep.match(/planned \$[\d,]+/i) || [])[0] || null,
                    earned: (rep.match(/earned value to date \$[\d,]+/i) || [])[0] || null,
                    booked: /booked|actual cost/i.test(rep),
                    baseline: (rep.match(/variance [^.]{0,24}/i) || [])[0] || null },
      barSchedule: sch.delta, sow, safeReportMoneyFigures: leaked.length };
  });

  R.pageErrors = errs.slice(0, 8);
  console.log(JSON.stringify(R, null, 1));
  await b.close();
})();
