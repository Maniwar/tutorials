# The push-in

A 1920×1080 shot of a dense product screen is legible on a monitor and a grey
smear on a phone, which is where most of a LinkedIn demo gets watched. Every
scene's payoff needs to be pushed in on.

`record.js` deliberately does not ship this — where to push in is a judgement
about what the scene means, and it changes per shot. Copy the helper below into
your recording script.

## What makes it read as a camera and not a zoom control

Three moves. One move is a screen recording; three is a lens.

1. **Ease in, slow and long.** ~1.4s on an easeOutQuint (`cubic-bezier(.22,1,.36,1)`).
   A fast or linear scale reads as a browser zoom; a long decelerating one reads
   as a camera settling.
2. **Drift while it holds.** Nothing on the page is moving, so a locked-off
   frame goes dead within a second. A further ~4% over the hold, linear, keeps
   it alive. This is the Ken Burns move, and it is the part people mean when
   they say a zoom looks "fancy" rather than "zoomed in".
3. **Ease back out** on the same curve, ~1s. Never snap back to 1.0.

## The helper

```js
const EASE = 'cubic-bezier(.22,1,.36,1)';
async function pushIn(page, sel, opts = {}) {
  const k = opts.scale || 1.5;
  const inMs = opts.in || 1400, hold = opts.hold || 2400, outMs = opts.out || 1000;
  const drift = opts.drift == null ? 1.04 : opts.drift;
  const ok = await page.evaluate(({ s, k, ms, ox, oy, ease }) => {
    const el = document.querySelector(s); if (!el) return false;
    const r = el.getBoundingClientRect(), b = document.body;
    b.style.transformOrigin =
      (ox != null ? ox : (r.left + r.width / 2) / innerWidth * 100) + '% ' +
      (oy != null ? oy : (r.top + r.height / 2) / innerHeight * 100) + '%';
    b.style.transition = 'transform ' + ms + 'ms ' + ease;
    b.style.transform = 'scale(' + k + ')';
    return true;
  }, { s: sel, k, ms: inMs, ox: opts.ox ?? null, oy: opts.oy ?? null, ease: EASE });
  if (!ok) { console.error('push-in target missing: ' + sel); return false; }
  await page.waitForTimeout(inMs + 60);
  await page.evaluate(({ k, ms }) => {                       // the drift
    document.body.style.transition = 'transform ' + ms + 'ms linear';
    document.body.style.transform = 'scale(' + k + ')';
  }, { k: k * drift, ms: hold });
  await page.waitForTimeout(hold + 60);
  await page.evaluate(({ ms, ease }) => {
    document.body.style.transition = 'transform ' + ms + 'ms ' + ease;
    document.body.style.transform = 'none';
  }, { ms: outMs, ease: EASE });
  await page.waitForTimeout(outMs + 100);
  return true;
}
```

## Rules that stop it going wrong

**Scale `body`, not `documentElement`.** A transform on body makes it the
containing block for `position: fixed` children, so modals and overlays ride the
push-in correctly instead of staying pinned at 1.0 while the page grows behind
them.

**Push in to look, never to act.** The fake cursor's coordinates are page
coordinates; once the page is scaled they no longer land where they appear. Do
all clicking at 1.0, then push in on the result.

**Set the origin by hand on wide panels.** Centring on a full-width element
crops both edges equally, and most product panels put their meaning in the
left-hand column — row labels, entry titles, line items. Centring eats exactly
that. Pass `ox` (percent) to pull the origin left, ~26–40 for a full-width
table, and let the empty right-hand side be what goes.

**Keep the scale modest on dense panels.** 1.3–1.5 for a full-width table,
1.6–1.8 for a dialog, 2+ only for a single line of text. Anything more and you
are cropping content the viewer needed.

**Check a frame from the middle of the hold**, not the start:
`ffmpeg -ss 9 -i clip.webm -frames:v 1 out.jpg`. That is where the crop is
worst, because the drift has been running. If a label is cut off, lower the
scale or move `ox`, and re-record just that clip.
