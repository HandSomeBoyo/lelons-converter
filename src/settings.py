"""Remembers the user's choices (save folder, quality) between runs."""

import json
import time
import os
import re
import threading

import windows

DATA_DIR = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "LelonsConverter")
SETTINGS_FILE = os.path.join(DATA_DIR, "settings.json")
DEFAULT_FOLDER = windows.downloads_folder()
_lock = threading.Lock()

# Quality choices shown in the dropdown: (value, label).
QUALITIES = {
    "mp3": [("320", "320 kbps (best)"), ("256", "256 kbps"), ("192", "192 kbps"), ("128", "128 kbps (smallest)")],
    "m4a": [("256", "256 kbps (best)"), ("192", "192 kbps"), ("128", "128 kbps (smallest)")],
    "wav": [("lossless", "Lossless (big files)")],
    "flac": [("lossless", "Lossless (smaller than WAV)")],
    "mp4": [("2160", "2160p (4K)"), ("1440", "1440p (2K)"), ("1080", "1080p (Full HD)"),
            ("720", "720p (HD)"), ("480", "480p"), ("360", "360p (smallest)"),
            ("fit10", "Under 10 MB (Discord)"), ("fit25", "Under 25 MB"), ("fit50", "Under 50 MB")],
    "gif": [("320", "320 px wide (smallest)"), ("480", "480 px wide"), ("640", "640 px wide"),
            ("800", "800 px wide (sharpest)")],
}
DEFAULT_QUALITY = {"mp3": "320", "m4a": "256", "wav": "lossless", "flac": "lossless", "mp4": "1080", "gif": "480"}


THEMES = ("dark", "black", "dim", "warm", "light")
SAVE_MODES = ("ask", "folder")
ACCENTS = ("yellow", "orange", "red", "pink", "purple", "blue", "teal", "green")


