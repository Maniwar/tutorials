/* ═══════════════════════════════════════════════════════════════════════════
   THE BACK BUTTON, AND THE PANEL YOU HAND TO A PERSON.

   Two surfaces that share a property: both are about somebody else acting on
   what they see, and both were losing the thing that makes that possible.

   NAVIGATION. Nine tabs and no history. Drilling from Analytics into an
   activity and on into Plan vs actual left Back meaning "leave the application",
   so a mis-click cost the session, the URL never said where you were, and a
   link to the Gantt could not be sent. Every tab is a fragment now, which is
   only useful if all four directions hold: forward navigation writes one, Back
   and Forward walk them, the entry with NO fragment is the first tab rather
   than a dead press, and a fragment present at load opens on that tab after the
   plan is computed rather than before.

   THE WORKLIST. It answers "what can this person start now", and it used to
   answer it with a truncated name and a date. On a plan carrying generated test
   cases every row read "TC AC-11.3 — edge: mo…", which identifies nothing; the
   state of the work was absent, and the open RAID entry raised against it — sat
   in the same file — was absent too. The copy that leaves the panel was a flat
   bullet list, so the follow-up conversation started from nothing.

   Asked here as properties rather than as a layout: a row names its activity
   fully enough to act on, states what is happening to it, names what it waits
   on WITH the owner of that, and carries any open RAID entry. The copied
   document has to hold the same facts, in both clipboard flavours.
   ═══════════════════════════════════════════════════════════════════════════ */
const { requirePlaywright, chromePath, APP, FIXTURE } = require('./_harness');
const { chromium } = requirePlaywright();

