# Gotchas — the things that bite when recording browser demos

Read this when something looks wrong in the output or a script won't run. Each
entry is a symptom → cause → fix, ordered roughly by how often it hits.

## Chromium discovery

**Symptom:** `browserType.launch: Executable doesn't exist at …` or Playwright
tries to download a browser (and the download is blocked behind a proxy).

**Cause:** `record.js`/`titlecard.js` call `findChromium()`, which looks at
`PW_CHROME`, then `PLAYWRIGHT_BROWSERS_PATH`, then common system paths. If none
match, Playwright falls back to its bundled binary — which may not be installed.

**Fix:** point it at a real Chromium explicitly:
```bash
export PW_CHROME=/opt/pw-browsers/chromium-*/chrome-linux/chrome   # expand the glob first
node record-demo.js
```
In this sandbox the browser is under `/opt/pw-browsers/` and
`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` is already set, so detection usually
just works. Do **not** run `playwright install` — it's blocked and unnecessary.
If you pass `executablePath` to `scene()`/`render()`, it wins over detection.

## `--no-sandbox` is mandatory here

**Symptom:** browser dies instantly with `Running as root without --no-sandbox
is not supported`.

**Cause:** Chromium refuses the setuid sandbox as root.

**Fix:** already handled — both `scene()` and `titlecard.render()` launch with
`args: ['--no-sandbox']`. If you write your own launch, include it.

## The recording has a blank first frame

**Symptom:** the clip opens on white/black for a beat before the UI appears.

**Cause:** Playwright starts the video the instant the context opens, before the
first `goto` has painted.

**Fix:** trim it at assembly time — `"trim_start": 0.25` on that clip's segment
shaves the dead head. 0.2–0.4s is typical. You can also `settle(page, 400)` right
after the first `goto` so the paint is captured cleanly rather than mid-layout.

## Cursor isn't visible / is in the wrong place

**Symptom:** no arrow in the frame, or it's parked at 0,0.

**Causes & fixes:**
- `install(page)` wasn't called after a navigation. The cursor lives in the DOM;
  a full `goto` wipes it. It re-injects automatically on `framenavigated` when
  `persist:true` (the default) — but if you swap pages via `setContent` or a
  same-doc route, call `install` again.
- You moved with raw Playwright (`page.mouse.move`) instead of the helpers. Only
  `cur.moveTo/click/type/moveToSelector` move the *visible* fake cursor; the real
  mouse is invisible in recordings. Always drive motion through the helpers.
- The selector resolved off-screen. `moveToSelector` scrolls it into view first,
  but if the element is inside its own scroll container, scroll that container in
  `page.evaluate` before the move so the payoff is actually framed.

## Menus/tooltips close before the click lands

**Symptom:** a dropdown or hover menu is half-open or already gone in the frame.

**Cause:** the eased move takes ~650ms; a menu opened on `mouseover` may collapse
during travel, or a click-opened menu re-closes when the next move starts.

**Fix:** open the menu, `settle(page, 300)`, then move+click the item as a
separate step. For hover menus, keep the cursor *inside* the menu bounds between
moves (move to the trigger, settle, move to the item — don't route through empty
space). If the app closes menus on any document click, script the item click
directly rather than clicking to dismiss.

## webm → mp4: colors or aspect look off

**Symptom:** washed-out color, or the video is letterboxed to black bars you
didn't expect.

**Causes & fixes:**
- **Color:** launch args include `--force-color-profile=srgb` so the webm and the
  x264 output agree. Keep it; without it, some builds record a wider gamut that
  shifts on convert.
- **Black bars:** the assembler pads every segment to the manifest's `width×height`
  with `force_original_aspect_ratio=decrease` + `pad`. Bars mean a clip/card was
  recorded at a *different* resolution than the manifest. Record every clip and
  render every card at the SAME W×H you put in the manifest. Mismatched canvases
  are the #1 cause of surprise letterboxing.

## deviceScaleFactor and file size / sharpness

- `deviceScaleFactor: 1` records at CSS pixels — crisp enough for 1080p landscape
  and small files. Bump to `2` only for vertical/reel shots where the UI is small
  and you want retina crispness; it roughly quadruples the pixel work and the webm
  size. Match the value across `scene()` and (if you want matching cards)
  `render()`.
- If the final mp4 is huge, raise `crf` (22 → 24/26 shrinks it) before touching
  resolution. crf 22 ≈ a few MB per minute; that's the right neighborhood.

## Emoji / icon fonts render as tofu

**Symptom:** ▯▯ boxes where the app shows emoji, or a missing brand glyph.

**Cause:** headless Chromium in a minimal container may lack a color-emoji font.

