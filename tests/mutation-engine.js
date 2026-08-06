/* ═══════════════════════════════════════════════════════════════════════════
   DOES THE SUITE HAVE TEETH?

   Nine sweeps and forty-four hand-derived cases were green while the PERT
   weighting was deliberately broken. Not because anyone wrote a bad check —
   because the reference plan's estimates are all symmetric, and for a symmetric
   estimate every weighted mean returns the same answer. The check was correct,
   the fixture could not tell the difference, and the whole apparatus reported
   success on a build that computed the wrong duration.

   That is the failure mode this file exists to catch. It breaks a load-bearing
   identity in the product, one at a time, writes the broken build to a temp
   file, and points the suite at it. Each mutant MUST turn something red. A
   surviving mutant is not a defect in the product — it is proof that a whole
   region of the product is unguarded, and it names which one.

   Usage:  node tests/mutation-engine.js
             Every mutant walks every check until one goes red. A SURVIVED here
             is trustworthy: nothing in the suite noticed.

           node tests/mutation-engine.js --quick
             Only the check expected to notice, plus the hand-derived plan. Fast
             enough to run while editing. A SURVIVED here means "the expected
             check did not catch it" and NOT "the suite has a hole" — some other
             check may well catch it. Confirm with a full run before believing a
             survivor.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'pert-gantt-tracker.html'), 'utf8');
const QUICK = process.argv.indexOf('--quick') >= 0;
/* Positional substring filter, matched against `what`. Two hundred mutants is
   twenty-six to forty minutes, which is the right price for a release gate and the wrong
   price for "I just added one — is it caught?". Without this the honest options
   were to run the lot or to hand-edit the array, and hand-editing a probe to
   make it finish is how a probe quietly stops covering what it claims to.
   Same shape as anchor-check.js takes, deliberately: one convention. */
const ONLY = process.argv.slice(2).filter(a => !a.startsWith('-'));

/* Each mutant names the identity it breaks and what should notice. `find` must
   match exactly once in the file — a mutant that silently fails to apply is a
   false pass, which is the very thing being hunted here. */
