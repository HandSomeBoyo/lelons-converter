"""The Games tab: Steam games friends post, to maybe record for YouTube (like a Discord channel of links, but tidy).

Someone pastes Steam links. The app reads each game's picture, price, description, genres and reviews
from Steam's store and keeps a copy in the Library's Supabase project (see lelons_games in sfx/setup.sql),
so everyone sees the same list. Prices change, so a copy older than REFRESH_AFTER is read again
from Steam in the background by whichever app opens the list.
"""

import html
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

import sfx

STORE = "https://store.steampowered.com"
COUNTRY = "no"  # Steam prices in Norwegian kroner, whoever posts the game
CURRENCY = "NOK"
REFRESH_AFTER = 12 * 3600
REFRESH_AT_ONCE = 8  # games read again from Steam per list load
RETRY_AFTER = 3600  # a game Steam couldn't read (or that has no price in kroner) is asked about again after this
MAX_AT_ONCE = 25  # links in one paste
YT_RESULTS = 12  # YouTube videos looked at for "how big is it on YouTube"
FRIENDLY = {  # what the database says -> what the page shows
    "no game": "That game isn't in the list any more.",
    "too many games": "The list is full. Delete some old games first.",
    "slow down": "That's a lot of games for one hour. Try again later.",
}
PLAYERS = {  # Steam's category id -> what the page shows
    2: "Single-player", 1: "Multi-player", 9: "Co-op", 38: "Online co-op", 39: "Shared screen co-op",
    24: "Shared screen", 49: "PvP", 36: "Online PvP", 20: "MMO",
}
LINK = re.compile(r"(?:store\.steampowered\.com/(?:agecheck/)?app|steamcommunity\.com/app|steam://(?:store|run|install|nav/games/details)|s\.team/a)/(\d{1,9})", re.I)


class Error(Exception):
    """Something went wrong; the message is shown as it is."""


def app_ids(text):
    """The Steam games in what was pasted: store links, steam:// links, or just the number."""
    text = str(text or "")
    found = [int(n) for n in LINK.findall(text)]
    if not found and re.fullmatch(r"\s*\d{1,9}\s*", text):
        found = [int(text)]
    return [n for n in dict.fromkeys(found) if n > 0]


def _rpc(what, game_id=None, data=None):
    args = {"token": sfx.library._token(), "what": what}
    if game_id:
        args["game_id"] = game_id
    if data is not None:
        args["data"] = data
    try:
        return sfx._rpc("lelons_games", **args)
    except sfx.LoggedOut:
        raise
    except sfx.Error as e:
        for hint, message in FRIENDLY.items():
            if hint in str(e):
                raise Error(message) from None
        raise


# ---------------------------------------------------------------- reading Steam

