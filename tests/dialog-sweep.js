/* ═══════════════════════════════════════════════════════════════════════════
   THE DIALOGS NOBODY LOOKED AT.

   Every earlier sweep reads the eight tab panels. I scanned all of them for
   markup rendered as text, found none, and reported the application clean —
   and the dependency-fix wizard was printing raw <span class="ek …"> tags at
   the user, because a dialog is not a tab and nothing ever opened one.

   The defect itself was one word: nm() already returns entity-mark HTML and was
   wrapped in escapeHtml(), so the tags were shown instead of rendered. Trivial
   to fix, impossible to notice from a check that never opens the thing.

   So this opens the dialogs — including the ones that only appear when the plan
   is in a particular state, which is exactly why they are the least-seen and
   most-broken surfaces in the file. A wizard that only fires on a dependency
   loop is a wizard nobody has read since the day it was written.
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
      const say = (w, x) => bad.push(lbl + ' · ' + w + ' :: ' + x);
      const out = { opened: [] };

      /* Markup shown as TEXT. A tag name inside a text node is never prose —
         "<span class=" cannot occur in an English sentence about a project. */
      const TAGS = /<\/?(span|div|b|i|p|button|a|table|td|tr)\b/i;
      const scan = (where, root) => {
        if (!root) return;
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let n, hits = 0, eg = '';
        while ((n = w.nextNode())) {
          const v = n.nodeValue || '';
          if (TAGS.test(v)) { hits++; if (!eg) eg = v.trim().slice(0, 90); }
        }
        if (hits) say(where, hits + ' text node(s) print raw markup instead of rendering it, e.g. "'
          + eg + '"');
        // an entity mark that rendered correctly leaves NO literal class name behind
        if ((root.textContent || '').indexOf('class="ek') >= 0)
          say(where, 'an entity mark is being escaped rather than rendered');
      };

      const openAndScan = (name, fn) => {
        try { fn(); } catch (e) { say(name, 'threw while opening: ' + e.message); return; }
        out.opened.push(name);
        document.querySelectorAll('.modal-overlay').forEach(m => scan(name, m));
      };

      // ── the dependency-fix wizard: only exists when the plan has a loop, so
      //    build one. Two activities pointed at each other is the shape the
      //    wizard is written for.
      const lv = leafTasks().filter(t => !t.milestone);
      if (lv.length >= 2) {
        const A = lv[0], B = lv[1];
        const keepA = (A.predecessors || []).slice(), keepB = (B.predecessors || []).slice();
        A.predecessors = [{ id: B.id, type: 'FS', lag: 0 }];
        B.predecessors = [{ id: A.id, type: 'FS', lag: 0 }];
        try { calculate(); } catch (e) {}
        openAndScan('dependency-fix wizard', () => openDepFixWizard());
        try { closeDepFixWizard(); } catch (e) {}
        A.predecessors = keepA; B.predecessors = keepB;
        try { calculate(); } catch (e) {}
      }

      /* ── EVERY BUTTON IN THE WIZARD ACTS ON THE THING IT NAMES ──────────
         A wizard row holds two different pairs. The headline is the EFFECTIVE
         edge from the cycle walk, leaf waiting on leaf. The buttons act on the
         STORED predecessor entry, which can sit on an ancestor PHASE of the
         waiting task and can point at a phase too. When those differ, the row
         was showing one pair and operating on another, and the visible symptom
         was "the buttons do nothing": ✎ Open opened the leaf from the headline,
         whose Dependencies list is EMPTY — the entry lives on its phase — so
         the person arrived at an editor with nothing to delete. Worse, ⑂ Nest
         under it read as the activity in the headline and re-parented the test
         case under the PHASE, tearing it out of the UAT activity it decomposes,
         while the toast reported success because the loop did clear.

         The shape above (two leaves pointed at each other) can never catch it:
         holder and headline are the same task, so the gap is closed by luck.
         This builds the shape where they differ. */
      const wizRows = () => [...document.querySelectorAll('#depFixBody > div')]
        .filter(r => r.querySelector('button'))
        .map(r => ({
          text: (r.textContent || '').replace(/\s+/g, ' ').trim(),
          nest: (r.querySelector('button.btn-primary') || {getAttribute: () => null}).getAttribute('onclick'),
          cut: (r.querySelector('button.btn-danger') || {getAttribute: () => null}).getAttribute('onclick'),
          open: (r.querySelector('button.btn-secondary') || {getAttribute: () => null}).getAttribute('onclick')
        }));
      const tcW = leafTasks().find(t => isTestCaseTask(t) && !t.isSummary);
      const phW = tasks.find(t => t.isSummary && !isTestCaseTask(t) && leafDescendants(t.id).length);
      if (!tcW || !phW) out.opened.push('wizard-actions·SKIPPED-fixture-has-no-test-case-and-phase');
      if (tcW && phW) {
        const keep = new Map(tasks.map(t => [t.id, (t.predecessors || []).slice()]));
        const keepParent = tcW.parentId;
        tcW.predecessors = [{ id: phW.id, type: 'FS', lag: 0 }];
        phW.predecessors = [{ id: tcW.id, type: 'FS', lag: 0 }];
        try { calculate(); } catch (e) {}
        if (!findScheduleCycleIds()) say('dependency-fix wizard',
          'the probe failed to build a loop, so none of the wizard checks below ran');
        else {
          openDepFixWizard();
          const rows = wizRows();
          out.wizardRows = rows.length;
          if (!rows.length) say('dependency-fix wizard', 'a loop exists but the wizard drew no rows');
          rows.forEach(r => {
            const cut = (r.cut || '').match(/depFixRemove\((\d+),\s*(\d+)/);
            const opn = (r.open || '').match(/openEditModal\((\d+)/);
            if (cut && opn) {
              const holder = tasks.find(t => t.id === +cut[1]);
              const opened = tasks.find(t => t.id === +opn[1]);
              // ✎ Open must land where the link actually is, or there is
              // nothing on screen to edit and the button reads as dead
              if (!opened || !(opened.predecessors || []).some(p => p.id === +cut[2]))
                say('dependency-fix wizard', '✎ Open sends you to “'
                  + ((opened || {name: '#' + opn[1]}).name || '').slice(0, 40)
                  + '”, whose Dependencies list does not contain the link the same row offers to cut '
                  + '(that link is on “' + ((holder || {name: '?'}).name || '').slice(0, 40)
                  + '”) — the editor opens with nothing to delete');
            }
            const nest = (r.nest || '').match(/depFixNestTC\((\d+),\s*(\d+)/);
            if (nest) {
              const target = tasks.find(t => t.id === +nest[2]);
              // nesting under a phase is not "the activity it verifies": it
              // pulls the case out of the activity it decomposes
              if (!target || isSummaryId(target.id))
                say('dependency-fix wizard', '⑂ Nest under … offers to re-parent a test case under “'
                  + ((target || {name: '#' + nest[2]}).name || '').slice(0, 40)
                  + '”, which is a PHASE, not the activity the case verifies');
              if (target && !(r.text || '').includes(target.name.slice(0, 12)))
                say('dependency-fix wizard', '⑂ Nest under … would move the case under “'
                  + target.name.slice(0, 40) + '”, which the row never names');
            }
          });
          /* And the buttons have to be REACHABLE. Naming the objects made the
             labels long enough that the first attempt pushed ✎ Open past the
             right edge of the dialog, where no click can land — a defect every
             assertion above passes straight through, because the handler is
             wired correctly to an element nobody can hit. */
          const dlg = document.querySelector('#depFixModal .modal');
          if (dlg) {
            const box = dlg.getBoundingClientRect();
            [...document.querySelectorAll('#depFixBody button')].forEach(btn => {
              const r = btn.getBoundingClientRect();
              if (r.width < 8 || r.height < 8)
                say('dependency-fix wizard', 'the button “' + btn.textContent.trim().slice(0, 30)
                  + '” has no clickable area (' + Math.round(r.width) + '×' + Math.round(r.height) + ')');
              else if (r.right > box.right + 1 || r.left < box.left - 1)
                say('dependency-fix wizard', 'the button “' + btn.textContent.trim().slice(0, 30)
                  + '” sticks out past the edge of the dialog, so part of it cannot be clicked');
              else if (document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) !== btn
                       && !btn.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)))
                say('dependency-fix wizard', 'a click at the centre of “' + btn.textContent.trim().slice(0, 30)
                  + '” lands on something else');
            });
          }
          // and the guard holds even when called directly, so no future caller
          // can reach the damage the hidden button used to do
          const before = tcW.parentId;
          depFixNestTC(tcW.id, phW.id);
          if (tcW.parentId !== before)
            say('dependency-fix wizard', 'depFixNestTC re-parented a test case under a PHASE when '
              + 'called directly — the guard is only in the button, not in the function');
          try { closeDepFixWizard(); } catch (e) {}
        }
        tcW.parentId = keepParent;
        tasks.forEach(t => { const k = keep.get(t.id); if (k) t.predecessors = k; });
        try { calculate(); } catch (e) {}
      }

      // ── the activity editor, on a real activity
      const t0 = leafTasks().find(t => !t.milestone && !t.isSummary);
      if (t0) { openAndScan('activity editor', () => openEditModal(t0.id, true));
                try { closeModal(); } catch (e) {} }

      // ── the dependency map for an activity that has links
      const t1 = leafTasks().find(t => (t.predecessors || []).length);
      if (t1 && typeof openDepMap === 'function') {
        openAndScan('dependency map', () => openDepMap(t1.id));
        try { closeModal(); } catch (e) {}
      }

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
