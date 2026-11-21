"""(3.0) Stream alerts on your stream: a page OBS shows as a Browser Source, like StreamElements alerts.

When someone follows, subscribes, gifts subs, raids, cheers bits, sends a Super Chat or becomes a member,
the page shows a picture (your GIF, or a big emoji) with text like "frostbyte_ is now following!" and plays
a sound (your own file, or one of VaultHub's). Viewers see and hear it, because it's part of your stream.

The page lives on this PC at a fixed address (http://127.0.0.1:17771/alerts), so OBS can keep it while
VaultHub opens and closes. It only shows alerts: nothing on it can change anything.
"""

import json
import mimetypes
import os
import re
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import settings

PORTS = range(17771, 17781)
MEDIA_DIR = os.path.join(settings.DATA_DIR, "alerts")
PAGE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ui", "overlay.html")
FONTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ui", "fonts")
MAX_FILE = 25 * 1024 * 1024
SOUNDS = ("fanfare", "levelup", "coins", "chime", "ding", "pop", "none")
PICTURE_TYPES = (".gif", ".png", ".jpg", ".jpeg", ".webp", ".webm", ".mp4")
SOUND_TYPES = (".mp3", ".wav", ".ogg", ".m4a")

# kind -> what the alert says by default, its emoji and sound
KINDS = {
    "follow": {"name": "Follow", "text": "{name} is now following!", "emoji": "💜", "sound": "chime"},
    "sub": {"name": "Sub", "text": "{name} just subscribed!", "emoji": "⭐", "sound": "fanfare"},
    "gift": {"name": "Gifted subs", "text": "{name} gifted {subs}!", "emoji": "🎁", "sound": "fanfare"},
    "raid": {"name": "Raid", "text": "{name} is raiding with {amount} people!", "emoji": "🚀", "sound": "levelup"},
    "bits": {"name": "Bits", "text": "{name} cheered {amount} bits!", "emoji": "💎", "sound": "coins"},
    "superchat": {"name": "Super Chat", "text": "{name} sent {money}!", "emoji": "💸", "sound": "coins"},
    "member": {"name": "New member", "text": "{name} just became a member!", "emoji": "🎖️", "sound": "chime"},
}
STYLE_DEFAULTS = {"color": "#ffcf3f", "seconds": 7, "volume": 70}

_lock = threading.Lock()
_queue = deque(maxlen=50)  # (seq, alert)
_seq = 0
_server = None
_port = 0
_mystery = {}  # gifter -> [subs still to come as single gifts, at]
_seen = 0  # the last time the page in OBS asked for alerts


# ---------------------------------------------------------------- settings

def prefs():
    saved = settings.load().get("lv_ov")
    saved = saved if isinstance(saved, dict) else {}
    out = {k: saved.get(k, v) for k, v in STYLE_DEFAULTS.items()}
    kinds = saved.get("kinds") if isinstance(saved.get("kinds"), dict) else {}
    out["kinds"] = {}
    for k, d in KINDS.items():
        mine = kinds.get(k) if isinstance(kinds.get(k), dict) else {}
        out["kinds"][k] = {"on": mine.get("on", True), "text": mine.get("text") or d["text"],
                           "sound": mine.get("sound") or d["sound"], "picture": mine.get("picture") or "",
                           "volume": mine.get("volume", 100)}
    return out


def set_prefs(data):
    p = prefs()
    if "color" in data and re.fullmatch(r"#[0-9a-fA-F]{6}", str(data["color"])):
        p["color"] = str(data["color"])
    for key, lo, hi in (("seconds", 3, 20), ("volume", 0, 100)):
        if key in data:
            try:
                p[key] = max(lo, min(hi, int(data[key])))
            except (TypeError, ValueError):
                pass
    for k, change in (data.get("kinds") or {}).items():
        if k not in KINDS or not isinstance(change, dict):
            continue
        mine = p["kinds"][k]
        if "on" in change:
            mine["on"] = bool(change["on"])
        if "text" in change:
            mine["text"] = re.sub(r"\s+", " ", str(change["text"] or "")).strip()[:120] or KINDS[k]["text"]
        if "sound" in change:
            s = str(change["sound"] or "")
            mine["sound"] = s if s in SOUNDS or _media_ok(s) else KINDS[k]["sound"]
        if "picture" in change:
            s = str(change["picture"] or "")
            mine["picture"] = s if _media_ok(s) else ""
        if "volume" in change:
            try:
                mine["volume"] = max(0, min(100, int(change["volume"])))
            except (TypeError, ValueError):
                pass
    settings.save(lv_ov=p)
    return p


