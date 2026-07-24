#!/usr/bin/env python3
"""assemble.py — stitch recorded clips + title cards into one polished MP4.

Manifest-driven so Claude just describes the running order. Each segment is
normalized to a common canvas (scale-to-fit + pad + fps), gets a short
cross-fade in/out, and the pieces are concatenated. Title-card PNGs become
still segments of a given duration. Optional background music is mixed under.

Usage:
    python assemble.py manifest.json

Manifest schema:
{
  "out": "/abs/path/demo.mp4",
  "width": 1920, "height": 1080, "fps": 30,
  "fade": 0.35,          // per-segment fade in/out seconds (0 to disable)
  "crf": 22,             // x264 quality (lower = better/bigger; 18-24 typical)
  "audio": "/abs/music.mp3",   // optional; looped/trimmed to video length, ducked
  "audio_gain": 0.18,          // optional 0..1 music volume (default 0.18)
  "segments": [
    {"type":"card", "png":"/abs/cards/c01.png", "duration":2.5},
    {"type":"clip", "video":"/abs/clips/01.webm"},
    {"type":"clip", "video":"/abs/clips/02.webm",
       "trim_start":0.2, "trim_end":0.0, "speed":1.0}
  ]
}

Requires ffmpeg + ffprobe on PATH.
"""
import json
import os
import subprocess
import sys
import tempfile


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


def normalize_clip(seg, W, H, fps, fade, crf, tmp, idx):
    src = seg["video"]
    ss = float(seg.get("trim_start", 0) or 0)
    te = float(seg.get("trim_end", 0) or 0)
    speed = float(seg.get("speed", 1.0) or 1.0)
    raw = probe_duration(src)
    end = max(0.0, raw - te)
    dur = (end - ss) / speed if speed else (end - ss)
    vf = vf_canvas(W, H, fps)
    if speed and speed != 1.0:
        vf = f"setpts={1.0/speed:.4f}*PTS," + vf
    vf = with_fades(vf, dur, fade)
    out = os.path.join(tmp, f"seg{idx:03d}.mp4")
    cmd = ["ffmpeg", "-y"]
    if ss > 0:
        cmd += ["-ss", f"{ss:.3f}"]
    cmd += ["-i", src]
    if te > 0:
        cmd += ["-to", f"{end - ss:.3f}"] if ss > 0 else ["-to", f"{end:.3f}"]
    cmd += ["-an", "-vf", vf, "-c:v", "libx264", "-crf", str(crf),
            "-preset", "medium", "-pix_fmt", "yuv420p", out]
    run(cmd)
    return out, probe_duration(out)


def normalize_card(seg, W, H, fps, fade, crf, tmp, idx):
    dur = float(seg.get("duration", 2.5))
    vf = with_fades(vf_canvas(W, H, fps), dur, fade)
    out = os.path.join(tmp, f"seg{idx:03d}.mp4")
    run(["ffmpeg", "-y", "-loop", "1", "-t", f"{dur:.3f}", "-i", seg["png"],
         "-vf", vf, "-c:v", "libx264", "-crf", str(crf), "-preset", "medium",
         "-pix_fmt", "yuv420p", out])
    return out, dur


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

    tmp = tempfile.mkdtemp(prefix="demovid_")
    parts, total = [], 0.0
    for i, seg in enumerate(m["segments"]):
        kind = seg.get("type", "clip")
        if kind == "card" or ("png" in seg and "video" not in seg):
            p, d = normalize_card(seg, W, H, fps, fade, crf, tmp, i)
        else:
            p, d = normalize_clip(seg, W, H, fps, fade, crf, tmp, i)
        parts.append(p)
        total += d
        print(f"  segment {i}: {os.path.basename(p)}  {d:.2f}s")

    listfile = os.path.join(tmp, "list.txt")
    with open(listfile, "w") as f:
        for p in parts:
            f.write("file '" + p.replace("'", "'\\''") + "'\n")

    silent = os.path.join(tmp, "silent.mp4")
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", listfile,
         "-c:v", "libx264", "-crf", str(crf), "-preset", "medium",
         "-pix_fmt", "yuv420p", "-movflags", "+faststart", silent])

    audio = m.get("audio")
    if audio and os.path.exists(audio):
        gain = float(m.get("audio_gain", 0.18))
        af = (f"volume={gain},afade=t=in:st=0:d=1.2,"
              f"afade=t=out:st={max(0,total-1.5):.2f}:d=1.5")
        run(["ffmpeg", "-y", "-i", silent, "-stream_loop", "-1", "-i", audio,
             "-filter:a", af, "-map", "0:v:0", "-map", "1:a:0", "-shortest",
             "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
             "-movflags", "+faststart", out])
    else:
        os.replace(silent, out)

    print(f"\n✓ {out}  ({total:.1f}s, {os.path.getsize(out)//1024} KB)")


if __name__ == "__main__":
    main()
