"""Converting sound and video with ffmpeg: formats, GIFs, smaller files, even volume.

Used for both YouTube downloads (after downloading) and files from the PC.
"""

import os
import re
import subprocess
import threading

NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

AUDIO_FORMATS = ("mp3", "m4a", "wav", "flac")
LOSSLESS = ("wav", "flac")
GIF_MAX_SECONDS = 60
GIF_DEFAULT_SECONDS = 10
# Volume evening: about as loud as music on streaming sites.
LOUDNORM = "loudnorm=I=-14:TP=-1.5:LRA=11"


def ffmpeg():
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def probe(path):
    """{"duration", "video", "audio", "width", "height"} for a file."""
    try:  # (a broken file can make ffmpeg hang: give up after a minute)
        result = subprocess.run([ffmpeg(), "-hide_banner", "-nostdin", "-i", path],
                                capture_output=True, timeout=60, creationflags=NO_WINDOW)
        text = result.stderr.decode("utf-8", "replace")
    except subprocess.TimeoutExpired:
        text = ""
    found = {"duration": 0.0, "video": False, "audio": False, "width": 0, "height": 0}
    match = re.search(r"Duration: (\d+):(\d\d):(\d\d(?:\.\d+)?)", text)
    if match:
        h, m, s = match.groups()
        found["duration"] = int(h) * 3600 + int(m) * 60 + float(s)
    for line in text.splitlines():
        if not line.strip().startswith("Stream #"):
            continue
        if ": Audio:" in line:
            found["audio"] = True
        elif ": Video:" in line and "attached pic" not in line and not found["video"]:
            size = re.search(r", (\d{2,5})x(\d{2,5})", line)
            if size:
                found.update(video=True, width=int(size[1]), height=int(size[2]))
    return found


def run(args, seconds, on_progress=None):
    """Run ffmpeg, calling on_progress(percent) as it goes."""
    command = [ffmpeg(), "-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-nostats", *args]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               creationflags=NO_WINDOW)
    errors = []
    reader = threading.Thread(target=lambda: errors.extend(process.stderr.read().decode("utf-8", "replace").splitlines()),
                              daemon=True)
    reader.start()
    try:
        for line in process.stdout:
            match = re.match(rb"out_time_(?:us|ms)=(\d+)", line)
            if match and seconds and on_progress:
                on_progress(min(99.0, int(match[1]) / 1e6 / seconds * 100))
    except BaseException:  # on_progress asked to stop
        process.kill()
        process.wait()
        raise
    process.wait()
    reader.join()
    if process.returncode != 0:
        last = next((e for e in reversed(errors) if e.strip()), "")
        error = OSError(f"Converting didn't work. ({last.strip()[:200]})")
        error.ffmpeg_log = "\n".join(errors[-40:])
        raise error


# ---------------------------------------------------------------- graphics card

# Video makers built into graphics cards: NVIDIA, Intel, AMD. Several times
# faster than the normal (processor) way. Which one works is checked once.
GPU_ENCODERS = ("h264_nvenc", "h264_qsv", "h264_amf")
_gpu = None  # None: not checked yet, "": none works on this PC
_gpu_lock = threading.Lock()


def _gpu_pixels(name):
    return "nv12" if name in ("h264_qsv", "h264_amf") else "yuv420p"


_gpu_allowed = True


def use_gpu(on):
    """The Hardware acceleration setting: off means videos are always made by the processor."""
    global _gpu_allowed
    _gpu_allowed = bool(on)


def gpu_encoder():
    """The graphics card's video maker if this PC has one that works (and it's allowed), else ""."""
    global _gpu
    if not _gpu_allowed:
        return ""
    with _gpu_lock:
        if _gpu is None:
            _gpu = ""
            for name in GPU_ENCODERS:
                try:
                    result = subprocess.run(
                        [ffmpeg(), "-hide_banner", "-nostdin", "-f", "lavfi", "-i", "color=black:s=640x360:r=30:d=0.5",
                         "-c:v", name, "-pix_fmt", _gpu_pixels(name), "-f", "null", "-"],
                        capture_output=True, timeout=20, creationflags=NO_WINDOW)
                except (OSError, subprocess.SubprocessError):
                    continue
                if result.returncode == 0:
                    _gpu = name
                    break
        return _gpu


