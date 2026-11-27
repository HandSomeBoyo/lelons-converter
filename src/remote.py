"""Remote desktop (2.37.0): use your own PCs from anywhere, with your mouse, keyboard and sound.

Only the owner can use it, and only between PCs signed in to the owner's account (lelons_remote in
sfx/setup.sql checks both). The server only passes short notes so the PCs can find each other; the
picture, sound, mouse and keys go straight from PC to PC, locked (WebRTC). On top of that:

- Each PC has its own keys (made in the page, kept where the page can't read them). A PC that sends
  its screen only lets in PCs that were allowed ON THAT PC, after checking a 6-digit code that both
  PCs work out from the locked connection itself. So nobody can sneak in, not even through our server.
- An optional PIN, checked here, with a growing wait after wrong tries.
- While it's being controlled the PC shows a yellow frame and bar (not sent in the picture), and
  Ctrl+Alt+End stops it right away. Keys and buttons still held are let go when it ends.

This file keeps what this PC allows (remote.json in DATA_DIR), runs the hidden screen sender
(appwindow.engine with ui/remote-host.html), and moves the mouse and presses keys (SendInput).
"""

import ctypes
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
import uuid

import settings

STORE = "remote.json"
_lock = threading.RLock()
_state = {
    "session": None,  # {"peer": name, "device": id, "since": time, "screen": n} while someone controls this PC
    "stop": False,  # the Stop button or Ctrl+Alt+End: the sender page ends it
    "asking": None,  # {"id", "name", "device", "code", "key", "at"}: a new PC wants in; the app asks you
    "answer": {},  # id -> True / False once you answered
    "nonces": {},  # (2.37.1) nonce -> time: hellos already used, kept while the app runs (the sender restarts)
    "screen": 0,  # (2.37.1) which screen the sender shows
    "engine": "",  # the switches the sender runs with (which screen)
}
_held_keys = set()
_held_buttons = set()


KEY_VERSION = 2  # (2.38.1) keys kept in remote.json (see _this_pc)


class Error(Exception):
    pass


# ---- what this PC remembers

def _path():
    return os.path.join(settings.DATA_DIR, STORE)


def _load():
    try:
        with open(_path(), encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data
    except (OSError, ValueError):
        pass
    return {}


def _save(data):
    os.makedirs(settings.DATA_DIR, exist_ok=True)
    tmp = _path() + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.replace(tmp, _path())


def _this_pc():
    with _lock:
        data = _load()
        if not data.get("device"):
            data["device"] = str(uuid.uuid4())
            data["name"] = (os.environ.get("COMPUTERNAME", "").title() or "My PC")[:40]
            data["kind"] = "laptop" if _has_battery() else "desktop"
            data.setdefault("host", False)
            data.setdefault("allowed", {})
            data.setdefault("hosts", {})
            data.setdefault("lockOnEnd", False)
            data.setdefault("keepAwake", True)
            data["keyVersion"] = KEY_VERSION
            _save(data)
        if data.get("keyVersion") != KEY_VERSION:
            # (2.38.1) The keys used to live in the page's own storage, which belongs to the app's address,
            # and the address (its port) is new each time VaultHub starts: so every restart made new keys
            # and the other PC said "key changed". Now they're kept here. What was paired with the old
            # keys can't be used any more, so it's forgotten once and each PC is allowed again.
            data["keys"], data["hosts"], data["allowed"] = {}, {}, {}
            data["keyVersion"] = KEY_VERSION
            _save(data)
        return data


def info():
    """What the Remote page shows about this PC (no secrets)."""
    data = _this_pc()
    allowed = [{"key": k, "name": v.get("name", "PC"), "device": v.get("device", ""), "added": v.get("added", 0),
                "last": v.get("last", 0)} for k, v in (data.get("allowed") or {}).items()]
    allowed.sort(key=lambda a: a["added"])
    session = _state["session"]
    return {"device": data["device"], "name": data["name"], "kind": data.get("kind", "desktop"),
            "host": bool(data.get("host")), "allowed": allowed, "pin": bool(data.get("pin")),
            "pinSalt": (data.get("pin") or {}).get("salt", ""),
            "lockOnEnd": bool(data.get("lockOnEnd")), "keepAwake": data.get("keepAwake", True) is not False,
            "hosts": data.get("hosts") or {}, "screens": len(monitors()) or 1,
            "session": dict(session) if session else None, "asking": _asking_public(),
            "windows": os.name == "nt"}


def _asking_public():
    a = _state["asking"]
    if a and time.time() - a["at"] > 120:
        _state["asking"] = a = None
    return {k: a[k] for k in ("id", "name", "code")} if a else None


def set_options(opts):
    with _lock:
        data = _this_pc()
        if "name" in opts:
            name = str(opts["name"] or "").strip()[:40]
            if name:
                data["name"] = name
        for key in ("host", "lockOnEnd", "keepAwake"):
            if key in opts:
                data[key] = bool(opts[key])
        if "pin" in opts:
            pin = str(opts["pin"] or "")
            if not pin:
                data.pop("pin", None)
            elif not 4 <= len(pin) <= 64:  # (3.3) a real password now: letters, numbers, anything
                raise Error("A password is 4 to 64 characters.")
            else:
                salt = secrets.token_hex(16)
                data["pin"] = {"salt": salt, "hash": _pin_hash(pin, salt)}
                data.pop("pinFails", None)
                data.pop("pinWait", None)
        if "forget" in opts:  # take a PC off "who can control this PC"
            (data.get("allowed") or {}).pop(str(opts["forget"]), None)
        if opts.get("forgetAll"):
            data["allowed"] = {}
        _save(data)
    awake()
    return info()


# ---- a PC that wants in for the first time: you allow it here, on this PC

def ask(name, device, key, code):
    """The sender page got a first-time knock (code checked on both PCs). Shows the question in the app."""
    with _lock:
        if not isinstance(code, str) or len(code) != 6 or not code.isdigit():
            raise Error("bad code")
        ask_id = secrets.token_hex(8)
        _state["asking"] = {"id": ask_id, "name": str(name or "PC")[:40], "device": str(device or "")[:40],
                            "key": str(key or "")[:400], "code": code, "at": time.time()}
        return ask_id


def answer(ask_id, yes):
    """You pressed Allow or Don't allow in the app."""
    with _lock:
        a = _state["asking"]
        if not a or a["id"] != ask_id:
            return False
        _state["asking"] = None
        _state["answer"][ask_id] = bool(yes)
        if yes and a["key"]:
            data = _this_pc()
            data.setdefault("allowed", {})[a["key"]] = {"name": a["name"], "device": a["device"],
                                                        "added": time.time(), "last": 0}
            _save(data)
        return True


def answered(ask_id):
    """For the sender page: None (still asking), True or False."""
    with _lock:
        if ask_id in _state["answer"]:
            return _state["answer"].pop(ask_id)
        a = _state["asking"]
        if not a or a["id"] != ask_id or time.time() - a["at"] > 120:
            return False
        return None


def allowed(key):
    return bool(key) and key in (_this_pc().get("allowed") or {})


def key(role, pub=None, priv=None):
    """(2.38.1) This PC's own key for a role ("ctrl" on the Remote page, "host" in the hidden sender).
    The page makes it the first time and hands it over; it's kept locked with Windows' DPAPI (only your
    Windows account on this PC can open it). Returns the kept one: {"pub", "priv"} or {}."""
    role = "host" if role == "host" else "ctrl"
    with _lock:
        data = _this_pc()
        keys = data.setdefault("keys", {})
        kept = keys.get(role)
        if not kept and isinstance(pub, str) and isinstance(priv, str) and 60 < len(pub) < 400 and 60 < len(priv) < 1000:
            kept = keys[role] = {"pub": pub, "priv": settings.lock_secret(priv)}
            _save(data)
        if not kept:
            return {}
        opened = settings.open_secret(kept.get("priv", ""))
        if not opened:  # (from another PC or Windows account: make a new one)
            del keys[role]
            _save(data)
            return {}
        return {"pub": kept["pub"], "priv": opened}


def forget_host(device):
    """(3.0) A PC taken off your list: forget the key kept for it too, so it can be added again."""
    with _lock:
        data = _this_pc()
        if (data.get("hosts") or {}).pop(str(device)[:40], None) is not None:
            _save(data)


def remember_host(device, key):
    """The controlling side: the first time you connect to a PC, its key is kept, and next time it must match."""
    with _lock:
        data = _this_pc()
        data.setdefault("hosts", {})[str(device)[:40]] = str(key)[:400]
        _save(data)


# ---- the PIN

def _pin_hash(pin, salt):
    return hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(salt), 200_000).hex()


