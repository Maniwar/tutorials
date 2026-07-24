---
name: demo-video
description: >-
  Produce a polished animated product-demo / walkthrough VIDEO of a web app or
  HTML page — a screen recording with a smooth animated cursor that clicks and
  types through the UI, chapter title cards, optional AI VOICEOVER NARRATION, and
  an MP4 stitched together with cross-fades. Use this whenever the user wants a
  demo video, product walkthrough, screen recording, promo/marketing clip, "show
  it in action" video, a LinkedIn/Twitter/launch demo, an animated GIF-style tour,
  a narrated or voiced-over demo, or asks to "record", "film", "capture a demo
  of", "add a voiceover to", or "make a video of" a web app, site, dashboard, or
  HTML file — even if they don't say the word "video". Works on any URL or local
  HTML file. Not for editing pre-existing footage and not for native mobile apps.
---

# Demo Video

Turn any web app into a crisp, narrated-by-motion demo video: the mouse glides
(never teleports) to each control, clicks with a ripple, types at a human
cadence, pauses on the payoff, and chapter cards give the whole thing
structure. Add a line of narration per scene and an AI voice reads it while the
video stretches to fit — with background music ducking politely underneath. You
write a short recording script per scene (this skill hands you the hard parts —
the animated cursor, the recorder, the voiceover, the ffmpeg assembly — so you
never reinvent easing curves, sidechain ducking, or codec flags).

## When to reach for this
Any request for a moving picture of a web UI: "make a demo video for LinkedIn",
"record a walkthrough of the dashboard", "film the signup flow", "show the app
in action", "a 60-second product tour", "capture this HTML as a video". If they
want a single screenshot, just screenshot; if they want motion, use this.

## Prerequisites (check first)
- **Node + Playwright**: `node -e "require('playwright-core')"` — if it fails,
  `npm i playwright-core` in the working dir.
- **A Chromium binary** (do NOT download one): `record.js` auto-detects it via
  `PLAYWRIGHT_BROWSERS_PATH` / common paths. In sandboxes it's typically at
  `/opt/pw-browsers/…/chrome-linux/chrome`. If detection fails, set
  `PW_CHROME=/abs/path/to/chrome`. See `references/gotchas.md`.
- **ffmpeg + ffprobe**: `ffmpeg -version`. If missing: `apt-get install -y ffmpeg`
  (npm `ffmpeg-static` is often blocked behind proxies — prefer the system pkg).
- **A human-quality TTS backend — required for voiceover.** Run
  `python scripts/tts.py --list` to see what's available. A robotic synth is
  never selected automatically: a demo you publish with a formant voice reads as
  cheap, and no amount of good motion design recovers it. In order of preference:
  1. **`pip install edge-tts`** — free, no API key, genuinely human Microsoft
     neural voices (`en-US-AriaNeural`, `en-US-GuyNeural`, …; browse with
     `edge-tts --list-voices`). Needs outbound HTTPS to `speech.platform.bing.com`
     — some locked-down sandboxes block it.
  2. **`OPENAI_API_KEY` / `ELEVENLABS_API_KEY`** — best control over delivery,
     and works anywhere HTTPS to the vendor is allowed.
  3. **Piper** (`pip install piper-tts` + a voice model) — offline neural; the
     model comes from HuggingFace, which some sandboxes block.

  espeak-ng exists ONLY to hear your timing back while editing. Ask for it
  explicitly (`--backend espeak`, or `allow_robotic: true` in the manifest) and
  never ship it. See `references/gotchas.md`.
- **A scratch dir** for `clips/`, `cards/`, and the manifest — use the session
  scratchpad, not the repo.

## The workflow
Work one scene at a time; a scene = one continuous shot = one `.webm` clip. Small
independent clips are re-recordable and let the assembler cross-fade between them.

1. **Storyboard (do this before coding).** List 6–12 scenes: for each, the
   target URL/state, the 2–4 cursor actions, and the ONE payoff to linger on.
   Add chapter cards between acts. Confirm the storyboard with the user if the
   app or message is ambiguous — a wrong storyboard wastes a lot of recording.
