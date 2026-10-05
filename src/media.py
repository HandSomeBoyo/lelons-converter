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
    result = subprocess.run([ffmpeg(), "-hide_banner", "-nostdin", "-i", path],
                            capture_output=True, creationflags=NO_WINDOW)
    text = result.stderr.decode("utf-8", "replace")
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
    for line in process.stdout:
        match = re.match(rb"out_time_(?:us|ms)=(\d+)", line)
        if match and seconds and on_progress:
            on_progress(min(99.0, int(match[1]) / 1e6 / seconds * 100))
    process.wait()
    reader.join()
    if process.returncode != 0:
        last = next((e for e in reversed(errors) if e.strip()), "")
        raise OSError(f"Converting didn't work. ({last.strip()[:200]})")


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
    video = ["-crf", "20"]
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
        rate = (["-b:v", f"{video_kbps}k", "-maxrate", f"{int(video_kbps * 1.4)}k", "-bufsize", f"{video_kbps * 2}k"]
                if video_kbps else video)
        sound = ["-c:a", "aac", "-b:a", f"{audio_kbps}k"] if audio_kbps or not target_mb else ["-an"]
        volume = ["-af", LOUDNORM, "-ar", "48000"] if normalize and info["audio"] else []
        run([*_part(trim), "-i", source, "-map", "0:v:0", "-map", "0:a:0?", "-dn", "-sn", "-map_metadata", "0",
             *scale, "-c:v", "libx264", "-preset", "veryfast", *rate, "-pix_fmt", "yuv420p",
             "-force_key_frames", "expr:gte(t,n_forced*2)", *volume, *sound,
             "-movflags", "+faststart", target], length, on_progress)

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
    result = subprocess.run([ffmpeg(), "-hide_banner", "-nostdin", "-y", "-ss", f"{seconds:.2f}", "-i", source,
                             "-frames:v", "1", "-vf", "scale=240:-2", target],
                            capture_output=True, creationflags=NO_WINDOW)
    return result.returncode == 0 and os.path.isfile(target)
