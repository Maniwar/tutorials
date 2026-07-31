/* ═══════════════════════════════════════════════════════════════════════════
   THE ESTIMATE BANK — THE ONE SURFACE WITH NO CHECKS AT ALL.

   Nineteen check files and not one of them touched the bank, which is the only
   data in this product that OUTLIVES the project file: it lives in IndexedDB
   under a key of its own, accumulates across engagements, and silently
   calibrates every AI estimate the tool makes afterwards. A wrong median here
   does not show up as a wrong number on a screen — it shows up as a quote that
   is 40% light, on the next engagement, to a different client.

   Three things must hold, and each of them was broken or unreachable before:

     ONLY MEASURED ROWS TEACH. An actual derived from the distance between two
     dates is a calendar span, not logged effort. Those are kept and counted and
     must be excluded from every median, or the bank quietly teaches itself that
     work takes as long as the gap between the day it started and the day someone
     remembered to close it.

     A PROJECT CAN BE FORGOTTEN. There was no path to this short of hand-editing
     the exported JSON. A bank you cannot take a bad engagement out of is a bank
     nobody dares archive into, so the button is what makes the rest of it usable
     — and it has to actually move the calibration, not just shorten a list.

     THE PANEL NAMES A CONTROL THAT EXISTS. Three separate places told the reader
     to press "Archive to historical data" on the Analytics tab. There is no such
     button and it is not on that tab: it is Export ▾ ▸ 🗄 Archive to estimation
     history, in the header. An instruction pointing at nothing is why a feature
     reads as unmanageable even when it works, and it is invisible to every check
     that only asks whether the arithmetic is right.
   ═══════════════════════════════════════════════════════════════════════════ */
const { requirePlaywright, chromePath, APP, FIXTURE } = require('./_harness');
const { chromium } = requirePlaywright();