def _encoder_broke(log, encoder):
    log = log.lower()
    return any(word in log for word in (encoder, "nvenc", "qsv", "amf", "error while opening encoder",
                                        "hwaccel", "device", "driver"))


def _gpu_failed():
    global _gpu
    with _gpu_lock:
        _gpu = ""


def video_codec(encoder, kbps=None):
    """ffmpeg options for H.264 video. kbps: aim for that size; else just good quality."""
    if kbps:
        rate = ["-b:v", f"{kbps}k", "-maxrate", f"{int(kbps * 1.4)}k", "-bufsize", f"{kbps * 2}k"]
    if encoder == "h264_nvenc":
        quality = ["-rc", "vbr", "-cq", "23", "-b:v", "0"]
        return ["-c:v", encoder, "-preset", "p5", *(["-rc", "vbr", *rate] if kbps else quality),
                "-pix_fmt", "yuv420p", "-g", "60", "-bf", "2"]
    if encoder == "h264_qsv":
        return ["-c:v", encoder, "-preset", "medium", *(rate if kbps else ["-global_quality", "23"]),
                "-pix_fmt", "nv12", "-g", "60"]
    if encoder == "h264_amf":
        quality = ["-rc", "cqp", "-qp_i", "20", "-qp_p", "22", "-qp_b", "24"]
        return ["-c:v", encoder, "-quality", "balanced", *(["-rc", "vbr_peak", *rate] if kbps else quality),
                "-pix_fmt", "nv12", "-g", "60"]
    # The normal way, on the processor. A keyframe every 2 seconds makes skipping around in players quick.
    return ["-c:v", "libx264", "-preset", "veryfast", *(rate if kbps else ["-crf", "20"]),
            "-pix_fmt", "yuv420p", "-force_key_frames", "expr:gte(t,n_forced*2)"]


def run_video(args_before_codec, args_after_codec, target, seconds, on_progress, kbps=None):
    """Run an ffmpeg command that makes H.264 video, on the graphics card if it can."""
    encoder = gpu_encoder()
    try:
        return run([*args_before_codec, *video_codec(encoder, kbps), *args_after_codec, target], seconds, on_progress)
    except OSError as e:
        if not encoder:
            raise
        # Only stop using the graphics card for good if it was the card that failed (not, say, a
        # broken video file); this one video is tried again on the processor either way.
        if _encoder_broke(getattr(e, "ffmpeg_log", ""), encoder):
            _gpu_failed()
    run([*args_before_codec, *video_codec("", kbps), *args_after_codec, target], seconds, on_progress)


def _part(trim):
    """ffmpeg options that keep only the trimmed part."""
    if not trim:
        return []
    start, end = trim
    return ["-ss", f"{start:.3f}", "-t", f"{end - start:.3f}"]


def audio_codec(fmt, kbps):
    return {
        "mp3": ["-c:a", "libmp3lame", "-b:a", f"{kbps}k"],
        "m4a": ["-c:a", "aac", "-b:a", f"{kbps}k"],
        "flac": ["-c:a", "flac"],
        "wav": ["-c:a", "pcm_s16le"],
    }[fmt]


def convert_audio(source, target, fmt, kbps="192", trim=None, normalize=False, length=0, on_progress=None):
    """Sound only, as MP3, M4A, WAV or FLAC."""
    if fmt == "m4a" and not normalize and source.lower().endswith(".m4a"):
        codec = ["-c:a", "copy"]  # already right; don't convert again
    else:
        codec = audio_codec(fmt, kbps)
    volume = ["-af", LOUDNORM, "-ar", "48000" if fmt == "m4a" else "44100"] if normalize else []
    run([*_part(trim), "-i", source, "-map", "0:a:0", "-vn", "-map_metadata", "0", *volume, *codec, target],
        length, on_progress)


def _pick_height(video_kbps, height):
    """A smaller picture looks better than a blurry big one when there's little room."""
    for kbps, limit in ((2500, 1080), (1200, 720), (600, 480), (300, 360)):
        if video_kbps >= kbps:
            return min(height, limit)
    return min(height, 240)


