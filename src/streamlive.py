"""The Live console: Twitch + YouTube chat in one place, how many watch, what happens on stream, and
how OBS is doing. Also writes down each stream so the Stream stats page can show how it went.

Nothing here costs anything: chat is read with no keys, OBS is asked on this PC, and the optional
sign-ins (a free Twitch developer app, your Google key) only add extras.
"""

import json
import os
import re
import threading
import time
from collections import deque

import adtimer
import multistream
import obsstats
import settings
import streamtwitch
import streamyt

STREAMS_DIR = os.path.join(settings.DATA_DIR, "streams")
KEEP = 600  # chat lines kept in memory
END_AFTER = 180  # seconds of nothing live before a stream counts as over
SAMPLE = 60  # one point on the viewer graph per minute
EVENT_KINDS = ("follow", "sub", "gift", "raid", "bits", "superchat", "sticker", "member")

_lock = threading.Lock()
_items = deque(maxlen=KEEP)  # (seq, item)
_seq = 0
_removed = []  # ("id", id) / ("login", name) / ("channelId", id), newest last
_session = None
_last_live = 0
_ticker = None
_twitch = None
_youtube = None


def _new_session(now, started=None):
    return {"id": time.strftime("%Y%m%d-%H%M%S", time.localtime(now)), "start": started or now, "end": None,
            "title": "", "series": [], "events": [], "chat": 0, "chatters": [], "minute": {"chat": 0, "at": now},
            "followersAtStart": None, "peak": 0, "peakAt": 0, "first": []}


def emit(items):
    """New things from Twitch or YouTube (called from their threads)."""
    global _seq
    now = time.time()
    with _lock:
        for item in items:
            if item.get("type") == "remove":
                for key in ("id", "login", "channelId"):
                    if item.get(key):
                        _removed.append((key, item[key]))
                del _removed[:-200]
                _seq += 1
                _items.append((_seq, item))
                continue
            _seq += 1
            item["seq"] = _seq
            _items.append((_seq, item))
            s = _session
            if not s or item.get("old"):
                continue
            if item.get("type") == "msg" and not item.get("own"):
                s["chat"] += 1
                s["minute"]["chat"] += 1
                who = item["p"] + ":" + (item.get("login") or item.get("user") or "")
                if who not in s["chatters"]:
                    s["chatters"].append(who)
                    if len(s["chatters"]) > 5000:
                        s["chatters"] = s["chatters"][-5000:]
                if item.get("first"):  # (their very first message in your Twitch chat)
                    s["first"].append({k: item.get(k) for k in ("p", "user", "login", "text", "at")})
                    del s["first"][:-300]
            elif item.get("type") == "event" and item.get("kind") in EVENT_KINDS:
                ev = {k: item.get(k) for k in ("kind", "p", "user", "amount", "money", "months", "text", "to") if item.get(k) not in (None, "")}
                ev["at"] = item.get("at") or now
                s["events"].append(ev)
                del s["events"][:-2000]


def _start():
    global _ticker, _twitch, _youtube
    if _twitch is None:
        _twitch = streamtwitch.Twitch(emit)
        _youtube = streamyt.YouTube(emit)
    _twitch.start()
    _youtube.start()
    adtimer.start(_twitch)
    multistream.start_at_launch()
    s = settings.load()
    obsstats.configure(s.get("lv_obs_port") or 4455, s.get("lv_obs_password") or "", s.get("lv_obs_on", True))
    if not (_ticker and _ticker.is_alive()):
        _ticker = threading.Thread(target=_tick_loop, daemon=True)
        _ticker.start()


