#!/usr/bin/env python3
"""assemble.py — stitch recorded clips + title cards into one polished MP4,
optionally with an AI voiceover narration track (and background music ducked
under it).

Manifest-driven so Claude just describes the running order. Each segment is
normalized to a common canvas (scale-to-fit + pad + fps), gets a short
cross-fade in/out, and the pieces are concatenated. Title-card PNGs become
still segments. If a segment has `narration`, the voice is synthesized (see
tts.py) and — this is the point — the SEGMENT IS STRETCHED to fit the voice
(freezing a clip's last frame if needed), so you never have to time your
recording to a script. Voiceover sits on top; music auto-ducks under it.

Usage:
    python assemble.py manifest.json

Manifest schema:
{
  "out": "/abs/path/demo.mp4",
  "width": 1920, "height": 1080, "fps": 30,
  "fade": 0.35,          // per-segment fade in/out seconds (0 to disable)
  "crf": 22,             // x264 quality (lower = better/bigger; 18-24 typical)

  // --- audio (all optional) ---
  "audio": "/abs/music.mp3",   // background music; looped/trimmed, ducked under VO
  "audio_gain": 0.18,          // music volume 0..1 (default 0.18; auto-lowered to
                               //   0.10 when narration is present)
  "tts": { "backend": "auto", "voice": "...", "rate": 1.0 },  // see tts.py
  "vo_head": 0.35,             // seconds of lead-in before a segment's VO starts
  "vo_tail": 0.55,             // seconds of tail kept after the VO ends
  "loudness": -16,             // integrated LUFS target for the final mix

  "segments": [
    {"type":"card", "png":"/abs/cards/c01.png", "duration":2.5,
       "narration":"Meet Engagement Planner."},          // card held >= voice length
    {"type":"clip", "video":"/abs/clips/01.webm",
       "narration":"Paste your notes and a costed plan appears.",
       "trim_start":0.2, "trim_end":0.0, "speed":1.0},
    {"type":"clip", "video":"/abs/clips/02.webm",
       "voice":"/abs/vo/02.wav"}                          // pre-rendered VO, no TTS
  ]
}

Requires ffmpeg + ffprobe on PATH. Narration additionally needs tts.py's chosen
backend (espeak-ng always works offline; see tts.py --list).
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)


def run(cmd):
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode != 0:
        sys.stderr.write(p.stderr.decode("utf-8", "replace")[-4000:])
        raise SystemExit("ffmpeg failed: " + " ".join(cmd[:6]) + " …")
    return p


def probe_duration(path):
    p = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", path],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        return float(p.stdout.decode().strip())
    except Exception:
        return 0.0


def vf_canvas(W, H, fps):
    return (f"scale={W}:{H}:force_original_aspect_ratio=decrease,"
            f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=black,"
            f"fps={fps},setsar=1,format=yuv420p")


def with_fades(vf, dur, fade):
    if fade and fade > 0 and dur > 2 * fade:
        vf = vf + f",fade=t=in:st=0:d={fade},fade=t=out:st={max(0,dur-fade):.3f}:d={fade}"
    return vf


def clip_natural(seg):
    """Playing duration of a clip segment after trims + speed (no padding)."""
    raw = probe_duration(seg["video"])
    ss = float(seg.get("trim_start", 0) or 0)
    te = float(seg.get("trim_end", 0) or 0)
    speed = float(seg.get("speed", 1.0) or 1.0)
    end = max(0.0, raw - te)
    return max(0.0, (end - ss) / (speed or 1.0))


def normalize_clip(seg, W, H, fps, fade, crf, tmp, idx, min_dur=0.0):
    src = seg["video"]
    ss = float(seg.get("trim_start", 0) or 0)
    te = float(seg.get("trim_end", 0) or 0)
    speed = float(seg.get("speed", 1.0) or 1.0)
    raw = probe_duration(src)
    end = max(0.0, raw - te)
    natural = max(0.0, (end - ss) / (speed or 1.0))
    target = max(natural, float(min_dur or 0.0))
    vf = ""
    if speed and speed != 1.0:
        vf = f"setpts={1.0/speed:.4f}*PTS,"
    vf += vf_canvas(W, H, fps)
    extra = target - natural
    if extra > 0.05:                       # hold the last frame so VO can finish
        vf += f",tpad=stop_mode=clone:stop_duration={extra:.3f}"
    vf = with_fades(vf, target, fade)
    out = os.path.join(tmp, f"seg{idx:03d}.mp4")
    # Trim on the INPUT side (-ss/-t before -i) so it happens in SOURCE time,
    # before the setpts speed change — otherwise an output-side -to would be
    # measured on the sped-up timeline and truncate slow-mo / under-trim fast-mo.
    cmd = ["ffmpeg", "-y"]
    if ss > 0:
        cmd += ["-ss", f"{ss:.3f}"]
    if te > 0:
        cmd += ["-t", f"{end - ss:.3f}"]
    cmd += ["-i", src]
    cmd += ["-an", "-vf", vf, "-c:v", "libx264", "-crf", str(crf),
            "-preset", "medium", "-pix_fmt", "yuv420p", out]
    run(cmd)
    return out, probe_duration(out)


def normalize_card(seg, W, H, fps, fade, crf, tmp, idx, dur):
    vf = with_fades(vf_canvas(W, H, fps), dur, fade)
    out = os.path.join(tmp, f"seg{idx:03d}.mp4")
    run(["ffmpeg", "-y", "-loop", "1", "-t", f"{dur:.3f}", "-i", seg["png"],
         "-vf", vf, "-c:v", "libx264", "-crf", str(crf), "-preset", "medium",
         "-pix_fmt", "yuv420p", out])
    # return the PROBED length (fps rounding makes it differ slightly from the
    # nominal dur) so VO delays computed from cumulative starts don't drift.
    return out, probe_duration(out)


def synth_narration(segments, tts_cfg, audio_dir):
    """Render VO for any segment with `narration`; attach wav path + duration.
    Returns True if any segment has voice. Raises on synth failure (never silent).
    """
    have = False
    voiced = [s for s in segments if s.get("narration") or s.get("voice")]
    if not voiced:
        return False
    # A manifest that only uses pre-rendered `voice` files must NOT require a TTS
    # backend — only import/resolve one when some line actually needs synthesis.
    needs_synth = any(s.get("narration") and not s.get("voice") for s in segments)
    tts = None
    os.makedirs(audio_dir, exist_ok=True)
    if needs_synth:
        import tts as tts  # noqa: F811  (lazy: no-synth runs never need a backend)
        print(f"  narration: {len(voiced)} line(s) via '{tts.pick_backend(tts_cfg)}' backend")
    else:
        print(f"  narration: {len(voiced)} pre-rendered voice file(s)")
    for i, seg in enumerate(segments):
        wav = seg.get("voice")
        if wav:
            if not os.path.exists(wav):
                raise SystemExit(f"segment {i}: voice file not found: {wav}")
        elif seg.get("narration"):
            wav = os.path.join(audio_dir, f"vo_{i:03d}.wav")
            tts.synth(seg["narration"], wav, tts_cfg)
        else:
            continue
        seg["_vo"] = wav
        seg["_vo_dur"] = probe_duration(wav)
        have = True
    return have


def build_audio(silent, parts_durs, segments, m, tmp, out):
    """Mux the narration (+ optional ducked music) under the concatenated video."""
    total = sum(parts_durs)
    head = float(m.get("vo_head", 0.35))
    tail = float(m.get("vo_tail", 0.55))
    music = m.get("audio")
    # a requested-but-missing music path is a mistake, not "no music" — fail loud
    if music and not os.path.exists(music):
        raise SystemExit(f"music (audio) file not found: {music}")
    has_music = bool(music)
    loud = float(m.get("loudness", -16))

    # cumulative start time of each segment in the final timeline
    starts, acc = [], 0.0
    for d in parts_durs:
        starts.append(acc)
        acc += d

    # gather VO inputs with their delay into the timeline
    inputs, vos = ["-i", silent], []
    in_idx = 1
    for i, seg in enumerate(segments):
        if seg.get("_vo"):
            inputs += ["-i", seg["_vo"]]
            delay_ms = int(round((starts[i] + head) * 1000))
            vos.append((in_idx, delay_ms))
            in_idx += 1

    if not vos:
        # no narration → preserve the original music-only / silent behavior
        if has_music:
            gain = float(m.get("audio_gain", 0.18))
            af = (f"volume={gain},afade=t=in:st=0:d=1.2,"
                  f"afade=t=out:st={max(0,total-1.5):.2f}:d=1.5")
            run(["ffmpeg", "-y", "-i", silent, "-stream_loop", "-1", "-i", music,
                 "-filter:a", af, "-map", "0:v:0", "-map", "1:a:0", "-shortest",
                 "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
                 "-movflags", "+faststart", out])
        else:
            shutil.move(silent, out)   # cross-device safe (tmpfs /tmp → real out)
        return total

    fc = []
    for k, (idx_in, delay) in enumerate(vos):
        fc.append(f"[{idx_in}:a]adelay={delay}:all=1[v{k}]")
    vlabels = "".join(f"[v{k}]" for k in range(len(vos)))
    if len(vos) == 1:
        fc.append(f"[v0]apad=whole_dur={total:.3f}[vo]")
    else:
        fc.append(vlabels + f"amix=inputs={len(vos)}:duration=longest:normalize=0,"
                            f"apad=whole_dur={total:.3f}[vo]")

    if has_music:
        gain = float(m.get("audio_gain", 0.10))   # quieter under a voice
        inputs += ["-stream_loop", "-1", "-i", music]
        music_idx = in_idx
        # a filter-graph label is consumed on first use, and the voice is needed
        # twice (as the duck sidechain key AND in the final mix) — so split it.
        fc.append("[vo]asplit=2[vokey][vomix]")
        fc.append(f"[{music_idx}:a]volume={gain},afade=t=in:st=0:d=1.2,"
                  f"afade=t=out:st={max(0,total-1.5):.2f}:d=1.5,"
                  f"atrim=0:{total:.3f}[mus]")
        # duck the music whenever the voice is speaking
        fc.append("[mus][vokey]sidechaincompress=threshold=0.02:ratio=12:attack=15:"
                  "release=350[duck]")
        fc.append(f"[duck][vomix]amix=inputs=2:duration=first:normalize=0,"
                  f"loudnorm=I={loud}:TP=-1.5:LRA=11,aresample=48000[outa]")
    else:
        fc.append(f"[vo]loudnorm=I={loud}:TP=-1.5:LRA=11,aresample=48000[outa]")

    cmd = ["ffmpeg", "-y"] + inputs + [
        "-filter_complex", ";".join(fc),
        "-map", "0:v:0", "-map", "[outa]", "-shortest",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart", out]
    run(cmd)
    return total


def main():
    if len(sys.argv) < 2:
        raise SystemExit("usage: python assemble.py manifest.json")
    m = json.load(open(sys.argv[1]))
    W = int(m.get("width", 1920))
    H = int(m.get("height", 1080))
    fps = int(m.get("fps", 30))
    fade = float(m.get("fade", 0.35))
    crf = int(m.get("crf", 22))
    out = m["out"]
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    segments = m["segments"]

    tmp = tempfile.mkdtemp(prefix="demovid_")

    # 1) narration first — its length drives how long each segment must run
    tts_cfg = dict(m.get("tts", {}))
    audio_dir = os.path.join(tmp, "vo")
    synth_narration(segments, tts_cfg, audio_dir)
    head = float(m.get("vo_head", 0.35))
    tail = float(m.get("vo_tail", 0.55))

    # 2) normalize every segment, stretching to fit its voice
    parts, durs = [], []
    for i, seg in enumerate(m["segments"]):
        vo_need = (head + seg["_vo_dur"] + tail) if seg.get("_vo") else 0.0
        kind = seg.get("type", "clip")
        if kind == "card" or ("png" in seg and "video" not in seg):
            dur = max(float(seg.get("duration", 2.5)), vo_need)
            p, d = normalize_card(seg, W, H, fps, fade, crf, tmp, i, dur)
        else:
            p, d = normalize_clip(seg, W, H, fps, fade, crf, tmp, i, min_dur=vo_need)
        parts.append(p)
        durs.append(d)
        tag = f"  +vo {seg['_vo_dur']:.1f}s" if seg.get("_vo") else ""
        print(f"  segment {i}: {os.path.basename(p)}  {d:.2f}s{tag}")

    # 3) concat the (silent) video
    listfile = os.path.join(tmp, "list.txt")
    with open(listfile, "w") as f:
        for p in parts:
            f.write("file '" + p.replace("'", "'\\''") + "'\n")
    silent = os.path.join(tmp, "silent.mp4")
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", listfile,
         "-c:v", "libx264", "-crf", str(crf), "-preset", "medium",
         "-pix_fmt", "yuv420p", "-movflags", "+faststart", silent])

    # 4) lay narration + ducked music over it
    total = build_audio(silent, durs, m["segments"], m, tmp, out)

    print(f"\n✓ {out}  ({total:.1f}s, {os.path.getsize(out)//1024} KB)")


if __name__ == "__main__":
    main()
