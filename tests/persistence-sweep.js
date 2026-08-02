/* ═══════════════════════════════════════════════════════════════════════════
   WHAT SURVIVES SAVE AND LOAD.

   serialize() and hydrate() map task fields EXPLICITLY, name by name. A field
   in one and not the other is written to the file and never read back, or read
   back and never written — and either way the number on screen before the save
   is not the number after the load. Nothing announces it. The plan simply comes
   back slightly different from the one that was put away, which for a file that
   is the only copy of a client engagement is the worst defect this product can
   have.

   It was unguarded. Deleting `percentComplete` from serialize() left every one
   of the forty-four cases and all ten sweeps green while every activity's
   progress silently reset to zero on reload.

   The check is deliberately general rather than a list of fields to remember:
   it takes every key the live objects carry, drops the ones the engine
   recomputes on load, and demands the rest come back. Adding a new persisted
   field therefore extends the check by itself. If a field genuinely should not
   survive, it goes in DERIVED below with the reason — an explicit decision
   rather than an omission nobody notices.
   ═══════════════════════════════════════════════════════════════════════════ */
const { requirePlaywright, chromePath, APP, FIXTURE } = require('./_harness');
const { chromium } = requirePlaywright();
const fs = require('fs'), path = require('path');
const CRM = FIXTURE();
const QA = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '..', 'fixtures', 'qa-reference.json'), 'utf8'));

/* Recomputed by calculate() the moment a plan loads, so their absence from the
   file is correct and their presence would be duplicated truth. */
const DERIVED = ['te', 'variance', 'es', 'ef', 'ls', 'lf', 'slack', 'isCritical',
  'criticality', 'startDate', 'finishDate', 'overallocated', 'wbs', 'isSummary',
  'baseStart', 'baseFinish', 'baseCost', 'baseTe'];

