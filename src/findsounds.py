"""Find sounds online from inside the Library: free sound effects (Openverse, which covers
Freesound and others; all Creative Commons) and meme sounds (Myinstants).

Only sounds that came back in a search can be downloaded (by their id), so the page can't
make the app fetch anything else.
"""

import html
import json
import os
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid

import media
import names
import sfx

OPENVERSE = "https://api.openverse.org/v1/audio/"
MYINSTANTS = "https://www.myinstants.com"
AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) LelonsConverter"
MAX_BYTES = 30 * 1024 * 1024
PER_PAGE = 20
LICENSES = {"cc0": "CC0 (free to use)", "pdm": "Public domain", "by": "CC BY (credit the creator)",
            "by-sa": "CC BY-SA", "by-nc": "CC BY-NC (not for money)", "by-nd": "CC BY-ND",
            "by-nc-sa": "CC BY-NC-SA", "by-nc-nd": "CC BY-NC-ND", "sampling+": "Sampling+"}

_lock = threading.Lock()
_found = {}  # id -> {"url", "title"}: what searches came back with


class Error(Exception):
    """Shown to the user as it is."""


def _get(url, timeout=20):
    request = urllib.request.Request(url, headers={"User-Agent": AGENT, "Accept": "application/json, text/html"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read(4 * 1024 * 1024).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        if e.code == 429:
            raise Error("Too many searches in a row. Wait a minute and try again.") from None
        raise Error("That site isn't answering right now. Try again in a bit.") from None
    except (urllib.error.URLError, OSError, ValueError):
        raise Error("Couldn't reach the site. Check your internet connection.") from None


def _remember(url, title):
    found_id = uuid.uuid5(uuid.NAMESPACE_URL, url).hex[:16]
    with _lock:
        _found[found_id] = {"url": url, "title": title}
        if len(_found) > 2000:
            for key in list(_found)[:500]:
                del _found[key]
    return found_id


def _effects(query, page):
    params = {"q": query, "category": "sound_effect", "page_size": PER_PAGE, "page": page, "mature": "false"}
    data = json.loads(_get(OPENVERSE + "?" + urllib.parse.urlencode(params)) or "{}")
    results = []
    for r in data.get("results") or []:
        url = r.get("url") or ""
        if not url.startswith("https://"):
            continue
        title = re.sub(r"\.(wav|mp3|ogg|flac|aiff?)$", "", (r.get("title") or "Untitled").strip(), flags=re.I)
        license_name = LICENSES.get(str(r.get("license") or "").lower(), str(r.get("license") or "").upper())
        results.append({
            "id": _remember(url, title),
            "title": title[:120],
            "preview": url,
            "seconds": round((r.get("duration") or 0) / 1000, 1),
            "creator": (r.get("creator") or "")[:60],
            "license": license_name,
            "site": (r.get("source") or r.get("provider") or "").replace("_", " ").title(),
            "page": r.get("foreign_landing_url") or "",
        })
    more = (data.get("page_count") or 0) > page
    return results, more


def _memes(query, page):
    text = _get(f"{MYINSTANTS}/en/search/?" + urllib.parse.urlencode({"name": query, "page": page}))
    results = []
    plays = list(re.finditer(r"play\('(/media/sounds/[^']+?)'", text))
    for i, match in enumerate(plays):
        block = text[match.end(): plays[i + 1].start() if i + 1 < len(plays) else match.end() + 3000]
        found = (re.search(r'class="instant-link[^"]*"[^>]*>([^<]+)<', block)
                 or re.search(r'title="Play ([^"]+?) sound"', text[max(0, match.start() - 400): match.end() + 400]))
        url = MYINSTANTS + match.group(1)
        title = html.unescape(found.group(1)).strip() if found else os.path.splitext(os.path.basename(match.group(1)))[0]
        results.append({"id": _remember(url, title), "title": title[:120], "preview": url, "seconds": 0,
                        "creator": "", "license": "", "site": "Myinstants", "page": ""})
    more = "page=" + str(page + 1) in text
    return results, more


def search(query, source="effects", page=1):
    query = re.sub(r"\s+", " ", str(query or "")).strip()[:80]
    if len(query) < 2:
        raise Error("Type at least 2 letters.")
    try:
        page = max(1, min(20, int(page)))
    except (TypeError, ValueError):
        page = 1
    results, more = (_memes if source == "memes" else _effects)(query, page)
    seen = set()
    unique = [r for r in results if not (r["id"] in seen or seen.add(r["id"]))]
    return {"results": unique, "more": more, "page": page}


def _download(found_id):
    with _lock:
        found = _found.get(str(found_id))
    if not found:
        raise Error("Search again, that sound isn't in the list anymore.")
    os.makedirs(sfx.FOLDER, exist_ok=True)
    ext = os.path.splitext(urllib.parse.urlsplit(found["url"]).path)[1].lower()[:6] or ".mp3"
    path = os.path.join(sfx.FOLDER, f"find-{uuid.uuid4().hex[:8]}{ext}")
    request = urllib.request.Request(found["url"], headers={"User-Agent": AGENT})
    try:
        with urllib.request.urlopen(request, timeout=60) as response, open(path, "wb") as out:
            total = 0
            while chunk := response.read(256 * 1024):
                total += len(chunk)
                if total > MAX_BYTES:
                    raise Error("That sound is too big.")
                out.write(chunk)
    except Error:
        os.remove(path)
        raise
    except (urllib.error.URLError, OSError, ValueError):
        if os.path.exists(path):
            os.remove(path)
        raise Error("Couldn't download that sound. Check your internet connection.") from None
    return path, found["title"]


def add_to_library(found_id):
    """Download it and get it ready for the Library's upload window. Returns the file item."""
    path, title = _download(found_id)
    try:
        return sfx.library._register(names.safe_stem(title, "sound") + os.path.splitext(path)[1], path, copied=True)
    except sfx.Error as e:
        raise Error(str(e)) from None


def save(found_id, folder):
    """Download it as an MP3 into folder. Returns the file's path."""
    path, title = _download(found_id)
    try:
        found = media.probe(path)
        if not found["audio"]:
            raise Error("That one has no sound in it.")
        os.makedirs(folder, exist_ok=True)
        temp = names.temp_path(folder, names.safe_stem(title, "sound"), ".mp3")
        try:
            media.convert_audio(path, temp, "mp3", "192", None, False, found["duration"])
            out = names.finish(temp)
        except BaseException:
            if os.path.exists(temp):
                os.remove(temp)
            raise
    finally:
        try:
            os.remove(path)
        except OSError:
            pass
    sfx.library.saved.add(os.path.normcase(out))
    return out