def pin_check(pin=None, proof=None, bound="", newcomer=None):
    """True when right. After 5 wrong tries it waits 1 minute, then longer each time.

    (3.3) The other PC doesn't send the password itself any more, only `proof`: a stamp made from it and
    this exact connection (`bound`), so it's useless anywhere else. Older versions still send `pin`.
    `newcomer` ({"key", "name", "device"}): a PC connecting for the first time. The right password lets
    it in without anyone pressing Allow here, and it's remembered like after Allow."""
    with _lock:
        data = _this_pc()
        stored = data.get("pin")
        if not stored:
            return {"ok": True}
        wait = data.get("pinWait", 0) - time.time()
        if wait > 0:
            return {"ok": False, "wait": int(wait) + 1}
        if isinstance(proof, str) and bound:
            want = hmac.new(bytes.fromhex(stored["hash"]), str(bound).encode(), hashlib.sha256).hexdigest()
            good = secrets.compare_digest(want, proof.lower()[:64])
        else:
            good = secrets.compare_digest(_pin_hash(str(pin or "")[:64], stored["salt"]), stored["hash"])
        if good:
            data.pop("pinFails", None)
            if newcomer and newcomer.get("key"):
                key = str(newcomer["key"])[:400]
                data.setdefault("allowed", {})[key] = {"name": str(newcomer.get("name") or "PC")[:40],
                                                       "device": str(newcomer.get("device") or "")[:40],
                                                       "added": time.time(), "last": 0}
                a = _state["asking"]
                if a and a["key"] == key:  # close the Allow question: the password answered it
                    _state["asking"] = None
                    _state["answer"][a["id"]] = True
            _save(data)
            return {"ok": True}
        fails = data.get("pinFails", 0) + 1
        data["pinFails"] = fails
        if fails >= 5:
            data["pinWait"] = time.time() + 60 * 2 ** min(fails - 5, 8)
        _save(data)
        return {"ok": False, "left": max(0, 5 - fails)}


# ---- someone is controlling this PC

def start(peer_key, peer_name, screen=0):
    with _lock:
        if not allowed(peer_key):
            raise Error("not allowed")
        data = _this_pc()
        data["allowed"][peer_key]["last"] = time.time()
        _save(data)
        _state["session"] = {"peer": str(peer_name or "PC")[:40], "since": time.time(), "screen": int(screen or 0)}
        _state["stop"] = False
    _overlay_show(_state["session"]["peer"])
    threading.Thread(target=_full_speed_while_used, daemon=True).start()
    cursor_hide(True)
    return True


def end(reason=""):
    """It ended (the other PC left, the connection dropped, Stop or Ctrl+Alt+End)."""
    with _lock:
        was = _state["session"]
        _state["session"] = None
        _state["stop"] = False
    _let_go()
    _overlay_hide()
    cursor_hide(False)
    if reason != "screen":
        resolution_back()
    if was and _this_pc().get("lockOnEnd") and os.name == "nt":
        try:
            ctypes.windll.user32.LockWorkStation()
        except OSError:
            pass
    return bool(was)


def stop_now():
    """The Stop button on the bar, or Ctrl+Alt+End."""
    with _lock:
        if _state["session"]:
            _state["stop"] = True
    _let_go()
    _overlay_hide()
    cursor_hide(False)
    resolution_back()


def host_state():
    """For the sender page, a few times a second while connected."""
    return {"stop": _state["stop"], "session": bool(_state["session"]), "battery": on_battery(), "cur": cursor_shape()}


# ---- (3.4.1) the instant mouse
# The mouse in the picture is always a bit behind (it has to be filmed, squeezed, sent and unpacked).
# So while someone controls this PC, its own mouse arrow is made see-through (it's left out of the
# picture), and the other PC shows its own arrow instead, which moves the moment you move. This PC
# tells it which arrow to show (normal, text, hand...). Windows' own arrows come back at the end.

