/* ═══════════════════════════════════════════════════════════════════════════
   UNDO HAS TO GIVE BACK EXACTLY WHAT IT TOOK.

   Undo is the only feature in this product a person uses precisely when they
   already believe something has gone wrong. That makes a partial restore worse
   than no undo at all: the plan comes back almost right, the person reads the
   one number they were looking at, sees it corrected, and carries on — while a
   field they were not looking at stays as the mistake left it. And the instinct
   after a bad undo is to press undo again, which walks further into the damage.

   So the standard here is byte equality of serialize(), not "the tasks look
   right". Anything less and the check would pass on a restore that silently
   dropped the RAID log, the roster, the requirements or the baseline.

   Snapshots are taken inside saveLocal(), so every case below drives a REAL
   edit path — the activity editor, a delete, a rename — rather than pushing
   onto the stack by hand. A test that calls trackUndo() directly would prove
   the stack works and nothing about whether the product ever fills it.
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
  page.on('dialog', d => d.accept());          // delete confirms
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(APP, {waitUntil:'load'});

  const sweep = async (label, data) => {
    await page.evaluate(d => { hydrate(d); calculate(); resetUndo(); saveLocal(); }, data);
    await page.waitForTimeout(500);
    return page.evaluate(lbl => {
      const bad = [];
      const say = (w, x) => bad.push(lbl + ' · ' + w + ' :: ' + x);
      const out = { ran: [], depth: 0 };
      const ran = k => out.ran.push(k);
      /* ═══ NOTHING TO TEST IS NOT A PASS ════════════════════════════════════
         Undo is tested by MAKING an edit and taking it back. With no activity
         to edit there is nothing to put on the stack, so the history assertions
         below compare an empty stack to an empty stack and agree. */
      if (!tasks.filter(t => !t.isSummary).length) {
        say('History', 'the plan holds no activities, so nothing can be edited and the undo stack below is '
          + 'compared empty against empty — this run tested nothing');
        return { contradictions: bad, counts: out };
      }
      /* serialize() writes DERIVED values too — a summary's percentComplete is
         rolled up from its children, and saveLocal() runs before refreshAll(),
         so the bytes on disk carry the rollup as it stood BEFORE the edit.
         recompute() fixes it on load, which means a restored plan is correct
         while the snapshot it came from was stale. Comparing raw serialize()
         therefore accuses undo of losing a value it actually repaired.

         Recompute before snapshotting, on both sides. The standard stays byte
         equality — of what the plan MEANS, rather than of a buffer that is
         allowed to lag. recompute() rather than calculate(): the latter re-runs
         the Monte Carlo, and 68 of those in the cap check is minutes of nothing. */
      const snap = () => { if (tasks.length) recompute(); return JSON.stringify(serialize()); };
      const diffKeys = (a, c) => {           // which top-level sections differ
        const A = JSON.parse(a), C = JSON.parse(c), d = [];
        new Set([...Object.keys(A), ...Object.keys(C)]).forEach(k => {
          if (JSON.stringify(A[k]) !== JSON.stringify(C[k])) d.push(k); });
        return d;
      };
      /* hydrate() REPLACES the tasks array with fresh objects, so any reference
         held across a restore points at an orphan that is never serialized
         again. An edit through such a reference changes nothing, no snapshot is
         pushed, and every check after it silently measures an empty history —
         which is exactly what this probe did on its first run. Hold the id, look
         the activity up each time. */
      const first = leafTasks().find(t => !t.milestone && !t.isSummary);
      if (!first) return { contradictions: bad, counts: out };
      const SID = first.id;
      const live = () => tasks.find(t => t.id === SID);
      const edit = () => { const t = live();
        if (!t) { say('Undo', 'the activity under test vanished from the plan'); return; }
        t.percentComplete = ((t.percentComplete || 0) + 7) % 100;
        t.name = t.name + '·'; saveLocal(); };

      // ── 1. ONE EDIT, ONE UNDO, EXACTLY THE PLAN THAT WAS THERE ──────────
      ran('1·singleUndo');
      const before = snap();
      edit();
      const edited = snap();
      if (edited === before) { say('Undo', 'an edit did not change the serialized plan, so nothing '
        + 'below is testing anything'); return { contradictions: bad, counts: out }; }
      doUndo();
      if (snap() !== before) {
        const d = diffKeys(before, snap());
        say('Undo', 'undoing one edit did not restore the plan — these sections came back different: '
          + (d.join(', ') || '(equal by section, unequal as a whole)'));
      }

      // ── 2. REDO PUTS THE EDIT BACK, EXACTLY ─────────────────────────────
      ran('2·redo');
      doRedo();
      if (snap() !== edited) {
        const d = diffKeys(edited, snap());
        say('Undo', 'redo did not restore the edited plan — differs in: ' + (d.join(', ') || 'whole'));
      }

      // ── 3. A STACK OF EDITS UNWINDS IN ORDER ────────────────────────────
      // Not just "the oldest state comes back" — every intermediate state must
      // come back in reverse order, or the history is a bag rather than a stack.
      ran('3·stackOrder');
      resetUndo(); saveLocal();
      const states = [snap()];
      for (let i = 0; i < 5; i++) { edit(); states.push(snap()); }
      out.depth = undoStack.length;
      for (let i = states.length - 1; i > 0; i--) {
        doUndo();
        if (snap() !== states[i - 1])
          say('Undo', 'step ' + i + ' of the history came back as a different plan than the one '
            + 'that was there (differs in: ' + (diffKeys(states[i - 1], snap()).join(', ') || 'whole') + ')');
      }

      // ── 4. UNDOING PAST THE BEGINNING DOES NOTHING ──────────────────────
      // Not "throws" and not "clears the plan" — a no-op, with the button off.
      ran('4·floor');
      const atFloor = snap();
      doUndo(); doUndo();
      if (snap() !== atFloor) say('Undo', 'undoing past the start of the session changed the plan');
      const ub = document.getElementById('undoBtn');
      if (ub && !ub.disabled && !undoStack.length)
        say('Undo', 'the undo button is live with an empty history');

      // ── 5. AN EDIT AFTER AN UNDO ABANDONS THE REDO BRANCH ───────────────
      // Standard semantics, and the alternative is worse than it sounds: a redo
      // that survives would restore a plan built on a version the person
      // deliberately backed out of.
      ran('5·redoBranch');
      resetUndo(); saveLocal();
      edit(); edit();
      doUndo();
      if (!redoStack.length) say('Undo', 'an undo left nothing to redo');
      edit();
      if (redoStack.length)
        say('Undo', 'editing after an undo left ' + redoStack.length + ' redo step(s) alive, so redo '
          + 'can rebuild a plan from a branch that was abandoned');

      /* ── 5b. REDO WALKS FORWARD AS FAR AS UNDO WALKED BACK ───────────────
         restoreSnapshot ends by calling saveLocal, which clears the redo branch
         — so doRedo has to put the pending redos back afterwards, and it does.
         A single undo-then-redo cannot see that: the first redo works either
         way, and only the SECOND one finds the branch gone. Checking one step
         passes on a build where redo silently stops after one press. */
      ran('5b·redoChain');
      resetUndo(); saveLocal();
      const t0 = snap(); edit();
      const t1 = snap(); edit();
      const t2 = snap(); edit();
      const t3 = snap();
      doUndo(); doUndo(); doUndo();
      if (snap() !== t0) say('Undo', 'three undos did not return to the state three edits ago');
      const fwd = [t1, t2, t3];
      for (let i = 0; i < fwd.length; i++) {
        doRedo();
        if (snap() !== fwd[i]) {
          say('Undo', 'redo number ' + (i + 1) + ' of 3 did not move the plan forward to the state '
            + 'it should — redo stops part-way through a branch it walked back');
          break;
        }
      }

      // ── 6. UNDO IS NOT ITSELF AN EDIT ───────────────────────────────────
      // restoreSnapshot calls saveLocal, which is what fills the history. If the
      // guard ever fails, one undo pushes its own result onto the stack and the
      // next undo returns to where you just were — undo stops moving.
      ran('6·notSelfRecording');
      resetUndo(); saveLocal();
      edit();
      const depth1 = undoStack.length;
      doUndo();
      if (undoStack.length > depth1 - 1)
        say('Undo', 'undoing grew the history from ' + depth1 + ' to ' + undoStack.length
          + ' — undo is recording itself and will stop making progress');

      // ── 7. THE HISTORY IS CAPPED AND DROPS THE OLDEST, NOT THE NEWEST ───
      /* Asking only "did undo move at all" is not enough: a cap that discards the
         NEWEST push still leaves sixty old states to walk back through, so undo
         moves — to somewhere the person was an hour ago rather than a second
         ago. What must hold is that one undo returns the state immediately
         before the last edit. */
      ran('7·cap');
      resetUndo(); saveLocal();
      const CAP = 60;
      const trail = [snap()];
      for (let i = 0; i < CAP + 8; i++) { edit(); trail.push(snap()); }
      if (undoStack.length > CAP)
        say('Undo', 'the history holds ' + undoStack.length + ' steps against a stated cap of ' + CAP);
      doUndo();
      if (snap() !== trail[trail.length - 2])
        say('Undo', 'with the history full, one undo did not return the state from immediately '
          + 'before the last edit — the cap is discarding the newest steps rather than the oldest');

      // ── 8. UNDO BRINGS BACK A DELETED ACTIVITY, WHOLE ───────────────────
      // The case a person actually reaches for undo. Deleting reparents children
      // and drops dependency links, so a partial restore here loses structure,
      // not just a row.
      ran('8·deleteRestore');
      resetUndo(); saveLocal();
      const victim = leafTasks().find(t => !t.isSummary && !t.milestone
        && tasks.some(x => (x.predecessors || []).some(p => p.id === t.id)));
      if (!victim) out.ran.push('8·SKIPPED-no-activity-with-a-dependent');
      else {
        const whole = snap(), vid = victim.id;
        deleteTask(vid);
        if (tasks.some(t => t.id === vid)) say('Undo', 'deleteTask left the activity in the plan');
        doUndo();
        if (snap() !== whole)
          say('Undo', 'undoing a delete did not restore the plan — differs in: '
            + (diffKeys(whole, snap()).join(', ') || 'whole'));
        if (!tasks.some(t => t.id === vid))
          say('Undo', 'undoing a delete did not bring the activity back at all');
      }

      // ── 9. UNDO RESTORES MORE THAN THE ACTIVITIES ───────────────────────
      // hydrate() carries the RAID log, the roster and the requirements. If undo
      // only rewound `tasks`, a deleted risk would be gone for good and nothing
      // on screen would say so.
      ran('9·wholeDocument');
      resetUndo(); saveLocal();
      const wide = snap();
      const savedRaid = raid.slice();
      raid = raid.concat([{ id: 99001, type: 'Risk', title: 'UndoProbe', probability: 3, impact: 3,
        owner: '', status: 'Open', mitigation: '', outcome: '', outcomeNote: '',
        links: [], taskId: null, v: 2 }]);
      if (resources && resources.length) resources[0].rate = (resources[0].rate || 0) + 111;   // re-read each time: hydrate replaces this array too
      saveLocal();
      doUndo();
      if (raid.some(r => r.title === 'UndoProbe'))
        say('Undo', 'undo left a RAID entry that was added after the snapshot');
      if (snap() !== wide)
        say('Undo', 'undo restored the activities but not the whole document — differs in: '
          + (diffKeys(wide, snap()).join(', ') || 'whole'));
      raid = savedRaid;

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
