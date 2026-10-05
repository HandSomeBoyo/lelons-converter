"""A list of finished downloads, so one can be found or downloaded again later."""

import json
import os
import threading
import time
import uuid

import settings

HISTORY_FILE = os.path.join(settings.DATA_DIR, "history.json")
STATS_FILE = os.path.join(settings.DATA_DIR, "stats.json")
KEEP = 300  # newest downloads kept
KEYS = ("url", "title", "channel", "duration", "seconds", "thumbnail", "format", "quality",
        "qualityLabel", "trim", "trimLabel", "file")

_lock = threading.Lock()
_items = None  # newest first, loaded the first time it's needed
version = 0  # goes up on every change, so the page knows when to fetch the list again


def _load():
    global _items
    if _items is None:
        try:
            with open(HISTORY_FILE, encoding="utf-8") as f:
                _items = [i for i in json.load(f) if isinstance(i, dict) and i.get("id") and i.get("url")]
        except (OSError, ValueError, TypeError):
            _items = []
    return _items


def _save():
    global version
    version += 1
    try:
        os.makedirs(settings.DATA_DIR, exist_ok=True)
        temp = HISTORY_FILE + ".tmp"
        with open(temp, "w", encoding="utf-8") as f:
            json.dump(_items, f, ensure_ascii=False)
        os.replace(temp, HISTORY_FILE)
    except OSError:
        pass  # the list is only a help, never stop a download over it


def add_job(job):
    """Remember a finished download from the queue."""
    item = {key: job.get(key) for key in KEYS}
    item.update(id=uuid.uuid4().hex[:12], date=time.time())
    with _lock:
        items = _load()
        items.insert(0, item)
        del items[KEEP:]
        _save()
    count(item.get("format"), _length(item))


# ---- your stats on the Home page: everything ever converted (the history only keeps the newest)

_stats = None


def _length(item):
    trim = item.get("trim")
    try:
        if isinstance(trim, (list, tuple)) and len(trim) == 2:
            return max(0.0, float(trim[1]) - float(trim[0]))
        return max(0.0, float(item.get("seconds") or 0))
    except (TypeError, ValueError):
        return 0.0


def _load_stats():
    global _stats
    if _stats is None:
        try:
            with open(STATS_FILE, encoding="utf-8") as f:
                saved = json.load(f)
            _stats = {"files": int(saved["files"]), "seconds": float(saved["seconds"]),
                      "formats": {str(k): int(v) for k, v in dict(saved["formats"]).items()}}
        except (OSError, ValueError, TypeError, KeyError):
            # The first time: start from what the history remembers.
            _stats = {"files": 0, "seconds": 0.0, "formats": {}}
            for item in _load():
                _add(item.get("format"), _length(item))
    return _stats


def _add(fmt, seconds):
    _stats["files"] += 1
    _stats["seconds"] += seconds or 0
    if fmt:
        _stats["formats"][fmt] = _stats["formats"].get(fmt, 0) + 1


def count(fmt, seconds):
    """One more file converted (in the Video or the Files tab)."""
    with _lock:
        _load_stats()
        _add(str(fmt or "").lower(), seconds)
        try:
            os.makedirs(settings.DATA_DIR, exist_ok=True)
            with open(STATS_FILE + ".tmp", "w", encoding="utf-8") as f:
                json.dump(_stats, f)
            os.replace(STATS_FILE + ".tmp", STATS_FILE)
        except OSError:
            pass


def stats():
    with _lock:
        found = _load_stats()
        top = max(found["formats"].items(), key=lambda kv: kv[1])[0] if found["formats"] else ""
        return {"files": found["files"], "seconds": round(found["seconds"]), "top": top,
                "topCount": found["formats"].get(top, 0)}


def items():
    """The list, newest first, with whether each file is still there."""
    with _lock:
        found = [dict(i) for i in _load()]
    for item in found:
        item["exists"] = bool(item.get("file")) and os.path.isfile(item["file"])
    return found


def find(item_id):
    with _lock:
        return next((dict(i) for i in _load() if i["id"] == item_id), None)


def remove(item_id):
    with _lock:
        items = _load()
        items[:] = [i for i in items if i["id"] != item_id]
        _save()


def clear():
    with _lock:
        _load().clear()
        _save()
