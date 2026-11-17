"""The ad timer (2.36.0): when Twitch runs your next ad break, a button to run it now (at a good moment)
or snooze it, and helpers around the break: a message in chat a minute before, and OBS's BRB scene
while the ads play (back to your scene after).

Needs the Twitch sign-in with the ad permissions (channel:read:ads, channel:edit:commercial,
channel:manage:ads). It works in the background, so it also helps while VaultHub is minimized.
"""

import threading
import time

import settings

WARN_BEFORE = 60  # seconds
DEFAULTS = {"tellChat": True, "chatText": "Ad break in 1 minute. Grab a snack, I'll be right back! 🍿",
            "brb": True, "brbScene": "", "beep": False, "length": 180}

_lock = threading.Lock()
_state = {"schedule": None, "fetched": 0, "error": "", "running": None, "warned": 0, "warn": None, "lastRun": 0}
_thread = None
_twitch = None  # streamtwitch.Twitch, set by streamlive


def prefs():
    saved = settings.load().get("lv_ads")
    out = dict(DEFAULTS)
    if isinstance(saved, dict):
        out.update({k: v for k, v in saved.items() if k in DEFAULTS})
    return out


def set_prefs(data):
    p = prefs()
    for k in DEFAULTS:
        if k in data:
            v = data[k]
            if isinstance(DEFAULTS[k], bool):
                v = bool(v)
            elif k == "length":
                v = min((30, 60, 90, 120, 150, 180), key=lambda x: abs(x - int(v or 180)))
            else:
                v = str(v or "")[:300]
            p[k] = v
    settings.save(lv_ads=p)
    return p


def start(twitch):
    global _thread, _twitch
    _twitch = twitch
    if not (_thread and _thread.is_alive()):
        _thread = threading.Thread(target=_loop, daemon=True)
        _thread.start()


def _ready():
    tw = _twitch
    return bool(tw and tw.channel and tw.config().get("refresh"))


def _fetch():
    try:
        sched = _twitch.ad_schedule()
        with _lock:
            _state.update(schedule=sched, fetched=time.time(), error="")
    except Exception as e:  # noqa: BLE001 (Twitch's own errors)
        with _lock:
            _state.update(fetched=time.time(), error=str(e) or "Couldn't ask Twitch about ads.")


def _loop():
    while True:
        try:
            _step()
        except Exception:  # noqa: BLE001 (one bad look must not stop the timer)
            pass
        time.sleep(3)


def _step():
    if not _ready():
        return
    now = time.time()
    live = bool(_twitch.status.get("live"))
    run = _state["running"]
    if run and now >= run["until"]:
        _end_break()
        run = None
    if not live and not run:
        return
    sched = _state["schedule"]
    nxt = (sched or {}).get("next") or 0
    stale = now - _state["fetched"] > 60 or (nxt and now > nxt + 5 and now - _state["fetched"] > 15)
    if stale:
        _fetch()
        sched = _state["schedule"]
        nxt = (sched or {}).get("next") or 0
    if not nxt:
        return
    if 0 < nxt - now <= WARN_BEFORE and abs(_state["warned"] - nxt) > 120 and not run:
        with _lock:
            _state.update(warned=nxt, warn={"id": nxt, "at": nxt})
        p = prefs()
        if p["tellChat"] and p["chatText"].strip():
            try:
                _twitch.send(p["chatText"].strip())
            except Exception:  # noqa: BLE001
                pass
    length = (sched or {}).get("length") or 180
    if nxt <= now < nxt + length and not run and now - _state["lastRun"] > length:
        _start_break(nxt, length)


def _brb_scene():
    p = prefs()
    if p["brbScene"]:
        return p["brbScene"]
    import obsctl
    try:
        scenes = [s.get("sceneName") for s in (obsctl.ask_once("GetSceneList").get("scenes") or [])]
    except obsctl.Error:
        return ""
    for name in scenes:
        low = str(name or "").lower()
        if "brb" in low or "be right back" in low or "pause" in low:
            return name
    return ""


def _start_break(at, length):
    back = ""
    p = prefs()
    if p["brb"]:
        import obsctl
        scene = _brb_scene()
        try:
            now_scene = obsctl.ask_once("GetCurrentProgramScene")
            current = now_scene.get("currentProgramSceneName") or now_scene.get("sceneName") or ""
            if scene and current and current != scene:
                obsctl.ask_once("SetCurrentProgramScene", {"sceneName": scene})
                back = current
        except obsctl.Error:
            pass
    with _lock:
        _state["running"] = {"start": at, "length": length, "until": at + length, "back": back, "brb": back and _brb_scene()}
        _state["lastRun"] = at


def _end_break():
    run = _state["running"]
    with _lock:
        _state["running"] = None
    if run and run.get("back"):
        import obsctl
        try:
            now_scene = obsctl.ask_once("GetCurrentProgramScene")
            current = now_scene.get("currentProgramSceneName") or now_scene.get("sceneName") or ""
            if current == run.get("brb"):  # (if you switched yourself during the break, leave it be)
                obsctl.ask_once("SetCurrentProgramScene", {"sceneName": run["back"]})
        except obsctl.Error:
            pass
    _state["fetched"] = 0  # ask Twitch for the next one


def run_now(length=None):
    if not _ready():
        raise RuntimeError("Sign in to Twitch first (Live > Set up > Twitch).")
    length = length or prefs()["length"]
    r = _twitch.run_ad(length)
    _start_break(time.time(), r["length"])
    return status()


def snooze():
    if not _ready():
        raise RuntimeError("Sign in to Twitch first (Live > Set up > Twitch).")
    _twitch.snooze_ad()
    _fetch()
    with _lock:
        _state["warn"] = None
    return status()


def end_now():
    """The break is over early (or you want your scene back now)."""
    _end_break()
    return status()


def scenes():
    import obsctl
    try:
        return [s.get("sceneName") for s in reversed(obsctl.ask_once("GetSceneList").get("scenes") or []) if s.get("sceneName")]
    except obsctl.Error:
        return []


def status():
    tw = _twitch
    ready = _ready()
    if ready and not _state["schedule"] and time.time() - _state["fetched"] > 20:
        threading.Thread(target=_fetch, daemon=True).start()
    with _lock:
        sched = dict(_state["schedule"] or {})
        run = dict(_state["running"]) if _state["running"] else None
        fetched = _state["fetched"]
        err, warn = _state["error"], _state["warn"]
    pre = sched.get("prerollFree") or 0
    return {"ready": ready, "channel": bool(tw and tw.channel), "live": bool(tw and tw.status.get("live")),
            "next": sched.get("next") or 0, "length": sched.get("length") or 0, "snoozes": sched.get("snoozes"),
            "snoozeRefill": sched.get("snoozeRefill") or 0, "prerollUntil": fetched + pre if pre else 0,
            "last": sched.get("last") or 0, "running": run, "warn": warn, "error": err, "prefs": prefs(), "now": time.time()}
