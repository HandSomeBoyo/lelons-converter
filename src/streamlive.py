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
import gamedetect
import multistream
import obsstats
import settings
import streamoverlay
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
_sources = deque(maxlen=500)  # (2.42.0) messages seen twice in a shared chat
_ended = None  # (2.42.0) the stream that ended last, for the recap: {"id", "at"}
_obs_stop = 0  # when OBS last ended a stream (Twitch says "live" a while longer: that isn't a new stream)


def _new_session(now, started=None):
    return {"id": time.strftime("%Y%m%d-%H%M%S", time.localtime(now)), "start": started or now, "end": None,
            "title": "", "series": [], "events": [], "chat": 0, "chatters": [], "minute": {"chat": 0, "at": now},
            "followersAtStart": None, "peak": 0, "peakAt": 0, "first": [], "talk": {},
            "health": {"droppedPct": 0.0, "dropped": 0, "reconnects": 0, "slow": 0, "lag": 0, "obs": False}}


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
            ch = item.get("ch")
            if item.get("p") == "tw" and ch and _twitch and _twitch.channel and ch != _twitch.channel:
                # (2.42.0) a friend's chat (co-streaming): shown, but not counted as yours
                if item.get("type") == "event":
                    continue
                item["guest"] = ch
                item["first"] = False
            if item.get("sourceId"):
                if item["sourceId"] in _sources:
                    continue
                _sources.append(item["sourceId"])
            _seq += 1
            item["seq"] = _seq
            _items.append((_seq, item))
            if item.get("type") == "event":
                streamoverlay.push(item)  # (3.0) the alert on your stream (also before VaultHub sees you're live)
            s = _session
            if not s or item.get("old") or item.get("guest"):
                continue
            if item.get("type") == "msg" and not item.get("own"):
                s["chat"] += 1
                s["minute"]["chat"] += 1
                who = item["p"] + ":" + (item.get("login") or item.get("user") or "")
                if who not in s["chatters"]:
                    s["chatters"].append(who)
                    if len(s["chatters"]) > 5000:
                        s["chatters"] = s["chatters"][-5000:]
                talk = s.setdefault("talk", {})
                if who in talk or len(talk) < 5000:
                    t = talk.setdefault(who, [item.get("user") or "", 0])
                    t[0], t[1] = item.get("user") or t[0], t[1] + 1
                if item.get("first") and not any(f.get("login") == item.get("login") for f in s["first"]):
                    # (their very first message in your Twitch chat; once each, even if Twitch says it twice)
                    s["first"].append({k: item.get(k) for k in ("p", "user", "login", "text", "at")})
                    del s["first"][:-300]
            elif item.get("type") == "event" and item.get("kind") in EVENT_KINDS:
                ev = {k: item.get(k) for k in ("kind", "p", "user", "amount", "money", "months", "text", "to", "tier") if item.get(k) not in (None, "")}
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
    gamedetect.start(_twitch)
    multistream.start_at_launch()
    s = settings.load()
    obsstats.configure(s.get("lv_obs_port") or 4455, s.get("lv_obs_password") or "", s.get("lv_obs_on", True))
    if not (_ticker and _ticker.is_alive()):
        _ticker = threading.Thread(target=_tick_loop, daemon=True)
        _ticker.start()
        threading.Thread(target=_wake_overlay, daemon=True).start()


