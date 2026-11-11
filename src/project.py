"""Project folders for video editing: one tidy folder per video.

Making a project creates the folders below. While a project is turned on,
VaultHub saves what it makes into the right one (downloaded songs into
Audio\\Music, videos into Footage, and so on) instead of the normal save
folder. The "VaultHub Import Project" button in DaVinci Resolve brings them
in as bins with the same names.
"""

import os
import re

import settings

# kind -> folder inside the project
FOLDERS = {
    "footage": "Footage",
    "music": os.path.join("Audio", "Music"),
    "sfx": os.path.join("Audio", "Sound effects"),
    "voice": os.path.join("Audio", "Voice"),
    "vfx": "VFX",
    "pictures": "Pictures",
    "subtitles": "Subtitles",
    "exports": "Exports",
    "docs": "Docs",
}
ORDER = ("footage", "music", "sfx", "voice", "vfx", "pictures", "subtitles", "docs", "exports")

AUDIO_FORMATS = ("mp3", "m4a", "wav", "flac", "aac", "ogg", "opus")


def current():
    """The project folder that's turned on, or ""."""
    folder = settings.load().get("project") or ""
    return folder if settings._is_dir(folder) else ""


def make(parent, name):
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", str(name or "")).strip().rstrip(".")[:80]
    if not name:
        raise ValueError("Give the project a name first.")
    if not parent or not os.path.isdir(parent):
        raise ValueError("Pick where the project should go.")
    root = os.path.join(parent, name)
    if os.path.exists(root) and os.listdir(root):
        raise ValueError(f"There's already a folder called {name} there. Pick another name.")
    for kind in ORDER:
        os.makedirs(os.path.join(root, FOLDERS[kind]), exist_ok=True)
    use(root)
    return root


def use(root):
    """Turn a project on (or off with "")."""
    if root and not os.path.isdir(root):
        raise ValueError("That folder is gone.")
    settings.save(project=os.path.normpath(root) if root else "")
    recent = [r for r in settings.load().get("projects") or [] if r != root and os.path.isdir(r)]
    if root:
        settings.save(projects=[os.path.normpath(root), *recent][:8])


def recent():
    return [{"path": r, "name": os.path.basename(r)} for r in settings.load().get("projects") or [] if os.path.isdir(r)]


def kind_for(fmt):
    fmt = str(fmt or "").lower()
    if fmt in AUDIO_FORMATS:
        return "music"
    if fmt in ("srt",):
        return "subtitles"
    if fmt in ("png", "jpg", "jpeg", "webp", "gif-image", "ico", "bmp"):
        return "pictures"
    return "footage"


def folder_for(kind, fallback):
    """Where to save something of this kind: the project's folder for it while a project is on."""
    root = current()
    if not root or kind not in FOLDERS:
        return fallback
    folder = os.path.join(root, FOLDERS[kind])
    try:
        os.makedirs(folder, exist_ok=True)
    except OSError:
        return fallback
    return folder


def contents():
    """For the Resolve button: every file in the project, by bin. {"name", "bins": [{"name", "files"}]}"""
    root = current()
    if not root:
        return None
    bins = []
    for kind in ORDER:
        folder = os.path.join(root, FOLDERS[kind])
        found = []
        for base, _dirs, names in os.walk(folder):
            found += [os.path.join(base, n) for n in sorted(names) if not n.startswith(".") and ".lelons-tmp-" not in n]
        bins.append({"name": FOLDERS[kind].replace(os.sep, " - "), "files": found})
    return {"name": os.path.basename(root), "bins": bins}
