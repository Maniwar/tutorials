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


## Voiceover: getting a voice that doesn't sound like a robot

`espeak` is a formant synthesizer. It is useful for hearing your pacing while you
cut, and unacceptable in anything you publish — so `tts.py` never selects it
automatically. If the assembler stops with "No human-quality TTS backend
available", that guard is doing its job; install a real voice rather than forcing
the robotic one.

**edge-tts is the best free option.** `pip install edge-tts` gives Microsoft's
neural voices with no API key and no model download. Browse them with
`edge-tts --list-voices`; `en-US-AriaNeural` and `en-US-GuyNeural` are safe
narrator picks. Set it per-render with `"tts": {"backend": "edge", "voice": "en-US-AriaNeural"}`.

Two failure modes worth recognizing:

- **`CERTIFICATE_VERIFY_FAILED` / self-signed certificate.** A TLS-inspecting
  proxy sits in front of you, and `edge-tts` pins certifi's bundle so `SSL_CERT_FILE`
  is ignored. Append the proxy's CA to certifi — add a trusted CA, never disable
  verification:
  `cat /path/to/proxy-ca.crt >> "$(python -c 'import certifi;print(certifi.where())')"`
- **`403` on the websocket to `speech.platform.bing.com`.** The gateway is denying
  that host outright; no client-side fix exists. Use `OPENAI_API_KEY` /
  `ELEVENLABS_API_KEY`, or run the render somewhere with open egress.

**Piper** is the offline neural option, but its voice models come from
HuggingFace. If `huggingface.co` is blocked (common in sandboxes) the model cannot
be fetched, and no pip/npm package bundles one — `piper-tts-web` ships the runtime
and still downloads voices at run time. Fetch the `.onnx` + `.onnx.json` on an open
network and point at it with `piper_model`.


### Getting a Piper voice when HuggingFace is blocked

Piper's current voices live on HuggingFace (`rhasspy/piper-voices`), and
`python -m piper.download_voices` fetches from there. In a locked-down network
that host is often blocked outright — but **GitHub release assets frequently are
not**, and the early Piper releases published voice models as plain release
tarballs. That path needs no HuggingFace access:

    curl -fsSL -o voice.tar.gz \
      https://github.com/rhasspy/piper/releases/download/v0.0.2/voice-en-us-lessac-medium.tar.gz
    tar -xzf voice.tar.gz          # -> en-us-lessac-medium.onnx + .onnx.json

Then point the renderer at it, either explicitly:

    python scripts/tts.py --text "hello" --out vo.wav \
      --backend piper --piper-model /abs/en-us-lessac-medium.onnx

or in the manifest: `"tts": {"backend": "piper", "piper_model": "/abs/….onnx"}`.

`_piper_model()` also scans `PIPER_DATA_DIR` for `<voice>.onnx`, but that lookup
matches Piper's underscore naming (`en_US-lessac-medium.onnx`) while these older
tarballs use hyphens (`en-us-lessac-medium.onnx`). Either rename the file to the
underscore form or pass `piper_model` explicitly — the explicit path is less
surprising.

Worth probing what your network actually allows before concluding a voice is
unobtainable. A quick reachability sweep is cheap and often finds a way through:

    for H in huggingface.co github.com raw.githubusercontent.com objects.githubusercontent.com; do
      echo "$H -> $(curl -fsS -o /dev/null -w '%{http_code}' https://$H || echo BLOCKED)"
    done

A `403`/`400` on a host root does not always mean blocked — the release-asset URL
above returned 200 and downloaded 58 MB in an environment where `github.com`
itself answered 403 and every HuggingFace host and mirror was unreachable.


**Which voices are in that v0.0.2 release.** Only this one release ever shipped
voices as GitHub assets; every later release (v1.0.0+) has none, and all newer
voices — `libritts_r-medium`, `lessac-high`, `ljspeech-high`, `hfc_female-medium`
and the rest of the current `VOICES.md` catalog — are HuggingFace-only. Confirmed
downloadable from v0.0.2 (asset pattern `voice-<name>.tar.gz`):

    en-us-libritts-high     <- best of the set; audiobook-trained, natural for narration
    en-us-lessac-low / -medium
    en-us-ryan-low / -medium / -high      (male)
    en-us-amy-low, en-us-kathleen-low, en-us-danny-low
    en-gb-alan-low                        (British)

`amy-medium`, `lessac-high` and `alan-medium` are NOT in it. When you have normal
network access, skip all of this and just run
`python -m piper.download_voices en_US-libritts_r-medium` — LibriTTS-R is the
cleaned-up retrain of libritts and sounds better still.

The catalog itself is worth reading before choosing, and raw.githubusercontent is
often reachable when the rest of GitHub is not:

    curl -fsSL https://raw.githubusercontent.com/rhasspy/piper/master/VOICES.md


### Kokoro: the best offline voice, and why it survives a locked-down network

Kokoro v1.0 (82M params, 54 voices) sounds clearly better than Piper and needs no
API key. Crucially its weights are published as **GitHub release assets**, not on
HuggingFace:

    pip install kokoro-onnx soundfile
    B=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
    curl -fsSL -O $B/kokoro-v1.0.onnx    # ~311 MB
    curl -fsSL -O $B/voices-v1.0.bin     # ~27 MB

    "tts": {"backend": "kokoro", "voice": "af_heart", "kokoro_dir": "/abs/dir"}

Once those two files exist the renderer needs no network at all. Good narrator
voices: `af_heart`, `af_bella`, `af_nicole`; `am_michael`, `am_adam` (male);
`bf_emma`, `bm_george` (British). `Kokoro(model, voices).get_voices()` lists all 54.

**The general lesson.** Where a model's weights are *hosted* matters more than how
good the model is. In a restricted network, prefer projects that publish weights to
GitHub releases (reachable via `objects.githubusercontent.com`) over those that only
publish to HuggingFace. Before concluding a voice is unobtainable, check the
project's release page — several otherwise-blocked models are one `curl` away.
