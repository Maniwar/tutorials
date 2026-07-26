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
      const set = (id, v) => { const e = document.getElementById(id); e.value = v;
        e.dispatchEvent(new Event('input', {bubbles:true}));
        e.dispatchEvent(new Event('change', {bubbles:true})); };
      const out = { edited: 0 };

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
      openEditModal(subject.id);
      if (modalTeUnits(true) !== 0)
        say('Editor', 'previews a non-zero estimate for a milestone: ' + modalTeUnits(true));
      closeModal();

      // ── 5. A HALF-TYPED ESTIMATE HOLDS THE LAST GOOD VALUE ──────────────
      // Deliberate behaviour: the readout must not flicker to "no estimate"
      // between keystrokes. What it must NOT do is silently keep the stale
      // number once the entry is complete and different.
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

      // ── 6. AN IMPOSSIBLE ESTIMATE IS NOT QUIETLY ACCEPTED ───────────────
      // O > P is not a rounding question, it is a contradiction: it yields a TE
      // outside the range it claims to describe. Either the editor refuses it
      // and says why, or it takes it — and then every figure downstream is
      // built on an estimate that cannot happen.
      const before = { o: after.o, m: after.m, p: after.p };
      openEditModal(subject.id);
      set('mO', '9'); set('mM', '5'); set('mP', '1');
      saveActivity();
      const t6 = tasks.find(t => t.id === subject.id);
      if (t6.o === 9 && t6.p === 1) {
        if (t6.te < 1 || t6.te > 9)
          say('Editor', 'accepted O=9 > P=1, giving TE ' + (t6.te || 0).toFixed(2)
            + ' outside the range the estimate describes');
        if ((t6.variance || 0) > 0)
          say('Editor', 'accepted O=9 > P=1 and reports a positive variance of '
            + (t6.variance || 0).toFixed(2) + ' from a range that runs backwards');
      }
      closeModal();

      // ── 7. A REFUSED SAVE CHANGES NOTHING ───────────────────────────────
      // The editor does refuse some saves — an activity marked complete with no
      // effort logged is one. A refusal must be all-or-nothing: a half-applied
      // save leaves the plan holding fields the person never agreed to, and the
      // modal is still open saying it did not save.
      const done100 = leafTasks().find(t => !t.milestone && !t.isSummary
        && (t.percentComplete || 0) >= 100 && t.actualEffort == null);
      if (done100) {
        const snap = JSON.stringify({o: done100.o, m: done100.m, p: done100.p,
          name: done100.name, owner: done100.owner, pct: done100.percentComplete});
        openEditModal(done100.id);
        set('mO', '11'); set('mM', '12'); set('mP', '13');
        set('mName', 'RENAMED BY THE PROBE');
        saveActivity();
        const still = document.getElementById('modal').classList.contains('open');
        const errTxt = [...document.querySelectorAll('#modal .error')]
          .map(e => e.textContent.trim()).filter(Boolean).join(' ');
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

      return { contradictions: bad, counts: out };
    }, label);
  };

  const qa = await sweep('QA reference', QA);
  const crm = await sweep('Real export', CRM);
  const R = { contradictions: [].concat(qa.contradictions, crm.contradictions),
              qaCounts: qa.counts, crmCounts: crm.counts,
              pageErrors: errs.slice(0, 8) };
  console.log(JSON.stringify(R, null, 1));
  await b.close();
  if (R.contradictions.length || errs.length) process.exitCode = 1;
})();
