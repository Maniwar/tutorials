/* ═══════════════════════════════════════════════════════════════════════════
   A CORRUPT FILE MUST NOT TAKE THE APPLICATION DOWN.

   This exists because of one real plan. It looked completely normal, it loaded
   without a murmur, and every schedule surface in the product was dead: the
   Gantt, the PERT network, Resources, Plan vs actual and Analytics all showing
   the first-run markup they were born with, the estimate bank rendering nothing
   at all, and the Calculate button producing no observable effect whatsoever.

   The cause was two pairs of generated test cases sharing activity ids 28 and 29
   — almost certainly a generation run that read a stale nextId. Everything
   downstream is keyed by id, so the pairs collided: one preds entry, one inDeg
   and one succ list between each pair. The topological sort processed 32 of 34
   nodes, concluded the graph had a circle in it, and handed off to the cycle
   finder — which found NO node with a positive in-degree, took `undefined` as
   its starting point, and threw on preds[undefined].find().

   That single uncaught TypeError escaped findScheduleCycleIds, openDepFixWizard,
   recompute, ensureCalculated and switchTab, none of which has an error
   boundary. Every render after it simply never happened.

   Three separate things had to be wrong for that to reach a user, and this file
   holds all three to the standard:

     THE FINDER MAY RETURN "none". It may not throw. A diagnostic that crashes
     takes out the thing it was called to explain.

     THE FILE HEALS ON LOAD. Duplicate ids are not a state anyone can act on and
     not a state the product can work in, so hydrate repairs them before anything
     reads the plan.

     THE MESSAGE NAMES THE RIGHT FAULT. Duplicate ids also make the sort report a
     circle that does not exist, so a panel that says "cut a link" would be
     sending someone after a loop that was never there.

   The fixture is the user's own export, corruption intact. Nothing about it is
   synthetic, which is the point: three sweeps and forty-five hand-derived cases
   were green on the day this plan could not draw a single chart.
   ═══════════════════════════════════════════════════════════════════════════ */
const { requirePlaywright, chromePath, APP } = require('./_harness');
const { chromium } = requirePlaywright();
const fs = require('fs'), path = require('path');
const DUP = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '..', 'fixtures', 'duplicate-ids.json'), 'utf8'));

