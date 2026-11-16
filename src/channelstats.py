"""The Channel stats tab: how your own YouTube channel is doing.

Two ways to get the numbers:
- Public: just your channel link. yt-dlp reads your Videos and Shorts pages (like Home does), so
  it works right away with no setup. It shows subscribers (rounded by YouTube), views, likes and
  comments. The app writes the numbers down once a day, so the graph fills in day by day.
- Google: you sign in with Google once (a Google Cloud "Desktop app" client you make yourself,
  see the tab's setup guide). Then YouTube's own Analytics are used: exact subscribers, views,
  watch time day by day and where viewers come from.
"""

import base64
import datetime
import hashlib
import json
import os
import re
import secrets
import statistics
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import downloader
import home
import settings

SNAP_FILE = os.path.join(settings.DATA_DIR, "channel_stats.json")
PUBLIC_REFRESH = 10 * 60  # seconds between looks at the channel's pages
GOOGLE_REFRESH = 15 * 60  # Google's numbers only change every few hours anyway
RETRY = 60
LISTED = 300  # videos (and Shorts) read from the channel's pages for the totals
NEWEST = 12  # newest uploads shown
UPLOADS = 200  # uploads asked from Google (newest first)
DETAILS = 10  # newest videos and Shorts looked at one by one (exact views, likes, comments)
SCOPES = "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly"
REPLY_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl"  # the Comments tab: answer and hide comments
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
DATA_API = "https://www.googleapis.com/youtube/v3/"
ANALYTICS_API = "https://youtubeanalytics.googleapis.com/v2/reports"

# YouTube's names for where views come from, in plain words.
SOURCES = {
    "YT_SEARCH": "YouTube search", "SHORTS": "Shorts feed", "RELATED_VIDEO": "Suggested videos",
    "SUBSCRIBER": "Home and subscriptions", "BROWSE": "Home and subscriptions", "EXT_URL": "Other websites and apps",
    "NO_LINK_OTHER": "Direct or unknown", "PLAYLIST": "Playlists", "YT_CHANNEL": "Your channel page",
    "CHANNEL": "Your channel page", "NOTIFICATION": "Notifications", "END_SCREEN": "End screens",
    "ANNOTATION": "Cards and links", "CAMPAIGN_CARD": "Cards and links", "YT_OTHER_PAGE": "Other YouTube pages",
    "HASHTAGS": "Hashtag pages", "SOUND_PAGE": "Sound pages", "LIVE_REDIRECT": "Live redirects",
    "ADVERTISING": "Ads", "PRODUCT_PAGE": "Product pages", "IMMERSIVE_LIVE": "Live feed",
    "VIDEO_REMIXES": "Remixes", "SHORTS_CONTENT_LINKS": "Links in Shorts", "YT_PLAYLIST_PAGE": "Playlists",
}


class Error(Exception):
    pass


_lock = threading.Lock()
_public = {}  # channel url -> {"at", "busy", "info", "error", "checked"}
_google = {"at": 0, "busy": False, "data": None, "error": "", "checked": 0}
_reports = {}  # days -> (time, the range's numbers)
_pending = {}  # state -> (code verifier, redirect uri, time) while the Google sign-in page is open
_access = {"token": "", "until": 0}


# ---------------------------------------------------------------- settings


def _config():
    s = settings.load()
    return {"channel": s.get("ch_channel") or "", "client_id": s.get("ch_client_id") or "",
            "client_secret": s.get("ch_client_secret") or "", "refresh": s.get("ch_refresh") or "",
            "google_name": s.get("ch_google_name") or "", "scopes": s.get("ch_scopes") or ""}


def can_reply():
    """Did Google let the app answer comments (the Comments tab asks for this the first time)?"""
    return REPLY_SCOPE in _config()["scopes"].split()


def set_channel(url):
    link = home.normalize(url)
    if not link:
        raise Error("That isn't a YouTube channel link. It looks like youtube.com/@yourname.")
    settings.save(ch_channel=link)
    return link


