"""The Comments tab: every comment on your own YouTube channel in one list, the ones you haven't
answered on top, so you can reply fast.

It uses the same Google sign-in as the Channel stats tab (see channelstats.py). Reading comments
works with the sign-in Channel stats already has; answering and hiding them needs one more yes
from Google (the youtube.force-ssl permission), which the tab asks for the first time.

All of it is free: YouTube gives every Google Cloud project 10,000 "units" a day. Looking at the
comments costs about 5 units, an answer costs 50, so that's around 150 answers a day.

What's kept on this PC (DATA_DIR/comment_inbox.json): comments you marked Done, and your saved
replies. Nothing goes to Supabase.
"""

import datetime
import json
import os
import threading
import time

import channelstats as cs
import settings

STATE_FILE = os.path.join(settings.DATA_DIR, "comment_inbox.json")
OPEN_REFRESH = 4 * 60  # seconds between looks while the tab is open
BACKGROUND_REFRESH = 15 * 60  # for the number on the side bar
RETRY = 60
PAGES = 3  # 100 comment threads a page, newest first
MORE_REPLIES = 25  # threads with more answers than YouTube sends along, looked at one by one
DONE_KEEP = 2000
SAVED_MAX = 12
STARTER_REPLIES = ["Thanks for watching! ❤️", "Glad you liked it!", "Good idea, I'll think about it for a future video."]


class Error(Exception):
    pass


_lock = threading.Lock()
_cache = {"at": 0, "busy": False, "data": None, "error": "", "checked": 0}


# ---------------------------------------------------------------- what's kept on this PC


def _load():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict):
                data.setdefault("done", {})
                data.setdefault("saved", list(STARTER_REPLIES))
                return data
    except (OSError, ValueError):
        pass
    return {"done": {}, "saved": list(STARTER_REPLIES)}


