// titlecard.js — render a chapter / title card to a PNG the assembler turns
// into a still video segment. Cards give the demo structure ("Chapter 2:
// Pricing") and let the viewer breathe between live shots.
//
// Usage:
//   const card = require('./titlecard');
//   await card.render({
//     out: '/abs/dir/cards', name: 'c02', width: 1920, height: 1080,
//     kicker: 'CHAPTER 2', title: 'Monte-Carlo pricing',
//     subtitle: 'Bid at P80, not a coin-flip mean',
//   });  // → /abs/dir/cards/c02.png
//
// Style it by editing HTML() below (or pass `html` to fully override). The
// default is a dark, brand-neutral card that matches most product UIs; swap the
// gradient/accent for the app's palette when you know it.

const fs = require('fs');
const path = require('path');
const { req, findChromium } = require('./record');

function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

function HTML({ kicker, title, subtitle, accent = '#3b82f6', bg1 = '#0b1220', bg2 = '#1e293b', width, height }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { margin:0; box-sizing:border-box; }
    html,body { width:${width}px; height:${height}px; overflow:hidden;
      font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; }
    .card { width:100%; height:100%; display:flex; flex-direction:column; justify-content:center;
      padding:0 ${Math.round(width * 0.11)}px; color:#fff;
      background:radial-gradient(120% 120% at 20% 0%, ${bg2} 0%, ${bg1} 60%); }
    .kicker { font-size:${Math.round(height * 0.026)}px; letter-spacing:.28em; font-weight:700;
      text-transform:uppercase; color:${accent}; margin-bottom:${Math.round(height * 0.03)}px; }
    .title { font-size:${Math.round(height * 0.086)}px; font-weight:800; line-height:1.05; letter-spacing:-.02em; }
    .subtitle { font-size:${Math.round(height * 0.034)}px; font-weight:400; color:#94a3b8;
      margin-top:${Math.round(height * 0.03)}px; max-width:78%; line-height:1.4; }
    .bar { width:${Math.round(width * 0.07)}px; height:${Math.round(height * 0.008)}px; background:${accent};
      border-radius:99px; margin-top:${Math.round(height * 0.05)}px; }
  </style></head><body>
    <div class="card">
      ${kicker ? `<div class="kicker">${esc(kicker)}</div>` : ''}
      <div class="title">${esc(title)}</div>
      ${subtitle ? `<div class="subtitle">${esc(subtitle)}</div>` : ''}
      <div class="bar"></div>
    </div>
  </body></html>`;
}

async function render({ out, name, width = 1920, height = 1080, deviceScaleFactor = 1,
  kicker, title, subtitle, accent, bg1, bg2, html, executablePath } = {}) {
  const { chromium } = req('playwright');
  fs.mkdirSync(out, { recursive: true });
  const exe = executablePath || findChromium();
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--force-color-profile=srgb'], ...(exe ? { executablePath: exe } : {}) });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor });
  await page.setContent(html || HTML({ kicker, title, subtitle, accent, bg1, bg2, width, height }), { waitUntil: 'load' });
  await page.waitForTimeout(150);
  const dest = path.join(out, name + '.png');
  await page.screenshot({ path: dest });
  await browser.close();
  return dest;
}

module.exports = { render, HTML };
