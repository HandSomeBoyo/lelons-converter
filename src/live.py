"""Stream alerts: is a friend live on YouTube or Twitch right now?

Free, with no API keys: yt-dlp (which the app already uses for downloads) looks at the channel's
Live tab on YouTube, or the channel page on Twitch, the same way it does when you download a video.
Each channel is looked at in the background now and then; live() answers right away with what's
known, so the page never waits for YouTube or Twitch.
"""

import re
import threading
import time

import downloader

CHECK_EVERY = 120   # seconds between looks at one channel
RETRY = 300         # after an error (YouTube or Twitch didn't answer)
FORGET = 1800       # channels nobody asked about for this long are dropped

_lock = threading.Lock()
_cache = {}  # (kind, name) -> {"at", "asked", "busy", "live": None | {...}, "error"}
_busy = threading.Semaphore(3)  # at most this many looks at once


def twitch_name(text):
    """A Twitch link or name as the plain lowercase name, "" for nothing, None if it isn't one."""
    text = str(text or "").strip()
    if not text:
        return ""
    found = re.match(r"^(?:https?://)?(?:www\.|m\.)?twitch\.tv/([A-Za-z0-9_]{1,25})/?(?:[?#].*)?$", text)
    name = found.group(1) if found else text.lstrip("@")
    return name.lower() if re.fullmatch(r"[A-Za-z0-9_]{1,25}", name) else None


def _not_live(error):
    text = str(error).lower()
    return any(s in text for s in ("not currently live", "is not live", "not live", "offline",
                                   "this live event will begin", "premieres in", "does not have a live", "does not have a streams tab", "no live"))


def _options():
    return {"quiet": True, "no_warnings": True, "socket_timeout": 20, "skip_download": True,
            "ignore_no_formats_error": True, "js_runtimes": downloader._js_runtimes()}


def _youtube(url):
    """The stream that's live on the channel right now, or None."""
    import yt_dlp

    # The channel's Live tab lists streams newest first, and says which one is live right now.
    with yt_dlp.YoutubeDL({**_options(), "extract_flat": "in_playlist", "playlistend": 4}) as ydl:
        info = ydl.extract_info(url + "/streams", download=False)
        for entry in list(info.get("entries") or [])[:4]:
            if entry.get("live_status") != "is_live" or not entry.get("id"):
                continue
            # The video itself: its exact title, viewers and when it started.
            video = {}
            try:
                video = ydl.extract_info("https://www.youtube.com/watch?v=" + entry["id"], download=False, process=False) or {}
            except Exception:
                pass
            if video and video.get("live_status") not in (None, "is_live"):
                continue
            return {"id": entry["id"], "title": video.get("title") or entry.get("title") or "Live now",
                    "url": "https://www.youtube.com/watch?v=" + entry["id"],
                    "thumbnail": f"https://i.ytimg.com/vi/{entry['id']}/mqdefault_live.jpg",
                    "viewers": video.get("concurrent_view_count") or entry.get("concurrent_view_count"),
                    "started": video.get("release_timestamp") or video.get("timestamp"),
                    "channel": info.get("channel") or info.get("uploader") or ""}
    return None


def _twitch(name):
    """What's live on the Twitch channel right now, or None."""
    import yt_dlp

    with yt_dlp.YoutubeDL(_options()) as ydl:
        try:
            info = ydl.extract_info("https://www.twitch.tv/" + name, download=False, process=False) or {}
        except Exception as e:
            if _not_live(e):
                return None
            raise
    if info.get("is_live") is False or info.get("live_status") not in (None, "is_live"):
        return None
    title = info.get("description") or info.get("title") or "Live now"
    title = re.sub(r"\s+\d{4}-\d\d-\d\d \d\d:\d\d$", "", title)  # (yt-dlp adds the date to the title)
    return {"id": str(info.get("id") or name), "title": title, "url": "https://www.twitch.tv/" + name,
            # Twitch's own preview picture of the stream (the time on the end gets a fresh one)
            "thumbnail": f"https://static-cdn.jtvnw.net/previews-ttv/live_user_{name}-320x180.jpg?t={int(time.time()) // 300}",
            "viewers": info.get("view_count") or info.get("concurrent_view_count"),
            "started": info.get("timestamp"), "channel": info.get("uploader") or name}


def _look(key):
    kind, name = key
    with _busy:
        try:
            live, error = (_youtube(name) if kind == "youtube" else _twitch(name)), ""
        except Exception as e:  # noqa: BLE001 (anything: a site changed, no internet...)
            live, error = None, "" if _not_live(e) else (str(e) or "Couldn't look")
    with _lock:
        entry = _cache.get(key)
        if entry is None:
            return
        entry.update(at=time.time(), busy=False, error=error)
        if not error:
            entry["live"] = live


def live(channels):
    """channels: [{username, avatarUrl, youtube, twitch}]. Who of them is live now, as far as is known
    ({username, avatarUrl, kind: youtube|twitch, id, title, url, thumbnail, viewers, started, channel}),
    and whether some channels haven't been looked at yet."""
    now = time.time()
    out, waiting = [], False
    with _lock:
        for key in [k for k, e in _cache.items() if now - e["asked"] > FORGET]:
            del _cache[key]
        for person in channels or []:
            for kind, name in (("youtube", person.get("youtube")), ("twitch", person.get("twitch"))):
                if not name:
                    continue
                key = (kind, name)
                entry = _cache.setdefault(key, {"at": 0, "asked": now, "busy": False, "live": None, "error": ""})
                entry["asked"] = now
                if not entry["busy"] and now - entry["at"] > (RETRY if entry["error"] else CHECK_EVERY):
                    entry["busy"] = True
                    threading.Thread(target=_look, args=(key,), daemon=True).start()
                if not entry["at"]:
                    waiting = True
                if entry["live"]:
                    out.append({**entry["live"], "kind": kind, "username": person.get("username") or "",
                                "avatarUrl": person.get("avatarUrl") or ""})
    out.sort(key=lambda s: -(s.get("viewers") or 0))
    return {"live": out, "loading": waiting}