def set_client(client_id, client_secret):
    """The Google Cloud client made in the setup guide."""
    client_id, client_secret = str(client_id or "").strip(), str(client_secret or "").strip()
    if not re.fullmatch(r"[\w.-]+\.apps\.googleusercontent\.com", client_id):
        raise Error("That Client ID doesn't look right. It ends with .apps.googleusercontent.com.")
    if not re.fullmatch(r"[\w-]{10,100}", client_secret):
        raise Error("That Client secret doesn't look right. It starts with GOCSPX-.")
    settings.save(ch_client_id=client_id, ch_client_secret=client_secret)


def disconnect(forget_client=False):
    refresh = _config()["refresh"]
    changes = {"ch_refresh": "", "ch_google_name": "", "ch_scopes": ""}
    if forget_client:
        changes.update(ch_client_id="", ch_client_secret="")
    settings.save(**changes)
    _access.update(token="", until=0)
    with _lock:
        _google.update(at=0, data=None, error="", checked=0)
        _reports.clear()
    if refresh:  # tell Google too, so the app's sign-in stops working everywhere
        threading.Thread(target=_revoke, args=(refresh,), daemon=True).start()


def _revoke(token):
    try:
        urllib.request.urlopen(urllib.request.Request("https://oauth2.googleapis.com/revoke",
                               data=urllib.parse.urlencode({"token": token}).encode()), timeout=15).close()
    except Exception:
        pass


# ---------------------------------------------------------------- days written down