2. **Prime the app state** the scene needs (e.g. load sample data) at the top of
   each scene's `run()`, so every clip is self-contained and deterministic.
3. **Record each scene** with `record.scene({...})`, using `cursor.js` to move,
   click, and type. Install the cursor right after the first `page.goto`.
4. **Mock any network the demo shouldn't really hit** (AI streaming, slow APIs)
   with `record.mockSSE` so clips are fast, free, and identical every run.
5. **Render title cards** with `titlecard.render(...)`.
6. **Write narration (optional but recommended).** Add a `narration` line to any
   card/clip segment in the manifest. Don't time your recording to a script — the
   assembler synthesizes each line and **stretches that segment to fit its voice**
   (a clip freezes its last frame to fill), so you write the line and the video
   accommodates it. Keep each line to one breath; let the payoff land under it.
7. **Assemble** all cards + clips, in order, via `assemble.py` + a manifest.
   Narration is rendered here, laid over the video, and any background music is
   auto-ducked beneath the voice.
8. **QA the output** (see checklist) and iterate on any weak scene by
   re-recording just that clip and re-running assembly.

## Using the bundled engine
All four live in `scripts/`. Require the JS ones from a recording script; run the
Python one on a manifest.

- **`scripts/cursor.js`** — the animated fake cursor + easing. `install(page)`,
  `moveToSelector(page, sel)`, `click(page, sel)`, `type(page, sel, text)`,
  `moveTo(page, x, y)`. It also hides scrollbars + the text caret so frames look
  like product shots. Tune move speed with `{dur: ms}`.
- **`scripts/record.js`** — `scene({out, name, width, height, run})` records one
  clip and returns its `.webm` path; `mockSSE(page, urlMatch, chunks)` fakes a
  streaming response; `findChromium()` locates the browser.