const MUTANTS = [
  { what: 'PERT weighting: the 4x on most-likely becomes 5x over 7',
    find: 'return (O + 4 * M + P) / 6;',
    with: 'return (O + 5 * M + P) / 7;' },

  { what: 'PERT variance: the range is treated as five sigma, not six',
    find: 'function pertVariance(o, p) { return Math.pow(((+p || 0) - (+o || 0)) / 6, 2); }',
    with: 'function pertVariance(o, p) { return Math.pow(((+p || 0) - (+o || 0)) / 5, 2); }' },

  { what: 'criticality: an activity with a day of float is called critical',
    find: 't.isCritical = Math.abs(t.slack) < 0.01;',
    with: 't.isCritical = Math.abs(t.slack) < 1.01;' },

  /* THE OTHER DIRECTION. The mutant above makes MORE activities critical and
     was the only one ever aimed here; nothing tested a build that marks NONE.
     It turns out to be caught by the per-activity assertion — "zero slack and
     not marked critical" — rather than by anything about the path, which is
     worth knowing and is not what I expected when I wrote it. Named for what it
     actually proves. */
  { what: 'network: an activity with zero slack is not marked critical at all',
    find: '        t.isCritical = Math.abs(t.slack) < 0.01;',
    with: '        t.isCritical = false;' },

  { what: 'earned value: completed work is valued at its cost, not its budget',
    find: 'const evOf = t => plannedCostOf(t, hb) * ((t.percentComplete || 0) / 100);',
    with: 'const evOf = t => (actOf.get(t.id) || 0);' },

  /* ── the regions that had never been asked this question ──────────────────
     Four caught mutants proved four regions guarded and said nothing about the
     rest. These are the ones named as unverified: the backward pass, the working
     calendar, resource pair counting, the percentile rule, save/load field
     coverage, and the margin. A survivor here is not a product defect — it is a
     region where a defect could ship unnoticed, which is worth knowing. */

  { what: 'backward pass: slack measured from the finish instead of the start',
    find: 't.slack = t.ls - t.es;',
    with: 't.slack = t.lf - t.ef + 0.5;' },

  { what: 'working calendar: weekends counted as working days',
    find: '        if (isWorkingDay(d, holidays)) added++;',
    with: '        added++;' },

  { what: 'resource load: a double-booked day counted once per person, not per pair',
    find: '            overResourceDays++;',
    with: '            /* mutant: the day is no longer counted */' },

  { what: 'percentile: P80 reads the 80th value of an UNSORTED series',
    find: "      const pct = q => durations[Math.min(durations.length - 1, Math.floor(q * durations.length))];",
    with: "      const pct = q => durations[Math.min(durations.length - 1, Math.floor(q * durations.length * 0.75))];" },

  { what: 'save/load: percentComplete is written but never read back',
    find: '          percentComplete: t.percentComplete, predecessors: t.predecessors,',
    with: '          predecessors: t.predecessors,' },

  { what: 'margin: computed against cost instead of price',
    find: '      const margin = (price > 0 && !costBlind) ? (price - cost) / price * 100 : null;',
    with: '      const margin = (price > 0 && !costBlind) ? (price - cost) / cost * 100 : null;' },

  /* ── what leaves the application ──────────────────────────────────────────
     An export is read by a client, or loaded into Jira, or opened in Excel by
     someone with no way to tell a total is wrong. It is the one category where
     the mistake is seen by somebody else first. */

  { what: 'billing CSV: the TOTAL row overstates cost by 10%',
    find: 'd.totCost.toFixed(0), d.totBill.toFixed(0)]);',
    with: '(d.totCost*1.1).toFixed(0), d.totBill.toFixed(0)]);' },

  { what: 'Jira CSV: the first story is silently dropped',
    find: '      reqs.stories.forEach(st => {',
    with: '      reqs.stories.slice(1).forEach(st => {' },

  { what: 'billing CSV: a line emits its cost as NaN',
    find: 'r.cost.toFixed(0), r.billed.toFixed(0)',
    with: '(r.cost*undefined).toFixed(0), r.billed.toFixed(0)' },

  /* ── undo ─────────────────────────────────────────────────────────────────
     The one feature a person reaches for when they already believe something
     has gone wrong, which is what makes a partial restore worse than none.

     Note on a mutant that is NOT here: removing `redoStack = keepRedo` from
     doRedo. restoreSnapshot sets undoGuard before its internal saveLocal, so
     trackUndo returns before it can clear the branch — the line is dead defence
     and its removal changes nothing observable. Verified by tracing redoStack
     through a three-step redo on both builds: identical. An equivalent mutant
     no test can catch, so listing it would report a permanent false hole. */

  { what: 'undo: the history is a bag — it pops the oldest state, not the newest',
    find: '      restoreSnapshot(undoStack.pop());',
    with: '      restoreSnapshot(undoStack.shift());' },

  { what: 'undo: the guard fails, so undo records itself and stops progressing',
    find: '      if (undoGuard) { lastSnapshot = currentStr; return; }',
    with: '      if (false) { lastSnapshot = currentStr; return; }' },

  { what: 'undo: the depth cap discards the newest step instead of the oldest',
    find: '        if (undoStack.length > 60) undoStack.shift();',
    with: '        if (undoStack.length > 60) undoStack.pop();' },

  { what: 'undo: editing after an undo keeps the abandoned redo branch alive',
    find: '        redoStack = [];',
    with: '        /* mutant: the branch is kept */' },

  { what: 'undo: the restore rewinds the activities but not the RAID log',
    find: '        hydrate(JSON.parse(str));',
    with: '        { const _k = raid; hydrate(JSON.parse(str)); raid = _k; }' },

  /* ── the reference every variance is measured against ─────────────────────
     Break the baseline and nothing looks broken: the plan reports itself
     against the wrong past, confidently and self-consistently. */

  { what: 'baseline: it freezes the dates but not the effort',
    find: '        t.baseTe = t.te;',
    with: '        t.baseTe = t.te * 1.15;' },

  { what: 'baseline: the feature set is committed at a different moment than the dates',
    find: '      reqsBaseline = {\n        at: baselineDate,',
    with: "      reqsBaseline = {\n        at: '2020-01-01'," },

  { what: 'baseline: the reference tracks the plan instead of holding still',
    find: '        t.baseCost = taskCost(t);',
    with: "        t.baseCost = taskCost(t);\n        Object.defineProperty(t,'baseTe',{get(){return this.te;},configurable:true});" },

  { what: 'baseline: clearing keeps the committed feature set',
    find: "      reqsBaseline = null;\n      // logged, not truncated",
    with: "      // logged, not truncated" },

  { what: 'baseline: the reference dates are never written to the file',
    find: '          baseStart: t.baseStart ? fmtISO(new Date(t.baseStart)) : null,',
    with: '          baseStart: null,' },

  /* Rolling the baseline is now "push a version and point at it", so the
     mutant is the version not being taken: the next change order then diffs
     from the one before and re-lists scope the client already approved. */
  { what: 'change order: approval does not roll the baseline, so the next one re-bills',
    find: "      const toV = pushVersion('co', p.no);",
    with: '      const toV = contractVersion() || pushVersion(\'co\', p.no);' },

  { what: 'change order: approval leaves the draft pending and it can be logged twice',
    find: '      draftChangeOrder._pending = null;\n      saveLocal();\n      renderCoHistory();',
    with: '      saveLocal();\n      renderCoHistory();' },

  /* Anchored on the ACCEPT path specifically. The short anchor stopped being
     unique the moment issuing became its own path writing its own log entry,
     and the engine SKIPPED it rather than picking one — correctly: a mutant
     that lands somewhere ambiguous is not evidence about anything. Reported as
     stale rather than as a survivor, which is the distinction that made this a
     two-minute repair instead of a hunt. */
  { what: 'change order: the log records a price delta the client never approved',
    find: "        finishDelta: p.finishDelta, priceDelta: p.priceDelta, newFinish: p.newFinish, newPrice: p.newPrice,\n        diff: p.diff || [], lineSum: p.lineSum || 0, hidePrice: (p.hidePrice || []).slice(),\n        fromV: p.fromV, toV: toV.v, state: 'accepted', stateAt: fmtISO(new Date()) });",
    with: "        finishDelta: p.finishDelta, priceDelta: (p.priceDelta || 0) + 500, newFinish: p.newFinish, newPrice: p.newPrice,\n        diff: p.diff || [], lineSum: p.lineSum || 0, hidePrice: (p.hidePrice || []).slice(),\n        fromV: p.fromV, toV: toV.v, state: 'accepted', stateAt: fmtISO(new Date()) });" },

  /* ── the dependency wizard: a button that acts on something else ───────────
     These three are not arithmetic. They are the shape of defect the user hit
     and no check could see: the control is wired, the handler runs, the data
     changes — and it is the WRONG object, or the button is off the edge of the
     dialog where no click can reach it. Reported as "the buttons don't do
     anything", which is what a correct handler on an unreachable or misaddressed
     control looks like from the outside. */

  { what: 'wizard: ✎ Open sends you to the task in the headline, whose link list is empty',
    find: 'const openId = holder ? holder.id : id;',
    with: 'const openId = id;' },

  /* ── the split budget bar and the catch-up date ────────────────────────────
     Both of these went wrong on the way in, and neither threw: the segments
     stacked naively so the drawn far end stated the timing figure while the
     badge stated the net, and the catch-up search bisected on instants and then
     floored the answer, naming a day on which the curve had not yet reached the
     booked total. A panel that talks a reader out of an alarm has to be right
     about the date it does it with. */

  { what: 'budget bar: the neutral segment carries the overrun instead of the timing',
    find: '        const timing = (evNow != null && pvNow != null) ? evNow - pvNow : null;',
    with: '        const timing = (evNow != null && pvNow != null) ? actCost - evNow : null;' },

  { what: 'budget bar: the segments stack naively, so the drawn end is not the gap',
    find: '            const lo = counter ? Math.min(a, b2) : Math.max(Math.min(a, b2), loN);',
    with: '            const lo = Math.min(a, b2);' },

  /* ── THE RECONCILIATION'S SOURCE COLUMNS ────────────────────────────────
     Three ways the table stops adding up, all of which leave the DERIVED
     columns footing perfectly — which is why the version that shipped with two
     of them was green on every check in this repo. An activity contributing
     zero, or a milestone, takes its booked and due figures out of the visible
     rows and leaves both in the totals; the bar stays right and the audit trail
     under it stops being one. The last mutant is the trap the first version of
     the CHECK fell into: let the residual absorb the difference and the columns
     add up again under a label that says the money cannot be opened. */

  /* ── VERSIONS, ACCEPTANCE, AND THE DIFF THAT SITS ON BOTH ────────────────
     Seven mutants for the three layers, each restoring one of the specific
     defects they were built to end. All seven are invisible to a
     value-comparing check on a loaded fixture, because none of these conditions
     exists in a committed plan: nothing is renamed, no test carries a result,
     nobody has signed anything. The checks that catch them build the case
     first, which is why they are in baseline-sweep rather than anywhere that
     merely looks. */

  { what: 'baseline: the diff goes back to keying activities by name',
    find: '      const A = new Map((fromSnap.tasks || []).map(t => [t.id, t]));\n      const B = new Map((toSnap.tasks || []).map(t => [t.id, t]));',
    with: '      const A = new Map((fromSnap.tasks || []).map(t => [t.name, t]));\n      const B = new Map((toSnap.tasks || []).map(t => [t.name, t]));' },

  { what: 'baseline: an owner change is invisible to the change order again',
    find: "        if (String(a.owner || '') !== String(b.owner || ''))",
    with: '        if (false)' },

  { what: 'baseline: a change-order line prices off the frozen baseline, so nothing is priced',
    find: '          value: Math.round(taskBilledValue(t) || 0),',
    with: '          value: Math.round(plannedCostOf(t, hasBaseline()) || 0),' },

  { what: 'baseline: finishing a test case counts as the test passing',
    find: "      else if (passed.length === cases.length) state = 'accepted';",
    with: "      else if (cases.every(t => (t.percentComplete || 0) >= 100)) state = 'accepted';" },

  { what: 'baseline: a failed test case stops making its criterion fail',
    find: "      else if (failed.length) state = 'failed';",
    with: "      else if (false) state = 'failed';" },

  { what: 'baseline: a re-test leaves no trace, so passed and passed-eventually are one fact',
    find: '               retests: cases.reduce((s, t) => s + Math.max(0, (t.tcRuns || []).length - 1), 0) };',
    with: '               retests: 0 };' },

  /* The comparison is computed correctly and reaches no host — the failure this
     repo has shipped before and that no arithmetic check can see. And the
     commitment log stops taking a version, so every row goes back to ending at
     a sentence with nothing behind it. */
  { what: 'baseline: the version comparison is computed and never drawn',
    find: "        + '<div id=\"versionCompareBl\" style=\"margin-top:.6rem\">' + versionViewHtml() + versionCompareHtml() + '</div>'",
    with: "        + ((() => versionViewHtml() + versionCompareHtml())(), '')" },

  { what: 'baseline: a commitment stops recording which version it took',
    find: "      const vRec = kind === 'clear' ? null : pushVersion('baseline',\n        kind === 'set' ? (baselineLog.length ? 'Re-baselined' : 'Original commitment') : String(kind));",
    with: '      const vRec = null;' },

  /* Three fields that shipped wired to nothing, and one that counted the wrong
     set. Each is a "reads correct, does nothing" defect — the shape no
     value-comparing check can see, because the value it would compare is never
     produced. */

  { what: 'baseline: the evidence field goes back to being unreachable',
    find: '            <div class="form-group" id="mTcRow" style="display:none;margin-bottom:0">',
    with: '            <div class="form-group" id="mTcRowGone" style="display:none;margin-bottom:0">' },

  { what: 'baseline: typing evidence into the editor is read but never stored',
    find: '      t.tcEvidence = ev.value.trim();',
    with: '      /* mutant: read and discarded */' },

  { what: 'baseline: a failure recorded in the app raises nothing to chase',
    find: "      if (result) { try { raised = raiseTestDefect(t, result, o.note, 'recorded in the app'); } catch (e) {} }",
    with: '      if (false) { raised = true; }' },

  { what: 'baseline: re-running a failing case opens a second defect for the same thing',
    find: "      if (raid.some(x => x.taskId === tc.id && x.title === title && x.status !== 'Closed')) return false;",
    with: '      if (false) return false;' },

  { what: 'baseline: delivered stops being distinguished from accepted',
    find: '        if (done && worth > 0 && unaccepted.has(t.id)) {',
    with: '        if (false) {' },

  { what: 'change order: the cumulative total counts scope nobody has agreed',
    find: '      const acc = coAccepted();',
    with: '      const acc = coLog;' },

  /* View and restore. The middle one is the unrecoverable failure in this
     feature: a restore that tidies the plan by deleting the record of work
     people actually did. */

  { what: 'baseline: a version can be diffed but not opened',
    find: "        if (el) { try { el.innerHTML = versionViewHtml() + versionCompareHtml(); } catch (e) {} }",
    with: "        if (el) { try { el.innerHTML = versionCompareHtml(); } catch (e) {} }" },

  { what: 'baseline: restoring a version wipes the actuals along with the plan',
    find: '        if (s2.acceptance != null) t.acceptance = s2.acceptance;',
    with: "        t.percentComplete = 0; t.actualStart = ''; t.actualFinish = ''; t.actualEffort = null; t.invoiced = null;\n        if (s2.acceptance != null) t.acceptance = s2.acceptance;" },

  { what: 'baseline: a restore leaves the scope added after the version in place',
    find: "      const rm = new Set();\n      addedSince.forEach(t => { rm.add(t.id); allDescendants(t.id).forEach(d => rm.add(d.id)); });\n      tasks = tasks.filter(t => !rm.has(t.id));",
    with: '      const rm = new Set();' },

  { what: 'baseline: a restore overwrites the present without recording it first',
    find: "      pushVersion('draft', 'Before restoring v' + v.v);",
    with: '      /* mutant: the present is not saved */' },

  { what: 'baseline: a restore leaves links pointing at activities it deleted',
    find: '        t.predecessors = (t.predecessors || []).filter(pr => live.has(pr.id));',
    with: '        t.predecessors = (t.predecessors || []);' },

  { what: 'baseline: a restore puts the activities back and leaves the criteria drifted',
    find: '        st.ac = (was.ac || []).map(a => ({ id: String(a.id), text: String(a.text || \'\'),\n                                           type: a.type || \'\' }));',
    with: '        /* mutant: the criteria are left as they now stand */' },

  { what: 'baseline: the version chain grows without bound',
    find: '      if (planVersions.length <= VERSION_CAP) return 0;',
    with: '      return 0;' },

  { what: 'baseline: the trim takes a version a change order points at',
    find: "      if (v.kind === 'sow' || v.kind === 'co' || v.kind === 'signoff') return true;",
    with: '      return false;' },

  { what: 'baseline: versions are dropped and nothing records that they were',
    find: '        planVersions[0].trimmed = (planVersions[0].trimmed || 0) + dropped;',
    with: '        /* mutant: the gap is left unexplained */' },

  { what: 'baseline: a sign-off records a date instead of the version it signed',
    find: "      const v = pushVersion('signoff', 'Accepted: ' + (signoffRefLabel(sc, ref) || sc));",
    with: '      const v = { v: null };' },

  /* Splitting a crowded tab into sections creates two failures the old scroll
     could not have: a section with no way to reach it, and two buttons that
     paint the same thing because a key fell through to a default. Both look
     completely normal. And a link into the tab is now a two-part address, so
     one that names only the tab lands wherever you happened to be last —
     "Set day rates" opening the worklist is a button that lies. */
  { what: 'navigation: two sections of the team tab paint the same panel',
    find: "        cost:     () => resourceEffortHtml() + billingBreakdownHtml() + cashTermsPanelHtml()",
    with: "        cost:     () => levelBanner + heatmap + summary" },

  /* The `hidden` attribute only sets display:none from the user-agent sheet,
     and .toolbar carries an author display:flex — so the attribute reads
     correctly in the DOM and changes nothing on screen. This one exists to keep
     the check reading the COMPUTED style; an assertion on the flag agrees with
     the code and not with the page. */
  { what: 'navigation: the section-scoped toolbar is hidden by a flag the stylesheet overrules',
    find: "      if (tools) tools.style.display = resTab === 'workload' ? '' : 'none';",
    with: "      if (tools) tools.hidden = resTab !== 'workload';" },

  { what: 'navigation: a link into the team tab forgets which section it meant',
    find: '    function resGoto(k) { setResTab(k); switchTab(\'resources\'); }',
    with: "    function resGoto(k) { switchTab('resources'); }" },

  /* L1 is the executive view of the chart and it was the one with no committed
     dates on it: collapsing the phases took every milestone underneath them. */
  { what: 'criticality: the Gantt loses its milestones the moment a phase is collapsed',
    find: '      const rows = ganttWbsOrder();',
    with: '      const rows = visibleWbsOrder();' },

  { what: 'drill-in: an activity running exactly to plan is dropped from the reconciliation',
    find: '            if (!(booked > 0.5 || due > 0.5)) return null;',
    with: '            if (!(booked > 0.5 || due > 0.5) || Math.abs(gap(t)) < 0.5) return null;' },

  { what: 'drill-in: milestones carry booked cost and are excluded from the reconciliation',
    find: '          const rows = leaves.map(t => {\n            const booked = actOf.get(t.id) || 0, due = planToDate(t);',
    with: '          const rows = leaves.filter(t => !t.milestone).map(t => {\n            const booked = actOf.get(t.id) || 0, due = planToDate(t);' },

  /* Two more were written for this and then DELETED rather than kept green,
     because neither could change what the page does. Zeroing the residual
     line's due/booked cells is a no-op once the table stops dropping rows — the
     residual is always zero — and routing an unknown tone through `m[tone] ||
     default` behaves identically while every tone is in the map. A mutant that
     cannot alter behaviour is caught by nothing and proves nothing, and keeping
     it would have inflated the count with two guaranteed survivors or, worse,
     two that "passed" because the build and the mutant were the same program. */

  /* ── ONE AMBER OVER TWO OPPOSITE FINDINGS ───────────────────────────────
     Being ahead of the spend curve because the work is ahead costs nothing.
     Finished work costing more than it was budgeted is a real overrun. They
     shared a colour, which put the alarm on the benign case — and the benign
     case is the common one, so the alarm was mostly wrong and stopped being
     read. Two mutants: collapse the tones back into one, and let the new tone
     fall through a default that paints it green. */

  { what: 'budget bar: ahead-of-curve and genuinely overrun wear the same warning colour',
    find: "        tone: (overCurve && overValue) ? 'bad' : overValue ? 'chg' : overCurve ? 'early' : 'good'",
    with: "        tone: (overCurve && overValue) ? 'bad' : (overCurve || overValue) ? 'chg' : 'good'" },

  { what: 'budget bar: the new tone is wired to the reassuring colour instead of its own',
    find: "      badge: { bad: 'badge-blocked', chg: 'badge-warn', early: 'badge-info', good: 'badge-ok' },",
    with: "      badge: { bad: 'badge-blocked', chg: 'badge-warn', early: 'badge-ok', good: 'badge-ok' }," },

  /* A glyph that duplicates the punctuation of the words beside it. Nothing is
     miscomputed, so every value-comparing check in the repo is blind to it, and
     a reader sees it instantly. */
  { what: 'form: the watch chip prefixes a question mark to a label that is already a question',
    find: "        + escapeHtml(tip) + '\"><span aria-hidden=\"true\">👁</span>'",
    with: "        + escapeHtml(tip) + '\"><span aria-hidden=\"true\">' + (asks ? '?' : '👁') + '</span>'" },

  { what: 'catch-up: the crossing date is floored to the midnight before it',
    find: '      return { on: stripTime(new Date(dayAt(hiD))), days: hiD };',
    with: '      return { on: stripTime(new Date(dayAt(hiD) - 86400000)), days: hiD };' },

  /* ── one envelope, not three ───────────────────────────────────────────────
     The Budget bar divides by an envelope, the spend curve totals one, and the
     note says the bar IS the curve's vertical gap at today. On a plan with work
     added after the baseline they were three different numbers, because
     pvSpread never fell back to live DATES the way plannedCostOf falls back to
     live COST, and the bar's denominator summed `baseCost || 0` — the exact bug
     budgetAtCompletion carries a comment about. Invisible until a real export
     with twelve post-baseline test cases arrived. */

  { what: 'envelope: the curve drops work the baseline never dated',
    /* anchored through the comment above it, because revSpread now applies the
       SAME baseline-then-live date rule and the two lines alone match twice.
       A mutant that matches more than once cannot be trusted to have applied
       where it was aimed, which is why the run reports a skip rather than
       quietly patching the first hit. */
    find: '           where "this was not in the commitment" gets said. */\n        const s1 = (ub ? t.baseStart : t.startDate) || t.startDate;\n        const f1 = (ub ? t.baseFinish : t.finishDate) || t.finishDate;',
    with: '           where "this was not in the commitment" gets said. */\n        const s1 = ub ? t.baseStart : t.startDate;\n        const f1 = ub ? t.baseFinish : t.finishDate;' },

  { what: 'envelope: the bar divides by the frozen sum instead of the plan',
    find: '        const ref = baseCost > 0 ? budgetAtCompletion(hb) : planCost;',
    with: '        const ref = baseCost > 0 ? baseCost : planCost;' },

  /* the scope verdict, in both directions — "no change order is due" is the most
     expensive sentence on the page to get wrong */

  { what: 'scope: test-case regeneration is never named as verification work',
    find: "        if (verificationOnly && featureHeld && scp.state !== 'flat') {",
    with: '        if (false) {' },

  { what: 'scope: real growth is cleared as verification work',
    find: '        const verificationOnly = moved.length > 0 && movedTc === moved.length;',
    with: '        const verificationOnly = moved.length > 0;' },

  { what: 'form: a template placeholder is printed at the reader again',
    find: '<div id="rScore" class="raid-score">\u2014</div>',
    with: '<span class="help-text">Score $' + '{\'\' /' + '* prob x impact *' + '/}</span>' },

  { what: 'form: the RAID owner box is no longer a type-ahead',
    find: '      populateOwnerList();\n      /* Status had no control at all.',
    with: '      /* Status had no control at all.' },

  { what: 'drill-in: the badge counts the top 5 rather than everything that matched',
    find: '      const shownN = r.drivers.length, totalN = r.drivers.matched || shownN;',
    with: '      const shownN = r.drivers.length, totalN = shownN;' },

  /* ── the red ring ─────────────────────────────────────────────────────────
     It lands on GREEN cells, so a red ring on a finished activity reads as "done
     badly". It never means that: only that the RECORD of what happened is
     missing or impossible. Reported by someone whose ringed activities had all
     come in under their estimates. */

  { what: 'ring: the caption counts the flagged cells and names no reason',
    find: "          + (top.length ? ': ' + top.join(', ') + '.' : '.')",
    with: "          + '.'" },

  { what: 'ring: nothing says the ring is about the record, not about effort',
    find: "              + '<i class=\"ptr-c-done ptr-flag-high\"></i>the <b>record</b> needs a second look — dates, '\n              + 'cost or an open RAID entry, not effort</span>' : '');",
    with: "              + '<i class=\"ptr-c-done ptr-flag-high\"></i>needs a second look</span>' : '');" },

  /* ── the corrupt file ──────────────────────────────────────────────────────
     A real plan with two pairs of test cases sharing activity ids. Everything is
     keyed by id, so the pairs collided, the topological sort miscounted, the
     cycle finder started from `undefined` and threw — out of recompute, out of
     ensureCalculated, out of switchTab. Five tabs dead, the estimate bank blank,
     Calculate inert. One TypeError, no error boundary anywhere above it, and
     three sweeps plus forty-five hand-derived cases green the whole time. */

  { what: 'corrupt file: the cycle finder dies on an empty cycle set again',
    find: ['      if (!inCycle.size) return null;\n      let cur = inCycle.values().next().value;',
           '      while (cur != null && !seen.has(cur)) {',
           '        const nxt = (preds[cur] || []).find(p => inCycle.has(p.id));'],
    with: ['      let cur = inCycle.values().next().value;',
           '      while (!seen.has(cur)) {',
           '        const nxt = preds[cur].find(p => inCycle.has(p.id));'] },

  { what: 'corrupt file: duplicate ids are no longer healed on load',
    find: '      repairDuplicateTaskIds({ silent: true });',
    with: '      /* mutant: the file loads corrupt */' },

  { what: 'corrupt file: the notice blames a loop for a duplicate id',
    find: '      const dup = findDuplicateTaskIds();\n      if (dup.length)',
    with: '      const dup = [];\n      if (dup.length)' },

  /* ── the two the user found on the live demo ──────────────────────────────
     Both are about what a panel says when it has nothing to show. One told a
     reader with 41 activities to add activities; the other showed forty-four
     full-sentence rows where a count belonged. Neither is an arithmetic error,
     and neither would ever throw. */

  { what: 'blocked tab: a plan with a dependency loop shows the first-run message again',
    find: '      if (!schedOk && tasks.length) paintScheduleBlocked();',
    with: '      /* mutant: nothing says why the tab is empty */' },

  { what: 'blocked tab: the reason is overwritten by the next repaint',
    find: '      if (!calculated) { host.innerHTML = scheduleBlockedHtml(); return; }',
    with: '      if (!calculated) { host.innerHTML = blank; return; }' },

  { what: 'blocked tab: Calculate fails silently again',
    /* anchor moved when calculate() gained its boundary: the bare
       `if (!recompute())` became a guarded call whose result is read from `rc`.
       Repaired rather than deleted — the property it holds is still live and the
       skip was reported precisely so this would not go quietly vacuous. */
    find: '      if (!rc) {\n        const loop = findScheduleCycleIds() || [];',
    with: '      if (!rc) { return; }\n      if (false) {\n        const loop = findScheduleCycleIds() || [];' },

  { what: 'changes panel: a large diff expands over the whole tab again',
    find: '      const BIG = d.total > 12;',
    with: '      const BIG = false;' },

  /* ── the side readout ─────────────────────────────────────────────────────
     Three separate facts that used to be one middot-joined sentence in a badge.
     Split apart, each can now disagree with the others on its own, and two of
     those disagreements would put an alarm back on a plan that is fine. */

  { what: 'readout: the caption contradicts the direction of the figure beside it',
    find: "          : bv.gap > 0 ? 'ahead of the spend curve' : 'behind the spend curve';",
    with: "          : bv.gap > 0 ? 'behind the spend curve' : 'ahead of the spend curve';" },

  { what: 'readout: an underrun is painted as a fault',
    find: "          bud.deltaVerdictTone = tiny ? 'flat' : overAll > 0 ? 'bad' : 'good';",
    with: "          bud.deltaVerdictTone = 'bad';" },

  /* ── the two surfaces that had no checks at all ────────────────────────────
     The commitment history and the estimate bank. The bank matters most: it is
     the only data here that outlives the project file, and a wrong median in it
     surfaces as a quote that is light — on the next engagement, to a different
     client, with nothing on any screen looking wrong. */

  { what: 'baseline history: taking a baseline no longer records the commitment',
    find: "      baselineLogPush('set');",
    with: '      /* mutant: the commitment is not recorded */' },

  { what: 'baseline history: clearing truncates the log instead of appending to it',
    find: "      baselineLogPush('clear');",
    with: '      baselineLog = [];' },

  { what: 'baseline history: the cap drops the ORIGINAL commitment',
    find: '        const gone = baselineLog.splice(1, 1)[0];',
    with: '        const gone = baselineLog.splice(0, 1)[0];' },

  { what: 'baseline history: the reset count ignores what the cap took',
    find: "      return baselineLog.filter(e => e.kind === 'set').length\n        + ((baselineLog[0] && baselineLog[0].trimmedSets) || 0);",
    with: "      return baselineLog.filter(e => e.kind === 'set').length;" },

  { what: 'baseline history: the log is never written to the file',
    find: '        resources, reserves, baselineDate, baselineLog, levelMode, projectBudget,',
    with: '        resources, reserves, baselineDate, levelMode, projectBudget,' },

  { what: 'bank: forgetting a project shortens the list without dropping the records',
    find: '      const keep = all.filter(r => r.proj !== proj);',
    with: '      const keep = all.slice(0, Math.max(0, all.length - 1));' },

  { what: 'bank: span-derived actuals are taught to the estimator as measured effort',
    find: "    function bankCalibration() {\n      const rows = loadBank().filter(r => r.basis === 'logged' && r.ratio > 0);",
    with: "    function bankCalibration() {\n      const rows = loadBank().filter(r => r.ratio > 0);" },

  { what: 'test plan: the sample ships its test cases as one serial chain again',
    find: '      unchainTestCases({ silent: true });',
    with: '      /* mutant: the sample ships chained */' },

  { what: 'wizard: ⑂ Nest offers to re-parent a test case under a phase',
    find: '&& predT && !isTestCaseTask(predT) && !predIsPhase',
    with: '&& predT && !isTestCaseTask(predT)' },

  /* Two edits, because either alone still fits: putting the buttons back beside
     the text only overflows once they also stop wrapping, and a mutant that
     survives for being too small reads as a hole in the sweep that is not one. */
  { what: 'wizard: the buttons sit beside the text again and run off the dialog',
    find: ['rows += `<div style="padding:0.5rem 0.65rem;border:1px solid',
           '<div style="display:flex;gap:0.35rem;flex-wrap:wrap;justify-content:flex-end;margin-top:0.4rem">'],
    with: ['rows += `<div style="display:flex;align-items:flex-start;gap:0.6rem;padding:0.5rem 0.65rem;border:1px solid',
           '<div style="display:flex;gap:0.35rem;flex-shrink:0;flex-wrap:nowrap;justify-content:flex-end">'] },

  /* ── prose that only pretends to read the plan ────────────────────────────
     Every other mutant here breaks a computation. This one leaves the
     computation perfectly correct and stops the SENTENCE from using it — the
     figure is still right everywhere else on the page, and one caption states
     a number typed by hand. That is the shape of defect a reader cannot catch
     by eye, because a hardcoded claim reads exactly like a computed one, and it
     is the shape nothing in the suite could see before dynamic-prose-sweep. */

  { what: 'prose: the booked-to-date caption states a figure typed by hand',
    find: "escapeHtml(hasAc ? money(c.ac) + ' booked' : 'nothing booked')",
    with: "escapeHtml(hasAc ? '$27,900 booked' : 'nothing booked')" },

  /* ── one rule, asked in four places ───────────────────────────────────────
     computeResourceLoad does not count a day whose overlapping work is all
     finished. The heatmap cell, its tooltip, the day drill-in and the mend cards
     all restate that judgement, and three of them used to re-derive it naively —
     so a red cell sat beside a badge reading OK, and the drill-in's jump button
     pointed at a mend card that is never built for a discounted day and did
     nothing at all when clicked. */

  { what: 'heatmap: a day is painted as a conflict on raw load, ignoring the finished-work rule',
    find: '          const isOver = overSet.has(iso);',
    with: '          const isOver = load > R.capacity + 1e-6;' },

  { what: 'heatmap: the day drill-in re-derives "over" and offers a jump with nowhere to land',
    find: '        const isOver = (R.overDays || []).indexOf(iso) >= 0;',
    with: '        const isOver = day.load > R.capacity + 1e-6;' },

  { what: 'heatmap: a 200% peak sits beside a bare green OK with nothing reconciling them',
    find: '            : R.peak > R.capacity + 1e-6',
    with: '            : false' },

  /* ── the address bar, and the panel you hand to a person ──────────────────
     Both are about somebody else acting on what they see: one is whether a view
     can be returned to or linked, the other is whether a row says enough to act
     on and whether the copy of it carries the same facts. */

  { what: 'navigation: a tab no longer writes its own address, so Back leaves the application',
    find: "      if (!_tabNav && location.hash.replace(/^#/, '') !== name) {",
    with: '      if (false) {' },

  { what: 'worklist: the row stops carrying the open RAID entry raised against its activity',
    find: "(typeof raidForTask === 'function' ? raidForTask(t.id, true) : [])",
    with: '[]' },

  { what: 'worklist: activity names are truncated back to a shared prefix',
    find: "        + ekTok(r.kind, r.wbs, r.name, { xs: true, max: 140 }) + '</button>'",
    with: "        + ekTok(r.kind, r.wbs, r.name, { xs: true, max: 22 }) + '</button>'" },

  { what: 'worklist: nothing can start and the thing everyone waits on goes unnamed',
    find: '      const all = [...cnt.values()].sort((a, b) => b.n - a.n);\n      return all.length ? all[0] : null;',
    with: '      return null;' },

  { what: 'worklist: the copied document drops the risks it lists on screen',
    find: "(r.raid || []).forEach(q => L.push('      ' + q.type.toLowerCase() + ': ' + q.title",
    with: "[].forEach(q => L.push('      ' + q.type.toLowerCase() + ': ' + q.title" },
  /* ── every row reachable, and criteria that only ever ADD ─────────────────
     Two requests, one shape: a summary with no way out. The worklist card capped
     three groups and discarded finished work at the data layer, so "and 6 more"
     was the end of the road; and the story card could rewrite its criteria or
     regenerate its test cases but never simply add coverage — a rewrite replaces
     wording a client may have signed. */

  { what: 'worklist: "Show every row" no longer lifts the per-group cap',
    find: '      const MAXN = wlView.all ? 1e9 : 6, MAXB = wlView.all ? 1e9 : 5;',
    with: '      const MAXN = 6, MAXB = 5;' },

  { what: 'worklist: the drill-in caps its own list, which is the one thing it exists not to do',
    find: '          + wlTable(rows, showBlock, 1e9)',
    with: '          + wlTable(rows, showBlock, 3)' },

  { what: 'worklist: finished activities are discarded instead of kept behind a filter',
    find: '          if (done) { b.done++; b.doneRows.push(r2); return; }',
    with: '          if (done) { b.done++; return; }' },

  { what: 'criteria: the model\'s own AC ids are trusted, so a new one collides with an existing one',
    find: "        do { id = base + '.' + (n++); } while (existing.has(id));",
    with: "        id = String(a.id || (base + '.' + (n++)));" },

  { what: 'criteria: "add" replaces the existing criteria instead of appending to them',
    find: '      s.ac = (s.ac || []).concat(added);',
    with: '      s.ac = added;' },
  /* ── effort, and whose it is ──────────────────────────────────────────────
     A worklist that states a date and not a size asks somebody to plan their
     week from half the information. Once effort is on the row the variance is
     free — but both are per PERSON: an activity two people split at 50% each
     contributes half to each, and dropping that weighting silently inflates the
     plan's effort by every piece of joint work. */

  { what: 'effort: a worklist row shows the whole activity as one person\'s, ignoring their allocation',
    find: '            estDays: unitToWorkingDays(row.te) * share,',
    with: '            estDays: unitToWorkingDays(row.te),' },

  { what: 'effort: the per-person breakdown drops the allocation weighting and double-counts shared work',
    find: '          R.planDays += unitToWorkingDays(Number(t.te) || 0) * share;',
    with: '          R.planDays += unitToWorkingDays(Number(t.te) || 0);' },

  { what: 'effort: variance is measured against the whole estimate, not the fraction actually earned',
    find: '        R.varDays = R.measured ? R.actDays - R.earnedDays : null;',
    with: '        R.varDays = R.measured ? R.actDays - R.refDays : null;' },

  { what: 'effort: the rich-text copy drops the column the screen shows',
    find: '                + \'<td style="\' + td + \'">\' + h(wlEffText(r)) + \'</td>\'',
    with: '                + \'<td style="\' + td + \'">—</td>\'' },
  /* ── who did it, and who they work for ────────────────────────────────────
     The bank could calibrate by activity kind, work type and role, and could not
     answer the question that recurs every time the same subcontractor turns up on
     another engagement: does THAT firm's work run over. A role cannot answer it —
     two firms both field "integration developers" — and an individual's name
     usually cannot either, because people rarely repeat across clients while the
     partner does. */

  { what: 'bank: the archived row loses the set of companies that touched the activity',
    find: '          orgs: [...new Set(taskParticipants(t).map(pr => orgOf(pr.name)).filter(Boolean))],',
    with: '          orgs: [],' },

  { what: 'bank: archived participants carry no allocation, so one person at 100% reads like four at 25%',
    find: '          people: taskParticipants(t).map(pr => ({ n: pr.name, u: Number(pr.units) || 0,',
    with: '          people: taskParticipants(t).map(pr => ({ n: pr.name, u: 0,' },

  { what: 'bank: joint work is credited to one firm instead of every firm on it',
    find: '        }, { minN: ORG_MIN_N, multi: true }).slice(0, 10),',
    with: '        }, { minN: ORG_MIN_N }).slice(0, 10),' },

  { what: 'bank: the company calibration is computed and never reaches the prompt',
    find: "By the COMPANY that did the work — ${c.byOrg.map(line).join(' | ')}.",
    with: 'By the COMPANY that did the work — (omitted).' },
  /* ── a company is an entity, not a spelling ───────────────────────────────
     The bank exists to compare the same firm ACROSS engagements, and free text
     cannot do it: "Northwind Integration" retyped as "Northwind Integration Ltd"
     on the fourth project silently starts a fourth history with n=1, exactly when
     the first three had become worth something. */

  { what: 'bank: company history is grouped on the NAME, so a rename splits it in two',
    find: `          if (ids.length) return ids.map((id, i) => (orgFind(id) || {}).name
            || (r.orgs || [])[i] || r.org || id);
          return (r.orgs && r.orgs.length) ? r.orgs : (r.org || '');`,
    with: `          return (r.orgs && r.orgs.length) ? r.orgs : (r.org || '');
          /* mutant: the id is ignored, so the NAME is the grouping key */` },

  { what: 'effort: people with no company set are dropped from the company breakdown',
    find: '        if (!g.has(key)) g.set(key, { name: label, planDays: 0',
    with: '        if (!r.org) return;\n        if (!g.has(key)) g.set(key, { name: label, planDays: 0' },

  { what: 'effort: the worklist total sums only the rows on screen, not the whole group',
    find: '      const totDays = rows.reduce((a, r) => a + (r.estDays || 0), 0);',
    with: '      const totDays = shown.reduce((a, r) => a + (r.estDays || 0), 0);' },
  /* ── the handoff ──────────────────────────────────────────────────────────
     The company registry lives outside every project, so a bank export, a people
     library and a project file all carry company IDS referencing it. On the
     machine that wrote them every id resolves; on a colleague's it does not, and
     that shipped broken in two visible ways — the bank's company card printing a
     raw slug as a firm's name, and a roster picker reading "— none —" for a
     person whose employer the file states plainly.

     Note a mutant that is NOT here: removing the `orgs` block from the bank
     export. Every row also carries the company's NAME beside its id, and the
     importer adopts from the rows when the block is absent — an older export has
     no block at all and must still work. The removal is therefore equivalent:
     nothing observable changes, and listing it would report a permanent false
     hole. Verified by exporting, deleting the block by hand, and importing into
     an empty registry on both builds: identical. */

  { what: 'handoff: an adopted company is given a fresh local id, splitting one firm in two',
    find: '      const rec = { id: key, name: nm || key, at: fmtISO(new Date()), adopted: true };',
    with: "      const rec = { id: orgSlug(nm || key) + '-local', name: nm || key, at: fmtISO(new Date()), adopted: true };" },

  { what: 'handoff: a company the registry has not adopted is labelled with its internal id',
    find: `          if (ids.length) return ids.map((id, i) => (orgFind(id) || {}).name
            || (r.orgs || [])[i] || r.org || id);`,
    with: '          if (ids.length) return ids.map(id => (orgFind(id) || {}).name || id);' },
  /* ── three things a person could not do ───────────────────────────────────
     Reported from use, not from reading the code: a readout whose buttons vanish
     as you reach for them, a timing figure that states a consequence and hides
     its cause, and a backup that leaves behind three of the four stores that make
     up a workspace. */

  { what: 'curve: the reading clears the instant the pointer leaves, so its buttons cannot be reached',
    find: '      ptrScGraceT = setTimeout(ptrScClearNow, 420);',
    with: '      ptrScClearNow();' },

  { what: 'drill-in: "ahead of its dates" no longer names the two dates that moved the money',
    find: "            + (timing > 0 ? 'ahead of its dates' : 'behind its dates') + when",
    with: "            + (timing > 0 ? 'ahead of its dates' : 'behind its dates') + ''" },

  { what: 'backup: the whole-workspace file leaves the estimate bank behind',
    find: '        projects: projects, bank: bank, people: people, orgs: orgs',
    with: '        projects: projects, people: people, orgs: orgs' },
  /* ── is "booked" a fact or an accrual? ────────────────────────────────────
     actualCostOf DERIVES cost from work recorded — day rate × logged effort plus
     fixed cost prorated by percent complete — unless somebody typed over it. So
     an activity finishing nineteen days early books its cost nineteen days early
     whether or not an invoice exists. Right default for judging delivery, still
     an assumption, and "you are spending ahead of the plan" read as money out of
     the door is a different conclusion from the one the data supports. */

  { what: 'accrual: the bar draws the timing conclusion and drops the caveat that booked money is accrued',
    find: '          const cb0 = costBasisSplit(leaves);\n          if (cb0.anyDerived)',
    with: '          const cb0 = costBasisSplit(leaves);\n          if (false)' },

  { what: 'accrual: typed-in cost is counted as derived, so the panel describes the wrong model',
    find: '        if (t.autoActualCost === false) { out.typedN++; out.typed += v; }',
    with: '        if (false) { out.typedN++; out.typed += v; }' },
  /* ── cash timing ──────────────────────────────────────────────────────────
     Terms convert the accrual into when money is expected to move. Three ways
     the second line is worse than not drawing it: the same total must eventually
     arrive (a shift is not a discount), it must never arrive EARLIER than the
     work that caused it, and with no terms set there must be no second line at
     all — drawing one implies a distinction nobody made. */

  { what: 'cash: the shift loses money on the way, so a delay reads as a discount',
    find: "      if (T.kind === 'net') return [{ s: s + T.days * DAY, f: f + T.days * DAY, c: c }];",
    with: "      if (T.kind === 'net') return [{ s: s + T.days * DAY, f: f + T.days * DAY, c: c * 0.9 }];" },

  { what: 'cash: terms move money EARLIER, so the plan pays before the work happens',
    find: "      if (T.kind === 'net') return [{ s: s + T.days * DAY, f: f + T.days * DAY, c: c }];",
    with: "      if (T.kind === 'net') return [{ s: s - T.days * DAY, f: f - T.days * DAY, c: c }];" },

  { what: 'cash: a second curve is drawn on a plan with no payment terms at all',
    find: '      const anyTerms = cashAnyTerms();',
    with: '      const anyTerms = true;' },

  /* ── the error boundaries ────────────────────────────────────────────────
     Every one of these restores a variant of the SAME failure: a throw in one
     render taking every render after it, with the panels keeping the markup
     they were born with. It reached a user once and looked like an empty app,
     not like a crash, which is why it survived a green suite. */

  /* ── money in, and the record of it ──────────────────────────────────────
     Revenue was bill rate × effort with no way to say an invoice had gone out.
     Two things now: a MODEL of when money is expected, and a RECORD of what
     actually happened. These break each half in turn. */

  { what: 'revenue: the curve collects the rate-card sum instead of the fee',
    find: '      const scale = rawTotal > 0 ? fee / rawTotal : 0;',
    with: '      const scale = 1;' },

  { what: 'revenue: a deposit is ADDED to the fee rather than taken out of it',
    find: '      const rest = 1 - (fee > 0 ? dep / fee : 0);',
    with: '      const rest = 1;' },

  { what: 'revenue: milestone billing smears across the work like a monthly',
    find: "      if (T.kind !== 'milestone') return cashPhaseSeg(s, f, c, T);",
    with: "      if (true) return cashPhaseSeg(s, f, c, { kind: 'monthly', days: T.days });" },

  { what: 'revenue: an unrecorded invoice is counted as an invoice for nothing',
    find: '    function taskInvoiced(t) { return (t && t.invoiced != null) ? (Number(t.invoiced) || 0) : null; }',
    with: '    function taskInvoiced(t) { return Number((t && t.invoiced) || 0); }' },

  { what: 'revenue: finished work that was never invoiced is not reported at all',
    find: '        if (done && inv == null && worth > 0) {',
    with: '        if (false) {' },

  { what: 'revenue: the cash-positive date is the FIRST crossing, not the last dip',
    find: '      for (let i = pts.length - 1; i >= 0; i--) {\n        if (pts[i].net < 0) break;\n        positive = pts[i].ms;\n      }',
    with: '      for (let i = 0; i < pts.length; i++) {\n        if (pts[i].net >= 0) { positive = pts[i].ms; break; }\n      }' },

  { what: 'revenue: a receipt leaks into actual cost, so CPI is computed on a mixed basis',
    find: '      if (t.autoActualCost === false) return Number(t.actualCost) || 0;   // manual override',
    with: '      if (t.paid != null) return Number(t.paid) || 0;\n      if (t.autoActualCost === false) return Number(t.actualCost) || 0;   // manual override' },

  /* ── the plan-vs-actual marks ─────────────────────────────────────────────
     Three columns of correct numbers that nobody could scan. A bar that
     disagrees with its own number is worse than no bar: it is read first and
     believed, and the number underneath is what gets doubted. */

  /* ── ticking something complete ───────────────────────────────────────────
     The ordinary one-gesture check-off, which is how most work actually gets
     recorded, and it was inventing the dates every other figure is measured
     from. */

  /* ── money in, on the way out ─────────────────────────────────────────────
     The record reached one panel and nothing that leaves the tool. */

  /* ── getting paid ─────────────────────────────────────────────────────────
     The archive carried invoices and receipts and nothing read them. */

  { what: 'bank: days-to-pay is a mean, so one chased invoice moves the headline',
    find: "      const med = arr => {\n        if (!arr.length) return null;\n        const v = arr.slice().sort((a, b) => a - b);\n        return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;\n      };",
    with: "      const med = arr => arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null;" },

  { what: 'bank: an outstanding invoice counts as paid in zero days',
    find: "      const paidRows = rows.filter(r => Number.isFinite(Number(r.daysToPay)) && r.daysToPay != null);",
    with: "      const paidRows = rows.map(r => Object.assign({}, r, { daysToPay: Number(r.daysToPay) || 0 }));" },

  { what: 'bank: what is still owed is reported as collected',
    find: "      out.collectedPct = out.invoiced > 0 ? Math.round(100 * out.received / out.invoiced) : null;",
    with: "      out.collectedPct = out.invoiced > 0 ? 100 : null;" },

  { what: 'bank: the slowest payer is listed last, where nobody reads it',
    find: "        max: Math.max.apply(null, v) })).sort((a, b) => b.median - a.median);",
    with: "        max: Math.max.apply(null, v) })).sort((a, b) => a.median - b.median);" },

  { what: 'bank: the payment history is computed and never drawn',
    find: "      host.innerHTML = head + hist + bankCalHtml() + bankPaymentHtml() + cards",
    with: '      host.innerHTML = head + hist + bankCalHtml() + cards' },

  { what: 'bank: an empty book is laid out as measured zeros',
    find: "      if (!P.invoicedN) {",
    with: '      if (false) {' },

  { what: 'bank: the billing-discipline cut is presented as payment behaviour',
    find: "          + '. This is your own billing discipline, not anybody\\'s payment behaviour — the company on a record '\n          + 'is whoever DID the work, not whoever pays for it.</p>'",
    with: "          + '.</p>'" },

  { what: 'client: a lint finding carries money into the request body in screen-share mode',
    find: "        const redact = v => safe ? String(v).replace(/[$£€]\\s?[\\d][\\d,]*(\\.\\d+)?/g, '(withheld)') : v;",
    with: '        const redact = v => v;' },

  { what: 'client: the receivables export drops every activity nobody has invoiced',
    find: '      const rows = receivablesRows();\n      const out = [',
    with: '      const rows = receivablesRows().filter(r => r.invoiced != null);\n      const out = [' },

  { what: 'client: unbilled work is folded into the outstanding total, overstating the book',
    find: "      out.push(['TOTAL outstanding', '', '', '', '', '', '', '', '', '', rec.billedUnpaid.toFixed(0)]);",
    with: "      out.push(['TOTAL outstanding', '', '', '', '', '', '', '', '', '', (rec.billedUnpaid + rec.doneUnbilled).toFixed(0)]);\n      out.push(['x']);" },

  { what: 'client: the receivables export loses how long a receipt has been outstanding',
    find: "          if (!isNaN(d0.getTime())) daysOut = Math.max(0, calDaysBetween(stripTime(d0), stripTime(new Date())));",
    with: '          daysOut = \'\';' },

  { what: 'client: the status report never says what has been invoiced',
    find: '        ${baseLine}${costLine}${moneyInLine}${overLine}',
    with: '        ${baseLine}${costLine}${overLine}' },

  { what: 'client: client-safe mode prints what the client has not been billed for',
    find: "      const moneyInLine = (clientSafeReports || !recIn || (!recIn.doneUnbilledN && !(recIn.billedUnpaid > 0)))",
    with: "      const moneyInLine = (false || !recIn || (!recIn.doneUnbilledN && !(recIn.billedUnpaid > 0)))" },

  /* SUPPRESSES the finding rather than renaming its label. The first version
     changed area to '_UnbilledDelivery' and survived — correctly: the check
     matches on what the finding SAYS, so renaming a label is a no-op against
     that property, and a mutant that changes nothing observable reports a hole
     that is not there. */
  { what: 'client: unbilled delivery is not a health finding',
    find: '        if (rec.doneUnbilledN) {',
    with: '        if (false) {' },

  { what: 'check-off: the started rule pre-empts the finished one, so nothing is back-dated',
    find: "      if (pct > 0 && prevPct <= 0 && !t.actualStart && !completing) { t.actualStart = today; t.autoActualStart = true; }",
    with: "      if (pct > 0 && prevPct <= 0 && !t.actualStart) { t.actualStart = today; t.autoActualStart = true; }" },

  { what: 'check-off: a five-day activity is recorded as starting and finishing the same day',
    find: '          const back = Math.max(0, Math.round(durD) - 1);',
    with: '          const back = 0;' },

  { what: 'check-off: the observed finish is back-dated too, so nothing is anchored to today',
    find: "        if (!t.actualFinish) { t.actualFinish = today; t.autoActualFinish = true; }\n        /* A FIVE-DAY ACTIVITY",
    with: "        if (!t.actualFinish) { t.actualFinish = fmtISO(subWorkingDays(new Date(), 3, getHolidaySet())); t.autoActualFinish = true; }\n        /* A FIVE-DAY ACTIVITY" },

  { what: 'check-off: an inferred start is presented as a recorded one',
    find: '          t.actualStartInferred = back > 0;      // said out loud on the panel',
    with: '          t.actualStartInferred = false;' },

  { what: 'check-off: work marked complete with no dates at all is not reported',
    find: '      cont.innerHTML = `${banner}${undatedCompletionsHtml()}${completionReviewHtml()}',
    with: '      cont.innerHTML = `${banner}${completionReviewHtml()}' },

  { what: 'revenue: the funding gap is stated in words and never drawn',
    find: "            bits.push(ptrCashSvg(pos)\n              + '<p class=\"ptr-mi-line\">Billed '",
    with: "            bits.push('' \n              + '<p class=\"ptr-mi-line\">Billed '" },

  { what: 'revenue: the cash chart is scaled non-uniformly and smears its labels',
    find: "      return '<svg class=\"mi-svg\" viewBox=\"0 0 ' + W + ' ' + H + '\" role=\"img\" '",
    with: "      return '<svg class=\"mi-svg\" preserveAspectRatio=\"none\" viewBox=\"0 0 ' + W + ' ' + H + '\" role=\"img\" '" },

  { what: 'revenue: the cash chart draws one side of the zero line only',
    find: "        + '<path d=\"' + areaTo() + '\" class=\"mi-area mi-area-dn\" clip-path=\"url(#' + uid + 'b)\"/>'",
    with: "        + ''" },

  { what: 'chart: over-plan rows draw no overrun, so over and under look the same',
    find: "          + (over > 0 ? '<i class=\"pv-over' + (clipped ? ' pv-over-clip' : '') + '\" style=\"width:' + over + 'px\"></i>' : '')",
    with: "          + ''" },

  { what: 'chart: the meter fills the track in the under-plan colour when it is over',
    find: "          + '<i class=\"pv-fill' + (r > 1.001 ? ' pv-fill-over' : '') + '\" style=\"width:' + fill + 'px\"></i></span>'",
    with: "          + '<i class=\"pv-fill\" style=\"width:' + fill + 'px\"></i></span>'" },

  { what: 'chart: early and late are drawn on the same side of the centre line',
    find: "        const late = days > 0;",
    with: '        const late = true;' },

  { what: 'chart: the bars ship with no key, so the geometry is a guess',
    find: '        <p class="help-text pv-keyrow">',
    with: '        <p class="help-text pv-keyrow" style="display:none">' },

  { what: 'form: a decision cannot record which option was taken',
    find: "      const isDec = (document.getElementById('rType') || {}).value === 'Decision';\n      row.style.display = isDec ? '' : 'none';",
    with: "      const isDec = false;\n      row.style.display = isDec ? '' : 'none';" },

  { what: 'form: options with none marked as taken are accepted in silence',
    find: "          ? '<b style=\"color:var(--warn)\">' + filled.length + ' option' + (filled.length === 1 ? '' : 's')\n            + ' and none marked as taken.</b>",
    with: "          ? '<b>' + filled.length + ' option' + (filled.length === 1 ? '' : 's')\n            + ' recorded.</b>" },

  { what: 'form: the why chain loses which option was taken on save',
    find: "        chosen: document.getElementById('rType').value === 'Decision' ? raidOptionsRead().chosen : null,",
    with: '        chosen: null,' },

  { what: 'form: the why chain is written by the editor and dropped by the file',
    find: '        whys: raidWhysRead(),',
    with: '        whys: [],' },

  { what: 'form: each why repeats the original question instead of the answer above it',
    find: "      return 'And why did THAT happen? — “' + q + '”';",
    with: "      return 'And why did THAT happen?' + (q ? '' : '');" },

  /* the trail turns back into editable rows, which is the regression that
     matters: the moment more than one why is answerable at once it stops being
     an interview and becomes a form, and a form gets five restatements of the
     same sentence. A mutant that merely moved the step index was a no-op — the
     renderer still drew one card — and is not listed, because a mutant that
     changes nothing observable reports a hole that is not there. */
  { what: 'form: the why wizard makes every step answerable at once',
    find: "          + '<span class=\"why-past-t\">' + escapeHtml(t) + '</span>'",
    with: "          + '<input class=\"mini-inp why-past-t\" value=\"' + escapeHtml(t) + '\">'" },

  { what: 'form: the wizard never says which step the reader is on',
    find: "        + '<div class=\"why-head\"><span class=\"why-step\">Step ' + (whyState.step + 1) + ' of up to ' + WHY_MAX",
    with: "        + '<div class=\"why-head\"><span class=\"why-step\">Why' + '' + ('' + WHY_MAX).slice(1)" },

  { what: 'form: concluding the chain drops the answer it was concluding',
    find: '    function raidWhyFinish() {\n      raidWhyCommit();',
    with: '    function raidWhyFinish() {' },

  { what: 'form: the trail of answers already given is not shown',
    find: "      const trail = whyState.chain.slice(0, whyState.done ? whyState.chain.length : whyState.step)",
    with: "      const trail = [].slice.call([], 0, 0)" },

  /* the objection this replaces was written against the LIST version of the why
     chain, where a reader could type five answers and never draw a conclusion.
     The wizard cannot reach that state — concluding fills the root cause from
     the last link — so the property moved with the design: the conclusion has
     to actually be filled, and the anchor now points at the line that fills it.
     Reported as a SKIP rather than quietly matching nothing. */
  { what: 'form: concluding a chain leaves the root cause empty',
    find: '      if (!whyState.root) whyState.root = last;',
    with: '      if (false) whyState.root = last;' },

  { what: 'form: the log shows the entry and hides the analysis behind it',
    find: '          <td style="font-weight:600">${escapeHtml(r.title)}${raidTitleSubHtml(r)}</td>',
    with: '          <td style="font-weight:600">${escapeHtml(r.title)}</td>' },

  { what: 'form: a Decision has no way to record how it turned out',
    find: "      Decision: [\n        { v: 'stands',     lbl: 'Still stands',            short: 'stands',     explains: true },",
    with: "      _Decision: [\n        { v: 'stands',     lbl: 'Still stands',            short: 'stands',     explains: true }," },

  { what: 'form: a decision that still stands is painted as a fault',
    find: "      if (r.type === 'Decision') return false;",
    with: "      if (r.type === 'Decision' && false) return false;" },

  { what: 'form: the outcome question asks a decision whether it happened',
    find: "      if (type === 'Decision') return 'Did it stand?';",
    with: "      if (type === 'Decision') return 'Did it happen?';" },

  { what: 'boundary: a failing render rethrows, so the tab dies at the first throw',
    find: "        try { console.error('[render boundary] ' + label, e); } catch (e2) {}\n        return false;",
    with: "        try { console.error('[render boundary] ' + label, e); } catch (e2) {}\n        throw e;" },

  { what: 'boundary: the failure is caught and the panel is never told, so it shows what it held before',
    find: '        try { if (host) renderFailInto(host, label, e); } catch (e2) {}',
    with: '        try { if (false) renderFailInto(host, label, e); } catch (e2) {}' },

  { what: 'boundary: nothing is said at the top of the page, so a failure on another tab is invisible',
    find: '        try { paintRenderBanner(); } catch (e2) {}\n        // and into the console',
    with: '        try { void 0; } catch (e2) {}\n        // and into the console' },

  { what: 'boundary: the tab switch goes back to swallowing one of its renders',
    find: "        guardRender('renderBank', renderBank);",
    with: '        try { renderBank(); } catch (e) {}' },

  { what: 'boundary: a throw in the first of eight renders costs the seven after it and the save',
    find: "      guardRender('renderTaskTable', renderTaskTable);",
    with: '      renderTaskTable();' },

  { what: 'boundary: a throw inside the schedule pass escapes ensureCalculated exactly as it first did',
    find: "      if (!guardRender('recompute', () => { ok = recompute(); })) return false;",
    with: '      ok = recompute();' },

  { what: 'boundary: a host id that is not in the document, so the notice is written nowhere',
    find: "      renderTaskTable: 'taskTableWrap'",
    with: "      renderTaskTable: 'taskTableBody'" },

  { what: 'boundary: the notice blanks its host, destroying the element the retry draws into',
    find: "      host.insertAdjacentHTML('afterbegin', renderFailHtml(label, err, stale));",
    with: '      host.innerHTML = renderFailHtml(label, err, stale);' },

  /* ── the five checks with no evidence they can fail ───────────────────────
     A hundred and three mutants, and five of the twenty-two checks had never
     been the one to go red: golden-reference, client-facing, cross-surface,
     schedule and task-editor. That is not proof they are broken — a mutant
     stops at the FIRST check that notices, and something earlier in the running
     order usually did. But it is the absence of proof, and the whole premise of
     this file is that an unexercised check is worth nothing until it has failed
     once on purpose.

     So each of these targets a region that belongs to one of those five, and
     LIKELY points at it, so that check runs first and the verdict names it.
     One of them found a real hole on the way in: schedule-sweep holds four
     dependency types and every committed fixture is FS, so three of its four
     branches had never executed. That check now constructs the links. */

  { what: 'reference: the milestone convention adds a day and the panel stops saying why',
    find: '            if (!planEndsOnMilestone()) return \'\';',
    with: '            if (true) return \'\';' },

  { what: 'client: client-safe mode prints the money it exists to withhold',
    find: "      const costLine = clientSafeReports ? '' : (cost > 0 || projectBudget > 0)",
    with: "      const costLine = false ? '' : (cost > 0 || projectBudget > 0)" },

  { what: 'client: a test case whose audience nobody can determine is called client-facing',
    find: "      return s ? storyAudience(s) : 'unclassified';",
    with: "      return s ? storyAudience(s) : 'client';" },

  { what: 'client: the RAID export silently drops the first entry',
    find: '      raid.forEach(r => rows.push([r.type, r.title, r.probability, r.impact,',
    with: '      raid.slice(1).forEach(r => rows.push([r.type, r.title, r.probability, r.impact,' },

  { what: 'card: the Budget pair and its delta go back to different references',
    find: "          ${card('Budget', fmtMoney(pvAt(stripTime(new Date()).getTime())) + ' due by today', fmtMoney(actCostAll),",
    with: "          ${card('Budget', fmtMoney(costRef) + ' envelope', fmtMoney(actCostAll)," },

  /* A mutant that is NOT here: silencing the Schedule card's count of
     activities off their own dates. cross-surface compares that count against
     the BAR's, and the bar only prints one in the projVar ≠ 0 wording — on
     crm-rollout the finish is held, so both take their other branch and there
     is nothing to disagree about. The mutant survives for want of a fixture,
     not for want of a check, and listing it would report a permanent false
     hole. The card's colour is the reachable half of the same card. */

  { what: 'card: the Budget card paints the project red while the verdict does not',
    find: "      const budTone = bvCard.tone === 'bad' ? 1 : bvCard.tone === 'good' ? -1 : 0;",
    with: '      const budTone = 1;' },

  { what: 'network: an SS link is scheduled as though it were FS',
    find: "          const L = p.lag;\n          switch (p.type) {\n            case 'SS': s = es[p.id] + L; break;",
    with: "          const L = p.lag;\n          switch (p.type) {\n            case 'SS': s = ef[p.id] + L; break;" },

  { what: 'network: contingency is subtracted, so the committed date precedes the CPM finish',
    find: '      const committedUnits = cpmUnits + contingencyUnits;',
    with: '      const committedUnits = cpmUnits - contingencyUnits;' },

  { what: 'network: the confidence a date carries is reported as its complement',
    find: '        return n / mcResult.durations.length * 100;',
    with: '        return 100 - n / mcResult.durations.length * 100;' },

  { what: 'editor: the live preview weights the estimate differently from the plan it writes into',
    find: '      return (mLastEstUnits = pertTE(o, m, p));',
    with: '      return (mLastEstUnits = (o + 3 * m + p) / 5);' },

  { what: 'editor: a half-typed estimate collapses the readout to zero instead of holding',
    find: '      if (![o, m, p].every(v => Number.isFinite(v) && v >= 0)) return mLastEstUnits;',
    with: '      if (![o, m, p].every(v => Number.isFinite(v) && v >= 0)) return 0;' },

  { what: 'boundary: the banner cannot be dismissed, so it sits there for the rest of the session',
    find: '        + \'<button class="btn-sm btn-secondary" onclick="renderFailures=[];paintRenderBanner()">Dismiss</button>\';',
    with: "        + '';" },

  { what: 'boundary: a panel that has since drawn correctly keeps saying it could not be drawn',
    find: '      try { renderFailClear(label); } catch (e2) {}\n      return true;',
    with: '      try { void 0; } catch (e2) {}\n      return true;' },

  /* ── the four surfaces added after a reader used them ───────────────────── */

  { what: 'accrual: the spend shape moves the TOTAL, not only when it lands',
    find: '        if (end > cur) out.push({ s: cur, f: end, c: c * w[i] / tot });',
    with: '        if (end > cur) out.push({ s: cur, f: end, c: c * w[i] / (tot - 1) });' },

  { what: 'accrual: the spend shape is accepted, stored, and then ignored by the curve',
    find: '        shapeSpans(s, f, c1, curveOf(t)).forEach(sp =>',
    with: "        shapeSpans(s, f, c1, 'even').forEach(sp =>" },

  { what: "accrual: back-loaded and front-loaded are the same curve, drawn the wrong way round",
    find: "      back:  { lbl: 'Back-loaded', w: [1, 2, 3, 4],",
    with: "      back:  { lbl: 'Back-loaded', w: [4, 3, 2, 1]," },

  { what: 'curve: the readout names three activities and hides the rest with no way to reach them',
    find: '      const cut = (ptrScAllMs != null && ptrScAllMs === ms) ? rows.length : 3;',
    with: '      const cut = 3;' },

  { what: 'curve: an expansion made at one date is presented as the answer at every later one',
    find: '      if (ptrScAllMs != null && ptrScAllMs !== ms) ptrScAllMs = null;',
    with: '      if (false) ptrScAllMs = null;' },

  { what: 'navigation: collapse-to-a-level on the activity list is drawn but wired to nothing',
    find: '<span class="seg" id="taskCollapseSeg"><button class="btn-sm" onclick="setCollapseLevel(0)"',
    with: '<span class="seg" id="taskCollapseSeg"><button class="btn-sm" onclick="void 0"' },

  /* Decision, not Issue. No fixture in this repo carries an Issue entry, so a
     mutant that collapsed Issue into Risk would SURVIVE and be reported as a
     hole in the sweep that isn't one — the fixture-cannot-reach-the-branch
     failure this directory has a whole probe for. Decision and Assumption are
     both present, and they are also the two words clients most often use to
     mean each other, which is the pair the colours exist to separate. */
  { what: 'navigation: two RAID kinds that mean opposite things are drawn identically',
    find: "      Decision:   { cls: 'raid-k-dec', sub: 'settled',",
    with: "      Decision:   { cls: 'raid-k-assum', sub: 'relied on'," },

  { what: 'navigation: the RAID kind chip says the word and drops the definition behind it',
    find: "        + escapeHtml(r.type + ' — ' + k.def) + '\">' + r.type + '</span>'",
    with: "        + escapeHtml(r.type) + '\">' + r.type + '</span>'" },

  /* ── acceptance at the level a client actually signs, and the change-order
        life somebody has to be able to steer ───────────────────────────────── */

  { what: 'baseline history: a phase sign-off silently covers every story in the plan',
    find: "      if (so.scope === 'story') return { rows: stories.filter(s => String(s.id) === so.ref), traced: true };",
    with: "      if (so.scope === 'story') return { rows: stories, traced: true };" },

  { what: 'baseline history: a story re-traced out of a signed phase leaves without a trace',
    find: "          if (!live || !signoffCoversNow(so, live))",
    with: "          if (false)" },

  { what: 'baseline history: the sign-off record prints the id it stored instead of the name',
    find: "        return t ? ((t.wbs ? t.wbs + ' ' : '') + t.name)",
    with: "        return t ? String(ref)" },

  { what: 'baseline history: superseded is a one-way door again',
    find: "                   rejected: ['accepted'], superseded: ['accepted', 'rejected'] }[st] || [];",
    with: "                   rejected: ['accepted'], superseded: [] }[st] || [];" },

  { what: 'baseline history: withholding a line price also removes it from the total',
    find: "      const lineSum = c.lineSum == null ? diff.reduce((s, x) => s + (x.priceDelta || 0), 0) : c.lineSum;",
    with: "      const lineSum = shownSum;" },

  { what: 'baseline history: the change-order history goes back to being unopenable rows',
    find: "          <tbody>${coLog.map(c => `<tr class=\"co-row\" onclick=\"coOpen('${ekJs(c.no)}')\"",
    with: "          <tbody>${coLog.map(c => `<tr" },

  { what: 'baseline history: generating the SOW throws away the document it replaces',
    find: "      sowPushVersion('regenerated from the plan');",
    with: "      sowVersions = [];" },

  { what: 'baseline history: trimming the SOW history drops the original instead of the middle',
    find: "        sowVersions.splice(1, sowVersions.length - SOW_VERSION_CAP);",
    with: "        sowVersions.splice(0, sowVersions.length - SOW_VERSION_CAP);" },

  { what: 'baseline history: a project that already had a SOW loads with an empty history',
    find: '      if (sowDraft && !sowVersions.length) {',
    with: '      if (false) {' },

  { what: 'baseline history: nothing in the toolbar says the SOW has a version history',
    find: "        btn.textContent = '🕓 History' + (sowVersions.length ? ' (' + sowVersions.length + ')' : '');",
    with: "        btn.textContent = '🕓 History';" },

  /* The writer and the reader disagreeing about the record's shape. Restored
     as a mutant because the real one was found by UNDO rather than by anything
     about the SOW, and a defect that can only be caught sideways is one field
     away from not being caught at all. */
  { what: 'baseline history: a SOW version does not survive a save and reload unchanged',
    find: "      const v = sowVersionNorm({ n: nextSowNo++, at: fmtISO(new Date()),",
    with: "      const v = ({ n: nextSowNo++, at: fmtISO(new Date())," },

  /* The role field back at the width it was built for — a NUMBER — with the
     value no longer in the title. Both halves, because either one alone leaves
     the value readable: a narrow box whose title carries the text is honest,
     and a wide box needs no title. It is the combination that shows a reader a
     fragment and tells them nothing about it. */
  /* The reported defect itself, and the over-correction that would replace it.
     The second is the more interesting mutant: clamping EVERY allocation to
     capacity looks like a fix and silently rewrites an instruction the plan
     gave on purpose. */
  { what: 'criteria: a part-time person is booked full time by the plan that states their capacity',
    find: '          if (t._unitsAuto && t.units > cap) { t.units = cap; alloc.lowered++; alloc.people.add(own); }',
    with: '          if (false) { t.units = cap; alloc.lowered++; alloc.people.add(own); }' },

  { what: 'criteria: an allocation the plan asked for explicitly is clamped to capacity anyway',
    find: '          if (t._unitsAuto && t.units > cap) { t.units = cap; alloc.lowered++; alloc.people.add(own); }\n          else if (!t._unitsAuto && t.units > cap) { alloc.keptOver++; alloc.people.add(own); }',
    with: '          if (t.units > cap) { t.units = cap; alloc.lowered++; alloc.people.add(own); }' },

  { what: 'criteria: attendee allocations are hard-coded past whatever the plan said',
    find: '            return { name: an, units: given ? au : 100, _unitsAuto: !given };',
    with: '            return { name: an, units: 100, _unitsAuto: true };' },

  { what: 'resource load: a day somebody never works is treated as an ordinary working day',
    find: '          const offToday = !resWorksOn(R.name, new Date(iso + \'T00:00:00\').getDay());',
    with: '          const offToday = false;' },

  { what: 'resource load: an unset working week means the person works NO days',
    find: "      if (!Array.isArray(raw) || !raw.length) return null;      // follows the project",
    with: '      if (!Array.isArray(raw)) return new Set();' },

  /* NOT A MUTANT: breaking the hydrate coercion `r.workDays = w.length ? w :
     null`. It survives everything, and correctly — resWorkDays guards the same
     condition on the read side, so an empty array that reaches storage still
     resolves to "follows the project". The mutant above proves the read-side
     guard is load-bearing; the write-side one is belt and braces and there is
     no observable defect to plant. Listing it anyway would report a permanent
     hole that is not one, which is the failure mode this file learned about the
     hard way. */

  { what: 'heatmap: a day off and a day somebody never works are described identically',
    find: "            : isOff ? 'does not work ' + ['Sundays','Mondays','Tuesdays','Wednesdays','Thursdays','Fridays','Saturdays'][dd.getDay()]",
    with: "            : isOff ? 'PTO'" },

  { what: 'effort: a roster role is cut off by its own box with the full text nowhere',
    find: ['    .rl-role { width: 100%; min-width: 17rem; }',
           "title=\"${escapeHtml((resources[name] || {}).role ? (resources[name] || {}).role + ' — ' : '')}What they do on this engagement"],
    with: ['    .rl-role { width: 64px; min-width: 64px; }',
           'title="What they do on this engagement'] },

  /* The input/output map. Its whole value is that it is a VIEW of the plan
     rather than a copy, and that it says which deliverables are too vague to be
     accepted against. Each mutant takes one of those away. */

  { what: 'io map: "Analysis" and "Documentation" pass as deliverables',
    find: '      if (DELIV_CATEGORY.test(d))',
    with: '      if (false)' },

  { what: 'io map: a milestone is flagged for handing over no artefact',
    find: "      if (t.milestone) return { level: 'na', why: '' };",
    with: "      if (false) return { level: 'na', why: '' };" },

  { what: 'io map: inputs are a copy of the predecessor NAME, not a view of its deliverable',
    find: "        .forEach(p => out.push({ kind: 'upstream', text: String(p.deliverable || '').trim() || p.name, from: p }));",
    with: "        .forEach(p => out.push({ kind: 'upstream', text: p.name, from: p }));" },

  { what: 'io map: the predecessor link is read as a task and yields nothing',
    find: '        .map(pd => tasks.find(x => Number(x.id) === Number(pd.id)))\n        .filter(p => p && !p.milestone)   // a milestone is a date; it hands over nothing',
    with: '        .map(pd => pd)\n        .filter(p => p && !p.milestone)   // a milestone is a date; it hands over nothing' },

  { what: 'io map: the dictionary computes the chain and never draws it',
    find: '<th title="What this activity consumes: ↤ the deliverable of an activity it waits for, ◇ a client dependency from a story, · an input stated on the activity itself">Inputs</th>',
    with: '<th>Consumes</th>' },

  { what: 'io map: a stated input is dropped on save',
    find: "          parentId: t.parentId, description: t.description, deliverable: t.deliverable, inputs: t.inputs || '',",
    with: '          parentId: t.parentId, description: t.description, deliverable: t.deliverable,' },

  /* Duration versus effort. The distinction is the whole point, and every
     mutant here collapses it back — which is what the product did before. */

  { what: 'effort: planned effort ignores the allocation and equals the calendar span',
    find: '      return unitToWorkingDays(te) * ((u > 0 ? u : 100) / 100);',
    with: '      return unitToWorkingDays(te);' },

  { what: 'effort: a lone part-time person keeps only units/100 of the time they logged',
    find: '      return (Number(me.units) || 0) / tot;',
    with: '      return (Number(me.units) || 0) / 100;' },

  { what: 'effort: actual cost multiplies logged time by the allocation a second time',
    find: '      const labor = taskParticipants(t).reduce((sx, pr) => sx + (isClientResource(pr.name) ? 0 : getRate(pr.name) * days), 0);',
    with: '      const labor = taskParticipants(t).reduce((sx, pr) => sx + (isClientResource(pr.name) ? 0 : getRate(pr.name) * days * pr.units / 100), 0);' },

  { what: 'effort: the estimate bank files a calendar span against logged work',
    find: '        const est = workingDaysToUnit(plannedEffortDays(t));',
    with: '        const est = t.te || 0;' },

  { what: 'timesheet: planned hours are the span rather than the work',
    find: '          const planH = spanDays * (u / 100) * 8;',
    with: '          const planH = spanDays * 8;' },

  { what: 'timesheet: the weekly split does not add back to the activity total',
    find: '        const perDayPlan = r.planH / days.length;',
    with: '        const perDayPlan = r.planH;' },

  { what: 'wbs dictionary: the Work column repeats the duration',
    find: '            const e = plannedEffortDays(t);\n            return e > 0 ? escapeHtml(fmtDurCell(workingDaysToUnit(e))) : \'—\';',
    with: '            const e = unitToWorkingDays(t.te || 0);\n            return e > 0 ? escapeHtml(fmtDurCell(workingDaysToUnit(e))) : \'—\';' },

  { what: 'SOW: the section picker does nothing — every section prints anyway',
    find: "    function sowWants(key) { return !sowOffSet().has(String(key)); }",
    with: "    function sowWants(key) { return true; }" },

  { what: 'SOW: an excluded section leaves a gap in the numbering',
    find: "      const add = (key, title, body) => { if (body && sowWants(key)) secs.push({ key, title, body }); };",
    with: "      const add = (key, title, body) => { if (body) secs.push({ key, title, body: sowWants(key) ? body : '<!--x-->' }); };" },

  { what: 'SOW: a saved version does not record the shape it was written in',
    find: "                  label: String(label || ''), html: html, off: [...sowOffSet()],",
    with: "                  label: String(label || ''), html: html, off: []," },

  { what: 'RAID: the type tab shows every entry regardless of kind',
    find: "        if (raidTab !== 'all' && r.type !== raidTab) return false;",
    with: "        if (false) return false;" },

  { what: 'RAID: the text filter matches everything',
    find: "        return [r.title, r.mitigation, r.owner, r.description, r.rootCause]\n          .some(x => String(x || '').toLowerCase().indexOf(raidQ) >= 0);",
    with: "        return true;" },

  { what: 'RAID: near-duplicates are only found when byte-identical',
    find: "      return inter / Math.min(A.size, B.size);      // containment, so a longer restatement still matches",
    with: "      return a === b ? 1 : 0;" },

  { what: 'RAID: bulk delete removes only the first selected entry',
    find: "      raid = raid.filter(x => !raidSel.has(x.id));",
    with: "      const one9 = ids[0]; raid = raid.filter(x => x.id !== one9);" },

  { what: 'SOW: the version history mints a version on every RAID edit',
    find: "    function raidTouched() {\n      try {\n        if (sowSyncExclusions() < 0) return;\n        sowShowLive();",
    with: "    function raidTouched() {\n      try {\n        if (sowSyncExclusions() < 0) return;\n        sowPushVersion('exclusions changed'); sowShowLive();" },

  { what: 'SOW prose: "As a Independent Product Advisor"',
    find: "      return /^[aeiou]/i.test(String(word || '').trim()) ? 'an' : 'a';",
    with: "      return 'a';" },

  { what: 'SOW prose: "I want to a baseline scorecard"',
    find: "      return (STORY_NOUN_LEAD.has(first) || /^\\d/.test(String(want || '').trim())) ? 'I want' : 'I want to';",
    with: "      return 'I want to';" },

  { what: 'SOW: the effort column mixes hours and days down one column',
    find: "                  const num = v => (Math.abs(v - Math.round(v)) < 0.005 ? v.toFixed(1) : v.toFixed(2)) + ' ' + u2;",
    with: "                  const num = v => fmtDurText(v);" },

  { what: 'SOW panel: both history tabs show the same history',
    find: "          host.innerHTML = docHistTab === 'plan' ? versionChainHtml(true) : sowHistoryHtml();",
    with: "          host.innerHTML = sowHistoryHtml();" },

  { what: 'SOW panel: the selected history tab looks like the unselected one',
    find: "        el.className = 'btn-sm ' + (on ? 'btn-primary' : 'btn-secondary');",
    with: "        el.className = 'btn-sm btn-secondary';" },

  { what: 'SOW panel: the document is read through a letterbox again',
    find: "color:#1e293b;max-width:1080px;margin:0 auto\">",
    with: "color:#1e293b;max-width:420px\">" },

  { what: 'editor: the estimate form does not say what the estimate comes to',
    find: "      const work = unitToWorkingDays(te) * (u / 100);",
    with: "      const work = unitToWorkingDays(te);" },

  { what: 'SOW: the scope table quotes the calendar span as effort',
    find: "                    const work = workingDaysToUnit(plannedEffortDays(t));",
    with: "                    const work = Number(t.te) || 0;" },

  { what: 'SOW: filing an exclusion changes the log and not the document',
    find: "        const shown = sowSyncExclusions();\n        if (shown > 0) { sowPushVersion(n + ' exclusion' + (n === 1 ? '' : 's') + ' drafted'); sowShowLive(); }",
    with: "        const shown = -1;" },

  { what: 'SOW: the exclusion patch overwrites the boundary clause above it',
    find: "      sowDraft = sowDraft.slice(0, hd) + after.slice(0, bodyAt)\n        + clause + tail + after.slice(secEnd);",
    with: "      sowDraft = sowDraft.slice(0, hd) + after.slice(0, bodyAt) + tail + after.slice(secEnd);" },

  /* Effort vs schedule, the second sweep. Every one of these took te — a
     CALENDAR SPAN — as the estimate and compared it against logged WORK. */

  { what: 'plan vs actual: the Effort column estimates with the span',
    find: "        const planTe = plannedEffortUnit(t, hb);",
    with: "        const planTe = hb && t.baseTe != null ? t.baseTe : (t.te || 0);" },

  { what: 'plan vs actual: the Effort spent card totals spans',
    find: "      const planTeAll = sum(t => plannedEffortUnit(t));",
    with: "      const planTeAll = sum(t => t.te);" },

  { what: 'plan truth: the scope panel calls a sum of spans effort',
    find: "        const planTe = leaves.reduce((s, t) => s + plannedEffortUnit(t), 0);",
    with: "        const planTe = leaves.reduce((s, t) => s + (Number(t.te) || 0), 0);" },

  { what: 'cause of a miss: a part-time person on plan ranks as an overrun',
    find: "      const refD = plannedEffortDays(t, true);",
    with: "      const refD = unitToWorkingDays(Number(t.baseTe) > 0 ? Number(t.baseTe) : (Number(t.te) || 0));" },

  { what: 'variance CSV: the effort ratio divides logged work by the span',
    find: "        const est = plannedEffortUnit(t, hasBaseline());   // the work, which is what varies",
    with: "        const est = t.te || 0;   // the work, which is what varies" },

  { what: 'editor: a summary rolls up its leaves\u2019 spans and calls it effort',
    find: "          estTime: lv.reduce((s, x) => s + workingDaysToUnit(plannedEffortDays(x)), 0),",
    with: "          estTime: lv.reduce((s, x) => s + (+x.te || 0), 0)," },

  { what: 'baseline: the committed effort follows today\u2019s allocation',
    find: "        t.baseUnits = taskUnitsTotal(t);",
    with: "        t.baseUnits = null;" },

  { what: 'wbs dictionary CSV: the exported Work effort column repeats the span',
    find: "            const e = t.isSummary ? leafDescendants(t.id).reduce((a, x) => a + plannedEffortDays(x), 0) : plannedEffortDays(t);",
    with: "            const e = t.isSummary ? leafDescendants(t.id).reduce((a, x) => a + unitToWorkingDays(x.te || 0), 0) : unitToWorkingDays(t.te || 0);" },

  /* The four SOW-generation defects, each planted back. All four shipped in a
     document a client had already been sent, and none of them were visible in
     the skeleton DATA — they lived in the assembly, which is why the sweep that
     checked the data caught nothing. */

  /* The retainer. Its whole character is that the amount is contractual and the
     count is calendar, so every mutant here is the same mistake in a different
     place: letting the plan have a vote. */

  { what: 'retainer: the fixed period amount is scaled by how busy the period was',
    find: '          if (T.retainer > 0) { out.segs.push({ s: pay, f: pay + DAY, c: T.retainer }); out.placed += T.retainer; }',
    with: '          if (T.retainer > 0) { const c9 = T.retainer * (fee / Math.max(1, pers.length * T.retainer)); out.segs.push({ s: pay, f: pay + DAY, c: c9 }); out.placed += c9; }' },

  { what: 'retainer: a period with no work in it is not billed',
    find: '        for (let cur = s0; cur <= fin && out.length < 600; cur += 7 * DAY) out.push({ start: cur, n: out.length + 1 });',
    with: '        for (let cur = s0; cur <= fin && out.length < 600; cur += 7 * DAY) { if (lv.some(t => { const f2 = (ub ? t.baseFinish : t.finishDate) || t.finishDate; const s2 = (ub ? t.baseStart : t.startDate) || t.startDate; return s2 && f2 && stripTime(s2).getTime() <= cur + 6 * DAY && stripTime(f2).getTime() >= cur; })) out.push({ start: cur, n: out.length + 1 }); }' },

  { what: 'retainer: the gap between what is retained and what the work is priced at is reconciled away',
    find: '        out.retainerGap = out.scheduled - out.total;',
    with: '        out.total = out.scheduled; out.retainerGap = 0;' },

  { what: 'retainer: the contract does not say the period is owed whether or not it is used',
    find: "        ? 'This engagement is retained. The amounts below are payable for each period whether or not the period is fully utilised, and reserve the team\\'s availability for it.'",
    with: "        ? 'This engagement is retained.'" },

  { what: 'SOW: the trace columns cite story ids the document never prints',
    find: '      const kept = (ids || []).filter(id => printed.has(id));',
    with: '      const kept = (ids || []);' },

  { what: 'SOW: a story the contract relies on is left out of the appendix it points readers to',
    find: '        if ((s.nfrs || []).some(x => String(x).trim())) out.add(s.id);',
    with: '        if (false) out.add(s.id);' },

  { what: 'SOW: the appendix goes back to printing client-facing stories alone',
    find: '      return new Set(reqs.stories.filter(s => storyAudience(s) === \'client\' || ref.has(s.id)).map(s => s.id));',
    with: "      return new Set(reqs.stories.filter(s => storyAudience(s) === 'client').map(s => s.id));" },

  { what: 'SOW: a dependency traces to a delivery-side story the reader cannot look up',
    find: "            out.push({ text: String(x).replace(/^D:\\s*/i, ''), ref: printedIds.has(s.id) ? s.id : '' });",
    with: "            out.push({ text: String(x).replace(/^D:\\s*/i, ''), ref: s.id });" },

  { what: 'SOW: milestone billing names the milestones and states no amount against any of them',
    find: '          const amt = money.get(k) || 0;',
    with: '          const amt = 0;' },

  { what: 'SOW: the payment schedule totals less than the price the client is signing',
    find: '      [...money.keys()].sort((a, b) => a - b).forEach(k => {',
    with: '      [].forEach(k => {' },

  { what: 'SOW: with no billing arrangement recorded the terms ship as a finished clause',
    find: "      if (!pay || pay.kind === 'none' || !pay.rows.length) {",
    with: '      if (false) {' },

  { what: 'SOW: out of scope reads as a waiver rather than a limit',
    find: '        `<p style="font-size:13px">Only the work itemised in {{sec:scope}} is included in this Statement of Work. Anything not expressly listed there is out of scope,',
    with: '        `<p style="font-size:13px">No exclusions apply: all activities and deliverables are as defined in the scope table,' },

  { what: 'SOW: section numbers skip whenever an optional section is empty',
    find: '        `<h2 style="font-size:16px;margin:16px 0 6px">${i + 1}. ${s.title}</h2>${s.body}`).join(\'\');',
    with: '        `<h2 style="font-size:16px;margin:16px 0 6px">${secs.length > 9 ? i + 1 : i + 2}. ${s.title}</h2>${s.body}`).join(\'\');' },

  { what: 'SOW: a cross-reference points at a section number that does not exist',
    find: '      secs.forEach((s, i) => { numOf[s.key] = i + 1; });',
    with: '      secs.forEach((s, i) => { numOf[s.key] = i + 2; });' },

  { what: 'SOW: the price and the payment schedule go back to the basement',
    find: ["      add('commercial', 'Commercial Terms', d.price ? sowCommercialHtml(d, n, td, th) : '');",
           "      add('change', 'Change Control',"],
    with: ['      ;',
           "      add('commercial', 'Commercial Terms', d.price ? sowCommercialHtml(d, n, td, th) : '');\n      add('change', 'Change Control',"] },

  { what: 'change order: the activity lookup returns every order regardless of which it touched',
    find: '        const lines = (c.diff || []).filter(d => Number(d.id) === id);',
    with: '        const lines = (c.diff || []);' },

  { what: 'change order: the activity lookup quietly hides everything not yet accepted',
    find: '      return (coLog || []).map(c => {',
    with: "      return (coLog || []).filter(c => coState(c) === 'accepted').map(c => {" },

  { what: 'change order: the activity editor computes the change-order row and never shows it',
    find: "      row.style.display = html ? '' : 'none';\n      host.innerHTML = html;",
    with: "      row.style.display = 'none';\n      host.innerHTML = html;" },

  { what: 'change order: rejected-and-kept is stored the same as never-rejected again',
    find: '          c.scopeKept = true;',
    with: '          c.scopeKept = false;' },

  { what: 'change order: the unbillable-scope finding never clears once it is raised',
    find: "      if (next !== 'rejected') c.scopeKept = false;",
    with: '      if (false) c.scopeKept = false;' },

  { what: 'change order: kept scope is valued off the price movement, not off its lines',
    find: "      if ((c.diff || []).length) return c.diff.reduce((s2, d2) => s2 + (d2.priceDelta || 0), 0);",
    with: '      if ((c.diff || []).length) return 0;' },

  { what: 'change order: two accepted orders pricing the same line go unnoticed',
    find: '          if (!shared.length) continue;',
    with: '          if (shared.length >= 0) continue;' },

  { what: 'change order: overlap is matched on the activity alone, so every busy row is a finding',
    find: "      return new Set((c.diff || []).map(d => String(d.id) + '|' + String(d.field || '')));",
    with: "      return new Set((c.diff || []).map(d => String(d.id)));" },

  { what: 'baseline history: two SOW versions both claim to be the current one',
    find: '        if (sowVersions[i].html === sowDraft) { curIdx = i; break; }',
    with: '        if (sowVersions[i].html === sowDraft) { curIdx = i; }' },

  /* A MUTANT CAN GO STALE IN MEANING, NOT ONLY IN ITS ANCHOR, and the engine
     reports both as SURVIVED. This one used to plant a getter in the object
     literal so `cos` read the live log; a later refactor put a normaliser
     between that literal and the stored record, and the normaliser COPIES the
     array — so the getter fired once, froze into a plain array, and the mutant
     stopped expressing anything. It survived because there was nothing to
     catch, which reads identically to a hole in the suite and is the opposite.
     Moved to the READER, where the defect it names actually lives: answering
     "which SOW versions contain this change order" from today's log rather than
     from what each version recorded. */
  { what: 'baseline history: a past SOW claims every change order accepted since it was written',
    find: "      return sowVersions.filter(v => sowVersionCoRead(v).nos.some(x => String(x) === String(no)));",
    with: "      return sowVersions.filter(() => coAccepted().some(c => String(c.no) === String(no)));" },

  { what: 'baseline history: the SOW never says which change orders it already incorporates',
    find: "        ${(() => { const a = coAccepted(); return a.length",
    with: "        ${(() => { const a = []; return a.length" },

  { what: 'baseline history: the two documents share one box with no way between them',
    find: "      strip.innerHTML = tabs.length < 2 ? '' : '<span class=\"seg\">'",
    with: "      strip.innerHTML = tabs.length < 99 ? '' : '<span class=\"seg\">'" },
];

