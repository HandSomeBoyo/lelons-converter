"""The trim editor's media: a small copy of the audio (or video) plus its loudness.

It's downloaded in a low quality (it's only for finding the right spot), kept
in a temporary folder while the app runs, and played in the trim editor so
you can hear, and for MP4s see, where you're cutting.
"""

import array
import copy
import hashlib
import os
import shutil
import subprocess
import tempfile
import threading

import downloader
import media

FOLDER = os.path.join(tempfile.gettempdir(), "LelonsConverter")
BARS = 1200  # how many loudness values the editor draws

_guard = threading.Lock()
_locks = {}  # one lock per video, so different videos can load at the same time
_cache = {}  # (url, video) -> result
_waiting = 0  # trim editors waiting for their sound or video
_files = set()  # file names the window may play
_prefetching = threading.Semaphore(2)  # loaded ahead of time at once (more just get skipped)
KEEP = 12  # editors' media kept at most; older ones are deleted


def key_for(url):
    return hashlib.sha1(url.encode()).hexdigest()[:16]


def _once(key, build, prefetch=False):
    """build()'s result for key, made only once even if asked for twice at the same time."""
    global _waiting
    with _guard:
        if key in _cache:
            _cache[key] = _cache.pop(key)  # used just now: the last to be deleted
            return _cache[key]
        lock = _locks.setdefault(key, threading.Lock())
        if not prefetch:
            _waiting += 1
    if prefetch and not _prefetching.acquire(blocking=False):
        raise RuntimeError("Busy loading others; it loads when the trim editor opens.")
    try:
        with lock:
            if key not in _cache:
                made = build()
                with _guard:
                    _cache[key] = made
                    _forget_old(key)
            return _cache[key]
    finally:
        if prefetch:
            _prefetching.release()
        else:
            with _guard:
                _waiting -= 1


def _forget_old(newest):
    """Past KEEP, delete the oldest editors' media (call with _guard held)."""
    while len(_cache) > KEEP:
        old = next(k for k in _cache if k != newest)
        name = _cache.pop(old).get("media", "").rsplit("/", 1)[-1]
        _locks.pop(old, None)
        if name and not any(c.get("media", "").endswith("/" + name) for c in _cache.values()):
            _files.discard(name)
            try:
                os.remove(os.path.join(FOLDER, name))
            except OSError:
                pass


def get(url, info, video=False, prefetch=False):
    """Returns {"peaks", "duration", "media"} for a looked-up video (may take a while).

    prefetch: loaded ahead of time, before the trim editor is opened.
    """
    return _once((url, video), lambda: _build(url, info, video), prefetch)


def _build(url, info, video):
    import imageio_ffmpeg
    import yt_dlp

    os.makedirs(FOLDER, exist_ok=True)
    options = {
        # Many YouTube videos also have dubbed audio in other languages.
        # "lang" first in the sort order means the video's own language wins.
        "format_sort": ["lang", "+abr"] if not video else ["lang"],
        "outtmpl": os.path.join(FOLDER, key_for(url) + ("-video" if video else "") + ".%(ext)s"),
        "ffmpeg_location": imageio_ffmpeg.get_ffmpeg_exe(),
        "js_runtimes": downloader._js_runtimes(),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
    }
    if video:
        # Small and in a format Edge can play: H.264 + AAC if YouTube has it.
        options["format"] = ("bv*[height<=360][vcodec^=avc1]+ba[acodec^=mp4a]/18/"
                             "bv*[height<=360]+ba/b[height<=480]/bv*+ba/b")
        options["merge_output_format"] = "mp4"
    else:
        options["format"] = "ba[abr>=40]/ba/b"
    with yt_dlp.YoutubeDL(options) as ydl:
        result = ydl.process_ie_result(copy.deepcopy(info), download=True)
    path = ((result or {}).get("requested_downloads") or [{}])[0].get("filepath")
    if not path or not os.path.isfile(path):
        raise OSError("Couldn't get the audio for this video.")

    return _result(path, float(info.get("duration") or 0))


def get_local(file_id, source, video=False):
    """The same for a file from the PC. A small copy is made that the window can surely play."""
    return _once((("file", file_id), video), lambda: _build_local(file_id, source, video))


def _build_local(file_id, source, video):
    os.makedirs(FOLDER, exist_ok=True)
    found = media.probe(source)
    target = os.path.join(FOLDER, f"file-{file_id}" + ("-video.mp4" if video else ".m4a"))
    if video:
        if not found["video"]:
            raise OSError("This file has no video in it.")
        media.run(["-i", source, "-map", "0:v:0", "-map", "0:a:0?", "-vf", "scale=-2:'min(360,ih)'",
                   "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", "-pix_fmt", "yuv420p",
                   "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", target], found["duration"])
    else:
        if not found["audio"]:
            raise OSError("This file has no sound to show.")
        media.run(["-i", source, "-map", "0:a:0", "-vn", "-c:a", "aac", "-b:a", "128k", target], found["duration"])
    return _result(target, found["duration"])


def _result(path, duration):
    """Loudness values for drawing, plus the address the window plays the file from."""
    import imageio_ffmpeg

    # Decode to plain numbers, at a low sample rate: plenty for drawing.
    rate = max(400, min(8000, int(2_000_000 / duration))) if duration else 4000
    try:
        pcm = subprocess.run(
            [imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-nostdin", "-i", path, "-ac", "1", "-ar", str(rate),
             "-f", "s16le", "-"],
            capture_output=True, timeout=300, creationflags=downloader.NO_WINDOW,
        ).stdout
    except subprocess.TimeoutExpired:
        pcm = b""
    samples = array.array("h")
    samples.frombytes(pcm[: len(pcm) // 2 * 2])
    name = os.path.basename(path)
    _files.add(name)
    if not samples:  # a video without sound: a flat line, but the picture still plays
        return {"peaks": [0] * BARS, "duration": duration, "media": "/media/" + name}

    step = max(1, len(samples) // BARS)
    peaks = []
    for start in range(0, len(samples), step):
        chunk = samples[start:start + step]
        peaks.append(max(max(chunk), -min(chunk)))
    loudest = max(peaks) or 1
    return {
        # Square root makes quiet parts easier to see.
        "peaks": [round((p / loudest) ** 0.5, 3) for p in peaks],
        "duration": len(samples) / rate,
        "media": "/media/" + name,
    }


def busy():
    """True while a trim editor is waiting for its sound or video."""
    return _waiting > 0


def file_path(name):
    """The file for a /media/ address, if the window is allowed to play it."""
    return os.path.join(FOLDER, name) if name in _files else None


def clean_up():
    shutil.rmtree(FOLDER, ignore_errors=True)