(async () => {
  const b = await chromium.launch({headless:true,args:['--no-sandbox'],executablePath: chromePath()});
  const page = await b.newPage({viewport:{width:1440,height:1200}});
  page.on('dialog', d => d.accept());
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(APP, {waitUntil:'load'});
  await page.evaluate(d => { hydrate(d); calculate(); }, FIXTURE());
  await page.waitForTimeout(400);

  const R = await page.evaluate(async () => {
    const bad = [], out = { ran: [] };
    const say = x => bad.push('Bank :: ' + x);
    const ran = k => out.ran.push(k);
    const mk = (proj, i, ratio, basis) => ({ proj: proj, when: '2026-01-01', name: 'A' + i,
      tax: 'delivery', te: 2, actual: 2 * ratio, ratio: ratio, basis: basis || 'logged',
      unit: 'days', pid: 'p' + proj });

    // ── 1. ONLY LOGGED ROWS MOVE THE MEDIAN ─────────────────────────────────
    ran('1·spanRowsDoNotTeach');
    saveBank([mk('A', 1, 1.0), mk('A', 2, 1.0), mk('A', 3, 1.0), mk('A', 4, 1.0), mk('A', 5, 1.0)]);
    const clean = bankCalibration();
    out.medianAllLogged = clean && clean.overall;
    if (!clean) say('five measured activities produced no calibration at all');
    // add five span-derived rows at a wildly different ratio; the median must not budge
    saveBank(loadBank().concat([mk('A', 6, 9, 'span'), mk('A', 7, 9, 'span'), mk('A', 8, 9, 'span'),
                                mk('A', 9, 9, 'span'), mk('A', 10, 9, 'span')]));
    const withSpans = bankCalibration();
    out.medianWithSpans = withSpans && withSpans.overall;
    if (clean && withSpans && Math.abs(withSpans.overall - clean.overall) > 0.001)
      say('five span-derived rows moved the median from ' + clean.overall + '× to ' + withSpans.overall
        + '× — a calendar gap is being taught to the estimator as measured effort');

    // ── 2. FORGETTING A PROJECT MOVES THE CALIBRATION ───────────────────────
    // Not just "the list is shorter": the point of the button is that a bad
    // engagement stops affecting future estimates.
    ran('2·forgetProject');
    saveBank([mk('Alpha', 1, 1.1), mk('Alpha', 2, 1.0), mk('Alpha', 3, 1.2), mk('Alpha', 4, 1.1), mk('Alpha', 5, 1.0),
              mk('Beta', 6, 4.0), mk('Beta', 7, 3.8), mk('Beta', 8, 3.5), mk('Beta', 9, 3.9), mk('Beta', 10, 4.1)]);
    const both = bankCalibration();
    out.medianBothProjects = both && both.overall;
    bankForgetProject('Beta');
    const after = loadBank();
    out.rowsAfterForget = after.length;
    out.projectsAfterForget = [...new Set(after.map(r => r.proj))];
    if (after.some(r => r.proj === 'Beta')) say('forgetting a project left its records in the bank');
    if (after.length !== 5) say('forgetting one of two 5-row projects left ' + after.length + ' rows, not 5');
    const alone = bankCalibration();
    out.medianAfterForget = alone && alone.overall;
    if (both && alone && Math.abs(alone.overall - both.overall) < 0.05)
      say('the median barely moved after removing five activities that ran at ~4× — the records were dropped '
        + 'from the list without being dropped from the calibration');
    // and it must not remove anything else
    bankForgetProject('NoSuchProject');
    if (loadBank().length !== 5)
      say('forgetting a project that does not exist changed the bank');

    // ── 3. THE PANEL EXPLAINS ITSELF AND POINTS AT REAL CONTROLS ────────────
    ran('3·panelNamesRealControls');
    switchTab('analytics'); renderBank();
    const host = document.getElementById('bankPanel');
    const txt = host ? host.textContent : '';
    if (!host) say('the bank panel is not on the page');
    if (!/How this bank works/i.test(txt))
      say('the populated panel never says how the bank works — where records live, what puts them there, or what '
        + 'they change');
    if (/Archive to historical data/.test(txt))
      say('the panel still sends the reader to "Archive to historical data", a button that does not exist');
    if (!/Archive to estimation history/.test(txt))
      say('the panel does not name the control that actually files records');
    const forgets = host ? [...host.querySelectorAll('button')].filter(x => /Forget/.test(x.textContent)) : [];
    out.forgetButtons = forgets.length;
    if (forgets.length !== 1)
      say('one project is filed and the panel offers ' + forgets.length + ' way(s) to remove it');
    /* The dead button name appeared in a tooltip and an alert as well as in the
       panel, so the whole page is swept — but only what a person can actually
       read. The first version tested document.body.innerHTML, which in this file
       includes the entire script: it went red on a code comment explaining the
       fix. Rendered text and title attributes are the surface that matters; the
       source is not an instruction to anyone. */
    {
      const seen = [];
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode: n => /^(script|style)$/i.test((n.parentElement || {}).tagName || '')
          ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
      let n; while ((n = walk.nextNode())) if (/Archive to historical data/.test(n.nodeValue || '')) seen.push('text');
      document.querySelectorAll('[title],[data-help],[aria-label]').forEach(el => {
        ['title', 'data-help', 'aria-label'].forEach(a => {
          if (/Archive to historical data/.test(el.getAttribute(a) || '')) seen.push(a);
        });
      });
      out.deadNameSightings = seen.length;
      if (seen.length)
        say(seen.length + ' place(s) a reader can see still say "Archive to historical data" ('
          + [...new Set(seen)].join(', ') + ') — a button under a name that does not exist');
    }

    // ── 4. AN EMPTY BANK SAYS SO, AND STILL SAYS WHERE RECORDS COME FROM ────
    ran('4·emptyState');
    saveBank([]); renderBank();
    const et = document.getElementById('bankPanel').textContent;
    if (!/Nothing filed yet/i.test(et)) say('an empty bank does not say it is empty');
    if (!/Archive to estimation history/.test(et))
      say('the empty state does not name the control that fills it, which is the only thing a reader needs there');
    if (bankCalibration()) say('an empty bank still returns a calibration');
    if (bankPromptBlock() !== '') say('an empty bank still injects a calibration block into every AI prompt');

    // ── 5. THE PROMPT BLOCK CARRIES THE MEASURED RECORD, NOT THE SPANS ──────
    // This is the only path by which the bank reaches an estimate, so a block
    // that disagrees with the panel is a silent mis-calibration.
    ran('5·promptBlock');
    saveBank([mk('A', 1, 1.5), mk('A', 2, 1.5), mk('A', 3, 1.5), mk('A', 4, 1.5), mk('A', 5, 1.5),
              mk('A', 6, 9, 'span')]);
    const pb = bankPromptBlock();
    out.promptBlockLen = pb.length;
    if (!pb) say('a bank with five measured activities injects nothing into the prompts it is meant to calibrate');
    else {
      const c2 = bankCalibration();
      if (c2 && pb.indexOf(String(c2.overall)) < 0)
        say('the prompt block does not carry the median the panel shows (' + c2.overall + '×), so the estimator '
          + 'is calibrated against a different number than the one on screen');
      if (/\b9(\.0)?×/.test(pb))
        say('the prompt block quotes the span-derived 9× ratio, teaching the estimator from a calendar gap');
    }

    /* ── 6. WHO DID IT, AND WHO THEY WORK FOR ────────────────────────────────
       The bank could calibrate by activity kind, work type and role, and could
       not answer the question that comes up every time the same subcontractor
       appears on another engagement: does THAT firm's work run over. A role
       cannot answer it — two firms both field "integration developers" — and a
       person's name usually cannot either, because individuals rarely repeat
       across clients while the partner does.

       Three properties. The company reaches the archived row at all. Joint work
       counts in BOTH firms' evidence rather than being attributed to one. And
       what the calibration knows reaches the PROMPT, because a signal computed
       and never sent calibrates nothing. */
    /* First the END TO END path, because everything after it is synthetic. The
       rows below are hand-built, so a build that never records a company when it
       ARCHIVES a real plan passes every one of them — the calibration would be
       correct about data that never arrives. Set a company on the roster, ask
       the archiver for its rows, and require the field to be there. */
    ran('6a·companyReachesTheArchive');
    const owned = leafTasks().find(t => !t.isSummary && !t.milestone && taskParticipants(t).length
      && actualEffortDays(t) != null);
    if (!owned) out.archiveOrgCase = 'SKIPPED-no-activity-with-an-actual';
    else {
      const who = taskParticipants(owned)[0].name;
      const keepOrg = (resources[who] || {}).org;
      if (!resources[who]) resources[who] = { capacity: 100 };
      resources[who].org = 'Northwind Integration';
      const built = bankRowsFromPlan().filter(r => (r.people || []).some(x => x.n === who));
      out.archivedRowsForPerson = built.length;
      if (!built.length)
        say('the archiver produces no row naming the person who did the work, so nothing downstream can '
          + 'group by who or by their company');
      else {
        const one = built[0];
        /* Both fields, separately. `org` is the owner's company and is what the
           row shows; `orgs` is EVERY company that touched the activity and is
           what the multi-bucket calibration groups on. They are not spare copies
           of each other — accepting either would mean losing the set that makes
           joint work count for both firms goes unnoticed, and that is precisely
           the case company calibration exists for. */
        if (!one.org)
          say('the archived row carries no owning company, so its own line in the bank cannot say who did it');
        else if (one.org !== 'Northwind Integration')
          say('the archived owning company is "' + one.org + '" where the roster says Northwind Integration');
        const everyOrg = [...new Set(taskParticipants(owned).map(pr => (resources[pr.name] || {}).org)
          .filter(Boolean))];
        out.archivedOrgs = (one.orgs || []).length;
        everyOrg.forEach(o2 => {
          if ((one.orgs || []).indexOf(o2) < 0)
            say('"' + o2 + '" worked on this activity and is missing from the archived company set — work '
              + 'shared between two firms has to be evidence about both, and this row will only ever teach '
              + 'the calibration about one of them');
        });
        const me = (one.people || []).find(x => x.n === who);
        if (!me) say('the archived row lists participants and the person who owns the activity is not among them');
        else if (!(me.u > 0))
          say('the archived participant carries no allocation, so one person at 100% and four at 25% are '
            + 'recorded identically and the effort behind the ratio cannot be read');
      }
      if (keepOrg === undefined) delete resources[who].org; else resources[who].org = keepOrg;
    }

    ran('6b·companyCalibration');
    const withOrg = (proj, i, ratio, org, orgs, owner) => Object.assign(
      mk(proj, i, ratio), { org: org, orgs: orgs || (org ? [org] : []), owner: owner || ('P' + i) });
    saveBank([
      withOrg('A', 1, 1.4, 'Northwind Integration'), withOrg('A', 2, 1.5, 'Northwind Integration'),
      withOrg('A', 3, 1.6, 'Northwind Integration'), withOrg('A', 4, 1.45, 'Northwind Integration'),
      withOrg('A', 5, 1.0, 'Us'), withOrg('A', 6, 1.0, 'Us'),
      withOrg('A', 7, 1.05, 'Us'), withOrg('A', 8, 0.95, 'Us')
    ]);
    const cOrg = bankCalibration();
    out.byOrg = cOrg && (cOrg.byOrg || []).map(x => x.k + ':' + x.median + '(n=' + x.n + ')');
    if (!cOrg || !(cOrg.byOrg || []).length)
      say('eight archived activities across two companies produce no calibration by company — the one '
        + 'signal that carries from engagement to engagement when the individual names do not');
    else {
      const nw = cOrg.byOrg.find(x => /Northwind/.test(x.k));
      const us = cOrg.byOrg.find(x => x.k === 'Us');
      if (!nw || !us) say('the by-company split lost one of the two companies in the bank');
      else if (!(nw.median > us.median))
        say('the partner running 40–60% over shows a median of ' + nw.median + '× against ' + us.median
          + '× for work done in-house — the split is not reading the ratios it is grouping');
      const pb2 = bankPromptBlock();
      out.promptNamesCompany = /Northwind/.test(pb2);
      if (!out.promptNamesCompany)
        say('the calibration knows a company has run consistently over and the prompt block never says '
          + 'so, so every future estimate is written without it');
    }
    /* joint work is evidence about EVERY firm on it. Attributing an activity two
       firms shared to whichever name happens to be in `owner` throws away half
       the record and biases both buckets. */
    saveBank([
      withOrg('B', 1, 2.0, '', ['Northwind Integration', 'Us'], 'shared1'),
      withOrg('B', 2, 2.0, '', ['Northwind Integration', 'Us'], 'shared2'),
      withOrg('B', 3, 2.0, '', ['Northwind Integration', 'Us'], 'shared3'),
      withOrg('B', 4, 1.0, 'Us'), withOrg('B', 5, 1.0, 'Us'), withOrg('B', 6, 1.0, 'Us')
    ]);
    const cJoint = bankCalibration();
    out.jointOrgs = cJoint && (cJoint.byOrg || []).map(x => x.k + ':n=' + x.n);
    const nwJ = cJoint && (cJoint.byOrg || []).find(x => /Northwind/.test(x.k));
    const usJ = cJoint && (cJoint.byOrg || []).find(x => x.k === 'Us');
    if (!nwJ)
      say('three activities worked jointly by two firms are credited to neither — a row with no single '
        + 'owning company drops out of the company calibration entirely');
    else if (nwJ.n !== 3)
      say('the partner on three shared activities is credited with ' + nwJ.n + ' of them');
    if (!usJ || usJ.n !== 6)
      say('the in-house side of three shared activities plus three of its own shows n='
        + (usJ ? usJ.n : 0) + ' rather than 6 — shared work is evidence about BOTH firms, not one');

    /* ── 7. THE ID IS WHAT JOINS A COMPANY ACROSS PROJECTS ───────────────────
       The whole point of recording a company is comparing the same firm over
       several engagements, and a free-text name cannot do it: "Northwind
       Integration" retyped as "Northwind Integration Ltd" on the fourth project
       silently starts a fourth history with n=1, right when the first three had
       become worth something. So the calibration groups on the ID and labels
       with the CURRENT name — which also means renaming a company reaches
       records archived years ago.

       Asked as the thing that would actually happen: file rows under one
       spelling, rename the company, and require the bucket to survive intact
       under the new name. */
    ran('7·companyIdSurvivesARename');
    const rec = orgRegister('Northwind Integration');
    out.orgRegistered = rec && rec.id;
    if (!rec) say('registering a company returns nothing, so there is no id to record on an archived row');
    else {
      const withId = (i, ratio) => Object.assign(mk('C', i, ratio),
        { org: 'Northwind Integration', orgs: ['Northwind Integration'],
          orgId: rec.id, orgIds: [rec.id], owner: 'M. Webb' });
      saveBank([withId(1, 1.4), withId(2, 1.5), withId(3, 1.6), withId(4, 1.45)]);
      const before = bankCalibration();
      const bBucket = (before.byOrg || []).find(x => x.k === 'Northwind Integration');
      out.orgBucketBeforeRename = bBucket ? bBucket.n : 0;
      if (!bBucket) say('rows carrying a company id produce no company bucket at all');

      orgRename(rec.id, 'Northwind Integration Ltd');
      const after = bankCalibration();
      const aBucket = (after.byOrg || []).find(x => x.k === 'Northwind Integration Ltd');
      out.orgBucketAfterRename = aBucket ? aBucket.n : 0;
      if (!aBucket)
        say('renaming a company loses its history — the four archived activities no longer appear under '
          + 'the new name, which is exactly the join the id exists to provide');
      else if (bBucket && aBucket.n !== bBucket.n)
        say('the renamed company carries ' + aBucket.n + ' records where it had ' + bBucket.n);
      else if (bBucket && aBucket.median !== bBucket.median)
        say('the renamed company reports a median of ' + aBucket.median + '× where it was '
          + bBucket.median + '× — the rename changed the arithmetic, not just the label');
      if ((after.byOrg || []).some(x => x.k === 'Northwind Integration'))
        say('after the rename the company appears under BOTH names, so its history is split in two');
      orgRename(rec.id, 'Northwind Integration');
      // an id must never be user-facing in the calibration labels
      if ((after.byOrg || []).some(x => x.k === rec.id))
        say('the company bucket is labelled with its internal id (' + rec.id + ') rather than its name');
    }

    saveBank([]);
    return { contradictions: bad, counts: out };
  });

  R.pageErrors = errs.slice(0, 8);
  console.log(JSON.stringify(R, null, 1));
  await b.close();
  if (R.contradictions.length || errs.length) process.exitCode = 1;
})();