OCR = {32512: "default", 32513: "text", 32514: "wait", 32515: "crosshair", 32516: "default", 32642: "nwse-resize",
       32643: "nesw-resize", 32644: "ew-resize", 32645: "ns-resize", 32646: "move", 32648: "not-allowed",
       32649: "pointer", 32650: "progress", 32651: "help"}
_cursor = {"hidden": False, "shapes": None}


def cursor_hide(on):
    """See-through arrows on (while controlled, not in Game mode) or Windows' own arrows back."""
    if os.name != "nt" or bool(on) == _cursor["hidden"]:
        return
    user32 = ctypes.windll.user32
    try:
        if on:
            if _cursor["shapes"] is None:  # the shared handles of Windows' arrows, before they're swapped
                user32.LoadCursorW.restype = ctypes.c_void_p
                user32.LoadCursorW.argtypes = (ctypes.c_void_p, ctypes.c_void_p)
                _cursor["shapes"] = {user32.LoadCursorW(None, i): name for i, name in OCR.items()}
            user32.CreateCursor.restype = ctypes.c_void_p
            user32.CreateCursor.argtypes = (ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                                            ctypes.c_void_p, ctypes.c_void_p)
            user32.SetSystemCursor.argtypes = (ctypes.c_void_p, ctypes.c_uint32)
            and_mask = (ctypes.c_ubyte * 128)(*([0xFF] * 128))  # 32x32: keep what's under it...
            xor_mask = (ctypes.c_ubyte * 128)()  # ...and draw nothing
            for i in OCR:
                blank = user32.CreateCursor(None, 0, 0, 32, 32, and_mask, xor_mask)
                if blank:
                    user32.SetSystemCursor(blank, i)  # Windows owns (and frees) the blank one now
            _cursor["hidden"] = True
        else:
            _cursor["hidden"] = False
            user32.SystemParametersInfoW(0x57, 0, None, 0)  # SPI_SETCURSORS: Windows' own arrows again
    except (OSError, AttributeError):
        pass


def cursor_restore_on_start():
    """If VaultHub was closed in the middle of a session, give Windows its arrows (and screen size) back."""
    if os.name == "nt":
        try:
            ctypes.windll.user32.SystemParametersInfoW(0x57, 0, None, 0)
            if _this_pc().get("resChanged"):
                ctypes.windll.user32.ChangeDisplaySettingsExW(None, None, None, 0, None)  # every screen as set in Windows
                with _lock:
                    data = _this_pc()
                    data.pop("resChanged", None)
                    _save(data)
        except OSError:
            pass


def cursor_shape():
    """Which arrow this PC shows now, as a CSS cursor name ("none" when the app hid it, e.g. a video)."""
    if os.name != "nt" or not _state["session"]:
        return ""

    class CURSORINFO(ctypes.Structure):
        _fields_ = [("cbSize", ctypes.c_uint32), ("flags", ctypes.c_uint32), ("hCursor", ctypes.c_void_p),
                    ("x", ctypes.c_long), ("y", ctypes.c_long)]

    ci = CURSORINFO(cbSize=ctypes.sizeof(CURSORINFO))
    try:
        if not ctypes.windll.user32.GetCursorInfo(ctypes.byref(ci)):
            return ""
    except OSError:
        return ""
    if not ci.flags:  # hidden by the app (CURSOR_SUPPRESSED = touch, still counts as there)
        return "none"
    return (_cursor["shapes"] or {}).get(ci.hCursor, "default")


def on_battery():
    """(3.1.2) True on a laptop running on its battery (Windows slows it down then)."""
    if os.name != "nt":
        return False

    class POWER(ctypes.Structure):
        _fields_ = [("ac", ctypes.c_ubyte), ("flag", ctypes.c_ubyte), ("percent", ctypes.c_ubyte),
                    ("saver", ctypes.c_ubyte), ("life", ctypes.c_ulong), ("full", ctypes.c_ulong)]
    p = POWER()
    try:
        return bool(ctypes.windll.kernel32.GetSystemPowerStatus(ctypes.byref(p))) and p.ac == 0
    except OSError:
        return False


