"""The Home page: the crew's YouTube channel (subscribers and newest uploads), and your own stats.

The channel is read with yt-dlp, like a video, so no Google key is needed. YouTube shows
subscribers rounded (like 12.3K), so that's what we get too.
"""

import re
import threading
import time

import downloader

REFRESH = 5 * 60  # seconds between looks at the channel
RETRY = 60  # after it didn't work
UPLOADS = 3  # newest uploads shown on Home
VIDEOS = 30  # newest videos looked at for the stats (one page of the channel)
on_update = None  # called with (url, info) after each new look, to remember the numbers

_lock = threading.Lock()
_cache = {}  # channel url -> {"at": time, "info": {...} or None, "error": "", "busy": bool}


def normalize(text):
    """A channel link (or just @name) as https://www.youtube.com/@name, or None if it isn't one."""
    text = (text or "").strip()
    if re.fullmatch(r"@[\w.\-]{1,100}", text):
        return "https://www.youtube.com/" + text
    found = re.match(r"^(?:https?://)?(?:www\.|m\.)?youtube\.com/(@[^/?#\s]{1,100}|channel/UC[A-Za-z0-9_-]{22}|c/[^/?#\s]{1,100}|user/[^/?#\s]{1,100})", text)
    return "https://www.youtube.com/" + found.group(1) if found else None


def _avatar(info):
    pictures = [t for t in info.get("thumbnails") or [] if "avatar" in str(t.get("id", ""))]
    pictures.sort(key=lambda t: t.get("width") or t.get("preference") or 0)
    return pictures[-1]["url"] if pictures else ""


def _fetch(url):
    """Look at the channel's Videos page: its name, subscribers and newest uploads."""
    import yt_dlp

    options = {"quiet": True, "no_warnings": True, "extract_flat": "in_playlist", "playlistend": VIDEOS,
               "socket_timeout": 20, "js_runtimes": downloader._js_runtimes(),
               "extractor_args": {"youtubetab": {"approximate_date": ["true"]}}}
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(url + "/videos", download=False)
        uploads = []
        for entry in list(info.get("entries") or [])[:VIDEOS]:
            if not entry.get("id"):
                continue
            uploads.append({
                "id": entry["id"],
                "url": f"https://www.youtube.com/watch?v={entry['id']}",
                "title": entry.get("title") or "Untitled video",
                "views": entry.get("view_count"),
                "seconds": int(entry.get("duration") or 0),
                "when": entry.get("timestamp"),
                "thumbnail": f"https://i.ytimg.com/vi/{entry['id']}/mqdefault.jpg",
            })
        # The newest upload's exact views and likes (the list only has them rounded).
        if uploads:
            try:
                video = ydl.extract_info(uploads[0]["url"], download=False, process=False)
                uploads[0].update(views=video.get("view_count", uploads[0]["views"]), likes=video.get("like_count"),
                                  when=video.get("timestamp") or uploads[0]["when"])
            except Exception:
                pass
    name = info.get("channel") or info.get("uploader") or info.get("title") or ""
    return {
        "url": url,
        "name": re.sub(r"\s+-\s+Videos$", "", name),
        "handle": info.get("uploader_id") or "",
        "avatar": _avatar(info),
        "subscribers": info.get("channel_follower_count"),
        "uploads": uploads[:UPLOADS],
        "videos": uploads,
    }


def _refresh(url):
    try:
        info, error = _fetch(url), ""
    except Exception as e:
        info, error = None, downloader.friendly_error(e)
    with _lock:
        entry = _cache[url]
        entry.update(at=time.time(), busy=False, error=error if not info else "")
        if info:
            entry["info"] = info
            entry["checked"] = time.time()
    if info and on_update:
        try:
            on_update(url, info)
        except Exception:
            pass  # only for the stats


def channel(url):
    """What's known about the channel right now; looks again in the background when it's old."""
    if not url:
        return None
    with _lock:
        entry = _cache.setdefault(url, {"at": 0, "info": None, "error": "", "busy": False, "checked": 0})
        wait = REFRESH if entry["info"] and not entry["error"] else RETRY
        if not entry["busy"] and time.time() - entry["at"] > wait:
            entry["busy"] = True
            threading.Thread(target=_refresh, args=(url,), daemon=True).start()
        return {"url": url, "info": entry["info"], "error": entry["error"],
                "loading": entry["busy"] and not entry["info"], "checked": entry["checked"]}
