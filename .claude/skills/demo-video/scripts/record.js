// record.js — Playwright recording helpers for demo videos.
//
// Records ONE clip per "scene": launch a browser with recordVideo, run your
// scene function (navigate, glide the cursor, click, type), then close the
// context so Playwright flushes the .webm to disk. One clip per scene keeps
// each shot independently re-recordable and lets the assembler cross-fade
// between them.
//
// Usage:
//   const rec = require('./record');
//   const clip = await rec.scene({
//     out: '/abs/dir/clips', name: '01-intro', width: 1920, height: 1080,
//     run: async (page) => { await page.goto('file://…'); ... }
//   });
//   // clip === '/abs/dir/clips/01-intro.webm'
//
// Chromium resolution: pass executablePath, or set PW_CHROME / the env vars in
// references/gotchas.md, or let findChromium() auto-detect the sandbox browser.

const fs = require('fs');
const path = require('path');

function req(mod) {
  // tolerate playwright OR playwright-core, installed locally or globally
  const tries = [mod, mod + '-core', 'playwright', 'playwright-core'];
  for (const t of tries) { try { return require(t); } catch (e) {} }
  for (const base of [process.cwd(), __dirname]) {
    for (const t of tries) { try { return require(path.join(base, 'node_modules', t)); } catch (e) {} }
  }
  throw new Error('playwright not found — run: npm i playwright-core');
}

// Find a Chromium executable without downloading one. Order: explicit env,
// PLAYWRIGHT_BROWSERS_PATH tree, common sandbox/system locations.
function findChromium() {
  if (process.env.PW_CHROME && fs.existsSync(process.env.PW_CHROME)) return process.env.PW_CHROME;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers', '/root/.cache/ms-playwright'].filter(Boolean);
  for (const root of roots) {
    try {
      for (const d of fs.readdirSync(root)) {
        if (!/chromium/i.test(d)) continue;
        for (const rel of ['chrome-linux/chrome', 'chrome-linux/headless_shell', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
          const p = path.join(root, d, rel);
          if (fs.existsSync(p)) return p;
        }
      }
    } catch (e) {}
  }
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']) if (fs.existsSync(p)) return p;
  return null; // let Playwright try its bundled browser
}

// Record one scene → returns the absolute .webm path.
async function scene({ out, name, width = 1920, height = 1080, deviceScaleFactor = 1,
  executablePath, run, headless = true } = {}) {
  const { chromium } = req('playwright');
  fs.mkdirSync(out, { recursive: true });
  const exe = executablePath || findChromium();
  const browser = await chromium.launch({ headless, args: ['--no-sandbox', '--force-color-profile=srgb'], ...(exe ? { executablePath: exe } : {}) });
  const context = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor,
    recordVideo: { dir: out, size: { width, height } },
  });
  const page = await context.newPage();
  page.on('dialog', d => d.accept().catch(() => {}));
  let err = null;
  try { await run(page); } catch (e) { err = e; }
  await page.waitForTimeout(250);
  const video = page.video();
  await context.close();        // flush the webm
  await browser.close();
  if (err) throw err;
  const raw = await video.path();
  const dest = path.join(out, name + '.webm');
  fs.renameSync(raw, dest);
  return dest;
}

// Fake a Server-Sent-Events / streaming response so an "AI" clip streams tokens
// on camera without a real API call (deterministic + free + fast). Call BEFORE
// the page triggers the request. `match` is a substring/RegExp of the URL.
//   await rec.mockSSE(page, /\/v1\/messages/, ['First chunk. ', 'Second chunk.']);
async function mockSSE(page, match, chunks, { perChunkMs = 60, contentType = 'text/event-stream' } = {}) {
  const test = (url) => (match instanceof RegExp ? match.test(url) : url.includes(match));
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (!test(url)) return route.continue();
    // Anthropic-style SSE by default; override `chunks` items with full event
    // strings if you need a different wire format.
    const body = chunks.map((c) => {
      if (typeof c === 'string' && c.startsWith('event:')) return c;
      return 'event: content_block_delta\ndata: ' +
        JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: c } }) + '\n\n';
    }).join('') + 'event: message_stop\ndata: {"type":"message_stop"}\n\n';
    await new Promise((r) => setTimeout(r, perChunkMs * chunks.length));
    route.fulfill({ status: 200, headers: { 'content-type': contentType }, body });
  });
}

// Wait until the page stops mutating (useful before/after big renders).
async function settle(page, ms = 500) { await page.waitForTimeout(ms); }

module.exports = { scene, mockSSE, settle, findChromium, req };