def _our_processes():
    """This app and everything it started (the WebView2 windows and their helpers)."""
    from ctypes import wintypes

    class ENTRY(ctypes.Structure):
        _fields_ = [("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD), ("th32ProcessID", wintypes.DWORD),
                    ("th32DefaultHeapID", ctypes.c_void_p), ("th32ModuleID", wintypes.DWORD),
                    ("cntThreads", wintypes.DWORD), ("th32ParentProcessID", wintypes.DWORD),
                    ("pcPriClassBase", ctypes.c_long), ("dwFlags", wintypes.DWORD), ("szExeFile", ctypes.c_wchar * 260)]
    k32 = ctypes.windll.kernel32
    k32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    snap = k32.CreateToolhelp32Snapshot(0x2, 0)  # TH32CS_SNAPPROCESS
    if not snap or snap == wintypes.HANDLE(-1).value:
        return set()
    parents = {}
    try:
        e = ENTRY()
        e.dwSize = ctypes.sizeof(ENTRY)
        ok = k32.Process32FirstW(snap, ctypes.byref(e))
        while ok:
            parents[e.th32ProcessID] = e.th32ParentProcessID
            ok = k32.Process32NextW(snap, ctypes.byref(e))
    finally:
        k32.CloseHandle(snap)
    ours = {os.getpid()}
    grew = True
    while grew:
        grew = False
        for pid, parent in parents.items():
            if parent in ours and pid not in ours:
                ours.add(pid)
                grew = True
    return ours


def _full_speed(on):
    """(3.1.2) While someone uses this PC: tell Windows not to slow VaultHub down (no "efficiency mode" /
    power throttling, a bit higher priority), so the picture keeps up, also on a laptop's battery."""
    if os.name != "nt":
        return

    class THROTTLE(ctypes.Structure):
        _fields_ = [("Version", ctypes.c_ulong), ("ControlMask", ctypes.c_ulong), ("StateMask", ctypes.c_ulong)]
    k32 = ctypes.windll.kernel32
    k32.OpenProcess.restype = ctypes.c_void_p
    # ControlMask EXECUTION_SPEED (1): StateMask 0 = never throttle; ControlMask 0 = let Windows decide again.
    state = THROTTLE(1, 1 if on else 0, 0)
    prio = 0x8000 if on else 0x20  # ABOVE_NORMAL / NORMAL
    try:
        pids = _our_processes()
    except OSError:
        return
    for pid in pids:
        h = k32.OpenProcess(0x0200 | 0x1000, False, pid)  # PROCESS_SET_INFORMATION | QUERY_LIMITED
        if not h:
            continue
        try:
            k32.SetProcessInformation(ctypes.c_void_p(h), 4, ctypes.byref(state), ctypes.sizeof(state))  # ProcessPowerThrottling
            k32.SetPriorityClass(ctypes.c_void_p(h), prio)
        except (OSError, AttributeError):
            pass
        finally:
            k32.CloseHandle(ctypes.c_void_p(h))


def _full_speed_while_used():
    """Keeps it on while the session lasts (new helper processes can appear), then lets go."""
    try:
        while _state["session"]:
            _full_speed(True)
            for _ in range(10):
                if not _state["session"]:
                    break
                time.sleep(1)
    finally:
        _full_speed(False)


# ---- the hidden sender

def engine_args(screen=0):
    count = len(monitors()) or 1
    screen = max(0, min(int(screen or 0), count - 1))
    title = "Entire screen" if count == 1 else f"Screen {screen + 1}"
    return " ".join([
        "--lang=en-US",  # (the switch below matches the screen's English name)
        f'"--auto-select-desktop-capture-source={title}"',
        "--disable-background-timer-throttling",
        # (3.1.2) UseEcoQoSForBackgroundProcess: Windows 11's "efficiency mode" for hidden windows slowed
        # the picture down to a few frames a second on a laptop.
        "--disable-features=IntensiveWakeUpThrottling,CalculateNativeWinOcclusion,UseEcoQoSForBackgroundProcess",
        "--disable-renderer-backgrounding",
        "--autoplay-policy=no-user-gesture-required",  # (3.0) the PC's sound plays in a hidden window
        # (3.1.2) Let the graphics card make H.264 pictures in more cases (much faster than the processor).
        "--enable-features=MediaFoundationH264CbpEncoding",
    ])


def nonce_fresh(nonce):
    """(2.37.1) True the first time a signed hello is seen. Kept here, not in the sender page, so a hello
    from before a screen switch isn't answered again by the sender that starts after it."""
    nonce = str(nonce or "")[:64]
    if len(nonce) < 16:
        return False
    now = time.time()
    with _lock:
        seen = _state["nonces"]
        for n in [n for n, at in seen.items() if now - at > 300]:
            del seen[n]
        if nonce in seen:
            return False
        seen[nonce] = now
        return True


def run_engine(url, icon, screen=None):
    """Start (or stop) the hidden sender to match the "let my other PCs control this one" switch."""
    import appwindow
    data = _this_pc()
    folder = os.path.join(settings.DATA_DIR, "webview-remote")
    if not data.get("host"):
        _state["engine"] = ""
        # (3.0) Turned off while someone was using it: end that properly (the yellow frame, held keys,
        # and "in use" on your other PCs), since the hidden sender is closed without saying goodbye.
        if _state["session"]:
            end("off")
        appwindow.engine(url, folder, icon, "", close=True)
        return False
    if screen is not None:
        _state["screen"] = int(screen or 0)
    args = engine_args(_state["screen"])
    _state["engine"] = args
    return appwindow.engine(url, folder, icon, args)


def awake():
    """Keep the PC from going to sleep while others may want to reach it (ES_CONTINUOUS | ES_SYSTEM_REQUIRED)."""
    if os.name != "nt":
        return
    data = _this_pc()
    on = data.get("host") and data.get("keepAwake", True) is not False
    try:
        ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | (0x1 if on else 0))
    except OSError:
        pass


# ---- the screens, the mouse and the keys (Windows)

def monitors():
    """[(left, top, right, bottom)] main screen first, like the screen picker counts them."""
    if os.name != "nt":
        return []
    from ctypes import wintypes
    found = []

    class MONITORINFO(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT), ("rcWork", wintypes.RECT),
                    ("dwFlags", wintypes.DWORD)]

    proc_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HMONITOR, wintypes.HDC, ctypes.POINTER(wintypes.RECT),
                                   wintypes.LPARAM)

    def each(handle, dc, rect, data):
        mi = MONITORINFO(cbSize=ctypes.sizeof(MONITORINFO))
        ctypes.windll.user32.GetMonitorInfoW(handle, ctypes.byref(mi))
        r = mi.rcMonitor
        found.append(((r.left, r.top, r.right, r.bottom), bool(mi.dwFlags & 1)))
        return True

    try:
        ctypes.windll.user32.EnumDisplayMonitors(None, None, proc_type(each), 0)
    except OSError:
        return []
    found.sort(key=lambda m: not m[1])  # the main screen first
    return [m[0] for m in found]


# ---- (3.4.1) the screen's resolution while you control it
# A big screen (4K, ultrawide) looks tiny on a laptop. You can pick a smaller resolution for that screen
# while you're connected: everything gets bigger and the picture gets smoother (fewer pixels to send).
# Only for now: Windows puts its own resolution back when you disconnect (or when VaultHub starts again).

class _DEVMODEW(ctypes.Structure):
    _fields_ = [("dmDeviceName", ctypes.c_wchar * 32), ("dmSpecVersion", ctypes.c_ushort),
                ("dmDriverVersion", ctypes.c_ushort), ("dmSize", ctypes.c_ushort), ("dmDriverExtra", ctypes.c_ushort),
                ("dmFields", ctypes.c_uint32), ("dmPositionX", ctypes.c_long), ("dmPositionY", ctypes.c_long),
                ("dmDisplayOrientation", ctypes.c_uint32), ("dmDisplayFixedOutput", ctypes.c_uint32),
                ("dmColor", ctypes.c_short), ("dmDuplex", ctypes.c_short), ("dmYResolution", ctypes.c_short),
                ("dmTTOption", ctypes.c_short), ("dmCollate", ctypes.c_short), ("dmFormName", ctypes.c_wchar * 32),
                ("dmLogPixels", ctypes.c_ushort), ("dmBitsPerPel", ctypes.c_uint32), ("dmPelsWidth", ctypes.c_uint32),
                ("dmPelsHeight", ctypes.c_uint32), ("dmDisplayFlags", ctypes.c_uint32),
                ("dmDisplayFrequency", ctypes.c_uint32), ("dmICMMethod", ctypes.c_uint32),
                ("dmICMIntent", ctypes.c_uint32), ("dmMediaType", ctypes.c_uint32), ("dmDitherType", ctypes.c_uint32),
                ("dmReserved1", ctypes.c_uint32), ("dmReserved2", ctypes.c_uint32),
                ("dmPanningWidth", ctypes.c_uint32), ("dmPanningHeight", ctypes.c_uint32)]


