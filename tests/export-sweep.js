/* ═══════════════════════════════════════════════════════════════════════════
   WHAT LEAVES THE APPLICATION.

   Fourteen export functions produce twenty-one files: a billing CSV, a test
   plan, a traceability matrix, a Jira import, four editable workbook sheets and
   the project JSON. Not one of them had a check.

   They are the only artefacts that reach someone else. Every other defect in
   this product is seen first by the person who made the plan, who can compare
   it against what they know. An export is read by a client, or loaded into
   Jira, or opened in Excel by someone with no way to tell that a total is wrong
   — and by then it has been sent.

   Three questions are asked of each one:

     1. Does it agree with the application? A total in a CSV must be the total
        on the screen, and a row count must be the number of things that exist.
     2. Does it survive the trip out and back? The editable workbook exists to
        be edited and re-imported, so exporting and immediately importing must
        change nothing — the same serialize/hydrate hazard that silently reset
        every activity's progress, on a path a person is invited to use.
     3. Is any of it broken on its face — NaN, undefined, [object Object]?

   Downloads are intercepted rather than written to disk: the sweep replaces
   download / downloadBlobFile, so it reads exactly the bytes a person receives.
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
    return page.evaluate(async lbl => {
      const bad = [];
      const say = (w, x) => bad.push(lbl + ' · ' + w + ' :: ' + x);
      const out = { produced: 0, ran: [] };
      const ran = k => out.ran.push(k);

      /* "undefined" and "NaN" are words that appear in honest prose, so match
         them only where a value belongs: alone, or wearing a unit or currency.
         [object Object] is never anything but a bug. */
      const BROKEN = /\bNaN\b|\[object Object\]|[$£€]\s*undefined|undefined\s*[%$]|\bundefined\b(?!\s+[a-z])/;

      // ── capture what a person actually receives ─────────────────────────
      const files = new Map();
      const origD = window.download, origB = window.downloadBlobFile;
      window.download = (fn, content) => files.set(fn, String(content));
      window.downloadBlobFile = (blob, fn) => files.set(fn, blob);
      const grab = name => { files.clear(); try { window[name](); } catch (e) {
        say('Export', name + '() threw: ' + e.message); } return new Map(files); };

      const csv = txt => parseCSV(txt);
      const num = s => { const v = parseFloat(String(s).replace(/[^0-9.\-]/g, '')); return Number.isFinite(v) ? v : NaN; };

      // ── 1. THE BILLING CSV IS THE BILLING TABLE ─────────────────────────
      // It is the sheet a partner puts in front of a client to justify a fee.
      // Its total must be the sum of its own rows, and both must be the
      // application's own figure.
      ran('1·billing');
      const bill = grab('exportBillingCSV');
      const billTxt = [...bill.values()][0];
      if (typeof billTxt !== 'string') say('Export', 'exportBillingCSV produced no readable file');
      else {
        const rows = csv(billTxt), head = rows[0].map(h => h.toLowerCase());
        const iCost = head.findIndex(h => h.indexOf('cost $') >= 0);
        const iBill = head.findIndex(h => h.indexOf('billed $') >= 0);
        const body = rows.slice(1).filter(r => r.length > 1);
        const total = body.find(r => /^total$/i.test(String(r[0]).trim()));
        const people = body.filter(r => r !== total);
        if (!total) say('Export', 'the billing CSV has no TOTAL row — the one line a reader checks');
        else {
          const sumC = people.reduce((s, r) => s + (num(r[iCost]) || 0), 0);
          const sumB = people.reduce((s, r) => s + (num(r[iBill]) || 0), 0);
          if (Math.abs(sumC - num(total[iCost])) > 2)
            say('Export', 'the billing CSV rows add to ' + sumC.toFixed(0)
              + ' and its TOTAL says ' + num(total[iCost]).toFixed(0));
          if (Math.abs(sumB - num(total[iBill])) > 2)
            say('Export', 'the billing CSV billed column adds to ' + sumB.toFixed(0)
              + ' and its TOTAL says ' + num(total[iBill]).toFixed(0));
          const d = billingData();
          if (Math.abs(num(total[iCost]) - d.totCost) > 2)
            say('Export', 'the billing CSV totals cost ' + num(total[iCost]).toFixed(0)
              + ' and the application says ' + d.totCost.toFixed(0));
          if (Math.abs(num(total[iBill]) - d.totBill) > 2)
            say('Export', 'the billing CSV totals billed ' + num(total[iBill]).toFixed(0)
              + ' and the application says ' + d.totBill.toFixed(0));
        }
        // one line per person on the engagement, plus TOTAL and any fixed-cost line
        const d2 = billingData();
        if (people.filter(r => !/^fixed costs/i.test(String(r[0]))).length !== d2.rows.length)
          say('Export', 'the billing CSV lists ' + people.length + ' people against '
            + d2.rows.length + ' on the engagement');
      }

      // ── 2. THE EDITABLE WORKBOOK SURVIVES A ROUND TRIP ──────────────────
      // It is exported to be edited and brought back. Exporting and importing
      // with nothing changed in between must leave the plan identical; anything
      // else means the invited workflow quietly rewrites the project.
      ran('2·workbookRoundTrip');
      const wb = grab('exportEditableWorkbook');
      out.produced += wb.size;
      const acts = [...wb.entries()].find(([n]) => /activities-editable/.test(n));
      if (!acts) say('Export', 'the editable workbook produced no activities sheet');
      else {
        const snap = tasks.map(t => ({ id: t.id, name: t.name, o: t.o, m: t.m, p: t.p,
          owner: t.owner, units: t.units, percentComplete: t.percentComplete,
          fixedCost: t.fixedCost, parentId: t.parentId, milestone: !!t.milestone,
          preds: JSON.stringify(t.predecessors || []) }));
        let rep = null;
        try { rep = await importCsvText(acts[1]); }
        catch (e) { say('Export', 'its own activities sheet will not import back: ' + e.message); }
        if (rep) {
          if (rep.added) say('Export', 're-importing the untouched activities sheet ADDED '
            + rep.added + ' activit(ies) — a round trip must not grow the plan');
          if (rep.rejected && rep.rejected.length)
            say('Export', 're-importing its own activities sheet rejected ' + rep.rejected.length
              + ' row(s): ' + rep.rejected[0]);
          if (tasks.length !== snap.length)
            say('Export', 'the plan had ' + snap.length + ' activities and after a round trip has '
              + tasks.length);
          const drift = new Map();
          snap.forEach(s => {
            const t = tasks.find(x => x.id === s.id);
            if (!t) { drift.set('(missing)', (drift.get('(missing)') || 0) + 1); return; }
            Object.keys(s).forEach(k => {
              if (k === 'id') return;
              const now = k === 'preds' ? JSON.stringify(t.predecessors || []) : t[k];
              const wasN = typeof s[k] === 'number', tol = wasN ? 1e-9 : 0;
              const same = wasN ? Math.abs((now || 0) - s[k]) <= tol
                : JSON.stringify(now == null ? '' : now) === JSON.stringify(s[k] == null ? '' : s[k]);
              if (!same) {
                if (!drift.has(k)) drift.set(k, { n: 0, eg: s.name + ': ' + JSON.stringify(s[k])
                  + ' → ' + JSON.stringify(now) });
                drift.get(k).n++;
              }
            });
          });
          drift.forEach((v, k) => say('Export', '"' + k + '" changed on ' + (v.n || v)
            + ' activit(ies) by exporting the workbook and importing it back unchanged'
            + (v.eg ? ' — e.g. ' + v.eg : '')));
        }
      }

      // ── 3. COUNTS IN THE DOCUMENTS ARE THE COUNTS THAT EXIST ────────────
      ran('3·counts');
      const stories = (reqs && reqs.stories) || [];
      const acs = stories.reduce((s, x) => s + ((x.ac || []).length), 0);
      if (stories.length) {
        const jira = [...grab('exportJiraCSV').values()][0];
        if (typeof jira === 'string') {
          const jr = csv(jira).slice(1).filter(r => r.length > 1);
          const nStory = jr.filter(r => String(r[0]).trim() === 'Story').length;
          const nEpic = jr.filter(r => String(r[0]).trim() === 'Epic').length;
          if (nStory !== stories.length)
            say('Export', 'the Jira CSV carries ' + nStory + ' stories against '
              + stories.length + ' in the plan');
          if (nEpic !== ((reqs.epics || []).length))
            say('Export', 'the Jira CSV carries ' + nEpic + ' epics against '
              + (reqs.epics || []).length + ' in the plan');
        }
        const trace = [...grab('exportTraceCSV').values()][0];
        if (typeof trace === 'string') {
          const missing = stories.filter(s => trace.indexOf(s.id) < 0);
          if (missing.length)
            say('Export', missing.length + ' stor(ies) are absent from the traceability matrix, e.g. '
              + missing[0].id);
        }
      }
      const tcs = tasks.filter(t => isTestCaseTask(t));
      if (tcs.length) {
        const tcCsv = [...grab('exportTestCasesCSV').values()][0];
        if (typeof tcCsv === 'string') {
          const n = csv(tcCsv).slice(1).filter(r => r.length > 1 && String(r[0]).trim()).length;
          if (n !== tcs.length)
            say('Export', 'the test-case CSV carries ' + n + ' rows against '
              + tcs.length + ' test cases in the plan');
        }
      }

      // ── 4. THE PROJECT FILE RELOADS INTO THE SAME PROJECT ───────────────
      // exportJSON is the save format. If it does not reload identically the
      // product loses work, which is the one defect with no workaround.
      ran('4·jsonReload');
      const js = [...grab('exportJSON').values()][0];
      if (typeof js !== 'string') say('Export', 'exportJSON produced no readable file');
      else {
        const beforeN = tasks.length, beforeCost = Math.round(projectCost());
        const beforePct = tasks.map(t => t.percentComplete || 0).join(',');
        try {
          hydrate(JSON.parse(js)); calculate();
          if (tasks.length !== beforeN)
            say('Export', 'the exported project file reloads with ' + tasks.length
              + ' activities against ' + beforeN + ' exported');
          if (Math.abs(Math.round(projectCost()) - beforeCost) > 1)
            say('Export', 'the exported project file reloads costing '
              + Math.round(projectCost()) + ' against ' + beforeCost + ' exported');
          if (tasks.map(t => t.percentComplete || 0).join(',') !== beforePct)
            say('Export', 'progress does not survive export and reload of the project file');
        } catch (e) { say('Export', 'the exported project file will not parse or load: ' + e.message); }
      }

      // ── 5. NOTHING LEAVES WITH A BROKEN FIGURE IN IT ────────────────────
      ran('5·brokenFigures');
      ['exportBillingCSV', 'exportTestPlanMarkdown', 'exportTestCasesCSV', 'exportReqsMarkdown',
       'exportTraceCSV', 'exportActivitiesEditableCSV', 'exportStoriesEditableCSV',
       'exportTestCasesEditableCSV', 'exportRaidEditableCSV'].forEach(fn => {
        const got = grab(fn);
        out.produced += got.size;
        got.forEach((content, name) => {
          if (typeof content !== 'string') return;
          if (!content.trim()) { say('Export', fn + ' produced an empty "' + name + '"'); return; }
          const m = content.match(BROKEN);
          if (m) say('Export', '"' + name + '" contains "' + m[0].trim() + '"');
        });
      });

      window.download = origD; window.downloadBlobFile = origB;
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
