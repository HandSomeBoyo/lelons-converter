"""A list of finished downloads, so one can be found or downloaded again later."""

import json
import os
import threading
import time
import uuid

import settings

HISTORY_FILE = os.path.join(settings.DATA_DIR, "history.json")
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