_res = {"changed": set()}  # the screens (Windows' device names) we changed


def _screen_device(screen):
    """Windows' name for screen N (\\\\.\\DISPLAY1...), counted like monitors()."""
    if os.name != "nt":
        return ""
    from ctypes import wintypes
    found = []

    class MONITORINFOEXW(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT), ("rcWork", wintypes.RECT),
                    ("dwFlags", wintypes.DWORD), ("szDevice", ctypes.c_wchar * 32)]

    proc_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HMONITOR, wintypes.HDC, ctypes.POINTER(wintypes.RECT),
                                   wintypes.LPARAM)

    def each(handle, dc, rect, data):
        mi = MONITORINFOEXW(cbSize=ctypes.sizeof(MONITORINFOEXW))
        ctypes.windll.user32.GetMonitorInfoW(handle, ctypes.byref(mi))
        found.append((mi.szDevice, bool(mi.dwFlags & 1)))
        return True

    try:
        ctypes.windll.user32.EnumDisplayMonitors(None, None, proc_type(each), 0)
    except OSError:
        return ""
    found.sort(key=lambda m: not m[1])  # the main screen first
    return found[screen][0] if 0 <= screen < len(found) else ""


def _mode(device, i):
    dm = _DEVMODEW(dmSize=ctypes.sizeof(_DEVMODEW))
    user32 = ctypes.windll.user32
    user32.EnumDisplaySettingsW.argtypes = (ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_void_p)
    return dm if user32.EnumDisplaySettingsW(device, i & 0xFFFFFFFF, ctypes.byref(dm)) else None


def resolutions():
    """For the controlling PC: the screen's sizes, biggest first, and which one is on now.
    {"now": [w, h], "native": [w, h], "list": [[w, h], ...]}"""
    if os.name != "nt" or not _state["session"]:
        return {"list": []}
    device = _screen_device(_state["session"].get("screen", 0))
    if not device:
        return {"list": []}
    cur = _mode(device, -1)  # ENUM_CURRENT_SETTINGS
    reg = _mode(device, -2)  # ENUM_REGISTRY_SETTINGS: what Windows is set to (comes back at the end)
    if not cur:
        return {"list": []}
    wide = cur.dmPelsWidth >= cur.dmPelsHeight
    sizes, i = set(), 0
    while i < 1000:
        dm = _mode(device, i)
        if not dm:
            break
        i += 1
        # Same way round as now, normal colors, and not tiny
        if dm.dmBitsPerPel == 32 and min(dm.dmPelsWidth, dm.dmPelsHeight) >= 600 and (dm.dmPelsWidth >= dm.dmPelsHeight) == wide:
            sizes.add((dm.dmPelsWidth, dm.dmPelsHeight))
    native = reg or cur
    return {"now": [cur.dmPelsWidth, cur.dmPelsHeight], "native": [native.dmPelsWidth, native.dmPelsHeight],
            "list": [list(x) for x in sorted(sizes, reverse=True)]}


def set_resolution(w, h):
    """Change the screen being controlled to w x h for now (CDS_FULLSCREEN: not saved in Windows)."""
    if os.name != "nt" or not _state["session"]:
        raise Error("Not connected")
    device = _screen_device(_state["session"].get("screen", 0))
    best, i = None, 0
    while device and i < 1000:
        dm = _mode(device, i)
        if not dm:
            break
        i += 1
        if dm.dmPelsWidth == int(w) and dm.dmPelsHeight == int(h) and dm.dmBitsPerPel == 32:
            if not best or dm.dmDisplayFrequency > best.dmDisplayFrequency:  # the smoothest refresh rate
                best = dm
    if not best:
        raise Error("That screen can't use that size")
    best.dmFields = 0x80000 | 0x100000 | 0x400000  # DM_PELSWIDTH | DM_PELSHEIGHT | DM_DISPLAYFREQUENCY
    user32 = ctypes.windll.user32
    user32.ChangeDisplaySettingsExW.argtypes = (ctypes.c_wchar_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint32,
                                                ctypes.c_void_p)
    user32.ChangeDisplaySettingsExW.restype = ctypes.c_long
    r = user32.ChangeDisplaySettingsExW(device, ctypes.byref(best), None, 0x4, None)  # CDS_FULLSCREEN
    if r != 0:
        raise Error(f"Windows said no ({r})")
    _res["changed"].add(device)
    with _lock:
        data = _this_pc()
        data["resChanged"] = True  # so a crash can't leave the screen like this (see cursor_restore_on_start)
        _save(data)
    return resolutions()


def resolution_back():
    """Windows' own resolution again on every screen we changed."""
    if os.name != "nt":
        return
    user32 = ctypes.windll.user32
    user32.ChangeDisplaySettingsExW.argtypes = (ctypes.c_wchar_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint32,
                                                ctypes.c_void_p)
    for device in list(_res["changed"]):
        try:
            user32.ChangeDisplaySettingsExW(device, None, None, 0, None)
        except OSError:
            pass
        _res["changed"].discard(device)
    if _this_pc().get("resChanged"):
        with _lock:
            data = _this_pc()
            data.pop("resChanged", None)
            _save(data)


def _has_battery():
    if os.name != "nt":
        return False

    class POWER(ctypes.Structure):
        _fields_ = [("ac", ctypes.c_ubyte), ("flag", ctypes.c_ubyte), ("percent", ctypes.c_ubyte),
                    ("saver", ctypes.c_ubyte), ("life", ctypes.c_ulong), ("full", ctypes.c_ulong)]
    p = POWER()
    try:
        if ctypes.windll.kernel32.GetSystemPowerStatus(ctypes.byref(p)):
            return p.flag != 128 and p.flag != 255  # 128: no battery
    except OSError:
        pass
    return False


