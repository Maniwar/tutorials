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

  /* ═══ 1c. A SECTION BEHIND A SUB-TAB IS STILL A PLACE YOU CAN GET TO ═════
     The team tab was eleven panels in one scroll and is now four sections
     behind a sub-tab bar. That trades one problem for two new ones, and both
     are silent:

       · a section can exist in the code with no button that reaches it, which
         is strictly worse than the crowded scroll it replaced — at least
         everything was on screen;
       · two buttons can paint the same thing, because a key that misses the
         panel map falls through to a default and the tab still looks alive.

     So the bar is required to name every declared section, every section is
     required to paint something, and no two are allowed to paint the same
     thing. The last one is what catches a wiring mistake: a panel builder
     pointed at the wrong key looks completely normal until you compare two.

     And the links INTO the tab are checked, because a sub-tab turns a
     destination into a two-part address and every caller was written when
     there was only one part. "Set day rates" landing wherever you happened to
     be last is a button that no longer does what it says. */
  await page.goto(APP, {waitUntil:'load'});
  await page.evaluate(d => { hydrate(d); calculate(); }, FIXTURE());
  await page.waitForTimeout(700);
  const sub = await page.evaluate(() => {
    const bad = [], out = {};
    const say2 = x => bad.push('Team sections :: ' + x);
    if (typeof RES_TABS === 'undefined') { say2('there are no declared sections to check'); return { bad, out }; }
    switchTab('resources');
    const seen = {};
    RES_TABS.forEach(t => {
      setResTab(t.k);
      const c = document.getElementById('resourcesContainer');
      const txt = c ? (c.textContent || '').replace(/\s+/g, ' ').trim() : '';
      seen[t.k] = txt;
      const btn = [...document.querySelectorAll('#resTabBar .stab')]
        .find(b => (b.textContent || '').indexOf(t.lbl) === 0);
      if (!btn) say2('"' + t.lbl + '" is a section with no button that reaches it');
      else if (btn.getAttribute('aria-selected') !== 'true')
        say2('selecting "' + t.lbl + '" left a different button marked as the current one');
      if (txt.length < 40)
        say2('"' + t.lbl + '" paints ' + txt.length + ' characters — the section is a dead end');
      /* Leveling acts on the workload and belongs nowhere else. Read off the
         COMPUTED STYLE, not off the `hidden` attribute. The first version read
         the attribute, agreed with the code, and passed on a build where the
         buttons were visible on all four sections: `hidden` only sets
         display:none from the user-agent sheet and .toolbar carries an author
         display:flex, which wins. An element's own property said hidden while
         the page showed it — asserting the flag instead of the visibility is
         the same mistake as asserting a row exists instead of what it says. */
      const tools = document.getElementById('resLevelTools');
      const lvlShown = !!tools && getComputedStyle(tools).display !== 'none' && !!tools.offsetParent;
      if (tools && lvlShown !== (t.k === 'workload'))
        say2('the leveling buttons are ' + (lvlShown ? 'VISIBLE on' : 'not visible on') + ' "' + t.lbl
          + '" — they act on the workload and belong with it');
    });
    const keys = Object.keys(seen);
    for (let i = 0; i < keys.length; i++)
      for (let j = i + 1; j < keys.length; j++)
        if (seen[keys[i]] && seen[keys[i]] === seen[keys[j]])
          say2('"' + keys[i] + '" and "' + keys[j] + '" paint exactly the same thing, so one of them is '
            + 'wired to the wrong panel and the bar is showing a section that does not exist');
    out.sections = keys.length;
    out.sizes = keys.map(k => k + ':' + seen[k].length);

    /* The two deep links that exist, checked against what their LABEL promises
       rather than against the key they happen to pass. */
    setResTab('worklist');
    const rateBtn = (() => { switchTab('analytics'); renderAnalytics();
      return [...document.querySelectorAll('#view-analytics button')]
        .find(b => /set day rates/i.test(b.textContent || '')); })();
    if (rateBtn) { rateBtn.click(); out.rateLanding = resTab;
      if (resTab !== 'team') say2('"Set day rates" opened the "' + resTab + '" section, and the rates are '
        + 'on Team — the button no longer does what it says'); }
    else out.rateLanding = 'SKIPPED-no-such-button-on-this-plan';
    /* Found by what it DOES — it is a card that navigates into this tab — not
       by the word "over" appearing in its text. The first version matched on
       the word and picked up a different card whose onclick goes somewhere
       else, then reported the product for not navigating. A link is identified
       by its target, and the target is in the attribute. */
    setResTab('worklist');
    const intoTeam = [...document.querySelectorAll('#view-analytics [onclick]')]
      .filter(c => /resGoto|switchTab\('resources'\)/.test(c.getAttribute('onclick') || ''));
    out.linksIntoTeam = intoTeam.length;
    const overCard = intoTeam.find(c => /capacity|allocat|over/i.test(c.textContent || ''));
    if (overCard) { overCard.click(); out.overLanding = resTab;
      if (resTab !== 'workload') say2('the card that opens this tab from the analytics summary landed on "'
        + resTab + '" rather than the workload it is about — its onclick is: '
        + (overCard.getAttribute('onclick') || '')); }
    else out.overLanding = 'SKIPPED-nothing-on-analytics-links-into-this-tab';
    return { bad, out };
  });
  sub.bad.forEach(x => bad.push(x));
  note.teamSections = sub.out;

  /* ═══ 1b. A READING YOU CAN REACH ═══════════════════════════════════════
     The spend curve's readout names the activities behind the day you point at,
     each as a button that opens it. The buttons sit BELOW the chart, so moving
     the pointer down towards them left the svg, mouseleave fired, and the
     readout reset to its idle text before the pointer arrived — the thing you
     were reaching for vanished as you reached for it. "I can never actually
     click on the things that pop up under it because it disappears right away."

     Not testable from inside the page: it is a property of pointer travel, so
     the mouse is actually moved. Two gestures, because the fix has two halves —
     the obvious one (walk down into the readout) must keep working, and the
     deliberate one (click to hold) must survive leaving the chart entirely. */
  await page.evaluate(() => { switchTab('analytics'); renderAnalytics(); });
  await page.waitForTimeout(500);
  const curve = await page.evaluate(() => {
    const r = document.getElementById('ptrScRead'); if (!r) return null;
    const sv = r.parentElement.querySelector('svg'); if (!sv) return null;
    const bb = sv.getBoundingClientRect();
    return { x: bb.x, y: bb.y + window.scrollY, width: bb.width, height: bb.height };
  });
  if (!curve) { note.curveReadout = 'SKIPPED-no-spend-curve'; }
  else {
    await page.evaluate(y => window.scrollTo(0, Math.max(0, y - 200)), curve.y);
    const sy = await page.evaluate(() => window.scrollY);
    const cx = curve.x + curve.width * 0.45, cy = curve.y - sy + curve.height * 0.5;
    const btns = () => page.evaluate(() =>
      document.getElementById('ptrScRead').querySelectorAll('button').length);
    await page.mouse.move(cx, cy); await page.waitForTimeout(200);
    const onChart = await btns();
    note.curveButtonsOnHover = onChart;
    if (!onChart)
      say('Spend curve', 'hovering the chart names no activities at all, so nothing below is tested');
    else {
      // walk down into the readout, the way somebody reaching for a button does
      await page.mouse.move(cx, curve.y - sy + curve.height + 40, { steps: 12 });
      await page.waitForTimeout(250);
      const reached = await btns();
      note.curveButtonsAfterReaching = reached;
      if (!reached)
        say('Spend curve', 'the reading is gone by the time the pointer reaches the buttons it drew — '
          + 'they cannot be clicked at all, which is the whole point of naming them');
      // and a held reading must survive leaving the chart entirely
      await page.mouse.move(cx, cy); await page.waitForTimeout(120);
      await page.mouse.click(cx, cy); await page.waitForTimeout(150);
      await page.mouse.move(cx, curve.y - sy + curve.height + 300, { steps: 10 });
      await page.waitForTimeout(700);
      const held = await page.evaluate(() => ({
        n: document.getElementById('ptrScRead').querySelectorAll('button').length,
        pinned: document.getElementById('ptrScRead').classList.contains('ptr-sc-pin') }));
      note.curveHeldAfterLeaving = held;
      if (!held.n)
        say('Spend curve', 'clicking the chart does not hold the reading — it still clears the moment '
          + 'the pointer leaves, so reaching the buttons is a race');
      if (!held.pinned)
        say('Spend curve', 'a held reading looks identical to a live one, so a chart that has stopped '
          + 'tracking reads as broken');
      await page.keyboard.press('Escape');
    }
  }

  /* ═══ 1d. "+3 MORE" IS NOT AN ANSWER ═════════════════════════════════════
     The same defect section 4 exists for, in a different panel: the spend
     curve's readout names its top three activities and then said "+3 more,
     $2,950" — a figure with nothing behind it, in a panel whose entire promise
     is that every number gets you to the activity causing it. Reported by use:
     "i noticed this says and 3 more but no way to see them?"

     Driven through ptrScPaint rather than the mouse because this is about the
     CONTENT of the readout, not about pointer travel — 1b above already owns
     the travel. Four properties, and the last two are the ones a lazy fix
     fails: expanding must actually draw the missing rows, collapsing must put
     them back, and moving to a different day must NOT carry the expansion with
     it, because a list expanded for one date is not an answer about another. */
  const more = await page.evaluate(() => {
    const st = (typeof ptrScState !== 'undefined') ? ptrScState : null;
    if (!st) return { skip: 'no spend-curve state' };
    const el = document.getElementById('ptrScRead');
    if (!el) return { skip: 'no readout' };
    const at = ms => { st.lastMs = null; ptrScPaint(ms); };
    const nBtn = () => el.querySelectorAll('.ptr-sc-rbtn').length;
    const moreEl = () => el.querySelector('.ptr-sc-rmore');
    // find a day whose reading actually holds back rows; without one there is
    // nothing to test and the check says so rather than passing quietly
    let day = null, txt = '';
    for (let ms = st.x0; ms <= st.x0 + st.spanDays * 86400000; ms += 86400000) {
      at(ms);
      if (moreEl()) { day = ms; txt = moreEl().textContent; break; }
    }
    if (day == null) return { skip: 'no date on this plan holds any driver back' };
    const o = { day: new Date(day).toISOString().slice(0, 10), label: txt.replace(/\s+/g, ' ') };
    o.capped = nBtn();
    moreEl().click();
    o.expanded = nBtn();
    const fewer = moreEl();
    o.offersCollapse = !!(fewer && /fewer/i.test(fewer.textContent));
    if (fewer) fewer.click();
    o.collapsedAgain = nBtn();
    // expand, then walk to the next day: the expansion must not follow
    at(day); moreEl().click();
    o.expandedAgain = nBtn();
    at(day + 86400000);
    o.nextDay = nBtn();
    at(day);
    o.backToThatDay = nBtn();
    return o;
  });
  note.curveMore = more;
  if (more.skip) note.curveMore = 'SKIPPED-' + more.skip;
  else {
    if (!/show/i.test(more.label))
      say('Spend curve', 'the readout says "' + more.label + '" and offers no way to see those rows — '
        + 'a total with no activities behind it, in the one panel whose job is naming the cause');
    if (more.expanded <= more.capped)
      say('Spend curve', 'clicking the "+n more" control drew no additional activities ('
        + more.capped + ' → ' + more.expanded + ') — it is decorative');
    if (!more.offersCollapse)
      say('Spend curve', 'the expanded list offers no way back to the short one, so opening it is '
        + 'a one-way trip on a readout that is meant to be scanned');
    if (more.collapsedAgain !== more.capped)
      say('Spend curve', 'collapsing did not restore the short list (' + more.capped + ' → '
        + more.collapsedAgain + ')');
    if (more.nextDay !== more.capped)
      say('Spend curve', 'the expansion followed the crosshair to the next day (' + more.nextDay
        + ' rows drawn where the default is ' + more.capped + ') — a list expanded for '
        + more.day + ' is being presented as the answer for a different date');
    if (more.backToThatDay !== more.capped)
      say('Spend curve', 'returning to ' + more.day + ' did not come back collapsed, so the readout '
        + 'remembers an expansion the reader has moved away from');
  }

  /* ═══ 1e. THIRTY-THREE ACTIVITIES OPEN ONE TWISTY AT A TIME ═══════════════
     The Gantt and the WBS both offer collapse-to-a-level; the activity list,
     which is where the plan is actually edited and the longest of the three,
     offered only per-row twisties. At the size a real engagement reaches by
     week two that is not a control, it is a chore. Reported by use: "also
     noticed there is no way to expand or collapse all".

     Asserted on the drawn ROW COUNT, not on the buttons existing: three
     buttons wired to nothing would pass an existence test, and this file has
     been caught by exactly that before. */
  const coll = await page.evaluate(() => {
    switchTab('tasks');
    const seg = document.getElementById('taskCollapseSeg');
    if (!seg) return { missing: true };
    const rows = () => document.querySelectorAll('#taskTable tbody tr').length;
    const labels = [...seg.querySelectorAll('button')].map(b => b.textContent.trim());
    const before = rows();
    seg.querySelectorAll('button').forEach(b => { /* keep them addressable */ });
    const byText = t => [...seg.querySelectorAll('button')].find(b => new RegExp(t, 'i').test(b.textContent));
    const all = byText('expand'); if (all) all.click();
    const expanded = rows();
    const ph = byText('phase'); if (ph) ph.click();
    const phases = rows();
    if (all) all.click();
    const reExpanded = rows();
    const summaries = tasks.filter(t => tasks.some(x => x.parentId === t.id)).length;
    return { labels: labels, before: before, expanded: expanded, phases: phases,
             reExpanded: reExpanded, summaries: summaries, total: tasks.length };
  });
  note.collapseAll = coll;
  if (coll.missing)
    say('Activity list', 'there is no collapse-to-a-level control at all — a thirty-activity plan can '
      + 'only be opened and shut one phase at a time, while the Gantt and the WBS both offer one');
  else {
    if (!coll.summaries) note.collapseAll = 'SKIPPED-flat-plan';
    else {
      if (coll.expanded <= coll.phases)
        say('Activity list', 'collapsing to phases drew ' + coll.phases + ' rows against ' + coll.expanded
          + ' expanded — the control changes nothing on a plan with ' + coll.summaries + ' summaries');
      if (coll.reExpanded !== coll.expanded)
        say('Activity list', 'expand-all after a collapse drew ' + coll.reExpanded + ' rows, not the '
          + coll.expanded + ' it drew before — the two directions do not agree');
      if (coll.phases >= coll.total)
        say('Activity list', '"phases" left every one of the ' + coll.total + ' activities drawn, so it '
          + 'is collapsing nothing');
    }
  }

  /* ═══ 1f. FIVE KINDS, FIVE PILLS, ONE COLOUR ═════════════════════════════
     A RAID log's whole value is that a risk, an issue, an assumption, a
     decision and an exclusion are five DIFFERENT statements — and every one of
     them was drawn as the same grey pill, with the definitions parked in a
     column-header tooltip no client will find. Reported by use: "i also noticed
     these pills don't look good and aren't informative enough".

     The property is that the kinds are told apart and each says what it means.
     Deliberately not "Risk is amber": naming the colour would fail a redesign
     and pass a build where all five went amber together. */
  const kinds = await page.evaluate(() => {
    switchTab('raid'); renderRaid();
    const chips = [...document.querySelectorAll('#raidContainer .raid-kind')];
    if (!chips.length) return { missing: true };
    const seen = {};
    chips.forEach(c => {
      const w = c.textContent.trim();
      if (!seen[w]) seen[w] = { cls: c.className, tip: (c.title || '').length,
        sub: ((c.parentElement || {}).querySelector ? (c.parentElement.querySelector('.raid-kind-sub') || {}).textContent : '') || '' };
    });
    return { seen: seen, n: chips.length,
             types: [...new Set((typeof raid !== 'undefined' ? raid : []).map(r => r.type))] };
  });
  note.raidKinds = kinds;
  if (kinds.missing) say('RAID', 'the type column draws no kind chip at all');
  else {
    const words = Object.keys(kinds.seen);
    const classes = new Set(words.map(w => kinds.seen[w].cls));
    if (words.length > 1 && classes.size < words.length)
      say('RAID', words.length + ' different kinds (' + words.join(', ') + ') share only '
        + classes.size + ' treatment(s) — a decision and an issue are the two things a client most '
        + 'often confuses, and the log draws them identically');
    words.forEach(w => {
      if (kinds.seen[w].tip < 40)
        say('RAID', 'the "' + w + '" chip carries no definition (' + kinds.seen[w].tip + ' chars of '
          + 'title) — the reader is expected to already know the RAID vocabulary');
      if (!kinds.seen[w].sub.trim())
        say('RAID', 'the "' + w + '" chip says the word and nothing else — no tense, so nothing on the '
          + 'row distinguishes something that might happen from something that already has');
    });
  }

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

    /* And it must be DRAWN, not merely computed. The worklist now lives behind
       a sub-tab, so reaching the tab is no longer the same as reaching the
       panel — every check below reads what is painted, and painting is what
       selecting the section does. Selected explicitly rather than relying on
       whichever section happened to be remembered from the last run, which is
       a stored preference and therefore not a fact this file controls. */
    switchTab('resources');
    if (typeof setResTab === 'function') setResTab('worklist'); else renderResources();
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

    /* THE TOTAL IS OF THE GROUP, NOT OF THE ROWS DRAWN. The reason to put effort
       on the rows is to add them up, and a capped table whose footer sums five
       of eleven is a number nobody can use and nobody can tell is partial. Tested
       against the person whose group is actually over the cap, because on anyone
       else the two sums coincide and the check proves nothing. */
    const capped2 = data.slice().sort((a, b) => b.blocked.length - a.blocked.length)[0];
    out.footerCase = (capped2 && capped2.blocked.length > 5) ? capped2.name : 'SKIPPED-no-capped-group';
    if (capped2 && capped2.blocked.length > 5) {
      const card = [...document.querySelectorAll('#worklistHost .wl-p')]
        .find(c => (c.querySelector('.wl-nmb') || {}).textContent === capped2.name);
      const foot = card ? card.querySelector('.wl-t tfoot') : null;
      out.footerDrawn = !!foot;
      if (!foot) say2('the effort column has no total at all — the point of putting a size on every row '
        + 'is that they add up to a week');
      else {
        const want = capped2.blocked.reduce((a, r) => a + (r.estDays || 0), 0);
        const txt = foot.textContent.replace(/\s+/g, ' ');
        const wantTxt = fmtDurCell(workingDaysToUnit(want));
        out.footerSays = txt.slice(0, 60); out.footerWant = wantTxt;
        if (txt.indexOf(wantTxt) < 0)
          say2('the total under ' + capped2.name + '\'s blocked table does not state ' + wantTxt
            + ', the effort of all ' + capped2.blocked.length + ' of them — a footer that sums only the '
            + 'rows on screen is a partial number presented as a total');
        if (txt.indexOf(String(capped2.blocked.length)) < 0)
          say2('the total does not say how many activities it covers, so a capped table cannot be told '
            + 'from a complete one');
      }
    }
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

  /* ═══ THE SOW PANEL HOLDS ONE DOCUMENT AND ONE HISTORY ══════════════════
     Two version histories of two different things used to sandwich the
     document — the plan's chain in an accordion above it, the document's own
     drafts in an accordion below — so a reader looking for "the last version"
     met two controls and neither said which history it held. They are
     genuinely different questions and stay separate, but as named tabs in one
     region under the document. */
  const H = await page.evaluate(async () => {
    const bad3 = [];
    const say3 = x => bad3.push('SOW panel :: ' + x);
    switchTab('raid');
    await generateSOW();
    renderSowHistory();
    const tS = document.getElementById('dhTabSow'), tP = document.getElementById('dhTabPlan');
    const body = document.getElementById('docHistBody');
    if (!tS || !tP || !body) { say3('the history region is gone'); return { contradictions: bad3, counts: {} }; }
    const out = {};
    out.tabs = [tS.textContent, tP.textContent];
    if (!/\(\d+\)/.test(tS.textContent))
      say3('the document tab carries no count, so an empty history is only discoverable by opening it');
    // the tabs show DIFFERENT histories
    setDocHistTab('sow');   const a = body.innerHTML;
    setDocHistTab('plan');  const b2 = body.innerHTML;
    out.differ = a !== b2;
    if (a === b2) say3('both tabs render the same thing — the document history and the plan chain are '
      + 'different questions and one of them is not being shown');
    if (!/Restore|restore/.test(a)) say3('the document history offers no restore');
    if (!/Version|version/.test(b2)) say3('the plan tab shows no version chain');
    // and the active tab is visibly the active one
    setDocHistTab('sow');
    out.activeClass = tS.className;
    if (tS.className === tP.className)
      say3('the selected tab looks identical to the unselected one');
    // nothing else in the panel opens a second version history
    const stray = [...document.querySelectorAll('#view-raid details summary')]
      .map(x => x.textContent).filter(x => /version/i.test(x));
    out.strayHistories = stray;
    if (stray.length) say3('a second version history still hides in an accordion: ' + stray.join(' / '));
    // the document is not read through a letterbox
    const c = document.getElementById('sowContainer');
    out.panelW = c.clientWidth;
    out.docW = c.firstElementChild ? c.firstElementChild.clientWidth : 0;
    if (out.docW && out.panelW && out.docW < out.panelW * 0.45)
      say3('the document is ' + out.docW + 'px inside a ' + out.panelW + 'px panel');
    out.seps = document.querySelectorAll('#view-raid .tb-sep').length;
    if (out.seps < 3) say3('the toolbar groups its controls with ' + out.seps + ' separators — nine buttons '
      + 'in one flat row read as nine unrelated decisions');
    return { contradictions: bad3, counts: out };
  });
  H.contradictions.forEach(x => bad.push(x));
  note.sowPanel = H.counts;

  /* ═══ THE RAID LOG SURVIVES A REAL ENGAGEMENT ═══════════════════════════
     One flat table of five different kinds of thing, no filter and one confirm
     dialog per deletion. Drafting exclusions twice put forty rows in front of
     somebody whose job was "delete the dozen that do not apply". */
  const RD = await page.evaluate(() => {
    const bad4 = [];
    const say4 = x => bad4.push('RAID log :: ' + x);
    const out = {};
    applyAIExclusions({ exclusions: [
      'ZZ no CRM data migration, cleansing, or database configuration work',
      'ZZ no data migration or cleansing work',
      'ZZ no changes to the mobile app',
      'ZZ no mobile app changes',
      'ZZ up to five coordinator sessions; further sessions are a change order' ] });
    switchTab('raid'); setRaidTab('all'); setRaidQuery(''); renderRaid();
    const cont = document.getElementById('raidContainer');
    const rowsNow = () => document.querySelectorAll('#raidContainer tbody tr').length;
    out.allRows = rowsNow();
    if (out.allRows !== raid.length) say4('the All tab shows ' + out.allRows + ' of ' + raid.length + ' entries');

    // a tab shows only its kind, and carries its count
    setRaidTab('Exclusion');
    out.exclRows = rowsNow();
    const want = raid.filter(r => r.type === 'Exclusion').length;
    if (out.exclRows !== want) say4('the Exclusion tab shows ' + out.exclRows + ' of ' + want);
    const tabTxt = [...cont.querySelectorAll('.toolbar button')].map(x => x.textContent).join(' ');
    if (tabTxt.indexOf(String(want)) < 0)
      say4('the tabs carry no counts, so an empty kind is only discoverable by clicking into it');

    // the text filter narrows
    setRaidQuery('mobile');
    out.filtered = rowsNow();
    if (!(out.filtered > 0 && out.filtered < want))
      say4('filtering on "mobile" left ' + out.filtered + ' of ' + want + ' rows — the filter does not filter');
    setRaidQuery('');

    // near-duplicates are FOUND, not just byte-identical ones
    out.simSame = raidSimilarity('No changes to the mobile app', 'No mobile app changes');
    out.simDiff = raidSimilarity('No changes to the mobile app', 'Up to five coordinator sessions');
    if (!(out.simSame >= 0.75)) say4('two phrasings of one boundary score ' + out.simSame.toFixed(2) + ' — not detected as duplicates');
    if (out.simDiff >= 0.5) say4('two unrelated exclusions score ' + out.simDiff.toFixed(2) + ' — the detector would merge distinct boundaries');
    out.dupGroups = raidDuplicateGroups('Exclusion').length;
    if (out.dupGroups < 2) say4('two near-duplicate pairs were filed and the detector found ' + out.dupGroups + ' group(s)');

    // bulk: select everything shown, set a field, delete the lot in one go
    setRaidTab('Exclusion');
    raidSelectAllVisible(true);
    out.selected = raidSel.size;
    if (out.selected !== raid.filter(r => r.type === 'Exclusion').length)
      say4('select-all selected ' + out.selected + ' of the shown rows');
    if (document.getElementById('raidBulk').style.display === 'none')
      say4('rows are selected and no bulk bar appeared');
    const who = Object.keys(resources || {})[0];
    if (who) {
      raidBulkSet('owner', who);
      const missed = raid.filter(r => r.type === 'Exclusion' && r.owner !== who).length;
      if (missed) say4('a bulk owner change missed ' + missed + ' selected entries');
    }
    const before = raid.length;
    raidSelectAllVisible(true);
    raidBulkDelete();
    out.bulkDeleted = before - raid.length;
    if (out.bulkDeleted < 2) say4('bulk delete removed ' + out.bulkDeleted + ' entries');
    if (raid.some(r => /^ZZ /.test(r.title))) say4('bulk delete left some of the selected entries behind');
    setRaidTab('all');
    return { contradictions: bad4, counts: out };
  });
  RD.contradictions.forEach(x => bad.push(x));
  note.raidLog = RD.counts;

  console.log(JSON.stringify({ contradictions: bad, note: note, pageErrors: errs.slice(0, 6) }, null, 1));
  await b.close();
  if (bad.length || errs.length) process.exitCode = 1;
})();