def _store(data):
    os.makedirs(settings.DATA_DIR, exist_ok=True)
    temp = STATE_FILE + ".new"
    with open(temp, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.replace(temp, STATE_FILE)


def set_done(thread_id, done):
    thread_id = str(thread_id or "")[:100]
    if not thread_id:
        return
    with _lock:
        data = _load()
        if done:
            data["done"][thread_id] = int(time.time())
            for old in sorted(data["done"], key=data["done"].get)[:-DONE_KEEP]:
                del data["done"][old]
        else:
            data["done"].pop(thread_id, None)
        _store(data)


def set_saved(replies):
    clean = []
    for text in replies or []:
        text = str(text or "").strip()[:500]
        if text and text not in clean:
            clean.append(text)
    with _lock:
        data = _load()
        data["saved"] = clean[:SAVED_MAX]
        _store(data)
    return data["saved"]


# ---------------------------------------------------------------- reading from YouTube


def _when(text):
    try:
        return int(datetime.datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()) if text else None
    except ValueError:
        return None


def _comment(item):
    sn = item.get("snippet") or {}
    return {
        "id": item.get("id") or "", "author": sn.get("authorDisplayName") or "Someone",
        "authorId": (sn.get("authorChannelId") or {}).get("value") or "", "avatar": sn.get("authorProfileImageUrl") or "",
        "authorUrl": sn.get("authorChannelUrl") or "", "text": sn.get("textDisplay") or sn.get("textOriginal") or "",
        "likes": sn.get("likeCount") or 0, "when": _when(sn.get("publishedAt")),
        "edited": bool(sn.get("updatedAt") and sn.get("updatedAt") != sn.get("publishedAt")),
    }


def _thread(item, held=False):
    sn = item.get("snippet") or {}
    top = _comment(sn.get("topLevelComment") or {})
    replies = [_comment(r) for r in (item.get("replies") or {}).get("comments") or []]
    return {
        "id": item.get("id") or top["id"], "videoId": sn.get("videoId") or "", "top": top,
        "replies": sorted(replies, key=lambda r: r["when"] or 0), "replyCount": sn.get("totalReplyCount") or 0,
        "canReply": bool(sn.get("canReply", True)), "held": held,
    }


def _threads(channel_id, **extra):
    out, page = [], ""
    for _ in range(PAGES):
        query = {"part": "snippet,replies", "allThreadsRelatedToChannelId": channel_id, "maxResults": 100,
                 "order": "time", "textFormat": "plainText", **extra}
        if page:
            query["pageToken"] = page
        result = cs._get("commentThreads", **query)
        out += result.get("items") or []
        page = result.get("nextPageToken")
        if not page:
            break
    return out


def _all_replies(thread_id):
    result = cs._get("comments", part="snippet", parentId=thread_id, maxResults=100, textFormat="plainText")
    return sorted((_comment(c) for c in result.get("items") or []), key=lambda r: r["when"] or 0)


def _videos(ids):
    """Titles and pictures for the videos the comments are on."""
    known = {}
    with cs._lock:
        for v in ((cs._google.get("data") or {}).get("videos") or []):
            known[v["id"]] = v
    missing = [i for i in ids if i and i not in known]
    if missing:
        try:
            known.update(cs._videos_by_id(missing[:150]))
        except cs.Error:
            pass
    return {i: {"id": i, "title": known[i]["title"] if i in known else "A video", "url": known[i]["url"] if i in known
                else "https://www.youtube.com/watch?v=" + i, "thumbnail": f"https://i.ytimg.com/vi/{i}/mqdefault.jpg",
                "short": bool(known.get(i, {}).get("short"))} for i in ids if i}


def _fetch():
    me = (cs._get("channels", part="id", mine="true").get("items") or [None])[0]
    if not me:
        raise Error("That Google account has no YouTube channel.")
    channel_id = me["id"]
    threads = [_thread(t) for t in _threads(channel_id)]
    held = []
    if cs.can_reply():  # comments YouTube holds for you to check (only the owner, with the reply permission)
        try:
            held = [_thread(t, True) for t in _threads(channel_id, moderationStatus="heldForReview")]
        except cs.Error:
            held = []
    # YouTube sends up to 5 answers with each thread. Look at the rest where it matters.
    looked = 0
    for t in threads:
        if looked >= MORE_REPLIES:
            break
        if t["replyCount"] > len(t["replies"]) and t["top"]["authorId"] != channel_id:
            try:
                t["replies"] = _all_replies(t["id"])
            except cs.Error:
                pass
            looked += 1
    everything = held + threads
    return {"channelId": channel_id, "threads": everything,
            "videos": _videos(list(dict.fromkeys(t["videoId"] for t in everything)))}


def _refresh():
    try:
        data, error = _fetch(), ""
    except (cs.Error, Error) as e:
        data, error = None, str(e)
    except Exception:
        data, error = None, "Couldn't get your comments from YouTube. Try again in a bit."
    with _lock:
        _cache.update(at=time.time(), busy=False, error=error if not data else "")
        if data:
            _cache.update(data=data, checked=time.time())


def _info(wait):
    with _lock:
        if not cs._config()["refresh"]:
            _cache.update(at=0, data=None, error="", checked=0)
            return dict(_cache)
        if _cache["data"] is None or _cache["error"]:
            wait = RETRY
        if not _cache["busy"] and time.time() - _cache["at"] > wait:
            _cache["busy"] = True
            threading.Thread(target=_refresh, daemon=True).start()
        return dict(_cache)


def refresh_now():
    with _lock:
        if not _cache["busy"]:
            _cache["at"] = 0


# ---------------------------------------------------------------- sorting them out


def _status(t, me, done):
    """needs / answered / done / mine / held, plus why it needs you."""
    top = t["top"]
    if t["held"]:
        return "held", ""
    if top["authorId"] == me:
        return "mine", ""
    mine = [r for r in t["replies"] if r["authorId"] == me]
    if mine:
        # They answered you back after your last answer: it's back on your list.
        last = mine[-1]["when"] or 0
        back = [r for r in t["replies"] if r["authorId"] == top["authorId"] and (r["when"] or 0) > last]
        if back and (done.get(t["id"]) or 0) < (back[-1]["when"] or 0):
            return "needs", "back"
        return "answered", ""
    if t["id"] in done:
        return "done", ""
    return "needs", ""


def _sorted_out():
    entry = _info(OPEN_REFRESH)
    data = entry["data"]
    if not data:
        return entry, None
    done = _load()["done"]
    me = data["channelId"]
    out = []
    for t in data["threads"]:
        status, why = _status(t, me, done)
        out.append({**t, "status": status, "why": why, "repliedAt": next((r["when"] for r in reversed(t["replies"]) if r["authorId"] == me), None)})
    return entry, out


def page():
    c = cs._config()
    google = {"setUp": bool(c["client_id"]), "connected": bool(c["refresh"]), "name": c["google_name"],
              "canReply": cs.can_reply()}
    base = {"ok": True, "google": google, "saved": _load()["saved"]}
    if not google["connected"]:
        return base
    entry, threads = _sorted_out()
    data = entry["data"] or {}
    counts = {}
    for t in threads or []:
        counts[t["status"]] = counts.get(t["status"], 0) + 1
    return {**base, "loading": entry["busy"] and not data, "busy": entry["busy"], "error": entry["error"],
            "checked": entry["checked"], "channelId": data.get("channelId") or "", "threads": threads or [],
            "videos": data.get("videos") or {}, "counts": counts}


def count():
    """How many comments need an answer (the number on the side bar). Cheap: looks again every 15 minutes."""
    if not cs._config()["refresh"]:
        return 0
    entry = _info(BACKGROUND_REFRESH)
    data = entry["data"]
    if not data:
        return 0
    done = _load()["done"]
    return sum(1 for t in data["threads"] if _status(t, data["channelId"], done)[0] in ("needs", "held"))


# ---------------------------------------------------------------- answering


def _need_reply_permission():
    if not cs._config()["refresh"]:
        raise Error("Sign in with Google first.")
    if not cs.can_reply():
        raise Error("Give VaultHub permission to answer first (the button at the top).")


def _friendly(e):
    text = str(e)
    if "disabled comments" in text.lower() or "commentsDisabled" in text:
        return Error("Comments are turned off on that video.")
    if "processingFailure" in text or "not found" in text.lower():
        return Error("That comment is gone (it may have been deleted).")
    if "quota" in text.lower():
        return Error("YouTube's free limit for today is used up. It resets at 9 in the morning (Norway time).")
    return Error(text)


def reply(thread_id, text):
    _need_reply_permission()
    text = str(text or "").strip()
    if not text:
        raise Error("Write something first.")
    if len(text) > 10000:
        raise Error("That's too long for a YouTube comment.")
    try:
        item = cs._http(cs.DATA_API + "comments?part=snippet", token=cs._token(),
                        body={"snippet": {"parentId": str(thread_id), "textOriginal": text}})
    except cs.Error as e:
        raise _friendly(e)
    answer = _comment(item)
    answer["text"] = answer["text"] or text
    answer["when"] = answer["when"] or int(time.time())
    with _lock:  # show it right away, before the next look at YouTube
        data = _cache["data"]
        if data:
            answer["authorId"] = answer["authorId"] or data["channelId"]
            for t in data["threads"]:
                if t["id"] == thread_id:
                    t["replies"].append(answer)
                    t["replyCount"] += 1
    return answer


def moderate(thread_id, status):
    """Hide a comment from your channel ("rejected") or let a held one through ("published")."""
    _need_reply_permission()
    if status not in ("rejected", "published"):
        raise Error("Unknown choice.")
    try:
        cs._http(cs.DATA_API + "comments/setModerationStatus?" + cs.urllib.parse.urlencode(
            {"id": str(thread_id), "moderationStatus": status}), data={}, token=cs._token())
    except cs.Error as e:
        raise _friendly(e)
    with _lock:
        data = _cache["data"]
        if data:
            if status == "rejected":
                data["threads"] = [t for t in data["threads"] if t["id"] != thread_id]
            else:
                for t in data["threads"]:
                    if t["id"] == thread_id:
                        t["held"] = False


def delete_reply(comment_id):
    """Take back one of your own answers."""
    _need_reply_permission()
    try:
        cs._http(cs.DATA_API + "comments?" + cs.urllib.parse.urlencode({"id": str(comment_id)}), data={},
                 token=cs._token(), method="DELETE")
    except cs.Error as e:
        raise _friendly(e)
    with _lock:
        data = _cache["data"]
        if data:
            for t in data["threads"]:
                t["replies"] = [r for r in t["replies"] if r["id"] != comment_id]