def _get(path, timeout=15):
    request = urllib.request.Request(STORE + path, headers={"User-Agent": "Mozilla/5.0 VaultHub", "Accept-Language": "en"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read() or b"null")
    except urllib.error.HTTPError as e:
        if e.code == 429:
            raise Error("Steam says slow down. Wait a minute and try again.") from None
        raise Error(f"Steam didn't answer ({e.code}). Try again later.") from None
    except (urllib.error.URLError, OSError, ValueError):
        raise Error("Couldn't reach Steam. Check your internet connection.") from None


def _text(value, limit):
    """Steam's descriptions have HTML bits in them."""
    value = html.unescape(re.sub(r"<[^>]+>", " ", str(value or "")))
    return re.sub(r"\s+", " ", value).strip()[:limit]


def _movie(m):
    """A trailer: Steam gives an mp4 or webm file for older ones and only a stream (HLS) for newer ones."""
    pick = lambda d: str((d or {}).get("max") or (d or {}).get("480") or "")[:400] if isinstance(d, dict) else ""  # noqa: E731
    movie = {"name": _text(m.get("name"), 80), "thumb": str(m.get("thumbnail") or "")[:400],
             "mp4": pick(m.get("mp4")), "webm": pick(m.get("webm")), "hls": str(m.get("hls_h264") or "")[:400]}
    return movie if movie["mp4"] or movie["webm"] or movie["hls"] else None


def youtube_check(name):
    """How videos about a game do on YouTube: the top search results and their views."""
    import downloader
    import yt_dlp

    try:
        options = {"quiet": True, "no_warnings": True, "extract_flat": True, "socket_timeout": 20,
                   "js_runtimes": downloader._js_runtimes()}
        with yt_dlp.YoutubeDL(options) as ydl:
            info = ydl.extract_info(f"ytsearch{YT_RESULTS}:{name} gameplay", download=False)
    except Exception:
        raise Error("Couldn't look on YouTube. Check your internet connection.") from None
    videos = []
    for e in info.get("entries") or []:
        if not e.get("id") or e.get("ie_key") not in (None, "Youtube"):
            continue
        videos.append({"id": str(e["id"])[:20], "title": _text(e.get("title"), 120), "channel": _text(e.get("channel") or e.get("uploader"), 60),
                       "views": int(e.get("view_count") or 0), "seconds": int(e.get("duration") or 0)})
    videos.sort(key=lambda v: v["views"], reverse=True)
    views = sorted(v["views"] for v in videos)
    middle = views[len(views) // 2] if views else 0
    return {"middle": middle, "top": views[-1] if views else 0, "count": len(videos),
            "big": sum(1 for v in views if v >= 100_000), "videos": videos[:6]}


def steam_info(app_id):
    """What the page shows about a game, read from Steam's store."""
    found = (_get(f"/api/appdetails?appids={app_id}&cc={COUNTRY}&l=english") or {}).get(str(app_id)) or {}
    d = found.get("data") if found.get("success") else None
    if not isinstance(d, dict) or not d.get("name"):
        raise Error("Steam doesn't know that game. Check the link.")
    price = d.get("price_overview") or {}
    release = d.get("release_date") or {}
    cats = {c.get("id") for c in d.get("categories") or [] if isinstance(c, dict)}
    info = {
        "name": _text(d.get("name"), 120),
        "type": str(d.get("type") or "game")[:20],
        "header": str(d.get("header_image") or "")[:400],
        "short": _text(d.get("short_description"), 600),
        "free": bool(d.get("is_free")),
        "price": {
            "text": str(price.get("final_formatted") or "")[:30],
            "was": str(price.get("initial_formatted") or "")[:30] if price.get("discount_percent") else "",
            "cents": int(price.get("final") or 0),
            "currency": str(price.get("currency") or "")[:5],
            "discount": int(price.get("discount_percent") or 0),
        } if price else None,
        "genres": [_text(g.get("description"), 40) for g in d.get("genres") or [] if isinstance(g, dict)][:6],
        "players": [name for cid, name in PLAYERS.items() if cid in cats],
        "developers": [_text(n, 60) for n in d.get("developers") or []][:3],
        "release": _text(release.get("date"), 40),
        "soon": bool(release.get("coming_soon")),
        "screens": [{"thumb": str(s.get("path_thumbnail") or "")[:400], "full": str(s.get("path_full") or "")[:400]}
                    for s in (d.get("screenshots") or [])[:6] if isinstance(s, dict)],
        "windows": bool((d.get("platforms") or {}).get("windows", True)),
        "movies": [m for m in (_movie(m) for m in (d.get("movies") or [])[:3] if isinstance(m, dict)) if m],
    }
    try:  # how people liked it ("Very Positive"); not every game has reviews yet
        summary = (_get(f"/appreviews/{app_id}?json=1&language=all&purchase_type=all&num_per_page=0&filter=summary") or {}).get("query_summary") or {}
        total = int(summary.get("total_reviews") or 0)
        if total:
            info["reviews"] = {"text": _text(summary.get("review_score_desc"), 40), "total": total,
                               "percent": round(100 * int(summary.get("total_positive") or 0) / total)}
    except (Error, ValueError, TypeError):
        pass
    return info


# ---------------------------------------------------------------- the list

class Games:
    def __init__(self):
        self.lock = threading.Lock()
        self.refreshing = set()
        self.tried = {}  # game id -> when Steam was last asked about it (so a game Steam can't read isn't asked about on every look)

    def _pictured(self, game):
        game["byAvatar"] = sfx.public_url(game["by_avatar"]) if game.get("by_avatar") else ""
        for v in game.get("voters") or []:
            v["avatarUrl"] = sfx.public_url(v["avatar"]) if v.get("avatar") else ""
        return game

    def list(self):
        games = [self._pictured(g) for g in _rpc("list").get("games") or []]
        now = time.time()
        with self.lock:
            old = [g for g in games if (now - (g.get("refreshed") or 0) > REFRESH_AFTER
                   or ((g.get("info") or {}).get("price") or {}).get("currency", CURRENCY) != CURRENCY)
                   and now - self.tried.get(g["id"], 0) > RETRY_AFTER and g["id"] not in self.refreshing][:REFRESH_AT_ONCE]
            # (taken right away: a list asked for while these wait their turn doesn't ask Steam for them again)
            for g in old:
                self.tried[g["id"]] = now
                self.refreshing.add(g["id"])
        if old:
            threading.Thread(target=self._refresh_old, args=(old,), daemon=True).start()
        return {"games": games}

    def _refresh_old(self, games):
        """Newer prices for games read from Steam a while ago (the page shows them on its next look)."""
        for game in games:
            try:
                _rpc("refresh", game["id"], {"info": steam_info(game["app_id"])})
            except (Error, sfx.Error):
                pass
            finally:
                with self.lock:
                    self.refreshing.discard(game["id"])
            time.sleep(1.5)  # Steam doesn't like many questions at once

    def add(self, text, note=""):
        ids = app_ids(text)
        if not ids:
            raise Error("Paste a Steam link, like store.steampowered.com/app/...")
        if len(ids) > MAX_AT_ONCE:
            raise Error(f"That's a lot of games. Paste up to {MAX_AT_ONCE} links at once.")
        added, already, failed = [], [], []
        note = str(note or "").strip()[:300] if len(ids) == 1 else ""
        for app_id in ids:
            try:
                result = _rpc("add", data={"app_id": app_id, "info": steam_info(app_id), "note": note})
            except Error as e:
                failed.append({"app_id": app_id, "error": str(e)})
                continue
            game = self._pictured(result["game"])
            (already if result.get("existed") else added).append(game)
        if failed and not added and not already:
            raise Error(failed[0]["error"])
        return {"added": added, "already": already, "failed": failed}

    def refresh(self, game_id):
        games = {g["id"]: g for g in _rpc("list").get("games") or []}
        if game_id not in games:
            raise Error(FRIENDLY["no game"])
        return self._pictured(_rpc("refresh", game_id, {"info": steam_info(games[game_id]["app_id"])}))

    def youtube(self, game_id, name):
        return self._pictured(_rpc("youtube", game_id, {"youtube": youtube_check(str(name or "")[:120])}))

    def vote(self, game_id, on):
        return self._pictured(_rpc("vote", game_id, {"on": bool(on)}))

    def set_status(self, game_id, status, video=None):
        data = {"status": str(status or "")}
        if video is not None:
            video = str(video).strip()
            if video and not re.match(r"https?://", video, re.I):
                video = "https://" + video
            data["video"] = video
        return self._pictured(_rpc("status", game_id, data))

    def set_note(self, game_id, note):
        return self._pictured(_rpc("note", game_id, {"note": str(note or "")}))

    def delete(self, game_id):
        _rpc("delete", game_id)

    def comments(self, game_id):
        rows = _rpc("comments", game_id).get("comments") or []
        return [{**c, "avatarUrl": sfx.public_url(c["avatar"]) if c.get("avatar") else ""} for c in rows]

    def comment(self, game_id, text):
        text = str(text or "").strip()
        if not text:
            raise Error("Write something first.")
        _rpc("comment", game_id, {"text": text[:500]})
        return self.comments(game_id)

    def delete_comment(self, game_id, comment_id):
        _rpc("delete_comment", game_id, {"id": int(comment_id)})
        return self.comments(game_id)


games = Games()


def store_url(app_id):
    return f"{STORE}/app/{int(app_id)}/"
