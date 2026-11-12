"""Cut the silence: finds the quiet parts of a video so they can be cut out.

Used two ways: VaultHub makes a new video without the quiet parts, or the
"VaultHub Cut Silence" button in DaVinci Resolve gets the parts to keep and
builds a new timeline from them (so every cut can still be changed there).
"""

import os
import re
import subprocess
import tempfile
import threading

import media

# "How quiet is quiet", in dB: a quiet room, normal, or noisy (game sound, wind, a fan).
LEVELS = {"quiet": -40, "normal": -33, "noisy": -26}
# The shortest pause that's cut, in seconds.
PAUSES = ("0.3", "0.5", "1")
PAD = 0.12  # a little of the quiet kept on each side, so words aren't clipped


def find_quiet(path, level="normal", pause="0.5", length=0, on_progress=None):
    """[(start, end)] of the quiet parts."""
    noise = LEVELS.get(level, LEVELS["normal"])
    least = float(pause) if pause in PAUSES else 0.5
    command = [media.ffmpeg(), "-hide_banner", "-nostdin", "-progress", "pipe:1", "-nostats", "-i", path,
               "-map", "0:a:0", "-vn", "-af", f"silencedetect=noise={noise}dB:d={least}", "-f", "null", "-"]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=media.NO_WINDOW)
    log = []
    reader = threading.Thread(target=lambda: log.extend(process.stderr.read().decode("utf-8", "replace").splitlines()),
                              daemon=True)
    reader.start()
    try:
        for line in process.stdout:
            match = re.match(rb"out_time_(?:us|ms)=(\d+)", line)
            if match and length and on_progress:
                on_progress(min(99.0, int(match[1]) / 1e6 / length * 100))
    except BaseException:
        process.kill()
        process.wait()
        raise
    process.wait()
    reader.join()
    if process.returncode != 0:
        raise OSError("Couldn't listen to this file.")
    quiet, start = [], None
    for line in log:
        found = re.search(r"silence_start: (-?[\d.]+)", line)
        if found:
            start = max(0.0, float(found[1]))
        found = re.search(r"silence_end: ([\d.]+)", line)
        if found and start is not None:
            quiet.append((start, float(found[1])))
            start = None
    if start is not None and length:
        quiet.append((start, length))  # quiet until the end
    return quiet


def parts_to_keep(quiet, length):
    """The other parts, with a little room around them."""
    keep, at = [], 0.0
    for start, end in quiet:
        if start - at > 0.05:
            keep.append((at, start))
        at = end
    if length - at > 0.05:
        keep.append((at, length))
    padded = []
    for start, end in keep:
        start, end = max(0.0, start - PAD), min(length, end + PAD)
        if padded and start <= padded[-1][1] + 0.05:
            padded[-1] = (padded[-1][0], end)
        else:
            padded.append((start, end))
    return [(round(s, 3), round(e, 3)) for s, e in padded if e - s > 0.1]


def cut(path, keep, target, info=None, on_progress=None):
    """A new video (or sound file) with only the parts in keep, as a Resolve-friendly .mov."""
    info = info or media.probe(path)
    if not keep:
        raise ValueError("This is all quiet, so there's nothing left to keep.")
    total = sum(e - s for s, e in keep)
    lines = []
    for i, (s, e) in enumerate(keep):
        if info["video"]:
            lines.append(f"[0:v:0]trim=start={s}:end={e},setpts=PTS-STARTPTS[v{i}];")
        if info["audio"]:
            lines.append(f"[0:a:0]atrim=start={s}:end={e},asetpts=PTS-STARTPTS[a{i}];")
    inputs = "".join((f"[v{i}]" if info["video"] else "") + (f"[a{i}]" if info["audio"] else "") for i in range(len(keep)))
    outs = ("[v]" if info["video"] else "") + ("[a]" if info["audio"] else "")
    lines.append(f"{inputs}concat=n={len(keep)}:v={int(info['video'])}:a={int(info['audio'])}{outs}")
    script = tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8")
    try:
        script.write("\n".join(lines))
        script.close()
        maps = (["-map", "[v]"] if info["video"] else []) + (["-map", "[a]"] if info["audio"] else [])
        sound = ["-c:a", "pcm_s16le", "-ar", "48000"] if info["audio"] else []
        if info["video"]:
            rate, _ = media.resolve_rate(info["fps"])  # a steady frame rate, like Fix for Resolve
            media.run_video(["-i", path, "-/filter_complex", script.name, *maps, "-fps_mode", "cfr", "-r", rate],
                            [*sound, "-movflags", "+faststart"], target, total, on_progress)
        else:
            media.run(["-i", path, "-/filter_complex", script.name, *maps, *sound, target], total, on_progress)
    finally:
        try:
            os.remove(script.name)
        except OSError:
            pass
    return total
