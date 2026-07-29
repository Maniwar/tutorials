/* ═══════════════════════════════════════════════════════════════════════════
   WHAT IS DRAWN VERSUS WHAT WAS COMPUTED.

   The seven earlier sweeps read data structures and generated prose. This one
   reads the PICTURES — the Gantt, the PERT network, the activity grid — and
   asks whether the geometry and the labels correspond to the numbers the engine
   produced.

   That gap is real and it is not covered anywhere else. A bar can sit at the
   wrong x, a tooltip can quote a date the task does not have, a zero-slack
   activity can be drawn in the non-critical colour, a milestone diamond can
   land on a different day from the one printed beside it. Every one of those is
   invisible to a check that only reads `tasks`, and every one of them is what
   the user actually looks at.

   Runs against both fixtures: the QA reference plan (where every number is
   known) and the real export (where the shapes are messy).
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
  const errs=[]; page.on('pageerror', e=>errs.push(e.message));
  await page.goto(APP,{waitUntil:'load'});

  const sweep = async (label, data) => {
    await page.evaluate(d => { hydrate(d); calculate(); }, data);
    await page.waitForTimeout(600);
    return page.evaluate(lbl => {
      const bad = [];
      const say = (where, what) => bad.push(lbl + ' · ' + where + ' :: ' + what);
      const num = s => { const m = String(s).match(/-?[\d.]+/); return m ? +m[0] : NaN; };

      /* "undefined" is also an English word, and the product uses it: the
         plan-truth caption reads "…have no user story — undefined scope you are
         building anyway." A bare /undefined/ calls that honest sentence a
         broken figure. What a leaked value looks like is the token standing on
         its own, or wearing a unit or a currency mark — never followed by
         another lowercase word, which is prose. */
      const BROKEN = /NaN|(?:^|\s)Infinity\b|[$£€]\s*undefined|undefined\s*[%$]|\bundefined\b(?!\s+[a-z])/;

      // ═══ 1. THE GANTT ════════════════════════════════════════════════════
      switchTab('gantt'); renderGantt();
      const g = document.getElementById('ganttContainer');
      const svg = g ? g.querySelector('svg') : null;
      const out = { ganttBars: 0, pertNodes: 0, gridRows: 0 };
      if (!svg) { say('Gantt', 'rendered no svg at all'); }
      else {
        const groups = [...svg.querySelectorAll('[data-gopen]')];
        out.ganttBars = groups.length;
        const drawn = new Map();
        groups.forEach(el => {
          const id = Number(el.dataset.gopen);
          const title = (el.querySelector('title') || {}).textContent || '';
          const r = el.querySelector('rect');
          drawn.set(id, { title, x: r ? +r.getAttribute('x') : null,
                          w: r ? +r.getAttribute('width') : null, el });
        });

        // a) every visible activity is drawn (collapsed summaries hide children,
        //    so compare against what the Gantt itself chose to lay out)
        const visible = tasksInWbsOrder().map(x => x.task)
          .filter(t => !collapsedIds.has(t.parentId));
        visible.forEach(t => {
          if (!drawn.has(t.id)) say('Gantt', '"' + t.name + '" is in the plan and has no bar');
        });

        // b) THE TOOLTIP IS WHAT A USER READS ON HOVER. It must quote the dates,
        //    the progress and the slack the task actually carries.
        drawn.forEach((d, id) => {
          const t = tasks.find(x => x.id === id);
          if (!t) { say('Gantt', 'a bar points at task ' + id + ', which is not in the plan'); return; }
          if (t.startDate && d.title.indexOf(fmtNice(t.startDate)) < 0)
            say('Gantt', '"' + t.name + '" starts ' + fmtISO(t.startDate)
              + ' and its tooltip does not say so');
          if (t.finishDate && d.title.indexOf(fmtNice(t.finishDate)) < 0)
            say('Gantt', '"' + t.name + '" finishes ' + fmtISO(t.finishDate)
              + ' and its tooltip does not say so');
          const pct = (d.title.match(/(\d+)% done/) || [])[1];
          if (pct != null && +pct !== (t.percentComplete || 0))
            say('Gantt', '"' + t.name + '" is ' + (t.percentComplete || 0) + '% complete and its '
              + 'tooltip says ' + pct + '%');
          const sl = (d.title.match(/slack (-?[\d.]+)/) || [])[1];
          if (sl != null && !t.isSummary && Math.abs(+sl - (t.slack || 0)) > 0.06)
            say('Gantt', '"' + t.name + '" has slack ' + (t.slack || 0).toFixed(2)
              + ' and its tooltip says ' + sl);
        });

        // c) GEOMETRY MUST FOLLOW THE CALENDAR. An activity starting later must
        //    be drawn further right; a longer one must be drawn wider. If the bar
        //    positions do not follow the dates the picture is decorative.
        const bars = [...drawn.entries()]
          .map(([id, d]) => ({ t: tasks.find(x => x.id === id), d }))
          .filter(x => x.t && !x.t.isSummary && !x.t.milestone && x.t.startDate && x.d.x != null);
        for (let i = 0; i < bars.length; i++) {
          for (let j = i + 1; j < bars.length; j++) {
            const A = bars[i], B = bars[j];
            const dd = stripTime(A.t.startDate) - stripTime(B.t.startDate);
            if (dd < 0 && A.d.x > B.d.x + 1)
              say('Gantt', '"' + A.t.name + '" starts before "' + B.t.name
                + '" and is drawn to the right of it');
            if (dd > 0 && A.d.x < B.d.x - 1)
              say('Gantt', '"' + A.t.name + '" starts after "' + B.t.name
                + '" and is drawn to the left of it');
          }
        }
        // width must track the calendar span, at one consistent scale
        const scales = bars.filter(x => x.t.finishDate).map(x => {
          const days = calDaysBetween(x.t.startDate, x.t.finishDate) + 1;
          return days > 0 ? x.d.w / days : null;
        }).filter(v => v != null && v > 0);
        if (scales.length > 1) {
          const lo = Math.min(...scales), hi = Math.max(...scales);
          if (hi > lo * 1.02 + 0.01)
            say('Gantt', 'bar widths are not on one scale — a calendar day is worth '
              + lo.toFixed(2) + 'px on one bar and ' + hi.toFixed(2) + 'px on another');
        }

        // d) A ZERO-SLACK ACTIVITY MUST BE DRAWN AS CRITICAL, and one with float
        //    must not be. Colour is the only cue the picture gives.
        //
        //    The chart speaks in two families, not two colours. An unstarted
        //    critical bar is the pale red #fca5a5 and only the completed portion
        //    is #dc2626, so demanding the strong red alone calls every 0%
        //    critical activity a defect. Milestones (purple diamond), summaries
        //    (slate bracket) and finished work (green) each have their own
        //    language and carry criticality through the red overlay band drawn
        //    across the top of the chart instead — those are excluded from `bars`
        //    already. What must hold for a live leaf activity is that its fill
        //    comes from the RED family when it has no float and the BLUE family
        //    when it has some.
        const REDS = ['#dc2626', '#ef4444', '#fca5a5', '#7f1d1d'];
        const BLUES = ['#2563eb', '#93c5fd', '#1e3a8a'];
        bars.forEach(({ t, d }) => {
          if ((t.percentComplete || 0) >= 100) return;   // finished is green by design
          const fills = [...d.el.querySelectorAll('rect')].map(r => (r.getAttribute('fill') || '').toLowerCase());
          if (!fills.length) return;                     // label-pane twin, no bar of its own
          const red = fills.some(f => REDS.indexOf(f) >= 0);
          const blue = fills.some(f => BLUES.indexOf(f) >= 0);
          if (t.isCritical && !red)
            say('Gantt', '"' + t.name + '" has zero slack and is not drawn in the critical colour'
              + ' (fills: ' + fills.join(', ') + ')');
          if (!t.isCritical && red && !blue)
            say('Gantt', '"' + t.name + '" carries ' + (t.slack || 0).toFixed(1)
              + ' days of float and is drawn as critical');
        });
      }

      // ═══ 2. THE PERT NETWORK ═════════════════════════════════════════════
      switchTab('pert');
      try { renderPERT(); } catch (e) { say('PERT', 'threw while rendering: ' + e.message); }
      const p = document.getElementById('pertContainer') || document.getElementById('pertChart');
      const psvg = p ? p.querySelector('svg') : null;
      if (psvg) {
        const nodes = [...psvg.querySelectorAll('[data-popen]')];
        out.pertNodes = nodes.length;
        const shown = new Set(nodes.map(el => Number(el.dataset.popen)));

        /* The network does not draw one box per activity and is not meant to.
           Test cases roll into the UAT activity they decompose, and a WBS depth
           cut folds everything below it into an ancestor box labelled "⊞n".
           So the invariant is not "every leaf has a node" — it is that every
           leaf is REPRESENTED by a node that is itself or one of its ancestors,
           and that an aggregate box states the slack of the work inside it.
           Rebuild that mapping from the drawing, which is also how a reader
           would have to reason about it. */
        const repFor = id => {
          let n = tasks.find(x => x.id === id);
          while (n) { if (shown.has(n.id)) return n.id; n = n.parentId != null ? tasks.find(x => x.id === n.parentId) : null; }
          return null;
        };
        const members = new Map();
        const orphans = [];
        leafTasks().forEach(t => {
          const r = repFor(t.id);
          if (r == null) { if ((t.te || 0) > 0 || t.milestone) orphans.push(t.name); return; }
          (members.get(r) || members.set(r, []).get(r)).push(t);
        });
        if (orphans.length && nodes.length)
          say('PERT', orphans.length + ' activit(ies) are in no box and under no box: '
            + orphans.slice(0, 3).join('; '));

        nodes.forEach(el => {
          const t = tasks.find(x => x.id === Number(el.dataset.popen));
          if (!t) { say('PERT', 'a node points at a task not in the plan'); return; }
          const txt = el.textContent || '';
          const tip = (el.querySelector('title') || {}).textContent || '';
          const mem = members.get(t.id) || [t];
          const agg = mem.length > 1 || /⊞/.test(txt);
          // slack of an aggregate is the tightest slack inside it — the box is a
          // claim about the work it contains, not about the summary row's own row
          const want = agg
            ? Math.min(...mem.map(m => Number.isFinite(m.slack) ? m.slack : Infinity))
            : (t.slack || 0);
          const who = agg ? '"' + t.name + '" (⊞' + mem.length + ')' : '"' + t.name + '"';
          const sl = (txt.match(/slack\s*(-?[\d.]+)/) || [])[1];
          if (sl != null && Number.isFinite(want) && Math.abs(+sl - want) > 0.06)
            say('PERT', who + ' node prints slack ' + sl + ' against ' + want.toFixed(2));
          const tsl = (tip.match(/slack (-?[\d.]+)/) || [])[1];
          if (tsl != null && Number.isFinite(want) && Math.abs(+tsl - want) > 0.06)
            say('PERT', who + ' tooltip says slack ' + tsl + ' against ' + want.toFixed(2));
          const tp = (tip.match(/(\d+)% complete/) || [])[1];
          if (tp != null && !agg && +tp !== (t.percentComplete || 0))
            say('PERT', who + ' tooltip says ' + tp + '% against ' + (t.percentComplete || 0) + '%');
        });

        // the caption states how many boxes and how many activities they stand
        // for; if that arithmetic is wrong the reader is told the wrong scope
        const cap = (document.getElementById('pertAggNote') || {}).textContent || '';
        const mN = cap.match(/Showing\s+(\d+)\s+node/);
        if (mN && +mN[1] !== nodes.length)
          say('PERT', 'the caption says ' + mN[1] + ' nodes and ' + nodes.length + ' are drawn');
        const mL = cap.match(/from\s+(\d+)\s+scheduled activities/);
        if (mL && +mL[1] !== leafTasks().length)
          say('PERT', 'the caption says ' + mL[1] + ' scheduled activities against '
            + leafTasks().length + ' in the plan');
      }

      // ═══ 3. THE ACTIVITY GRID ════════════════════════════════════════════
      switchTab('tasks'); renderTaskTable();
      const rows = [...document.querySelectorAll('#taskTable tbody tr[data-task-id]')];
      out.gridRows = rows.length;
      rows.forEach(tr => {
        const t = tasks.find(x => x.id === Number(tr.dataset.taskId));
        if (!t) { say('Grid', 'a row points at a task not in the plan'); return; }
        const txt = tr.textContent.replace(/\s+/g, ' ');
        // the row must carry the activity's own name, not a neighbour's
        if (t.name && txt.indexOf(t.name.slice(0, 24)) < 0)
          say('Grid', 'the row for task ' + t.id + ' does not contain its name "' + t.name + '"');
        // a row marked critical must have zero slack
        if (tr.classList.contains('critical') && Math.abs(t.slack || 0) > 0.05)
          say('Grid', '"' + t.name + '" is styled critical with ' + (t.slack || 0).toFixed(1) + ' days of float');
        // a row marked late must actually be late
        if (tr.classList.contains('late') && !isLate(t))
          say('Grid', '"' + t.name + '" is styled late and isLate() disagrees');
      });

      // ═══ 4. REQUIREMENTS AND TRACEABILITY ════════════════════════════════
      switchTab('req');
      try { renderReqs(); } catch (e) { say('Requirements', 'threw while rendering: ' + e.message); }
      const rc = document.getElementById('reqContainer');
      if (rc) {
        const txt = rc.textContent.replace(/\s+/g, ' ');
        if (BROKEN.test(txt)) say('Requirements', 'prints a broken figure');
        const stories = ((reqs && reqs.stories) || []);
        const acs = stories.reduce((s, x) => s + ((x.ac || []).length), 0);
        // any count the panel states must be the count that exists
        const mS = txt.match(/(\d+)\s+stor(?:y|ies)\b/);
        if (mS && stories.length && +mS[1] !== stories.length)
          say('Requirements', 'states ' + mS[1] + ' stories against ' + stories.length + ' in the plan');
        const mA = txt.match(/(\d+)\s+(?:acceptance )?criteri/);
        if (mA && acs && +mA[1] !== acs)
          say('Requirements', 'states ' + mA[1] + ' criteria against ' + acs + ' in the plan');
        out.stories = stories.length; out.criteria = acs;
      }

      /* ═══ 4b. A CHART DRAWN IN HTML HAS VISIBLE MARKS ═══════════════════
         Not every chart here is SVG. The Monte Carlo histogram is flex boxes,
         and it shipped rendering nothing: the base `button` rule sets
         align-items:center, the bar rule overrode display/direction/justify but
         inherited that centring, and in a COLUMN flex container each bar shrank
         to its empty content width. Every bar kept a correct height and drew
         0px wide — a chart that reads as "no data" while every bar is still
         hoverable, which is why no structural check noticed.

         So measure what is on screen. A mark with height and no width is
         invisible, and so is one with width and no height. */
      switchTab('analytics');
      {
        const marks = [...document.querySelectorAll('.mch-wrap .mch-b > i')];
        if (marks.length) {
          const r = marks.map(m => m.getBoundingClientRect());
          const flat = marks.filter((m, i) => r[i].height > 0.5 && r[i].width < 0.5);
          if (flat.length)
            say('Analytics', flat.length + ' of ' + marks.length + ' histogram bars have a height '
              + 'and no width — the distribution is invisible but still hoverable');
          if (!r.some(x => x.height > 1 && x.width > 1))
            say('Analytics', 'the completion-distribution histogram drew no visible bar at all');
          out.histogramBars = marks.length;
        }
        // the same shape anywhere else: a flex button whose child has height but
        // no width is a mark nobody can see
        const blind = [];
        document.querySelectorAll('button').forEach(btn => {
          if (!/flex/.test(getComputedStyle(btn).display)) return;
          [...btn.children].forEach(c => {
            const b = c.getBoundingClientRect();
            if (b.height > 0.5 && b.width < 0.5) blind.push(btn.className || btn.id || 'button');
          });
        });
        if (blind.length)
          say('Analytics', blind.length + ' chart mark(s) render with no width: ' + blind.slice(0, 3).join(', '));
      }

      /* ═══ 4c. THE RECONCILIATION ADDS UP AS PRINTED ═════════════════════
         The budget bar's drill-in used to show the five biggest movers, which
         cannot justify a total — a reader was shown a number and five figures
         that need not sum to it, and reasonably refused to believe it. The full
         table claims an exact identity per row and in total:

             off its dates  +  vs its own budget  =  contributes
             Σ contributes  +  cost with no activity  =  the bar

         Parse the RENDERED cells, not the data behind them. A table that is
         right in memory and mis-columned on screen is still a table nobody can
         check, and this whole panel exists to be checkable. */
      switchTab('analytics');
      {
        const t = document.querySelector('.ptr-rc-t');
        if (t) {
          const cash = c => { const v = (c.textContent || '').replace(/[\s,]/g, '');
            if (/^—?$/.test(v)) return 0;
            const n = parseFloat(v.replace(/[^0-9.]/g, ''));
            return Number.isFinite(n) ? (/[−-]/.test(v) ? -n : n) : NaN; };
          const body = [...t.querySelectorAll('tbody tr')];
          let sum = 0, broke = 0;
          body.forEach(tr => {
            const c = [...tr.children]; if (c.length < 4) return;
            const timing = cash(c[1]), over = cash(c[2]), total = cash(c[3]);
            if (![timing, over, total].every(Number.isFinite)) { broke++; return; }
            sum += total;
            // the residual line deliberately prints — for its two halves
            if (!/no activity behind it/.test(tr.textContent) && Math.abs((timing + over) - total) > 1.5)
              say('Reconciliation', 'a row prints ' + timing + ' off its dates and ' + over
                + ' against its budget, which is ' + (timing + over) + ', and calls it ' + total);
          });
          if (broke) say('Reconciliation', broke + ' row(s) print a figure that will not parse as money');
          const foot = [...t.querySelectorAll('tfoot tr td')];
          if (foot.length >= 4) {
            const bar = cash(foot[3]);
            if (Number.isFinite(bar) && Math.abs(bar - sum) > 1.5)
              say('Reconciliation', 'the rows add to ' + sum + ' and the total row calls the bar '
                + bar + ' — the table does not justify the figure it sits under');
            const ft = cash(foot[1]), fo = cash(foot[2]);
            if (Number.isFinite(ft) && Number.isFinite(fo) && Math.abs((ft + fo) - bar) > 1.5)
              say('Reconciliation', 'the total row prints ' + ft + ' timing and ' + fo
                + ' overrun against a bar of ' + bar);
          }
          out.reconRows = body.length;
        }
      }

      // ═══ 5. NOTHING ANYWHERE PRINTS A BROKEN FIGURE ══════════════════════
      ['gantt', 'pert', 'tasks', 'req', 'analytics', 'resources', 'raid', 'baseline'].forEach(tab => {
        try {
          switchTab(tab);
          const host = document.getElementById('view-' + tab);
          if (!host) return;
          const t = host.textContent || '';
          const m = t.match(BROKEN);
          if (m) say('Tab "' + tab + '"', 'prints "' + m[0].trim() + '" somewhere on screen');
        } catch (e) { say('Tab "' + tab + '"', 'threw on switch: ' + e.message); }
      });

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
