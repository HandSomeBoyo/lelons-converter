"""Watch your own stream inside the Live console, the way viewers see it (picture and sound).

yt-dlp finds the stream's HLS playlist on Twitch or YouTube (free, no keys). The page plays it with
hls.js, and every playlist and video piece goes through this app (/live-hls?u=...), because the
sites don't let other web pages load them directly. Only Twitch and YouTube video addresses pass.
"""

import re
import threading
import time
import urllib.parse
import urllib.request

import live

HOSTS = (".ttvnw.net", ".twitch.tv", ".googlevideo.com", ".youtube.com")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"

_lock = threading.Lock()
_found = {}  # page url -> (time, playlist url)


class Error(Exception):
    pass


def allowed(url):
    try:
        u = urllib.parse.urlsplit(url)
    except ValueError:
        return False
    host = (u.hostname or "").lower()
    return u.scheme == "https" and any(host.endswith(h) or host == h[1:] for h in HOSTS)


def source(p, name):
    """The local address of the live playlist for Twitch channel / YouTube video id `name`."""
    if p == "tw" and re.fullmatch(r"\w{2,25}", name or ""):
        page = "https://www.twitch.tv/" + name.lower()
    elif p == "yt" and re.fullmatch(r"[\w-]{11}", name or ""):
        page = "https://www.youtube.com/watch?v=" + name
    else:
        raise Error("Nothing to show yet.")
    with _lock:
        hit = _found.get(page)
    if hit and time.time() - hit[0] < 60:
        return local(hit[1])
    import yt_dlp

    try:
        with yt_dlp.YoutubeDL(live._options()) as ydl:
            info = ydl.extract_info(page, download=False) or {}
    except Exception as e:  # noqa: BLE001 (yt-dlp says "not live" in many ways)
        raise Error("Couldn't find your stream. Are you live?" if live._not_live(e) else "Couldn't load the stream just now.")
    if info.get("is_live") is False:
        raise Error("You're not live there right now.")
    playlist = ""
    for f in reversed(info.get("formats") or []):  # (best last)
        if "m3u8" in str(f.get("protocol") or ""):
            playlist = f.get("manifest_url") or f.get("url") or ""
            if playlist:
                break
    if not allowed(playlist):
        raise Error("Couldn't load the stream just now.")
    with _lock:
        _found[page] = (time.time(), playlist)
    return local(playlist)


def local(url):
    return "/live-hls?u=" + urllib.parse.quote(url, safe="")


def _rewrite(text, base):
    """Points every address in a playlist back through this app."""
    out = []
    for line in text.splitlines():
        s = line.strip()
        if not s:
            out.append(line)
        elif s.startswith("#"):
            out.append(re.sub(r'URI="([^"]+)"', lambda m: f'URI="{local(urllib.parse.urljoin(base, m.group(1)))}"', line))
        else:
            out.append(local(urllib.parse.urljoin(base, s)))
    return "\n".join(out) + "\n"


def fetch(url):
    """(body, content type) of one playlist or video piece."""
    if not allowed(url):
        raise Error("Not a stream address.")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=15) as r:
        if not allowed(r.geturl()):
            raise Error("Not a stream address.")
        body = r.read(64 * 1024 * 1024)
        kind = r.headers.get("Content-Type") or "application/octet-stream"
        final = r.geturl()
    if body[:7] == b"#EXTM3U":
        return _rewrite(body.decode("utf-8", "replace"), final).encode(), "application/vnd.apple.mpegurl"
    # (2.34.1) Only video pieces come back through here, never a web page that could act as part of the app.
    kind = kind.split(";")[0].strip().lower()
    if not (kind.startswith(("video/", "audio/")) or kind in ("application/octet-stream", "application/mp4")):
        kind = "application/octet-stream"
    return body, kind
