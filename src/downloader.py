"""Downloads and converts videos with yt-dlp."""

import copy
import os
import re
import subprocess
import sys

import media
import names

NO_WINDOW = media.NO_WINDOW


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


def build_options(folder, fmt, quality, on_progress, trim=None, mark=""):
    import imageio_ffmpeg

    name = "%(title)s"
    if trim:
        # Windows file names can't have ":", so 1:20 is written 1m20s
        name += " ({}-{})".format(*(f"{int(t) // 60}m{int(t) % 60:02d}s" for t in trim))
    options = {
        # mark: a temporary name while it's being made (see names.py)
        "outtmpl": os.path.join(folder, name + mark + ".%(ext)s"),
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
        # (WAV files and GIFs can't have cover art.)
        "writethumbnail": fmt not in ("wav", "gif"),
    }
    # Cover art has to be a JPG; YouTube's thumbnails are usually WebP.
    # (The cover art itself is added in download(), after any trimming.)
    to_jpg = {"key": "FFmpegThumbnailsConvertor", "format": "jpg", "when": "before_dl"}
    if fmt in media.AUDIO_FORMATS:
        options["format"] = "bestaudio/best"
        options["format_sort"] = ["lang"]  # the video's own audio, not a dubbed one
        convert = {"key": "FFmpegExtractAudio", "preferredcodec": fmt}
        if fmt not in media.LOSSLESS:
            convert["preferredquality"] = quality
        options["postprocessors"] = [convert] if fmt == "wav" else [to_jpg, convert]
        # Album art is square, so cut the middle out of the wide thumbnail.
        options["postprocessor_args"] = {
            "thumbnailsconvertor+ffmpeg_o": ["-c:v", "mjpeg", "-vf", r"crop=min(iw\,ih):min(iw\,ih)"],
        }
    elif fmt == "gif":
        # No sound needed, and the GIF ends up much smaller than the video anyway.
        options["format"] = "bv*[height<=720]/b[height<=720]/bv*/b"
        options["format_sort"] = ["res", "fps"]
    else:
        height = quality
        h = f"[height<={height}]"
        if int(height) <= 1080:
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


def _finish_step(ydl, fmt, quality, trim, normalize, on_progress):
    """A yt-dlp step that does what's left after downloading: cutting, the GIF,
    evening out the volume. None if nothing is left.

    The whole video is downloaded first and then changed here on the PC.
    Letting ffmpeg cut while downloading from YouTube gave files that some
    players couldn't skip around in.
    """
    if fmt != "gif" and not trim and not (normalize and fmt in media.AUDIO_FORMATS):
        return None
    from yt_dlp.postprocessor.ffmpeg import FFmpegPostProcessor
    from yt_dlp.utils import prepend_extension

    def progress(step):
        return lambda percent: on_progress({"status": "step", "step": step, "percent": percent})

    class FinishPP(FFmpegPostProcessor):
        def run(self, info):
            path = info["filepath"]
            length = (trim[1] - trim[0]) if trim else float(info.get("duration") or 0)
            if fmt == "gif":
                target = os.path.splitext(path)[0] + ".gif"
                media.make_gif(path, target, int(quality), trim, length, progress("Gif"))
                info.update(filepath=target, ext="gif")
                return [path], info
            temp = prepend_extension(path, "cut")
            if fmt in media.AUDIO_FORMATS:
                if normalize or fmt in media.LOSSLESS:
                    kbps = quality if fmt not in media.LOSSLESS else "0"
                    media.convert_audio(path, temp, fmt, kbps, trim, normalize, length, progress("Volume" if normalize else "Cut"))
                else:
                    # MP3 and M4A can be cut without converting them again.
                    on_progress({"status": "step", "step": "Cut"})
                    media.run([*media._part(trim), "-i", path, "-map", "0:a:0", "-c:a", "copy", temp], length)
            else:
                # Re-encode so the video starts exactly at the cut, with clean
                # timestamps, in H.264 + AAC that every Windows player handles.
                media.convert_video(path, temp, trim=trim, length=length, on_progress=progress("Cut"))
            os.replace(temp, path)
            return [], info

    return FinishPP(ydl)


def warm_up():
    """Load yt-dlp ahead of time (it's big), so the first Convert starts right away."""
    import deno  # noqa: F401
    import imageio_ffmpeg
    import yt_dlp
    from yt_dlp.extractor import gen_extractor_classes

    gen_extractor_classes()  # yt-dlp checks every site it knows on each link
    imageio_ffmpeg.get_ffmpeg_exe()
    media.gpu_encoder()  # find out now whether the graphics card can make videos
    yt_dlp.YoutubeDL({"quiet": True})


