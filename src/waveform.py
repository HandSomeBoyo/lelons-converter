"""The waveform for the trim editor: a small copy of the audio plus its loudness.

The audio is downloaded in YouTube's smallest audio quality (it's only for
finding the right spot), kept in a temporary folder while the app runs, and
played in the trim editor so you can hear where you're cutting.
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

FOLDER = os.path.join(tempfile.gettempdir(), "LelonsConverter")
BARS = 1200  # how many loudness values the editor draws

_lock = threading.Lock()
_cache = {}  # url -> result
_files = set()  # file names the window may play


def key_for(url):
    return hashlib.sha1(url.encode()).hexdigest()[:16]


def get(url, info):
    """Returns {"peaks", "duration", "audio"} for a looked-up video (may take a while)."""
    with _lock:  # one at a time, and only once per video
        if url not in _cache:
            _cache[url] = _build(url, info)
        return _cache[url]


def _build(url, info):
    import imageio_ffmpeg
    import yt_dlp

    os.makedirs(FOLDER, exist_ok=True)
    options = {
        "format": "worstaudio[abr>=40]/worstaudio/bestaudio/worst",
        "outtmpl": os.path.join(FOLDER, key_for(url) + ".%(ext)s"),
        "ffmpeg_location": imageio_ffmpeg.get_ffmpeg_exe(),
        "js_runtimes": downloader._js_runtimes(),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
    }
    with yt_dlp.YoutubeDL(options) as ydl:
        result = ydl.process_ie_result(copy.deepcopy(info), download=True)
    path = ((result or {}).get("requested_downloads") or [{}])[0].get("filepath")
    if not path or not os.path.isfile(path):
        raise OSError("Couldn't get the audio for this video.")

    # Decode to plain numbers, at a low sample rate: plenty for drawing.
    duration = float(info.get("duration") or 0)
    rate = max(400, min(8000, int(2_000_000 / duration))) if duration else 4000
    pcm = subprocess.run(
        [imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-i", path, "-ac", "1", "-ar", str(rate), "-f", "s16le", "-"],
        capture_output=True, check=True, creationflags=downloader.NO_WINDOW,
    ).stdout
    samples = array.array("h")
    samples.frombytes(pcm[: len(pcm) // 2 * 2])
    if not samples:
        raise OSError("This video has no sound to show.")

    step = max(1, len(samples) // BARS)
    peaks = []
    for start in range(0, len(samples), step):
        chunk = samples[start:start + step]
        peaks.append(max(max(chunk), -min(chunk)))
    loudest = max(peaks) or 1
    name = os.path.basename(path)
    _files.add(name)
    return {
        # Square root makes quiet parts easier to see.
        "peaks": [round((p / loudest) ** 0.5, 3) for p in peaks],
        "duration": len(samples) / rate,
        "audio": "/media/" + name,
    }


def file_path(name):
    """The file for a /media/ address, if the window is allowed to play it."""
    return os.path.join(FOLDER, name) if name in _files else None


def clean_up():
    shutil.rmtree(FOLDER, ignore_errors=True)