(async () => {
  const b = await chromium.launch({headless:true,args:['--no-sandbox'],executablePath: chromePath()});
  const page = await b.newPage({viewport:{width:1440,height:1200}});
  page.on('dialog', d => d.accept());
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(APP, {waitUntil:'load'});

  // the fixture has to still be corrupt, or everything below passes vacuously
  const fixtureDups = (() => {
    const c = {}; (DUP.tasks || []).forEach(t => { c[t.id] = (c[t.id] || 0) + 1; });
    return Object.keys(c).filter(k => c[k] > 1);
  })();

  const R = await page.evaluate(([d, expectDups]) => {
    const bad = [], out = { ran: [] };
    const say = x => bad.push('Corrupt file :: ' + x);
    const ran = k => out.ran.push(k);
    out.fixtureDuplicateIds = expectDups;
    if (!expectDups.length) {
      say('the fixture no longer contains duplicate ids, so nothing below is testing anything — '
        + 'it was committed with the corruption ON PURPOSE');
      return { contradictions: bad, counts: out };
    }

    /* ── 1. THE FINDER SURVIVES IT ──────────────────────────────────────────
       On a properly HYDRATED plan, re-collided. The first version of this check
       assembled `tasks` by hand from the raw file and called the finder on that,
       which produced a graph the real load never builds: the finder returned null
       instead of dying, and the check passed against a build with the crash still
       in it. Hydration normalises predecessors and marks summaries, and the crash
       needs that real shape — an in-degree count that miscounts by exactly the
       number of collided pairs, leaving NO node with a positive in-degree and the
       cycle walk starting from undefined. */
    ran('1·finderDoesNotThrow');
    hydrate(d);                                        // heals, so put it back
    /* Restore the file's EXACT ids, by position. An invented collision is not the
       same graph: the crash needs an in-degree miscount that leaves NO node with
       a positive in-degree, and two arbitrary duplicated ids produce a set that
       is merely wrong rather than empty — the finder then returns four ids and a
       build with the crash still in it passes. Only the shape that actually
       happened reproduces what actually happened, and the fixture is that shape.
       hydrate preserves task order, so position maps cleanly back. */
    let collided = 0;
    tasks.forEach((t, i) => {
      const src = (d.tasks || [])[i];
      if (src && t.id !== src.id) { t.id = src.id; collided++; }
    });
    out.recollided = collided;
    const nowDup = (() => { const c = {}; tasks.forEach(t => { c[t.id] = (c[t.id] || 0) + 1; });
      return Object.keys(c).filter(k => c[k] > 1).length; })();
    out.recollidedPairs = nowDup;
    if (!nowDup) say('the probe failed to put the file\'s own duplicate ids back, so check 1 tested nothing');
    try { computeWbsCodes(); } catch (e) { say('computeWbsCodes threw on duplicate ids: ' + e.message); }
    let cyc, threw = null;
    try { cyc = findScheduleCycleIds(); } catch (e) { threw = e.message; }
    out.finderReturned = threw ? 'THREW' : (cyc === null ? 'null' : cyc.length + ' ids');
    if (threw) say('findScheduleCycleIds threw instead of reporting: ' + threw
      + ' — a diagnostic that crashes takes out the thing it was called to explain, and this one took '
      + 'recompute, ensureCalculated and switchTab with it');
    // and the same collision must not kill the whole tab either
    let tabThrew = null;
    try { switchTab('analytics'); } catch (e) { tabThrew = e.message; }
    if (tabThrew) say('switchTab threw on a plan with duplicate ids (' + tabThrew
      + ') — every render after the throw never happens, which is how a corrupt file blanked five tabs');

    // ── 2. THE FILE HEALS ON LOAD ────────────────────────────────────────────
    ran('2·healsOnLoad');
    hydrate(d);
    const after = (() => { const c = {}; tasks.forEach(t => { c[t.id] = (c[t.id] || 0) + 1; });
      return Object.keys(c).filter(k => c[k] > 1); })();
    out.duplicatesAfterLoad = after.length;
    if (after.length)
      say('loading a file with duplicate ids leaves ' + after.length + ' still duplicated — every structure '
        + 'keyed by id stays collided and one activity of each pair is invisible to the schedule');
    if (tasks.length !== (d.tasks || []).length)
      say('the repair changed the activity count from ' + (d.tasks || []).length + ' to ' + tasks.length
        + ' — it is meant to renumber a shadowed activity, never to drop one');
    // nextId must never sit behind the plan again; that is what caused this
    if (nextId <= Math.max.apply(null, tasks.map(t => t.id)))
      say('nextId is ' + nextId + ' with a highest id of ' + Math.max.apply(null, tasks.map(t => t.id))
        + ' — the next activity created will collide exactly as these did');

    // ── 3. AND THEN THE PLAN ACTUALLY WORKS ──────────────────────────────────
    // The whole point. A repair that leaves the schedule uncomputable has fixed
    // nothing a person can see.
    ran('3·planComputes');
    const ok = recompute();
    out.recomputed = !!ok;
    if (!ok) say('the file healed and the schedule still will not compute, so every chart stays blank');
    else {
      const dated = leafTasks().filter(t => t.finishDate).length;
      out.datedActivities = dated;
      if (dated < leafTasks().length)
        say(dated + ' of ' + leafTasks().length + ' activities came out of the repair with a finish date');
    }

    // ── 4. THE MESSAGE NAMES THE RIGHT FAULT ─────────────────────────────────
    // Duplicate ids make the sort report a circle that is not there, so a notice
    // saying "cut a link" sends someone after a loop that never existed.
    ran('4·namesTheRightFault');
    const t0 = tasks[0], t1 = tasks.find(t => t.id !== t0.id);
    if (t0 && t1) {
      const keep = t1.id;
      t1.id = t0.id;                                  // re-corrupt, deliberately
      const msg = scheduleBlockedHtml();
      out.blockedSays = msg.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70);
      if (!/duplicat/i.test(msg))
        say('with duplicate ids present the blocked notice says "'
          + msg.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
          + '" — it does not name the actual fault');
      if (/circle|cut one link/i.test(msg))
        say('the notice blames a dependency circle for what is actually a duplicate id, sending the reader '
          + 'after a loop that does not exist');
      if (!/repairDuplicateTaskIds/.test(msg))
        say('the notice names the fault and offers no way to repair it');
      t1.id = keep;
    }

    return { contradictions: bad, counts: out };
  }, [DUP, fixtureDups]);

  R.pageErrors = errs.slice(0, 8);
  console.log(JSON.stringify(R, null, 1));
  await b.close();
  if (R.contradictions.length || errs.length) process.exitCode = 1;
})();