# Keyboard keys by the page's KeyboardEvent.code -> (scan code, extended)
SCAN = {
    "Escape": 0x01, "Digit1": 0x02, "Digit2": 0x03, "Digit3": 0x04, "Digit4": 0x05, "Digit5": 0x06, "Digit6": 0x07,
    "Digit7": 0x08, "Digit8": 0x09, "Digit9": 0x0A, "Digit0": 0x0B, "Minus": 0x0C, "Equal": 0x0D, "Backspace": 0x0E,
    "Tab": 0x0F, "KeyQ": 0x10, "KeyW": 0x11, "KeyE": 0x12, "KeyR": 0x13, "KeyT": 0x14, "KeyY": 0x15, "KeyU": 0x16,
    "KeyI": 0x17, "KeyO": 0x18, "KeyP": 0x19, "BracketLeft": 0x1A, "BracketRight": 0x1B, "Enter": 0x1C,
    "ControlLeft": 0x1D, "KeyA": 0x1E, "KeyS": 0x1F, "KeyD": 0x20, "KeyF": 0x21, "KeyG": 0x22, "KeyH": 0x23,
    "KeyJ": 0x24, "KeyK": 0x25, "KeyL": 0x26, "Semicolon": 0x27, "Quote": 0x28, "Backquote": 0x29,
    "ShiftLeft": 0x2A, "Backslash": 0x2B, "KeyZ": 0x2C, "KeyX": 0x2D, "KeyC": 0x2E, "KeyV": 0x2F, "KeyB": 0x30,
    "KeyN": 0x31, "KeyM": 0x32, "Comma": 0x33, "Period": 0x34, "Slash": 0x35, "ShiftRight": 0x36,
    "NumpadMultiply": 0x37, "AltLeft": 0x38, "Space": 0x39, "CapsLock": 0x3A, "F1": 0x3B, "F2": 0x3C, "F3": 0x3D,
    "F4": 0x3E, "F5": 0x3F, "F6": 0x40, "F7": 0x41, "F8": 0x42, "F9": 0x43, "F10": 0x44, "NumLock": 0x45,
    "ScrollLock": 0x46, "Numpad7": 0x47, "Numpad8": 0x48, "Numpad9": 0x49, "NumpadSubtract": 0x4A, "Numpad4": 0x4B,
    "Numpad5": 0x4C, "Numpad6": 0x4D, "NumpadAdd": 0x4E, "Numpad1": 0x4F, "Numpad2": 0x50, "Numpad3": 0x51,
    "Numpad0": 0x52, "NumpadDecimal": 0x53, "IntlBackslash": 0x56, "F11": 0x57, "F12": 0x58,
    "NumpadEnter": (0x1C, True), "ControlRight": (0x1D, True), "NumpadDivide": (0x35, True),
    "PrintScreen": (0x37, True), "AltRight": (0x38, True), "Home": (0x47, True), "ArrowUp": (0x48, True),
    "PageUp": (0x49, True), "ArrowLeft": (0x4B, True), "ArrowRight": (0x4D, True), "End": (0x4F, True),
    "ArrowDown": (0x50, True), "PageDown": (0x51, True), "Insert": (0x52, True), "Delete": (0x53, True),
    "MetaLeft": (0x5B, True), "MetaRight": (0x5C, True), "ContextMenu": (0x5D, True),
}


def _scan(code):
    v = SCAN.get(code)
    if v is None:
        return None
    return v if isinstance(v, tuple) else (v, False)


def _send(items):
    """items: [(type, fields)] -> SendInput."""
    if os.name != "nt" or not items:
        return
    from ctypes import wintypes
    ULONG_PTR = ctypes.c_size_t

    class MOUSEINPUT(ctypes.Structure):
        _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD),
                    ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]

    class KEYBDINPUT(ctypes.Structure):
        _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD),
                    ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]

    class _U(ctypes.Union):
        _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT), ("pad", ctypes.c_byte * 32)]

    class INPUT(ctypes.Structure):
        _fields_ = [("type", wintypes.DWORD), ("u", _U)]

    arr = (INPUT * len(items))()
    for i, (kind, f) in enumerate(items):
        arr[i].type = kind
        if kind == 0:
            arr[i].u.mi = MOUSEINPUT(f.get("dx", 0), f.get("dy", 0), f.get("data", 0) & 0xFFFFFFFF, f["flags"], 0, 0)
        else:
            arr[i].u.ki = KEYBDINPUT(0, f["scan"], f["flags"], 0, 0)
    ctypes.windll.user32.SendInput(len(items), ctypes.byref(arr), ctypes.sizeof(INPUT))


def _virtual_desk():
    u = ctypes.windll.user32
    return u.GetSystemMetrics(76), u.GetSystemMetrics(77), u.GetSystemMetrics(78), u.GetSystemMetrics(79)


BUTTONS = {0: (0x2, 0x4), 1: (0x20, 0x40), 2: (0x8, 0x10)}  # left, middle, right: (down, up)