def _load_snaps():
    try:
        with open(SNAP_FILE, encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _remember(key, subs, views):
    """Today's subscribers and views for the channel, so the graph has something to show tomorrow."""
    if subs is None and views is None:
        return
    with _lock:
        snaps = _load_snaps()
        days = snaps.setdefault(key, {})
        days[datetime.date.today().isoformat()] = {"subs": subs, "views": views}
        for old in sorted(days)[:-400]:
            del days[old]
        os.makedirs(settings.DATA_DIR, exist_ok=True)
        temp = SNAP_FILE + ".new"
        with open(temp, "w", encoding="utf-8") as f:
            json.dump(snaps, f)
        os.replace(temp, SNAP_FILE)


# ---------------------------------------------------------------- public numbers (yt-dlp)


def _entry(entry, short):
    return {
        "id": entry["id"], "url": f"https://www.youtube.com/{'shorts/' if short else 'watch?v='}{entry['id']}",
        "title": entry.get("title") or "Untitled video", "views": entry.get("view_count"),
        "seconds": int(entry.get("duration") or 0), "when": entry.get("timestamp"), "short": short,
        "thumbnail": f"https://i.ytimg.com/vi/{entry['id']}/mqdefault.jpg", "likes": None, "comments": None,
    }


def _details(video):
    """One video's exact views, likes, comments and upload time."""
    import yt_dlp

    options = {"quiet": True, "no_warnings": True, "socket_timeout": 20, "js_runtimes": downloader._js_runtimes()}
    try:
        with yt_dlp.YoutubeDL(options) as ydl:
            info = ydl.extract_info("https://www.youtube.com/watch?v=" + video["id"], download=False, process=False)
        video.update(views=info.get("view_count", video["views"]), likes=info.get("like_count"),
                     comments=info.get("comment_count"), when=info.get("timestamp") or video["when"],
                     seconds=int(info.get("duration") or video["seconds"]))
    except Exception:
        pass
    return video


def _fetch_public(url):
    """Read the channel's Videos and Shorts pages, then the newest ones one by one."""
    import yt_dlp

    options = {"quiet": True, "no_warnings": True, "extract_flat": "in_playlist", "playlistend": LISTED,
               "socket_timeout": 20, "js_runtimes": downloader._js_runtimes(),
               "extractor_args": {"youtubetab": {"approximate_date": ["true"]}}}
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(url + "/videos", download=False)
        videos = [_entry(e, False) for e in list(info.get("entries") or [])[:LISTED] if e.get("id")]
        try:
            shorts_info = ydl.extract_info(url + "/shorts", download=False)
            shorts = [_entry(e, True) for e in list(shorts_info.get("entries") or [])[:LISTED] if e.get("id")]
        except Exception:
            shorts = []  # no Shorts tab
    with ThreadPoolExecutor(4) as pool:
        list(pool.map(_details, videos[:DETAILS] + shorts[:DETAILS]))
    name = info.get("channel") or info.get("uploader") or info.get("title") or ""
    return {
        "url": url, "name": re.sub(r"\s+-\s+Videos$", "", name), "handle": info.get("uploader_id") or "",
        "avatar": home._avatar(info), "subscribers": info.get("channel_follower_count"),
        "videos": videos, "shorts": shorts,
    }


def _refresh_public(url):
    try:
        info, error = _fetch_public(url), ""
    except Exception as e:
        info, error = None, downloader.friendly_error(e)
    with _lock:
        entry = _public[url]
        entry.update(at=time.time(), busy=False, error=error if not info else "")
        if info:
            entry.update(info=info, checked=time.time())
    if info:
        everything = info["videos"] + info["shorts"]
        views = sum(v["views"] or 0 for v in everything) if everything else None
        try:
            _remember(url, info["subscribers"], views)
        except OSError:
            pass


def _public_info(url):
    with _lock:
        entry = _public.setdefault(url, {"at": 0, "busy": False, "info": None, "error": "", "checked": 0})
        wait = PUBLIC_REFRESH if entry["info"] and not entry["error"] else RETRY
        if not entry["busy"] and time.time() - entry["at"] > wait:
            entry["busy"] = True
            threading.Thread(target=_refresh_public, args=(url,), daemon=True).start()
        return dict(entry)


def refresh_now():
    """The refresh button: look again right away."""
    with _lock:
        for entry in _public.values():
            if not entry["busy"]:
                entry["at"] = 0
        if not _google["busy"]:
            _google["at"] = 0
        _reports.clear()
        for entry in _compare.values():
            if not entry["busy"]:
                entry["at"] = 0


# ---------------------------------------------------------------- Google sign-in


def _http(url, data=None, token=None, body=None, method=None):
    """A Google call. data is sent as a form, body as JSON."""
    if body is not None:
        request = urllib.request.Request(url, data=json.dumps(body).encode(), method=method or "POST")
        request.add_header("Content-Type", "application/json")
    else:
        request = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode() if data is not None else None, method=method)
    if token:
        request.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            return json.loads(response.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode("utf-8") or "{}")
        except ValueError:
            body = {}
        problem = body.get("error")
        if isinstance(problem, dict):
            message = problem.get("message") or ""
            reasons = [x.get("reason") for x in problem.get("errors") or []]
            if "accessNotConfigured" in reasons or "has not been used" in message or "is disabled" in message:
                raise Error("Turn on the YouTube Data API v3 and the YouTube Analytics API in Google Cloud (step 2 of the guide).")
            if e.code in (401, 403) and ("insufficient" in message.lower() or "permission" in message.lower()):
                raise Error("Google didn't give the app permission. Connect again and tick every box.")
            raise Error(message or "Google said no. Try again in a bit.")
        if problem in ("invalid_grant", "unauthorized_client"):
            raise SignedOut()
        if problem == "invalid_client":
            raise Error("Google doesn't know that Client ID and secret. Check them in Google Cloud.")
        raise Error(body.get("error_description") or "Google said no. Try again in a bit.")
    except (urllib.error.URLError, TimeoutError, OSError):
        raise Error("Can't reach Google. Check your internet.")


class SignedOut(Error):
    pass


def connect_url(port, replies=False):
    """The Google page to open in the browser. Google sends you back to the app afterwards.
    replies: also ask to answer comments (the Comments tab). Once given, it stays."""
    c = _config()
    if not c["client_id"]:
        raise Error("Follow the setup guide first.")
    verifier = secrets.token_urlsafe(64)
    state = secrets.token_urlsafe(24)
    redirect = f"http://127.0.0.1:{port}/"
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    with _lock:
        for old in [s for s, p in _pending.items() if time.time() - p[2] > 900]:
            del _pending[old]
        _pending[state] = (verifier, redirect, time.time())
    return AUTH_URL + "?" + urllib.parse.urlencode({
        "client_id": c["client_id"], "redirect_uri": redirect, "response_type": "code",
        "scope": SCOPES + (" " + REPLY_SCOPE if replies or can_reply() else ""), "include_granted_scopes": "true",
        "code_challenge": challenge, "code_challenge_method": "S256", "state": state,
        "access_type": "offline", "prompt": "consent",
    })


def is_callback(query):
    return "state" in query and query["state"][0] in _pending