(async () => {
  const b = await chromium.launch({headless:true,args:['--no-sandbox'],executablePath: chromePath()});
  const page = await b.newPage({viewport:{width:1440,height:1200}});
  page.on('dialog', d => d.accept());
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(APP, {waitUntil:'load'});

  const sweep = async (label, data) => {
    await page.evaluate(d => { hydrate(d); calculate(); }, data);
    await page.waitForTimeout(400);
    return page.evaluate(([lbl, DERIVED]) => {
      const bad = [];
      const say = (w, x) => bad.push(lbl + ' · ' + w + ' :: ' + x);
      const out = { tasks: 0, fieldsChecked: 0, resources: 0, raid: 0 };
      /* ═══ NOTHING TO TEST IS NOT A PASS ════════════════════════════════════
         A round trip over ZERO tasks is a perfect round trip. Every field
         comparison below iterates the task list, so an empty plan satisfies all
         of them by having nothing to disagree about — which is precisely the
         shape of a save/load defect that drops everything. */
      if (!tasks.filter(t => !t.isSummary).length) {
        say('Round trip', 'the plan holds no activities, so every field comparison below iterates an empty '
          + 'list and passes without comparing anything — a save that dropped the entire plan would look '
          + 'exactly like this');
        return { contradictions: bad, counts: out };
      }
      const eq = (a, c) => JSON.stringify(a === undefined ? null : a)
                        === JSON.stringify(c === undefined ? null : c);

      // ── 1. EVERY PERSISTED TASK FIELD COMES BACK ────────────────────────
      // Snapshot the live plan, put it away, get it out, compare.
      const keys = new Set();
      tasks.forEach(t => Object.keys(t).forEach(k => keys.add(k)));
      DERIVED.forEach(k => keys.delete(k));
      const persisted = [...keys].sort();
      out.fieldsChecked = persisted.length;
      out.tasks = tasks.length;

      const beforeT = tasks.map(t => {
        const o = { id: t.id }; persisted.forEach(k => o[k] = t[k]); return o; });
      const beforeR = JSON.parse(JSON.stringify(resources || []));
      const beforeRaid = JSON.parse(JSON.stringify(raid || []));
      out.resources = beforeR.length; out.raid = beforeRaid.length;

      const file = JSON.stringify(serialize());
      hydrate(JSON.parse(file)); calculate();

      if (tasks.length !== beforeT.length)
        say('Round trip', 'saved ' + beforeT.length + ' activities and loaded back ' + tasks.length);

      const lost = new Map();          // field -> how many activities lost it
      beforeT.forEach(b0 => {
        const now = tasks.find(t => t.id === b0.id);
        if (!now) { say('Round trip', 'activity ' + b0.id + ' did not come back at all'); return; }
        persisted.forEach(k => {
          if (!eq(b0[k], now[k])) lost.set(k, (lost.get(k) || 0) + 1);
        });
      });
      lost.forEach((n, k) => {
        const ex = beforeT.find(b0 => { const t = tasks.find(x => x.id === b0.id);
          return t && !eq(b0[k], t[k]); });
        const now = tasks.find(x => x.id === ex.id);
        say('Round trip', '"' + k + '" does not survive save and load — ' + n + ' of '
          + beforeT.length + ' activities changed, e.g. "' + (now.name || ex.id) + '" held '
          + JSON.stringify(ex[k]) + ' and came back ' + JSON.stringify(now[k]));
      });

      // ── 2. THE ROSTER AND THE RAID LOG SURVIVE TOO ──────────────────────
      // Rates live on the roster; lose one and every cost on the screen halves
      // with no error anywhere.
      if (JSON.stringify(resources || []) !== JSON.stringify(beforeR))
        say('Round trip', 'the resource roster changed across save and load');
      if (JSON.stringify(raid || []) !== JSON.stringify(beforeRaid))
        say('Round trip', 'the RAID log changed across save and load');

      // ── 3. A FIELD SET TO A DISTINCTIVE VALUE STILL COMES BACK ──────────
      // The pass above can only see fields the fixture happens to populate. A
      // field that is null everywhere round-trips as null whether it is mapped
      // or not, so write a value into each one first and repeat.
      const probe = { percentComplete: 37, actualCost: 4321, fixedCost: 765,
        owner: 'PersistenceProbe', units: 63, jira: 'PROBE-1', description: 'd',
        deliverable: 'dl', acceptance: 'ac', actualStart: '2026-03-04',
        actualFinish: '2026-03-05', actualEffort: 2.5, deadline: '2026-04-01',
        audience: 'client', taxonomy: null, milestone: false };
      const target = tasks.find(t => !t.isSummary && !t.milestone);
      if (!target) return { contradictions: bad, counts: out };
      const applied = {};
      Object.keys(probe).forEach(k => {
        if (probe[k] === null) return;
        if (!(k in target) && k !== 'deadline' && k !== 'audience') return;
        target[k] = probe[k]; applied[k] = probe[k];
      });
      const id = target.id;
      hydrate(JSON.parse(JSON.stringify(serialize()))); calculate();
      const back = tasks.find(t => t.id === id);
      Object.keys(applied).forEach(k => {
        if (!back) return;
        if (!eq(applied[k], back[k]))
          say('Round trip', 'wrote "' + k + '" = ' + JSON.stringify(applied[k])
            + ' and it came back ' + JSON.stringify(back[k]));
      });

      return { contradictions: bad, counts: out };
    }, [label, DERIVED]);
  };

  const qa = await sweep('QA reference', QA);
  const crm = await sweep('Real export', CRM);
  /* ═══ ONE BACKUP HAS TO MEAN EVERYTHING ═══════════════════════════════════
     A workspace is four stores and three of them live OUTSIDE any project on
     purpose, because they outlive it: the estimate bank, the people library and
     the company registry. "Back up all projects" carried only the projects, so
     restoring on another browser gave a library whose calibration was empty,
     whose roster had to be retyped and whose companies resolved to nothing —
     most of what makes the tool worth using on the second engagement, silently
     absent from the thing called a backup.

     Asked as a round trip rather than by inspecting the file: fill all four
     stores, export, wipe, import, and require every one of them back. */
  const RT = await page.evaluate(async () => {
    const bad2 = [], out = {};
    const say2 = x => bad2.push('Backup :: ' + x);
    const org = orgRegister('Northwind Integration');
    saveResLib([{ name: 'M. Webb', kind: 'internal', role: 'Developer',
      org: 'Northwind Integration', orgId: org.id, capacity: 100, rate: 1100, billRate: 1750, rateUnit: 'day' }]);
    saveBank([1.4, 1.5, 1.6].map((r, i) => ({ proj: 'Past', at: '2026-01-01', pid: 'pPast',
      wbs: '1.' + i, name: 'A' + i, kind: 'work-package', tax: 'delivery', owner: 'M. Webb',
      org: 'Northwind Integration', orgId: org.id, orgs: ['Northwind Integration'], orgIds: [org.id],
      unit: 'days', o: 1, m: 2, p: 4, te: 2, actual: 2 * r, ratio: r, basis: 'logged',
      costEst: 2000, costActual: 2000 * r })));
    out.before = { bank: loadBank().length, people: loadResLib().length, orgs: loadOrgLib().length };

    let payload = null;
    const realDownload = window.download;
    window.download = (n, body) => { payload = body; };
    await exportAllProjects();
    window.download = realDownload;
    if (!payload) { say2('the backup produced no file'); return { contradictions: bad2, counts: out }; }
    const d = JSON.parse(payload);
    out.sections = ['projects', 'bank', 'people', 'orgs'].filter(k => Array.isArray(d[k]));
    ['bank', 'people', 'orgs'].forEach(k => {
      if (!Array.isArray(d[k]) || !d[k].length)
        say2('the backup carries no ' + k + ' — it is called a backup and leaves behind a store that '
          + 'outlives every project in it');
    });

    saveBank([]); saveResLib([]); saveOrgLib([]);      // a machine with nothing on it
    const realConfirm = window.confirm, realFlash = window.flashSaved;
    window.confirm = () => true; window.flashSaved = () => {};
    await importLibraryBundle(d);
    out.after = { bank: loadBank().length, people: loadResLib().length, orgs: loadOrgLib().length };
    ['bank', 'people', 'orgs'].forEach(k => {
      if ((out.after[k] || 0) < (out.before[k] || 0))
        say2('restoring gave back ' + out.after[k] + ' of ' + out.before[k] + ' ' + k + ' record(s)');
    });
    const back = loadOrgLib().find(o => o.name === 'Northwind Integration');
    out.orgIdRestored = !!(back && back.id === org.id);
    if (back && back.id !== org.id)
      say2('the company came back under a new id, so its archived history no longer joins up');
    // the same file twice must not duplicate a register
    await importLibraryBundle(d);
    window.confirm = realConfirm; window.flashSaved = realFlash;
    out.afterTwice = { bank: loadBank().length, people: loadResLib().length, orgs: loadOrgLib().length };
    ['bank', 'people', 'orgs'].forEach(k => {
      if ((out.afterTwice[k] || 0) > (out.after[k] || 0))
        say2('importing the same backup twice duplicated ' + k + ' (' + out.after[k] + ' → '
          + out.afterTwice[k] + ') — every copy pulls the medians it sits in');
    });
    saveBank([]); saveResLib([]); saveOrgLib([]);
    return { contradictions: bad2, counts: out };
  });

  const R = { contradictions: [].concat(qa.contradictions, crm.contradictions, RT.contradictions || []),
              qaCounts: qa.counts, crmCounts: crm.counts, backupRoundTrip: RT.counts,
              pageErrors: errs.slice(0, 8) };
  console.log(JSON.stringify(R, null, 1));
  await b.close();
  if (R.contradictions.length || errs.length) process.exitCode = 1;
})();
