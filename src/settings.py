"""Remembers the user's choices (save folder, quality) between runs."""

import json
import os

DATA_DIR = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "LelonsConverter")
SETTINGS_FILE = os.path.join(DATA_DIR, "settings.json")
DEFAULT_FOLDER = os.path.join(os.path.expanduser("~"), "Downloads")

# Quality choices shown in the dropdown: (value, label).
QUALITIES = {
    "mp3": [("320", "320 kbps (best)"), ("256", "256 kbps"), ("192", "192 kbps"), ("128", "128 kbps (smallest)")],
    "mp4": [("2160", "2160p (4K)"), ("1440", "1440p (2K)"), ("1080", "1080p (Full HD)"),
            ("720", "720p (HD)"), ("480", "480p"), ("360", "360p (smallest)")],
}
DEFAULT_QUALITY = {"mp3": "320", "mp4": "1080"}


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
    for fmt in QUALITIES:
        if not is_valid_quality(fmt, settings.get(f"quality_{fmt}")):
            settings[f"quality_{fmt}"] = DEFAULT_QUALITY[fmt]
    return settings


def save(**changes):
    settings = load()
    settings.update(changes)
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(settings, f)
