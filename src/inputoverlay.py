"""(3.2) The input overlay: your keys, mouse and controller on your stream, as an OBS Browser Source.

The page lives next to the alerts (http://127.0.0.1:17771/input, see streamoverlay.py). While OBS (or the
preview in VaultHub) has it open, a small loop here looks at which keys, mouse buttons and controller buttons
are down, about 60 times a second, and sends that to the page. Nobody watching: nothing is read.

It reads with GetAsyncKeyState (like most key overlays) and XInput for controllers. It never hooks into games.
Only pages on this PC can read it: the address answers only to 127.0.0.1 and has no "any website" header.
"""

import ctypes
import json
import re
import threading
import time

import settings

STYLES = ("caps", "glass", "line", "pad", "pops")
CORNERS = ("bl", "br", "tl", "tr")
COLORS = ("auto", "#ffcf3f", "#ffffff", "#b495ff", "#ff7ab8", "#5ee38f", "#5cc8ff", "#ff9a52")
DEFAULTS = {"style": "caps", "color": "auto", "size": 100, "corner": "bl", "fade": True, "kps": False, "pad": "xbox"}

# Windows key codes -> the name on the key. Left and right Shift/Ctrl/Alt are one key on the overlay.
KEYS = {0x01: "LMB", 0x02: "RMB", 0x04: "MMB", 0x05: "Mouse 4", 0x06: "Mouse 5",
        0x08: "Backspace", 0x09: "Tab", 0x0D: "Enter", 0x13: "Pause", 0x14: "Caps", 0x1B: "Esc", 0x20: "Space",
        0x21: "Page up", 0x22: "Page down", 0x23: "End", 0x24: "Home", 0x25: "←", 0x26: "↑", 0x27: "→", 0x28: "↓",
        0x2C: "Print", 0x2D: "Insert", 0x2E: "Delete", 0x5B: "Win", 0x5C: "Win", 0x5D: "Menu",
        0xA0: "Shift", 0xA1: "Shift", 0xA2: "Ctrl", 0xA3: "Ctrl", 0xA4: "Alt", 0xA5: "Alt",
        0xBA: ";", 0xBB: "=", 0xBC: ",", 0xBD: "-", 0xBE: ".", 0xBF: "/", 0xC0: "`", 0xDB: "[", 0xDC: "\\", 0xDD: "]", 0xDE: "'"}
KEYS.update({c: chr(c) for c in range(0x30, 0x3A)})  # 0-9
KEYS.update({c: chr(c) for c in range(0x41, 0x5B)})  # A-Z
KEYS.update({0x60 + i: f"Num {i}" for i in range(10)})
KEYS.update({0x70 + i: f"F{i + 1}" for i in range(24)})
VKS = tuple(KEYS)

# XInput buttons -> names (the page draws them as Xbox or PlayStation buttons)
PAD_BUTTONS = {0x0001: "Up", 0x0002: "Down", 0x0004: "Left", 0x0008: "Right", 0x0010: "Start", 0x0020: "Back",
               0x0040: "LS", 0x0080: "RS", 0x0100: "LB", 0x0200: "RB", 0x1000: "A", 0x2000: "B", 0x4000: "X", 0x8000: "Y"}

_lock = threading.Lock()
_cond = threading.Condition(_lock)
_state = {"seq": 0, "keys": [], "pad": None}
_watchers = 0  # pages open right now (OBS and the preview)
_obs = 0  # of those, the ones in OBS (not the preview)
_seen = 0.0
_thread = None
_prefs_seq = 0


# ---------------------------------------------------------------- settings

def prefs():
    saved = settings.load().get("lv_in")
    saved = saved if isinstance(saved, dict) else {}
    p = {k: saved.get(k, v) for k, v in DEFAULTS.items()}
    if p["style"] not in STYLES:
        p["style"] = DEFAULTS["style"]
    if p["corner"] not in CORNERS:
        p["corner"] = DEFAULTS["corner"]
    if p["color"] not in COLORS:
        p["color"] = "auto"
    if p["pad"] not in ("xbox", "ps"):
        p["pad"] = "xbox"
    try:
        p["size"] = max(50, min(150, int(p["size"])))
    except (TypeError, ValueError):
        p["size"] = 100
    p["fade"], p["kps"] = bool(p["fade"]), bool(p["kps"])
    return p


def set_prefs(data):
    global _prefs_seq
    p = prefs()
    for key, ok in (("style", STYLES), ("corner", CORNERS), ("color", COLORS), ("pad", ("xbox", "ps"))):
        if key in data and str(data[key]) in ok:
            p[key] = str(data[key])
    if "size" in data:
        try:
            p["size"] = max(50, min(150, int(data["size"])))
        except (TypeError, ValueError):
            pass
    for key in ("fade", "kps"):
        if key in data:
            p[key] = bool(data[key])
    settings.save(lv_in=p)
    with _cond:
        _prefs_seq += 1
        _cond.notify_all()
    return p


# ---------------------------------------------------------------- reading the keys (Windows)

class _Pad(ctypes.Structure):
    _fields_ = [("buttons", ctypes.c_ushort), ("lt", ctypes.c_ubyte), ("rt", ctypes.c_ubyte),
                ("lx", ctypes.c_short), ("ly", ctypes.c_short), ("rx", ctypes.c_short), ("ry", ctypes.c_short)]