def friendly_error(e):
    """yt-dlp's error text without the technical bits."""
    text = str(e).split("\n")[0].replace("ERROR: ", "")
    if "Unsupported URL" in text:
        return "This app can't download from that website."
    if re.search(r"connect to proxy|Unable to connect|getaddrinfo|resolve|timed out|Connection refused|unreachable", text, re.I):
        return "Couldn't reach that website. Check your internet connection and the link."
    if "HTTP Error 404" in text:
        return "That page doesn't exist. Check the link."
    if re.search(r"log(ged)?[ -]?in|cookies|private", text, re.I) and "confirm you" not in text:
        return "That site only shows this to people who are logged in, so the app can't get it."
    text = re.sub(r"^\[[\w:]+\] [^:]*: ", "", text)  # "[youtube] abc123: "
    text = re.sub(r" \(caused by .*$", "", text)
    text = re.sub(r";? ?please report this issue.*$", "", text, flags=re.I)
    return text.strip().rstrip(".") + "."


PLAYLIST_LIMIT = 500


def fetch_info(url):
    """Look up a video or a playlist without downloading it. Returns (info, preview)."""
    import yt_dlp

    with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "noplaylist": True,
                           "extract_flat": "in_playlist", "playlistend": PLAYLIST_LIMIT,
                           "js_runtimes": _js_runtimes()}) as ydl:
        info = ydl.extract_info(url, download=False, process=False)
        # Some links only point at the real page (a short link, a video in a
        # playlist link): follow them, so the preview has the title and so on.
        for _ in range(3):
            if info.get("_type") not in ("url", "url_transparent") or not info.get("url"):
                break
            found = ydl.extract_info(info["url"], download=False, process=False, ie_key=info.get("ie_key"))
            if info["_type"] == "url_transparent":
                found = {**found, **{k: v for k, v in info.items()
                                     if v is not None and k not in ("_type", "url", "ie_key", "id", "extractor", "extractor_key")}}
            info = found
        if info.get("_type") in ("playlist", "multi_video"):
            # Only the list of videos; each one is looked up when it's its turn.
            info = ydl.process_ie_result(info, download=False)
            return info, playlist_preview(info)
    return info, preview_of(info)


def _thumbnail_of(info):
    thumbnail = info.get("thumbnail")
    if not thumbnail and info.get("thumbnails"):
        thumbnail = info["thumbnails"][-1].get("url")
    if (info.get("extractor_key") or info.get("ie_key")) == "Youtube" and info.get("id"):
        thumbnail = f"https://i.ytimg.com/vi/{info['id']}/mqdefault.jpg"
    return thumbnail or ""


def playlist_preview(info):
    entries = []
    for entry in info.get("entries") or []:
        url = entry.get("webpage_url") or entry.get("url")
        if not url or entry.get("title") in ("[Private video]", "[Deleted video]"):
            continue
        entries.append({
            "url": url,
            "title": entry.get("title") or "Untitled video",
            "channel": entry.get("channel") or entry.get("uploader") or "",
            "duration": format_duration(entry.get("duration")),
            "seconds": int(entry.get("duration") or 0),
            "thumbnail": _thumbnail_of(entry),
        })
    if not entries:
        raise ValueError("That playlist is empty, or its videos are private.")
    return {
        "playlist": True,
        "title": info.get("title") or "Playlist",
        "channel": info.get("channel") or info.get("uploader") or "",
        "entries": entries,
        "thumbnail": entries[0]["thumbnail"],
    }


def preview_of(info):
    return {
        "title": info.get("title") or "Untitled video",
        "channel": info.get("channel") or info.get("uploader") or "",
        "duration": info.get("duration_string") or format_duration(info.get("duration")),
        "thumbnail": _thumbnail_of(info),
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


def download(info, folder, fmt, quality, on_progress, trim=None, normalize=False):
    """Download a video looked up with fetch_info. Returns the saved file's path."""
    import yt_dlp

    info = copy.deepcopy(info)
    song_info(info)
    from yt_dlp.postprocessor import EmbedThumbnailPP, FFmpegMetadataPP

    # Made under a temporary name, then renamed, so a file with the same name
    # is never replaced (it becomes "name (2)" instead).
    mark = names.new_mark()
    os.makedirs(folder, exist_ok=True)
    names.used(folder)
    try:
        with yt_dlp.YoutubeDL(build_options(folder, fmt, quality, on_progress, trim, mark)) as ydl:
            finish = _finish_step(ydl, fmt, quality, trim, normalize, on_progress)
            if finish:
                ydl.add_post_processor(finish)
            if fmt != "gif":
                # Title, artist and cover art go in last, so trimming can't drop them.
                ydl.add_post_processor(FFmpegMetadataPP(ydl, add_metadata=True))
                if fmt != "wav":
                    ydl.add_post_processor(EmbedThumbnailPP(ydl, already_have_thumbnail=False))
            result = ydl.process_ie_result(info, download=True)
        downloads = (result or {}).get("requested_downloads") or [{}]
        path = downloads[0].get("filepath") or ""
        if not path or not os.path.isfile(path):
            raise OSError("The download didn't make a file.")
        path = names.finish(path)
    except BaseException:
        names.remove_leftovers(folder, mark)
        raise
    names.remove_leftovers(folder, mark)  # a thumbnail that wasn't used, and so on
    return path
