"""(2.32.0) Cards for links in the chat: YouTube videos and Steam games (both play right in the app),
and a title, text and picture for other pages. Also turns a GIPHY or Tenor page link into its GIF.

Answers are kept for an hour, so a chat full of the same link asks the site only once."""

import html
import ipaddress
import json
import re
import socket
import threading
import time
import urllib.parse
import urllib.request

import games

AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36 VaultHub"
KEEP = 3600
_cache = {}
_lock = threading.Lock()

YOUTUBE = re.compile(r"^(?:https?://)?(?:[\w-]+\.)*(?:youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|embed/|live/)|youtu\.be/)([\w-]{11})", re.I)
GIPHY_PAGE = re.compile(r"^https?://(?:www\.)?giphy\.com/(?:gifs|stickers)/(?:[\w-]*-)?([A-Za-z0-9]{8,40})/?(?:[?#].*)?$", re.I)
GIF_MEDIA = re.compile(r"^https://(media[0-9]*\.giphy\.com|i\.giphy\.com|media[0-9]*\.tenor\.com|c\.tenor\.com|i\.imgur\.com)/[^\s\"'<>\\]+$", re.I)


class Error(Exception):
    pass


def _public(url):
    """Only pages out on the internet (not this PC or the home network)."""
    host = urllib.parse.urlsplit(url).hostname or ""
    if not host or host == "localhost" or host.endswith(".local"):
        return False
    try:
        for info in socket.getaddrinfo(host, None)[:4]:
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                return False
    except (OSError, ValueError):
        return False
    return True


def _fetch(url, limit=400_000, timeout=10):
    if not re.match(r"^https?://", url, re.I) or not _public(url):
        raise Error("bad link")
    request = urllib.request.Request(url, headers={"User-Agent": AGENT, "Accept-Language": "en"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            kind = response.headers.get("Content-Type", "")
            return response.read(limit), kind, response.geturl()
    except (OSError, ValueError) as e:
        raise Error("unreachable") from e


def _meta(page):
    """The og: and twitter: tags (and the <title>) of a page."""
    text = page.decode("utf-8", "replace")
    found = {}
    for tag in re.findall(r"<meta\b[^>]*>", text, re.I):
        key = re.search(r"\b(?:property|name)\s*=\s*[\"']([^\"']+)[\"']", tag, re.I)
        value = re.search(r"\bcontent\s*=\s*[\"']([^\"']*)[\"']", tag, re.I)
        if key and value and key.group(1).lower() not in found:
            found[key.group(1).lower()] = html.unescape(value.group(1)).strip()
    title = re.search(r"<title[^>]*>(.*?)</title>", text, re.I | re.S)
    if title:
        found.setdefault("title", html.unescape(re.sub(r"\s+", " ", title.group(1))).strip())
    return found


def _youtube(video_id):
    info = {"kind": "youtube", "id": video_id, "url": f"https://www.youtube.com/watch?v={video_id}",
            "thumb": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg", "title": "YouTube video", "author": ""}
    try:
        body, _, _ = _fetch("https://www.youtube.com/oembed?format=json&url=" + urllib.parse.quote(info["url"]), 100_000)
        data = json.loads(body or b"{}")
        info["title"] = str(data.get("title") or info["title"])[:150]
        info["author"] = str(data.get("author_name") or "")[:80]
    except (Error, ValueError):
        pass
    return info


def _steam(app_id):
    try:
        game = games.steam_info(app_id)
    except games.Error:
        return None
    price = game.get("price") or {}
    return {"kind": "steam", "id": app_id, "url": games.store_url(app_id), "title": game.get("name", ""),
            "text": (game.get("short") or "")[:220], "thumb": game.get("header", ""),
            "price": "Free" if game.get("free") else price.get("text", ""), "was": price.get("was", ""),
            "discount": price.get("discount", 0), "reviews": (game.get("reviews") or {}).get("text", ""),
            "movie": (game.get("movies") or [None])[0], "soon": game.get("soon", False), "release": game.get("release", "")}


def _page(url):
    body, kind, final = _fetch(url)
    if kind.startswith("image/gif"):
        return {"kind": "gif", "url": url, "gif": url if GIF_MEDIA.match(url) else ""}
    if kind.startswith("image/"):
        return {"kind": "image", "url": url, "thumb": url}
    if "html" not in kind:
        return None
    meta = _meta(body)
    title = meta.get("og:title") or meta.get("twitter:title") or meta.get("title") or ""
    if not title:
        return None
    image = meta.get("og:image") or meta.get("twitter:image") or ""
    if image:
        image = urllib.parse.urljoin(final, image)
    if not image.startswith("https://"):
        image = ""
    return {"kind": "page", "url": url, "title": title[:150],
            "text": (meta.get("og:description") or meta.get("description") or meta.get("twitter:description") or "")[:220],
            "site": (meta.get("og:site_name") or urllib.parse.urlsplit(final).hostname or "")[:60], "thumb": image[:500]}


def preview(url):
    """The card for a link, or None when there's nothing to show."""
    url = str(url or "").strip()[:800]
    if not re.match(r"^https?://", url, re.I):
        return None
    now = time.time()
    with _lock:
        kept = _cache.get(url)
        if kept and now - kept[0] < KEEP:
            return kept[1]
    found = YOUTUBE.match(url)
    ids = games.app_ids(url) if "steampowered.com" in url or "steamcommunity.com" in url else []
    try:
        if found:
            card = _youtube(found.group(1))
        elif ids:
            card = _steam(ids[0])
        elif gif_link(url):
            card = {"kind": "gif", "url": url, "gif": gif_link(url)}
        else:
            card = _page(url)
    except Error:
        card = None
    with _lock:
        if len(_cache) > 400:
            _cache.clear()
        _cache[url] = (now, card)
    return card


def gif_link(url):
    """The GIF file behind a GIPHY or Tenor link (or the link itself, when it already is one). '' if none."""
    url = str(url or "").strip()
    if GIF_MEDIA.match(url):
        return url
    m = GIPHY_PAGE.match(url)
    if m:
        return f"https://media.giphy.com/media/{m.group(1)}/giphy.gif"
    if re.match(r"^https?://(?:www\.)?tenor\.com/", url, re.I):
        try:
            body, _, _ = _fetch(url)
        except Error:
            return ""
        meta = _meta(body)
        for key in ("og:image", "twitter:image", "og:video", "og:url"):
            value = meta.get(key, "")
            if GIF_MEDIA.match(value) and value.lower().split("?")[0].endswith(".gif"):
                return value
        found = re.search(rb"https://media[0-9]*\.tenor\.com/[A-Za-z0-9_-]+/[^\"'\s<>]+?\.gif", body)
        if found:
            return found.group(0).decode()
    return ""
