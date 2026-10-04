"""Downloads and converts videos with yt-dlp, and keeps yt-dlp up to date."""

import copy
import os
import re
import subprocess
import sys

NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def _js_runtimes():
    import deno

    return {"deno": {"path": deno.find_deno_bin()}}


def build_options(folder, fmt, quality, on_progress):
    import imageio_ffmpeg

    options = {
        "outtmpl": os.path.join(folder, "%(title)s.%(ext)s"),
        "noplaylist": True,
        "ffmpeg_location": imageio_ffmpeg.get_ffmpeg_exe(),
        "js_runtimes": _js_runtimes(),
        "progress_hooks": [on_progress],
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        # Download several pieces of a video at once where YouTube allows it.
        "concurrent_fragment_downloads": 4,
    }
    if fmt == "mp3":
        options["format"] = "bestaudio/best"
        options["postprocessors"] = [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": quality,
        }]
    else:
        h = f"[height<={quality}]"
        if int(quality) <= 1080:
            # Prefer H.264 + AAC so the MP4 plays everywhere on Windows.
            preferred = f"bv*{h}[vcodec^=avc1]+ba[acodec^=mp4a]/bv*{h}[ext=mp4]+ba[ext=m4a]/b{h}[ext=mp4]/"
        else:
            # YouTube only has 2K/4K in newer formats (VP9/AV1), which still go in the MP4.
            preferred = ""
        options["format"] = f"{preferred}bv*{h}+ba/b{h}/bv*+ba/b"
        options["format_sort"] = ["res", "fps", "br"]
        options["merge_output_format"] = "mp4"
    return options


def warm_up():
    """Load yt-dlp ahead of time (it's big), so the first Convert starts right away."""
    import deno  # noqa: F401
    import imageio_ffmpeg
    import yt_dlp
    from yt_dlp.extractor import gen_extractor_classes

    gen_extractor_classes()  # yt-dlp checks every site it knows on each link
    imageio_ffmpeg.get_ffmpeg_exe()
    yt_dlp.YoutubeDL({"quiet": True})


def friendly_error(e):
    """yt-dlp's error text without the technical bits."""
    text = str(e).split("\n")[0].replace("ERROR: ", "")
    text = re.sub(r"^\[[\w:]+\] [^:]*: ", "", text)  # "[youtube] abc123: "
    text = re.sub(r" \(caused by .*\)$", "", text)
    text = re.sub(r";? ?please report this issue.*$", "", text, flags=re.I)
    return text.strip().rstrip(".") + "."


def fetch_info(url):
    """Look up a video without downloading it. Returns (info, preview)."""
    import yt_dlp

    with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "noplaylist": True,
                           "js_runtimes": _js_runtimes()}) as ydl:
        info = ydl.extract_info(url, download=False, process=False)
    if info.get("_type") in ("playlist", "multi_video"):
        raise ValueError("That's a playlist link. Paste a link to a single video.")
    return info, preview_of(info)


def preview_of(info):
    thumbnail = info.get("thumbnail")
    if not thumbnail and info.get("thumbnails"):
        thumbnail = info["thumbnails"][-1].get("url")
    if info.get("extractor_key") == "Youtube" and info.get("id"):
        thumbnail = f"https://i.ytimg.com/vi/{info['id']}/mqdefault.jpg"
    return {
        "title": info.get("title") or "Untitled video",
        "channel": info.get("channel") or info.get("uploader") or "",
        "duration": info.get("duration_string") or format_duration(info.get("duration")),
        "thumbnail": thumbnail or "",
    }


def format_duration(seconds):
    if not seconds:
        return ""
    seconds = int(seconds)
    h, m, s = seconds // 3600, seconds % 3600 // 60, seconds % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def download(info, folder, fmt, quality, on_progress):
    """Download a video looked up with fetch_info. Returns the saved file's path."""
    import yt_dlp

    with yt_dlp.YoutubeDL(build_options(folder, fmt, quality, on_progress)) as ydl:
        result = ydl.process_ie_result(copy.deepcopy(info), download=True)
    downloads = (result or {}).get("requested_downloads") or [{}]
    return downloads[0].get("filepath") or ""


def update_yt_dlp():
    """YouTube changes often; a newer yt-dlp is the usual fix when downloads break."""
    python = os.path.join(os.path.dirname(sys.executable), "python.exe")
    if not os.path.isfile(python):
        python = sys.executable
    subprocess.run(
        [python, "-m", "pip", "install", "--upgrade", "--disable-pip-version-check", "yt-dlp[default]"],
        check=True, capture_output=True, creationflags=NO_WINDOW,
    )