(async () => {
  const b = await chromium.launch({headless:true,args:['--no-sandbox'],executablePath: chromePath()});
  const page = await b.newPage({viewport:{width:1400,height:1100}});
  page.on('dialog', d => d.accept());
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(APP, {waitUntil:'load'});
  await page.evaluate(d => { hydrate(d); calculate(); }, FIXTURE());
  await page.waitForTimeout(600);

  const bad = [];
  const say = (w, x) => bad.push(w + ' :: ' + x);
  const note = {};
  const active = () => page.evaluate(() => {
    const el = document.querySelector('.tab.active'); return el ? el.dataset.tab : null; });
  const hash = () => page.evaluate(() => location.hash);

  // ═══ 1. TABS ARE ADDRESSES ═══════════════════════════════════════════════
  await page.click('.tab[data-tab="gantt"]'); await page.waitForTimeout(250);
  note.hashAfterGantt = await hash();
  if (note.hashAfterGantt !== '#gantt')
    say('Navigation', 'clicking the Gantt tab left the address bar at "' + note.hashAfterGantt
      + '" — the tab is not a location, so Back cannot return to it and the view cannot be linked');

  await page.click('.tab[data-tab="raid"]'); await page.waitForTimeout(250);
  await page.goBack(); await page.waitForTimeout(350);
  note.tabAfterBack = await active();
  if (note.tabAfterBack !== 'gantt')
    say('Navigation', 'Back from RAID landed on "' + note.tabAfterBack + '" instead of the Gantt it '
      + 'came from — history is being written but not read');

  /* the entry the app loaded on carries no fragment. Back onto it has to mean
     the first tab; leaving the last tab showing is a press that visibly does
     nothing, which reads as a broken button rather than as the end of history. */
  await page.goBack(); await page.waitForTimeout(350);
  note.tabAtHistoryStart = await active(); note.hashAtHistoryStart = await hash();
  if (note.hashAtHistoryStart === '' && note.tabAtHistoryStart !== 'tasks')
    say('Navigation', 'Back to the entry with no fragment left "' + note.tabAtHistoryStart
      + '" on screen — the address says one thing and the page shows another, and the press looks dead');

  await page.goForward(); await page.waitForTimeout(350);
  note.tabAfterForward = await active();
  if (note.tabAfterForward !== 'gantt')
    say('Navigation', 'Forward landed on "' + note.tabAfterForward + '" rather than returning to the Gantt');

  // a fragment present at LOAD must open that tab, with the plan already computed
  await page.goto(APP + '#pert', {waitUntil:'load'});
  await page.evaluate(d => { hydrate(d); calculate(); }, FIXTURE());
  await page.waitForTimeout(700);
  note.deepLinkTab = await active();
  if (note.deepLinkTab !== 'pert')
    say('Navigation', 'loading with #pert opened "' + note.deepLinkTab + '" — a bookmark or a pasted '
      + 'link to a view does not work');

  // every tab must round-trip, or one of them is quietly unaddressable
  const rt = await page.evaluate(async () => {
    const out = [];
    for (const n of [...document.querySelectorAll('.tab[data-tab]')].map(x => x.dataset.tab)) {
      switchTab(n);
      out.push({ tab: n, hash: location.hash.replace(/^#/, '') });
    }
    return out;
  });
  note.tabsChecked = rt.length;
  const mism = rt.filter(x => x.hash !== x.tab);
  if (mism.length)
    say('Navigation', mism.length + ' tab(s) do not write their own name into the address: '
      + mism.map(x => x.tab + '→"' + x.hash + '"').join(', '));

  // ═══ 2. THE WORKLIST SAYS ENOUGH TO ACT ON ═══════════════════════════════
  const W = await page.evaluate(() => {
    const bad2 = [], out = {};
    const say2 = x => bad2.push('Worklist :: ' + x);

    /* Construct the RAID case. No committed fixture happens to carry an open
       entry against an UNFINISHED leaf — the sample's two open entries sit on a
       completed activity and on a summary — so a check that merely looked would
       pass on a build that never reads RAID at all. */
    const victim = leafTasks().find(t => !t.isSummary && !t.milestone
      && (t.percentComplete || 0) < 100 && taskParticipants(t).length);
    if (!victim) { say2('the fixture has no unfinished, owned activity, so nothing below ran'); return { contradictions: bad2, counts: out }; }
    raid.push({ id: 9901, type: 'Risk', title: 'Sandbox refresh may wipe the loaded UAT data',
      probability: 4, impact: 4, owner: 'PMO', status: 'Mitigating', links: [{ k: 'act', id: victim.id }] });
    const who = taskParticipants(victim)[0].name;

    const data = worklistData();
    const p = data.find(x => x.name === who);
    out.people = data.length;
    if (!p) { say2('the activity\'s owner does not appear in the worklist at all'); return { contradictions: bad2, counts: out }; }

    const row = p.now.concat(p.blocked, p.soon).find(r => r.id === victim.id);
    if (!row) { say2('the owner\'s worklist does not contain their own unfinished activity'); return { contradictions: bad2, counts: out }; }
    out.riskRowsFound = (row.raid || []).length;
    if (!(row.raid || []).length)
      say2('an open RAID entry is linked to this activity and the worklist row does not carry it — the '
        + 'person is told to pick up work with a live risk on it and never told about the risk');
    if (!row.state)
      say2('a row states no status at all, so a due date is the only thing said about the work');

    // and it must be DRAWN, not merely computed
    switchTab('resources'); renderResources();
    const host = document.getElementById('resourcesContainer');
    const html = host ? host.innerHTML : '';
    out.drawnRiskMarks = (html.match(/wl-risk-i/g) || []).length;
    if (!out.drawnRiskMarks)
      say2('the row carries a RAID entry and the panel draws no sign of it');
    const txt = host ? host.textContent.replace(/\s+/g, ' ') : '';
    if (txt.indexOf('Sandbox refresh may wipe the loaded UAT data') < 0)
      say2('the linked risk is not readable anywhere on the drawn panel');

    /* Names have to be usable. A truncated name is not an identifier: on a plan
       of generated test cases every row collapses to the same prefix. */
    const shownNames = [...(host ? host.querySelectorAll('.wl-td:first-child .ek-nm') : [])]
      .map(e => e.textContent.trim());
    out.namesDrawn = shownNames.length;
    const cut = shownNames.filter(s => /…$/.test(s));
    out.namesTruncated = cut.length;
    if (shownNames.length && cut.length / shownNames.length > 0.25)
      say2(cut.length + ' of ' + shownNames.length + ' activity names are truncated (e.g. "'
        + (cut[0] || '').slice(0, 40) + '") — on a plan of generated test cases a clipped name identifies '
        + 'nothing and two rows cannot be told apart');
    /* Indistinguishable rows are the sharper form of the same fault — but only
       WITHIN one table. Across the panel a shared activity legitimately appears
       on several people's cards, and the first version of this check called
       three such rows a defect. Two rows in the same list reading the same is
       the real problem, and truncation is what causes it. */
    let dupe = 0;
    [...(host ? host.querySelectorAll('.wl-t tbody') : [])].forEach(tb => {
      const ns = [...tb.querySelectorAll('.wl-td:first-child .ek-nm')].map(e => e.textContent.trim());
      dupe += ns.length - new Set(ns).size;
    });
    out.namesIndistinguishable = dupe;
    if (dupe > 0)
      say2(dupe + ' row(s) in one person\'s list show a name identical to another row in the SAME list — '
        + 'they cannot be told apart, which is what truncating a name to its shared prefix does');

    // the chokepoint has to be named when nothing can start
    const totNow = data.reduce((s, x) => s + x.now.length, 0);
    const totBlk = data.reduce((s, x) => s + x.blocked.length, 0);
    out.canStartNow = totNow; out.blocked = totBlk;
    if (!totNow && totBlk) {
      const choke = wlChokepoint(data);
      out.chokepoint = choke ? choke.name + ' ×' + choke.n : null;
      if (!choke) say2('nothing can be started and no activity is identified as the thing being waited on');
      else if (txt.indexOf(choke.name.slice(0, 24)) < 0)
        say2('every person is waiting and the panel never names what they are waiting on ('
          + choke.name + ', with ' + choke.n + ' activities behind it)');
    }

    // ═══ 3. WHAT IS COPIED CARRIES THE SAME FACTS ═════════════════════════
    const html2 = wlHtmlDoc([who]), text2 = wlText([who]);
    out.copyHtmlLen = html2.length; out.copyTextLen = text2.length;
    const both = [['rich text', html2], ['plain text', text2]];
    both.forEach(([lbl, doc]) => {
      if (!doc) { say2('the ' + lbl + ' copy is empty'); return; }
      if (doc.indexOf('Sandbox refresh may wipe the loaded UAT data') < 0)
        say2('the ' + lbl + ' copy omits the open RAID entry against an activity it is asking somebody '
          + 'to pick up — the one fact that changes what they do first');
      if (doc.indexOf(who) < 0)
        say2('the ' + lbl + ' copy never names the person it is about');
      if (doc.indexOf(row.state) < 0)
        say2('the ' + lbl + ' copy states no status for the work — the reader cannot tell a started '
          + 'activity from one nobody has touched');
    });
    if (html2.indexOf('<table') < 0)
      say2('the rich-text copy is not a table, so it pastes into email as a run of lines');

    /* EFFORT IS ON THE ROW, and it is that PERSON'S share. A worklist that states
       a date and not a size asks somebody to plan their week from half the
       information — "pick these four up" says nothing about whether that is a
       morning or a fortnight. And the share matters: an activity two people
       split shows its whole effort on both their lists unless it is weighted,
       so anybody adding their own column up gets a number the plan disagrees with. */
    const anyEff = p.now.concat(p.blocked, p.soon, p.doneRows).filter(r => r.estDays > 0);
    out.rowsWithEffort = anyEff.length;
    if (!anyEff.length) say2('not one row carries an effort figure, so the panel says when work is due '
      + 'and never how big it is');
    const partTime = data.reduce((acc, q) => acc.concat(q.now, q.blocked, q.soon, q.doneRows), [])
      .find(r => r.units && r.units !== 100 && r.estDays > 0);
    out.partTimeRow = partTime ? partTime.units + '%' : 'SKIPPED-nobody-part-time';
    if (partTime) {
      const whole = unitToWorkingDays(partTime.te);
      if (Math.abs(partTime.estDays - whole) < 1e-6)
        say2('a row for somebody allocated at ' + partTime.units + '% shows the activity\'s WHOLE effort '
          + '(' + whole.toFixed(2) + ' days) as theirs — every shared activity is counted twice and the '
          + 'person\'s own total disagrees with the roster');
    }
    // drawn, and carried into the copy, or the two say different things
    if (!/EFFORT/i.test((host.querySelector('.wl-t thead') || {}).textContent || ''))
      say2('effort is computed on every row and the table has no column for it');
    /* BOTH flavours, separately. The first version accepted the figure in
       either one, so deleting the Effort column from the rich-text table passed
       on the strength of the plain-text copy still having it — and rich text is
       the flavour that actually lands when somebody pastes into email. */
    const effRow = anyEff.find(r => r.estDays > 0);
    if (effRow) {
      const want = wlEffText(effRow).split(' (')[0];
      [['rich text', html2], ['plain text', text2]].forEach(([lbl, doc]) => {
        if (doc.indexOf(want) < 0)
          say2('the ' + lbl + ' copy carries no effort figure ("' + want + '" is on screen and not in it) — '
            + 'the person being sent the list cannot size their own week from it');
      });
    }
    // a blocked row's copy must name the blocker AND its owner, or a chase has nowhere to go
    const blk = p.blocked[0];
    if (blk) {
      const bn = blk.blockers[0];
      if (text2.indexOf(bn.name.slice(0, 20)) < 0)
        say2('the copy says an activity is blocked and never names what it is blocked ON');
      const owner = (bn.owners || [])[0];
      if (owner && text2.indexOf(owner) < 0)
        say2('the copy names the blocking activity and not who owns it, so the reader knows they are '
          + 'stuck and not who to ask');
    }
    // copying EVERYONE is one action, not one per person
    const all = wlText(null);
    out.copyAllPeople = data.filter(x => all.indexOf(x.name.toUpperCase()) >= 0).length;
    if (out.copyAllPeople < data.length)
      say2('copying the whole worklist covers ' + out.copyAllPeople + ' of ' + data.length + ' people');

    /* ═══ 4. EVERY ROW IS REACHABLE ═══════════════════════════════════════
       The card is a summary and has to be — seven of them share a screen. What
       it may not be is a summary with no way out: three caps and one silent
       omission (finished work discarded at the data layer, not hidden at the
       view) meant "and 6 more" was the end of the road. Two escapes, both
       required: a filter that lifts the caps in place, and a per-person drill-in
       that is uncapped by construction. */
    const withDone = data.find(x => x.doneRows && x.doneRows.length);
    out.peopleWithFinishedWork = data.filter(x => (x.doneRows || []).length).length;
    if (!out.peopleWithFinishedWork)
      say2('not one person has a finished activity recorded against them, so the plan cannot show '
        + 'completed work at all — either the fixture has none or the rows are being thrown away');

    // the filter bar has to exist and to state the totals it governs
    const barTxt = (host.querySelector('.wl-bar') || {}).textContent || '';
    out.filterBar = barTxt.replace(/\s+/g, ' ').slice(0, 90);
    ['Can start', 'Blocked', 'Later', 'Finished', 'Show every row'].forEach(k => {
      if (barTxt.indexOf(k) < 0) say2('the filter bar offers no "' + k + '" control');
    });

    /* "Show every row" is tested ALONE, against the ONE person whose group is
       actually over the cap. The first version switched on the hidden groups at
       the same time and compared totals — which rises either way, so a build
       that ignores the cap entirely passed. The question is not "are there more
       rows now", it is "is the capped group finally complete". */
    const capped = data.slice().sort((a, b) => b.blocked.length - a.blocked.length)[0];
    out.largestBlockedGroup = capped ? capped.blocked.length : 0;
    if (!capped || capped.blocked.length <= 5) {
      out.capCase = 'SKIPPED-no-group-over-the-cap';
    } else {
      const drawnFor = who => {
        const cards = [...document.querySelectorAll('#worklistHost .wl-p')];
        const card = cards.find(c => (c.querySelector('.wl-nmb') || {}).textContent === who);
        return card ? card.querySelectorAll('.wl-t tbody tr').length : -1;
      };
      const beforeAll = drawnFor(capped.name);
      wlSetView('all', true);
      const afterAll = drawnFor(capped.name);
      wlSetView('all', false);
      out.cappedDrawnDefault = beforeAll; out.cappedDrawnShowAll = afterAll;
      if (afterAll < capped.blocked.length)
        say2('"Show every row" leaves ' + capped.name + ' at ' + afterAll + ' drawn rows with '
          + capped.blocked.length + ' blocked activities — the cap is not a view setting, so the rows it '
          + 'holds back cannot be reached from the panel at all');
      if (afterAll === beforeAll)
        say2('"Show every row" changed nothing for ' + capped.name + ', who has ' + capped.blocked.length
          + ' blocked activities against a cap of 5 — the control is decorative');
    }
    // and the hidden/finished groups have to be reachable too
    const rowsNow = () => document.querySelectorAll('#worklistHost .wl-t tbody tr').length;
    const beforeGrp = rowsNow();
    wlSetView('done', true); wlSetView('soon', true);
    out.rowsDefault = beforeGrp; out.rowsWithHiddenGroups = rowsNow();
    if (out.rowsWithHiddenGroups <= beforeGrp)
      say2('switching on Later and Finished drew no additional rows — those groups cannot be seen');
    // and a hidden group must still announce itself rather than vanish
    wlSetView('blocked', false);
    const offTxt = (document.getElementById('worklistHost') || {}).textContent || '';
    out.hiddenGroupAnnounced = /hidden by the filter/.test(offTxt);
    if (totBlk && !out.hiddenGroupAnnounced)
      say2('switching a group off removed it without trace — from the reader\'s side those activities '
        + 'have disappeared from the plan rather than been filtered');
    wlSetView('blocked', true); wlSetView('done', false); wlSetView('soon', false); wlSetView('all', false);

    /* The drill-in is checked against the person with the MOST work, and among
       ties one who also has finished activities. Picking the first person with
       any finished row gave a target whose every group sat under the cap, so a
       build that capped the drill-in to three rows passed — the view that exists
       BECAUSE the card caps was itself capped, invisibly. */
    const target = data.slice().sort((a, b) => {
      const n = p => p.now.length + p.blocked.length + p.soon.length + p.doneRows.length;
      return (n(b) - n(a)) || ((b.doneRows.length ? 1 : 0) - (a.doneRows.length ? 1 : 0));
    })[0] || withDone || data[0];
    wlOpenPerson(target.name);
    const modal = document.getElementById('wlModal');
    const mbody = document.getElementById('wlModalBody');
    out.drillOpen = !!(modal && modal.classList.contains('open'));
    if (!out.drillOpen) say2('clicking a person opened nothing — there is no way to see their whole list');
    else {
      const mrows = mbody.querySelectorAll('.wl-t tbody tr').length;
      const expect = target.now.length + target.blocked.length + target.soon.length + target.doneRows.length;
      out.drillRows = mrows; out.drillExpected = expect;
      if (mrows !== expect)
        say2('the drill-in for ' + target.name + ' draws ' + mrows + ' rows against ' + expect
          + ' activities they touch — the one view that is meant to be complete is not');
      const mtxt = mbody.textContent.replace(/\s+/g, ' ');
      if (target.doneRows.length && mtxt.indexOf('Finished') < 0)
        say2('the drill-in omits ' + target.doneRows.length + ' finished activit'
          + (target.doneRows.length === 1 ? 'y' : 'ies') + ' — it is a breakdown of the outstanding work, '
          + 'not of the work');
      if (mtxt.indexOf('and ' ) >= 0 && / more — open /.test(mtxt))
        say2('the drill-in caps its own list — it is the view that exists because the card caps its');
      // and it must be reachable by clicking the NAME, not only by a button
      const nameBtn = host.querySelector('.wl-nmb');
      out.nameIsClickable = !!nameBtn;
      if (!nameBtn) say2('the person\'s name is not clickable, so the drill-in is only reachable if you '
        + 'notice a separate button');
      closeWlModal();
    }

    raid.pop();
    return { contradictions: bad2, counts: out };
  });

  W.contradictions.forEach(x => bad.push(x));
  note.worklist = W.counts;

  console.log(JSON.stringify({ contradictions: bad, note: note, pageErrors: errs.slice(0, 6) }, null, 1));
  await b.close();
  if (bad.length || errs.length) process.exitCode = 1;
})();