def config():
    s = settings.load()
    try:
        import channelstats
        google = bool(channelstats._config()["refresh"])
    except Exception:
        google = False
    return {"twitch": streamtwitch.name_of(s.get("lv_twitch")), "youtube": s.get("lv_youtube") or "",
            "twitchClient": s.get("lv_tw_client") or "", "twitchLogin": s.get("lv_tw_login") or "",
            "twitchSignedIn": bool(s.get("lv_tw_refresh")), "google": google,
            "obsOn": s.get("lv_obs_on", True), "obsPort": s.get("lv_obs_port") or 4455, "obsPassword": bool(s.get("lv_obs_password")),
            "goals": s.get("lv_goals") if isinstance(s.get("lv_goals"), list) else [],
            "set": bool(s.get("lv_twitch") or s.get("lv_youtube") or s.get("lv_obs_set"))}


def setup(data):
    """Save what the Setup panel sends (only the fields it sends)."""
    changes = {}
    if "twitch" in data:
        name = streamtwitch.name_of(data.get("twitch"))
        if data.get("twitch") and not name:
            raise streamtwitch.Error("That isn't a Twitch name or link. It looks like twitch.tv/yourname.")
        changes["lv_twitch"] = name
    if "youtube" in data:
        import home
        link = home.normalize(data.get("youtube") or "") if data.get("youtube") else ""
        if data.get("youtube") and not link:
            raise streamtwitch.Error("That isn't a YouTube channel link. It looks like youtube.com/@yourname.")
        changes["lv_youtube"] = link
    if "obsOn" in data:
        changes["lv_obs_on"] = bool(data.get("obsOn"))
        changes["lv_obs_set"] = True
    if "obsPort" in data:
        try:
            port = int(data.get("obsPort") or 4455)
        except (TypeError, ValueError):
            port = 0
        if not 1 <= port <= 65535:
            raise streamtwitch.Error("The port is a number like 4455.")
        changes["lv_obs_port"] = port
    if "obsPassword" in data:
        changes["lv_obs_password"] = str(data.get("obsPassword") or "")[:200]
    if "goals" in data:
        goals = []
        for g in data.get("goals") or []:
            try:
                kind, target = str(g.get("kind")), int(g.get("target"))
            except (AttributeError, TypeError, ValueError):
                continue
            if kind in GOAL_KINDS and 0 < target < 10_000_000:
                goals.append({"kind": kind, "target": target})
        changes["lv_goals"] = goals[:6]
    settings.save(**changes)
    if _twitch:
        _twitch.start()
        _youtube.start()
    _start()


GOAL_KINDS = ("followers", "subs", "members", "chat", "peak", "chatters")


def _totals(s, tw, yt):
    """What happened this stream so far, as numbers."""
    ev = s["events"] if s else []
    count = lambda *kinds: sum(1 for e in ev if e["kind"] in kinds)  # noqa: E731
    subs = sum(1 for e in ev if e["kind"] == "sub") + sum(int(e.get("amount") or 1) for e in ev if e["kind"] == "gift" and e.get("p") == "tw")
    return {"followers": count("follow"), "subs": subs, "members": count("member") + sum(int(e.get("amount") or 1) for e in ev if e["kind"] == "gift" and e.get("p") == "yt"),
            "raids": count("raid"), "bits": sum(int(e.get("amount") or 0) for e in ev if e["kind"] == "bits"),
            "superchats": count("superchat", "sticker"),
            "money": _money([e for e in ev if e["kind"] in ("superchat", "sticker")]),
            "chat": s["chat"] if s else 0, "chatters": len(s["chatters"]) if s else 0,
            "peak": s["peak"] if s else 0, "now": (tw or 0) + (yt or 0)}


def _money(events):
    """Super Chats added up per currency ("NOK 150", "$12")."""
    by = {}
    for e in events:
        m = re.match(r"^\s*([^\d\s]+)", e.get("money") or "")
        cur = m.group(1) if m else ""
        by[cur] = by.get(cur, 0) + float(e.get("amount") or 0)
    return ", ".join(f"{c}{v:g}" if len(c) == 1 else f"{c} {v:g}" for c, v in sorted(by.items(), key=lambda x: -x[1]))