def finish(query):
    """Google sent the browser back with a code: swap it for a sign-in that lasts. Returns the page text."""
    with _lock:
        pending = _pending.pop(query.get("state", [""])[0], None)
    if not pending:
        return False, "This sign-in link is old. Go back to VaultHub and press Connect again."
    if "error" in query:
        return False, "You didn't let VaultHub see your channel, so nothing changed. You can close this tab."
    c = _config()
    try:
        result = _http(TOKEN_URL, {"code": query.get("code", [""])[0], "client_id": c["client_id"],
                                   "client_secret": c["client_secret"], "redirect_uri": pending[1],
                                   "grant_type": "authorization_code", "code_verifier": pending[0]})
        if not result.get("refresh_token"):
            return False, "Google didn't give a lasting sign-in. Go back to VaultHub and press Connect again."
        _access.update(token=result.get("access_token") or "", until=time.time() + int(result.get("expires_in") or 0) - 60)
        settings.save(ch_refresh=result["refresh_token"], ch_scopes=result.get("scope") or SCOPES)
        mine = _http(DATA_API + "channels?part=snippet&mine=true", token=_access["token"]).get("items") or []
        if not mine:
            disconnect()
            return False, "That Google account has no YouTube channel. Try again and pick the account your channel is on."
        settings.save(ch_google_name=mine[0]["snippet"].get("title") or "")
    except Error as e:
        return False, str(e)
    with _lock:
        _google.update(at=0, data=None, error="")
        _reports.clear()
    return True, "You're connected. Go back to VaultHub, your stats are loading."


def _token():
    if _access["token"] and time.time() < _access["until"]:
        return _access["token"]
    c = _config()
    try:
        result = _http(TOKEN_URL, {"client_id": c["client_id"], "client_secret": c["client_secret"],
                                   "refresh_token": c["refresh"], "grant_type": "refresh_token"})
    except SignedOut:
        settings.save(ch_refresh="")
        raise SignedOut("Google signed the app out. Press Connect to sign in again.")
    _access.update(token=result["access_token"], until=time.time() + int(result.get("expires_in") or 3600) - 60)
    return _access["token"]


def _get(path, **query):
    return _http(DATA_API + path + "?" + urllib.parse.urlencode(query), token=_token())


def _report(**query):
    """A YouTube Analytics report as a list of dicts."""
    result = _http(ANALYTICS_API + "?" + urllib.parse.urlencode({"ids": "channel==MINE", **query}), token=_token())
    names = [h["name"] for h in result.get("columnHeaders") or []]
    return [dict(zip(names, row)) for row in result.get("rows") or []]