def input_events(events):
    """Mouse and keys from the controlling PC (only while a session is on). Returns {"stop": bool}."""
    if not _state["session"] or _state["stop"]:
        return host_state()
    if not isinstance(events, list):
        return host_state()
    items = []
    mons = monitors() if os.name == "nt" else []
    screen = _state["session"].get("screen", 0)
    rect = mons[screen] if 0 <= screen < len(mons) else (mons[0] if mons else None)
    for e in events[:200]:
        if not isinstance(e, dict):
            continue
        t = e.get("t")
        try:
            if t == "m" and rect:
                vx, vy, vw, vh = _virtual_desk()
                x = rect[0] + min(1.0, max(0.0, float(e["x"]))) * (rect[2] - rect[0] - 1)
                y = rect[1] + min(1.0, max(0.0, float(e["y"]))) * (rect[3] - rect[1] - 1)
                items.append((0, {"dx": int((x - vx) * 65535 / max(1, vw - 1)), "dy": int((y - vy) * 65535 / max(1, vh - 1)),
                                  "flags": 0x1 | 0x8000 | 0x4000}))  # MOVE | ABSOLUTE | VIRTUALDESK
            elif t == "r":  # (3.1.2) Game mode: the mouse moved by this much (games read moves, not places)
                dx = int(max(-4000, min(4000, float(e.get("dx", 0)))))
                dy = int(max(-4000, min(4000, float(e.get("dy", 0)))))
                if dx or dy:
                    items.append((0, {"dx": dx, "dy": dy, "flags": 0x1}))  # MOVE (relative)
            elif t in ("d", "u"):
                b = int(e.get("b", 0))
                if b in BUTTONS:
                    items.append((0, {"flags": BUTTONS[b][0 if t == "d" else 1]}))
                    (_held_buttons.add if t == "d" else _held_buttons.discard)(b)
            elif t == "w":
                dy, dx = float(e.get("dy", 0)), float(e.get("dx", 0))
                if dy:
                    items.append((0, {"flags": 0x800, "data": int(max(-2400, min(2400, -dy)))}))  # WHEEL
                if dx:
                    items.append((0, {"flags": 0x1000, "data": int(max(-2400, min(2400, dx)))}))  # HWHEEL
            elif t in ("kd", "ku"):
                sc = _scan(str(e.get("code", "")))
                if sc:
                    flags = 0x8 | (0x1 if sc[1] else 0) | (0x2 if t == "ku" else 0)  # SCANCODE | EXTENDED | KEYUP
                    items.append((1, {"scan": sc[0], "flags": flags}))
                    (_held_keys.add if t == "kd" else _held_keys.discard)(str(e["code"]))
            elif t == "txt":  # (phone 1.6) typed text from a phone's keyboard, letter by letter (any language)
                for ch in str(e.get("s", ""))[:200]:
                    code = ord(ch)
                    if ch == "\n":
                        sc = _scan("Enter")
                        items += [(1, {"scan": sc[0], "flags": 0x8}), (1, {"scan": sc[0], "flags": 0x8 | 0x2})]
                        continue
                    if code > 0xFFFF:  # (emoji etc.: two halves)
                        code -= 0x10000
                        units = [0xD800 + (code >> 10), 0xDC00 + (code & 0x3FF)]
                    else:
                        units = [code]
                    for u in units:
                        items += [(1, {"scan": u, "flags": 0x4}), (1, {"scan": u, "flags": 0x4 | 0x2})]  # UNICODE (+ KEYUP)
            elif t == "cad":  # Ctrl+Alt+Del can't be sent by an app (Windows keeps it for itself): lock instead
                ctypes.windll.user32.LockWorkStation()
        except (KeyError, TypeError, ValueError, OSError):
            continue
    try:
        _send(items)
    except OSError:
        pass
    return host_state()


def _let_go():
    """Let go of every key and button the other PC still held (so nothing sticks)."""
    items = []
    for code in list(_held_keys):
        sc = _scan(code)
        if sc:
            items.append((1, {"scan": sc[0], "flags": 0x8 | 0x2 | (0x1 if sc[1] else 0)}))
    for b in list(_held_buttons):
        items.append((0, {"flags": BUTTONS[b][1]}))
    _held_keys.clear()
    _held_buttons.clear()
    try:
        _send(items)
    except OSError:
        pass


# ---- the yellow frame and bar on this PC while it's controlled (Windows), and Ctrl+Alt+End

_overlay = {"thread": None, "hwnds": [], "text": "", "tid": 0}
WM_APP_HIDE = 0x8000 + 40


def _overlay_show(peer):
    if os.name != "nt":
        return
    _overlay["text"] = f"{peer} is controlling this PC  ·  Ctrl+Alt+End stops it"
    if _overlay["thread"] and _overlay["thread"].is_alive():
        return
    t = threading.Thread(target=_overlay_run, daemon=True)
    _overlay["thread"] = t
    t.start()


def _overlay_hide():
    if os.name != "nt" or not _overlay["tid"]:
        return
    try:
        ctypes.windll.user32.PostThreadMessageW(_overlay["tid"], WM_APP_HIDE, 0, 0)
    except OSError:
        pass


