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
    switchTab('resources');
    /* The workload section, selected by name. Since the team tab was split into
       four sections, reaching the tab no longer paints the heatmap or the
       over-allocation total — those live on Workload, and which section is
       showing is a remembered preference rather than anything this file sets.
       Without this the whole group reads an empty container and reports the
       product for drawing nothing. */
    if (typeof setResTab === 'function') setResTab('workload'); else renderResources();
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

    /* ── 6b. A ROLE YOU CANNOT READ ────────────────────────────────────────
       The roster's role field borrowed `.mini-inp`, which is 64px because it
       was built for a NUMBER, and holds things like "Principal Consultant and
       Delivery Lead" — so every role on the team read as a truncated fragment
       and two people with the same job family were indistinguishable. Reported
       by use: "the role is not fully readable in here".

       The property asserted is NOT a width. A width is a number that has to be
       re-agreed every time the column layout moves, and it would fail a
       redesign that solved the problem differently. What has to hold is that a
       value the reader cannot see in full is one hover away — the same rule the
       truncated chips elsewhere follow. A box wide enough for the text passes
       trivially; a narrow one passes only if it says the whole thing somewhere.

       CONSTRUCTED, because the fixture's roles are short enough that a 64px box
       would still have been the only thing wrong and nothing here would have
       clipped. Without this the check would pass on the build that prompted it. */
    {
      const names6 = Object.keys(resources || {});
      if (!names6.length) { /* nothing to test on an empty roster */ }
      else {
        const wasRole = resources[names6[0]].role;
        resources[names6[0]].role = 'Principal Consultant and Delivery Lead for the Programme';
        if (typeof setResTab === 'function') setResTab('team');
        renderResources();
        const ins = [...document.querySelectorAll('.rl-role')];
        if (!ins.length)
          say('Roster', 'the role column draws no editable field at all, so the constructed long role was '
            + 'never rendered and nothing below tested anything');
        const bad6 = ins.filter(i => i.scrollWidth > i.clientWidth + 1)
                        .filter(i => String(i.title || '').indexOf(i.value) !== 0);
        if (bad6.length)
          say('Roster', bad6.length + ' role(s) are cut off by their own input and the full text is nowhere '
            + '— not in the title, not anywhere on the row. A truncation is only honest when the whole '
            + 'value is one hover away; otherwise the reader is being shown a fragment and told nothing '
            + 'about it. First: "' + String(bad6[0].value).slice(0, 40) + '"');
        resources[names6[0]].role = wasRole;
        renderResources();
      }
    }

    /* ── 6c. A WEEK THAT IS NOT THE PROJECT'S ──────────────────────────────
       The working week was a PROJECT setting and the only per-person
       availability was PTO, so somebody who works Mon/Wed/Fri was modelled as
       a full-week person who takes a lot of holiday, or not modelled at all.
       Work landing on a day they never work read as an ordinary Tuesday.

       The SUBJECT has to be chosen carefully and the first attempt at this got
       it wrong: days whose every task is finished are deliberately not counted
       as conflicts, so the busiest person on this fixture — whose work is all
       complete — cannot exhibit the condition at all, and removing a working
       day from them changed nothing. Picked by live (unfinished) days now.
       Same mistake as the negative case in baseline-sweep, one file over. */
    {
      const liveIsos = R2 => Object.keys(R2.days).filter(iso => R2.days[iso].tasks.some(id => {
        const t2 = tasks.find(x => x.id === id); return t2 && (t2.percentComplete || 0) < 100; }));
      const cand = Object.values((resourceLoad || computeResourceLoad()).perResource)
        .map(R2 => ({ R: R2, live: liveIsos(R2) }))
        .sort((a2, b2) => b2.live.length - a2.live.length)[0];
      if (!cand || !cand.live.length) { /* nothing with unfinished dated work to test on */ }
      else {
        const who = cand.R.name;
        const base = computeResourceLoad().overResourceDays;
        const dow = new Date(cand.live[0] + 'T00:00:00').getDay();
        // by default a person follows the project week and stores nothing
        if (resWorkDays(who) !== null)
          say('Availability', who + ' carries a stored working week before anyone set one — the default has '
            + 'to be "follows the project", or every existing plan silently acquires a per-person calendar');
        toggleResWorkday(who, dow);
        const after = computeResourceLoad().overResourceDays;
        if (after <= base)
          say('Availability', 'taking a working day away from ' + who + ' — who has unfinished work on '
            + cand.live.length + ' dated days, ' + (cand.live.filter(i2 =>
                new Date(i2 + 'T00:00:00').getDay() === dow).length) + ' of them on that weekday — produced '
            + 'no new conflict. Work scheduled on a day somebody does not work is the same fact as work '
            + 'scheduled on their holiday, and it is being counted as an ordinary day');
        /* AND THE PANEL HAS TO SAY WHICH. A holiday and a day somebody never
           works both zero the capacity, but they are resolved differently —
           one by moving the work, the other by moving it or by correcting what
           you believe about the person. A heatmap that calls both "PTO" sends
           the reader to change a holiday that does not exist. */
        if (typeof setResTab === 'function') setResTab('workload');
        renderResources();
        const hm = (document.getElementById('resourcesContainer') || {}).innerHTML || '';
        if (!/does not work \w+days/.test(hm))
          say('Availability', 'the workload panel does not distinguish a day somebody never works from a day '
            + 'they booked off — the reader is sent to cancel a holiday that was never taken');
        // putting it back must restore BOTH the count and the unset state
        toggleResWorkday(who, dow);
        const restored = computeResourceLoad().overResourceDays;
        if (restored !== base)
          say('Availability', 'restoring the working day left ' + restored + ' conflicts '
            + 'against a baseline of ' + base);
        if (resWorkDays(who) !== null)
          say('Availability', 'a person whose week matches the project again is still storing their own copy '
            + 'of it, so changing the project weekend later would leave them on the old one');
        /* An EMPTY array is the dangerous shape: it is what a hand-edited file
           or a bad export produces, and read literally it means "works no days
           at all", which turns every scheduled day for that person into a
           conflict. It has to coerce back to "follows the project". */
        resources[who].workDays = [];
        hydrate(JSON.parse(JSON.stringify(serialize())));
        calculate();
        if (resWorkDays(who) !== null || computeResourceLoad().overResourceDays !== base)
          say('Availability', 'an empty working-week list survived the load as "works no days", so every '
            + 'scheduled day for that person became a conflict — absent and empty have to mean the same '
            + 'thing here, and that thing is "follows the project"');
      }
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

      switchTab('resources');
      if (typeof setResTab === 'function') setResTab('workload'); else renderResources();
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
      switchTab('resources');
      if (typeof setResTab === 'function') setResTab('workload'); else renderResources();
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
      /* The ROSTER is on the Team section; everything above this point reads the
         Workload one. Splitting the tab moved them apart and this check kept
         reading whichever container happened to be painted, found no rows, and
         passed — the mutation engine caught it by planting the exact defect it
         exists for and watching it survive. Selected explicitly, and the empty
         case is now a finding rather than a quiet pass, because "no rows to
         check" and "every row was fine" were indistinguishable here for
         precisely as long as it took to notice. */
      if (typeof setResTab === 'function') setResTab('team');
      const rosterHost = document.getElementById('resourcesContainer') || host;
      const rosterRows2 = rosterHost ? [...rosterHost.querySelectorAll('table tbody tr')] : [];
      if (!rosterRows2.length)
        say('Roster', 'the roster table drew no rows, so the peak-vs-badge check below compared nothing');
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
      /* ── BY COMPANY IS A PARTITION ─────────────────────────────────────────
         Rolled up from the same per-person shares, so every activity belongs to
         exactly one firm here and the column still adds to the project total.
         Two ways this goes wrong and both are silent: somebody whose company was
         never set is DROPPED, so the table quietly describes part of the roster
         as though it were all of it; or the roll-up double-counts and the total
         stops matching the person table three inches below it. */
      const orgRows = orgEffortRows(eff);
      out.effortCompanies = orgRows.length;
      const orgPlan = orgRows.reduce((s2, r) => s2 + r.planDays, 0);
      const perPlan = eff.reduce((s2, r) => s2 + r.planDays, 0);
      if (Math.abs(orgPlan - perPlan) > 0.02)
        say('Effort by company', 'the company roll-up totals ' + orgPlan.toFixed(2)
          + ' planned days against ' + perPlan.toFixed(2) + ' in the person table it is rolled up FROM — '
          + 'one of them is counting somebody twice or not at all');
      const peopleCovered = orgRows.reduce((s2, r) => s2 + r.people, 0);
      out.effortPeopleCovered = peopleCovered;
      if (peopleCovered !== eff.length)
        say('Effort by company', peopleCovered + ' of ' + eff.length + ' people appear in the company '
          + 'breakdown — anyone whose company is unset must land in a bucket that says so, not vanish');
      // the unset bucket must be labelled, never blank
      const unset = orgRows.find(r => r.unset);
      if (unset && !/no company/i.test(unset.name))
        say('Effort by company', 'people with no company are grouped under "' + unset.name
          + '", which reads as a real firm');

      /* And it has to be drawn, not merely computed — on the section it belongs
         to. Per-person effort is a cost question and lives under Cost & billing
         now, so this reads that section rather than whichever one the heatmap
         checks above left showing. */
      if (typeof setResTab === 'function') setResTab('cost');
      const effHost = document.getElementById('resourcesContainer') || host;
      const effTxt = effHost ? effHost.textContent.replace(/\s+/g, ' ') : '';
      out.effortTableDrawn = /Effort & variance by person|Effort &amp; variance by person/.test(effTxt);
      if (!out.effortTableDrawn)
        say('Effort by person', 'the breakdown is computed and never drawn on the tab it belongs to');
      return out;
    })();

    hydrate(JSON.parse(JSON.stringify(window.__fixture))); calculate();

    /* ═══ THE COMPANY LIST HAS TO BE CORRECTABLE ═══════════════════════════
       The picker could add a company and nothing else, so a typo was permanent
       and two spellings of one firm stayed two partners — in the list whose
       whole job is to be the join key that makes them one. Rename, merge and
       delete are the correction, and each has a way to be wrong: a rename that
       mints a duplicate name, a merge that orphans what pointed at the source,
       a delete that removes an id records still name. */
    (() => {
      const A = orgRegister('ZZ Probe Alpha'), B = orgRegister('ZZ Probe Beta');
      const who = Object.keys(resources)[0];
      if (!who || !A || !B) { say('the company probe could not be set up, so nothing below is tested'); return; }
      const keptId = resources[who].orgId, keptOrg = resources[who].org;
      setResourceOrg(who, A.id);
      if (orgUsage(A.id).total !== 1) say('a company set on the roster is not counted as used, so the '
        + 'delete guard below has nothing to refuse');
      if (!orgDelete(A.id) || !orgFind(A.id))
        say('a company still named by a roster row was deleted — every record naming it now points at nothing');
      if (!orgRename(A.id, 'ZZ Probe Renamed') || (orgFind(A.id) || {}).name !== 'ZZ Probe Renamed')
        say('a company could not be renamed');
      if (resources[who].org !== 'ZZ Probe Renamed')
        say('renaming a company left the roster showing its old name — the id moved and the label did not');
      if (orgRename(A.id, 'ZZ Probe Beta') !== false)
        say('a company was renamed onto a name already on the list, making the duplicate the list exists to prevent');
      const m = orgMerge(A.id, B.id);
      if (!m) say('two companies could not be merged');
      if (orgFind(A.id)) say('a merged-away company is still on the list');
      if (resources[who].orgId !== B.id || resources[who].org !== 'ZZ Probe Beta')
        say('merging did not repoint the roster row onto the surviving company');
      if (Object.keys(resources).some(n => resources[n].orgId && !orgFind(resources[n].orgId)))
        say('a roster row points at a company id that is not on the list');
      if (orgDelete(B.id) === null && orgFind(B.id)) say('deleting an unused company did not remove it');
      saveOrgLib(loadOrgLib().filter(o => !/^ZZ Probe/.test(o.name)));
      resources[who].orgId = keptId; resources[who].org = keptOrg;
    })();

    /* ══ THE LEDGER IS A VIEW OF THE BILLING TABLE, NOT A RIVAL TO IT ═══════
       A fourth money surface that disagrees with the other three is worse than
       no fourth surface, so the identity that matters is arithmetic: with no
       filters, Billed $ summed over every person-day fact MUST equal the
       billing table's Σ Total. Everything else here guards the cuts — that
       narrowing the set actually narrows it, that a period split still adds
       back to the whole, and that undated work is carried rather than dropped. */
    const ledger = (() => {
      const keep = localStorage.getItem('pgt-ledger-view');
      const st = () => ledgerState();
      const setAll = o => { ledgerView = Object.assign(ledgerDefaults(), o); };
      const sum = s2 => { const p = ledgerPivot(s2); return { grand: p.grand, rows: p.rows.length,
        cols: p.colKeys.length, facts: p.facts.length, all: p.allFacts.length }; };
      const out = {};

      setAll({ measure: 'billed', period: 'all', row: 'person' });
      const led = sum(st());
      const bt = billingData().totBill;
      out.tieGap = Math.abs(led.grand - bt);
      if (out.tieGap > 1) say('Ledger', 'unfiltered Billed $ totals ' + led.grand.toFixed(0)
        + ' but the billing table totals ' + bt.toFixed(0) + ' — the two are built from the same rates '
        + 'and one of them is wrong');
      if (!led.rows) say('Ledger', 'the pivot produced no rows at all on a fixture with staffed work');

      /* A PERIOD SPLIT IS A REGROUPING, NOT A RECOMPUTE. Spreading the same
         hours across days and adding them back must land on the same number;
         if it does not, the per-day division has lost or duplicated work, which
         is exactly the defect the weekly timesheet had. */
      ['day', 'week', 'month', 'quarter'].forEach(p => {
        setAll({ measure: 'billed', period: p, row: 'person' });
        const g = sum(st());
        if (Math.abs(g.grand - led.grand) > 1)
          say('Ledger', 'splitting the columns by ' + p + ' changes the total from '
            + led.grand.toFixed(0) + ' to ' + g.grand.toFixed(0) + ' — the split is not a regrouping');
        out['by' + p] = g.cols;
      });

      // Every row dimension must also preserve the total: they are cuts of one set.
      LEDGER_DIMS.forEach(([d]) => {
        setAll({ measure: 'billed', period: 'all', row: d });
        const g = sum(st());
        if (Math.abs(g.grand - led.grand) > 1)
          say('Ledger', 'grouping the rows by "' + d + '" changes the total to ' + g.grand.toFixed(0)
            + ' — a regrouping is not allowed to change the sum');
        if (!g.rows) say('Ledger', 'grouping by "' + d + '" produces no rows');
      });

      /* THE DISCRIMINATING FILTER CASE, CONSTRUCTED. A filter that excludes
         nothing proves nothing, so the check picks a person who is genuinely
         only part of the set and asserts BOTH directions: their slice is
         smaller than the whole, and it is not empty. */
      const people = [...new Set(ledgerFacts().map(f => f.who))];
      out.people = people.length;
      if (people.length < 2) say('Ledger', 'the fixture has fewer than two people, so the person '
        + 'filter cannot be shown to exclude anything and this check is vacuous');
      else {
        setAll({ measure: 'planH', period: 'all', row: 'person' });
        const whole = sum(st());
        setAll({ measure: 'planH', period: 'all', row: 'person', people: [people[0]] });
        const one = sum(st());
        out.filtered = one.facts;
        if (!(one.facts > 0)) say('Ledger', 'filtering to "' + people[0] + '" excluded everything');
        if (!(one.facts < whole.facts)) say('Ledger', 'filtering to one of ' + people.length
          + ' people excluded nothing — the filter is not applied');
        if (!(one.grand < whole.grand - 0.01)) say('Ledger', 'filtering to one person left the total unchanged');
        if (one.rows !== 1) say('Ledger', 'filtering to one person left ' + one.rows + ' rows');
      }

      /* CLIENT-SIDE TIME IS REAL WORK THAT BILLS NOTHING — the distinction the
         whole panel exists to keep, so the ledger must reproduce it: hours
         survive the client-only filter, money does not.

         THE BILL RATE IS SET FIRST, deliberately. The fixture's client-side
         people carry no rate, so "they bill nothing" was true for the boring
         reason and a build that billed them at full rate produced $0 all the
         same — the check passed on exactly the defect it names. Giving them a
         rate is what makes the zero mean "client-side", not "unpriced". */
      const clientWho = [...new Set(ledgerFacts().filter(f => f.client).map(f => f.who))];
      out.anyClient = clientWho.length;
      if (!clientWho.length) say('Ledger', 'no client-side person in the fixture, so the rule that they '
        + 'never bill cannot be shown to hold and this check is vacuous');
      else {
        const keptRate = clientWho.map(w => (resources[w] || {}).billRate);
        clientWho.forEach(w => { if (!resources[w]) resources[w] = { capacity: 100 }; resources[w].billRate = 1500; });
        setAll({ measure: 'planH', period: 'all', row: 'person', side: 'client' });
        const ch = sum(st());
        setAll({ measure: 'billed', period: 'all', row: 'person', side: 'client' });
        const cm = sum(st());
        if (!(ch.grand > 0)) say('Ledger', 'client-side people show no hours, though they do scheduled work');
        if (Math.abs(cm.grand) > 0.5) say('Ledger', 'client-side people carry a bill rate and the ledger '
          + 'charges the client ' + cm.grand.toFixed(0) + ' for them — client-side work is never billed');
        clientWho.forEach((w, i) => { if (keptRate[i] == null) delete resources[w].billRate; else resources[w].billRate = keptRate[i]; });
      }

      /* THE COMPANY FILTER, ON A FIXTURE THAT MAY HAVE ONE FIRM IN IT. Filtering
         to the only company present excludes nothing, so a filter that is never
         applied passes. A second firm is put on one person for the duration of
         the check and taken off again. */
      (() => {
        const whoAll = [...new Set(ledgerFacts().map(f => f.who))];
        if (whoAll.length < 2) { out.orgCheck = 'vacuous — one person'; return; }
        const subject = whoAll[0];
        const keptOrg2 = (resources[subject] || {}).org, keptId2 = (resources[subject] || {}).orgId;
        if (!resources[subject]) resources[subject] = { capacity: 100 };
        resources[subject].orgId = ''; resources[subject].org = 'ZZ Test Partners Ltd';
        setAll({ measure: 'planH', period: 'all', row: 'person' });
        const whole = sum(st());
        setAll({ measure: 'planH', period: 'all', row: 'person', orgs: ['ZZ Test Partners Ltd'] });
        const one = sum(st());
        out.orgFiltered = one.facts;
        if (!(one.facts > 0)) say('Ledger', 'filtering to a company that one person belongs to excluded everything');
        if (!(one.facts < whole.facts)) say('Ledger', 'filtering to one of ' + whoAll.length
          + ' people’s companies excluded nothing — the company filter is not applied');
        if (one.rows !== 1) say('Ledger', 'filtering to a one-person company left ' + one.rows + ' rows');
        resources[subject].org = keptOrg2; resources[subject].orgId = keptId2;
      })();

      /* KEYS THAT CONCATENATE COLLIDE. Grouping Company → Person, a firm called
         "AB" with a person "C" lands in the same cell as firm "A" with person
         "BC" the moment the key is a join rather than a structure — one row's
         money silently added to another's, which is the kind of defect a
         reader can only find by adding the column up by hand. */
      (() => {
        const k1 = ledgerKey('AB', 'C', 'w1'), k2 = ledgerKey('A', 'BC', 'w1');
        if (k1 === k2) say('Ledger', 'the pivot key for (AB, C) is identical to the key for (A, BC), so two '
          + 'different rows share one cell and their money is added together');
        if (ledgerKey('A', 'B', 'w1') !== ledgerKey('A', 'B', 'w1'))
          say('Ledger', 'the same row and period produce two different keys');
      })();

      /* A DATE WINDOW THAT EXCLUDES NOTHING IS NOT A DATE WINDOW. Constructed
         against the real span so it cannot pass by accident on a fixture whose
         dates all sit inside whatever range was hardcoded. */
      const days = ledgerFacts().map(f => f.day).filter(x => x != null).sort((a2, b3) => a2 - b3);
      if (days.length < 2) out.dateCheck = 'vacuous — fewer than two dated facts';
      else {
        const mid = new Date(days[Math.floor(days.length / 2)]);
        setAll({ measure: 'planH', period: 'all', row: 'person', from: fmtISO(mid) });
        const late = sum(st());
        if (!(late.facts > 0)) say('Ledger', 'a From date at the midpoint of the plan excluded every row');
        if (!(late.facts < days.length)) say('Ledger', 'a From date at the midpoint of the plan excluded nothing');
      }

      // The screen itself, not only the arithmetic behind it.
      setAll({ measure: 'billed', period: 'week', row: 'company', row2: 'person' });
      const html = ledgerInnerHtml();
      const flat = strip(html);
      if (!/Total — Billed \$/.test(flat)) say('Ledger', 'the table draws no labelled total row');
      if (flat.indexOf('↳') < 0) say('Ledger', 'a second grouping level was chosen and no sub-rows were drawn');
      if (!/Company/.test(flat)) say('Ledger', 'the header does not name the dimension the rows are grouped by');
      if (html.indexOf('exportLedgerCSV()') < 0) say('Ledger', 'the view cannot be exported');
      setAll({ measure: 'billed', period: 'all', row: 'person' });
      if (strip(ledgerInnerHtml()).indexOf('Ties to the billing table') < 0)
        say('Ledger', 'the unfiltered Billed view does not print its tie-out to the billing table');
      out.rendered = flat.length;

      /* FIXED COSTS ARE NOT ANYBODY'S TIME, and dropping them is precisely how
         the tie-out above would silently break on a plan that has them.

         CONSTRUCTED, because the fixture carries none — so "the ledger has a
         fixed-cost row" was trivially satisfied by a build that has no such
         concept, and the tie-out could not come apart no matter what the code
         did. A licence is put on one activity, the identity is checked while it
         is there, and it is taken off again. */
      out.fixed = (() => {
        const t4 = leafTasks().find(x => !x.isSummary && !x.milestone);
        if (!t4) { say('Ledger', 'no leaf activity to hang a fixed cost on — this check is vacuous'); return null; }
        const kept4 = t4.fixedCost;
        t4.fixedCost = 4321;
        const facts4 = ledgerFacts();
        const fixedFacts = facts4.filter(f => f.kind === 'fixed');
        const res = { rows: fixedFacts.length, sum: fixedFacts.reduce((a2, f) => a2 + f.billed, 0) };
        if (!fixedFacts.length) say('Ledger', 'a 4,321 licence was put on an activity and the ledger has no row '
          + 'for it — the Billed total is now short of the billing table by exactly the non-labour cost');
        else if (Math.abs(res.sum - 4321) > 0.5) say('Ledger', 'the 4,321 licence appears in the ledger as '
          + res.sum.toFixed(0));
        setAll({ measure: 'billed', period: 'all', row: 'person' });
        const g4 = sum(st()), b4 = billingData().totBill;
        res.tieGap = Math.abs(g4.grand - b4);
        if (res.tieGap > 1) say('Ledger', 'with a fixed cost on the plan the ledger totals ' + g4.grand.toFixed(0)
          + ' and the billing table totals ' + b4.toFixed(0) + ' — non-labour money is being counted by one and not the other');
        if (kept4 == null) delete t4.fixedCost; else t4.fixedCost = kept4;
        return res;
      })();

      ledgerView = null;
      try { if (keep == null) localStorage.removeItem('pgt-ledger-view'); else localStorage.setItem('pgt-ledger-view', keep); } catch (e) {}
      return out;
    })();

    /* ══ THE TIMESHEET IS WORK, NOT ELAPSED TIME ═══════════════════════════
       The distinction the whole duration-versus-effort pass exists to hold, and
       the timesheet — the one report anybody reconciles against an invoice —
       had no assertion of any kind on it. A build that reported the calendar
       span as somebody's hours passed every check in this directory.

       CONSTRUCTED at a part-time allocation, because at 100% the two quantities
       are numerically identical and a report that confused them would look
       perfectly correct. The subject is put on 25% for the length of the check
       and put back afterwards. */
    const timesheet = (() => {
      const t5 = leafTasks().find(x => !x.isSummary && !x.milestone && (taskParticipants(x) || []).length === 1);
      if (!t5) { say('Timesheet', 'no single-owner activity to vary the allocation on — this check is vacuous'); return null; }
      const who5 = taskParticipants(t5)[0].name;
      const kept5 = { units: t5.units, parts: t5.participants };
      t5.units = 25; t5.participants = null;
      calculate();
      const row = timesheetRows().find(r => r.id === t5.id && r.who === who5);
      const out = {};
      if (!row) say('Timesheet', 'the activity vanished from the report when its allocation changed');
      else {
        const span = unitToWorkingDays(t5.te || 0);
        out.spanH = Math.round(span * 8 * 10) / 10;
        out.planH = Math.round(row.planH * 10) / 10;
        if (Math.abs(row.planH - span * 0.25 * 8) > 0.05)
          say('Timesheet', 'a person on 25% of a ' + out.spanH + 'h activity is shown as owing '
            + out.planH + 'h — planned hours must be the span times their allocation, not the span');
        if (Math.abs(row.planH - span * 8) < 0.05)
          say('Timesheet', 'planned hours equal the full elapsed span, so the report is quoting how long '
            + 'the activity stays open as though it were one person’s work');
        // and the weekly split must still add back to it
        const wk = timesheetByWeek([row]).reduce((a2, w) => a2 + w.planH, 0);
        out.weekSum = Math.round(wk * 10) / 10;
        if (row.planH > 0 && Math.abs(wk - row.planH) > 0.05)
          say('Timesheet', 'the weekly split totals ' + out.weekSum + 'h against a row total of '
            + out.planH + 'h — spreading the hours across days lost or duplicated some');
      }
      if (kept5.units == null) delete t5.units; else t5.units = kept5.units;
      t5.participants = kept5.parts;
      calculate();
      return out;
    })();

    /* ══ TWO TOTALS ON ONE SCREEN, AND THE GAP NAMED ═══════════════════════ */
    const priceGap = (() => {
      const pv = priceVsRateCard();
      if (!pv) { say('Price vs rate card', 'the comparison could not be computed at all'); return null; }
      if (Math.abs(pv.rateCard - billingData().totBill) > 1)
        say('Price vs rate card', 'the "rate-card sum" it quotes (' + pv.rateCard.toFixed(0)
          + ') is not the billing table total (' + billingData().totBill.toFixed(0) + ')');
      if (Math.abs(pv.fee - revenueAtCompletion()) > 1)
        say('Price vs rate card', 'the fee it quotes is not the fee the payment schedule uses');
      /* READ OFF THE PANEL THAT DRAWS IT, not off the builder. Calling
         priceVsRateCardHtml() directly proves the sentence can be produced; it
         says nothing about whether the billing table actually carries it, and
         the first version of this check passed on a build where the call site
         had been deleted. */
      const flat = strip(billingBreakdownHtml());
      if (flat.indexOf('rate-card sum') < 0) say('Price vs rate card', 'the billing table does not carry the '
        + 'explanation, so the two totals still sit on one screen with the gap unnamed');
      if (!/fee/.test(flat)) say('Price vs rate card', 'the panel never names the fee');
      if (Math.abs(pv.gap) > 0.5 && !/(more|less)/.test(flat))
        say('Price vs rate card', 'the two figures differ by ' + Math.abs(pv.gap).toFixed(0)
          + ' and the sentence does not say the difference exists');
      if (!pv.why || pv.why.length < 40)
        say('Price vs rate card', 'the gap is stated and never explained');
      return { rateCard: Math.round(pv.rateCard), fee: Math.round(pv.fee), gap: Math.round(pv.gap) };
    })();

    return { contradictions: bad, ledger, timesheet, priceGap, count: n, recount: mine, built,
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