def _tick_loop():
    while True:
        try:
            _tick()
        except Exception:  # noqa: BLE001 (one bad look must not stop the console)
            pass
        time.sleep(10)


def _tick():
    global _session, _last_live
    now = time.time()
    tw, yt, obs = (_twitch.status if _twitch else {}), (_youtube.status if _youtube else {}), obsstats.state()
    live = bool(tw.get("live") or yt.get("live") or obs.get("streaming"))
    with _lock:
        if live:
            _last_live = now
            if not _session:
                started = min([x for x in (tw.get("started"), yt.get("started")) if x] or [now])
                if obs.get("streaming") and obs.get("streamMs"):
                    started = min(started, now - obs["streamMs"] / 1000)
                _session = _new_session(now, started if now - started < 6 * 3600 else now)
                _session["followersAtStart"] = tw.get("followers")
        s = _session
        if not s:
            return
        s["title"] = tw.get("title") or yt.get("title") or s["title"]
        viewers = (tw.get("viewers") or 0) + (yt.get("viewers") or 0)
        if viewers > s["peak"]:
            s["peak"], s["peakAt"] = viewers, now
        if now - s["minute"]["at"] >= SAMPLE:
            s["series"].append({"t": round(now - s["start"]), "tw": tw.get("viewers") or 0, "yt": yt.get("viewers") or 0,
                                "chat": s["minute"]["chat"], "kbps": obs.get("bitrate") or 0})
            s["minute"] = {"chat": 0, "at": now}
            if len(s["series"]) % 5 == 0:
                _save(s)
        if not live and now - _last_live > END_AFTER:
            s["end"] = _last_live or now
            _save(s)
            _session = None


# ---------------------------------------------------------------- after the stream

def _moments(s):
    """The best and worst minutes, in plain words."""
    out = []
    series = s["series"]
    if len(series) >= 3:
        busiest = max(series, key=lambda p: p["chat"])
        avg = sum(p["chat"] for p in series) / len(series)
        if busiest["chat"] >= max(10, avg * 2):
            out.append({"t": busiest["t"], "kind": "chat", "text": "Chat went wild", "sub": f"{busiest['chat']} messages in one minute"})
        drops = [(series[i - 5]["tw"] + series[i - 5]["yt"]) - (series[i]["tw"] + series[i]["yt"]) for i in range(5, len(series))]
        if drops:
            i = max(range(len(drops)), key=lambda k: drops[k])
            if drops[i] >= 5:
                out.append({"t": series[i + 5]["t"], "kind": "drop", "text": "Biggest drop", "sub": f"{drops[i]} fewer people in 5 minutes"})
    for e in s["events"]:
        if e["kind"] == "raid":
            out.append({"t": round(e["at"] - s["start"]), "kind": "raid", "text": f"Raid from {e.get('user')}", "sub": f"+{e.get('amount') or 0} people"})
    out.sort(key=lambda m: m["t"])
    return out[:8]


def summary(s):
    series = s["series"]
    views = [p["tw"] + p["yt"] for p in series]
    end = s.get("end") or time.time()
    t = _totals(s, 0, 0)
    return {"id": s["id"], "title": s["title"] or "Stream", "start": s["start"], "end": end, "minutes": round((end - s["start"]) / 60),
            "peak": max(views + [s["peak"]]) if views or s["peak"] else 0, "average": round(sum(views) / len(views)) if views else 0,
            "hoursWatched": round(sum(views) / 60, 1), "chat": s["chat"], "chatters": len(s["chatters"]),
            "followers": t["followers"], "subs": t["subs"], "members": t["members"], "raids": t["raids"],
            "bits": t["bits"], "money": t["money"], "superchats": t["superchats"]}