def _media_ok(name):
    return bool(re.fullmatch(r"[a-z]+-(sound|picture)-\d+\.[a-z0-9]{2,4}", name or "")) and os.path.isfile(os.path.join(MEDIA_DIR, name))


def save_file(kind, what, name, stream, length):
    """Your own sound or picture for one alert. Returns the new prefs."""
    if kind not in KINDS or what not in ("sound", "picture"):
        raise ValueError("Unknown alert.")
    ext = os.path.splitext(str(name or ""))[1].lower()
    allowed = SOUND_TYPES if what == "sound" else PICTURE_TYPES
    if ext not in allowed:
        raise ValueError(("Pick a sound file (" if what == "sound" else "Pick a picture or video (") + ", ".join(allowed) + ").")
    if length > MAX_FILE:
        raise ValueError("That file is too big (25 MB at most).")
    os.makedirs(MEDIA_DIR, exist_ok=True)
    fname = f"{kind}-{what}-{int(time.time() * 1000)}{'.jpg' if ext == '.jpeg' else ext}"
    path = os.path.join(MEDIA_DIR, fname)
    left = length
    with open(path + ".part", "wb") as f:
        while left > 0:
            chunk = stream.read(min(65536, left))
            if not chunk:
                break
            f.write(chunk)
            left -= len(chunk)
    os.replace(path + ".part", path)
    old = prefs()["kinds"][kind]["sound" if what == "sound" else "picture"]
    p = set_prefs({"kinds": {kind: {what: fname}}})
    if old and old != fname and _media_ok(old):
        try:
            os.remove(os.path.join(MEDIA_DIR, old))
        except OSError:
            pass
    return p


# ---------------------------------------------------------------- alerts coming in

def _money_amount(e):
    return e.get("money") or str(e.get("amount") or "")


def push(item):
    """An event from the chat (streamlive.emit). Turns it into an alert when that alert is on."""
    kind = item.get("kind")
    kind = "superchat" if kind == "sticker" else kind
    if kind not in KINDS or item.get("old") or item.get("guest"):
        return
    who = item.get("user") or "Someone"
    now = time.time()
    if kind == "gift":
        if item.get("to"):
            # A gift of 5 comes as one "gifted 5" and then 5 single gifts: one alert, like StreamElements.
            m = _mystery.get(who.lower())
            if m and m[0] > 0 and now - m[1] < 60:
                m[0] -= 1
                return
        else:
            _mystery[who.lower()] = [int(item.get("amount") or 1), now]
    add({"kind": kind, "name": who, "amount": item.get("amount") or 0, "months": item.get("months") or 0,
         "to": item.get("to") or "", "money": _money_amount(item) if kind == "superchat" else "",
         "message": (item.get("text") or "")[:200] if kind in ("sub", "bits", "superchat") else ""})


def add(alert):
    global _seq
    k = prefs()["kinds"].get(alert["kind"])
    if not k or not (k["on"] or alert.get("test")):
        return
    with _lock:
        _seq += 1
        _queue.append((_seq, {**alert, "id": _seq, "at": time.time()}))


def test(kind):
    if kind not in KINDS:
        raise ValueError("Unknown alert.")
    sample = {"follow": {"name": "frostbyte_"}, "sub": {"name": "pixelpete", "months": 3, "message": "Love the streams!"},
              "gift": {"name": "grumpygoat", "amount": 5}, "raid": {"name": "BigStreamer", "amount": 48},
              "bits": {"name": "nightowl_k", "amount": 500, "message": "cheer500 great play"},
              "superchat": {"name": "Kari", "money": "NOK 50", "message": "Hi from Bergen!"}, "member": {"name": "Tor"}}[kind]
    add({"kind": kind, "amount": 0, "months": 0, "to": "", "money": "", "message": "", **sample, "test": True})


def feed(since):
    global _seen
    _seen = time.time()
    p = prefs()
    with _lock:
        fresh = [a for s, a in _queue if s > since and time.time() - a["at"] < 300]
        seq = _seq
    return {"ok": True, "seq": seq, "alerts": fresh, "style": {k: p[k] for k in STYLE_DEFAULTS},
            "kinds": {k: {**v, "emoji": KINDS[k]["emoji"]} for k, v in p["kinds"].items()}}