**Fix:** if the app's UI leans on emoji, install a font (`apt-get install -y
fonts-noto-color-emoji`) before recording, or avoid framing emoji-heavy chrome.
Title cards use system sans (`-apple-system, Segoe UI, Roboto…`) which is always
present; if you override `html`, stick to web-safe stacks — no external font
loads inside the card (they won't fetch reliably headless).

## `mockSSE` didn't intercept

**Symptom:** the "AI" clip hangs, errors, or hits the real API.

**Causes & fixes:**
- Registered **after** the request fired. `mockSSE` must run before the click that
  triggers the call — put it right after `install`, before any `type`/`click`.
- The URL didn't match. `match` is a substring or RegExp against the full URL;
  log `route.request().url()` once to see the real shape, then widen the pattern.
- The app doesn't read SSE. `mockSSE` returns one chunked body that works for both
  `EventSource` and `fetch`+`ReadableStream` readers, but if the app expects plain
  JSON, fulfill with a normal `{status:200, body: JSON.stringify(...)}` via your
  own `page.route` instead. If it expects a non-Anthropic SSE shape, pass full
  `event:`-prefixed strings as the `chunks` items.
- It routes **everything**. `mockSSE` installs a `page.route('**/*')` that calls
  `route.continue()` for non-matching URLs — fine for a local `file://` app, but
  if your page loads remote assets that themselves get blocked, scope the route to
  the API path instead of `**/*`.

## Timing flakiness (works once, fails once)

**Symptom:** a clip is great on one run, mistimed on the next.

**Cause:** fixed `settle` waits racing real async work (renders, layout, a chart
animation).

**Fix:** prefer waiting on a condition over a sleep — `await
page.waitForSelector('#result', {state:'visible'})` or
`page.waitForFunction(() => document.querySelector('#gantt svg'))` before the
payoff, then a short `settle` for the eye. Priming state via `page.evaluate`
(calling the app's own load function) instead of clicking through setup removes a
whole class of races.

## Headless caveats

- **Animations:** CSS transitions still run headless, but if the app gates an
  animation on `IntersectionObserver` or `requestAnimationFrame` throttling, it
  may not fire off-screen. Scroll the element into view and `settle` before you
  expect motion.
- **`prefers-reduced-motion`:** some apps disable animation under it; headless
  Chromium doesn't set it by default, so you generally get full motion — but if
  the app looks static, check it isn't detecting reduced motion.
- **Fixed/sticky headers:** they can overlap the cursor target after a scroll.
  `moveToSelector` scrolls with `block:'center'`, which usually clears sticky
  chrome; if a click lands on the header instead, scroll manually with an offset.
- **Dialogs:** `scene()` auto-accepts `beforeunload`/`alert` dialogs so they don't
  freeze the recording. If your demo *needs* to show a dialog, screenshot that
  state separately rather than relying on the native dialog in-frame.

## ffmpeg / ffprobe missing

**Symptom:** `assemble.py` raises `ffmpeg failed` immediately or `ffprobe` isn't
found.

**Fix:** `apt-get install -y ffmpeg` (ships both binaries). The npm
`ffmpeg-static` package is often blocked behind proxies — prefer the system
package. `assemble.py` shells out to `ffmpeg`/`ffprobe` on `PATH`; there's no
Python codec dependency to install.

## Voiceover / TTS

**Symptom:** `No TTS backend available`, or the narration comes out robotic, or a
voice model won't download.

**Causes & fixes:**
- **Nothing installed.** `python scripts/tts.py --list` shows what's usable.
  `apt-get install -y espeak-ng` guarantees an offline fallback so narration never
  hard-fails. That voice is robotic on purpose-of-last-resort; it's for laying out
  the edit, not for a published cut.
- **Piper voice-model download blocked.** `pip install piper-tts` gives the engine,
  but voices come from HuggingFace, which some locked-down sandboxes block at the
  proxy (a `403 Tunnel connection failed`). Two ways around it: (a) run assembly on
  a machine with open network so `python -m piper.download_voices en_US-lessac-medium
  --data-dir <dir>` succeeds once, then point `tts.piper_data_dir`/`piper_voice`
  at it; or (b) side-load a `.onnx` + `.onnx.json` you already have and set
  `tts.piper_model` to the `.onnx` path. Piper is the best *free* voice — worth the
  one-time fetch.
- **Premium voice.** Set `OPENAI_API_KEY` (voice e.g. `alloy`) or
  `ELEVENLABS_API_KEY` (+ optional `ELEVENLABS_VOICE_ID`) and `backend:"auto"` picks
  it first. These hit the network at assembly time and cost credits, but sound
  human — the right choice for anything public-facing.
- **Voice sounds cut off at a scene change.** Increase `vo_tail` (the pause kept
  after each line) so the sentence finishes before the cross-fade; the segment
  stretches to accommodate it.
- **Music drowns the voice / voice drowns music.** The music `audio_gain` defaults
  to 0.10 under narration; the sidechain ducks it further while the voice speaks.
  Lower `audio_gain` if music still competes; raise it for a livelier bed. Never
  add copyrighted tracks.
- **espeak reads punctuation oddly / a line starts with a dash.** espeak-ng
  interprets a leading `-` as a flag and `[[...]]` as raw phonemes; `tts.py`
  collapses whitespace but pass clean prose (no leading dashes, no `[[ ]]`). Spell
  out symbols the app shows as glyphs.

## Proxies / network

- Recording a **local `file://`** app needs no network — the most reliable setup.
- Recording a **remote URL** goes through whatever proxy the environment sets
  (`HTTPS_PROXY`). Chromium honors it; if assets 403/407, that's the proxy, not
  the script — see the environment's proxy README. Mock the calls you don't need
  (`mockSSE`) so a flaky upstream can't break the shoot.
- Never disable TLS verification to "fix" a recording; mock or prime instead.