/* Filtered AFTER the array is written, never inside it, so the anchor audit and
   the "N of M" arithmetic below both speak about the run that actually
   happened. A filtered run says so in its own summary rather than reading as a
   clean full pass. */
const SELECTED = ONLY.length
  ? MUTANTS.filter(m => ONLY.some(o => m.what.toLowerCase().indexOf(o.toLowerCase()) >= 0))
  : MUTANTS;

/* harness-meta.js is deliberately NOT in this list. It reads the CHECK files and
   resolves the names they call against the loaded app, so a mutant that changes
   an identity in the product tells it nothing — it would add five seconds to
   each of two hundred-odd runs and never once be the one to go red. Its
   own ability to fail is proven differently and better: it plants both defects
   it hunts into synthetic files on every run and requires itself to name them,
   so that proof happens on every commit rather than only under FULL=1. */
const CHECKS = QUICK ? ['run-test-plan.js']
  : ['run-test-plan.js', 'golden-reference.js', 'contradiction-sweep.js',
     'schedule-sweep.js', 'drawn-surfaces-sweep.js', 'pricing-sweep.js',
     'resourcing-sweep.js', 'persistence-sweep.js', 'export-sweep.js', 'undo-sweep.js', 'baseline-sweep.js', 'cross-surface-sweep.js', 'task-editor-sweep.js',
     'client-facing-sweep.js', 'dialog-sweep.js', 'chart-reconciliation-sweep.js',
     'bank-sweep.js', 'corrupt-file-sweep.js', 'dynamic-prose-sweep.js', 'navigation-sweep.js',
     'error-boundary-sweep.js', 'revenue-sweep.js'];

