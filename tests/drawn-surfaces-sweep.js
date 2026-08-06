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

      /* ── 1b. EVERY MILESTONE SURVIVES EVERY ZOOM LEVEL ──────────────────
         L1 collapsed the phases and took the milestones down with them, so the
         executive view of the chart — the one that gets pasted into a status
         email — showed three bars and not one date anybody had committed to.
         The SOW's own depth control has said "milestones always appear
         regardless" since it was written; the chart it feeds did the opposite.

         Asserted across ALL THREE levels rather than only the one that broke.
         A milestone is the thing a Gantt exists to communicate, and there is no
         level at which dropping it is the right answer — so the check states
         that rule, not the single case that was reported.

         The names are read out of the drawn SVG, not out of the row model, so
         a level that computes the right set and paints the wrong one is still
         caught. */
      switchTab('gantt');
      {
        const allMs = tasks.filter(t => t.milestone);
        out.milestonesInPlan = allMs.length;
        if (!allMs.length) {
          out.milestoneLevels = 'SKIPPED-no-milestones';
        } else {
          const seen = {};
          [['L1', 0], ['L2', 1], ['All', Infinity]].forEach(([lbl, depth]) => {
            setCollapseLevel(depth);
            renderGantt();
            const g = document.getElementById('ganttChart') || document.getElementById('ganttContainer');
            const txt = g ? (g.textContent || '') : '';
            const missing = allMs.filter(t => txt.indexOf(t.name.replace(/^◆\s*/, '')) < 0);
            seen[lbl] = allMs.length - missing.length;
            if (missing.length)
              say('Gantt', 'at ' + lbl + ', ' + missing.length + ' of ' + allMs.length
                + ' milestone(s) are not drawn at all, e.g. "' + missing[0].name
                + '" — the level meant to be the executive view is the one with no committed dates on it');
          });
          out.milestoneLevels = seen;
          setCollapseLevel(Infinity); renderGantt();
        }
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
          /* Resolve the columns by HEADER, never by position. This check read
             c[1]/c[2]/c[3] and went quietly wrong the moment four source columns
             were inserted before them: it started comparing "Budget" against
             "Done", parsed the 100% as 100, and reported four confident
             contradictions about arithmetic nobody had written. A positional
             read of a table is a check that silently measures something else
             when the table grows. */
          const heads = [...t.querySelectorAll('thead th')]
            .map(h => (h.textContent || '').toLowerCase());
          const ix = want => heads.findIndex(h => h.indexOf(want) >= 0);
          const iT = ix('off its dates'), iO = ix('vs its own budget'), iC = ix('contributes');
          if (iT < 0 || iO < 0 || iC < 0) {
            say('Reconciliation', 'the table no longer has the columns this check reads — '
              + 'headers are: ' + heads.join(' | '));
            return;
          }
          const body = [...t.querySelectorAll('tbody tr')];
          let sum = 0, broke = 0;
          body.forEach(tr => {
            const c = [...tr.children]; if (c.length <= iC) return;
            const timing = cash(c[iT]), over = cash(c[iO]), total = cash(c[iC]);
            if (![timing, over, total].every(Number.isFinite)) { broke++; return; }
            sum += total;
            // the residual line deliberately prints — for its two halves
            if (!/no activity behind it/.test(tr.textContent) && Math.abs((timing + over) - total) > 1.5)
              say('Reconciliation', 'a row prints ' + timing + ' off its dates and ' + over
                + ' against its budget, which is ' + (timing + over) + ', and calls it ' + total);
          });
          if (broke) say('Reconciliation', broke + ' row(s) print a figure that will not parse as money');
          const foot = [...t.querySelectorAll('tfoot tr td')];
          if (foot.length > iC) {
            const bar = cash(foot[iC]);
            if (Number.isFinite(bar) && Math.abs(bar - sum) > 1.5)
              say('Reconciliation', 'the rows add to ' + sum + ' and the total row calls the bar '
                + bar + ' — the table does not justify the figure it sits under');
            const ft = cash(foot[iT]), fo = cash(foot[iO]);
            if (Number.isFinite(ft) && Number.isFinite(fo) && Math.abs((ft + fo) - bar) > 1.5)
              say('Reconciliation', 'the total row prints ' + ft + ' timing and ' + fo
                + ' overrun against a bar of ' + bar);

            /* ── AND THE SOURCE COLUMNS, WHICH THIS USED TO SKIP ───────────
               Everything above tests the DERIVED columns — timing, overrun,
               contributes — and all three footed correctly on a table that was
               missing $9,700. The reason is that the rows were dropped by
               CONTRIBUTION: an activity booked at exactly what was due by today
               contributes nothing, so removing it changed no derived total and
               changed both source totals. Booked showed rows summing to $25,200
               under a printed total of $34,900. Due by today showed $7,279 under
               $14,779.

               So the derived half of the table was checkable and the half a
               reader actually starts from was not, and the check was green
               throughout. Same question, asked of every money column the table
               prints: does the tfoot equal the tbody. The Done column is a
               percentage and its total is deliberately an em dash, so it is
               named and skipped rather than silently missed.

               Tolerance scales with the row count because each cell is rounded
               to whole dollars before it is printed — the accumulated rounding
               is real and is not a defect. */
            [['budget', 'Budget'], ['due by today', 'Due by today'], ['booked', 'Booked']]
              .forEach(([key, label]) => {
                const i = ix(key);
                if (i < 0) { say('Reconciliation', 'the "' + label + '" column has gone from the table, '
                  + 'so the footing check that reads it is testing nothing'); return; }
                let colSum = 0, ok = true;
                body.forEach(tr => {
                  const c = [...tr.children]; if (c.length <= i) { ok = false; return; }
                  const v = cash(c[i]);
                  if (!Number.isFinite(v)) { ok = false; return; }
                  colSum += v;
                });
                const tot = foot.length > i ? cash(foot[i]) : NaN;
                if (!ok || !Number.isFinite(tot)) return;
                if (Math.abs(colSum - tot) > Math.max(2, body.length * 0.5 + 1))
                  say('Reconciliation', 'the "' + label + '" column adds to ' + Math.round(colSum)
                    + ' across ' + body.length + ' printed rows and its own total says ' + Math.round(tot)
                    + ' — ' + Math.round(Math.abs(tot - colSum)) + ' of it belongs to activities the table '
                    + 'does not show, in a table whose only purpose is being added up by hand');
              });
          }
          out.reconRows = body.length;
        }
      }

      /* ═══ 4d. NO CONTROL STUTTERS ITS OWN PUNCTUATION ═══════════════════
         The RAID watch chip drew a "?" glyph in front of a label that is itself
         a question, so it read "? Did it hold?" — two question marks, one of
         them an icon pretending to be punctuation. Nothing was broken, no
         figure was wrong, and it is the kind of thing a reader sees instantly
         and a value-comparing check never sees at all.

         Page-wide over every button rather than aimed at that chip, because the
         defect is a composition mistake — a glyph chosen without looking at the
         text it would sit beside — and that can be made again anywhere the same
         pattern is used. Two question marks in one control label is never
         intentional. */
      ['analytics', 'baseline', 'raid', 'tasks', 'req', 'resources'].forEach(tab => {
        try { switchTab(tab); } catch (e) { return; }
        const root = document.getElementById('view-' + tab);
        if (!root) return;
        [...root.querySelectorAll('button')].forEach(bn => {
          const txt = (bn.textContent || '').trim();
          if (!txt) return;
          const qs = (txt.match(/\?/g) || []).length;
          if (qs > 1)
            say('Tab "' + tab + '"', 'a control reads "' + txt.slice(0, 60)
              + '" — ' + qs + ' question marks in one label, which is a glyph duplicating the '
              + 'punctuation of the words beside it');
        });
      });

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

      /* ── NO SOURCE CODE IN THE RENDERED PAGE ────────────────────────────
         A JS comment shipped into the RAID entry form, verbatim: the word Score
         followed by a dollar-brace placeholder wrapping a block comment, written
         inside STATIC html where there is no template literal to evaluate it. It
         sat in a form people type client-facing risks into. (Quoting it here
         literally is what broke this file on the first attempt — the comment
         terminator inside it closed this comment early, which is a rather
         on-the-nose demonstration of the hazard.) dialog-sweep already scans for markup rendered as text, but only
         inside .modal-overlay, and this is an inline panel on a tab: the same
         "a dialog is not a tab" lesson, inverted. So the scan is page-wide and
         looks for the syntax of the language rather than for tag names. */
      (() => {
        const CODE = /\$\{|\/\*|\*\/|=>\s|function\s*\(|escapeHtml\(/;
        const hits = [];
        ['tasks', 'wbs', 'req', 'pert', 'gantt', 'resources', 'baseline', 'analytics', 'raid'].forEach(tab => {
          try { switchTab(tab); } catch (e) { return; }
          const root = document.getElementById('view-' + tab);
          if (!root) return;
          const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode: n => /^(script|style)$/i.test((n.parentElement || {}).tagName || '')
              ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
          let n; while ((n = w.nextNode())) {
            const v = (n.nodeValue || '').trim();
            if (v && CODE.test(v)) hits.push(tab + ': "' + v.slice(0, 70) + '"');
          }
        });
        // the RAID entry form only exists once opened, and it is where this shipped
        try { switchTab('raid'); openRaidForm(); } catch (e) {}
        const rf = document.getElementById('raidForm');
        if (rf) {
          const w2 = document.createTreeWalker(rf, NodeFilter.SHOW_TEXT);
          let n2; while ((n2 = w2.nextNode())) {
            const v = (n2.nodeValue || '').trim();
            if (v && CODE.test(v)) hits.push('RAID form: "' + v.slice(0, 70) + '"');
          }
        }
        try { closeRaidForm(); } catch (e) {}
        out.codeInText = hits.length;
        if (hits.length)
          say('Rendered text', hits.length + ' place(s) print source code at the reader — '
            + hits.slice(0, 2).join(' · '));
      })();

      /* ── THE RAID FORM'S CONTROLS MUST BE CONTROLS ──────────────────────
         Owner carries list="ownerList" and always has, so it was written to be a
         type-ahead — but the datalist is filled by populateOwnerList(), and for a
         long time nothing on the way into this form called it. Whether names
         appeared depended on whether some other screen had happened to run first
         in that browser session, so from the reader's side it was a plain text
         box that sometimes suggested and usually did not. Reported exactly that
         way: "this panel owner is not a drop down/type ahead field for some
         reason".

         The datalist is EMPTIED first on purpose. It is shared with the activity
         editor, so a check that merely counts options after opening the form
         passes on a build that never populates anything — the options left over
         from an earlier screen answer for it. Emptying it makes the question
         "did opening THIS form fill it", which is the actual property.

         Two more from the same report, checked here because they are the same
         class of thing — a form field with nothing behind it: Status had no
         control at all (new entries were hard-coded Open, and the one field the
         log is filtered and counted by could only be changed from the table),
         and the 1–5 boxes never said what 1 or 5 meant. */
      (() => {
        try { switchTab('raid'); } catch (e) { return; }
        const dl = document.getElementById('ownerList');
        if (!dl) { say('RAID form', 'there is no ownerList datalist for the owner box to point at'); return; }
        dl.innerHTML = '';
        try { openRaidForm(); } catch (e) { say('RAID form', 'openRaidForm threw: ' + e.message); return; }
        const own = document.getElementById('rOwner');
        const opts = [...dl.querySelectorAll('option')].map(o => o.value);
        out.raidOwnerSuggestions = opts.length;
        const roster = new Set([...tasks.map(t => (t.owner || '').trim()).filter(Boolean),
                                ...Object.keys(resources || {})]);
        if (!own) say('RAID form', 'there is no owner field');
        else if (!own.getAttribute('list'))
          say('RAID form', 'the owner box is a plain text field — every name has to be typed from memory and '
            + 'spelled the same way it was spelled on the activity, or the log and the plan stop agreeing');
        else if (!opts.length && roster.size)
          say('RAID form', 'the owner box points at a datalist that opening the form leaves EMPTY, with '
            + roster.size + ' names on the plan — it looks like a picker and behaves like a text box');
        else if (opts.length && ![...roster].some(n => opts.indexOf(n) >= 0))
          say('RAID form', 'the owner suggestions do not include a single name from the plan or the roster');

        const st = document.getElementById('rStatus');
        out.raidStatusOptions = st ? st.options.length : 0;
        if (!st || st.tagName !== 'SELECT')
          say('RAID form', 'Status has no control in the form that creates and edits a RAID entry, and it is '
            + 'the field the log is filtered and counted by');
        else if (!st.options.length) say('RAID form', 'the Status control offers nothing to choose');

        /* Read the HINT, not the whole form. The first version tested the form's
           entire textContent for "1 =" or "5 =" and passed on the CRM fixture
           and failed on the other two — with identical static markup, which is
           the tell: it was matching an equals sign somewhere in that plan's
           linked-entity picker, not the scale legend at all. A phrase that can
           be satisfied by unrelated plan data is not testing the product. */
        const hint = (document.getElementById('rScaleHint') || {}).textContent || '';
        if (!/1\s*[–-]\s*5/.test(hint))
          say('RAID form', 'nothing beside the Probability and Impact boxes says they are a 1–5 judgement');
        else if (!/\b1\s+[a-z]/.test(hint) || !/\b5\s+[a-z]/.test(hint))
          say('RAID form', 'the scale says 1–5 and never says what 1 or 5 MEANS, so two people scoring the '
            + 'same risk are not using the same scale and the product they are multiplied into is not '
            + 'comparable between them');
        /* ── EVERY TYPE THAT CAN TURN OUT MUST BE ABLE TO SAY SO ──────────
           Reported by a reader looking at a closed Decision with no way to
           record what had happened to it: Closed is a STATUS — it answers "is
           anyone still working this entry" — and it cannot say whether the
           decision stood, was reversed, or was overtaken by a later one. Those
           are among the most expensive things that happen on an engagement,
           because the rework gets charged to a choice somebody can point at.
           Asked per type rather than as a list, so a type added later without
           an outcome vocabulary is caught here rather than by the next reader
           who needs one. And the QUESTION has to fit the type: "Did it happen?"
           on a decision is meaningless — a decision plainly happened, that is
           what makes it a decision — and a form that asks the wrong question
           gets the wrong answer or none. */
        (() => {
          const need = ['Risk', 'Assumption', 'Decision'];
          need.forEach(ty => {
            const opts = raidOutcomeOpts(ty);
            if (!opts || !opts.length) {
              say('RAID form', 'a ' + ty + ' has no way to record how it turned out, so the only thing that '
                + 'can be said about it is a STATUS — which cannot tell "closed because it never happened" '
                + 'from "closed because it did"');
              return;
            }
            const sel = document.getElementById('rType');
            if (sel) { sel.value = ty; raidOutcomeFormSync(); }
            const row = document.getElementById('rOutcomeRow');
            const oc = document.getElementById('rOutcome');
            if (!row || row.style.display === 'none')
              say('RAID form', 'selecting ' + ty + ' hides the outcome control, so the vocabulary exists in '
                + 'the code and cannot be reached from the form');
            else if (!oc || oc.options.length < opts.length + 1)
              say('RAID form', 'the outcome control for a ' + ty + ' offers ' + ((oc && oc.options.length) || 0)
                + ' choices for ' + opts.length + ' outcomes plus "not recorded"');
            /* The expected wording is written out HERE, not read from
               raidOutcomeQuestion(). The first version compared the label
               against that function and the two agreed by construction: a build
               where every type asked "Did it happen?" passed, because the label
               and the expectation came from the same mutated source. A check
               that shares its answer with the thing it checks proves nothing —
               the same lesson as pricing-sweep recomputing revenue instead of
               calling laborRevenue(). */
            const WANT = { Risk: 'Did it happen?', Assumption: 'Did it hold?', Decision: 'Did it stand?' };
            const q = (document.querySelector('#rOutcomeRow label[for="rOutcome"]') || {}).textContent || '';
            if (q && WANT[ty] && q.trim() !== WANT[ty])
              say('RAID form', 'with ' + ty + ' selected the outcome question reads "' + q.trim()
                + '" instead of "' + WANT[ty] + '" — a decision plainly happened, that is what makes it a '
                + 'decision, so asking whether it did gets the wrong answer or none');
          });
          /* ═══ WHAT WAS DECIDED, AND WHY IT HAPPENED ═══════════════════
             Two things the log could not hold. It recorded that a decision
             EXISTED and, later, whether it still stood — never WHICH OPTION was
             taken out of which others, which is the decision itself. Reported
             as "still stands is not a decision, I have to pick a b or c". And
             "Say why" opened a single description box, which collects the FIRST
             answer to why — almost always the symptom restated, and a fix aimed
             at that is a patch.
             Both are round-tripped rather than merely present on the form: a
             field the editor writes and the file drops is worse than no field,
             because the analysis looks recorded right up until somebody reopens
             the plan. */
          (() => {
            const sel = document.getElementById('rType');
            // options belong to a Decision and to nothing else
            if (sel) { sel.value = 'Risk'; raidOutcomeFormSync(); }
            const optRow = document.getElementById('rOptionsRow');
            if (!optRow) { say('RAID form', 'there is no way to record the options a decision was taken from, '
              + 'so the log holds the sentence somebody ended up with and not the choice they made'); return; }
            if (optRow.style.display !== 'none')
              say('RAID form', 'a Risk is offered "options considered" — a risk has no options, and a field '
                + 'that applies to nothing is a field nobody clears');
            if (sel) { sel.value = 'Decision'; raidOutcomeFormSync(); }
            if (optRow.style.display === 'none')
              say('RAID form', 'a Decision cannot record which option was taken');

            raidAddOptionRow('Option A'); raidAddOptionRow('Option B');
            const rows = [...document.querySelectorAll('#rOptions .raid-opt')];
            if (rows.length < 2) { say('RAID form', 'option rows cannot be added'); return; }
            /* OPTIONS WITH NONE MARKED must be objected to. It records that
               there was a choice and refuses to say which way it went, which is
               strictly less useful than writing nothing at all. */
            const hintNone = (document.getElementById('rOptionsHint') || {}).textContent || '';
            if (!/none marked as taken/i.test(hintNone))
              say('RAID form', 'two options with neither marked as taken draws no objection — the log then '
                + 'says a choice happened and not which way it went');
            rows[0].querySelector('.raid-opt-radio').checked = true;
            raidOptionsHint();
            const rd = raidOptionsRead();
            if (rd.chosen !== 0 || rd.options.length !== 2)
              say('RAID form', 'marking an option as taken reads back as ' + JSON.stringify(rd));

            /* THE FIVE WHYS IS A WIZARD, not a column of five boxes. Five
               identical fields side by side get filled top to bottom with five
               restatements of the same sentence — the value of the technique is
               that each question is BUILT FROM the previous answer and you
               cannot see the next one until you have given this one.
               So the properties are: one step at a time, a Next that advances,
               the question quoting the answer it came from, and a visible
               position in the process. Reported as "there should be a next
               button, and we should restate the question with the given answer
               explaining where the user is". */
            const whyRow = document.getElementById('rWhyRow');
            if (!whyRow) { say('RAID form', 'there is no way to record WHY something happened beyond a single '
              + 'description box, which collects the first answer and the first answer is the symptom'); return; }
            const chain = ['It slipped', 'The review took three weeks', 'Nobody owned the sign-off'];
            const stepTxt = () => ((document.querySelector('.why-step') || {}).textContent || '');
            const qTxt = () => ((document.querySelector('.why-q') || {}).textContent || '');
            const posSeen = [];
            chain.forEach((t, i) => {
              const inp = document.getElementById('rWhyIn');
              if (!inp) { say('RAID form', 'step ' + (i + 1) + ' of the why chain has no input'); return; }
              posSeen.push(stepTxt());
              /* ONE AT A TIME. Two inputs on screen means it is a form again,
                 and the reader answers the wrong question. */
              if (document.querySelectorAll('#rWhys input.mini-inp').length > 1)
                say('RAID form', 'more than one why is answerable at once — the chain then gets filled top to '
                  + 'bottom with restatements instead of being built one answer at a time');
              if (i > 0 && qTxt().indexOf(chain[i - 1]) < 0)
                say('RAID form', 'step ' + (i + 1) + ' asks "' + qTxt().slice(0, 70) + '" without quoting the '
                  + 'answer it came from — the chain then goes sideways instead of down, which is how five '
                  + 'whys produces five symptoms');
              inp.value = t;
              if (i < chain.length - 1) {
                const next = [...whyRow.querySelectorAll('button')].find(b => /ask why again/i.test(b.textContent));
                if (!next) { say('RAID form', 'there is no Next control, so the chain cannot be advanced '
                  + 'one question at a time'); return; }
                next.click();
              }
            });
            /* WHERE AM I. A wizard with no position is a series of surprises —
               the reader cannot tell whether this is the last question. */
            if (!/step\s*1\b/i.test(posSeen[0] || '') || !/step\s*3\b/i.test(stepTxt()))
              say('RAID form', 'the wizard does not say where the reader is: it read ' + JSON.stringify(posSeen)
                + ' then "' + stepTxt() + '"');
            if (!/of up to|of\s*5/i.test(stepTxt()))
              say('RAID form', 'the position does not say five is a CEILING, so it reads as a quota and gets '
                + 'padded to five');
            if (whyRow.querySelectorAll('.why-past').length < chain.length - 1)
              say('RAID form', 'the answers already given are not shown as a trail, so the reader cannot see '
                + 'the chain they are building or go back into it');
            // and it can be ended early, at any step — a chain that bottoms out at three is worth more
            const fin = [...whyRow.querySelectorAll('button')].find(b => /root cause/i.test(b.textContent));
            if (!fin) say('RAID form', 'the chain cannot be ended before step five, so a chain that genuinely '
              + 'bottoms out early gets padded to fill the form');
            else {
              fin.click();
              const rootEl = document.getElementById('rRootCause');
              if (!rootEl) say('RAID form', 'ending the chain leaves nowhere to name the root cause');
              else {
                /* ENDING COMMITS THE ANSWER FIRST. Without that, typing the last
                   link and pressing the button that names it the root cause
                   stores the conclusion and throws away the step it came from. */
                if (raidWhysRead().length !== chain.length)
                  say('RAID form', 'ending the chain kept ' + raidWhysRead().length + ' of ' + chain.length
                    + ' answers — the last one was typed and then dropped by the button that concludes it');
                if (!rootEl.value) say('RAID form', 'the root cause box is empty after concluding the chain');
                rootEl.value = 'Ownership is not assigned in the RACI';
                rootEl.dispatchEvent(new Event('input'));
              }
            }
            /* AND IT SURVIVES A SAVE AND A RELOAD. A field the editor writes and
               the file drops is worse than no field: the analysis looks recorded
               until somebody reopens the plan. */
            document.getElementById('rTitle').value = 'Probe — options and whys';
            const before = raid.length;
            saveRaidEntry();
            const e = raid[raid.length - 1];
            if (raid.length !== before + 1 || !e) say('RAID form', 'the entry did not save');
            else {
              if (!(e.options || []).length || e.chosen !== 0)
                say('RAID log', 'the saved entry lost the options or which one was taken: '
                  + JSON.stringify({ options: e.options, chosen: e.chosen }));
              if ((e.whys || []).length < 3 || !e.rootCause)
                say('RAID log', 'the saved entry lost the why chain or the root cause: '
                  + JSON.stringify({ whys: (e.whys || []).length, root: e.rootCause }));
              const round = JSON.parse(JSON.stringify(serialize()));
              const keep = raid.length;
              hydrate(round);
              const e2 = raid[raid.length - 1];
              if (raid.length !== keep || !e2 || !(e2.options || []).length || e2.chosen !== 0
                  || (e2.whys || []).length < 3 || !e2.rootCause)
                say('RAID log', 'saving the plan and loading it back drops the decision options or the why '
                  + 'chain — the analysis looks recorded right up until somebody reopens the file');
              // and the log SHOWS it, or it is a form nobody reads
              renderRaid();
              const tbl = (document.getElementById('raidContainer') || {}).innerText || '';
              if (tbl.indexOf('Option A') < 0)
                say('RAID log', 'the option that was taken does not appear in the log itself, so the analysis '
                  + 'lives only inside the editor');
              if (!/root cause/i.test(tbl))
                say('RAID log', 'the root cause does not appear in the log itself');
              raid = raid.slice(0, before);
              renderRaid();
            }
            try { closeRaidForm(); openRaidForm(); } catch (e) {}
          })();

          /* THE HELP TEXT HAS TO BE TRUE OF THE TYPE IT IS UNDER. This is the
             half that made the working control look broken: three good options
             sat under a sentence saying "until this is answered the entry is
             shown as something being watched, and it will never be offered as
             the reason a number moved", which is right for a risk and false for
             a decision — raidExplains returns true for a Decision with no
             outcome at all, and raidWatches is already false. A reader takes the
             sentence at its word and concludes the field does nothing.
             So the copy is checked AGAINST THE BEHAVIOUR rather than against
             itself: whatever the hint claims about watching and about red must
             match what raidWatches and raidIsFault actually return. */
          (() => {
            const sel = document.getElementById('rType');
            const hintEl = document.getElementById('rOutcomeHint');
            ['Risk', 'Assumption', 'Decision'].forEach(ty => {
              if (sel) { sel.value = ty; raidOutcomeFormSync(); }
              const h = ((hintEl || {}).textContent || '');
              const probe = { type: ty, outcome: '' };
              if (/being watched|never be offered as the reason/i.test(h) && !raidWatches(probe))
                say('RAID form', 'with ' + ty + ' selected and no outcome recorded, the help text says the '
                  + 'entry is being WATCHED and will never be offered as a reason — raidWatches says '
                  + 'otherwise, so the form is telling the reader the control does nothing when it does');
              if (/in red/i.test(h) && !raidIsFault({ type: ty, outcome: 'x' }) && ty === 'Decision')
                say('RAID form', 'the help text promises a ' + ty + ' will appear in RED, and raidIsFault '
                  + 'never marks one as a fault');
              if (!h.trim())
                say('RAID form', 'selecting ' + ty + ' leaves the outcome help text empty');
            });
          })();

          /* AND A DECISION IS NOT A FAULT. Every decision outcome explains, and
             raidIsFault reads `explains` — so the day Decision gained outcomes a
             decision that simply STOOD would have started painting a red fault
             chip on the activity it shaped. Good governance drawn as a defect. */
          const d = { type: 'Decision', outcome: 'stands' };
          if (raidIsFault(d))
            say('RAID log', 'a decision that still STANDS is treated as a fault, so recording good governance '
              + 'puts a red cause chip on the activity it shaped');
          if (!raidExplains(d))
            say('RAID log', 'a decision that stands explains nothing, so the reason an activity cost what it '
              + 'did cannot be attached to the decision that shaped it');
          if (raidIsFault({ type: 'Decision', outcome: 'reversed' }))
            say('RAID log', 'a REVERSED decision is drawn as a fault — a reversal is a cause, not a failure');
        })();
        try { closeRaidForm(); } catch (e) {}
      })();

      /* ── THE MARK MUST AGREE WITH THE NUMBER BESIDE IT ──────────────────
         Plan vs actual gained a meter on budget and effort and a diverging bar
         on schedule, because three columns of "$2,850 → $3,600 / +$750" forty
         rows deep are correct and unreadable — nothing about them says which
         row is the big one without arithmetic in your head.
         A bar that disagrees with its own number is worse than no bar: it is
         read FIRST and believed, and the number underneath is what gets
         doubted. So the geometry is checked against the arithmetic, not merely
         checked for existing. */
      (() => {
        switchTab('baseline'); renderBaseline();
        const host = document.getElementById('baselineContainer');
        if (!host) { say('Plan vs actual', 'the panel did not draw'); return; }
        const rows = [...host.querySelectorAll('tbody tr')].filter(r => r.querySelectorAll('.pv-td').length >= 3);
        out.pvRows = rows.length;
        if (rows.length < 3) { say('Plan vs actual', 'only ' + rows.length + ' rows carry the plan/actual '
          + 'cells, so nothing below is testing the marks'); return; }
        const px = el => el ? parseFloat(getComputedStyle(el).width) || 0 : 0;
        let over = 0, under = 0, checked = 0, wrong = 0;
        rows.forEach(r => {
          const cells = [...r.querySelectorAll('.pv-td')];
          // cell 1 is schedule (diverging), 2 budget, 3 effort (both meters)
          [cells[1], cells[2]].forEach(td => {
            if (!td) return;
            const d = td.querySelector('.pv-d');
            const txt = ((d && d.textContent) || '').trim();
            if (!txt) return;
            const mark = td.querySelector('.pv-mark');
            if (!mark || mark.classList.contains('pv-mark-none')) return;
            checked++;
            /* "+0%" and "+$0" are exactly ON the plan and draw no overrun,
               correctly. The first version tested only the leading sign and a
               narrow literal, so it read "+0%" as over and reported the product
               for behaving right — the same shape as anchoring on the artefact
               (a plus sign) instead of the property (a non-zero magnitude). */
            const mag = Math.abs(parseFloat(txt.replace(/[^\d.]/g, '')) || 0);
            const isOver = txt.charAt(0) === '+' && mag > 0;
            const overSeg = td.querySelector('.pv-over');
            const fill = td.querySelector('.pv-fill');
            if (isOver) {
              over++;
              if (!overSeg) { wrong++; say('Plan vs actual', 'a row reading "' + txt + '" draws no overrun '
                + 'past the track, so over and under look identical at a glance — which is the whole reason '
                + 'the mark is there'); }
              if (fill && !fill.classList.contains('pv-fill-over')) { wrong++;
                say('Plan vs actual', 'a row reading "' + txt + '" fills the track in the under-plan colour'); }
            } else {
              under++;
              if (overSeg && px(overSeg) > 0) { wrong++;
                say('Plan vs actual', 'a row reading "' + txt + '" draws an OVERRUN segment — it is not over'); }
            }
          });
          // the diverging mark sits on the correct side of the centre line
          const sc = cells[0];
          const sd = sc && sc.querySelector('.pv-d');
          const slip = sc && sc.querySelector('.pv-slip');
          if (sd && slip) {
            const n = parseFloat((sd.textContent || '').replace(/[^\d.-]/g, ''));
            const late = slip.classList.contains('pv-slip-late');
            if (Number.isFinite(n) && n !== 0 && ((n > 0) !== late)) {
              wrong++;
              say('Plan vs actual', 'the schedule bar for a row reading "' + (sd.textContent || '').trim()
                + '" is drawn on the ' + (late ? 'LATE' : 'EARLY') + ' side of the centre line');
            }
          }
        });
        out.pvMarksChecked = checked; out.pvOver = over; out.pvUnder = under; out.pvWrong = wrong;
        /* BOTH DIRECTIONS HAVE TO OCCUR, or the check confirms one shape and
           says nothing about the other — the vacuum this directory keeps
           finding. crm-rollout carries rows of each; if it stops, say so. */
        if (!over) say('Plan vs actual', 'no row on this plan is over its budget or estimate, so the overrun '
          + 'half of the mark was never drawn and this check only proves the under-plan case');
        if (!under) say('Plan vs actual', 'no row is under, so only the overrun case was exercised');
        /* AND THE MARKS ARE EXPLAINED. A bar with no key is a reader guessing
           at geometry — and the two geometries here mean different things on
           purpose, so guessing gets it wrong rather than merely vague. */
        /* VISIBLE, not merely present. Asserting the element exists passes on a
           key with display:none — which is no key at all to the person reading
           the table, and is exactly the artefact-instead-of-property mistake
           this suite keeps finding. Measured, because that is the only thing
           that cannot be satisfied by markup nobody sees. */
        const key = host.querySelector('.pv-key');
        const keyShown = !!(key && key.getBoundingClientRect().width > 0 && key.offsetParent !== null);
        if (!keyShown) say('Plan vs actual', 'the bars carry no VISIBLE key, so a reader has to infer that '
          + 'the track is the plan and that the schedule bar is a different geometry from the other two'
          + (key ? ' — the markup is there and is not being shown, which is the same thing to a reader' : ''));
        if (key) {
          const kt = (key.textContent || '');
          if (!/under|over/i.test(kt) || !/early|late/i.test(kt))
            say('Plan vs actual', 'the key does not cover both mark types: "' + kt.replace(/\s+/g, ' ').trim().slice(0, 80) + '"');
          if (key.querySelectorAll('.pv-mark').length < 4)
            say('Plan vs actual', 'the key names the states in words and does not SHOW them, so it teaches '
              + 'the vocabulary and not the geometry');
        }
      })();

      /* ── THE RED RING MUST SAY WHAT IT MEANS ────────────────────────────
         It lands on cells that are GREEN for complete, and a red ring on a
         finished activity reads as "done badly" — reported by someone whose
         ringed activities had all come in UNDER their estimates, who reasonably
         took the ring to be about that. It never is. It only ever means the
         RECORD of what happened is missing or impossible: a date, a booked cost,
         a RAID entry nobody closed. The legend said "record needs a second look"
         and left "record" undefined, and the reasons lived one hover at a time in
         the per-cell tooltips. */
      (() => {
        switchTab('analytics'); renderAnalytics();
        const caps = [...document.querySelectorAll('.ptr-cap')];
        const cap = caps.length ? caps[caps.length - 1].textContent.replace(/\s+/g, ' ') : '';
        const key = (document.querySelector('.ptr-strip-wrap .ptr-key') || {}).textContent || '';
        const ringed = document.querySelectorAll('.ptr-strip .ptr-flag').length;
        out.ringedCells = ringed;
        if (!ringed) { out.ringExplained = 'SKIPPED-nothing-flagged'; return; }
        out.ringExplained = true;
        // the caption must name WHY, in countable phrases, not just how many
        if (!/second look/i.test(cap))
          say('Strip', ringed + ' cells are ringed red and the caption never mentions them');
        /* A COUNTED reason: a number followed by a repeatable phrase. Matching the
           phrases alone passed on a build with the roll-up deleted, because the
           explanatory aside underneath happens to contain the same words —
           "a missing date, a cost never booked, a risk nobody closed". The
           roll-up is the thing being tested and only the count distinguishes it
           from prose about it. */
        else if (!/\d+\s+(recorded as finished|started before|ticked complete with no|part-done with no|with no three-point|with an open RAID|with a linked risk|with a risk that turned)/i.test(cap))
          say('Strip', 'the caption counts the ringed cells and names no reason — the only way to learn why '
            + 'any of them is ringed is to hover each one in turn');
        // and it must say what the ring is NOT about, because green + red ring
        // reads as "finished, but over"
        if (!/never about effort or money|not effort/i.test(cap + ' ' + key))
          say('Strip', 'nothing says the ring is about the RECORD rather than about effort or budget — a red '
            + 'ring on a green cell reads as "done badly" to anyone whose ringed activities came in under '
            + 'their estimates');
        if (!/record/i.test(key))
          say('Strip', 'the legend entry for the ring does not say what kind of thing needs a second look');
      })();

      /* ── THE CHANGES PANEL IS A SUMMARY, NOT A TRANSCRIPT ────────────────
         One re-run of the test-plan generator rewrites every test case, and this
         panel reported it as forty-four full-sentence rows — 286 characters on
         the longest, 726 pixels of prose, expanded, above every other thing on
         the tab. Reported from the live demo as "very busy and unusable", and it
         was: the diff itself where a summary belonged.

         Three properties hold it: a large diff opens CLOSED with the shape in its
         summary line, no row runs past one line on screen, and the clipping is a
         DISPLAY decision that must never reach the tooltip or the copy-out — an
         ellipsis pasted into a client email is the display fix damaging the
         export. */
      (() => {
        const host = document.getElementById('standupBody');
        if (!host) { say('Changes panel', 'the panel is not on the page'); return; }
        const before = JSON.stringify(serialize());
        dayRing = [{ date: fmtISO(new Date()), json: before }];
        const tcs = tasks.filter(t => isTestCaseTask(t) && !t.isSummary);
        if (tcs.length < 5) { out.changesPanel = 'SKIPPED-too-few-test-cases'; return; }
        const keep = tcs.map(t => ({ id: t.id, name: t.name, o: t.o, m: t.m, p: t.p }));
        tcs.forEach(t => {
          t.name = t.name.replace(/—.*/, '— rewritten by the generator with a sentence long enough that a row '
            + 'carrying it whole would run several times the width of the panel');
          t.o = +(t.o * 1.4).toFixed(2); t.m = +(t.m * 1.4).toFixed(2); t.p = +(t.p * 1.4).toFixed(2);
        });
        recompute(); renderStandup();
        const d = standupDiff(stuParse(before), serialize());
        out.changesPanel = d.total;
        const det = host.querySelector('details');
        if (!det) say('Changes panel', d.total + ' changes and the panel drew no list at all');
        else {
          if (d.total > 12 && det.open)
            say('Changes panel', d.total + ' changes are expanded by default — the diff opens on top of every '
              + 'other panel on the tab instead of summarising itself');
          const sum = (det.querySelector('summary') || {}).textContent || '';
          if (d.total > 12 && !/scope \d|estimates \d/i.test(sum))
            say('Changes panel', 'the collapsed summary does not say what KIND of change it is hiding, so the '
              + 'only way to learn the shape is to open the wall');
          det.open = true;
          const rows = [...host.querySelectorAll('.stu-li')];
          const tall = rows.filter(r => r.getBoundingClientRect().height > 30);
          out.changesRowsShown = rows.length;
          if (tall.length)
            say('Changes panel', tall.length + ' row(s) run to more than one line, e.g. "'
              + tall[0].textContent.replace(/\s+/g, ' ').trim().slice(0, 70) + '…"');
          // the clip must not reach what leaves the panel
          const txt = stuText();
          if (/\u2026/.test(txt))
            say('Changes panel', 'the copy-out carries an ellipsis — a clipped name is what someone would paste '
              + 'into a client email');
          const btn = host.querySelector('.stu-li button');
          if (btn && /\u2026/.test(btn.getAttribute('title') || ''))
            say('Changes panel', 'the tooltip is clipped too, so the full text is nowhere on the page');
          if (btn && !/\u2026/.test(btn.textContent))
            say('Changes panel', 'a row carrying a 150-character name is not clipped on screen at all');
        }
        keep.forEach(k => { const t = tasks.find(x => x.id === k.id);
          if (t) { t.name = k.name; t.o = k.o; t.m = k.m; t.p = k.p; } });
        recompute();
      })();

      /* ── THE ACTIVITY LIST SAYS WHICH QUANTITY IT IS SHOWING ────────────
         O/M/P/TE are all DURATION. Without the work beside them a reader takes
         a 3.17h activity for 3.17h of somebody's time, which at 20% it is not —
         and a phase row makes it worse, because its duration is a SPAN through
         the dependency network while the work under it is a plain sum. Two
         parallel children make the phase look like it is not rolling up. */
      (() => {
        const t = leafTasks().find(x => !x.isSummary && !x.milestone && (x.te || 0) > 0);
        const par = tasks.find(x => x.isSummary && leafDescendants(x.id).filter(y => !y.milestone).length > 1);
        if (!t) { say('Activity list', 'no leaf activity — this check is vacuous'); return; }
        const keptU = t.units, keptP = t.participants;
        t.units = 20; t.participants = null;
        calculate(); switchTab('tasks');
        const tbl = document.querySelector('#view-tasks table');
        const hdr = tbl ? [...tbl.querySelectorAll('thead th')].map(x => x.textContent.trim()) : [];
        const wi = hdr.indexOf('Work'), ti = hdr.indexOf('TE');
        out.actWorkCol = wi;
        if (wi < 0) say('Activity list', 'the table shows O/M/P/TE and no work at all — every column in it '
          + 'is a duration and nothing says so');
        const rows = tbl ? [...tbl.querySelectorAll('tbody tr')] : [];
        const bad2 = rows.filter(r => r.cells.length > 1 && r.cells.length !== hdr.length);
        if (bad2.length) say('Activity list', bad2.length + ' row(s) have a different cell count from the '
          + 'header — a column was added without every row following');
        const row = rows.find(r => r.cells[3] && r.cells[3].textContent.indexOf(t.name) >= 0);
        if (row && wi >= 0 && ti >= 0) {
          const te = row.cells[ti].textContent.trim(), wk = row.cells[wi].textContent.trim();
          out.actTE = te; out.actWork = wk;
          if (te === wk) say('Activity list', 'a 20%-allocated activity shows the same figure for duration '
            + 'and work ("' + te + '") — the work column is repeating the span');
        }
        // and a phase: duration is a span, work is a sum, and the sum is right
        if (par && wi >= 0) {
          const prow = rows.find(r => r.cells[3] && r.cells[3].textContent.indexOf(par.name) >= 0);
          const want = leafDescendants(par.id).reduce((a, x) => a + workingDaysToUnit(plannedEffortDays(x)), 0);
          if (prow) {
            const got = prow.cells[wi].textContent.trim();
            out.phaseWork = got; out.phaseWantWork = want.toFixed(2);
            const num = parseFloat(String(got).replace(/[^0-9.]/g, ''));
            if (!(want > 0)) say('Activity list', 'the phase has no work under it — this check is vacuous');
            else if (!(Math.abs(num - want) < 0.05 || /h|m\b/.test(got)))
              say('Activity list', 'a phase shows ' + got + ' of work against ' + want.toFixed(2)
                + ' in its children — work is the one column that IS a sum');
          }
        }
        t.units = keptU; t.participants = keptP; calculate();
      })();

      /* ── WORK ABOVE DURATION IS RIGHT, AND HAS TO SAY WHY ───────────────
         Allocation is the sum across everybody on the activity, so a 33-minute
         call with two people is 33 minutes of calendar and 66 person-minutes of
         work. Correct, and unreadable without a reason: the first thing anyone
         says on seeing it is "how can the duration be shorter than the work?" */
      (() => {
        const t2 = leafTasks().find(x => !x.isSummary && !x.milestone && (x.te || 0) > 0);
        if (!t2) { say('Work cell', 'no leaf activity — this check is vacuous'); return; }
        const k = { u: t2.units, a: t2.attendees, p: t2.participants };
        const other = Object.keys(resources || {}).find(n => n !== t2.owner);
        if (!other) { say('Work cell', 'the fixture has only one resource, so two-person work cannot be shown'); return; }
        t2.units = 100; t2.attendees = [{ name: other, units: 100 }]; t2.participants = null;
        calculate();
        const dur = t2.te, wk = workingDaysToUnit(plannedEffortDays(t2));
        out.twoPersonDur = dur; out.twoPersonWork = wk;
        if (!(wk > dur))
          say('Work cell', 'two people on one activity produced ' + wk + ' of work against ' + dur
            + ' of duration — allocation is being capped at 100% somewhere');
        const tip = (typeof workCellTip === 'function') ? workCellTip(t2) : '';
        out.workTip = tip.slice(0, 60);
        if (!tip) say('Work cell', 'the work cell carries no explanation at all');
        else {
          if (tip.indexOf('%') < 0) say('Work cell', 'the explanation does not state the allocation');
          if (tip.indexOf(other) < 0) say('Work cell', 'the explanation does not name who is on the activity');
          if (!/LONGER/.test(tip))
            say('Work cell', 'work exceeds duration and the explanation does not say why: "' + tip + '"');
        }
        if (workCellTip(tasks.find(x => x.milestone) || null) !== '')
          say('Work cell', 'a milestone carries a work explanation, though it holds no work');
        t2.units = k.u; t2.attendees = k.a; t2.participants = k.p; calculate();
      })();

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