def _wake_overlay():
    """(3.0) The alerts page in OBS stays blank if OBS opened before VaultHub: tell OBS to load it again."""
    if not streamoverlay.start():
        return
    import obsctl
    try:
        obsctl.ask_once("PressInputPropertiesButton", {"inputName": streamoverlay.SOURCE, "propertyName": "refreshnocache"})
    except Exception:  # noqa: BLE001 (OBS closed, or the alerts aren't in OBS)
        pass


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
    global _session, _last_live, _ended, _obs_stop
    now = time.time()
    tw, yt, obs = (_twitch.status if _twitch else {}), (_youtube.status if _youtube else {}), obsstats.state()
    live = bool(tw.get("live") or yt.get("live") or obs.get("streaming"))
    end_after = END_AFTER
    with _lock:
        h = _session.setdefault("health", {}) if _session else None
        if h is not None and obs.get("connected"):
            if obs.get("streaming"):
                h["obs"] = True
            elif h.get("obs"):
                # OBS stopped streaming: Twitch keeps saying "live" for a few minutes, so OBS decides.
                live, end_after = False, 45
        elif h is None and obs.get("connected") and not obs.get("streaming") and now - _obs_stop < 600:
            live = False
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
        if (adtimer._state.get("running") or {}).get("until", 0) > now:  # (2.43.0) for the earnings estimate
            s["adViews"] = s.get("adViews", 0) + (tw.get("viewers") or 0) * 10  # viewer-seconds of ads
        h = s.setdefault("health", {})
        if obs.get("connected") and obs.get("streaming"):
            h["obs"] = True
            if obs.get("total", 0) > 300:
                h["droppedPct"] = round(max(h.get("droppedPct", 0), obs.get("droppedPct") or 0), 2)
                h["dropped"] = max(h.get("dropped", 0), obs.get("dropped") or 0)
            keys = {w.get("key") for w in obs.get("warnings") or []}
            if obs.get("reconnecting") and not h.get("was"):
                h["reconnects"] = h.get("reconnects", 0) + 1
            h["was"] = bool(obs.get("reconnecting"))
            if "bitrate" in keys:
                h["slow"] = h.get("slow", 0) + 10  # (seconds: one look every 10)
            if "lag" in keys or "gpu" in keys:
                h["lag"] = h.get("lag", 0) + 10
        if now - s["minute"]["at"] >= SAMPLE and not live:
            s["minute"] = {"chat": 0, "at": now}  # (3.0) the minutes after the stream ended: no 0 on the graph, no lower average
        elif now - s["minute"]["at"] >= SAMPLE:
            s["series"].append({"t": round(now - s["start"]), "tw": tw.get("viewers") or 0, "yt": yt.get("viewers") or 0,
                                "chat": s["minute"]["chat"], "kbps": obs.get("bitrate") or 0})
            s["minute"] = {"chat": 0, "at": now}
            if len(s["series"]) % 5 == 0:
                _save(s)
        if not live and now - _last_live > end_after:
            s["end"] = _last_live or now
            _save(s)
            _session = None
            if end_after != END_AFTER:
                _obs_stop = now
            if s["end"] - s["start"] >= 300:  # (a few test minutes don't get a recap)
                _ended = {"id": s["id"], "at": now}


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
            "bits": t["bits"], "money": t["money"], "superchats": t["superchats"],
            "newChatters": len(s.get("first") or []), "clips": len(s.get("clips") or []), "earn": earnings(s)}


# ---------------------------------------------------------------- earnings estimate (2.43.0)

SUB_PRICE = {"1000": 4.99, "2000": 9.99, "3000": 24.99, "Prime": 4.99}
EARN_DEFAULTS = {"split": 50, "cpm": 3.5, "cur": "NOK", "rate": 10.5}


def earn_prefs():
    saved = settings.load().get("lv_earn")
    out = dict(EARN_DEFAULTS)
    if isinstance(saved, dict):
        out.update({k: saved[k] for k in EARN_DEFAULTS if k in saved})
    return out


def set_earn_prefs(data):
    p = earn_prefs()
    try:
        if "split" in data:
            p["split"] = min(100, max(10, int(data["split"])))
        if "cpm" in data:
            p["cpm"] = min(50.0, max(0.0, float(data["cpm"])))
        if "rate" in data:
            p["rate"] = min(100000.0, max(0.0001, float(data["rate"])))
        if "cur" in data:
            p["cur"] = re.sub(r"[^A-Z]", "", str(data["cur"]).upper())[:3] or "USD"
    except (TypeError, ValueError):
        raise streamtwitch.Error("Those numbers don't look right.")
    settings.save(lv_earn=p)
    return p


def earnings(s):
    """Roughly what Twitch pays for this stream, in US dollars: {subs, bits, ads, total, subCount, bitCount}."""
    p = earn_prefs()
    split = p["split"] / 100
    subs = n = 0
    for e in s.get("events") or []:
        if e.get("p") != "tw":
            continue
        if e["kind"] == "sub":
            subs += SUB_PRICE.get(str(e.get("tier") or "1000"), 4.99) * split
            n += 1
        elif e["kind"] == "gift" and e.get("to"):  # (a gift of 5 also comes as 5 single gifts: those are counted)
            subs += SUB_PRICE.get(str(e.get("tier") or "1000"), 4.99) * split
            n += 1
    bits = sum(int(e.get("amount") or 0) for e in s.get("events") or [] if e["kind"] == "bits")
    ads = (s.get("adViews") or 0) / 30 / 1000 * p["cpm"]  # (one ad is about 30 seconds, paid per 1000 shown)
    return {"subs": round(subs, 2), "bits": round(bits / 100, 2), "ads": round(ads, 2),
            "total": round(subs + bits / 100 + ads, 2), "subCount": n, "bitCount": bits}


_month_cache = {"at": 0, "key": None, "total": 0, "count": 0}


