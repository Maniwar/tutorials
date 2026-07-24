// cursor.js — an injectable animated fake cursor + easing helpers for recording
// smooth, human-looking product demos with Playwright.
//
// Why a FAKE cursor: Playwright's real mouse leaves no visible pointer in a
// recording, so viewers can't follow the action. We inject a CSS dot that we
// glide with easing (real mouse motion is instant/teleporting and reads as a
// glitch on video). We also hide scrollbars and the text caret so frames look
// like a polished product shot, not a browser session.
//
// Usage (Node, Playwright):
//   const cur = require('./cursor');
//   await cur.install(page);                 // inject cursor + clean-frame CSS
//   await cur.moveToSelector(page, '#save'); // glide to an element
//   await cur.click(page, '#save');          // glide, ripple, then real click
//   await cur.moveTo(page, 900, 400);        // glide to a point
//
// Every helper is await-able and paces itself for ~30fps video. Tune DUR (ms)
// per move for slower/faster demos.

// The code injected INTO the page. Kept as a string so it can go through
// addInitScript (survives navigations) or page.evaluate (one-off).
const INJECT = `
(() => {
  if (window.__demoCursorInstalled) return;
  window.__demoCursorInstalled = true;

  // clean-frame CSS: hide scrollbars + the blinking caret so recordings read
  // as product shots. (Comment out the caret rule if you WANT to show typing.)
  const style = document.createElement('style');
  style.textContent = \`
    ::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
    * { scrollbar-width: none !important; }
    html { caret-color: transparent !important; }
    #__democur {
      position: fixed; top: 0; left: 0; z-index: 2147483647; pointer-events: none;
      width: 22px; height: 22px; margin: -3px 0 0 -3px;
      filter: drop-shadow(0 2px 3px rgba(0,0,0,.35));
      transition: transform .02s linear;
    }
    #__democur svg { display: block; }
    .__demoripple {
      position: fixed; z-index: 2147483646; pointer-events: none;
      border: 2px solid rgba(37,99,235,.9); border-radius: 50%;
      width: 8px; height: 8px; margin: -4px 0 0 -4px;
      animation: __demoripple .5s ease-out forwards;
    }
    @keyframes __demoripple {
      from { opacity: .9; transform: scale(.4); }
      to   { opacity: 0;  transform: scale(4.5); }
    }\`;
  document.documentElement.appendChild(style);

  // the cursor itself — a crisp macOS-style arrow so it reads at any scale
  const cur = document.createElement('div');
  cur.id = '__democur';
  cur.innerHTML = \`<svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">
    <path d="M4 2 L4 17 L8.2 13.2 L11 19 L13.6 17.8 L10.8 12 L16 12 Z"
      fill="#fff" stroke="#111" stroke-width="1.2" stroke-linejoin="round"/></svg>\`;
  document.documentElement.appendChild(cur);
  window.__demoCurXY = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.55 };
  cur.style.transform = 'translate(' + window.__demoCurXY.x + 'px,' + window.__demoCurXY.y + 'px)';

  // called from Node to place the cursor + optionally emit a click ripple
  window.__demoCurSet = (x, y, ripple) => {
    window.__demoCurXY = { x, y };
    const c = document.getElementById('__democur');
    if (c) c.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    if (ripple) {
      const r = document.createElement('div');
      r.className = '__demoripple';
      r.style.left = x + 'px'; r.style.top = y + 'px';
      document.documentElement.appendChild(r);
      setTimeout(() => r.remove(), 550);
    }
  };
})();`;

function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

// Install the cursor on a page. Call once after the first navigation; pass
// persist:true to also register it as an init script so it re-injects on every
// subsequent navigation within the same page.
async function install(page, { persist = true } = {}) {
  if (persist) { try { await page.addInitScript(INJECT); } catch (e) {} }
  await page.evaluate(INJECT);
}

async function curPos(page) {
  return await page.evaluate(() => window.__demoCurXY || { x: 0, y: 0 });
}

// Glide the cursor to an absolute (x, y). steps/DUR control smoothness/speed.
async function moveTo(page, x, y, { dur = 650, steps = 26, ripple = false } = {}) {
  const start = await curPos(page);
  for (let i = 1; i <= steps; i++) {
    const e = easeInOut(i / steps);
    const cx = start.x + (x - start.x) * e;
    const cy = start.y + (y - start.y) * e;
    await page.evaluate(([px, py]) => window.__demoCurSet(px, py, false), [cx, cy]);
    await page.waitForTimeout(Math.max(8, dur / steps));
  }
  await page.mouse.move(x, y); // keep the REAL mouse in sync for :hover states
  if (ripple) await page.evaluate(([px, py]) => window.__demoCurSet(px, py, true), [x, y]);
}

// Glide to the center of an element (scrolls it into view first).
async function moveToSelector(page, selector, opts = {}) {
  const el = await page.waitForSelector(selector, { state: 'visible', timeout: opts.timeout || 8000 });
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(120);
  const box = await el.boundingBox();
  if (!box) throw new Error('no bounding box for ' + selector);
  await moveTo(page, box.x + box.width / 2, box.y + box.height / 2, opts);
  return el;
}

// Glide to an element, emit a click ripple, then perform the real click.
async function click(page, selector, opts = {}) {
  const el = await moveToSelector(page, selector, opts);
  const box = await el.boundingBox();
  await page.evaluate(([px, py]) => window.__demoCurSet(px, py, true),
    [box.x + box.width / 2, box.y + box.height / 2]);
  await page.waitForTimeout(160);
  await el.click();
}

// Type into a focused field at a human cadence (so viewers read it forming).
async function type(page, selector, text, { delay = 45, clickFirst = true } = {}) {
  if (clickFirst) await click(page, selector);
  await page.fill(selector, '');
  await page.type(selector, text, { delay });
}

module.exports = { INJECT, install, moveTo, moveToSelector, click, type, curPos, easeInOut };