- **`scripts/titlecard.js`** — `render({out, name, kicker, title, subtitle})`
  writes a title-card PNG (dark, brand-neutral; edit `HTML()` or pass `accent`/
  `bg1`/`bg2` to match the app's colors).
- **`scripts/assemble.py`** — `python scripts/assemble.py manifest.json` stitches
  cards + clips into the final MP4 (scale-to-fit + pad, per-segment cross-fade,
  x264 + faststart, optional background music). Also renders per-segment
  `narration`, stretches each segment to fit its voice, ducks music under the
  voiceover (sidechain), and loudness-normalizes the mix. Manifest schema is
  documented at the top of the file.
- **`scripts/tts.py`** — pluggable text-to-speech behind the narration. Picks the
  best backend available (ElevenLabs/OpenAI API → Piper neural → espeak-ng) and
  returns a clean 48 kHz WAV. `python scripts/tts.py --list` shows what's on this
  machine; `--text "…" --out vo.wav` previews one line. `assemble.py` calls it for
  you — you rarely invoke it directly.

Point at the scripts with absolute paths (they work whether the skill is a repo
skill or installed personally). Copy them next to your recording script if you
prefer, but don't edit the originals.

## Minimal end-to-end example
```js
// record-demo.js  (run with: node record-demo.js)
const SKILL = '/abs/path/to/demo-video/scripts';       // where this skill lives
const rec = require(SKILL + '/record.js');
const cur = require(SKILL + '/cursor.js');
const card = require(SKILL + '/titlecard.js');
const W = 1920, H = 1080, OUT = '/abs/scratch/demo';
const APP = 'file:///abs/path/app.html';                // or an https URL

(async () => {
  await card.render({ out: OUT + '/cards', name: 'c00', width: W, height: H,
    kicker: 'PRODUCT DEMO', title: 'Acme Planner', subtitle: 'Plan a project in 60 seconds' });

  await rec.scene({ out: OUT + '/clips', name: '01-open', width: W, height: H, run: async (page) => {
    await page.goto(APP); await cur.install(page); await rec.settle(page, 600);
    await cur.click(page, '#load-sample');           // glide + ripple + click
    await rec.settle(page, 900);                     // linger on the result
  }});

  await rec.scene({ out: OUT + '/clips', name: '02-edit', width: W, height: H, run: async (page) => {
    await page.goto(APP); await cur.install(page);
    await cur.type(page, '#project-name', 'Website relaunch');
    await cur.click(page, '#calculate'); await rec.settle(page, 1200);
  }});
  console.log('clips done');
})();
```
```json
// manifest.json → python scripts/assemble.py manifest.json
// Add "narration" to any segment for voiceover; add "audio" for music (it ducks
// under the voice automatically). Omit both for a silent video (original behavior).
{ "out": "/abs/scratch/demo/acme-demo.mp4", "width": 1920, "height": 1080,
  "fps": 30, "fade": 0.35, "crf": 22,
  "tts": { "backend": "auto" },
  "segments": [
    { "type": "card", "png": "/abs/scratch/demo/cards/c00.png", "duration": 2.6,
      "narration": "Meet Acme Planner." },
    { "type": "clip", "video": "/abs/scratch/demo/clips/01-open.webm",
      "narration": "Load a sample and the whole plan is ready to work with." },
    { "type": "clip", "video": "/abs/scratch/demo/clips/02-edit.webm",
      "narration": "Rename the project, recalculate, and the schedule updates live." }
  ] }
```

## Craft rules that make it read as "world-class", not a screen grab
- **Motion is eased, never instant.** Always move the cursor with the helpers;
  a jump-cut mouse looks broken. Default `dur` ~650ms; slow big travels.
- **Linger on the payoff.** After the click that produces the result, `settle`
  0.8–1.5s so the viewer's eye lands. Dead-fast demos feel like glitches.
- **One idea per scene.** If a scene needs three clicks to explain, it's two
  scenes. Cards carry the narration the voice-over would.
- **Compose the shot.** Scroll the payoff into frame before recording it; don't
  make the cursor chase content off-screen.
- **Consistent canvas.** Pick one resolution (1920×1080 landscape for LinkedIn/
  YouTube; 1080×1920 for stories/reels) and keep every clip + card identical —
  the assembler pads mismatches to black, which you don't want.
- **Keep it tight.** 60–150s total for a product demo. Cut scenes that don't earn
  their seconds.
- **Let the voice lead, not the clock.** With narration on, write the line first
  and let the segment stretch to it — don't crop a sentence to fit a clip. One
  idea per line, conversational, active voice ("Paste your notes and a plan
  appears"), and leave the last ~0.5s of each line to breathe before the cut. For
  a published cut use Piper or an API voice; espeak is for proving the edit.

## QA checklist (before you call it done)
Extract a few frames and actually look at them — recordings lie in ways logs
don't. `ffmpeg -i out.mp4 -vf fps=1/3 /tmp/qa_%03d.png` then read them.
- Cursor visible and on the right control in every action frame.
- No half-open menus, no clipped modals, no scrollbar, no blinking caret.
- Payoff of each scene is fully in frame.
- Card text has no typos and matches the app's story.
- Transitions don't cut mid-motion; total length matches the brief.
- File plays (has `+faststart`) and is a sane size (≈ crf 22 → a few MB/min).
- **If narrated:** the voice is a HUMAN-quality backend (edge/openai/elevenlabs/piper) —
  if it sounds robotic, stop and fix the backend rather than shipping it. There's a
  real audio stream (`ffprobe -select_streams a:0 …`),
  it's 48 kHz, and the length matches (segments stretch to fit their voice, so a
  narrated demo is usually longer than the raw clips). Play it or at least check
  `ffmpeg -i out.mp4 -af volumedetect -f null -` for a sane level (max near the
  loudness target, not 0 dB clipping). Confirm the voice isn't cut off at a cut
  and music sits *under* it, not over it. Robotic espeak voice = install Piper or
  set an API key for the real cut (see prerequisites).

## Deeper docs
- `references/recipe.md` — a full worked multi-chapter example (incl. mocking an
  AI stream, vertical/story format, and background music).
- `references/gotchas.md` — Chromium discovery, webm→mp4 quirks, proxies,
  deviceScaleFactor, fonts/emoji, timing flakiness, and headless caveats.
