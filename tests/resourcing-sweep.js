/* ═══════════════════════════════════════════════════════════════════════════
   CAN WE ACTUALLY COMMIT TO THIS DATE?

   The resourcing panel answers that, and the unit it answers in is easy to
   mislabel: computeResourceLoad counts (resource × day) PAIRS over capacity,
   not days and not people. "12 over-allocated resource-days" across three
   people in one week is a different conversation from twelve days of one
   person, and a surface that prints the pair count while its sentence says
   "days" has told you the wrong thing while being arithmetically right.

   Every check here recomputes from the stored fields — dates, units, capacity,
   PTO — rather than reading resourceLoad back, and then asks whether what the
   screen SAYS matches what the count MEANS.
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
  await page.waitForTimeout(700);

  const R = await page.evaluate(() => {
    const bad = [];
    const say = (a, b2) => bad.push(a + ' :: ' + b2);
    const strip = h => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

    /* Independent recount, straight off perResource.days. Deliberately not
       reading overResourceDays: the point is to know what that number counts. */
    const recount = () => {
      const rl = resourceLoad || computeResourceLoad();
      let pairs = 0, ptoPairs = 0;
      const people = new Set(), days = new Set();
      Object.values(rl.perResource).forEach(Rr => {
        const pto = Rr.ptoSet || new Set();
        Object.keys(Rr.days).forEach(iso => {
          const d = Rr.days[iso];
          const allDone = d.tasks.every(id => {
            const tt = tasks.find(x => x.id === id); return tt && (tt.percentComplete || 0) >= 100; });
          if (allDone) return;
          const capToday = pto.has(iso) ? 0 : Rr.capacity;
          if (d.load > capToday + 1e-6) { pairs++; people.add(Rr.name); days.add(iso);
            if (pto.has(iso)) ptoPairs++; }
        });
      });
      return { pairs, people: people.size, days: days.size, ptoPairs };
    };

    const rl = computeResourceLoad();
    const mine = recount();

    // ── 1. the number is a PAIR count, and the sentence must not call it else ──
    if (rl.overResourceDays !== mine.pairs)
      say('computeResourceLoad', 'reports ' + rl.overResourceDays + ' over-allocated resource-days; an '
        + 'independent recount finds ' + mine.pairs);
    if (rl.resourcesOver.length !== mine.people)
      say('computeResourceLoad', 'names ' + rl.resourcesOver.length + ' over-allocated people; recount finds '
        + mine.people);

    // ── 2. exactly AT capacity is not over ────────────────────────────────
    const atCapacity = (() => {
      const t = leafTasks().find(x => !x.milestone && (x.te || 0) > 0 && taskParticipants(x).length === 1);
      if (!t) return null;
      const who = taskParticipants(t)[0].name;
      const savedU = (t.attendees || []).slice(), savedOwner = t.owner;
      const cap = getCapacity(who);
      // put them at exactly capacity on this task and nothing else
      const before = computeResourceLoad().overResourceDays;
      t.owner = who; t.attendees = [];
      if (resources[who]) resources[who].capacity = 100;
      t.units = 100;
      calculate();
      const at = computeResourceLoad();
      const flagged = at.resourcesOver.indexOf(who) >= 0;
      if (resources[who]) resources[who].capacity = cap;
      t.attendees = savedU; t.owner = savedOwner;
      calculate();
      return { who, flaggedAtExactlyCapacity: flagged, before };
    })();
    if (atCapacity && atCapacity.flaggedAtExactlyCapacity)
      say('Capacity', atCapacity.who + ' is flagged over-allocated at exactly 100% of a 100% capacity — '
        + 'full is not over');

    // ── 3. PTO: any assigned work on a day off is a conflict ──────────────
    const ptoCase = (() => {
      const t = leafTasks().find(x => !x.milestone && (x.te || 0) > 0 && x.startDate
        && (x.percentComplete || 0) < 100 && taskParticipants(x).length);
      if (!t) return null;
      const who = (taskParticipants(t)[0] || {}).name;
      if (!who || !resources[who]) return null;
      const savedPto = resources[who].pto;
      const day = fmtISO(t.startDate);
      const before = computeResourceLoad();
      const beforeN = before.overResourceDays;
      resources[who].pto = day;                    // they are off the day their work starts
      const after = computeResourceLoad();
      const rose = after.overResourceDays > beforeN;
      const named = after.resourcesOver.indexOf(who) >= 0;
      resources[who].pto = savedPto;
      computeResourceLoad();
      if (!rose) say('PTO', who + ' has work on ' + day + ' and is booked off that day, and the '
        + 'over-allocation count did not move — a day off with work on it is a conflict');
      if (!named) say('PTO', who + ' is booked off on a day they are assigned work and is not named as over-allocated');
      return { who, day, rose, named, beforeN, afterN: after.overResourceDays };
    })();

    // ── 4. finished work is history; work in flight is not ────────────────
    const doneRule = (() => {
      const t = leafTasks().find(x => !x.milestone && (x.te || 0) > 0 && taskParticipants(x).length);
      if (!t) return null;
      const who = taskParticipants(t)[0].name;
      const savedPct = t.percentComplete, savedCap = resources[who] ? resources[who].capacity : null;
      if (resources[who]) resources[who].capacity = 10;   // force a conflict
      t.percentComplete = 0; calculate();
      const live = computeResourceLoad().overResourceDays;
      t.percentComplete = 100; calculate();
      const done = computeResourceLoad().overResourceDays;
      t.percentComplete = 50; calculate();
      const half = computeResourceLoad().overResourceDays;
      if (resources[who]) resources[who].capacity = savedCap;
      t.percentComplete = savedPct; calculate();
      if (!(live > done)) say('Finished work', 'a double-booking on ' + t.name
        + ' still counts after it is complete — a conflict you can no longer act on is history, not a finding');
      if (half < live) say('Half-finished work', 'a double-booking on ' + t.name
        + ' stops counting at 50% complete — it is still an unresolved conflict');
      return { live, done, half };
    })();

    // ── 5. every surface must quote the SAME number ───────────────────────
    const n = computeResourceLoad().overResourceDays;
    const lint = lintPlan().filter(f => /Resourcing/.test(f.area));
    lint.forEach(f => {
      const m = String(f.finding).match(/(\d+)\s+over-allocated resource-day/);
      if (m && +m[1] !== n)
        say('Health check', 'reports ' + m[1] + ' over-allocated resource-days; computeResourceLoad says ' + n);
    });
    clientSafeReports = false;
    const rep = strip(buildStatusReportHtml());
    const repM = rep.match(/(\d+)\s+over-allocated resource-day/);
    if (repM && +repM[1] !== n)
      say('Status report', 'reports ' + repM[1] + ' over-allocated resource-days; computeResourceLoad says ' + n);
    if (n > 0 && !repM && /Resourcing/.test(rep))
      say('Status report', 'has a resourcing line and does not state the ' + n + ' over-allocated resource-days');

    // ── 6. the panel on screen ────────────────────────────────────────────
    switchTab('resources'); renderResources();
    const host = document.getElementById('resourcesContainer');
    const txt = host ? strip(host.innerHTML) : '';
    if (/NaN|Infinity|undefined/.test(txt)) say('Resources panel', 'prints a broken figure');
    const panelM = txt.match(/(\d+)\s+over-allocated resource-day/);
    if (panelM && +panelM[1] !== n)
      say('Resources panel', 'shows ' + panelM[1] + ' over-allocated resource-days; computeResourceLoad says ' + n);
    /* THE UNIT. The count is (person × day) pairs. A sentence that calls it
       "days" turns twelve pairs across three people in one week into "twelve
       days", which is a different and much worse-sounding fact. */
    if (n > 0) {
      const callsThemDays = /(\d+)\s+days?\s+over-allocated|over-allocated\s+(?:by\s+)?(\d+)\s+days?\b/i.test(txt);
      if (callsThemDays && mine.days !== mine.pairs)
        say('Resources panel', 'calls the count "days" while it is ' + mine.pairs + ' person-day pairs across '
          + mine.people + ' people on ' + mine.days + ' distinct dates');
    }

    // ── 7. levelling must actually reduce the count, or say it cannot ─────
    const levelling = (() => {
      if (typeof autoLevel !== 'function') return null;
      const t = leafTasks().find(x => !x.milestone && (x.te || 0) > 0 && taskParticipants(x).length);
      if (!t) return null;
      const who = taskParticipants(t)[0].name;
      const savedCap = resources[who] ? resources[who].capacity : null;
      const savedTasks = JSON.stringify(tasks.map(x => ({ id: x.id, preds: x.predecessors })));
      if (resources[who]) resources[who].capacity = 10;
      calculate();
      const before = computeResourceLoad().overResourceDays;
      let after = before, threw = null;
      try { autoLevel(); after = computeResourceLoad().overResourceDays; }
      catch (e) { threw = e.message; }
      if (threw) say('Levelling', 'threw: ' + threw);
      if (resources[who]) resources[who].capacity = savedCap;
      return { before, after, threw, reduced: after <= before };
    })();
    if (levelling && !levelling.threw && levelling.after > levelling.before)
      say('Levelling', 'left MORE conflicts than it started with (' + levelling.before + ' → ' + levelling.after + ')');

    /* ═══ A CONSTRUCTED CONFLICT ══════════════════════════════════════════
       Everything above ran against a plan with zero over-allocation, which
       makes a count check vacuously true — the exact trap the sample data set
       for months. So: build a real one, across two people and several days,
       and ask every surface to account for it. */
    const built = (() => {
      hydrate(JSON.parse(JSON.stringify(window.__fixture))); calculate();
      const work = leafTasks().filter(x => !x.milestone && (x.te || 0) > 0
        && (x.percentComplete || 0) < 100 && taskParticipants(x).length);
      if (work.length < 2) return null;
      // halve two people's capacity so their existing work overruns it
      const names = [];
      work.slice(0, 2).forEach(t => {
        const nm = taskParticipants(t)[0].name;
        if (resources[nm] && names.indexOf(nm) < 0) { resources[nm].capacity = 25; names.push(nm); }
      });
      calculate();
      const rl2 = computeResourceLoad();
      const mine2 = recount();
      const out = { people: names, pairs: rl2.overResourceDays, recount: mine2,
                    named: rl2.resourcesOver.slice() };

      if (rl2.overResourceDays !== mine2.pairs)
        say('Constructed conflict', 'reports ' + rl2.overResourceDays + ' resource-days; recount finds ' + mine2.pairs);
      if (rl2.overResourceDays === 0)
        say('Constructed conflict', 'two people at 25% capacity against 100%-unit work produced no conflict at all');

      // the tasks themselves must carry the mark, or the Gantt cannot show it
      const marked = tasks.filter(t => t.overallocated).length;
      if (rl2.overResourceDays > 0 && marked === 0)
        say('Constructed conflict', 'no task is marked overallocated while ' + rl2.overResourceDays
          + ' resource-days are in conflict — the Gantt has nothing to draw');
      out.tasksMarked = marked;

      // every surface must quote THIS number
      const n2 = rl2.overResourceDays;
      lintPlan().filter(f => /Resourcing/.test(f.area)).forEach(f => {
        const m = String(f.finding).match(/(\d+)\s+over-allocated resource-day/);
        if (m && +m[1] !== n2)
          say('Health check', 'reports ' + m[1] + ' over-allocated resource-days against ' + n2);
      });
      clientSafeReports = false;
      const rep2 = strip(buildStatusReportHtml());
      const rm = rep2.match(/(\d+)\s+over-allocated resource-day/);
      out.reportSays = rm ? +rm[1] : null;
      if (rm && +rm[1] !== n2)
        say('Status report', 'reports ' + rm[1] + ' over-allocated resource-days against ' + n2);
      if (!rm && n2 > 0)
        say('Status report', 'never mentions the ' + n2 + ' over-allocated resource-days');
      // and it must name WHO, not only how many
      out.reportNamesWho = names.every(nm => rep2.indexOf(nm) >= 0);
      if (n2 > 0 && !out.reportNamesWho)
        say('Status report', 'states a count without naming the over-allocated people');

      switchTab('resources'); renderResources();
      const h2 = document.getElementById('resourcesContainer');
      const t2 = h2 ? strip(h2.innerHTML) : '';
      out.panelSays = (t2.match(/(\d+)\s+over-allocated resource-day/) || [])[1] || null;
      if (out.panelSays && +out.panelSays !== n2)
        say('Resources panel', 'shows ' + out.panelSays + ' against ' + n2);
      /* THE TAB THAT OWNS THE PROBLEM MUST STATE ITS SIZE. The count lived on
         the Analytics card and in the status report and nowhere on the screen
         you open in order to fix it. */
      if (n2 > 0 && !out.panelSays)
        say('Resources panel', 'never states the total — ' + n2 + ' over-allocated resource-days across '
          + names.length + ' people, and the tab you fix it on does not say how big it is');
      if (/NaN|Infinity|undefined/.test(t2)) say('Resources panel', 'prints a broken figure under conflict');

      // levelling must reduce it
      const beforeL = n2;
      let afterL = n2, threwL = null;
      try { autoLevel(); afterL = computeResourceLoad().overResourceDays; }
      catch (e) { threwL = e.message; }
      const lvlEl = document.getElementById('levelStatus');
      const lvlTxt = lvlEl ? lvlEl.textContent : '';
      out.level = { before: beforeL, after: afterL, threw: threwL, status: lvlTxt.slice(0, 150) };
      if (threwL) say('Levelling', 'threw under a real conflict: ' + threwL);
      else if (afterL > beforeL)
        say('Levelling', 'left more conflicts than it started with (' + beforeL + ' → ' + afterL + ')');
      /* THE UNIT, IN THE LINE YOU READ RIGHT AFTER CLICKING THE BUTTON. The
         count is (person × day) pairs, which every other surface calls a
         resource-day; "Over-allocated days 12 → 4" reads as calendar days and
         the two differ the moment two people are over on the same date. */
      if (lvlTxt && /Over-allocated days/.test(lvlTxt))
        say('Levelling', 'reports "Over-allocated days" — the figure is ' + beforeL
          + ' person-day pairs, not ' + beforeL + ' calendar days');
      if (lvlTxt && afterL > 0 && !/resource-days/.test(lvlTxt))
        say('Levelling', 'states a remaining count without naming the unit it is in');
      if (lvlTxt && afterL === 0 && !/resolved/i.test(lvlTxt))
        say('Levelling', 'resolved every conflict and does not say so');
      return out;
    })();

    /* ── THE HEATMAP MUST USE THE PANEL'S OWN DEFINITION OF "OVER" ───────────
       computeResourceLoad does not count a day whose overlapping work is all
       FINISHED — a double-booking already lived through is history, and the rule
       is pinned in the written plan (N20/N21). The heatmap cell, its tooltip and
       the day drill-in each re-asked the question with a naive `load > capacity`
       and therefore disagreed with the row badge beside them: a red cell and a
       drill-in headed "⚠ over" two inches from a badge reading OK.

       It was not only cosmetic. The drill-in offered "↓ Jump to fix suggestions"
       pointing at a mend card that is only ever built for people in
       resourcesOver, so on a settled day getElementById returned null and the
       button did nothing whatsoever — no scroll, no message, no console error.
       Reported by a user as "clicking on fix suggestion doesn't work".

       Three properties, all against the DRAWN panel: no cell may be painted as a
       conflict that overDays does not hold, a jump button may exist only where
       its target exists, and a day the rule discounts has to SAY that rather
       than go quiet. */
    const heatmap = (() => {
      const out = {};
      switchTab('resources'); renderResources();
      const host = document.getElementById('resourcesContainer');
      const rl3 = computeResourceLoad();
      const truth = new Set();
      Object.keys(rl3.perResource).forEach(nm =>
        (rl3.perResource[nm].overDays || []).forEach(iso => truth.add(nm + '|' + iso)));
      out.overDayPairs = truth.size;

      const rows = host ? [...host.querySelectorAll('.rl-row')] : [];
      out.rows = rows.length;
      if (!rows.length) { say('Heatmap', 'drew no resource rows, so nothing below was tested'); return out; }

      let painted = 0, wrong = 0, firstWrong = null;
      rows.forEach(row => {
        const nm = (row.querySelector('.rl-label div') || {}).title || '';
        [...row.querySelectorAll('.rl-cell')].forEach(c => {
          const drill = c.dataset.rlDrill;
          if (!c.classList.contains('over')) return;
          painted++;
          const iso = drill ? drill.split('|')[1] : null;
          if (!iso || !truth.has(nm + '|' + iso)) {
            wrong++;
            if (!firstWrong) firstWrong = nm + ' on ' + (iso || '?');
          }
        });
      });
      out.paintedOver = painted; out.paintedNotCounted = wrong;
      if (wrong)
        say('Heatmap', wrong + ' cell(s) are painted as over capacity that the panel does not count as '
          + 'conflicts (first: ' + firstWrong + ') — the row badge beside them reads OK, and the mend cards '
          + 'below have nothing for them');

      /* and the drill-in: open a day the rule DISCOUNTS and check what it does.
         Constructed rather than hoped for — no committed fixture is guaranteed to
         carry a finished double-booking, and a case that only sometimes runs is a
         case that eventually never runs. */
      const settled = (() => {
        for (const row of rows) {
          const nm = (row.querySelector('.rl-label div') || {}).title || '';
          const R4 = rl3.perResource[nm];
          if (!R4) continue;
          const iso = Object.keys(R4.days || {}).find(k =>
            R4.days[k].load > R4.capacity + 1e-6 && (R4.overDays || []).indexOf(k) < 0);
          if (iso) return { row, nm, iso };
        }
        return null;
      })();
      out.settledDayFound = !!settled;
      if (!settled) { out.settledCase = 'SKIPPED-no-finished-double-booking'; return out; }
      const cell = [...settled.row.querySelectorAll('.rl-cell')]
        .find(c => (c.dataset.rlDrill || '').split('|')[1] === settled.iso);
      if (!cell) { say('Heatmap', 'a discounted over-day has no clickable cell to explain itself'); return out; }
      cell.click();
      const drillHost = document.getElementById('rlDrill');
      const txt = drillHost ? drillHost.textContent.replace(/\s+/g, ' ') : '';
      out.settledDrill = txt.slice(0, 80);
      const jump = drillHost ? [...drillHost.querySelectorAll('button')]
        .find(b => /fix suggestions/i.test(b.textContent)) : null;
      out.settledOffersJump = !!jump;
      if (jump) {
        const m = (jump.getAttribute('onclick') || '').match(/(\d+)/);
        const target = m ? document.getElementById('rlconf-' + m[1]) : null;
        if (!target)
          say('Heatmap drill-in', 'a day the panel does not count as a conflict offers "Jump to fix '
            + 'suggestions", and the card it points at does not exist — the button does nothing at all');
      }
      if (/⚠ over/.test(txt))
        say('Heatmap drill-in', 'heads a discounted day "⚠ over" while the row badge for the same person '
          + 'reads OK — two readings of one day, three inches apart');
      if (!/finished/i.test(txt))
        say('Heatmap drill-in', 'shows a day above capacity, offers nothing to do about it, and never says '
          + 'why — the reader is left to work out that finished work is not counted');
      if (drillHost) drillHost.innerHTML = '';

      /* The roster table states a RAW peak beside a rule-aware status badge, so
         "Peak load 200%" can sit next to a green OK. Both are true; together they
         read as a contradiction, and it is the same collision one surface over.
         Where they disagree the badge has to say which rule it applied. */
      const rosterRows2 = host ? [...host.querySelectorAll('table tbody tr')] : [];
      let mute = 0;
      rosterRows2.forEach(tr => {
        const nm = (tr.querySelector('td') || {}).textContent || '';
        const R5 = rl3.perResource[nm.replace(/\s*CLIENT\s*$/, '').trim()];
        if (!R5 || (R5.overDays || []).length) return;
        if (!(R5.peak > R5.capacity + 1e-6)) return;
        mute++;
        const badge = tr.querySelector('.badge-ok');
        if (badge && /^OK$/.test((badge.textContent || '').trim()))
          say('Roster', nm.trim() + ' shows a peak of ' + Math.round(R5.peak) + '% against '
            + R5.capacity + '% capacity and a bare green OK beside it — two readings of the same person '
            + 'in adjacent cells, with nothing saying the peak is on work that is already finished');
      });
      out.rosterPeakAbovePlainOk = mute;

      /* ── EFFORT AND VARIANCE PER PERSON MUST ADD UP TO THE PLAN ────────────
         A new per-person effort table is a new place for the plan's effort to be
         restated, and the failure that matters is not a wrong row — it is a
         column that does not sum to what every other surface says. Two identities:

           each person's Planned equals the roster's own Planned effort column,
           computed here independently (TE in working days × their allocation),
           and the two must not drift apart;

           the SHARE weighting is real. An activity two people split at 50% each
           contributes half its effort to each. Drop the weighting and the column
           double-counts every shared activity, which on a plan with joint work
           silently inflates the project's effort — the exact class of defect the
           resource unit trap already taught this file. */
      const eff = resourceEffortData();
      out.effortPeople = eff.length;
      const wd = t => unitToWorkingDays(Number(t.te) || 0);
      const indep = {};
      let sharedSeen = 0;
      tasks.filter(t => !t.isSummary && !t.milestone).forEach(t => {
        const parts = taskParticipants(t);
        if (parts.length > 1) sharedSeen++;
        parts.forEach(pr => {
          const u2 = (Number(pr.units) || 0) / 100;
          if (u2 <= 0) return;
          indep[pr.name] = (indep[pr.name] || 0) + wd(t) * u2;
        });
      });
      out.sharedActivities = sharedSeen;
      eff.forEach(r => {
        const want = indep[r.name] || 0;
        if (Math.abs(r.planDays - want) > 0.01)
          say('Effort by person', r.name + ' is shown ' + r.planDays.toFixed(2) + ' planned days against '
            + want.toFixed(2) + ' recomputed from their allocation — the table and the roster disagree '
            + 'about the same person on the same plan');
      });
      const totShown = eff.reduce((s2, r) => s2 + r.planDays, 0);
      const totIndep = Object.keys(indep).reduce((s2, k) => s2 + indep[k], 0);
      out.effortPlannedTotal = +totShown.toFixed(2);
      if (Math.abs(totShown - totIndep) > 0.02)
        say('Effort by person', 'the column totals ' + totShown.toFixed(2) + ' planned days against '
          + totIndep.toFixed(2) + ' across the plan');
      /* the weighting has to be OBSERVABLE, or the identity above is satisfied by
         two functions making the same mistake. Sum the UNWEIGHTED effort and
         require it to differ — if it does not, this fixture has no shared or
         part-time work and the check proves nothing about weighting. */
      const unweighted = tasks.filter(t => !t.isSummary && !t.milestone)
        .reduce((s2, t) => s2 + wd(t) * taskParticipants(t).length, 0);
      out.unweightedTotal = +unweighted.toFixed(2);
      if (Math.abs(unweighted - totIndep) < 0.02)
        out.weightingCase = 'SKIPPED-no-shared-or-part-time-work';
      else if (Math.abs(totShown - unweighted) < 0.02)
        say('Effort by person', 'the column adds to the UNWEIGHTED total (' + unweighted.toFixed(2)
          + '), so an activity two people share is counted whole against each of them and the plan\'s '
          + 'effort is inflated by every piece of joint work');
      // variance is logged − earned, never logged − the whole estimate
      eff.filter(r => r.varDays != null).forEach(r => {
        const naive = r.actDays - r.refDays;
        if (Math.abs(r.varDays - naive) > 0.01 && Math.abs(r.varDays - (r.actDays - r.earnedDays)) > 0.01)
          say('Effort by person', r.name + '\'s variance is neither logged−earned nor logged−estimate; '
            + 'it is ' + r.varDays.toFixed(2) + ' with ' + r.actDays.toFixed(2) + ' logged, '
            + r.earnedDays.toFixed(2) + ' earned and ' + r.refDays.toFixed(2) + ' estimated');
      });
      const midFlight = eff.find(r => r.varDays != null && r.earnedDays > 0.01
        && Math.abs(r.earnedDays - r.refDays) > 0.5);
      out.partWayCase = midFlight ? midFlight.name : 'SKIPPED-nobody-part-way';
      if (midFlight && Math.abs(midFlight.varDays - (midFlight.actDays - midFlight.refDays)) < 0.01)
        say('Effort by person', midFlight.name + ' is part way through their work and the variance is '
          + 'measured against the WHOLE estimate — that reports a saving nobody has made yet, and it '
          + 'turns into an overrun as the remaining work is done');
      // and it has to be drawn, not merely computed
      const effTxt = host ? host.textContent.replace(/\s+/g, ' ') : '';
      out.effortTableDrawn = /Effort & variance by person|Effort &amp; variance by person/.test(effTxt);
      if (!out.effortTableDrawn)
        say('Effort by person', 'the breakdown is computed and never drawn on the tab it belongs to');
      return out;
    })();

    hydrate(JSON.parse(JSON.stringify(window.__fixture))); calculate();

    return { contradictions: bad, count: n, recount: mine, built,
             overPeople: rl.resourcesOver, atCapacity, ptoCase, doneRule, levelling, heatmap,
             lintFindings: lint.map(f => String(f.finding).slice(0, 80)) };
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
