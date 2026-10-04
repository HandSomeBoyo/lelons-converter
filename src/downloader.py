"""Downloads and converts videos with yt-dlp."""

import copy
import os
import re
import subprocess
import sys

NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def use_bundled_ffmpeg():
    """Make the app's own ffmpeg findable by name.

    Some parts of yt-dlp (like downloading only part of a video for Trim)
    look for a program called "ffmpeg" instead of using ffmpeg_location.
    """
    folder = os.path.join(os.path.dirname(sys.executable), "ffmpeg")
    exe = os.path.join(folder, "ffmpeg.exe" if os.name == "nt" else "ffmpeg")
    if os.path.isfile(exe):
        os.environ["IMAGEIO_FFMPEG_EXE"] = exe  # imageio-ffmpeg uses it too
        os.environ["PATH"] = folder + os.pathsep + os.environ.get("PATH", "")


def _js_runtimes():
    import deno

    return {"deno": {"path": deno.find_deno_bin()}}


def build_options(folder, fmt, quality, on_progress, trim=None):
    import imageio_ffmpeg

    name = "%(title)s"
    if trim:
        # Windows file names can't have ":", so 1:20 is written 1m20s
        name += " ({}-{})".format(*(f"{int(t) // 60}m{int(t) % 60:02d}s" for t in trim))
    options = {
        "outtmpl": os.path.join(folder, name + ".%(ext)s"),
        "noplaylist": True,
        "ffmpeg_location": imageio_ffmpeg.get_ffmpeg_exe(),
        "js_runtimes": _js_runtimes(),
        "progress_hooks": [on_progress],
        # Also tell on_progress which step comes next (merging, cutting, ...).
        "postprocessor_hooks": [lambda d: d["status"] == "started" and on_progress({"status": "step", "step": d["postprocessor"]})],
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        # Download several pieces of a video at once where YouTube allows it.
        "concurrent_fragment_downloads": 4,
        # Put the thumbnail in the file as cover art, plus the title and artist.
        "writethumbnail": True,
    }
    # Cover art has to be a JPG; YouTube's thumbnails are usually WebP.
    # (The cover art itself is added in download(), after any trimming.)
    to_jpg = {"key": "FFmpegThumbnailsConvertor", "format": "jpg", "when": "before_dl"}
    if fmt == "mp3":
        options["format"] = "bestaudio/best"
        options["format_sort"] = ["lang"]  # the video's own audio, not a dubbed one
        options["postprocessors"] = [to_jpg, {
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": quality,
        }]
        # Album art is square, so cut the middle out of the wide thumbnail.
        options["postprocessor_args"] = {
            "thumbnailsconvertor+ffmpeg_o": ["-c:v", "mjpeg", "-vf", r"crop=min(iw\,ih):min(iw\,ih)"],
        }
    else:
        h = f"[height<={quality}]"
        if int(quality) <= 1080:
            # Prefer H.264 + AAC so the MP4 plays everywhere on Windows.
            preferred = f"bv*{h}[vcodec^=avc1]+ba[acodec^=mp4a]/bv*{h}[ext=mp4]+ba[ext=m4a]/b{h}[ext=mp4]/"
        else:
            # YouTube only has 2K/4K in newer formats (VP9/AV1), which still go in the MP4.
            preferred = ""
        options["format"] = f"{preferred}bv*{h}+ba/b{h}/bv*+ba/b"
        # "lang" first: the video's own audio, not a dubbed one in another language
        options["format_sort"] = ["lang", "res", "fps", "br"]
        options["merge_output_format"] = "mp4"
        options["postprocessors"] = [to_jpg]
    return options


def _cut_step(ydl, fmt, trim):
    """A yt-dlp step that keeps only the trimmed part of the downloaded file.

    The whole video is downloaded first and then cut here on the PC. Letting
    ffmpeg cut while downloading from YouTube gave files that some players
    couldn't skip around in.
    """
    from yt_dlp.postprocessor.ffmpeg import FFmpegPostProcessor
    from yt_dlp.utils import prepend_extension

    class CutPP(FFmpegPostProcessor):
        def run(self, info):
            path = info["filepath"]
            temp = prepend_extension(path, "cut")
            start, end = trim
            if fmt == "mp3":
                codecs = ["-c:a", "copy"]  # MP3 can be cut without converting it again
            else:
                # Re-encode so the video starts exactly at the cut, with clean
                # timestamps, in H.264 + AAC that every Windows player handles.
                # A keyframe every 2 seconds makes skipping around in players quick.
                codecs = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
                          "-force_key_frames", "expr:gte(t,n_forced*2)",
                          "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"]
            self.real_run_ffmpeg(
                [(path, ["-ss", f"{start:.3f}", "-to", f"{end:.3f}"])],
                [(temp, ["-map", "0:v:0?", "-map", "0:a:0?", "-dn", "-sn", *codecs,
                         "-avoid_negative_ts", "make_zero"])],
            )
            os.replace(temp, path)
            return [], info

    return CutPP(ydl)


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
        "seconds": int(info.get("duration") or 0),
    }


def format_duration(seconds):
    if not seconds:
        return ""
    seconds = int(seconds)
    h, m, s = seconds // 3600, seconds % 3600 // 60, seconds % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def parse_time(text):
    """ "1:20", "1:02:03" or "80" -> seconds. None if it isn't a time."""
    text = str(text or "").strip()
    if not re.fullmatch(r"\d+(:\d{1,2}){0,2}(\.\d+)?", text):
        return None
    seconds = 0.0
    for part in text.split(":"):
        seconds = seconds * 60 + float(part)
    return seconds


def song_info(info):
    """Fill in artist and song title, so MP3s look right in music apps."""
    if info.get("artist") or info.get("artists"):
        return
    title = info.get("track") or info.get("title") or ""
    # Music videos are usually called "Artist - Song (Official Video)".
    match = re.match(r"^(.+?)\s+[-\u2013\u2014]\s+(.+)$", title)
    if match:
        artist, track = match.groups()
    else:
        artist, track = info.get("channel") or info.get("uploader") or "", title
    track = re.sub(r"\s*[(\[][^)\]]*\b(official|lyrics?|audio|video|visuali[sz]er|hd|4k|mv)\b[^)\]]*[)\]]",
                   "", track, flags=re.I).strip() or title
    info["artists"] = [re.sub(r" - Topic$", "", artist).strip()]
    info["track"] = track


def download(info, folder, fmt, quality, on_progress, trim=None):
    """Download a video looked up with fetch_info. Returns the saved file's path."""
    import yt_dlp

    info = copy.deepcopy(info)
    song_info(info)
    from yt_dlp.postprocessor import EmbedThumbnailPP, FFmpegMetadataPP

    with yt_dlp.YoutubeDL(build_options(folder, fmt, quality, on_progress, trim)) as ydl:
        if trim:
            ydl.add_post_processor(_cut_step(ydl, fmt, trim))
        # Title, artist and cover art go in last, so trimming can't drop them.
        ydl.add_post_processor(FFmpegMetadataPP(ydl, add_metadata=True))
        ydl.add_post_processor(EmbedThumbnailPP(ydl, already_have_thumbnail=False))
        result = ydl.process_ie_result(info, download=True)
    downloads = (result or {}).get("requested_downloads") or [{}]
    return downloads[0].get("filepath") or ""