def earnings_now():
    """This stream so far and this month (saved streams + this one)."""
    with _lock:
        s = _session
        now_e = earnings(s) if s else None
        sid = s["id"] if s else ""
    month = time.strftime("%Y%m")
    if time.time() - _month_cache["at"] > 60 or _month_cache["key"] != (month, sid):
        past = [x for x in streams() if x.get("id", "").startswith(month) and x.get("id") != sid]
        _month_cache.update(at=time.time(), key=(month, sid), total=sum((x.get("earn") or {}).get("total", 0) for x in past), count=len(past))
    total = (now_e or {}).get("total", 0) + _month_cache["total"]
    count = _month_cache["count"] + (1 if now_e else 0)
    return {"stream": now_e, "month": round(total, 2), "monthStreams": count, "prefs": earn_prefs()}


def _top(s, n=5):
    """Who chatted the most: [{user, p, n}]."""
    talk = s.get("talk") or {}
    best = sorted(talk.items(), key=lambda kv: -kv[1][1])[:n]
    return [{"user": v[0] or k.partition(":")[2], "p": k.partition(":")[0], "n": v[1]} for k, v in best]


def _save(s):
    os.makedirs(STREAMS_DIR, exist_ok=True)
    data = {**s, "summary": summary(s), "moments": _moments(s)}
    path = os.path.join(STREAMS_DIR, s["id"] + ".json")
    with open(path + ".new", "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.replace(path + ".new", path)


# (2.43.1) What each saved stream file says, kept while the file doesn't change. Saved streams hold the
# whole stream (chat counts, the graph, every event), so reading them all again froze the Live page:
# the earnings card read up to 60 of them every minute, and the recap check read the newest every poll.
_file_cache = {}


def _file_info(name):
    """{id, start, end, summary} of one saved stream, or None."""
    path = os.path.join(STREAMS_DIR, name)
    try:
        st = os.stat(path)
    except OSError:
        return None
    stamp = (st.st_mtime_ns, st.st_size)
    hit = _file_cache.get(name)
    if hit and hit[0] == stamp:
        return hit[1]
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        info = {"id": data.get("id"), "start": data.get("start", 0), "end": data.get("end"),
                "summary": data.get("summary") or summary(data)}
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        info = None
    if len(_file_cache) > 200:
        _file_cache.clear()
    _file_cache[name] = (stamp, info)
    return info


def _names(n):
    try:
        return sorted((x for x in os.listdir(STREAMS_DIR) if x.endswith(".json")), reverse=True)[:n]
    except OSError:
        return []


def streams():
    """Past streams, newest first (just the numbers)."""
    out = []
    for n in _names(60):
        info = _file_info(n)
        if info and (info["end"] or not (_session and _session["id"] == info["id"])):
            out.append(dict(info["summary"]))
    return out


def stream(sid):
    if not re.fullmatch(r"\d{8}-\d{6}", str(sid or "")):
        return None
    try:
        with open(os.path.join(STREAMS_DIR, sid + ".json"), encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None
    h = data.get("health") or {}
    return {"summary": data.get("summary") or summary(data), "series": data.get("series") or [],
            "events": data.get("events") or [], "moments": data.get("moments") or _moments(data),
            # (2.42.0) for the recap
            "top": _top(data), "newbies": [f.get("user") for f in (data.get("first") or []) if f.get("user")][:60],
            "clips": [{k: c.get(k) for k in ("id", "url", "edit", "at")} for c in (data.get("clips") or [])][-30:],
            "health": {k: h.get(k) for k in ("droppedPct", "dropped", "reconnects", "slow", "lag", "obs")}}


def last_ended():
    """The newest stream that ended in the last 12 hours (even before the app was opened again)."""
    if _ended:
        return _ended
    names = _names(1)
    data = _file_info(names[0]) if names else None
    if data and data["end"] and time.time() - data["end"] < 12 * 3600 and data["end"] - (data["start"] or 0) >= 300:
        return {"id": data["id"], "at": data["end"]}
    return None


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
            "ms": multistream.status(), "ads": adtimer.status(), "ended": last_ended(), "co": costream(),
            "gd": gamedetect.status(), "earn": earnings_now()}


# ---------------------------------------------------------------- co-streaming (2.42.0)

def costream():
    """The friends whose chats show in the console, and whether they're live (looked at for free)."""
    names = list(_twitch.guests) if _twitch else []
    if not names:
        return []
    import live
    found = live.live([{"username": n, "twitch": n} for n in names])
    on = {x["username"]: x for x in found["live"] if x.get("kind") == "twitch"}
    return [{"name": n, "live": n in on, "viewers": (on.get(n) or {}).get("viewers"), "title": (on.get(n) or {}).get("title") or "",
             "loading": found["loading"] and n not in on} for n in names]


def set_costream(names):
    _start()
    _twitch.set_guests(names)
    return costream()


def send(text, to):
    out = {}
    if to.startswith("co:") and _twitch:  # (2.42.0) a friend's chat
        try:
            _twitch.send(text, to[3:])
            out["tw"] = True
        except streamtwitch.Error as e:
            out["twError"] = str(e)
        return out
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