/* Which check is EXPECTED to notice. This is a running order, not a shortcut:
   if the named check does not go red the mutant still walks every other one, so
   a genuine hole is still found and still reported by name. It exists because
   the naive order made this file unfinishable — a mutant caught by the last of
   fourteen checks costs ninety seconds, and twenty-six of those exceeded ten
   minutes and were killed before ever printing a verdict. A check nobody can
   afford to run is a check that does not run. */
const LIKELY = {
  'billing CSV': 'export-sweep.js', 'Jira CSV': 'export-sweep.js',
  'save/load': 'persistence-sweep.js', 'undo:': 'undo-sweep.js',
  'baseline:': 'baseline-sweep.js', 'change order:': 'baseline-sweep.js',
  'criticality': 'drawn-surfaces-sweep.js', 'resource load': 'resourcing-sweep.js',
  'margin': 'pricing-sweep.js', 'wizard:': 'dialog-sweep.js',
  'budget bar:': 'chart-reconciliation-sweep.js', 'catch-up:': 'chart-reconciliation-sweep.js',
  'test plan:': 'run-test-plan.js', 'baseline history:': 'baseline-sweep.js',
  'bank:': 'bank-sweep.js', 'handoff:': 'bank-sweep.js', 'curve:': 'navigation-sweep.js',
  'drill-in:': 'chart-reconciliation-sweep.js', 'backup:': 'persistence-sweep.js', 'accrual:': 'chart-reconciliation-sweep.js', 'cash:': 'chart-reconciliation-sweep.js', 'readout:': 'contradiction-sweep.js',
  'blocked tab:': 'dialog-sweep.js', 'changes panel:': 'drawn-surfaces-sweep.js',
  'corrupt file:': 'corrupt-file-sweep.js', 'ring:': 'drawn-surfaces-sweep.js',
  'envelope:': 'chart-reconciliation-sweep.js', 'scope:': 'chart-reconciliation-sweep.js',
  'form:': 'drawn-surfaces-sweep.js', 'drill-in:': 'chart-reconciliation-sweep.js',
  'prose:': 'dynamic-prose-sweep.js', 'heatmap:': 'resourcing-sweep.js',
  'navigation:': 'navigation-sweep.js', 'worklist:': 'navigation-sweep.js',
  'boundary:': 'error-boundary-sweep.js', 'revenue:': 'revenue-sweep.js',
  'chart:': 'drawn-surfaces-sweep.js', 'check-off:': 'baseline-sweep.js',
  'reference:': 'golden-reference.js', 'client:': 'client-facing-sweep.js',
  'card:': 'cross-surface-sweep.js', 'network:': 'schedule-sweep.js',
  'editor:': 'task-editor-sweep.js',
  'criteria:': 'ai-boundary-sweep.js', 'effort:': 'resourcing-sweep.js', 'bank:': 'bank-sweep.js', 'handoff:': 'bank-sweep.js', 'curve:': 'navigation-sweep.js',
  'drill-in:': 'chart-reconciliation-sweep.js', 'backup:': 'persistence-sweep.js', 'accrual:': 'chart-reconciliation-sweep.js', 'cash:': 'chart-reconciliation-sweep.js'
};
const orderFor = m => {
  const hit = Object.keys(LIKELY).find(k => m.what.indexOf(k) === 0 || m.what.indexOf(k) >= 0);
  const first = hit ? LIKELY[hit] : null;
  return first ? [first].concat(CHECKS.filter(c => c !== first)) : CHECKS.slice();
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ptr-mut-'));

function runAsync(script, appFile) {
  return new Promise(resolve => {
    const ch = spawn(process.execPath, [path.join(__dirname, script)],
      { cwd: ROOT, env: Object.assign({}, process.env, { APP_FILE: appFile }), stdio: 'pipe' });
    let out = '';
    ch.stdout.on('data', d => out += d);
    ch.stderr.on('data', d => out += d);
    const t = setTimeout(() => { try { ch.kill('SIGKILL'); } catch (e) {} }, 180000);
    ch.on('close', code => { clearTimeout(t); resolve(code === 0 ? null : (out.trim() || 'exited non-zero')); });
  });
}

/* One mutant may need more than one edit. A defect is not always one line: the
   wizard's layout regression was a flex container and a shrink rule, and either
   half alone leaves a page that still fits, so a single-edit mutant would
   SURVIVE and be reported as a hole in the sweep that isn't one. `find`/`with`
   therefore accept arrays, applied in order, each still required to match
   exactly once — the anchor check is the whole reason a mutant can be trusted
   to have applied at all. */
async function judge(m, i) {
  const finds = [].concat(m.find), withs = [].concat(m.with);
  if (finds.length !== withs.length) return { m, skipped: true,
    why: 'it lists ' + finds.length + ' anchor(s) and ' + withs.length + ' replacement(s)' };
  let src = SRC;
  for (let k = 0; k < finds.length; k++) {
    const n = src.split(finds[k]).length - 1;
    if (n !== 1) return { m, skipped: true, why: 'anchor ' + (k + 1) + ' of ' + finds.length
      + ' matches ' + n + ' times in the source, so this mutant cannot be trusted to have applied' };
    src = src.replace(finds[k], withs[k]);
  }
  const file = path.join(tmp, 'mutant-' + i + '.html');
  fs.writeFileSync(file, src);
  for (const c of orderFor(m)) {
    const out = await runAsync(c, file);
    /* The failing OUTPUT, not only the fact of failure. Which check went red
       says a file is guarding this identity; which ASSERTION went red says
       which sentence in it is. Every one of these runs already produced the
       text and it was being thrown away — the journal below turns 28 minutes
       of work that was already happening into a map of what is actually
       proven. */
    if (out) return { m, by: c, findings: assertionsIn(out) };
  }
  return { m, survived: true };
}
/* The assertion TEXTS a red run printed. The sweeps report findings as strings
   inside a JSON array, and every one of them is a sentence somebody wrote — so
   the sentences are the identifiers. Truncated at a length that is still unique
   in practice but short enough to survive a check appending a computed number
   to its own message, which most of them do. */
function assertionsIn(out) {
  const hits = [];
  const re = /"((?:[^"\\]|\\.){20,})"/g;
  let m2;
  while ((m2 = re.exec(out))) {
    const t = m2[1].replace(/\\"/g, '"');
    if (/ :: | — |^[A-Z][a-z]/.test(t)) hits.push(t.slice(0, 160));
  }
  return [...new Set(hits)];
}

