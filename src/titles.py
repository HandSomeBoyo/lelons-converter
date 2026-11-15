"""The Titles & tags tab: help with a video's title and tags.

The scoring and the title ideas happen in the page (ui/titles.js), so they change as you type.
This part looks up a topic on YouTube:
- what people type in YouTube's search box (YouTube's own search suggestions), and
- the top videos for it (yt-dlp search), with their views and the tags their makers used.
The tags that many of the top videos share are the best ones to copy.
"""

import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

import downloader

SUGGEST = "https://suggestqueries-clients6.youtube.com/complete/search"
AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) VaultHub"
SEARCHED = 12   # videos read from the search page
DETAILED = 8    # of those, how many are opened one by one for their tags
KEEP = 30 * 60  # a topic's results are kept this long

_cache = {}
_lock = threading.Lock()


class Error(Exception):
    pass


def clean_topic(text):
    return re.sub(r"\s+", " ", str(text or "")).strip()[:80]


def _suggest(query):
    """What YouTube's search box suggests for this (a list of phrases)."""
    url = SUGGEST + "?" + urllib.parse.urlencode({"client": "firefox", "ds": "yt", "hl": "en", "q": query})
    request = urllib.request.Request(url, headers={"User-Agent": AGENT})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            data = json.loads(response.read().decode("utf-8", "replace") or "null")
    except (urllib.error.URLError, OSError, ValueError):
        return []
    if isinstance(data, list) and len(data) > 1 and isinstance(data[1], list):
        return [str(s).strip() for s in data[1] if isinstance(s, str) and s.strip()]
    return []


def _search(topic):
    """The top videos on YouTube for the topic (title, channel, views)."""
    import yt_dlp

    options = {"quiet": True, "no_warnings": True, "extract_flat": "in_playlist", "socket_timeout": 20,
               "js_runtimes": downloader._js_runtimes()}
    try:
        with yt_dlp.YoutubeDL(options) as ydl:
            info = ydl.extract_info(f"ytsearch{SEARCHED}:{topic}", download=False)
    except Exception:
        raise Error("Couldn't search YouTube. Check your internet connection and try again.") from None
    videos = []
    for e in info.get("entries") or []:
        if not e or not e.get("id") or len(str(e["id"])) != 11:
            continue  # (channels and playlists can show up in a search too)
        videos.append({
            "id": e["id"], "url": "https://www.youtube.com/watch?v=" + e["id"],
            "title": e.get("title") or "", "channel": e.get("channel") or e.get("uploader") or "",
            "views": e.get("view_count"), "seconds": int(e.get("duration") or 0), "when": e.get("timestamp"),
            "thumbnail": f"https://i.ytimg.com/vi/{e['id']}/mqdefault.jpg", "tags": [],
        })
    return videos


def _details(video):
    """One video's tags (and its exact views and upload time)."""
    import yt_dlp

    options = {"quiet": True, "no_warnings": True, "socket_timeout": 20, "js_runtimes": downloader._js_runtimes()}
    try:
        with yt_dlp.YoutubeDL(options) as ydl:
            info = ydl.extract_info(video["url"], download=False, process=False)
        video.update(tags=[str(t) for t in (info.get("tags") or []) if t][:60],
                     views=info.get("view_count", video["views"]), when=info.get("timestamp") or video["when"])
    except Exception:
        pass
    return video


def _norm(tag):
    return re.sub(r"\s+", " ", tag.strip().lower().lstrip("#"))


def look_up(topic):
    """Search suggestions, top videos and the tags they use, for one topic."""
    topic = clean_topic(topic)
    if len(topic) < 2:
        raise Error("Type what your video is about first.")
    key = topic.lower()
    with _lock:
        kept = _cache.get(key)
        if kept and time.time() - kept[0] < KEEP:
            return kept[1]

    with ThreadPoolExecutor(4) as pool:
        asked = [pool.submit(_suggest, q) for q in (topic, topic + " ", "how to " + topic, "best " + topic)]
        videos = _search(topic)
        list(pool.map(_details, videos[:DETAILED]))
        found = [f.result() for f in asked]

    searches, seen = [], set()
    for phrase in [s for lst in found for s in lst]:
        n = _norm(phrase)
        if n and n not in seen and n != key:
            seen.add(n)
            searches.append(phrase)
    searches = searches[:14]

    # Tags: how many of the top videos use each one (spelled like most of them spell it).
    used, spelling = Counter(), {}
    for v in videos:
        for tag in {_norm(t): t for t in v["tags"]}.values():
            n = _norm(tag)
            if 2 <= len(n) <= 60:
                used[n] += 1
                spelling.setdefault(n, Counter())[tag.strip().lstrip("#")] += 1
    tags = [{"tag": spelling[n].most_common(1)[0][0], "count": c} for n, c in used.most_common(40) if c >= 1]

    result = {"ok": True, "topic": topic, "searches": searches, "videos": videos[:10], "tags": tags,
              "looked": sum(1 for v in videos[:DETAILED] if v["tags"])}
    with _lock:
        _cache[key] = (time.time(), result)
        for k in [k for k, (t, _) in _cache.items() if time.time() - t > KEEP]:
            _cache.pop(k, None)
    return result