class _PadState(ctypes.Structure):
    _fields_ = [("packet", ctypes.c_uint), ("pad", _Pad)]


def _xinput():
    for name in ("xinput1_4", "xinput1_3", "xinput9_1_0"):
        try:
            return getattr(ctypes.windll, name).XInputGetState
        except (OSError, AttributeError):
            continue
    return None


def _stick(x, y):
    """-1..1, with a small dead zone so a resting stick sits still. Up is negative (like the screen)."""
    def one(v):
        v = v / 32767.0
        return 0.0 if abs(v) < 0.14 else round(max(-1.0, min(1.0, v)), 2)
    return [one(x), -one(y)]


def read_pad(get_state, slot):
    st = _PadState()
    if get_state(slot, ctypes.byref(st)) != 0:
        return None
    p = st.pad
    return {"slot": slot, "buttons": [n for bit, n in PAD_BUTTONS.items() if p.buttons & bit],
            "lt": round(p.lt / 255, 2), "rt": round(p.rt / 255, 2), "ls": _stick(p.lx, p.ly), "rs": _stick(p.rx, p.ry)}


def _loop():
    """Runs while someone watches the page. Stops by itself a few seconds after the last one leaves."""
    global _thread
    try:
        user32 = ctypes.windll.user32
        down = user32.GetAsyncKeyState
        down.restype = ctypes.c_short
    except (AttributeError, OSError):  # not Windows: nothing to read
        with _lock:
            _thread = None
        return
    get_state = _xinput()
    slot, next_look = None, 0.0
    idle_since = None
    while True:
        now = time.time()
        with _lock:
            if _watchers <= 0 and now - _seen > 5:
                idle_since = idle_since or now
                if now - idle_since > 3:
                    _thread = None
                    return
            else:
                idle_since = None
        keys = sorted({KEYS[vk] for vk in VKS if down(vk) & 0x8000})
        pad = None
        if get_state:
            if slot is not None:
                pad = read_pad(get_state, slot)
                if pad is None:
                    slot = None
            if slot is None and now >= next_look:  # looking for a controller is slow when none is there: every 2 s
                next_look = now + 2
                for s in range(4):
                    pad = read_pad(get_state, s)
                    if pad:
                        slot = s
                        break
        with _cond:
            if keys != _state["keys"] or pad != _state["pad"]:
                _state.update(seq=_state["seq"] + 1, keys=keys, pad=pad)
                _cond.notify_all()
        time.sleep(1 / 60)


def _wake():
    global _thread
    with _lock:
        if _thread is None:
            _thread = threading.Thread(target=_loop, daemon=True, name="input-overlay")
            _thread.start()


def snapshot():
    with _lock:
        return {"seq": _state["seq"], "keys": list(_state["keys"]), "pad": _state["pad"]}


def status():
    import streamoverlay
    port = streamoverlay.start()
    with _lock:
        pad = _state["pad"]
        watching = _obs > 0 or time.time() - _seen < 10
    return {"url": f"http://127.0.0.1:{port}/input" if port else "", "prefs": prefs(), "watching": watching,
            "pad": bool(pad), "windows": hasattr(ctypes, "windll")}


# ---------------------------------------------------------------- the page and its live feed

def local_host(host, port):
    """Only pages opened as 127.0.0.1/localhost may read the keys (stops a website from reaching them
    through a DNS trick)."""
    return bool(re.fullmatch(rf"(127\.0\.0\.1|localhost)(:{port})?", (host or "").strip().lower()))


def stream(handler, preview=False):
    """Server-sent events: one line of JSON each time something changes, and the look when it changes."""
    global _watchers, _obs, _seen
    handler.send_response(200)
    handler.send_header("Content-Type", "text/event-stream")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("X-Accel-Buffering", "no")
    handler.end_headers()
    with _lock:
        _watchers += 1
        _obs += 0 if preview else 1
    _wake()
    sent, sent_prefs, last_beat = -1, -1, 0.0
    try:
        while True:
            with _cond:
                _cond.wait_for(lambda: _state["seq"] != sent or _prefs_seq != sent_prefs, timeout=5)
                st = {"seq": _state["seq"], "keys": list(_state["keys"]), "pad": _state["pad"]}
                pseq = _prefs_seq
            out = b""
            if pseq != sent_prefs:
                out += b"event: look\ndata: " + json.dumps(prefs()).encode() + b"\n\n"
                sent_prefs = pseq
            if st["seq"] != sent:
                out += b"data: " + json.dumps(st).encode() + b"\n\n"
                sent = st["seq"]
            now = time.time()
            if not out and now - last_beat > 4:
                out = b": hi\n\n"
            if out:
                handler.wfile.write(out)
                handler.wfile.flush()
                last_beat = now
            if not preview:
                _seen = now
    except (OSError, ValueError):  # the page went away
        pass
    finally:
        with _lock:
            _watchers -= 1
            _obs -= 0 if preview else 1
        if not preview:
            _seen = time.time()


# ---------------------------------------------------------------- putting it in OBS

SOURCE = "VaultHub input overlay"


def add_to_obs():
    """Adds the page to OBS as a Browser Source in every scene (or fixes its address if it's there)."""
    import obsctl
    link = status()["url"]
    if not link:
        raise obsctl.Error("VaultHub couldn't open the overlay page. Close other programs using ports 17771-17780.")
    look = {"url": link, "width": 1920, "height": 1080, "shutdown": False, "restart_when_active": False,
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
