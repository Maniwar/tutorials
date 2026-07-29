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
