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
  const R = { contradictions: [].concat(qa.contradictions, crm.contradictions),
              qaCounts: qa.counts, crmCounts: crm.counts,
              pageErrors: errs.slice(0, 8) };
  console.log(JSON.stringify(R, null, 1));
  await b.close();
  if (R.contradictions.length || errs.length) process.exitCode = 1;
})();