def is_accent(value):
    """One of the ready-made colors, or your own as #rrggbb."""
    return value in ACCENTS or (isinstance(value, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", value) is not None)


def is_valid_quality(fmt, quality):
    return fmt in QUALITIES and quality in [value for value, _ in QUALITIES[fmt]]


# (2.33.0) Sign-ins are saved locked with Windows' own lock (DPAPI): only your Windows account on this PC
# can open them, so a copied settings.json (a backup, a virus sending files away) has no use.
SECRET_KEYS = ("library_token", "ch_refresh", "ch_client_secret", "lv_tw_refresh", "lv_obs_password")
LOCKED = "dpapi:"
_ENTROPY = b"VaultHub sign-in"
_opened = {}  # locked text -> what it says (opening it every time settings load would be wasted work)


def _dpapi(data, lock):
    import ctypes
    from ctypes import wintypes

    class Blob(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    def blob(b):
        buf = ctypes.create_string_buffer(b, len(b))
        return Blob(len(b), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char))), buf

    crypt32, kernel32 = ctypes.windll.crypt32, ctypes.windll.kernel32
    src, keep1 = blob(data)
    extra, keep2 = blob(_ENTROPY)
    out = Blob()
    call = crypt32.CryptProtectData if lock else crypt32.CryptUnprotectData
    # CRYPTPROTECT_UI_FORBIDDEN: never show a window
    if not call(ctypes.byref(src), None, ctypes.byref(extra), None, None, 0x1, ctypes.byref(out)):
        raise OSError("DPAPI")
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        kernel32.LocalFree(out.pbData)


def lock_secret(value):
    """A sign-in as it's saved: locked on Windows (elsewhere, where the app only runs for tests, as it is)."""
    if not value or not isinstance(value, str) or os.name != "nt":
        return value
    import base64
    try:
        return LOCKED + base64.b64encode(_dpapi(value.encode(), True)).decode()
    except (OSError, AttributeError):
        return value


def open_secret(value):
    """A saved sign-in as it was. A locked one from another PC or Windows account can't be opened: ""."""
    if not isinstance(value, str) or not value.startswith(LOCKED):
        return value
    if value in _opened:
        return _opened[value]
    import base64
    try:
        opened = _dpapi(base64.b64decode(value[len(LOCKED):]), False).decode()
    except (OSError, AttributeError, ValueError):
        opened = ""
    if len(_opened) > 20:
        _opened.clear()
    _opened[value] = opened
    return opened


def lock_old_secrets():
    """Sign-ins saved before 2.33.0 were plain text: lock them (once, at start)."""
    if os.name != "nt":
        return
    raw = _raw()
    plain = {k: raw[k] for k in SECRET_KEYS if isinstance(raw.get(k), str) and raw[k] and not raw[k].startswith(LOCKED)}
    if plain:
        save(**plain)


_read_cache = {"stamp": None, "text": ""}


def _read():
    """The settings file's text. It's read on almost every request (the chat polls), so it's only
    read from disk again when it changed, which also keeps it from being open while it's replaced."""
    try:
        st = os.stat(SETTINGS_FILE)
        stamp = (st.st_mtime_ns, st.st_size)
        if stamp != _read_cache["stamp"]:
            with open(SETTINGS_FILE, encoding="utf-8") as f:
                text = f.read()
            _read_cache.update(stamp=stamp, text=text)
        return _read_cache["text"]
    except OSError:
        return ""


def _raw():
    """The settings exactly as saved, without any filled-in defaults."""
    try:
        settings = json.loads(_read() or "{}")
        return settings if isinstance(settings, dict) else {}
    except ValueError:
        return {}


_dir_cache = {}


def _is_dir(path):
    """os.path.isdir, remembered for a bit: settings load on almost every request and a folder on an
    unplugged network drive can take seconds to answer."""
    if not path:
        return False
    now = time.monotonic()
    known = _dir_cache.get(path)
    if known and now - known[1] < 30:
        return known[0]
    result = os.path.isdir(path)
    _dir_cache[path] = (result, now)
    return result


def load():
    settings = _raw()
    for key in SECRET_KEYS:
        if key in settings:
            settings[key] = open_secret(settings[key])
    if not _is_dir(settings.get("folder") or ""):
        settings["folder"] = DEFAULT_FOLDER
    settings["auto_update"] = settings.get("auto_update") is not False  # on unless turned off
    settings["normalize"] = settings.get("normalize") is True  # "Even out volume", off unless turned on
    settings["hardware"] = settings.get("hardware") is not False  # graphics card for videos and the window
    try:
        settings["zoom"] = min(2.0, max(0.5, float(settings.get("zoom") or 1)))
    except (TypeError, ValueError):
        settings["zoom"] = 1.0
    if settings.get("save_mode") not in SAVE_MODES:
        settings["save_mode"] = "ask"  # ask where to save each time, unless "always save here" was picked
    if not _is_dir(settings.get("last_asked") or ""):
        settings["last_asked"] = settings["folder"]
    if settings.get("theme") not in THEMES:
        settings["theme"] = "dark"
    if not is_accent(settings.get("accent")):
        settings["accent"] = "yellow"
    for fmt in QUALITIES:
        if not is_valid_quality(fmt, settings.get(f"quality_{fmt}")):
            settings[f"quality_{fmt}"] = DEFAULT_QUALITY[fmt]
    return settings


def save(**changes):
    with _lock:
        # Only what's really saved plus the changes: a save folder on a drive that's unplugged right
        # now must not be swapped for Downloads for good.
        settings = _raw()
        settings.update({k: lock_secret(v) if k in SECRET_KEYS else v for k, v in changes.items()})
        _dir_cache.clear()
        os.makedirs(DATA_DIR, exist_ok=True)
        # Written to a new file first, so a crash halfway can't leave a broken settings file.
        temp = SETTINGS_FILE + ".new"
        with open(temp, "w", encoding="utf-8") as f:
            json.dump(settings, f)
        # Windows refuses to replace a file another part of the app has open for a moment: try again.
        for attempt in range(8):
            try:
                os.replace(temp, SETTINGS_FILE)
                break
            except PermissionError:
                if attempt == 7:
                    raise
                time.sleep(0.05)