def _overlay_run():
    from ctypes import wintypes
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    gdi32 = ctypes.WinDLL("gdi32")
    kernel32 = ctypes.windll.kernel32
    _overlay["tid"] = kernel32.GetCurrentThreadId()
    user32.DefWindowProcW.restype = ctypes.c_ssize_t
    user32.DefWindowProcW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user32.CreateWindowExW.restype = wintypes.HWND
    user32.CreateWindowExW.argtypes = [wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD,
                                       ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.HWND,
                                       wintypes.HANDLE, wintypes.HINSTANCE, ctypes.c_void_p]
    gdi32.CreateSolidBrush.restype = wintypes.HANDLE
    yellow = gdi32.CreateSolidBrush(0x3FCFFF)  # #ffcf3f as 0x00BBGGRR
    dark = gdi32.CreateSolidBrush(0x111111)
    WNDPROC = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)
    bar = {"hwnd": None, "stop": (0, 0, 0, 0)}

    class PAINTSTRUCT(ctypes.Structure):
        _fields_ = [("hdc", wintypes.HDC), ("fErase", wintypes.BOOL), ("rcPaint", wintypes.RECT),
                    ("fRestore", wintypes.BOOL), ("fIncUpdate", wintypes.BOOL), ("rgbReserved", ctypes.c_byte * 32)]

    def proc(hwnd, msg, wp, lp):
        if msg == 0x000F and hwnd == bar["hwnd"]:  # WM_PAINT: the bar's words and the Stop button
            ps = PAINTSTRUCT()
            dc = user32.BeginPaint(hwnd, ctypes.byref(ps))
            r = wintypes.RECT()
            user32.GetClientRect(hwnd, ctypes.byref(r))
            user32.FillRect(dc, ctypes.byref(r), yellow)
            gdi32.SetBkMode(dc, 1)
            gdi32.SetTextColor(dc, 0x111111)
            font = gdi32.CreateFontW(-15, 0, 0, 0, 600, 0, 0, 0, 0, 0, 0, 5, 0, "Segoe UI")
            old = gdi32.SelectObject(dc, font)
            text_r = wintypes.RECT(14, 0, r.right - 90, r.bottom)
            user32.DrawTextW(dc, _overlay["text"], -1, ctypes.byref(text_r), 0x20 | 0x4)  # SINGLELINE | VCENTER
            stop = wintypes.RECT(r.right - 80, 7, r.right - 8, r.bottom - 7)
            bar["stop"] = (stop.left, stop.top, stop.right, stop.bottom)
            user32.FillRect(dc, ctypes.byref(stop), dark)
            gdi32.SetTextColor(dc, 0xFFFFFF)
            user32.DrawTextW(dc, "Stop", -1, ctypes.byref(stop), 0x20 | 0x4 | 0x1)  # + CENTER
            gdi32.SelectObject(dc, old)
            gdi32.DeleteObject(font)
            user32.EndPaint(hwnd, ctypes.byref(ps))
            return 0
        if msg == 0x0021:  # WM_MOUSEACTIVATE: clicking the bar doesn't take the focus
            return 3  # MA_NOACTIVATE
        return user32.DefWindowProcW(hwnd, msg, wp, lp)

    wndproc = WNDPROC(proc)

    class WNDCLASSW(ctypes.Structure):
        _fields_ = [("style", wintypes.UINT), ("lpfnWndProc", WNDPROC), ("cbClsExtra", ctypes.c_int),
                    ("cbWndExtra", ctypes.c_int), ("hInstance", wintypes.HINSTANCE), ("hIcon", wintypes.HANDLE),
                    ("hCursor", wintypes.HANDLE), ("hbrBackground", wintypes.HANDLE),
                    ("lpszMenuName", wintypes.LPCWSTR), ("lpszClassName", wintypes.LPCWSTR)]

    inst = kernel32.GetModuleHandleW(None)
    user32.LoadCursorW.restype = wintypes.HANDLE
    user32.RegisterClassW(ctypes.byref(WNDCLASSW(0, wndproc, 0, 0, inst, None, user32.LoadCursorW(None, ctypes.c_void_p(32649)),
                                                 yellow, None, "VaultHubRemoteBar")))

    # WS_EX_TOPMOST | TOOLWINDOW | NOACTIVATE (+ LAYERED | TRANSPARENT for the frame, so clicks go through it)
    def make(x, y, w, h, through):
        ex = 0x8 | 0x80 | 0x08000000 | ((0x80000 | 0x20) if through else 0)
        hwnd = user32.CreateWindowExW(ex, "VaultHubRemoteBar", "VaultHub remote", 0x80000000, x, y, w, h,
                                      None, None, inst, None)  # WS_POPUP
        if through:
            user32.SetLayeredWindowAttributes(hwnd, 0, 255, 0x2)
        try:  # (Windows 10 2004+) not in the picture the other PC sees
            user32.SetWindowDisplayAffinity(hwnd, 0x11)  # WDA_EXCLUDEFROMCAPTURE
        except (AttributeError, OSError):
            pass
        user32.ShowWindow(hwnd, 4)  # SW_SHOWNOACTIVATE
        return hwnd

    mons = monitors() or [(0, 0, user32.GetSystemMetrics(0), user32.GetSystemMetrics(1))]
    screen = (_state["session"] or {}).get("screen", 0)
    left, top, right, bottom = mons[screen] if 0 <= screen < len(mons) else mons[0]
    w, h, edge = right - left, bottom - top, 4
    hwnds = [make(left, top, w, edge, True), make(left, bottom - edge, w, edge, True),
             make(left, top, edge, h, True), make(right - edge, top, edge, h, True)]
    bw = min(560, w - 40)
    bx, by = left + (w - bw) // 2, top + 10
    bar["stop"] = (bw - 80, 7, bw - 8, 37)
    # (2.38.2) The bar lets every click through, like the frame. The other PC can't see it (it's left out
    # of the picture), so its clicks on what's under it (a browser's tabs, the title bar) used to land on
    # the bar and stop the session. Only a real click on Stop, from the mouse on this PC, stops it.
    bar["hwnd"] = make(bx, by, bw, 44, True)
    hwnds.append(bar["hwnd"])
    _overlay["hwnds"] = hwnds
    hotkey = user32.RegisterHotKey(None, 0x7E01, 0x1 | 0x2 | 0x4000, 0x23)  # Ctrl+Alt+End (MOD_NOREPEAT)

    class MSLLHOOKSTRUCT(ctypes.Structure):
        _fields_ = [("pt", wintypes.POINT), ("mouseData", wintypes.DWORD), ("flags", wintypes.DWORD),
                    ("time", wintypes.DWORD), ("dwExtraInfo", ctypes.c_size_t)]

    HOOKPROC = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM)
    user32.CallNextHookEx.restype = ctypes.c_ssize_t
    user32.CallNextHookEx.argtypes = [wintypes.HANDLE, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM]
    user32.SetWindowsHookExW.restype = wintypes.HANDLE
    user32.SetWindowsHookExW.argtypes = [ctypes.c_int, HOOKPROC, wintypes.HINSTANCE, wintypes.DWORD]

    def on_mouse(code, wp, lp):
        try:
            if code == 0 and wp in (0x0201, 0x0202):  # WM_LBUTTONDOWN / UP
                info = ctypes.cast(lp, ctypes.POINTER(MSLLHOOKSTRUCT)).contents
                if not info.flags & 0x3:  # not LLMHF_INJECTED: a real mouse on this PC
                    r = wintypes.RECT()
                    user32.GetWindowRect(bar["hwnd"], ctypes.byref(r))
                    x, y = info.pt.x - r.left, info.pt.y - r.top
                    sl, st, sr, sb = bar["stop"]
                    if sl <= x < sr and st <= y < sb:
                        if wp == 0x0202:
                            stop_now()
                        return 1  # (the click doesn't reach the window under Stop)
        except Exception:  # noqa: BLE001 (a hook must never get stuck)
            pass
        return user32.CallNextHookEx(None, code, wp, lp)

    mouse_proc = HOOKPROC(on_mouse)
    mouse_hook = user32.SetWindowsHookExW(14, mouse_proc, inst, 0)  # WH_MOUSE_LL

    msg = wintypes.MSG()
    while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
        if msg.message == 0x0312 and msg.wParam == 0x7E01:  # WM_HOTKEY
            stop_now()
            break
        if msg.message == WM_APP_HIDE:
            break
        user32.TranslateMessage(ctypes.byref(msg))
        user32.DispatchMessageW(ctypes.byref(msg))
    if hotkey:
        user32.UnregisterHotKey(None, 0x7E01)
    if mouse_hook:
        user32.UnhookWindowsHookEx(mouse_hook)
    for hwnd in hwnds:
        user32.DestroyWindow(hwnd)
    _overlay["hwnds"] = []
    _overlay["tid"] = 0
    _overlay["thread"] = None
