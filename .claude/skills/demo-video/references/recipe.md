# Recipe — a full worked demo (multi-chapter, mocked AI stream, music, vertical)

This is the long-form companion to `SKILL.md`. Read it when a demo needs more
than a couple of clicks: chapters, a live "AI" stream, background music, or a
vertical (story/reel) cut. Copy the patterns; don't treat the numbers as sacred.

## 1. Storyboard first (on paper)

A good demo is a script, not a click-dump. For each scene write: **state** (what
must be true before recording), **actions** (the 2–4 cursor moves), **payoff**
(the one thing to linger on), **seconds** (budget). Group scenes into acts and
put a title card at each act boundary.

Example storyboard for a planning app (landscape, LinkedIn):

| # | Card / Scene | Payoff | ~s |
|---|---|---|---|
| — | CARD "AI plan builder" | — | 2.5 |
| 1 | Paste notes → Generate plan (AI streams) | a costed plan appears | 12 |
| 2 | Open the Gantt, switch detail levels | schedule with critical path | 8 |
| — | CARD "Risk & pricing" | — | 2.5 |
| 3 | Run Monte-Carlo, commit at P80 | P80 date + reserve bar | 9 |
| 4 | Generate the SOW | client-ready document | 7 |
| — | CARD "All in one file" | — | 2.5 |

Total ≈ 56s. If a scene can't hit its payoff in budget, split or cut it.

## 2. One recording script, one scene per clip

Keep every scene independent — prime its own state at the top of `run()` so a
re-record of scene 3 never depends on scene 2. Install the cursor immediately
after the first `goto` of each scene (it also re-injects on later navigations if
you pass `persist:true`, the default).

```js
const S = '/abs/demo-video/scripts';
const rec = require(S + '/record.js'), cur = require(S + '/cursor.js'), card = require(S + '/titlecard.js');
const W = 1920, H = 1080, DIR = '/abs/scratch/demo', APP = 'file:///abs/app.html';
const clip = (name, run) => rec.scene({ out: DIR + '/clips', name, width: W, height: H, run });

(async () => {
  // ---- cards ----
  const cardOpts = { out: DIR + '/cards', width: W, height: H, accent: '#2563eb' };
  await card.render({ ...cardOpts, name: 'c1', kicker: 'CHAPTER 1', title: 'AI plan builder' });
  await card.render({ ...cardOpts, name: 'c2', kicker: 'CHAPTER 2', title: 'Risk & pricing' });

  // ---- scene 1: the AI streams a plan (mocked) ----
  await clip('01-ai', async (page) => {
    await page.goto(APP);
    await cur.install(page);
    // fake the streaming API so the clip is fast, free, deterministic:
    await rec.mockSSE(page, /\/v1\/messages|\/api\/generate/, [
      'Phase 1 — Discovery\n', 'Phase 2 — Design\n', 'Phase 3 — Build & go-live\n',
    ], { perChunkMs: 250 });
    await rec.settle(page, 500);
    await cur.type(page, '#notes', 'CRM migration for Acme; discovery, build, UAT, go-live.');
    await cur.click(page, '#generate');
    await rec.settle(page, 2500);           // let the "stream" land + render
  });

  // ---- scene 2: the Gantt ----
  await clip('02-gantt', async (page) => {
    await page.goto(APP); await cur.install(page);
    await page.evaluate(() => window.loadSample && loadSample());   // prime state directly
    await cur.click(page, '[data-tab="gantt"]');
    await rec.settle(page, 800);
    await cur.click(page, '#level-2');       // switch detail
    await rec.settle(page, 1100);
  });
  console.log('done');
})();
```

Priming state: prefer calling the app's own functions via `page.evaluate` (e.g.
`loadSample()`) over clicking through setup — it's faster and less flaky than
re-driving the UI every clip.

## 3. Mocking a live "AI" stream

Real API calls in a demo are slow, cost money, and differ every run. `mockSSE`
intercepts the request and returns Server-Sent-Events chunks on a timer, so the
UI's streaming code paints tokens on camera exactly the same each time. Default
wire format is Anthropic-style `content_block_delta`; if the app expects another
shape, pass full event strings as the chunk items (each already starting with
`event:`), or set a different `contentType`.

Register `mockSSE` **before** the click that fires the request. If the app streams
via `fetch`+`ReadableStream` rather than `EventSource`, the same `page.route`
fulfillment works — the body is delivered as one chunked response.

## 4. Title cards that match the brand

`titlecard.render` defaults to a dark brand-neutral card. To match the app, pass
`accent` (the CTA color), `bg1`/`bg2` (gradient), or override `html` entirely for
a logo lockup. Keep kicker SHORT (a label), title punchy (≤ 5 words), subtitle
optional. Cards are the demo's narration — write them like headlines.

## 5. Assemble + music

```json
{
  "out": "/abs/scratch/demo/acme.mp4",
  "width": 1920, "height": 1080, "fps": 30, "fade": 0.35, "crf": 22,
  "audio": "/abs/music/upbeat.mp3", "audio_gain": 0.16,
  "segments": [
    { "type": "card", "png": "/abs/scratch/demo/cards/c1.png", "duration": 2.5 },
    { "type": "clip", "video": "/abs/scratch/demo/clips/01-ai.webm", "trim_start": 0.3 },
    { "type": "clip", "video": "/abs/scratch/demo/clips/02-gantt.webm" },
    { "type": "card", "png": "/abs/scratch/demo/cards/c2.png", "duration": 2.5 }
  ]
}
```
`python /abs/demo-video/scripts/assemble.py manifest.json`

- `trim_start`/`trim_end` shave dead air at a clip's head/tail (recordings often
  start with a blank frame while the page paints — 0.2–0.4s trim helps).
- `speed` > 1 tightens a slow stretch (e.g. a long form fill) without re-recording.
- `fade` is the cross-fade; 0.3–0.4s reads as "produced" without feeling sludgy.
- Music is optional and looped/trimmed to length, ducked to `audio_gain`, with a
  gentle in/out. Only add royalty-free/licensed audio — never copyrighted tracks.

## 6. Vertical (story / reel) cut

For 9:16, set `width: 1080, height: 1920` everywhere — the recording viewport,
the cards, and the manifest — and re-storyboard: fewer words per card, bigger UI
(bump `deviceScaleFactor` to 2 and record a zoomed/narrower app view), one payoff
per scene. Don't just letterbox a landscape video; recompose.

## 7. Iterate cheaply

Re-record only the weak clip (same `name`), then re-run `assemble.py` — cards and
other clips are untouched. Keep the recording script and the manifest in the
scratch dir so a re-run is one command.
