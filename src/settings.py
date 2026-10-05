"""Remembers the user's choices (save folder, quality) between runs."""

import json
import os
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


THEMES = ("dark", "black", "light")
ACCENTS = ("yellow", "orange", "red", "pink", "purple", "blue", "teal", "green")


def is_valid_quality(fmt, quality):
    return fmt in QUALITIES and quality in [value for value, _ in QUALITIES[fmt]]


def load():
    settings = {}
    try:
        with open(SETTINGS_FILE, encoding="utf-8") as f:
            settings = json.load(f)
    except (OSError, ValueError):
        pass
    if not os.path.isdir(settings.get("folder") or ""):
        settings["folder"] = DEFAULT_FOLDER
    settings["auto_update"] = settings.get("auto_update") is not False  # on unless turned off
    settings["normalize"] = settings.get("normalize") is True  # "Even out volume", off unless turned on
    settings["hardware"] = settings.get("hardware") is not False  # graphics card for videos and the window
    if settings.get("theme") not in THEMES:
        settings["theme"] = "dark"
    if settings.get("accent") not in ACCENTS:
        settings["accent"] = "yellow"
    for fmt in QUALITIES:
        if not is_valid_quality(fmt, settings.get(f"quality_{fmt}")):
            settings[f"quality_{fmt}"] = DEFAULT_QUALITY[fmt]
    return settings


def save(**changes):
    with _lock:
        settings = load()
        settings.update(changes)
        os.makedirs(DATA_DIR, exist_ok=True)
        # Written to a new file first, so a crash halfway can't leave a broken settings file.
        temp = SETTINGS_FILE + ".new"
        with open(temp, "w", encoding="utf-8") as f:
            json.dump(settings, f)
        os.replace(temp, SETTINGS_FILE)