def convert_video(source, target, max_height=None, target_mb=None, trim=None, normalize=False,
                  length=0, on_progress=None, info=None):
    """An MP4 (H.264 + AAC) that plays everywhere. target_mb makes it fit a size, like 10 MB for Discord."""
    info = info or probe(source)
    if not info["video"]:
        raise ValueError("This file has no video in it. Pick MP3 or another sound format instead.")
    length = length or (trim[1] - trim[0] if trim else info["duration"])
    height = info["height"] or 1080
    audio_kbps = 160
    if target_mb:
        if not length:
            raise ValueError("Couldn't tell how long this video is, so it can't be made to fit a size.")
        # 1 MB = 1,000,000 bytes, which keeps it under the limit on every site. Leave a little room.
        total_kbps = target_mb * 8000 / length * 0.92
        audio_kbps = 0 if not info["audio"] else 128 if total_kbps > 1000 else 96 if total_kbps > 400 else 64
        video_kbps = int(total_kbps - audio_kbps)
        if video_kbps < 60:
            raise ValueError(f"This is too long to fit in {target_mb:g} MB. Trim it shorter or pick a bigger size.")
        height = _pick_height(video_kbps, height)
    if max_height:
        height = min(height, max_height)

    def encode(video_kbps=None):
        scale = [] if height >= info["height"] else ["-vf", f"scale=-2:{height}"]
        sound = ["-c:a", "aac", "-b:a", f"{audio_kbps}k"] if audio_kbps or not target_mb else ["-an"]
        volume = ["-af", LOUDNORM, "-ar", "48000"] if normalize and info["audio"] else []
        run_video([*_part(trim), "-i", source, "-map", "0:v:0", "-map", "0:a:0?", "-dn", "-sn", "-map_metadata", "0", *scale],
                  [*volume, *sound, "-movflags", "+faststart"], target, length, on_progress, video_kbps)

    if not target_mb:
        return encode()
    # Already small enough? Then don't blow it up to the size limit: convert normally and check.
    if info["duration"] and os.path.getsize(source) * length / info["duration"] / 1e6 < target_mb * 0.8:
        height = info["height"] or height
        if max_height:
            height = min(height, max_height)
        audio_kbps = 160 if info["audio"] else 0
        encode()
        if os.path.getsize(target) / 1e6 <= target_mb:
            return
        height = _pick_height(int(target_mb * 8000 / length * 0.92), info["height"] or 1080)
        audio_kbps = 0 if not info["audio"] else 128
    video_kbps = int(target_mb * 8000 / length * 0.92 - audio_kbps)
    for _ in range(3):
        encode(video_kbps)
        size_mb = os.path.getsize(target) / 1e6
        if size_mb <= target_mb:
            return
        video_kbps = int(video_kbps * target_mb / size_mb * 0.9)  # came out too big: try again a bit smaller
        if video_kbps < 60:
            break
    raise ValueError(f"Couldn't get this under {target_mb:g} MB. Trim it shorter or pick a bigger size.")


def make_gif(source, target, width=480, trim=None, length=0, on_progress=None, fps=15):
    """A looping GIF. Its own colour palette keeps it from looking grainy."""
    if not trim:
        trim = (0, min(GIF_DEFAULT_SECONDS, length or GIF_DEFAULT_SECONDS))
    if trim[1] - trim[0] > GIF_MAX_SECONDS + 0.05:
        raise ValueError(f"GIFs can be up to {GIF_MAX_SECONDS} seconds. Trim it shorter.")
    look = (f"fps={fps},scale='min({width},iw)':-2:flags=lanczos,split[a][b];"
            "[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle")
    run([*_part(trim), "-i", source, "-map", "0:v:0", "-an", "-vf", look, "-loop", "0", target],
        trim[1] - trim[0], on_progress)


def thumbnail(source, target, seconds=1.0):
    """A small picture of a video, for the file list. Returns False if there isn't one."""
    try:
        result = subprocess.run([ffmpeg(), "-hide_banner", "-nostdin", "-y", "-ss", f"{seconds:.2f}", "-i", source,
                                 "-frames:v", "1", "-vf", "scale=240:-2", target],
                                capture_output=True, timeout=60, creationflags=NO_WINDOW)
    except subprocess.TimeoutExpired:
        return False
    return result.returncode == 0 and os.path.isfile(target)
