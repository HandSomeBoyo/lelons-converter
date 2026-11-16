"""GIF search for the chat: trending GIFs and search, from KLIPY (or GIPHY).

The owner adds a free key once (it lives in Supabase, see lelons_gif_key), and every app asks
KLIPY itself, which is what KLIPY wants: the requests come from the people using the app."""

import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

AGENT = "VaultHub"
PER_PAGE = 24
KEEP = 300  # seconds a search answer is kept (the same search again shows at once)
_cache = {}
_lock = threading.Lock()


class Error(Exception):
    pass


def _get(url):
    request = urllib.request.Request(url, headers={"User-Agent": AGENT, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read(3_000_000) or b"{}")
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise Error("key") from None
        if e.code == 429:
            raise Error("busy") from None
        raise Error("down") from None
    except (OSError, ValueError):
        raise Error("offline") from None


def _https(url):
    return url if isinstance(url, str) and url.startswith("https://") else ""


def _klipy(key, q, pos, locale):
    params = {"key": key, "limit": PER_PAGE, "media_filter": "tinygif,gif,mediumgif",
              "contentfilter": "medium", "locale": locale}
    if pos:
        params["pos"] = pos
    if q:
        params["q"] = q
    data = _get(f"https://api.klipy.com/v2/{'search' if q else 'featured'}?{urllib.parse.urlencode(params)}")
    gifs = []
    for r in data.get("results") or []:
        media = r.get("media_formats") or {}
        small = media.get("tinygif") or media.get("gif") or {}
        send = media.get("mediumgif") or media.get("gif") or small
        dims = small.get("dims") or send.get("dims") or [0, 0]
        if _https(small.get("url")) and _https(send.get("url")):
            gifs.append({"preview": small["url"], "url": send["url"], "w": dims[0] or 0, "h": dims[1] or 0,
                         "title": str(r.get("content_description") or r.get("title") or "")[:120]})
    return {"gifs": gifs, "next": str(data.get("next") or "") or None}


def _giphy(key, q, pos, locale):
    offset = int(pos or 0)
    params = {"api_key": key, "limit": PER_PAGE, "offset": offset, "rating": "pg-13",
              "fields": "title,images.fixed_width,images.downsized_medium"}
    if q:
        params["q"] = q
        params["lang"] = locale.split("_")[0]
    data = _get(f"https://api.giphy.com/v1/gifs/{'search' if q else 'trending'}?{urllib.parse.urlencode(params)}")
    gifs = []
    for r in data.get("data") or []:
        images = r.get("images") or {}
        small = images.get("fixed_width") or {}
        send = images.get("downsized_medium") or small
        if _https(small.get("url")) and _https(send.get("url")):
            gifs.append({"preview": small["url"], "url": send["url"],
                         "w": int(small.get("width") or 0), "h": int(small.get("height") or 0),
                         "title": str(r.get("title") or "")[:120]})
    page = data.get("pagination") or {}
    more = offset + int(page.get("count") or 0) < int(page.get("total_count") or 0)
    return {"gifs": gifs, "next": str(offset + PER_PAGE) if more and gifs else None}


def search(provider, key, q="", pos=None, locale="en_US"):
    """Trending GIFs (no q) or a search: {gifs: [{preview, url, w, h, title}], next}."""
    q = re.sub(r"\s+", " ", str(q or "")).strip()[:80]
    pos = str(pos)[:200] if pos else None
    locale = locale if re.fullmatch(r"[a-z]{2}_[A-Z]{2}", str(locale or "")) else "en_US"
    if provider not in ("klipy", "giphy") or not key:
        raise Error("nokey")
    cache_key = (provider, key, q.lower(), pos, locale)
    now = time.time()
    with _lock:
        hit = _cache.get(cache_key)
        if hit and now - hit[0] < KEEP:
            return hit[1]
    result = (_klipy if provider == "klipy" else _giphy)(key, q, pos, locale)
    with _lock:
        if len(_cache) > 200:
            _cache.clear()
        _cache[cache_key] = (now, result)
    return result