(async () => {
  /* Mutants are independent, so they run several at a time. The cap is small on
     purpose: each one launches a browser, and oversubscribing turns a fast run
     into a slow one that also reports flaky timeouts as holes. */
  const LANES = Math.max(1, Math.min(4, (os.cpus() || []).length - 2 || 2));
  if (ONLY.length && !SELECTED.length) {
    console.log('no mutant matches ' + JSON.stringify(ONLY) + ' — nothing was run, and nothing is proven');
    process.exitCode = 2; return;
  }
  const results = new Array(SELECTED.length);
  let next = 0, done = 0;
  const lane = async () => {
    while (true) {
      const i = next++;
      if (i >= SELECTED.length) return;
      results[i] = await judge(SELECTED[i], i);
      done++;
      if (process.stderr.isTTY) process.stderr.write('\r  ' + done + '/' + SELECTED.length + ' judged   ');
    }
  };
  await Promise.all(Array.from({ length: LANES }, lane));
  if (process.stderr.isTTY) process.stderr.write('\r');

  /* SURVIVED and SKIPPED are different findings and were reported as one number.
     A survivor says a region of the PRODUCT is unguarded. A skip says this FILE
     is stale — its anchor no longer matches, usually because the code it aimed at
     was edited — and the region may be perfectly well covered. Printing "1 of 38
     survived — the suite has holes there" for a stale anchor sends someone
     hunting for a hole that is not there, and worse, hides a real survivor behind
     a number that is routinely nonzero. Both still fail the run: a mutant that
     cannot apply is proving nothing and has to be repaired. */
  let survived = 0, skipped = 0;
  results.forEach(r => {
    if (r.skipped) { skipped++; console.log('SKIPPED  ' + r.m.what + '\n         ' + r.why); }
    else if (r.by) console.log('CAUGHT   ' + r.m.what + '\n         → ' + r.by);
    else { survived++; console.log('SURVIVED ' + r.m.what
      + '\n         nothing in the suite noticed. This identity is unguarded.'); }
  });

  /* Written on every run, filtered or not, because a partial journal that says
     which run produced it is more useful than none — and the coverage probe
     that reads it refuses to draw conclusions from a filtered one. */
  try {
    fs.writeFileSync(path.join(__dirname, '.mutation-journal.json'), JSON.stringify({
      at: new Date().toISOString(),
      full: !ONLY.length,
      ran: SELECTED.length, of: MUTANTS.length,
      rows: results.filter(Boolean).map(r => ({
        what: r.m.what, by: r.by || null, survived: !!r.survived, skipped: !!r.skipped,
        findings: r.findings || [] }))
    }, null, 1));
  } catch (e) { console.log('(could not write the mutation journal: ' + (e.message || e) + ')'); }

  fs.rmSync(tmp, { recursive: true, force: true });
  const parts = [];
  if (survived) parts.push(survived + ' of ' + SELECTED.length
    + ' mutants SURVIVED — those regions of the product are unguarded');
  if (skipped) parts.push(skipped + ' mutant(s) could not be applied — this FILE is stale, not the suite: '
    + 'the anchor was edited out of the product. Repair the anchor; it is proving nothing until you do');
  const scope = ONLY.length ? SELECTED.length + ' of ' + MUTANTS.length + ' mutants (filtered by '
    + JSON.stringify(ONLY) + ' — this is NOT a full run)' : 'all ' + MUTANTS.length + ' mutants';
  console.log(parts.length ? '\n' + parts.join('.\n') + '.' + (ONLY.length ? '\nRan ' + scope + '.' : '')
    : '\n' + scope + ' were caught.');
  process.exitCode = (survived || skipped) ? 1 : 0;
})();
