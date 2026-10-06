"""What the page showed last time (the account, Home and the Library list), so the next time the app
opens it can show all that at once and update it in the background, instead of waiting on the internet."""

import json
import os
import threading

import settings

PATH = os.path.join(settings.DATA_DIR, "page-cache.json")
_lock = threading.Lock()
_data = None
_timer = None


def _load():
    global _data
    if _data is None:
        try:
            with open(PATH, encoding="utf-8") as f:
                _data = json.load(f)
            if not isinstance(_data, dict):
                _data = {}
        except (OSError, ValueError):
            _data = {}
    return _data


def get():
    with _lock:
        return dict(_load())


def put(key, value):
    """Remember value for key (written to disk a moment later, so polling doesn't keep writing)."""
    global _timer
    with _lock:
        data = _load()
        if data.get(key) == value:
            return
        data[key] = value
        if _timer is None:
            _timer = threading.Timer(3, _write)
            _timer.daemon = True
            _timer.start()


def flush():
    """The app is closing: write what's waiting now."""
    with _lock:
        timer = _timer
    if timer is not None:
        timer.cancel()
        _write()


def forget():
    """Logged out or someone else logged in: what was shown isn't theirs."""
    with _lock:
        for key in ("home", "sounds"):
            _load().pop(key, None)
    _write()


def _write():
    global _timer
    with _lock:
        _timer = None
        text = json.dumps(_load(), separators=(",", ":"))
    try:
        os.makedirs(settings.DATA_DIR, exist_ok=True)
        temp = PATH + ".tmp"
        with open(temp, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(temp, PATH)
    except OSError:
        pass
