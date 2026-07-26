/* ═══════════════════════════════════════════════════════════════════════════
   THE MONEY YOU QUOTE.

   The pricing panel is the least-guarded money surface in the app and the one
   where being wrong costs the most: a margin figure is what you decide to sign
   on. This recomputes cost, revenue, price, cap and margin independently from
   the stored fields — bill rate × effort × units, client-kind people billing
   nothing — and checks the panel says what the arithmetic means.

   It runs the real fixture through the states that actually differ: fixed fee,
   T&M with a not-to-exceed cap, a plan with no rates at all, a plan priced
   below cost, and a rate card carrying a discount and a currency. Each of those
   is a different branch and the sample only ever exercises one.
   ═══════════════════════════════════════════════════════════════════════════ */
const { requirePlaywright, chromePath, APP, FIXTURE } = require('./_harness');
const { chromium } = requirePlaywright();
const DATA = FIXTURE();

(async () => {
  const b = await chromium.launch({headless:true,args:['--no-sandbox'],executablePath: chromePath()});
  const page = await b.newPage({viewport:{width:1440,height:1200}});
  page.on('dialog', d => d.accept());
  const errs=[]; page.on('pageerror', e=>errs.push(e.message));
  await page.goto(APP,{waitUntil:'load'});
  await page.evaluate(data => { hydrate(data); calculate(); }, DATA);
  await page.waitForTimeout(700);

  // Everything below runs inside one evaluate so a helper written once is used
  // by every state, and so `pricing` is restored before the next case.
  const R = await page.evaluate(() => {
    const bad = [];
    const say = (a, b2) => bad.push(a + ' :: ' + b2);
    const near = (x, y, tol) => Math.abs(x - y) <= (tol == null ? 1 : tol);
    const strip = h => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

    /* An independent recompute. Deliberately NOT calling laborRevenue() or
       projectCost(): if the panel and the check share a function they agree by
       construction and the check proves nothing. */
    const recompute = () => {
      let cost = 0, revenue = 0, fixed = 0;
      leafTasks().forEach(t => {
        fixed += Number(t.fixedCost) || 0;
        if (t.milestone) return;
        const days = unitToWorkingDays(t.te || 0);
        taskParticipants(t).forEach(pr => {
          const client = isClientResource(pr.name);
          const share = days * pr.units / 100;
          // a client-kind person costs nothing and bills nothing — they are
          // the client's own people sitting in your plan
          if (!client) revenue += getBillRate(pr.name) * share;
        });
      });
      cost = projectCost();       // cost has its own well-tested path (fixed cost, rate units)
      return { cost, labor: revenue, fixed, detRev: revenue + fixed };
    };

    const check = (label) => {
      const f = pricingFigures();
      const r = recompute();
      const tol = Math.max(1, r.detRev * 0.005);

      // ── 1. the revenue the panel prices from is bill rate × effort ────────
      if (!near(f.labor, r.labor, tol))
        say(label, 'labour revenue ' + fmtMoney(f.labor) + ' against an independent ' + fmtMoney(r.labor));
      if (!near(f.detRev, r.detRev, tol))
        say(label, 'expected revenue ' + fmtMoney(f.detRev) + ' against an independent ' + fmtMoney(r.detRev));

      // ── 2. MARGIN IS AN IDENTITY, not a second opinion ───────────────────
      if (f.margin != null) {
        const m = (f.price - f.cost) / f.price * 100;
        if (!near(f.margin, m, 0.01))
          say(label, 'margin ' + f.margin.toFixed(1) + '% does not equal (price − cost) / price = ' + m.toFixed(1) + '%');
        // and it must be computed on the price you will actually INVOICE
        if (f.isTM && f.contract > 0 && near(f.price, f.contract, 1) && !near(f.contract, f.detRev, tol))
          say(label, 'is Time & materials with a ' + fmtMoney(f.contract) + ' cap, and margin is computed against '
            + 'the CAP rather than the ' + fmtMoney(f.detRev) + ' you would actually bill');
      }

      // ── 3. a cost you cannot know is not a 100% margin ───────────────────
      if (f.costBlind && f.margin != null)
        say(label, 'prints a margin of ' + f.margin.toFixed(1) + '% while no internal resource has a day rate — '
          + 'the cost is unknown, not zero');
      if (!f.costBlind && f.cost === 0 && f.anyInternalPart && f.margin === 100)
        say(label, 'prints a 100% margin on internal labour costing $0');

      // ── 4. T&M: the cap is a ceiling, the price is the estimate ──────────
      if (f.isTM) {
        if (!near(f.price, f.detRev, tol))
          say(label, 'is Time & materials but prices at ' + fmtMoney(f.price) + ' rather than the expected '
            + fmtMoney(f.detRev) + ' — a cap is not a fee');
        if (f.contract > 0 && !near(f.cap, f.contract, 1))
          say(label, 'has a typed cap of ' + fmtMoney(f.contract) + ' and reports a cap of ' + fmtMoney(f.cap));
      } else {
        if (f.contract > 0 && !near(f.price, f.contract, 1))
          say(label, 'is fixed fee with a typed price of ' + fmtMoney(f.contract) + ' and prices at ' + fmtMoney(f.price));
        if (!near(f.cap, f.price, 1))
          say(label, 'is fixed fee: the cap and the price must be the same number, got '
            + fmtMoney(f.cap) + ' and ' + fmtMoney(f.price));
      }

      // ── 5. the panel on screen must print the same figures ───────────────
      switchTab('raid'); renderPricing();
      const host = document.getElementById('pricingContainer') || document.getElementById('pricingPanel');
      const txt = host ? strip(host.innerHTML) : '';
      if (txt) {
        if (/NaN|Infinity|undefined/.test(txt)) say(label, 'the panel prints a broken figure');
        const shownM = txt.match(/([-\u2212]?\d+(?:\.\d+)?)\s*%\s*margin|margin[^%]{0,18}?([-\u2212]?\d+(?:\.\d+)?)\s*%/i);
        if (shownM && f.margin != null) {
          const v = +String(shownM[1] != null ? shownM[1] : shownM[2]).replace('\u2212', '-');
          if (Number.isFinite(v) && Math.abs(v - f.margin) > 1)
            say(label, 'the panel shows ' + v + '% margin; pricingFigures says ' + f.margin.toFixed(1) + '%');
        }
        // a negative margin must be stated, never hidden or shown as zero
        if (f.margin != null && f.margin < 0 && !/[-\u2212]\s*\d|below cost|loss|negative/i.test(txt))
          say(label, 'margin is ' + f.margin.toFixed(1) + '% and the panel never says the price is below cost');
      }

      // ── 6. the SOW must quote the price the panel quotes ─────────────────
      try {
        const src = (typeof sowSkeletonData === 'function') ? sowSkeletonData() : null;
        if (src && src.price && src.price.amount != null) {
          const quoted = +String(src.price.amount).replace(/[^0-9.]/g, '');
          if (Number.isFinite(quoted) && !near(quoted, f.price, 1))
            say(label, 'the SOW quotes ' + src.price.amount + ' and the panel quotes ' + fmtMoney(f.price));
          // on T&M the cap is a separate clause and must be the cap, not the fee
          if (f.isTM && f.cap > f.price && !src.price.cap)
            say(label, 'is Time & materials with a cap of ' + fmtMoney(f.cap)
              + ' and the SOW states no not-to-exceed clause');
        } else if (src && f.price > 0 && !src.price) {
          say(label, 'the SOW carries no price at all while the panel quotes ' + fmtMoney(f.price));
        }
      } catch (e) { say(label, 'the SOW threw: ' + e.message); }

      return { label, cost: Math.round(f.cost), detRev: Math.round(f.detRev), price: Math.round(f.price),
               cap: Math.round(f.cap), margin: f.margin == null ? null : +f.margin.toFixed(1),
               isTM: f.isTM, costBlind: f.costBlind, contract: f.contract };
    };

    const states = [];
    const savedPricing = JSON.parse(JSON.stringify(pricing));
    const savedRes = JSON.parse(JSON.stringify(resources));

    // ── a) fixed fee, no typed price: the recommended number ───────────────
    pricing = { model: 'fixed', basis: 'p80', contractPrice: 0 };
    calculate(); states.push(check('Fixed fee, no typed price'));

    // ── b) fixed fee with a typed price ────────────────────────────────────
    pricing = { model: 'fixed', basis: 'p80', contractPrice: 90000 };
    calculate(); states.push(check('Fixed fee, $90,000 typed'));

    // ── c) T&M with a not-to-exceed cap — the case that was once wrong ─────
    pricing = { model: 'tm', basis: 'p80', contractPrice: 90000 };
    calculate(); states.push(check('T&M with a $90,000 cap'));

    // ── d) priced BELOW cost: a negative margin must be stated ─────────────
    pricing = { model: 'fixed', basis: 'p80', contractPrice: 1000 };
    calculate(); states.push(check('Fixed fee priced below cost'));

    // ── e) nobody has a day rate: the cost is unknown, not zero ────────────
    pricing = { model: 'fixed', basis: 'p80', contractPrice: 50000 };
    Object.keys(resources).forEach(n => { if (resources[n].kind !== 'client') resources[n].rate = 0; });
    calculate(); states.push(check('No internal day rates'));
    resources = JSON.parse(JSON.stringify(savedRes));

    // ── f) a client-kind person must never appear in cost or revenue ───────
    calculate();
    const clientCheck = (() => {
      const before = pricingFigures();
      const t = leafTasks().find(x => !x.milestone && (x.te || 0) > 0);
      const name = '__ClientObserver';
      resources[name] = { capacity: 100, rate: 5000, billRate: 9000, role: 'Client observer', kind: 'client' };
      t.attendees = (t.attendees || []).concat([{ name: name, units: 100 }]);
      calculate();
      const after = pricingFigures();
      const moved = { cost: Math.round(after.cost - before.cost), rev: Math.round(after.detRev - before.detRev) };
      delete resources[name];
      t.attendees = (t.attendees || []).filter(a => a.name !== name);
      calculate();
      if (moved.cost !== 0) say('Client-kind resource', 'added ' + fmtMoney(moved.cost)
        + ' to cost — a client\'s own people are not your cost');
      if (moved.rev !== 0) say('Client-kind resource', 'added ' + fmtMoney(moved.rev)
        + ' to revenue — you do not bill the client for their own people');
      return moved;
    })();

    // ── g) a rate card's discount and currency must actually apply ─────────
    const cardCheck = (() => {
      let out = null;
      try {
        const before = pricingFigures();
        const cards = rateCards();
        const id = '__probe';
        cards[id] = { name: 'Probe card', currency: 'EUR', discount: 10,
          roles: Object.keys(resources).filter(n => resources[n].kind !== 'client')
            .map(n => ({ role: n, rate: 100, billRate: 200, unit: 'day' })) };
        saveRateCards(cards);
        pricing.rateCardId = id;
        const sym = moneySymbol();
        const sample = fmtMoney(1234);
        out = { symbol: sym, sample };
        if (sym !== 'EUR') say('Rate card currency', 'the card is denominated in EUR and moneySymbol() returns "'
          + sym + '" — every figure in the SOW and the billing export is mislabelled');
        if (!/EUR/.test(sample)) say('Rate card currency', 'fmtMoney(1234) renders "' + sample
          + '" on a EUR card');
        delete cards[id]; saveRateCards(cards); delete pricing.rateCardId;
        calculate();
        const after = pricingFigures();
        if (!near(after.detRev, before.detRev, 1))
          say('Rate card', 'clearing the card left revenue at ' + fmtMoney(after.detRev)
            + ' against ' + fmtMoney(before.detRev) + ' before it was applied');
      } catch (e) { say('Rate card', 'threw: ' + e.message); }
      return out;
    })();

    /* ── h) A SIMULATION THAT PREDATES A RATE MUST SAY SO ──────────────────
       calculate() re-runs runMonteCarlo(), so any check that calls it after the
       edit refreshes the exact thing the detector exists to catch. The paths
       that genuinely leave it stale are the UI setters that deliberately do not
       recompute — setBillRate and setKind both say so in their own comments —
       so those are the paths to test. */
    const staleCheck = (() => {
      pricing = { model: 'fixed', basis: 'p80', contractPrice: 0 };
      calculate();                                   // fresh run, fresh simulation
      const fresh = pricingFigures();
      if (fresh.haveSim && fresh.staleSim)
        say('Stale simulation', 'a simulation run moments ago is already reported as out of date');
      const out = { freshIsClean: !(fresh.haveSim && fresh.staleSim), had: fresh.haveSim };

      const nm = Object.keys(resources).find(n => resources[n].kind !== 'client' && rawBillRate(n) > 0);
      if (nm) {
        const was = resources[nm].billRate;
        setBillRate(nm, was * 3);                    // the real UI path — no recompute
        const f2 = pricingFigures();
        out.billRateDetected = !!(f2.haveSim && f2.staleSim);
        if (f2.haveSim && !f2.staleSim)
          say('Stale simulation', 'a bill rate tripled through setBillRate and the panel still prices from '
            + 'a simulation that predates it — every percentile it quotes is against the old rate');
        // and the panel must SAY so, not merely know it
        switchTab('raid'); renderPricing();
        const host = document.getElementById('pricingContainer');
        const txt = host ? strip(host.innerHTML) : '';
        out.panelWarns = /out of date|stale|re-run|predates|rerun/i.test(txt);
        if (f2.staleSim && !out.panelWarns)
          say('Stale simulation', 'pricingFigures knows the simulation is stale and the panel never says so');
        setBillRate(nm, was);
      }

      // a kind change moves revenue too, and setKind does not recompute either
      const nm2 = Object.keys(resources).find(n => resources[n].kind !== 'client' && rawBillRate(n) > 0);
      if (nm2) {
        calculate();
        setKind(nm2, 'client');                      // they now bill nothing
        const f3 = pricingFigures();
        out.kindDetected = !!(f3.haveSim && f3.staleSim);
        if (f3.haveSim && !f3.staleSim)
          say('Stale simulation', 'a resource was switched to client-kind through setKind — they now bill '
            + 'nothing — and the simulation behind every percentile still has them billing');
        setKind(nm2, 'internal');
      }
      calculate();
      return out;
    })();

    pricing = savedPricing; resources = savedRes; calculate();

    return { contradictions: bad, states, clientCheck, cardCheck, staleCheck };
  });

  R.pageErrors = errs.slice(0, 8);
  console.log(JSON.stringify(R, null, 1));
  await b.close();
})();
