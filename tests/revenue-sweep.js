/* ═══════════════════════════════════════════════════════════════════════════
   MONEY IN — THE MODEL, AND THE RECORD.

   Two things that get confused with each other, and the confusion was the
   defect. Reported plainly: "the system assumes if we did the task we got
   billed for it." It did. Revenue was bill rate × effort, always, with no way
   anywhere to say an invoice had gone out, or come back, or been sat on.

   So there are now two separate things and this file holds them apart.

   THE MODEL says when money is EXPECTED. Revenue in is not the cost curve with
   its sign flipped: cost is one step (work happens, money leaves N days later)
   and revenue is two (nothing is owed until an invoice is raised, and the
   contract decides when that is). Milestone billing is the case that makes it
   its own thing — discontinuous by nature, everything since the last checkpoint
   falling due the day the next one completes.

   THE RECORD says what ACTUALLY happened, per activity, and null means nobody
   has said. That distinction is the whole point: an activity with no invoice
   figure is unrecorded, not unbilled, and a panel that draws those the same way
   would either invent a debt or hide one.

   The identity that matters most here is the NORMALISATION. On a fixed price
   you invoice the fee; bill rate × effort is how the fee was arrived at, not
   what goes on the invoice. So the curve takes its shape from the work and its
   total from pricingFigures().price — and if that ever drifts, the plan tells
   you it will collect a number nobody agreed to.
   ═══════════════════════════════════════════════════════════════════════════ */
const { requirePlaywright, chromePath, APP, FIXTURE } = require('./_harness');
const { chromium } = requirePlaywright();