def _seconds(duration):
    """YouTube's PT1H2M3S as seconds."""
    m = re.fullmatch(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", duration or "")
    if not m:
        return 0
    d, h, mi, s = (int(x or 0) for x in m.groups())
    return ((d * 24 + h) * 60 + mi) * 60 + s


def _videos_by_id(ids):
    out = {}
    for start in range(0, len(ids), 50):
        part = ids[start:start + 50]
        for item in _get("videos", part="snippet,statistics,contentDetails", id=",".join(part)).get("items") or []:
            st, sn = item.get("statistics") or {}, item.get("snippet") or {}
            seconds = _seconds((item.get("contentDetails") or {}).get("duration"))
            when = sn.get("publishedAt")
            try:
                when = int(datetime.datetime.fromisoformat(when.replace("Z", "+00:00")).timestamp()) if when else None
            except ValueError:
                when = None
            short = 0 < seconds <= 60
            thumbs = sn.get("thumbnails") or {}
            out[item["id"]] = {
                "id": item["id"], "url": f"https://www.youtube.com/{'shorts/' if short else 'watch?v='}{item['id']}",
                "title": sn.get("title") or "Untitled video", "seconds": seconds, "when": when, "short": short,
                "thumbnail": (thumbs.get("medium") or thumbs.get("default") or {}).get("url") or f"https://i.ytimg.com/vi/{item['id']}/mqdefault.jpg",
                "views": _int(st.get("viewCount")), "likes": _int(st.get("likeCount")), "comments": _int(st.get("commentCount")),
            }
    return out


def _int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _fetch_google():
    """The channel, its newest uploads, and 180 days of views, watch time and subscribers."""
    channel = (_get("channels", part="snippet,statistics,contentDetails", mine="true").get("items") or [None])[0]
    if not channel:
        raise Error("That Google account has no YouTube channel.")
    sn, st = channel["snippet"], channel.get("statistics") or {}
    uploads = ((channel.get("contentDetails") or {}).get("relatedPlaylists") or {}).get("uploads")
    ids, page = [], ""
    while uploads and len(ids) < UPLOADS:  # (the Compare picker can show older ones too)
        result = _get("playlistItems", part="contentDetails", playlistId=uploads, maxResults=50, **({"pageToken": page} if page else {}))
        ids += [i["contentDetails"]["videoId"] for i in result.get("items") or [] if i.get("contentDetails")]
        page = result.get("nextPageToken")
        if not page:
            break
    videos = _videos_by_id(ids)
    today = datetime.date.today()
    rows = _report(startDate=(today - datetime.timedelta(days=200)).isoformat(), endDate=today.isoformat(),
                   metrics="views,estimatedMinutesWatched,subscribersGained,subscribersLost", dimensions="day", sort="day")
    thumbs = sn.get("thumbnails") or {}
    handle = sn.get("customUrl") or ""
    return {
        "url": "https://www.youtube.com/" + (handle if handle.startswith("@") else "channel/" + channel["id"]),
        "name": sn.get("title") or "", "handle": handle,
        "avatar": (thumbs.get("high") or thumbs.get("medium") or thumbs.get("default") or {}).get("url") or "",
        "subscribers": _int(st.get("subscriberCount")), "views": _int(st.get("viewCount")),
        "videoCount": _int(st.get("videoCount")), "hiddenSubs": bool(st.get("hiddenSubscriberCount")),
        "videos": [videos[i] for i in ids if i in videos],
        "days": [{"day": r["day"], "views": r.get("views") or 0, "minutes": r.get("estimatedMinutesWatched") or 0,
                  "gained": (r.get("subscribersGained") or 0) - (r.get("subscribersLost") or 0)} for r in rows],
    }


def _refresh_google():
    try:
        data, error = _fetch_google(), ""
    except Error as e:
        data, error = None, str(e)
    except Exception:
        data, error = None, "Couldn't get your numbers from Google. Try again in a bit."
    with _lock:
        _google.update(at=time.time(), busy=False, error=error if not data else "")
        if data:
            _google.update(data=data, checked=time.time())
    if data:
        try:
            _remember("google", data["subscribers"], data["views"])
        except OSError:
            pass


def _google_info():
    with _lock:
        wait = GOOGLE_REFRESH if _google["data"] and not _google["error"] else RETRY
        if not _google["busy"] and time.time() - _google["at"] > wait:
            _google["busy"] = True
            threading.Thread(target=_refresh_google, daemon=True).start()
        return dict(_google)


def _range_report(days, end):
    """Top videos and where viewers came from in the range (asked for once per 15 minutes)."""
    with _lock:
        known = _reports.get(days)
    if known and time.time() - known[0] < GOOGLE_REFRESH:
        return known[1]
    start = (end - datetime.timedelta(days=days - 1)).isoformat()
    sources = _report(startDate=start, endDate=end.isoformat(), metrics="views", dimensions="insightTrafficSourceType", sort="-views")
    top = _report(startDate=start, endDate=end.isoformat(), metrics="views,estimatedMinutesWatched", dimensions="video",
                  sort="-views", maxResults=5)
    found = _videos_by_id([r["video"] for r in top]) if top else {}
    merged = {}
    for r in sources:
        name = SOURCES.get(r["insightTrafficSourceType"], "Other")
        merged[name] = merged.get(name, 0) + (r.get("views") or 0)
    result = {
        "sources": sorted(({"name": n, "views": v} for n, v in merged.items() if v), key=lambda s: -s["views"]),
        "top": [{**found.get(r["video"], {"id": r["video"], "url": "https://www.youtube.com/watch?v=" + r["video"], "title": "A video"}),
                 "views": r.get("views") or 0, "hours": round((r.get("estimatedMinutesWatched") or 0) / 60, 1)} for r in top],
    }
    with _lock:
        _reports[days] = (time.time(), result)
    return result


# ---------------------------------------------------------------- the page


def _usual(videos):
    """How each video is doing next to your usual: its views against the middle of the 15 uploads
    of the same kind (video or Short) around it. Very new uploads are 'New': too soon to tell."""
    now = time.time()
    for kind in (False, True):
        same = [v for v in videos if v["short"] == kind and v["views"] is not None]
        for i, v in enumerate(same):
            others = [o["views"] for o in same[max(0, i - 7):i + 8] if o is not v and o["when"] and now - o["when"] > 3 * 86400]
            if v["when"] and now - v["when"] < 2 * 86400:
                v["usual"] = {"label": "New", "tone": "new"}
            elif len(others) < 3:
                v["usual"] = None
            else:
                middle = statistics.median(others) or 1
                ratio = v["views"] / middle
                if ratio >= 1.3:
                    v["usual"] = {"label": f"{ratio:.1f}× your usual", "tone": "up"}
                elif ratio >= 0.75:
                    v["usual"] = {"label": "About your usual", "tone": "same"}
                else:
                    v["usual"] = {"label": "Below your usual", "tone": "down"}
    return videos


def _snap_series(key, days):
    """The written-down days in the range: [[day, subs]] and [[day, views gained that day]]."""
    snaps = _load_snaps().get(key) or {}
    first = (datetime.date.today() - datetime.timedelta(days=days)).isoformat()
    picked = [(d, snaps[d]) for d in sorted(snaps) if d >= first]
    subs = [[d, s["subs"]] for d, s in picked if s.get("subs") is not None]
    views, today = [], datetime.date.today().isoformat()  # (today isn't over yet)
    for (d0, a), (d1, b) in zip(picked, picked[1:]):
        gap = (datetime.date.fromisoformat(d1) - datetime.date.fromisoformat(d0)).days
        if gap == 1 and d1 < today and a.get("views") is not None and b.get("views") is not None:
            views.append([d1, max(0, b["views"] - a["views"])])
    start = picked[0] if picked else None
    return subs, views, start


def _change(now, start):
    return None if now is None or start is None else now - start


def page(days):
    try:
        days = int(days)
    except (TypeError, ValueError):
        days = 28
    days = days if days in (7, 28, 90) else 28
    c = _config()
    google = {"setUp": bool(c["client_id"]), "connected": bool(c["refresh"]), "name": c["google_name"]}
    base = {"ok": True, "days": days, "google": google, "channelLink": c["channel"]}
    if google["connected"]:
        return {**base, **_google_page(days)}
    if not c["channel"]:
        return {**base, "mode": "none"}
    return {**base, **_public_page(c["channel"], days)}


def _public_page(url, days):
    entry = _public_info(url)
    info = entry["info"]
    out = {"mode": "public", "loading": entry["busy"] and not info, "busy": entry["busy"], "error": entry["error"],
           "checked": entry["checked"], "channel": {"url": url, "name": url.rsplit("/", 1)[-1], "handle": "", "avatar": ""}}
    if not info:
        return out
    everything = info["videos"] + info["shorts"]
    views = sum(v["views"] or 0 for v in everything) if everything else None
    subs_series, views_series, start = _snap_series(url, days)
    since = start[0] if start else None
    newest = sorted(info["videos"][:DETAILS] + info["shorts"][:DETAILS], key=lambda v: -(v["when"] or 0))
    _usual(sorted(info["videos"][:40] + info["shorts"][:40], key=lambda v: -(v["when"] or 0)))
    top = sorted((v for v in everything if v["views"] is not None), key=lambda v: -v["views"])[:5]
    return {**out, "channel": {"url": url, "name": info["name"], "handle": info["handle"], "avatar": info["avatar"]},
            "since": since,
            "totals": {"subs": {"value": info["subscribers"], "change": _change(info["subscribers"], start and start[1].get("subs"))},
                       "views": {"value": views, "change": _change(views, start and start[1].get("views")),
                                 "note": f"from your {len(everything)} uploads"},
                       "watch": None},
            "series": {"views": views_series, "subs": subs_series, "watch": []},
            "newest": newest[:NEWEST], "top": top, "topNote": "all time", "sources": None}


def _google_page(days):
    entry = _google_info()
    data = entry["data"]
    out = {"mode": "google", "loading": entry["busy"] and not data, "busy": entry["busy"], "error": entry["error"],
           "checked": entry["checked"], "channel": {"url": "", "name": _config()["google_name"], "handle": "", "avatar": ""}}
    if not data:
        return out
    rows = data["days"]
    # YouTube's numbers come in 2 or 3 days late: the range ends on the last day it has.
    end = datetime.date.fromisoformat(rows[-1]["day"]) if rows else datetime.date.today()
    first = (end - datetime.timedelta(days=days - 1)).isoformat()
    before = (end - datetime.timedelta(days=2 * days - 1)).isoformat()
    now_rows = [r for r in rows if r["day"] >= first]
    old_rows = [r for r in rows if before <= r["day"] < first]

    def total(rs, key):
        return sum(r[key] for r in rs)

    def versus(a, b):
        return None if not old_rows or not b else round((a - b) / b * 100)

    views_now, views_old = total(now_rows, "views"), total(old_rows, "views")
    watch_now, watch_old = total(now_rows, "minutes") / 60, total(old_rows, "minutes") / 60
    gained_now, gained_old = total(now_rows, "gained"), total(old_rows, "gained")
    # Subscribers day by day: today's count, minus what was gained after each day.
    subs, running = [], data["subscribers"] or 0
    for r in reversed(rows):
        if r["day"] < first:
            break
        subs.append([r["day"], running])
        running -= r["gained"]
    subs.reverse()
    try:
        extra = _range_report(days, end)
    except Error as e:
        extra = {"sources": [], "top": [], "error": str(e)}
    return {**out, "channel": {"url": data["url"], "name": data["name"], "handle": data["handle"], "avatar": data["avatar"]},
            "since": first, "end": end.isoformat(),
            "totals": {"subs": {"value": None if data["hiddenSubs"] else data["subscribers"], "change": gained_now,
                                "versus": versus(gained_now, gained_old) if gained_old > 0 else None},
                       "views": {"value": data["views"], "change": views_now, "versus": versus(views_now, views_old)},
                       "watch": {"value": round(watch_now) if watch_now >= 100 else round(watch_now, 1), "versus": versus(watch_now, watch_old)}},
            "series": {"views": [[r["day"], r["views"]] for r in now_rows], "subs": subs,
                       "watch": [[r["day"], round(r["minutes"] / 60, 1)] for r in now_rows]},
            "newest": _usual(data["videos"][:40])[:NEWEST], "top": extra["top"], "topNote": f"in {days} days",
            "sources": extra["sources"], "rangeError": extra.get("error", "")}


# ---------------------------------------------------------------- comparing two videos


COMPARE_REFRESH = 10 * 60
FIRST_DAYS = 30  # the "first days" graph
_compare = {}  # (video id, google?) -> {"at", "busy", "video", "error"}


def video_id(text):
    """A YouTube video's id from its link (or the id itself)."""
    text = str(text or "").strip()
    if re.fullmatch(r"[\w-]{11}", text):
        return text
    m = re.search(r"(?:[?&]v=|youtu\.be/|/shorts/|/live/|/embed/)([\w-]{11})(?![\w-])", text)
    return m.group(1) if m else None


def uploads():
    """The picker's list: your uploads (videos and Shorts), newest first."""
    c = _config()
    with _lock:
        if c["refresh"]:
            data = _google["data"]
            videos = list(data["videos"]) if data else []
        else:
            info = (_public.get(c["channel"]) or {}).get("info")
            videos = info["videos"] + info["shorts"] if info else []
    keys = ("id", "url", "title", "thumbnail", "when", "views", "short", "seconds")
    return sorted(({k: v.get(k) for k in keys} for v in videos), key=lambda v: -(v["when"] or 0))


def _known(vid):
    """The video as the tab already knows it (from your channel's pages), if it's one of yours."""
    with _lock:
        lists = [(_google["data"] or {}).get("videos") or []]
        for entry in _public.values():
            if entry.get("info"):
                lists += [entry["info"]["videos"], entry["info"]["shorts"]]
    for videos in lists:
        for v in videos:
            if v["id"] == vid:
                return dict(v)
    return None


def _public_video(vid):
    """Any video's public numbers, with yt-dlp."""
    import yt_dlp

    options = {"quiet": True, "no_warnings": True, "socket_timeout": 20, "js_runtimes": downloader._js_runtimes()}
    try:
        with yt_dlp.YoutubeDL(options) as ydl:
            info = ydl.extract_info("https://www.youtube.com/watch?v=" + vid, download=False, process=False)
    except Exception as e:
        raise Error(downloader.friendly_error(e))
    seconds = int(info.get("duration") or 0)
    known = _known(vid) or {}
    short = known.get("short", "/shorts/" in (info.get("webpage_url") or "") or (0 < seconds <= 60 and (info.get("height") or 0) > (info.get("width") or 1)))
    return {
        "id": vid, "url": f"https://www.youtube.com/{'shorts/' if short else 'watch?v='}{vid}",
        "title": info.get("title") or known.get("title") or "Untitled video", "channel": info.get("channel") or info.get("uploader") or "",
        "thumbnail": f"https://i.ytimg.com/vi/{vid}/mqdefault.jpg", "seconds": seconds, "short": bool(short),
        "when": info.get("timestamp") or known.get("when"), "views": info.get("view_count"),
        "likes": info.get("like_count"), "comments": info.get("comment_count"),
    }


def _google_video(vid):
    """Your own video's numbers from YouTube itself: exact counts, watch time and its first days."""
    found = _videos_by_id([vid]).get(vid)
    if not found:
        raise Error("YouTube can't find that video. It may be private or deleted.")
    video = {**found, "channel": _config()["google_name"]}
    if not video["when"]:
        return video
    start = datetime.datetime.fromtimestamp(video["when"], datetime.timezone.utc).date()
    today = datetime.date.today()
    try:
        life = _report(startDate=start.isoformat(), endDate=today.isoformat(), filters="video==" + vid,
                       metrics="views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost")
        days = _report(startDate=start.isoformat(), endDate=min(start + datetime.timedelta(days=FIRST_DAYS - 1), today).isoformat(),
                       filters="video==" + vid, metrics="views", dimensions="day", sort="day")
    except Error:
        return video  # not one of yours: just the public numbers
    if life:
        r = life[0]
        video.update(hours=round((r.get("estimatedMinutesWatched") or 0) / 60, 1), avgSeconds=r.get("averageViewDuration"),
                     avgPercent=r.get("averageViewPercentage"), subs=(r.get("subscribersGained") or 0) - (r.get("subscribersLost") or 0))
    if days:
        # Day 1, day 2, ... (days YouTube has no row for had no views)
        by_day = {r["day"]: r.get("views") or 0 for r in days}
        last = datetime.date.fromisoformat(days[-1]["day"])
        video["firstDays"] = [by_day.get((start + datetime.timedelta(days=i)).isoformat(), 0)
                              for i in range((last - start).days + 1)]
    return video


def _refresh_compare(key):
    vid, google = key
    try:
        video, error = (_google_video if google else _public_video)(vid), ""
    except Error as e:
        video, error = None, str(e)
    except Exception:
        video, error = None, "Couldn't read that video. Try again in a bit."
    with _lock:
        entry = _compare[key]
        entry.update(at=time.time(), busy=False, error=error if not video else "")
        if video:
            entry["video"] = video


def compare(ids):
    """Both videos' numbers. Each one loads in the background the first time (a few seconds)."""
    google = bool(_config()["refresh"])
    out = []
    for raw in list(ids or [])[:2]:
        vid = video_id(raw)
        if not vid:
            out.append(None)
            continue
        key = (vid, google)
        with _lock:
            entry = _compare.setdefault(key, {"at": 0, "busy": False, "video": None, "error": ""})
            wait = COMPARE_REFRESH if entry["video"] and not entry["error"] else RETRY
            if not entry["busy"] and time.time() - entry["at"] > wait:
                entry["busy"] = True
                threading.Thread(target=_refresh_compare, args=(key,), daemon=True).start()
            entry = dict(entry)
        video = entry["video"]
        if not video:  # show what the tab already knows while it loads
            known = _known(vid)
            video = {**known, "partial": True} if known else None
        out.append({"id": vid, "loading": entry["busy"] and not entry["video"], "error": "" if entry["video"] else entry["error"],
                    "video": video})
    return {"ok": True, "google": google, "items": out}
