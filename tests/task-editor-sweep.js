/* ═══════════════════════════════════════════════════════════════════════════
   THE ACTIVITY EDITOR AGAINST THE PLAN IT EDITS.

   Every other sweep reads a rendered view of `tasks`. The editor is the one
   surface that runs its OWN arithmetic on values that are not in `tasks` yet:
   it computes a live TE, crew, effort and cost from whatever is typed in the
   fields, so a person can see the consequence of an estimate before committing
   it. Two implementations of the same identity, and only one of them was ever
   checked.

   That gap was found the hard way: the PERT formula was deliberately broken in
   the editor's copy and the entire suite — forty-two hand-derived cases and
   nine sweeps — stayed green. The identity now lives in one function, but the
   editor still has its own path to it, and the preview must agree with what
   saving actually produces. A preview that lies is worse than no preview: it is
   the number a person decides on.

   Everything here is a ROUND TRIP. Type, read the preview, save, read the plan.
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
    return page.evaluate(lbl => {
      const bad = [];
      const say = (where, what) => bad.push(lbl + ' · ' + where + ' :: ' + what);
      /* ═══ NOTHING TO TEST IS NOT A PASS ════════════════════════════════════
         Every case here opens the editor on a REAL activity and reads its live
         preview back. With no activity to open, each one returns early and the
         file reports success having never opened the editor once. */
      if (!leafTasks().filter(t => !t.isSummary && !t.milestone).length) {
        bad.push(lbl + ' · Editor :: the plan holds no work package to open, so no case below opened the '
          + 'editor at all — this run exercised nothing');
        return { contradictions: bad, counts: { ran: [] } };
      }
      const set = (id, v) => { const e = document.getElementById(id); e.value = v;
        e.dispatchEvent(new Event('input', {bubbles:true}));
        e.dispatchEvent(new Event('change', {bubbles:true})); };
      /* showErr writes into the error element and nothing clears it on a
         successful save, so a later read picks up a stale reason from an earlier
         attempt — which had this probe quoting the "log the time spent" message
         as the reason an out-of-order estimate was rejected. Wipe it before any
         save whose refusal we intend to read, and read only if it is visible. */
      const clearErr = () => { const e = document.querySelector('#modal .error');
        if (e) { e.textContent = ''; e.style.display = 'none'; } };
      const errNow = () => { const e = document.querySelector('#modal .error');
        return (e && e.style.display !== 'none') ? e.textContent.trim() : ''; };
      const out = { edited: 0, ran: [] };
      // A check that silently does not run is indistinguishable from a check
      // that passes, and that is how this suite has been fooled before. Every
      // section records that it reached its assertions, so the output shows
      // what was actually exercised rather than only what failed.
      const ran = k => out.ran.push(k);

      // A leaf with a crew and a rate, so cost has something to be made of, and
      // one the editor will actually let us save: an activity marked complete
      // with no logged effort is refused on save by design, and a probe that
      // picks one measures the refusal rather than the round trip.
      const savable = t => !t.milestone && !t.isSummary
        && taskParticipants(t).some(p => !isClientResource(p.name))
        && ((t.percentComplete || 0) < 1 || t.actualEffort != null);
      const subject = leafTasks().find(savable);
      if (!subject) { return { contradictions: bad, counts: out }; }
      out.subject = subject.name;

      // ── 1. THE LIVE TE IS THE ENGINE'S TE ───────────────────────────────
      // O/M/P chosen so the answer is not a round number: any formula that is
      // nearly right (dropping the 4, dividing by 5) lands somewhere else.
      ran('1·liveTE');
      const TRIALS = [[1, 2, 9], [2, 3, 4], [0.5, 1, 6], [3, 3, 3], [1, 8, 9]];
      TRIALS.forEach(([o, m, p]) => {
        openEditModal(subject.id);
        set('mO', String(o)); set('mM', String(m)); set('mP', String(p));
        const live = modalTeUnits(false);
        const want = (o + 4 * m + p) / 6;
        if (!(Math.abs(live - want) < 1e-9))
          say('Editor', 'O=' + o + ' M=' + m + ' P=' + p + ' previews TE ' + live
            + ' where PERT gives ' + want);
        closeModal();
      });

      // ── 2. WHAT THE PREVIEW PROMISED IS WHAT SAVING DELIVERS ────────────
      // The preview computes from the fields; the table computes from `tasks`.
      // If those two ever part company the editor is a rehearsal of a different
      // play from the one that gets performed.
      ran('2·previewVsSave');
      const O = 2, M = 5, P = 8;
      openEditModal(subject.id);
      set('mO', String(O)); set('mM', String(M)); set('mP', String(P));
      const shown = paDerive();
      const previewTe = modalTeUnits(false);
      const previewCost = shown ? shown.estCost : null;
      const previewCrew = shown ? shown.crew.map(c => c.name).sort() : null;
      saveActivity();
      out.edited++;
      const after = tasks.find(t => t.id === subject.id);
      if (Math.abs((after.te || 0) - previewTe) > 1e-6)
        say('Editor', 'the preview said TE ' + previewTe.toFixed(3)
          + ' and saving produced ' + (after.te || 0).toFixed(3));
      if (previewCost != null && Math.abs(Math.round(taskCost(after)) - previewCost) > 1)
        say('Editor', 'the preview said this activity costs ' + fmtMoney(previewCost)
          + ' and after saving the plan says ' + fmtMoney(Math.round(taskCost(after))));
      if (previewCrew) {
        const real = taskParticipants(after).map(p => p.name).sort();
        if (real.join('|') !== previewCrew.join('|'))
          say('Editor', 'the preview listed crew [' + previewCrew.join(', ')
            + '] and the saved activity carries [' + real.join(', ') + ']');
      }
      // and the fields themselves must have landed, not just the derived figure
      if (after.o !== O || after.m !== M || after.p !== P)
        say('Editor', 'typed O/M/P ' + [O, M, P].join('/') + ' and the activity holds '
          + [after.o, after.m, after.p].join('/'));

      // ── 3. REOPENING SHOWS WHAT WAS SAVED ───────────────────────────────
      // A modal that opens with stale or blank fields invites a person to
      // overwrite good data with the default.
      ran('3·reopen');
      openEditModal(subject.id);
      const back = ['mO', 'mM', 'mP'].map(id => parseFloat(document.getElementById(id).value));
      if (Math.abs(back[0] - O) > 1e-9 || Math.abs(back[1] - M) > 1e-9 || Math.abs(back[2] - P) > 1e-9)
        say('Editor', 'saved O/M/P ' + [O, M, P].join('/')
          + ' and reopening shows ' + back.join('/'));
      if ((document.getElementById('mName').value || '').trim() !== after.name)
        say('Editor', 'reopening shows the name "' + document.getElementById('mName').value
          + '" for an activity called "' + after.name + '"');
      closeModal();

      // ── 4. A MILESTONE HAS NO DURATION, IN THE PREVIEW TOO ──────────────
      ran('4·milestone');
      openEditModal(subject.id);
      if (modalTeUnits(true) !== 0)
        say('Editor', 'previews a non-zero estimate for a milestone: ' + modalTeUnits(true));
      closeModal();

      // ── 5. A HALF-TYPED ESTIMATE HOLDS THE LAST GOOD VALUE ──────────────
      // Deliberate behaviour: the readout must not flicker to "no estimate"
      // between keystrokes. What it must NOT do is silently keep the stale
      // number once the entry is complete and different.
      ran('5·midTyping');
      openEditModal(subject.id);
      set('mO', '1'); set('mM', '4'); set('mP', '7');
      const good = modalTeUnits(false);
      set('mM', '4.');                       // mid-typing
      if (modalTeUnits(false) !== good)
        say('Editor', 'a half-typed estimate moved the readout off its last good value');
      set('mM', '4.5');                      // finished
      const done = modalTeUnits(false);
      if (Math.abs(done - (1 + 4 * 4.5 + 7) / 6) > 1e-9)
        say('Editor', 'finishing the entry left the readout at ' + done
          + ' instead of ' + ((1 + 4 * 4.5 + 7) / 6));
      closeModal();

      /* ── 6. AN IMPOSSIBLE ESTIMATE IS REFUSED, AND SAYS SO ──────────────
         O > P is not a rounding question, it is a contradiction: the range runs
         backwards, so TE lands outside the interval the estimate claims to
         describe and the variance is computed from a negative span.

         This check was originally written as "if the editor accepted it, then
         assert TE is out of range" — and the editor refuses, so the branch never
         ran. It passed every time while testing nothing, which is the precise
         failure this whole suite exists to catch, committed inside the suite.
         Written the right way round it asserts the REFUSAL: the save is blocked,
         the reason names the ordering rather than saying "invalid", and the
         activity is left exactly as it was. If the guard is ever removed this
         goes red instead of quietly congratulating itself. */
      ran('6·impossibleEstimate');
      const before = { o: after.o, m: after.m, p: after.p };
      openEditModal(subject.id);
      set('mO', '9'); set('mM', '5'); set('mP', '1');
      clearErr();
      saveActivity();
      const t6 = tasks.find(t => t.id === subject.id);
      // whether the save went through is decided by what the PLAN now holds,
      // not by whether the dialog looks closed — closeOverlay animates, so the
      // open class outlives a successful save by the length of a transition
      const took = t6.o === 9 && t6.m === 5 && t6.p === 1;
      if (took) {
        say('Editor', 'stored O=9 M=5 P=1 — a range that runs backwards — without objection');
        if (t6.te < Math.min(t6.o, t6.p) || t6.te > Math.max(t6.o, t6.p))
          say('Editor', 'and the resulting TE ' + (t6.te || 0).toFixed(2)
            + ' lies outside the range the estimate claims to describe');
      } else {
        const why6 = errNow();
        if (!/optimistic|pessimistic|≤|<=/i.test(why6))
          say('Editor', 'refused O=9 > P=1 but the reason shown does not name the ordering: "'
            + (why6 || '(nothing shown)') + '"');
        if (t6.o !== before.o || t6.m !== before.m || t6.p !== before.p)
          say('Editor', 'refused O=9 > P=1 and changed the estimate anyway: '
            + [before.o, before.m, before.p].join('/') + ' became ' + [t6.o, t6.m, t6.p].join('/'));
      }
      closeModal();

      // ── 7. A REFUSED SAVE CHANGES NOTHING ───────────────────────────────
      // The editor does refuse some saves — an activity marked complete with no
      // effort logged is one. A refusal must be all-or-nothing: a half-applied
      // save leaves the plan holding fields the person never agreed to, and the
      // modal is still open saying it did not save.
      const done100 = leafTasks().find(t => !t.milestone && !t.isSummary
        && (t.percentComplete || 0) >= 100 && t.actualEffort == null);
      if (!done100) out.ran.push('7·SKIPPED-no-completed-activity-without-effort');
      if (done100) {
        ran('7·refusedSaveIsAtomic');
        const snap = JSON.stringify({o: done100.o, m: done100.m, p: done100.p,
          name: done100.name, owner: done100.owner, pct: done100.percentComplete});
        openEditModal(done100.id);
        set('mO', '11'); set('mM', '12'); set('mP', '13');
        set('mName', 'RENAMED BY THE PROBE');
        clearErr();
        saveActivity();
        const errTxt = errNow();
        const still = !!errTxt;   // a stated reason IS the refusal; see clearErr
        const now = tasks.find(t => t.id === done100.id);
        const after7 = JSON.stringify({o: now.o, m: now.m, p: now.p,
          name: now.name, owner: now.owner, pct: now.percentComplete});
        if (!still && after7 === snap)
          say('Editor', 'closed the editor on "' + done100.name
            + '" without saving anything and without saying why');
        if (still && after7 !== snap)
          say('Editor', 'refused to save "' + done100.name
            + '" and changed the activity anyway: ' + snap + ' became ' + after7);
        if (still && !errTxt)
          say('Editor', 'refused to save "' + done100.name + '" and gave no reason');
        closeModal();
      }

      // put the subject back, so a later check is not reading wreckage
      openEditModal(subject.id);
      set('mO', String(before.o)); set('mM', String(before.m)); set('mP', String(before.p));
      saveActivity();

      /* ── THE FORM THAT ASKS FOR THE ESTIMATE SHOWS WHAT IT COMES TO ─────
         Every other surface prints the work beside the span. The one screen
         where somebody types O/M/P and sets the allocation printed neither the
         PERT mean nor the work, so the number the whole plan rests on could
         only be found by saving and going to look somewhere else. */
      ran('estimateFormShowsWork');
      (() => {
        openEditModal(subject.id, true);
        set('mO', '1d'); set('mM', '2d'); set('mP', '3d'); set('mUnits', '80');
        ompHintUpd();
        const txt = (document.getElementById('ompHint').textContent || '').replace(/\s+/g, ' ');
        out.ompHint = txt.trim();
        if (!/2d/.test(txt))
          say('Editor', 'O/M/P of 1/2/3 has a PERT mean of 2 days and the form does not say so: "' + txt + '"');
        // again: the total across everybody on the activity, not the box
        const want = (2 * (modalUnitsTotal() / 100));
        if (txt.indexOf(String(+want.toFixed(2)).replace(/0+$/, '').replace(/\.$/, '')) < 0
            && txt.indexOf(String(+want.toFixed(1))) < 0)
          say('Editor', 'two days open at ' + modalUnitsTotal() + '% is ' + want.toFixed(2)
            + ' days of work and the estimate form never states it: "' + txt + '"');
        if (document.getElementById('ompHint').innerHTML.indexOf('&lt;b&gt;') >= 0)
          say('Editor', 'the estimate hint escapes its own markup');
        closeModal();
      })();

      /* ── THE ESTIMATE GOES IN EITHER DIRECTION ──────────────────────────
         Duration x allocation = work, and which two you know depends on the
         job. Typing the work scales the three duration boxes to match, holding
         the allocation and KEEPING THE SPREAD — flattening O and P onto M would
         tell the Monte Carlo the estimate is certain. */
      ran('workDrivesDuration');
      (() => {
        openEditModal(subject.id, true);
        set('mO', '2d'); set('mM', '4d'); set('mP', '6d'); set('mUnits', '50');
        ompHintUpd();
        // the allocation is the TOTAL across everyone on the activity, not the
        // Units % box — an activity with attendees has more than the box says
        const alloc = modalUnitsTotal();
        out.alloc = alloc;
        const shownWork = document.getElementById('mWork').value;
        out.workShown = shownWork;
        const wantWork = 4 * (alloc / 100);
        if (parseDurExpr(shownWork) == null || Math.abs(parseDurExpr(shownWork) - wantWork) > 0.02)
          say('Editor', 'TE 4d at ' + alloc + '% is ' + wantWork.toFixed(2)
            + 'd of work and the Work box reads "' + shownWork + '"');
        set('mWork', '4d'); workToDuration();
        const o2 = parseDurExpr(document.getElementById('mO').value);
        const m2 = parseDurExpr(document.getElementById('mM').value);
        const p2 = parseDurExpr(document.getElementById('mP').value);
        out.afterWork = [o2, m2, p2];
        const wantTe = 4 / (alloc / 100);
        if (Math.abs(modalTeUnits(false) - wantTe) > 0.03)
          say('Editor', 'asking for 4d of work at ' + alloc + '% should give ' + wantTe.toFixed(2)
            + 'd of duration; the form says ' + modalTeUnits(false));
        if (Math.abs((p2 - o2) / m2 - 1) > 0.02)
          say('Editor', 'the three-point spread was not preserved: ' + [o2, m2, p2].join('/')
            + ' — flattening it tells the simulation the estimate is certain');
        // and saving delivers what the form promised
        saveActivity();
        const aft = tasks.find(x => x.id === subject.id);
        if (Math.abs(workingDaysToUnit(plannedEffortDays(aft)) - 4) > 0.02)
          say('Editor', 'the form promised 4d of work and saving produced '
            + workingDaysToUnit(plannedEffortDays(aft)).toFixed(2));
        closeModal();
      })();

      /* ── A SUMMARY'S "ESTIMATED" IS THE WORK UNDER IT ────────────────────
         The Progress panel on a phase compares an estimate against logged
         effort. The estimate was Sigma of the children's te — spans, not work —
         so a phase of part-time activities claimed several times the work it
         actually contains, and every reading of "how much of the estimate is
         gone" on that row was wrong by the allocation. */
      ran('summaryEstimateIsWork');
      (() => {
        const sum = tasks.find(t => t.isSummary && leafDescendants(t.id)
          .some(x => !x.milestone && (x.te || 0) > 0));
        // the QA reference is a flat five-activity plan; the real export has
        // phases. Vacuity is caught below, across both fixtures, not here.
        if (!sum) { out.summaryEstTime = 'no summary in this fixture'; return; }
        const kids = leafDescendants(sum.id).filter(x => !x.isSummary && !x.milestone);
        const keep = kids.map(x => ({ x: x, u: x.units, par: x.participants }));
        kids.forEach(x => { x.units = 20; x.participants = null; });
        calculate();
        const wantWork = kids.reduce((a, x) => a + workingDaysToUnit(plannedEffortDays(x)), 0);
        const wantSpan = kids.reduce((a, x) => a + (x.te || 0), 0);
        editingId = sum.id;
        const got = (paDerive() || {}).estTime;
        editingId = null;
        out.summaryEstTime = got;
        if (got == null) say('Editor', 'a summary row derives no estimate at all');
        else if (Math.abs(got - wantWork) > 0.01)
          say('Editor', 'a phase of activities at 20% holds ' + wantWork.toFixed(2) + ' of work and the '
            + 'editor calls its estimate ' + Number(got).toFixed(2)
            + (Math.abs(got - wantSpan) < 0.01 ? ' — the sum of their spans' : ''));
        keep.forEach(k => { k.x.units = k.u; k.x.participants = k.par; });
        calculate();
      })();

      return { contradictions: bad, counts: out };
    }, label);
  };

  const qa = await sweep('QA reference', QA);
  const crm = await sweep('Real export', CRM);
  const R = { contradictions: [].concat(qa.contradictions, crm.contradictions),
              qaCounts: qa.counts, crmCounts: crm.counts,
              pageErrors: errs.slice(0, 8) };
  // a check no fixture could exercise is a check that proves nothing
  if (typeof qa.counts.summaryEstTime === 'string' && typeof crm.counts.summaryEstTime === 'string')
    R.contradictions.push('Editor :: neither fixture contains a summary with estimated children, so the '
      + 'summary-estimate check never ran against anything');
  console.log(JSON.stringify(R, null, 1));
  await b.close();
  if (R.contradictions.length || errs.length) process.exitCode = 1;
})();