# ---------------------------------------------------------------- the page OBS shows

class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, body, kind, cache=False):
        self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "max-age=3600" if cache else "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path, _, query = self.path.partition("?")
        try:
            if path in ("/alerts", "/alerts/"):
                with open(PAGE, "rb") as f:
                    return self._send(f.read(), "text/html; charset=utf-8")
            if path == "/alerts/feed":
                m = re.search(r"(?:^|&)since=(\d+)", query)
                return self._send(json.dumps(feed(int(m.group(1)) if m else 0)).encode(), "application/json")
            m = re.fullmatch(r"/alerts/media/([a-z]+-(?:sound|picture)-\d+\.[a-z0-9]{2,4})", path)
            if m and os.path.isfile(os.path.join(MEDIA_DIR, m.group(1))):
                with open(os.path.join(MEDIA_DIR, m.group(1)), "rb") as f:
                    return self._send(f.read(), mimetypes.guess_type(m.group(1))[0] or "application/octet-stream", cache=True)
            m = re.fullmatch(r"/alerts/fonts/([a-z0-9-]+\.woff2)", path)
            if m and os.path.isfile(os.path.join(FONTS, m.group(1))):
                with open(os.path.join(FONTS, m.group(1)), "rb") as f:
                    return self._send(f.read(), "font/woff2", cache=True)
        except OSError:
            pass
        self.send_error(404)


def start():
    """Opens the alerts page's address (once). Tries the same port as last time first."""
    global _server, _port
    if _server:
        return _port
    saved = settings.load().get("lv_ov_port")
    order = ([saved] if saved in PORTS else []) + [p for p in PORTS if p != saved]
    for port in order:
        try:
            _server = ThreadingHTTPServer(("127.0.0.1", port), _Handler)
        except OSError:
            continue
        _server.daemon_threads = True
        _port = port
        threading.Thread(target=_server.serve_forever, daemon=True).start()
        if saved != port:
            settings.save(lv_ov_port=port)
        return port
    return 0


def url():
    port = start()
    return f"http://127.0.0.1:{port}/alerts" if port else ""


def status():
    return {"url": url(), "prefs": prefs(), "kinds": {k: {"name": v["name"], "emoji": v["emoji"], "text": v["text"]} for k, v in KINDS.items()},
            "sounds": list(SOUNDS), "watching": time.time() - _seen < 10}


# ---------------------------------------------------------------- putting it in OBS

SOURCE = "VaultHub alerts"


def add_to_obs():
    """Adds the alerts page to OBS as a Browser Source, in every scene (or fixes its address if it's there)."""
    import obsctl
    link = url()
    if not link:
        raise obsctl.Error("VaultHub couldn't open the alerts page. Close other programs using ports 17771-17780.")
    look = {"url": link, "width": 1920, "height": 1080, "reroute_audio": True, "shutdown": False, "restart_when_active": False,
            "css": "body { background-color: rgba(0, 0, 0, 0); margin: 0; overflow: hidden; }"}
    scenes = [s.get("sceneName") for s in (obsctl.ask_once("GetSceneList").get("scenes") or []) if s.get("sceneName")]
    if not scenes:
        raise obsctl.Error("OBS has no scenes yet. Make one in OBS first.")
    inputs = [i.get("inputName") for i in (obsctl.ask_once("GetInputList").get("inputs") or [])]
    if SOURCE in inputs:
        obsctl.ask_once("SetInputSettings", {"inputName": SOURCE, "inputSettings": look, "overlay": True})
        first = None
    else:
        first = scenes[0]
        obsctl.ask_once("CreateInput", {"sceneName": first, "inputName": SOURCE, "inputKind": "browser_source",
                                        "inputSettings": look, "sceneItemEnabled": True})
    added = 0
    for scene in scenes:
        if scene == first:
            added += 1
            continue
        items = obsctl.ask_once("GetSceneItemList", {"sceneName": scene}).get("sceneItems") or []
        if any(i.get("sourceName") == SOURCE for i in items):
            continue
        try:
            obsctl.ask_once("CreateSceneItem", {"sceneName": scene, "sourceName": SOURCE, "sceneItemEnabled": True})
            added += 1
        except obsctl.Error:
            pass
    return {"scenes": len(scenes), "added": added}
