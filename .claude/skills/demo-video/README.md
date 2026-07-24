# demo-video skill

Turn any web app or HTML page into a polished, **narrated** product-demo MP4: an
animated cursor that glides/clicks/types through the UI, chapter title cards, an
optional AI voiceover (with background music ducked underneath), and an ffmpeg
assembly with cross-fades. Claude drives it — you just ask for a demo.

See `SKILL.md` for how it works. This file is only about **where to install it**.

## Install it everywhere you use Claude Code

The skill lives in this repo (so it already works whenever you're in this repo).
To make it available in **every** project on a machine, install it at the user
level:

```bash
# from a checkout of this repo:
bash .claude/skills/demo-video/install.sh

# or straight from GitHub, on any machine:
curl -fsSL https://raw.githubusercontent.com/maniwar/tutorials/master/.claude/skills/demo-video/install.sh | bash
```

That copies the skill into `~/.claude/skills/demo-video`, which Claude Code scans
in every session regardless of the current repo. Override the location with
`DEST=/some/path bash install.sh`.

### On a cloud / web Claude Code environment

Fresh cloud sessions start from a clean container, so add the same one-liner to
your environment's **setup script** (the field where you install project deps).
Every new web session then has the skill from the first turn.

### Prerequisites (the installer reports what's missing)

- **Node + Playwright** and **ffmpeg** are required to record and assemble.
- **A TTS backend is optional** and only for voiceover: a premium API
  (`OPENAI_API_KEY` / `ELEVENLABS_API_KEY`) for a human voice, or Piper
  (`pip install piper-tts` + a voice model) for a free neural voice, or
  `espeak-ng` as an always-offline fallback. Run
  `python ~/.claude/skills/demo-video/scripts/tts.py --list` to see what's on the
  machine.

## Layout

```
demo-video/
├── SKILL.md                  how Claude uses it (the actual instructions)
├── README.md                 this file (install locations)
├── install.sh                user-level installer
├── scripts/
│   ├── cursor.js             animated fake cursor (move/click/type, ripple)
│   ├── record.js             Playwright per-scene recorder + mockSSE
│   ├── titlecard.js          chapter-card PNG renderer
│   ├── tts.py                pluggable text-to-speech (API / Piper / espeak)
│   └── assemble.py           ffmpeg stitcher: timing, ducked voiceover, music
└── references/
    ├── recipe.md             full worked multi-chapter example (+ narration)
    └── gotchas.md            Chromium, webm→mp4, TTS/voice-model, timing, proxies
```
