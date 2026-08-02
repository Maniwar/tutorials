const { requirePlaywright, chromePath, APP, FIXTURE } = require('../_harness');
const { chromium } = requirePlaywright();
const fs = require('fs');
(async () => {
  const b = await chromium.launch({headless:true,args:['--no-sandbox'],executablePath: chromePath()});
  const page = await b.newPage({viewport:{width:1440,height:1000}});
  page.on('dialog', d => d.accept());
  const errs=[]; page.on('pageerror', e=>errs.push(e.message));
  await page.goto(APP,{waitUntil:'load'});
  await page.evaluate(() => { loadSample(); });
  await page.waitForTimeout(500);
  const R = {};

  // an entry linked to the first work package, of whatever shape we ask for
  const seed = (type, outcome, status) => page.evaluate(([type, outcome, status]) => {
    const t = tasks.find(x => !x.isSummary && !x.milestone);
    raid = [{ id: 900, type: type, title: 'Client provides a data steward 2 days/week',
      probability: 3, impact: 4, owner: 'PM', status: status || 'Open', mitigation: '',
      outcome: outcome || '', outcomeNote: outcome ? 'The steward was never named.' : '',
      links: [{ k: 'act', id: t.id, was: t.name }], taskId: t.id, v: 2 }];
    return t.id;
  }, [type, outcome, status]);

  // ── AN ASSUMPTION BEING RELIED ON IS NOT A CAUSE ───────────────────────
  R.watchingIsNotCause = await page.evaluate(async () => {
    const t = tasks.find(x => !x.isSummary && !x.milestone);
    raid = [{ id: 900, type: 'Assumption', title: 'Client provides a data steward 2 days/week',
      probability: 3, impact: 4, owner: 'PM', status: 'Open', mitigation: '', outcome: '', outcomeNote: '',
      links: [{ k: 'act', id: t.id, was: t.name }], taskId: t.id, v: 2 }];
    const cause = raidCauseChipFor(t.id), watch = raidWatchChipFor(t.id);
    const slot = cause || ptrRaidBtn(t.id, t.name, '+$7,800');
    return { noCauseChip: cause === '', hasWatchChip: watch !== '',
             watchIsNotRed: !/class="raid-chip"/.test(watch),
             // the whole defect: the offer to record the real cause is BACK
             stillOffersRaid: /ptr-log-btn/.test(slot),
             asksTheQuestion: /Did it happen\?/.test(watch),
             saysNotBlamed: /not blamed for it/.test(watch) };
  });

  // ── ONCE IT BREAKS, IT IS A CAUSE, AND IT SAYS SO ──────────────────────
  R.brokenIsCause = await page.evaluate(() => {
    raid[0].outcome = 'broken'; raid[0].outcomeNote = 'The steward was never named.';
    const t = tasks.find(x => x.id === raid[0].taskId);
    const cause = raidCauseChipFor(t.id), watch = raidWatchChipFor(t.id);
    return { hasCauseChip: cause !== '', watchNowEmpty: watch === '',
             wording: (cause.match(/>([^<]*)<\/button>/) || [])[1] || cause.slice(-40),
             saysBroke: /Assumption broke/.test(cause),
             carriesTheNote: /steward was never named/.test(cause),
             // clicking it opens THE ENTRY, not just the tab
             opensEntry: /openRaidForm\(900\)/.test(cause) };
  });

  // ── A RISK ONLY EXPLAINS ONCE IT MATERIALISED ──────────────────────────
  R.riskOutcomes = await page.evaluate(() => {
    const t = tasks.find(x => x.id === raid[0].taskId);
    raid[0].type = 'Risk';
    const out = {};
    ['', 'pending', 'avoided', 'materialised'].forEach(o => {
      raid[0].outcome = o;
      out[o || 'blank'] = { cause: raidCauseChipFor(t.id) !== '', watch: raidWatchChipFor(t.id) !== '' };
    });
    raid[0].outcome = 'materialised';
    return Object.assign(out, { hitWording: /Risk hit/.test(raidCauseChipFor(t.id)) });
  });

  // ── A CLOSED ISSUE IS STILL THE RECORDED CAUSE ─────────────────────────
  R.closedStillExplains = await page.evaluate(() => {
    const t = tasks.find(x => x.id === raid[0].taskId);
    raid[0].type = 'Issue'; raid[0].outcome = ''; raid[0].status = 'Open';
    const open = raidCauseChipFor(t.id);
    raid[0].status = 'Closed';
    const closed = raidCauseChipFor(t.id);
    return { whileOpen: open !== '', onceClosed: closed !== '',
             saysSo: /still the recorded cause/.test(closed),
             // and a closed one is no longer a LIVE problem on the activity
             notFlaggedLive: !activityFlags(t).some(f => f.code === 'open-issue') };
  });

  // ── AN EXCLUSION NEVER EXPLAINS ANYTHING ───────────────────────────────
  R.exclusion = await page.evaluate(() => {
    const t = tasks.find(x => x.id === raid[0].taskId);
    raid[0].type = 'Exclusion'; raid[0].status = 'Open';
    return { cause: raidCauseChipFor(t.id) === '', watch: raidWatchChipFor(t.id) === '',
             hasNoOutcome: raidOutcomeOpts('Exclusion') === null };
  });

  // ── THE PLAN-TRUTH DRILL-IN CARRIES BOTH, NEVER ONE INSTEAD OF THE OTHER ──
  R.drillIn = await page.evaluate(() => {
    loadSample(); calculate(); setBaseline();
    const t = tasks.find(x => !x.isSummary && !x.milestone && (x.te || 0) > 0);
    t.percentComplete = 100; t.actualCost = (taskCost(t) || 1000) * 2;
    raid = [{ id: 901, type: 'Assumption', title: 'Steward available 2 days/week', probability: 3, impact: 4,
      owner: 'PM', status: 'Open', mitigation: '', outcome: '', outcomeNote: '',
      links: [{ k: 'act', id: t.id, was: t.name }], taskId: t.id, v: 2 }];
    calculate();
    const d = planTruthData().rows.map(r => (r.drivers || []).find(x => x.id === t.id)).find(Boolean);
    return { found: !!d, causeEmpty: d ? d.raid === '' : null, hasWatch: d ? d.watch !== '' : null,
             bothFieldsExist: d ? ('raid' in d && 'watch' in d) : null };
  });

  // ── FLAGS: a turned entry is a live problem; unanswered on finished work asks ──
  R.flags = await page.evaluate(() => {
    const t = tasks.find(x => x.id === raid[0].taskId);
    const unanswered = activityFlags(t).map(f => f.code);
    raid[0].outcome = 'broken';
    const turned = activityFlags(t).map(f => f.code);
    // before the work runs, "not yet answered" is the correct state and must be silent
    raid[0].outcome = ''; t.percentComplete = 0; t.finishDate = new Date(Date.now() + 90 * 864e5);
    const early = activityFlags(t).map(f => f.code);
    t.percentComplete = 100;
    return { onFinishedWork: unanswered.indexOf('raid-unanswered') >= 0,
             onceItTurned: turned.indexOf('raid-turned') >= 0,
             quietBeforeTheWorkRuns: early.indexOf('raid-unanswered') < 0,
             level: (raid[0].outcome = 'broken', activityFlagLevel(t)) };
  });

  // ── THE HEALTH CHECK NAMES BOTH GAPS ───────────────────────────────────
  R.lint = await page.evaluate(() => {
    const f = lintPlan().filter(x => x.area === 'RAID outcomes');
    return { n: f.length, sev: f.map(x => x.severity),
             turned: f.some(x => /turned and .* filed as something being watched/.test(x.finding)),
             offersRaise: f.some(x => /Raise the issue/.test(x.recommendation)) };
  });

  // ── THE FORM: the question exists only where it means something ────────
  R.form = await page.evaluate(() => {
    switchTab('raid'); renderRaid();
    openRaidForm(null);
    const row = document.getElementById('rOutcomeRow');
    const vis = () => row.style.display !== 'none';
    const opts = () => [...document.getElementById('rOutcome').options].map(o => o.value);
    const out = { riskShows: (document.getElementById('rType').value = 'Risk', raidOutcomeFormSync(), vis()),
                  riskOpts: opts() };
    document.getElementById('rOutcome').value = 'materialised';
    document.getElementById('rOutcome').dispatchEvent(new Event('change'));
    // the pick must SURVIVE the rebuild the change handler triggers
    out.pickSticks = document.getElementById('rOutcome').value === 'materialised';
    out.hintSaysCause = /now a <b>cause<\/b>/.test(document.getElementById('rOutcomeHint').innerHTML);
    document.getElementById('rOutcome').value = '';
    document.getElementById('rOutcome').dispatchEvent(new Event('change'));
    out.blankHintAsks = /never be offered as the reason|being <b>watched<\/b>/.test(document.getElementById('rOutcomeHint').innerHTML);
    document.getElementById('rOutcome').value = 'materialised';
    document.getElementById('rOutcome').dispatchEvent(new Event('change'));
    // switching type must not leave an outcome the new type has never heard of
    document.getElementById('rType').value = 'Assumption'; raidOutcomeFormSync();
    out.afterSwitch = document.getElementById('rOutcome').value;
    out.assumptionOpts = opts();
    document.getElementById('rType').value = 'Issue'; raidOutcomeFormSync();
    out.issueHides = !vis();
    return out;
  });

  // ── SAVE / RELOAD ROUND TRIP ───────────────────────────────────────────
  R.persist = await page.evaluate(() => {
    openRaidForm(null);
    document.getElementById('rType').value = 'Assumption'; raidOutcomeFormSync();
    document.getElementById('rTitle').value = 'Steward available';
    document.getElementById('rOutcome').value = 'broken';
    document.getElementById('rOutcomeNote').value = 'Never named.';
    saveRaidEntry();
    const saved = raid[raid.length - 1];
    const json = JSON.stringify(serialize());
    const inJson = /"outcome":"broken"/.test(json.replace(/\s/g, '')) && /Never named/.test(json);
    hydrate(JSON.parse(json));
    const back = raid.find(r => r.title === 'Steward available');
    // an OLD file, with no outcome field at all, must load as "not recorded"
    const old = JSON.parse(json);
    old.raid = old.raid.map(r => { const c = Object.assign({}, r); delete c.outcome; delete c.outcomeNote; return c; });
    hydrate(old);
    const legacy = raid.find(r => r.title === 'Steward available');
    return { saved: saved && { o: saved.outcome, n: saved.outcomeNote },
             inJson, backOutcome: back && back.outcome, backNote: back && back.outcomeNote,
             legacyOutcome: legacy && legacy.outcome,
             legacyIsUnanswered: !!legacy && raidUnanswered(legacy) };
  });

  // ── AN ISSUE NEVER CARRIES AN OUTCOME ──────────────────────────────────
  R.issueNoOutcome = await page.evaluate(() => {
    openRaidForm(null);
    document.getElementById('rType').value = 'Issue'; raidOutcomeFormSync();
    document.getElementById('rTitle').value = 'Sandbox arrived late';
    saveRaidEntry();
    const e = raid.find(r => r.title === 'Sandbox arrived late');
    return { outcome: e.outcome, note: e.outcomeNote, explainsAnyway: raidExplains(e) };
  });

  // ── RAISE THE ISSUE IT BECAME ──────────────────────────────────────────
  R.raise = await page.evaluate(() => {
    const src = raid.find(r => r.type === 'Assumption');
    const t = tasks.find(x => !x.isSummary && !x.milestone);
    src.outcome = 'broken'; src.outcomeNote = 'The steward was never named.';
    src.links = [{ k: 'act', id: t.id, was: t.name }];
    raidRaiseFrom(src.id);
    const kinds = raidDraftLinks.map(l => l.k);
    return { type: document.getElementById('rType').value,
             title: document.getElementById('rTitle').value,
             prob: document.getElementById('rProb').value,
             linksBack: kinds.indexOf('raid') >= 0,
             carriesActivities: kinds.indexOf('act') >= 0,
             desc: document.getElementById('rDesc').value.slice(0, 70),
             outcomeRowHidden: document.getElementById('rOutcomeRow').style.display === 'none' };
  });

  // ── A DECISION EXPLAINS THE WORK, NOT THIS NUMBER ──────────────────────
  R.decision = await page.evaluate(() => {
    const t = tasks.find(x => !x.isSummary && !x.milestone);
    raid = [{ id: 903, type: 'Decision', title: 'Single production org, no per-team sandboxes',
      probability: 3, impact: 3, owner: 'PM', status: 'Closed', mitigation: '', outcome: '', outcomeNote: '',
      links: [{ k: 'act', id: t.id, was: t.name }], taskId: t.id, v: 2 }];
    const cause = raidCauseChipFor(t.id);
    const group = raidChipsFor(t.id, () => ptrRaidBtn(t.id, t.name, '+$7,800'));
    return { getsAChip: cause !== '', notRed: /raid-chip-ctx/.test(cause),
             noWarningGlyph: !/⚠/.test(cause), diamond: /◆/.test(cause),
             notAFault: !raidHasFaultCause(t.id),
             // and it does NOT silence the account of why the number moved
             stillOffersRaid: /ptr-log-btn/.test(group) };
  });

  // ── A FAULT DOES SILENCE IT: the cause is already written down ──────────
  R.faultSilences = await page.evaluate(() => {
    const t = tasks.find(x => !x.isSummary && !x.milestone);
    raid[0].type = 'Issue';
    const group = raidChipsFor(t.id, () => ptrRaidBtn(t.id, t.name, '+$7,800'));
    return { isFault: raidHasFaultCause(t.id), red: /class="raid-chip"/.test(group),
             noOffer: !/ptr-log-btn/.test(group),
             // a risk only becomes a fault once it materialised
             riskPendingIsNotFault: (raid[0].type = 'Risk', raid[0].outcome = 'pending',
               !raidHasFaultCause(t.id)),
             riskHitIsFault: (raid[0].outcome = 'materialised', raidHasFaultCause(t.id)) };
  });

  // ── EVERY PREFILL PATH LEAVES THE FORM CONSISTENT WITH ITS TYPE ────────
  R.prefills = await page.evaluate(() => {
    const t = tasks.find(x => !x.isSummary && !x.milestone);
    const hidden = () => document.getElementById('rOutcomeRow').style.display === 'none';
    const out = {};
    raidLogFor(t.id, '+$7,800 on budget');
    out.fromVariance = { type: document.getElementById('rType').value, outcomeHidden: hidden() };
    closeRaidForm();
    // the AI capture path drafts whatever type the sentence implies
    raidCaptureApply({ type: 'Risk', title: 'Steward may not appear', probability: 4, impact: 4,
      description: 'x', mitigation: 'y', links: [] }, 'the steward may not appear');
    out.fromSentence = { type: document.getElementById('rType').value, outcomeShown: !hidden() };
    closeRaidForm();
    return out;
  });

  // ── THE CSV CARRIES THE OUTCOME ────────────────────────────────────────
  R.csv = await page.evaluate(() => {
    // a row of each shape, so the column is exercised rather than sampled
    const t = tasks.find(x => !x.isSummary && !x.milestone);
    raid = [
      { id: 910, type: 'Risk', title: 'a', probability: 3, impact: 3, owner: '', status: 'Open',
        mitigation: '', outcome: 'materialised', outcomeNote: 'it happened', links: [], taskId: null, v: 2 },
      { id: 911, type: 'Assumption', title: 'b', probability: 3, impact: 3, owner: '', status: 'Open',
        mitigation: '', outcome: '', outcomeNote: '', links: [{ k: 'act', id: t.id, was: t.name }], taskId: t.id, v: 2 },
      { id: 912, type: 'Issue', title: 'c', probability: 3, impact: 3, owner: '', status: 'Open',
        mitigation: '', outcome: '', outcomeNote: '', links: [], taskId: null, v: 2 }
    ];
    let cap = null;
    const real = window.download; window.download = (n, body) => { cap = body; };
    try { exportRaidCSV(); } finally { window.download = real; }
    const head = (cap || '').split('\n')[0];
    return { head, hasCols: /Did it happen/.test(head) && /What happened/.test(head),
             riskRowSaysItHappened: /It happened/.test(cap || ''),
             blankRowSaysNotRecorded: /Not recorded/.test(cap || ''),
             issueRowSaysNotApplicable: /n\/a/.test(cap || '') };
  });

  // ── THE TABLE ROW, AND THE CSV ─────────────────────────────────────────
  R.table = await page.evaluate(() => {
    closeRaidForm(); renderRaid();
    const head = [...document.querySelectorAll('#raidContainer thead th')].map(x => x.textContent.trim());
    const rows = [...document.querySelectorAll('#raidContainer tbody tr')];
    const cells = rows.map(r => r.children.length);
    return { head, cols: head.length, everyRowMatches: cells.every(n => n === head.length),
             hasOutcomeSelect: !!document.querySelector('#raidContainer select[onchange^="setRaidOutcome"]'),
             offersRaise: !!document.querySelector('#raidContainer button[onclick^="raidRaiseFrom"]'),
             // the Issue row shows an em dash, not an empty control
             dashForIssue: [...document.querySelectorAll('#raidContainer tbody tr')]
               .some(tr => /Issue/.test(tr.children[0].textContent) && /^—$/.test(tr.children[7].textContent.trim())) };
  });

  // ── SETTING THE OUTCOME FROM THE TABLE STICKS ──────────────────────────
  R.setFromTable = await page.evaluate(() => {
    const r = raid.find(x => !!raidOutcomeOpts(x.type));
    setRaidOutcome(r.id, r.type === 'Assumption' ? 'holding' : 'pending');
    const after = raid.find(x => x.id === r.id).outcome;
    setRaidOutcome(r.id, '');
    return { set: after === 'holding' || after === 'pending', cleared: raid.find(x => x.id === r.id).outcome === '',
             clearedIsUnanswered: raidUnanswered(raid.find(x => x.id === r.id)) };
  });

  for (const w of [375, 768, 1440]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.evaluate(() => { switchTab('raid'); renderRaid(); });
    await page.waitForTimeout(140);
    R['w'+w] = await page.evaluate(() => {
      const doc = document.documentElement, c = document.getElementById('raidContainer');
      return { overflow: doc.scrollWidth - doc.clientWidth,
               tableScrollsInsideItsWrap: !!c.querySelector('.table-wrap') };
    });
  }

  R.pageErrors = errs.slice(0,8);
  console.log(JSON.stringify(R,null,2));
  await b.close();
})();
