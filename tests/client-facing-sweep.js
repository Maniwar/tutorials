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

    /* ═══ 3b. THE ASSEMBLED DOCUMENT ═══════════════════════════════════════
       Section 3 checks the SKELETON DATA — what went in. This checks the thing
       a client is handed, because four defects lived entirely in the assembly:
       a payment clause promising an arrangement the project was not billed
       under, story ids cited in three places and printed in none, a boundary
       section that waived the boundary, and section numbers that skipped when
       an optional section was empty. None of them were visible in the data. */
    let doc = null;
    try {
      const savedTerms = JSON.parse(JSON.stringify(revTerms));
      const savedRaid = raid.slice();
      const build = () => { const d = sowSkeletonData(); d.storiesAppendix = sowStoriesAppendix();
                            return { d: d, html: sowAssembleHtml(d, null) }; };
      const secNums = html => [...html.matchAll(/<h2[^>]*>(\d+)\./g)].map(m => +m[1]);

      // ── the story ids printed must be the story ids cited ────────────────
      const base = build();
      const citedAll = [...new Set((strip(base.html).match(/\bUS-\d+\b/g) || []))];
      const traceable = (base.d.nfrs || []).length + (base.d.clientDeps || []).length
                      + (base.d.storyAssumps || []).length;
      if (!traceable)
        say('SOW document', 'the fixture produces no NFR, dependency or story-assumption row, so the '
          + 'reference-integrity check below has nothing to read and would pass on any build');
      else {
        const dangling = citedAll.filter(id => !base.d.printedStoryIds.has(id));
        if (dangling.length)
          say('SOW document', dangling.length + ' story id(s) are cited in the SOW and printed nowhere in '
            + 'it: ' + dangling.slice(0, 6).join(', ') + ' — a client cannot look them up');
        /* The positive form, which the negative one cannot express: a story the
           document RELIES on — its quality attribute, its dependency, its
           pricing assumption is quoted in the body — has to be in the document.
           Blanking the reference would satisfy the check above and still leave
           the reader told that something binds a story they cannot read. */
        /* COMPUTED HERE, NOT ASKED FOR. This read sowReferencedStoryIds() —
           the function under test — so a mutant that stopped it returning
           NFR-carrying stories shrank the check by exactly as much as it shrank
           the product, and nothing could ever disagree. The rule is restated
           independently: a story is relied on when the document quotes one of
           its quality attributes, dependencies or pricing assumptions. */
        const relied = ((reqs && reqs.stories) || []).filter(s2 =>
          (s2.nfrs || []).some(x => String(x).trim())
          || (s2.assumptions || []).some(x => /^D:/i.test(x)
               || (/^A:/i.test(x) && !/no WBS activity covers this yet/i.test(String(x))))
        ).map(s2 => s2.id);
        if (!relied.length)
          say('SOW document', 'no story in the fixture carries an NFR, a D: dependency or an A: assumption, '
            + 'so the reliance check below reads an empty list and would pass on any build');
        else {
          /* THE DISCRIMINATING CASE, CONSTRUCTED. Every NFR-carrying story in
             this fixture is ALSO client-facing or also carries a D:/A: line, so
             removing the NFR path from the referenced set changed nothing the
             fixture could show. The case that matters is an INTERNAL story whose
             ONLY claim on the document is a quality attribute — build one, and
             assert the construction took before asserting anything about it. */
          const guinea = (reqs.stories || []).find(s2 => storyAudience(s2) === 'internal');
          if (!guinea)
            say('SOW document', 'the fixture holds no internal story at all, so the NFR-only reliance '
              + 'case below cannot be built and proves nothing');
          else {
            const keptNfrs = guinea.nfrs, keptAss = guinea.assumptions;
            // an NFR and NOTHING else — no D:, no A: — so the only thing that can
            // pull this story into the document is the quality attribute itself
            guinea.nfrs = ['ZZ probe attribute: responses under 2 seconds'];
            guinea.assumptions = [];
            const builtRight = storyAudience(guinea) === 'internal'
              && !(guinea.assumptions || []).some(x => /^[DA]:/i.test(x));
            const printedNow = sowPrintedStoryIds();
            guinea.nfrs = keptNfrs; guinea.assumptions = keptAss;
            if (!builtRight)
              say('SOW document', 'the NFR-only subject could not be put into the state the check needs');
            else if (!printedNow.has(guinea.id))
              say('SOW document', 'a story whose quality attribute the document quotes (' + guinea.id
                + ') is not printed by it — the reader is told something binds a story they cannot read');
          }
          const absent = relied.filter(id => !base.d.printedStoryIds.has(id));
          if (absent.length)
            say('SOW document', 'the SOW quotes requirements drawn from ' + absent.length + ' story/ies it '
              + 'does not print: ' + absent.slice(0, 6).join(', '));
          const appx = strip(base.d.storiesAppendix || '');
          const notInAppendix = relied.filter(id => appx.indexOf(id) < 0);
          if (notInAppendix.length)
            say('SOW document', notInAppendix.length + ' relied-on story/ies are missing from the appendix '
              + 'the document points readers to: ' + notInAppendix.slice(0, 6).join(', '));
        }
      }
      // and with the appendix switched OFF, nothing may be cited at all
      const sel = document.getElementById('sowStoriesMode');
      const savedMode = sel ? sel.value : null;
      if (sel) {
        sel.value = 'none';
        const off = build();
        if (off.d.storiesAppendix !== '')
          say('SOW document', 'stories set to "none" still printed a story appendix');
        const citedOff = (strip(off.html).match(/\bUS-\d+\b/g) || []);
        if (citedOff.length)
          say('SOW document', 'with the story appendix switched off the document still cites '
            + [...new Set(citedOff)].slice(0, 6).join(', '));
        // the requirements themselves must SURVIVE — dropping the reference is
        // not licence to drop the obligation
        if ((base.d.nfrs || []).length && (off.d.nfrs || []).length !== (base.d.nfrs || []).length)
          say('SOW document', 'switching the appendix off also dropped ' +
            ((base.d.nfrs || []).length - (off.d.nfrs || []).length) + ' non-functional requirement(s) '
            + 'from the contract — the reference goes, the requirement stays');
        sel.value = savedMode;
      }

      // ── milestone billing names every milestone, with an amount ──────────
      revTerms = { kind: 'milestone', days: 30, deposit: 20 };
      const plan = sowPaymentPlan();
      const datedMs = tasks.filter(t => t.milestone && t.finishDate instanceof Date
                                        && !isNaN(t.finishDate.getTime()));
      if (!datedMs.length)
        say('SOW document', 'the fixture holds no dated milestone, so the milestone-billing check below '
          + 'cannot distinguish a schedule from an empty table');
      else {
        const unnamed = datedMs.filter(t => !plan.rows.some(r => r.event.indexOf(t.name) >= 0));
        if (unnamed.length)
          say('SOW document', unnamed.length + ' dated milestone(s) carry no payment row under milestone '
            + 'billing: ' + unnamed.map(t => t.name).slice(0, 3).join('; '));
        if (plan.rows.every(r => !(r.amount > 0)))
          say('SOW document', 'the milestone payment schedule states no amount on any row — "paid by '
            + 'milestone" without the money is the defect it was built to fix');
        if (Math.abs(plan.total - plan.scheduled) > 1)
          say('SOW document', 'the payment schedule totals ' + Math.round(plan.scheduled)
            + ' against a contract price of ' + Math.round(plan.total) + ' — a client signs the difference');
        const msHtml = build().html;
        if (!datedMs.every(t => msHtml.indexOf(t.name) >= 0))
          say('SOW document', 'a milestone the payment plan bills does not appear in the document');
      }
      // ── an arrangement the project is not billed under is never proposed ─
      revTerms = { kind: 'none', days: 0, deposit: 0 };
      const noTerms = build().html;
      if (base.d.price && !/Payment schedule not yet set/.test(noTerms))
        say('SOW document', 'with no billing arrangement recorded the commercial terms say nothing about '
          + 'the gap — it ships as a finished clause');
      if (/milestone-based payment|paid by milestone|invoiced monthly/i.test(strip(noTerms)))
        say('SOW document', 'with no billing arrangement recorded the document still proposes one');

      // ── out of scope limits; it never waives ────────────────────────────
      revTerms = savedTerms;
      raid = raid.filter(x => x.type !== 'Exclusion');
      const noExcl = build();
      const oos = strip(noExcl.html);
      const oosBody = oos.slice(oos.indexOf('Out of Scope'), oos.indexOf('Out of Scope') + 600);
      if (oos.indexOf('Out of Scope') < 0)
        say('SOW document', 'the document has no Out of Scope section at all');
      else {
        if (!/not expressly listed there is out of scope/i.test(oosBody))
          say('SOW document', 'with no recorded exclusions the Out of Scope section states no boundary: '
            + oosBody.slice(0, 140));
        if (/all activities and deliverables are as defined|no exclusions apply/i.test(oosBody))
          say('SOW document', 'the Out of Scope section reads as a waiver rather than a limit');
      }
      raid = savedRaid;

      // ── numbering is contiguous and every reference resolves ────────────
      const savedStories = reqs.stories;
      let thin = null;
      try { reqs.stories = []; thin = build(); } finally { reqs.stories = savedStories; }
      [['full', base], ['no optional sections', thin]].forEach(([lbl, v]) => {
        if (!v) return;
        const ns = secNums(v.html);
        if (!ns.length) { say('SOW document', lbl + ': the document is unnumbered'); return; }
        if (!ns.every((x, i) => x === i + 1))
          say('SOW document', lbl + ': section numbers run ' + ns.join(',') + ' — a contract referred to '
            + 'by number cannot skip one');
        if (/\{\{sec:|§undefined|§NaN/.test(v.html))
          say('SOW document', lbl + ': an unresolved cross-reference reached the document');
        const refs = [...new Set((strip(v.html).match(/§(\d+)/g) || []))].map(x => +x.slice(1));
        const missing = refs.filter(x => x > ns.length);
        if (missing.length)
          say('SOW document', lbl + ': the document refers to §' + missing.join(', §')
            + ' and has only ' + ns.length + ' sections');
      });
      // the reordering itself: what it costs and when they pay is not the
      // eighth thing a reader finds
      const order = [...base.html.matchAll(/<h2[^>]*>(\d+)\.\s([^<]+)</g)].map(m => m[2].trim());
      const ci = order.findIndex(x => /Commercial Terms/.test(x));
      if (base.d.price && ci < 0) say('SOW document', 'a priced engagement has no Commercial Terms section');
      else if (ci > 5) say('SOW document', 'Commercial Terms is section ' + (ci + 1) + ' of ' + order.length
        + ' — the price and the payment schedule are buried behind ' + ci + ' other sections');
      doc = { sections: order.length, cited: citedAll.length, refsDropped: base.d.refsDropped,
              commercialAt: ci + 1, msRows: plan.rows.length };
      revTerms = savedTerms;
    } catch (e) { say('SOW document', 'threw: ' + e.message); }

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

    /* ═══ 4b. WHAT WAS CHARGED, AND WHAT CAME BACK ═════════════════════════
       The money-in record reached one panel and nothing that leaves the tool.
       A status report could say "on plan" beside forty thousand of finished
       work nobody had invoiced, and the artefact you take to a credit-control
       conversation could not be produced at all.
       Constructed, because no committed fixture carries an invoice figure —
       without that this whole block would confirm an empty book, which is the
       shape a receivables report fails in anyway. */
    (() => {
      const done = leafTasks().filter(t => !t.isSummary && (t.percentComplete || 0) >= 100 && taskBilledValue(t) > 0);
      if (!done.length) { say('Receivables', 'no finished billable activity on this plan, so nothing below is tested'); return; }
      const t0 = done[0];
      const keep = { i: t0.invoiced, id: t0.invoicedDate, p: t0.paid, pd: t0.paidDate };
      t0.invoiced = 5000; t0.invoicedDate = '2026-06-01'; t0.paid = 2000; t0.paidDate = '2026-07-15';
      const csv = grab(() => exportReceivablesCSV());
      if (typeof csv !== 'string' || /^THREW/.test(csv)) { say('Receivables', 'the export threw: ' + csv); }
      else {
        const lines = csv.split('\n').filter(Boolean);
        const head = lines[0] || '';
        ['Invoiced', 'Received', 'Outstanding', 'Days outstanding', 'State'].forEach(h => {
          if (head.indexOf(h) < 0) say('Receivables', 'the export has no "' + h + '" column');
        });
        /* EVERY ACTIVITY, including the ones nobody has recorded anything
           against. A receivables report that silently drops the unrecorded
           lines shows a healthy book by omission, which is exactly how a
           hand-maintained one goes wrong. */
        const leafN = leafTasks().filter(x => !x.isSummary).length;
        const dataN = lines.filter(l => !/^WBS,|^TOTAL|never invoiced \(/.test(l)).length;
        if (dataN < leafN)
          say('Receivables', 'the export carries ' + dataN + ' rows for ' + leafN + ' activities — the ones '
            + 'nobody has invoiced are missing, so the file shows a healthy book by leaving out the gap');
        const row = lines.find(l => l.indexOf('5000') >= 0) || '';
        if (row.indexOf('3000') < 0)
          say('Receivables', 'invoiced 5000 and received 2000 does not report 3000 outstanding: ' + row.slice(0, 90));
        if (!/62|6[0-9]/.test(row.split(',')[11] || ''))
          say('Receivables', 'the days-outstanding column is empty or wrong on a row invoiced in June: '
            + row.slice(0, 100));
        /* the unbilled total must NOT be folded into outstanding: money you
           have not asked for is not money owed to you */
        const outT = lines.find(l => /^TOTAL outstanding/.test(l)) || '';
        const unb = lines.find(l => /never invoiced \(not yet owed\)/.test(l)) || '';
        if (!outT) say('Receivables', 'no outstanding total');
        if (!unb) say('Receivables', 'the finished-but-unbilled total is missing, or is not labelled as not '
          + 'yet owed — folding it into outstanding would overstate the book by every activity nobody billed');
        /* THE VALUE, not just the row. Asserting the two lines EXIST passes on a
           build that adds unbilled work into the outstanding figure — the label
           is still there and the number is wrong, which is the shape of the
           defect rather than its absence. */
        const recNow = revenueRecord(leafTasks());
        const outV = +((outT.match(/(\d+)(?!.*\d)/) || [])[1] || -1);
        if (outT && Math.abs(outV - recNow.billedUnpaid) > 1)
          say('Receivables', 'the outstanding total reads ' + outV + ' against ' + Math.round(recNow.billedUnpaid)
            + ' actually invoiced-and-unreceived — money you have not asked for is not money owed to you, and '
            + 'adding it overstates the book by every activity nobody billed');
      }
      // the status report says it, and client-safe withholds it
      clientSafeReports = false;
      const rep2 = strip(buildStatusReportHtml());
      if (!/money in/i.test(rep2))
        say('Status report', 'never mentions what has been invoiced or received, so it can report "on plan" '
          + 'beside a pile of finished work nobody has charged for');
      clientSafeReports = true;
      const safe2 = strip(buildStatusReportHtml());
      if (/money in/i.test(safe2))
        say('Client-safe status report', 'prints the money-in line — what you have not billed THEM for is the '
          + 'last figure to put in front of them');
      clientSafeReports = false;
      // and the health check raises it
      const lint2 = lintPlan();
      /* matched on what the finding SAYS, not on its area label. Testing
         /unbilled/i against the area passed a build that renamed it to
         "_UnbilledDelivery" — still matching, no longer a real category, and
         invisible wherever findings are grouped. The claim is what matters. */
      if (!lint2.some(f => /no invoice figure|never been invoiced|not been invoiced/i.test(f.finding || '')))
        say('Health check', 'finished work with no invoice figure is not a finding, so it is only visible to '
          + 'somebody who opens Analytics and scrolls');
      t0.invoiced = keep.i; t0.invoicedDate = keep.id; t0.paid = keep.p; t0.paidDate = keep.pd;
    })();

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
        /* The two counters below start at zero and are only ever incremented,
           so an empty selection satisfies both by never entering the loop. The
           fixture has ten test cases today; the day it does not, this block
           would report a clean audience audit having audited nothing. */
        if (!tcs.length)
          say('Audience', 'the plan holds no test cases at all, so the audience audit below counted to zero '
            + 'without examining anything — that is not a clean result, it is an absent one');
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
        /* CONSTRUCTED, because the fixture cannot reach the branch. All ten of
           its test cases carry audience:"internal", so testCaseAudience returns
           on its first line every time and the fallback — the half that decides
           what an UNKNOWN audience becomes — has never once executed here. The
           loop above was therefore counting to zero on a build that answered
           "client" to every unknown, which is the exact defect it was written
           against. Same shape as the dependency types in schedule-sweep: a
           correct check and a fixture that cannot tell the difference.

           So the case is built: a test case with its audience removed and an AC
           id that resolves to nothing. The only safe answer is 'unclassified' —
           hiding a client case costs a moment's confusion, showing an internal
           one puts an internal note in front of the client. */
        if (tcs.length) {
          const probe = tcs[0];
          const savedAud = probe.audience, savedName = probe.name;
          probe.audience = undefined;
          probe.name = 'TC ZZ-none-99 — constructed: an audience nobody can determine';
          const verdict = testCaseAudience(probe);
          aud.constructedUnknownVerdict = verdict;
          if (verdict === 'client')
            say('Audience', 'a test case with no audience and no criterion behind it is reported '
              + 'CLIENT-FACING — the unknown is answered in the direction that puts an internal note '
              + 'in front of the client');
          else if (verdict !== 'unclassified')
            say('Audience', 'a test case with no audience and no criterion behind it reports "'
              + verdict + '" rather than unclassified');
          // and an EXPLICIT audience must still win over anything inferred
          probe.audience = 'internal';
          const explicit = testCaseAudience(probe);
          aud.constructedExplicitVerdict = explicit;
          if (explicit !== 'internal')
            say('Audience', 'a test case carrying audience:"internal" reports "' + explicit
              + '" — the value somebody typed on purpose is losing to a guess');
          probe.audience = savedAud; probe.name = savedName;
        }
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
      barSchedule: sch.delta, sow, doc, safeReportMoneyFigures: leaked.length };
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
