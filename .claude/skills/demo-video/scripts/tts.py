#!/usr/bin/env python3
"""tts.py — pluggable text-to-speech for demo-video narration.

Turns a line of narration into a clean 48 kHz mono WAV, picking the best voice
backend actually available in the environment. `assemble.py` imports `synth()`;
you can also run this file directly to preview one line.

Backends, in the order `auto` prefers them:
  1. elevenlabs  — premium, human. Needs ELEVENLABS_API_KEY (+ optional
                   ELEVENLABS_VOICE_ID). Best for a real published cut.
  2. openai      — premium, human. Needs OPENAI_API_KEY. voice e.g. "alloy".
  3. piper       — neural, FREE, offline after a one-time voice-model download.
                   Great default on an open network / a dev laptop. The model
                   (~60 MB .onnx + .json) is fetched from HuggingFace, which some
                   locked-down sandboxes block — see references/gotchas.md.
  4. espeak-ng   — robotic but bulletproof, fully offline, no model download.
                   The universal fallback so a demo ALWAYS gets a voice track.

Every backend's output is normalized to 48 kHz mono WAV so the assembler mixes
them identically.

CLI (preview one line):
  python tts.py --text "Hello world." --out /tmp/vo.wav            # auto backend
  python tts.py --text "Hi." --out /tmp/vo.wav --backend espeak --voice en-us+f3
  python tts.py --list                                             # show what's available

Config dict (passed by assemble.py as manifest["tts"]):
  {
    "backend": "auto",            # or elevenlabs|openai|piper|espeak
    "voice": "...",               # backend-specific (see defaults below)
    "rate": 1.0,                  # speaking speed multiplier (all backends)
    "piper_model": "/abs/en_US-lessac-medium.onnx",  # explicit model file, or
    "piper_voice": "en_US-lessac-medium",            # + piper_data_dir to auto-load
    "piper_data_dir": "/abs/voices",
    "openai_model": "gpt-4o-mini-tts",
    "elevenlabs_model": "eleven_multilingual_v2"
  }
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request

SR = 48000  # common sample rate everything is resampled to

# ---- sensible per-backend voice defaults -----------------------------------
DEF = {
    "espeak_voice": "en-us+f3",   # a softer US voice; +m1..+f4 pick timbres
    "espeak_pitch": 42,
    "espeak_gap": 4,              # 10ms units of pause between words
    "openai_voice": "alloy",
    "openai_model": "gpt-4o-mini-tts",
    "elevenlabs_voice": "EXAVITQu4vr4xnSDxMaL",  # "Sarah", a stock ElevenLabs voice
    "elevenlabs_model": "eleven_multilingual_v2",
}


def _run(cmd, **kw):
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kw)
    if p.returncode != 0:
        raise RuntimeError((p.stderr or b"").decode("utf-8", "replace")[-1500:] or ("failed: " + " ".join(cmd[:4])))
    return p


def _ffmpeg():
    exe = shutil.which("ffmpeg")
    if not exe:
        raise RuntimeError("ffmpeg not found — apt-get install -y ffmpeg")
    return exe


def _to_wav(src, dst):
    """Resample/repack any audio the backend produced into 48 kHz mono WAV."""
    _run([_ffmpeg(), "-y", "-i", src, "-ar", str(SR), "-ac", "1", "-c:a", "pcm_s16le", dst])
    return dst


def _piper_model(cfg):
    """Resolve a Piper .onnx model path, or return None if none is available."""
    m = cfg.get("piper_model")
    if m and os.path.exists(m):
        return m
    voice = cfg.get("piper_voice") or "en_US-lessac-medium"
    ddir = cfg.get("piper_data_dir")
    for base in [ddir, os.environ.get("PIPER_DATA_DIR"), ".", os.path.expanduser("~/.local/share/piper")]:
        if not base:
            continue
        cand = os.path.join(base, voice + ".onnx")
        if os.path.exists(cand):
            return cand
    return None


def available():
    """Report which backends can run right now (for --list and auto)."""
    return {
        "elevenlabs": bool(os.environ.get("ELEVENLABS_API_KEY")),
        "openai": bool(os.environ.get("OPENAI_API_KEY")),
        "piper": bool(shutil.which("piper")) and _piper_model({}) is not None,
        "espeak": bool(shutil.which("espeak-ng") or shutil.which("espeak")),
    }


def pick_backend(cfg):
    b = (cfg.get("backend") or "auto").lower()
    if b != "auto":
        return b
    if os.environ.get("ELEVENLABS_API_KEY"):
        return "elevenlabs"
    if os.environ.get("OPENAI_API_KEY"):
        return "openai"
    if shutil.which("piper") and _piper_model(cfg):
        return "piper"
    if shutil.which("espeak-ng") or shutil.which("espeak"):
        return "espeak"
    raise RuntimeError(
        "No TTS backend available. Install one:\n"
        "  apt-get install -y espeak-ng           # always-works fallback\n"
        "  pip install piper-tts                   # neural, needs a voice model\n"
        "  export OPENAI_API_KEY=... (or ELEVENLABS_API_KEY=...)  # premium")


# ---- backends ---------------------------------------------------------------
def _espeak(text, out, cfg, tmp):
    exe = shutil.which("espeak-ng") or shutil.which("espeak")
    voice = cfg.get("voice") or DEF["espeak_voice"]
    # espeak speed is words/min ~80..450; map rate 1.0 -> 158 wpm
    wpm = int(round(158 * float(cfg.get("rate", 1.0))))
    wpm = max(80, min(300, wpm))
    raw = os.path.join(tmp, "espeak.wav")
    # espeak-ng reads "[[...]]" as raw phoneme codes — neutralize so narration is
    # spoken literally; "--" ends option parsing so a line starting with "-"
    # (e.g. "-50% today") isn't mistaken for a flag.
    safe = text.replace("[[", "[ [").replace("]]", "] ]")
    _run([exe, "-v", voice, "-s", str(wpm), "-p", str(cfg.get("espeak_pitch", DEF["espeak_pitch"])),
          "-g", str(cfg.get("espeak_gap", DEF["espeak_gap"])), "-w", raw, "--", safe])
    return _to_wav(raw, out)


def _piper(text, out, cfg, tmp):
    model = _piper_model(cfg)
    if not model:
        raise RuntimeError("piper: no voice model found (set piper_model / piper_voice+piper_data_dir, "
                           "or `python -m piper.download_voices en_US-lessac-medium --data-dir <dir>`)")
    raw = os.path.join(tmp, "piper.wav")
    cmd = ["piper", "-m", model, "-f", raw]
    # piper length_scale: >1 = slower. rate is speed, so invert.
    if float(cfg.get("rate", 1.0)) != 1.0:
        cmd += ["--length-scale", f"{1.0/float(cfg['rate']):.3f}"]
    _run(cmd, input=text.encode("utf-8"))
    return _to_wav(raw, out)


def _http_post(url, data, headers):
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({"https": proxy, "http": proxy}) if proxy else urllib.request.BaseHandler())
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with opener.open(req, timeout=120) as r:
        return r.read()


def _openai(text, out, cfg, tmp):
    key = os.environ["OPENAI_API_KEY"]
    body = json.dumps({
        "model": cfg.get("openai_model", DEF["openai_model"]),
        "voice": cfg.get("voice", DEF["openai_voice"]),
        "input": text, "response_format": "wav",
        "speed": max(0.25, min(4.0, float(cfg.get("rate", 1.0)))),  # OpenAI accepts 0.25–4.0
    }).encode()
    audio = _http_post("https://api.openai.com/v1/audio/speech", body,
                       {"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    raw = os.path.join(tmp, "openai.wav")
    open(raw, "wb").write(audio)
    return _to_wav(raw, out)


def _elevenlabs(text, out, cfg, tmp):
    key = os.environ["ELEVENLABS_API_KEY"]
    voice_id = cfg.get("voice") or os.environ.get("ELEVENLABS_VOICE_ID") or DEF["elevenlabs_voice"]
    body = json.dumps({
        "text": text,
        "model_id": cfg.get("elevenlabs_model", DEF["elevenlabs_model"]),
    }).encode()
    audio = _http_post(f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128",
                       body, {"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"})
    raw = os.path.join(tmp, "eleven.mp3")
    open(raw, "wb").write(audio)
    return _to_wav(raw, out)


_BACKENDS = {"espeak": _espeak, "piper": _piper, "openai": _openai, "elevenlabs": _elevenlabs}


def synth(text, out, cfg=None):
    """Render `text` to `out` (48 kHz mono WAV). Returns out. Raises on failure."""
    cfg = dict(cfg or {})
    text = " ".join(str(text).split())  # collapse whitespace/newlines
    if not text:
        raise ValueError("empty narration text")
    backend = pick_backend(cfg)
    fn = _BACKENDS.get(backend)
    if not fn:
        raise RuntimeError("unknown TTS backend: " + backend)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="tts_")
    return fn(text, out, cfg, tmp)


def _cli():
    import argparse
    ap = argparse.ArgumentParser(description="Preview one line of demo narration.")
    ap.add_argument("--text"); ap.add_argument("--out")
    ap.add_argument("--backend", default="auto"); ap.add_argument("--voice")
    ap.add_argument("--rate", type=float, default=1.0)
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args()
    if a.list:
        av = available()
        print("TTS backends available here:")
        for k, v in av.items():
            print(f"  {'✓' if v else '·'} {k}")
        print("auto would pick:", pick_backend({}) if any(av.values()) else "(none)")
        return
    if not a.text or not a.out:
        ap.error("--text and --out are required (or use --list)")
    cfg = {"backend": a.backend, "rate": a.rate}
    if a.voice:
        cfg["voice"] = a.voice
    out = synth(a.text, a.out, cfg)
    print("wrote", out, "via", pick_backend(cfg))


if __name__ == "__main__":
    _cli()