(async () => {
  const b = await chromium.launch({headless:true,args:['--no-sandbox'],executablePath: chromePath()});
  const page = await b.newPage({viewport:{width:1400,height:1200}});
  page.on('dialog', d => d.accept());
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(APP, {waitUntil:'load'});
  await page.evaluate(d => { hydrate(d); calculate(); }, FIXTURE());
  await page.waitForTimeout(500);

  const R = await page.evaluate(() => {
    const bad = [], out = { ran: [] };
    const say = x => bad.push('Revenue :: ' + x);
    const ran = k => out.ran.push(k);
    const near = (a, b2, tol) => Math.abs(a - b2) <= (tol == null ? 0.75 : tol);
    const hb = hasBaseline(), lv = leafTasks();
    const sum = segs => segs.reduce((s, g) => s + g.c, 0);

    /* ── 1. THE CURVE COLLECTS THE FEE, NOT THE RATE-CARD SUM ───────────────
       The single most important identity here. If these drift, the plan is
       projecting the collection of a number nobody signed. */
    ran('1·normalisedToTheFee');
    const fee = revenueAtCompletion();
    out.fee = Math.round(fee);
    if (!(fee > 0)) { say('the fixture prices at nothing, so every check below is vacuous'); return { contradictions: bad, counts: out }; }
    const acc = revSpread(hb, lv);
    out.accrualPlaced = Math.round(acc.placed);
    out.accrualUndated = Math.round(acc.undated);
    if (!near(acc.placed + acc.undated, fee, 1))
      say('the revenue curve totals ' + fmtMoney(acc.placed + acc.undated) + ' against a fee of '
        + fmtMoney(fee) + ' — the plan is projecting the collection of a number nobody agreed to');
    /* and it must be normalised rather than coincidentally equal: the rate-card
       sum on this fixture is a DIFFERENT number, which is what makes the check
       meaningful rather than tautological */
    const raw = lv.reduce((s, t) => s + taskBilledValue(t), 0);
    out.rateCardSum = Math.round(raw);
    out.scaleApplied = Math.round((acc.scale || 0) * 1000) / 1000;
    if (near(raw, fee, 1))
      say('the rate-card sum and the fee are the same number on this fixture, so check 1 would pass with no '
        + 'normalisation at all — it is not testing what it claims to');

    /* ── 2. TERMS MOVE THE MONEY AND DO NOT CREATE OR DESTROY IT ───────────── */
    ran('2·termsConserve');
    const before = JSON.stringify(revTerms);
    ['net', 'monthly', 'milestone'].forEach(kind => {
      revTerms = { kind: kind, days: 30, deposit: 0 };
      const c = revSpread(hb, lv, { cash: true });
      out['cash_' + kind] = Math.round(c.placed + c.undated);
      if (!near(c.placed + c.undated, fee, 1))
        say(kind + ' billing totals ' + fmtMoney(c.placed + c.undated) + ' against a fee of ' + fmtMoney(fee)
          + ' — the terms are leaking money on the way through');
      // and it must actually MOVE: same total, different dates
      const same = JSON.stringify(c.segs.map(g => Math.round(g.s / 86400000)).sort())
                === JSON.stringify(acc.segs.map(g => Math.round(g.s / 86400000)).sort());
      if (same) say(kind + ' billing places every receipt on exactly the dates the work was earned, so the '
        + 'arrangement is being read and then ignored');
    });

    /* ── 3. A DEPOSIT IS A SHARE OF THE FEE, TAKEN EARLY, NOT ADDED ──────────
       The failure worth naming: charging the deposit AND the full fee, so the
       plan quietly expects 120% of the contract. */
    ran('3·depositIsTakenNotAdded');
    revTerms = { kind: 'net', days: 30, deposit: 25 };
    const dep = revSpread(hb, lv, { cash: true });
    out.deposit = Math.round(dep.deposit);
    out.depositTotal = Math.round(dep.placed + dep.undated);
    if (!near(dep.deposit, fee * 0.25, 1))
      say('a 25% deposit came out as ' + fmtMoney(dep.deposit) + ' of a ' + fmtMoney(fee) + ' fee');
    if (!near(dep.placed + dep.undated, fee, 1))
      say('with a deposit the plan expects ' + fmtMoney(dep.placed + dep.undated) + ' against a fee of '
        + fmtMoney(fee) + ' — the deposit is being ADDED to the fee rather than taken out of it');
    // the deposit arrives before any of the work does
    const firstWork = Math.min.apply(null, acc.segs.map(g => g.s));
    const depSeg = dep.segs.slice().sort((a, b2) => a.s - b2.s)[0];
    if (depSeg && depSeg.s > firstWork + 86400000 * 60)
      say('the deposit lands ' + Math.round((depSeg.s - firstWork) / 86400000) + ' days after the work starts, '
        + 'which is not what a mobilisation payment is');

    /* ── 4. MILESTONE BILLING IS DISCONTINUOUS, AND ON THE MILESTONES ───────
       The case that could not reuse the cost path. Every receipt must land on a
       milestone date plus the terms, or at the finish — never smeared across
       the work the way a monthly would be. */
    ran('4·milestoneBillsOnMilestones');
    revTerms = { kind: 'milestone', days: 30, deposit: 0 };
    const msInfo = revMilestoneDates(hb, lv);
    out.milestones = msInfo.dates.length;
    const mc = revSpread(hb, lv, { cash: true });
    if (msInfo.dates.length) {
      const DAY = 86400000;
      const allowed = msInfo.dates.map(m => Math.round((m.ms + 30 * DAY) / DAY));
      const finish = Math.round((Math.max.apply(null, acc.segs.map(g => g.f)) + 30 * DAY) / DAY);
      const off = mc.segs.filter(g => {
        const d = Math.round(g.s / DAY);
        return allowed.indexOf(d) < 0 && Math.abs(d - finish) > 2;
      });
      out.receiptsOffAMilestone = off.length;
      if (off.length)
        say(off.length + ' of ' + mc.segs.length + ' receipts under MILESTONE billing land on a date that is '
          + 'neither a milestone plus its terms nor the finish — the arrangement is being approximated by a '
          + 'smear, which is the monthly model wearing a different label');
    } else {
      say('the fixture has no dated milestone, so check 4 cannot exercise milestone billing at all');
    }
    revTerms = JSON.parse(before);

    /* ── 5. NULL IS NOT ZERO ────────────────────────────────────────────────
       The distinction the record exists for. An activity nobody has invoiced is
       UNRECORDED; drawing it as "invoiced $0" invents a fact, and drawing it as
       billed invents money. */
    ran('5·nullIsNotZero');
    const t0 = lv.find(t => !t.isSummary && taskBilledValue(t) > 0);
    if (!t0) { say('no billable activity to record against'); }
    else {
      const keepI = t0.invoiced, keepP = t0.paid;
      t0.invoiced = null; t0.paid = null;
      const r0 = revenueRecord(lv);
      if (taskInvoiced(t0) !== null) say('an activity with invoiced=null reports a number');
      out.unrecordedN = r0.unrecordedN;
      if (!r0.unrecordedN) say('nothing is counted as unrecorded on a plan where nothing has been invoiced');
      t0.invoiced = 0;
      const r1 = revenueRecord(lv);
      if (r1.billedN !== r0.billedN + 1)
        say('an activity explicitly invoiced for ZERO is not counted as billed — zero is a record, and it is '
          + 'the one that says "we decided not to charge for this"');
      t0.invoiced = keepI; t0.paid = keepP;
    }

    /* ── 6. FINISHED AND NEVER INVOICED ─────────────────────────────────────
       The number the complaint was really about. It must move when an invoice
       is recorded, and it must never count work that is not worth billing. */
    ran('6·finishedAndUnbilled');
    const rec = revenueRecord(lv);
    out.doneUnbilledN = rec.doneUnbilledN;
    out.doneUnbilled = Math.round(rec.doneUnbilled);
    if (!rec.doneUnbilledN)
      say('this plan has finished work and none of it is reported as uninvoiced, so the reading that answers '
        + '"what have we not charged for" is not reading anything');
    const done = lv.filter(t => !t.isSummary && (t.percentComplete || 0) >= 100 && taskBilledValue(t) > 0);
    if (done.length) {
      const keep = done[0].invoiced;
      done[0].invoiced = 5000;
      const rec2 = revenueRecord(lv);
      out.afterRecordingN = rec2.doneUnbilledN;
      if (rec2.doneUnbilledN !== rec.doneUnbilledN - 1)
        say('recording an invoice against a finished activity did not remove it from the uninvoiced list — '
          + 'the reading is not looking at the field the editor writes');
      // and what is owed shows up
      done[0].paid = 2000;
      const rec3 = revenueRecord(lv);
      out.owed = Math.round(rec3.billedUnpaid);
      if (!near(rec3.billedUnpaid, 3000, 1))
        say('invoiced 5000 and received 2000 reports ' + fmtMoney(rec3.billedUnpaid) + ' outstanding, not 3000');
      done[0].invoiced = keep; done[0].paid = null;
    }
    // a milestone is worth nothing on an invoice and must not inflate the figure
    const msDone = lv.filter(t => t.milestone && (t.percentComplete || 0) >= 100);
    if (msDone.length && rec.rows.some(r => msDone.some(m => m.id === r.id)))
      say('a completed MILESTONE is listed as finished work that was never invoiced — a checkpoint carries no '
        + 'billable value, and counting them grows this figure with the size of the plan rather than with '
        + 'the money at stake');

    /* ── 7. THE FUNDING GAP ─────────────────────────────────────────────────
       Why the two curves exist. The trough must be the deepest point of
       in-minus-out, and the cash-positive date must be the LAST dip rather than
       the first crossing — reporting the first would be an assurance the plan
       does not support. */
    ran('7·fundingGap');
    revTerms = { kind: 'net', days: 60, deposit: 0 };
    const inn = revSpread(hb, lv, { cash: true });
    const outSp = pvSpread(hb, lv, { cash: false });
    const all = inn.segs.concat(outSp.segs);
    const from = Math.min.apply(null, all.map(g => g.s));
    const to = Math.max.apply(null, all.map(g => g.f));
    const pos = cashPositionData(inn.segs, outSp.segs, from, to);
    out.trough = Math.round(pos.troughMoney);
    out.endsNet = Math.round(pos.endsNet);
    const worst = pos.points.reduce((m, p) => p.net < m ? p.net : m, Infinity);
    if (!near(pos.troughMoney, worst, 0.01))
      say('the reported trough ' + fmtMoney(pos.troughMoney) + ' is not the lowest point of the series ('
        + fmtMoney(worst) + ')');
    if (pos.positiveFrom != null) {
      const after = pos.points.filter(p => p.ms >= pos.positiveFrom);
      if (after.some(p => p.net < 0))
        say('the plan claims to be cash-positive from a date it later dips below zero again — that is the '
          + 'first crossing being reported as the answer, and it is an assurance the plan does not support');
    }
    // net at the end is the margin: everything billed minus everything spent
    const spend = outSp.segs.reduce((s, g) => s + g.c, 0);
    if (!near(pos.endsNet, sum(inn.segs) - spend, 2))
      say('the position ends at ' + fmtMoney(pos.endsNet) + ', which is not everything received minus '
        + 'everything paid (' + fmtMoney(sum(inn.segs) - spend) + ')');
    // longer terms cannot make the gap shallower
    revTerms = { kind: 'net', days: 7, deposit: 0 };
    const quick = revSpread(hb, lv, { cash: true });
    const posQ = cashPositionData(quick.segs, outSp.segs, from, to);
    out.troughNet7 = Math.round(posQ.troughMoney);
    if (posQ.troughMoney < pos.troughMoney - 1)
      say('being paid in 7 days leaves a DEEPER hole than being paid in 60 — the terms are applied backwards');
    revTerms = JSON.parse(before);

    /* ── 8. IT IS DRAWN, AND IT SAYS WHICH BASIS IT IS ON ──────────────────── */
    ran('8·drawnAndDisclosed');
    revTerms = { kind: 'milestone', days: 30, deposit: 20 };
    switchTab('analytics'); renderAnalytics();
    const mi = document.querySelector('.ptr-mi');
    out.drawn = !!mi;
    if (!mi) say('nothing about money in is drawn on a plan that has billing terms and finished work');
    else {
      const txt = (mi.innerText || '').replace(/\s+/g, ' ');
      out.says = txt.slice(0, 90);
      if (!/never been invoiced|invoiced and not received/i.test(txt))
        say('the panel draws and never mentions uninvoiced work');
      if (!/money out|accru/i.test(txt))
        say('the panel does not say that everything else on the page is on a different basis — a receipt '
          + 'sitting beside an accrual with nothing distinguishing them is how the two get averaged in '
          + 'somebody\'s head');
      if (/NaN|Infinity|undefined|\$-/.test(txt)) say('the panel prints a broken figure: ' + txt.slice(0, 60));
      /* THE CHART HAS TO AGREE WITH THE SENTENCE UNDER IT. Two statements of
         the same funding gap on one panel, and the drawn one is read first —
         so if they disagree it is the prose that gets doubted. */
      const svg = mi.querySelector('.mi-svg');
      out.chartDrawn = !!svg;
      if (!svg) say('the funding gap is stated in words and never drawn — "44,300 negative at its deepest, '
        + 'positive from October" is three facts a reader has to assemble into a curve in their head');
      else {
        const aria = svg.getAttribute('aria-label') || '';
        if (!/lowest|positive/i.test(aria))
          say('the chart carries no text alternative, so the one figure on this panel that is only drawn is '
            + 'unavailable to anyone not looking at it');
        const low = (mi.querySelector('.mi-lbl-low') || {}).textContent || '';
        const said = (txt.match(/\$[\d,]+ negative/) || [''])[0].replace(' negative', '');
        if (low && said && low.replace(/[^\d]/g, '') !== said.replace(/[^\d]/g, ''))
          say('the chart labels the trough "' + low + '" and the sentence under it says ' + said);
        // both regions must be drawable, or the diverging form is decoration
        if (!svg.querySelector('.mi-area-dn') || !svg.querySelector('.mi-area-up'))
          say('the chart draws only one side of the zero line, so "above the line is their money, below it is '
            + 'yours" is not actually shown');
        if (!svg.querySelector('.mi-zero')) say('the chart has no zero line, which is the only thing that '
          + 'makes the two fills mean anything');
        /* NOT stretched. preserveAspectRatio="none" scales the TEXT with the
           box and smears every label — it shipped that way for one build. */
        if ((svg.getAttribute('preserveAspectRatio') || '') === 'none')
          say('the chart is scaled non-uniformly, which stretches its labels into illegibility');
      }
      // the rows have to identify the work
      const li = [...mi.querySelectorAll('.ptr-mi-list li')];
      out.rowsListed = li.length;
      const nameless = li.filter(x => (x.textContent || '').replace(/[^A-Za-z]/g, '').length < 4);
      if (li.length && nameless.length)
        say(nameless.length + ' of ' + li.length + ' listed activities carry no readable name — a list of '
          + 'money against work nobody can identify cannot be acted on');
    }
    revTerms = JSON.parse(before);

    /* ── 8b. A RETAINER IS OWED WHETHER OR NOT THE PERIOD WAS BUSY ──────────
       Every other arrangement takes its shape from the plan and its total from
       the fee. This one takes neither: the amount is contractual and the count
       is calendar. The failure worth catching is it quietly behaving like the
       others — scaling to the fee, skipping a quiet week, or reconciling the
       difference away instead of reporting it. */
    ran('8b·retainerIsFixed');
    revTerms = { kind: 'retainer', days: 7, period: 'week', retainer: 5000, deposit: 0 };
    const rp = retainerPeriods(false, lv);
    if (!rp.length)
      say('the fixture produces no retainer period, so every retainer check below reads an empty list');
    else {
      const rc = revSpread(false, lv, { cash: true });
      const amounts = rc.segs.map(s => Math.round(s.c));
      if (!amounts.length || !amounts.every(a => a === 5000))
        say('a retainer curve places amounts ' + [...new Set(amounts)].slice(0, 4).join('/')
          + ' rather than the contracted 5000 on every period — it is being scaled by the work');
      if (Math.round(rc.placed) !== rp.length * 5000)
        say('a retainer places ' + Math.round(rc.placed) + ' across ' + rp.length + ' periods instead of '
          + (rp.length * 5000));
      /* A QUIET PERIOD IS STILL A PERIOD — and the span has to come from the
         PLAN, not from rp. Measuring rp[last] - rp[0] asks the answer to check
         itself: drop every workless week and both ends move together, so the
         comparison holds no matter how many periods went missing. */
      const wk = 7 * 86400000;
      const weeksAcross = () => {
        const l2 = leafTasks();
        const fin = Math.max(...l2.map(t => (t.finishDate instanceof Date && !isNaN(t.finishDate.getTime()))
          ? stripTime(t.finishDate).getTime() : 0));
        return Math.floor((fin - stripTime(projectStartDate()).getTime()) / wk) + 1;
      };
      if (rp.length !== weeksAcross())
        say('the retainer bills ' + rp.length + ' weeks across a ' + weeksAcross() + '-week engagement — a week '
          + 'with no work in it is still retained');
      /* A GAP HAS TO EXIST FOR "a quiet week is still billed" TO MEAN ANYTHING.
         This fixture runs work continuously, so a build that skipped empty weeks
         skipped none of them and no count could tell. The gap is therefore MADE:
         the last activity is pinned a month out, which opens four workless weeks
         in the middle, and the retainer must bill straight through them. */
      const snapshot = JSON.stringify(serialize());
      try {
        const last = lv.slice().sort((a, b) => (b.finishDate || 0) - (a.finishDate || 0))[0];
        const finAll = Math.max(...lv.map(t => t.finishDate ? stripTime(t.finishDate).getTime() : 0));
        last.startNoEarlier = fmtISO(new Date(finAll + 28 * 86400000));
        calculate();
        const gapWeeks = weeksAcross();
        const rp2 = retainerPeriods(false, leafTasks());
        if (gapWeeks <= rp.length)
          say('pinning an activity a month out did not lengthen the engagement, so the quiet-week check '
            + 'below has no gap to look at and proves nothing');
        else if (rp2.length !== gapWeeks)
          say('with four workless weeks in the middle the retainer bills ' + rp2.length + ' of ' + gapWeeks
            + ' weeks — a week the client retained but nobody was busy is still owed');
        else {
          const starts = rp2.map(x => x.start).sort((a, b) => a - b);
          const broken = starts.some((x, i) => i && Math.round((x - starts[i - 1]) / wk) !== 1);
          if (broken) say('the retainer period sequence skips a week rather than running contiguously');
        }
      } finally { hydrate(JSON.parse(snapshot)); calculate(); }
      // the ACCRUAL is the comparison and must still follow the work
      const ra = revSpread(false, lv, { cash: false });
      if (near(ra.placed, rc.placed, 0.01) && Math.abs(ra.total - rc.placed) > 1)
        say('the accrual curve moved with the retainer, so there is nothing left to compare it against');
      // and the SOW states the reconciliation rather than hiding it
      const rplan = sowPaymentPlan();
      if (rplan.rows.length !== rp.length)
        say('the SOW payment schedule shows ' + rplan.rows.length + ' periods against ' + rp.length + ' retained');
      if (Math.abs(rplan.retainerGap - (rp.length * 5000 - rplan.total)) > 1)
        say('the SOW does not state the gap between the retainer total and the priced work');
      if (rplan.total > 0 && Math.abs(rplan.retainerGap) > 1) {
        const rd = sowSkeletonData(); rd.storiesAppendix = '';
        const rh = String(sowAssembleHtml(rd, null)).replace(/<[^>]+>/g, ' ');
        if (!/(shortfall of|margin of)/.test(rh))
          say('the retainer and the priced work disagree by ' + Math.round(rplan.retainerGap)
            + ' and the SOW says nothing about it');
        if (!/whether or not the period is fully utilised/.test(rh))
          say('the SOW describes a retainer without saying it is owed whether or not the period is used');
      }
      /* THE LEFTOVER LOOP, WHERE IT IS LOAD-BEARING. Under milestone billing the
         tail after the final checkpoint is often empty, so deleting the loop
         changed nothing a milestone-only check could see. Under monthly terms
         EVERY payment goes through it, and its removal zeroes the schedule. */
      revTerms = { kind: 'monthly', days: 30, deposit: 0 };
      const mplan = sowPaymentPlan();
      if (mplan.total > 0) {
        if (!mplan.rows.length)
          say('monthly billing produces no payment rows at all');
        if (Math.abs(mplan.total - mplan.scheduled) > 1)
          say('a monthly schedule totals ' + Math.round(mplan.scheduled) + ' against a price of '
            + Math.round(mplan.total) + ' — money the client is signing for lands on no invoice date');
      }
      revTerms = { kind: 'retainer', days: 7, period: 'week', retainer: 5000, deposit: 0 };

      // no amount set must not read as a signed schedule of zeroes
      revTerms = { kind: 'retainer', days: 7, period: 'week', retainer: 0, deposit: 0 };
      const zplan = sowPaymentPlan();
      if (zplan.rows.length && zplan.rows.every(r => !(r.amount > 0))
          && Math.abs(zplan.retainerGap) < 1)
        say('a retainer with no amount produces a schedule of zeroes that reconciles to nothing and '
          + 'reports no gap');
    }
    revTerms = JSON.parse(before);

    /* ── 9. NONE OF IT TOUCHES EARNED VALUE ─────────────────────────────────
       CPI, SPI and EAC are defined on accrued cost. A receipt reaching them
       would produce a confident number that means nothing. */
    ran('9·evmUntouched');
    const ev0 = earnedValue(), ac0 = leafTasks().reduce((s, t) => s + actualCostOf(t), 0);
    const t1 = lv.find(t => !t.isSummary && taskBilledValue(t) > 0);
    if (t1) {
      const ki = t1.invoiced, kp = t1.paid;
      t1.invoiced = 99999; t1.paid = 99999;
      const ev1 = earnedValue(), ac1 = leafTasks().reduce((s, t) => s + actualCostOf(t), 0);
      if (!near(ev0, ev1, 0.01)) say('recording an invoice changed earned value');
      if (!near(ac0, ac1, 0.01)) say('recording a receipt changed actual cost');
      t1.invoiced = ki; t1.paid = kp;
    }

    return { contradictions: bad, counts: out };
  });

  R.pageErrors = errs.slice(0, 8);
  console.log(JSON.stringify(R, null, 1));
  await b.close();
  if (R.contradictions.length || errs.length) process.exitCode = 1;
})();