def _save(s):
    os.makedirs(STREAMS_DIR, exist_ok=True)
    data = {**s, "summary": summary(s), "moments": _moments(s)}
    path = os.path.join(STREAMS_DIR, s["id"] + ".json")
    with open(path + ".new", "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.replace(path + ".new", path)


def streams():
    """Past streams, newest first (just the numbers)."""
    out = []
    try:
        names = sorted((n for n in os.listdir(STREAMS_DIR) if n.endswith(".json")), reverse=True)[:60]
    except OSError:
        names = []
    for n in names:
        try:
            with open(os.path.join(STREAMS_DIR, n), encoding="utf-8") as f:
                data = json.load(f)
            if data.get("end") or not (_session and _session["id"] == data.get("id")):
                out.append(data.get("summary") or summary(data))
        except (OSError, ValueError, KeyError):
            continue
    return out


def stream(sid):
    if not re.fullmatch(r"\d{8}-\d{6}", str(sid or "")):
        return None
    try:
        with open(os.path.join(STREAMS_DIR, sid + ".json"), encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None
    return {"summary": data.get("summary") or summary(data), "series": data.get("series") or [],
            "events": data.get("events") or [], "moments": data.get("moments") or _moments(data)}


def forget(sid):
    if re.fullmatch(r"\d{8}-\d{6}", str(sid or "")):
        try:
            os.remove(os.path.join(STREAMS_DIR, sid + ".json"))
        except OSError:
            pass


# ---------------------------------------------------------------- what the page asks for

def state(since=0):
    _start()
    tw, yt = dict(_twitch.status), dict(_youtube.status)
    now = time.time()
    with _lock:
        chat = [dict(item) for seq, item in _items if seq > since and item.get("type") != "remove"][-200:]
        removed = [{"by": k, "value": v} for k, v in _removed[-50:]]
        speed = sum(1 for _, i in _items if i.get("type") == "msg" and now - (i.get("at") or 0) < 60 and not i.get("old"))
        s = _session
        session = None
        if s:
            series = list(s["series"])
            series.append({"t": round(now - s["start"]), "tw": tw.get("viewers") or 0, "yt": yt.get("viewers") or 0,
                           "chat": s["minute"]["chat"], "now": True})
            session = {"id": s["id"], "start": s["start"], "title": s["title"], "series": series[-360:],
                       "events": s["events"][-60:], "first": s.get("first", [])[-100:],
                       "clips": s.get("clips", [])[-30:], "totals": _totals(s, tw.get("viewers"), yt.get("viewers"))}
        seq = _seq
    return {"ok": True, "config": config(), "twitch": tw, "youtube": yt, "obs": obsstats.state(), "chat": chat,
            "removed": removed, "seq": seq, "speed": speed, "session": session,
            "ms": multistream.status(), "ads": adtimer.status()}


def send(text, to):
    out = {}
    if to in ("both", "tw") and _twitch and _twitch.channel:
        try:
            _twitch.send(text)
            out["tw"] = True
        except streamtwitch.Error as e:
            out["twError"] = str(e)
    if to in ("both", "yt") and _youtube and _youtube.status.get("live"):
        try:
            _youtube.send(text)
            out["yt"] = True
        except Exception as e:  # noqa: BLE001 (Google's own errors)
            out["ytError"] = str(e) or "YouTube said no."
    return out


def moderate(p, action, message_id="", user_id="", login="", channel_id=""):
    if action not in ("delete", "timeout", "ban"):
        raise streamtwitch.Error("Unknown action.")
    if p == "tw":
        _twitch.moderate(action, message_id, user_id, login)
    else:
        if action == "delete":
            raise streamtwitch.Error("Remove YouTube messages in YouTube Studio's chat for now.")
        _youtube.moderate(action, channel_id)


def clip():
    """Make a Twitch clip and remember it with this stream."""
    c = _twitch.clip()
    c["at"] = time.time()
    with _lock:
        if _session is not None:
            _session.setdefault("clips", []).append(c)
            del _session["clips"][:-200]
    return c


def twitch():
    _start()
    return _twitch
