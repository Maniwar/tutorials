/* ═══════════════════════════════════════════════════════════════════════════
   TEST PLAN — PART TWO: THE BEHAVIOUR.

   Numbers can all be right while the screen still lies. Every defect found in
   this application's recent history was of that shape: an arithmetically
   correct figure presented as something it was not — an assumption shown as a
   cause, work finishing early shown as an overrun, a duration percentile
   attached to a date, a person-day count called a calendar day.

   So these cases assert what the app DOES and what it SAYS, against the design
   intent rather than against its own output. Each one runs inside the page and
   returns a plain object; the runner compares it to `expect`.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

/* Each case: { id, area, title, intent, expect, from, fn }
   `fn` is a function SOURCE STRING evaluated in the page. It gets no arguments
   and must return a JSON-serialisable object matching `expect`. It is
   responsible for restoring any state it changes. */
module.exports = [

  // ══ RAID: what explains a number, and what is merely being watched ══════
  { id: 'B1', area: 'RAID · cause vs watch',
    title: 'An assumption you are relying on is never shown as the cause of a variance',
    intent: 'A RAID log holds two different kinds of statement. An Issue says "this went wrong" — '
          + 'it is a cause. An Assumption says "we are counting on this" — it explains nothing '
          + 'until the day it breaks. Showing the second beside a cost overrun in red tells the '
          + 'reader the overrun has been explained when nobody has explained anything.',
    expect: { causeChip: false, watchChip: true, watchIsRed: false, asksTheQuestion: true },
    from: 'Link an open Assumption with no recorded outcome to an activity and read the chips.',
    fn: `() => {
      const t = leafTasks().find(x => !x.milestone);
      const saved = raid.slice();
      raid = [{ id: 900, type: 'Assumption', title: 'Client provides a data steward', probability: 3,
        impact: 4, owner: '', status: 'Open', mitigation: '', outcome: '', outcomeNote: '',
        links: [{ k: 'act', id: t.id, was: t.name }], taskId: t.id, v: 2 }];
      const cause = raidCauseChipFor(t.id), watch = raidWatchChipFor(t.id);
      const r = { causeChip: cause !== '', watchChip: watch !== '',
                  watchIsRed: /class="raid-chip"/.test(watch),
                  asksTheQuestion: /Did it happen\\?/.test(watch) };
      raid = saved; return r;
    }` },

  { id: 'B2', area: 'RAID · cause vs watch',
    title: 'A watched entry never suppresses the offer to record the real cause',
    intent: 'Every surface reads "show the cause, or offer to log one". While a watch entry counted '
          + 'as a cause, the one activity you knew most about was the one activity you could no '
          + 'longer explain — the offer disappeared because something irrelevant was linked to it.',
    expect: { offersRaidWithAssumptionLinked: true, offersRaidWithNothingLinked: true },
    from: 'Compare the chip group with an assumption linked against nothing linked.',
    fn: `() => {
      const t = leafTasks().find(x => !x.milestone);
      const saved = raid.slice();
      raid = [{ id: 900, type: 'Assumption', title: 'x', probability: 3, impact: 3, owner: '',
        status: 'Open', mitigation: '', outcome: '', outcomeNote: '',
        links: [{ k: 'act', id: t.id, was: t.name }], taskId: t.id, v: 2 }];
      const withIt = raidChipsFor(t.id, () => ptrRaidBtn(t.id, t.name, '+$1'));
      raid = [];
      const without = raidChipsFor(t.id, () => ptrRaidBtn(t.id, t.name, '+$1'));
      raid = saved;
      return { offersRaidWithAssumptionLinked: /ptr-log-btn/.test(withIt),
               offersRaidWithNothingLinked: /ptr-log-btn/.test(without) };
    }` },

  { id: 'B3', area: 'RAID · cause vs watch',
    title: 'Closing an issue does not erase the explanation it gave',
    intent: 'A cause does not stop being the cause once you have dealt with it. Filtering the chip '
          + 'to open entries meant ticking Closed turned an explained overrun back into an '
          + 'unexplained one, months later, with nobody able to say why.',
    expect: { whileOpen: true, onceClosed: true, saysItIsClosed: true },
    from: 'Link an Issue, read the chip, set it Closed, read again.',
    fn: `() => {
      const t = leafTasks().find(x => !x.milestone);
      const saved = raid.slice();
      raid = [{ id: 901, type: 'Issue', title: 'Sandbox arrived late', probability: 4, impact: 5,
        owner: '', status: 'Open', mitigation: '', outcome: '', outcomeNote: '',
        links: [{ k: 'act', id: t.id, was: t.name }], taskId: t.id, v: 2 }];
      const open = raidCauseChipFor(t.id);
      raid[0].status = 'Closed';
      const closed = raidCauseChipFor(t.id);
      const r = { whileOpen: open !== '', onceClosed: closed !== '',
                  saysItIsClosed: /still the recorded cause/.test(closed) };
      raid = saved; return r;
    }` },

  { id: 'B4', area: 'RAID · outcomes',
    title: 'A risk that materialised becomes a cause and reads as a fault',
    intent: 'Status (Open / Mitigating / Closed) tracks how much attention an entry needs, not how '
          + 'it turned out — "Closed" on a risk reads the same whether it never happened or '
          + 'happened and was handled. The outcome is a separate fact, and only an entry that '
          + 'turned may explain a number.',
    expect: { pendingIsWatch: true, pendingIsNotCause: true, materialisedIsCause: true,
              materialisedIsNotWatch: true, saysRiskHit: true },
    from: 'Move one Risk through pending and materialised, reading both chips at each step.',
    fn: `() => {
      const t = leafTasks().find(x => !x.milestone);
      const saved = raid.slice();
      raid = [{ id: 902, type: 'Risk', title: 'Steward never named', probability: 4, impact: 4,
        owner: '', status: 'Open', mitigation: '', outcome: 'pending', outcomeNote: '',
        links: [{ k: 'act', id: t.id, was: t.name }], taskId: t.id, v: 2 }];
      const pw = raidWatchChipFor(t.id) !== '', pc = raidCauseChipFor(t.id) !== '';
      raid[0].outcome = 'materialised';
      const mc = raidCauseChipFor(t.id), mw = raidWatchChipFor(t.id) !== '';
      const r = { pendingIsWatch: pw, pendingIsNotCause: !pc, materialisedIsCause: mc !== '',
                  materialisedIsNotWatch: !mw, saysRiskHit: /Risk hit/.test(mc) };
      raid = saved; return r;
    }` },

  { id: 'B5', area: 'RAID · outcomes',
    title: 'A decision explains the work without reading as a fault',
    intent: 'A recorded decision genuinely explains why work cost what it did — but it is not a '
          + 'problem, and it was written down before the variance existed. So it earns a chip in '
          + 'its own neutral weight, and unlike a fault it does NOT stand in for the missing '
          + 'account of why this particular number moved.',
    expect: { getsAChip: true, notRed: true, noWarningGlyph: true, stillOffersRaid: true },
    from: 'Link a closed Decision to an activity and read the chip group.',
    fn: `() => {
      const t = leafTasks().find(x => !x.milestone);
      const saved = raid.slice();
      raid = [{ id: 903, type: 'Decision', title: 'Single production org', probability: 3, impact: 3,
        owner: '', status: 'Closed', mitigation: '', outcome: '', outcomeNote: '',
        links: [{ k: 'act', id: t.id, was: t.name }], taskId: t.id, v: 2 }];
      const cause = raidCauseChipFor(t.id);
      const group = raidChipsFor(t.id, () => ptrRaidBtn(t.id, t.name, '+$1'));
      const r = { getsAChip: cause !== '', notRed: /raid-chip-ctx/.test(cause),
                  noWarningGlyph: cause.indexOf('\\u26a0') < 0,
                  stillOffersRaid: /ptr-log-btn/.test(group) };
      raid = saved; return r;
    }` },

  { id: 'B6', area: 'RAID · outcomes',
    title: 'A turned entry offers to raise the issue it became, and writes nothing',
    intent: 'A risk that materialised is no longer a risk; it is a live problem. The honest move is '
          + 'to open the Issue it became rather than quietly reinterpret the risk row as one — '
          + 'prefilled and linked back to the source and forward to everything the source touched, '
          + 'because those are exactly the activities now carrying it.',
    expect: { type: 'Issue', linksBackToSource: true, carriesTheActivities: true,
              probabilityIsCertainty: true, wroteNothingToTheLog: true },
    from: 'Call raidRaiseFrom on a broken assumption and inspect the form, not the register.',
    fn: `() => {
      const t = leafTasks().find(x => !x.milestone);
      const saved = raid.slice(); const n0 = raid.length;
      raid = [{ id: 904, type: 'Assumption', title: 'Steward available', probability: 3, impact: 4,
        owner: '', status: 'Open', mitigation: '', outcome: 'broken', outcomeNote: 'never named',
        links: [{ k: 'act', id: t.id, was: t.name }], taskId: t.id, v: 2 }];
      raidRaiseFrom(904);
      const kinds = raidDraftLinks.map(l => l.k);
      const r = { type: document.getElementById('rType').value,
                  linksBackToSource: kinds.indexOf('raid') >= 0,
                  carriesTheActivities: kinds.indexOf('act') >= 0,
                  probabilityIsCertainty: +document.getElementById('rProb').value === 5,
                  wroteNothingToTheLog: raid.length === 1 };
      closeRaidForm(); raid = saved; return r;
    }` },

  // ══ The budget drill-in ═════════════════════════════════════════════════
  { id: 'B7', area: 'Budget drill-in',
    title: 'A row\'s colour follows the overrun, never the total and never the critical path',
    intent: 'The figure on a driver row is booked minus what was due by today — the right number to '
          + 'explain the bar, and NOT a verdict, because work happening early inflates it while '
          + 'costing nothing. Colour must come from the half that is a fault. It has been wrong '
          + 'twice: once from the total, once from .ptr-drv-crit repainting an under-budget row red '
          + 'for a fact about the schedule.',
    expect: { earlyAndUnderIsNotRed: true, genuinelyOverIsRed: true, colourFollowsOverrun: true },
    from: 'Build both states on the real export and read getComputedStyle, not the class list.',
    fn: `() => {
      loadSample(); calculate(); setBaseline(); calculate();
      const set = f => { leafTasks().filter(x => !x.milestone).slice(0, 5).forEach(t => {
        t.percentComplete = 100; t.autoActualCost = false;
        t.actualStart = fmtISO(new Date()); t.actualFinish = fmtISO(new Date());
        t.actualCost = Math.round((taskCost(t) || 1000) * f); }); calculate(); };
      const toneOf = () => { const b = planTruthData().rows.find(r => r.key === 'budget');
        return (b.drivers || [])[0]; };
      set(0.95); const under = toneOf();
      set(1.6);  const over  = toneOf();
      return { earlyAndUnderIsNotRed: under.tone !== 'bad',
               genuinelyOverIsRed: over.tone === 'bad',
               colourFollowsOverrun: (under.over < 0) && (over.over > 0) };
    }` },

  { id: 'B8', area: 'Budget drill-in',
    title: 'The two halves of a row add back to the figure shown',
    intent: 'gap = timing + overrun is what makes the split honest. If the halves did not reconcile '
          + 'with the total the row would be three unrelated numbers on one line.',
    expect: { identityHolds: true, namesEveryMaterialHalf: true, inventsNoImmaterialHalf: true },
    from: 'Read every driver row, add its parts, and check the sentence against the parts. '
        + 'On the QA plan D Test is pure timing (-$4,000 behind its dates, no overrun) and C Docs '
        + 'is pure overrun (-$500 under its own budget, on its dates) — so a row must name the '
        + 'halves it HAS and stay silent about the ones it does not. An earlier version of this '
        + 'case demanded both halves always, which would have forced the panel to print '
        + '"$0 ahead of its dates". The case was wrong, not the panel.',
    fn: `() => {
      const b = planTruthData().rows.find(r => r.key === 'budget');
      const ds = b.drivers || [];
      if (!ds.length) return { identityHolds: null, namesEveryMaterialHalf: null,
                               inventsNoImmaterialHalf: null };
      const hb = hasBaseline(), today = stripTime(new Date()).getTime();
      let identity = true, names = true, invents = false;
      ds.forEach(d => {
        const t = tasks.find(x => x.id === d.id);
        const pv = (() => { try { return accrualAt(pvSpread(hb, [t]).segs, today); }
                            catch (e) { return 0; } })();
        const gap = actualCostOf(t) - pv;
        if (Math.abs((d.timing + d.over) - gap) > 0.01) identity = false;
        const tol = Math.max(1, plannedCostOf(t, hb) * 0.005);
        const saysTiming = /ahead of its dates|behind its dates/.test(d.sub || '');
        const saysOver = /over its own budget|under its own budget/.test(d.sub || '');
        if (Math.abs(d.timing) > tol && !saysTiming) names = false;
        if (Math.abs(d.over) > tol && !saysOver) names = false;
        if (Math.abs(d.timing) <= tol && saysTiming) invents = true;
        if (Math.abs(d.over) <= tol && saysOver) invents = true;
      });
      return { identityHolds: identity, namesEveryMaterialHalf: names,
               inventsNoImmaterialHalf: !invents };
    }` },

  { id: 'B9', area: 'Budget drill-in',
    title: 'The list says truthfully whether its rows account for the whole bar',
    intent: 'The list is capped at five and one-sided, so a single row can be LARGER than the total '
          + 'it sits under. Asserting "these add up to it" was false whenever any activity sat on '
          + 'the other side.',
    expect: { claimMatchesReality: true },
    from: 'Compare the note\'s claim against the actual remainder.',
    fn: `() => {
      const b = planTruthData().rows.find(r => r.key === 'budget');
      const hb = hasBaseline(), today = stripTime(new Date()).getTime();
      const pv = t => { try { return accrualAt(pvSpread(hb, [t]).segs, today); } catch (e) { return 0; } };
      const shown = (b.drivers || []).reduce((s, d) => {
        const t = tasks.find(x => x.id === d.id); return s + (actualCostOf(t) - pv(t)); }, 0);
      const bar = leafTasks().reduce((s, t) => s + actualCostOf(t), 0)
        - accrualAt(pvSpread(hb, leafTasks()).segs, today);
      const rest = bar - shown;
      const claimsWhole = /account for the whole of the bar/.test(b.driverNote || '');
      const reallyWhole = Math.abs(rest) <= Math.max(1, Math.abs(shown) * 0.02);
      return { claimMatchesReality: claimsWhole === reallyWhole };
    }` },

  { id: 'B10', area: 'Plan vs actual',
    title: 'A card\'s pair and its delta are measured against the same thing',
    intent: 'Every card reads "committed → actual" with a delta underneath. The Budget card compared '
          + 'the whole envelope against spend so far, then printed a delta measured against what was '
          + 'due today: three correct figures saying two unrelated things, so a reader gets "about '
          + 'half the money gone" and then a number that seems to contradict it.',
    expect: { pairAndDeltaReconcile: true },
    from: 'Parse the card and check the delta is recoverable from the pair above it.',
    fn: `() => {
      switchTab('baseline'); renderBaseline();
      const el = [...document.querySelectorAll('.bl-cards .stat-card')]
        .find(x => /Budget/.test((x.querySelector('.label') || {}).textContent || ''));
      if (!el) return { pairAndDeltaReconcile: null };
      const txt = el.textContent.replace(/\\s+/g, ' ');
      const pair = txt.match(/([\\d,]+(?:\\.\\d+)?)[^\\d]*?\\u2192\\s*\\$?\\s*([\\d,]+(?:\\.\\d+)?)/);
      const dm = txt.match(/([\\d,]+(?:\\.\\d+)?)\\s+(above|below) the plan to date/);
      if (!pair || !dm) return { pairAndDeltaReconcile: null };
      const n = s => +String(s).replace(/,/g, '');
      const delta = n(dm[1]) * (dm[2] === 'above' ? 1 : -1);
      return { pairAndDeltaReconcile: Math.abs((n(pair[2]) - n(pair[1])) - delta) <= 2 };
    }` },

  { id: 'B11', area: 'Plan vs actual',
    title: 'A held end date still reports the movement underneath it',
    intent: 'Both ends of the schedule comparison are a max over the whole plan, so it only moves '
          + 'when the LAST activity moves. "On the baseline date" then reads as "nothing has '
          + 'happened" on a plan where four activities sat 81 activity-days off their own baselines.',
    expect: { cardNamesTheDisplacement: true, agreesWithTheBar: true },
    from: 'Load the real export, where the end date holds and four activities have moved.',
    fn: `() => {
      hydrate(JSON.parse(JSON.stringify(window.__crm))); calculate();
      switchTab('baseline'); renderBaseline();
      const el = [...document.querySelectorAll('.bl-cards .stat-card')]
        .find(x => /Schedule/.test((x.querySelector('.label') || {}).textContent || ''));
      const txt = el ? el.textContent.replace(/\\s+/g, ' ') : '';
      const bar = planTruthData().rows.find(r => r.key === 'sched');
      const cardN = (txt.match(/(\\d+)\\s+activit/) || [])[1];
      const barN = (String(bar.delta).match(/(\\d+)\\s+off/) || [])[1];
      return { cardNamesTheDisplacement: !!cardN, agreesWithTheBar: cardN === barN };
    }` },

  // ══ What leaves the building ════════════════════════════════════════════
  { id: 'B12', area: 'Client-safe mode',
    title: 'Screen-share mode withholds every money figure from the report',
    intent: 'This is the control you turn on before sharing your screen with the client. One leaked '
          + 'margin is the whole point of the feature failing.',
    expect: { moneyFiguresWhenOn: 0, moneyFiguresWhenOff: true, reportStillUsable: true },
    from: 'Build the status report with the toggle on and off and count currency figures.',
    fn: `() => {
      const saved = clientSafeReports;
      const strip = h => String(h).replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ');
      const count = s => (s.match(/\\$[\\d,]{3,}/g) || []).length;
      clientSafeReports = true;  const on = strip(buildStatusReportHtml());
      clientSafeReports = false; const off = strip(buildStatusReportHtml());
      clientSafeReports = saved;
      return { moneyFiguresWhenOn: count(on), moneyFiguresWhenOff: count(off) > 0,
               reportStillUsable: on.length > 500 };
    }` },

  { id: 'B13', area: 'Client-safe mode',
    title: 'Money is withheld before the request body is built, not after',
    intent: 'The AI digest is what actually leaves the browser. If screen-share mode bit only at '
          + 'render, the money would already be in the request by the time anyone noticed.',
    expect: { moneyInSafeDigest: 0, moneyInOpenDigest: true },
    from: 'Build ptDigest with the toggle on and off.',
    fn: `() => {
      const saved = clientSafeReports;
      const count = s => (String(s).match(/\\$[\\d,]{3,}/g) || []).length;
      clientSafeReports = true;  const on = ptDigest();
      clientSafeReports = false; const off = ptDigest();
      clientSafeReports = saved;
      return { moneyInSafeDigest: count(on.text), moneyInOpenDigest: count(off.text) > 0 };
    }` },

  { id: 'B14', area: 'Status report',
    title: 'The report states what the work COST, not only what it was worth',
    intent: 'Earned value is what the finished work was worth; it is not what it cost, and the '
          + 'difference between them is the entire over-or-under question. A status report that '
          + 'quotes only the first asks the client to take the good news on trust.',
    expect: { statesBooked: true, statesEarned: true, statesTheDifference: true },
    from: 'Read the cost line of the generated report.',
    fn: `() => {
      const saved = clientSafeReports; clientSafeReports = false;
      const t = String(buildStatusReportHtml()).replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ');
      clientSafeReports = saved;
      return { statesBooked: /booked to date/.test(t),
               statesEarned: /earned value to date/.test(t),
               statesTheDifference: /(over|under|on budget) on the work finished/.test(t) };
    }` },

  // ══ The AI boundary ═════════════════════════════════════════════════════
  { id: 'B15', area: 'AI boundary',
    title: 'Model output that cannot resolve is dropped, and the reason is named',
    intent: 'The model may only reference entities from a catalogue this file builds. What protects '
          + 'the user is not the model behaving but the validator refusing — and refusing OUT LOUD, '
          + 'because a silent drop is indistinguishable from the model having said nothing.',
    expect: { inventedPanelDropped: true, fabricatedCitationDropped: true,
              hallucinatedRefsDropped: true, everyDropNamed: true },
    from: 'Hand-write four hallucinated responses and put them through ptValidate.',
    fn: `() => {
      const dg = ptDigest();
      const cite = String(dg.text).split('\\n').find(l => l.trim().length > 40) || '';
      const ref = [...(dg.refs || [])][0] || null;
      const panel = (typeof PT_PANELS !== 'undefined' && PT_PANELS[0]) || 'sched';
      const one = o => Object.assign({ panel: panel, cite: cite.slice(0, 80),
        text: 'A plain sentence.', refs: ref ? [ref] : [] }, o || {});
      const run = o => ptValidate({ readings: [one(o)] }, dg, null);
      const a = run({ panel: '__nope' });
      const b = run({ cite: 'The client verbally agreed to absorb the overrun.' });
      const c = run({ refs: ['T#999999'] });
      const ok = run({});
      return { inventedPanelDropped: (a.items || []).length === 0,
               fabricatedCitationDropped: (b.items || []).length === 0,
               hallucinatedRefsDropped: (c.items || []).length === 0,
               everyDropNamed: (a.drops || []).length > 0 && (b.drops || []).length > 0
                 && (c.drops || []).length > 0 && (ok.items || []).length === 1 };
    }` },

  { id: 'B16', area: 'AI boundary',
    title: 'An injected sentence is kept as text and is inert when drawn',
    intent: 'DELIBERATE. Dropping text for containing frightening words is keyword filtering and '
          + 'fails on the first phrasing nobody anticipated. The real protection is that a reading '
          + 'carries no execution power and is escaped on render — so the escaping is what gets '
          + 'tested, not a blocklist.',
    expect: { keptAsText: true, inertWhenDrawn: true },
    from: 'Put a script tag through the validator and render the result.',
    fn: `() => {
      const dg = ptDigest();
      const cite = String(dg.text).split('\\n').find(l => l.trim().length > 40) || '';
      const panel = (typeof PT_PANELS !== 'undefined' && PT_PANELS[0]) || 'sched';
      const payload = '<img src=x onerror="window.__pwned=1">';
      const r = ptValidate({ readings: [{ panel: panel, cite: cite.slice(0, 80),
        text: payload, refs: [] }] }, dg, null);
      const kept = (r.items || [])[0];
      let html = ''; try { html = ptReadingHtml('base'); } catch (e) {}
      return { keptAsText: !!kept, inertWhenDrawn: !/<img[^>]+onerror/i.test(String(html)) };
    }` },

  { id: 'B17', area: 'Schedule presentation',
    title: 'The panel explains why the finish is a day beyond the duration',
    intent: 'The counterpart to N10. The milestone convention is a defensible choice, but "12.0 days '
          + '-> finish Mar 18" on a plan starting Monday 2 March cannot be read naively — count the '
          + 'working days and you reach the thirteenth. Making the choice silently is what turned a '
          + 'convention into an apparent bug for three independent readers.',
    expect: { spanIsOneLonger: true, panelNamesTheMilestoneDay: true },
    from: 'Load the QA reference plan and read the CPM line.',
    fn: `() => {
      hydrate(JSON.parse(JSON.stringify(window.__qa))); calculate();
      switchTab('analytics'); renderAnalytics();
      const d = document.createElement('div');
      d.innerHTML = document.getElementById('view-analytics').innerHTML.replace(/<[^>]+>/g, ' ');
      const txt = (d.textContent || '').replace(/\\s+/g, ' ');
      const line = (txt.match(/Deterministic \\(CPM\\) duration:[^:]{0,220}/) || [''])[0];
      const hol = getHolidaySet(); const fin = latestFinish(leafTasks());
      let span = 0, x = new Date(projectStartDate());
      while (fin && stripTime(x) <= stripTime(fin)) { if (isWorkingDay(x, hol)) span++; x.setDate(x.getDate() + 1); }
      return { spanIsOneLonger: span === Math.max(0, ...leafTasks().map(t => t.ef)) + 1,
               panelNamesTheMilestoneDay: /marked on the next working day|spans one day more/i.test(line) };
    }` },

  { id: 'B18', area: 'Schedule presentation',
    title: 'A committed date reports the confidence it actually carries',
    intent: 'The simulation produces DURATIONS, which are continuous; a committed date is a whole '
          + 'working day and rounds up. So a date sized from the P80 absorbs slightly more of the '
          + 'distribution than 80% — conservative, never the reverse, but sizing contingency for 80% '
          + 'while buying 82.8% means paying the difference in quoted duration.',
    expect: { reportsADateConfidence: true, atLeastTheNominal: true, notTheNominalItself: true },
    from: 'Load the real export, run the simulation, size from P80 and read back.',
    fn: `() => {
      hydrate(JSON.parse(JSON.stringify(window.__crm))); calculate();
      runMonteCarlo();
      setContingencyFromP80();
      const c = committedDateConfidence();
      return { reportsADateConfidence: c != null,
               atLeastTheNominal: c != null && c >= 79.9,
               notTheNominalItself: c != null && Math.abs(c - 80) > 0.01 };
    }` },

  { id: 'B19', area: 'Resourcing presentation',
    title: 'The over-allocation count is reported in the unit it is counted in',
    intent: 'computeResourceLoad counts (person x day) PAIRS. Every surface calls that a '
          + 'resource-day except the line printed right after clicking Level, which said '
          + '"Over-allocated days" — a different quantity the moment two people are over on the '
          + 'same date, and one that reads as consecutive calendar days of a single person.',
    expect: { namesTheUnit: true, doesNotSayBareDays: true, tabStatesTheTotal: true },
    from: 'Force a conflict on the real export, level it, and read both the status line and the tab.',
    fn: `() => {
      hydrate(JSON.parse(JSON.stringify(window.__crm))); calculate();
      const w = leafTasks().filter(x => !x.milestone && (x.te || 0) > 0
        && (x.percentComplete || 0) < 100 && taskParticipants(x).length);
      w.slice(0, 2).forEach(t => { const n = taskParticipants(t)[0].name;
        if (resources[n]) resources[n].capacity = 25; });
      calculate();
      switchTab('resources'); renderResources();
      const panel = document.getElementById('resourcesContainer').textContent.replace(/\\s+/g, ' ');
      autoLevel();
      const st = (document.getElementById('levelStatus') || {}).textContent || '';
      return { namesTheUnit: /resource-days/.test(st),
               doesNotSayBareDays: !/Over-allocated days/.test(st),
               tabStatesTheTotal: /over-allocated resource-day/.test(panel) };
    }` },

  // ══ Data integrity ══════════════════════════════════════════════════════
  { id: 'B20', area: 'Persistence',
    title: 'A recorded outcome survives save and reload, and an old file loads as unanswered',
    intent: 'serialize() lists task fields explicitly and hydrate() maps them explicitly, so a field '
          + 'added to one and not the other is written on save and lost on load — this has happened '
          + 'before. And a file written before outcomes existed must load as "not recorded", not as '
          + 'something that turned.',
    expect: { survivesRoundTrip: true, legacyFileLoadsUnanswered: true },
    from: 'Save an entry with an outcome, reload it, then strip the field and reload again.',
    fn: `() => {
      const saved = raid.slice();
      raid = [{ id: 950, type: 'Assumption', title: 'RoundTripProbe', probability: 3, impact: 3,
        owner: '', status: 'Open', mitigation: '', outcome: 'broken', outcomeNote: 'never named',
        links: [], taskId: null, v: 2 }];
      const json = JSON.stringify(serialize());
      hydrate(JSON.parse(json));
      const back = raid.find(r => r.title === 'RoundTripProbe');
      const old = JSON.parse(json);
      old.raid = old.raid.map(r => { const c = Object.assign({}, r);
        delete c.outcome; delete c.outcomeNote; return c; });
      hydrate(old);
      const legacy = raid.find(r => r.title === 'RoundTripProbe');
      const r = { survivesRoundTrip: !!back && back.outcome === 'broken'
                    && back.outcomeNote === 'never named',
                  legacyFileLoadsUnanswered: !!legacy && raidUnanswered(legacy) };
      raid = saved; return r;
    }` },

  { id: 'B21', area: 'Data integrity',
    title: 'Drafting an entry from a variance fills the form and writes nothing',
    intent: 'An entry nobody typed is an entry nobody believes, and the RAID log is the one place in '
          + 'this file a client reads word for word. Every AI and shortcut path must stop at the '
          + 'form.',
    expect: { formPrefilled: true, linkedToTheActivity: true, registerUntouched: true },
    from: 'Call the draft path and compare the register length before and after.',
    fn: `() => {
      const t = leafTasks().find(x => !x.milestone);
      const before = raid.length;
      raidLogFor(t.id, '+$7,800 on budget');
      const r = { formPrefilled: document.getElementById('rTitle').value.length > 0,
                  linkedToTheActivity: raidDraftLinks.some(l => l.k === 'act' && l.id === t.id),
                  registerUntouched: raid.length === before };
      closeRaidForm(); return r;
    }` },
];
