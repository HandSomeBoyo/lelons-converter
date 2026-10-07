"""File names in the save folder, so a new file never replaces an old one.

A file is made under a temporary name with a marker in it, then renamed to
"name.ext", or "name (2).ext" if that's taken. Leftovers with the marker (from
a download that was stopped halfway) are deleted the next time the app starts.
"""

import glob
import json
import os
import re
import threading
import uuid

MARK = ".lelons-tmp-"
_MARK_RE = re.compile(re.escape(MARK) + r"[0-9a-f]{8}")
_lock = threading.Lock()


_RESERVED = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}


def safe_stem(text, fallback="file", limit=80):
    """A file name (without .ext) Windows accepts: no \\/:*?"<>| or control characters,
    no dot or space at the end, and not a reserved name like CON or NUL."""
    keep = re.sub(r'[\x00-\x1f\\/:*?"<>|]+', "", re.sub(r"\s+", " ", str(text or "")))[:limit].strip(". ")
    if keep.split(".")[0].strip().upper() in _RESERVED:
        keep = "_" + keep
    return keep or fallback


# Folders that had files being made in them, so leftovers there get cleaned up at the next start
# too (not only in the Settings folder). Set by the app to a file in its data folder.
FOLDERS_FILE = None
_folders = set()


def used(folder):
    """Remember that files are being made in folder."""
    folder = os.path.normcase(os.path.abspath(folder))
    with _lock:
        if folder in _folders or not FOLDERS_FILE:
            _folders.add(folder)
            return
        _folders.add(folder)
        try:
            with open(FOLDERS_FILE + ".new", "w", encoding="utf-8") as f:
                json.dump(sorted(_folders), f)
            os.replace(FOLDERS_FILE + ".new", FOLDERS_FILE)
        except OSError:
            pass


def remove_all_leftovers(before, *more):
    """At startup: clean every folder that had files being made in it last time, then forget them."""
    folders = set(more)
    try:
        with open(FOLDERS_FILE, encoding="utf-8") as f:
            folders.update(x for x in json.load(f) if isinstance(x, str))
    except (OSError, ValueError, TypeError):
        pass
    for folder in folders:
        if folder and os.path.isdir(folder):
            remove_leftovers(folder, before=before)
    with _lock:
        if not _folders:
            try:
                os.remove(FOLDERS_FILE)
            except OSError:
                pass


def new_mark():
    return MARK + uuid.uuid4().hex[:8]


def temp_path(folder, stem, ext):
    """Where to make a file before it gets its real name."""
    used(folder)
    return os.path.join(folder, stem + new_mark() + ext)


def free_path(folder, stem, ext):
    path = os.path.join(folder, stem + ext)
    n = 2
    while os.path.exists(path):
        path = os.path.join(folder, f"{stem} ({n}){ext}")
        n += 1
    return path


def finish(path):
    """Rename a finished temporary file to its real name. Returns the new path."""
    folder, name = os.path.split(path)
    stem, ext = os.path.splitext(_MARK_RE.sub("", name))
    with _lock:  # two files with the same name finishing at once still get different names
        target = free_path(folder, stem.strip() or "file", ext)
        os.replace(path, target)
    return target


def remove_leftovers(folder, mark=None, before=None):
    """Delete half-made files in folder (only those with the marker; with mark, only that one's;
    with before, only those last changed before that time, so a download just started is left alone)."""
    pattern = "*" + (mark or MARK) + "*"
    for path in glob.glob(os.path.join(glob.escape(folder), pattern)):
        if _MARK_RE.search(os.path.basename(path)):
            try:
                if before is None or os.path.getmtime(path) < before:
                    os.remove(path)
            except OSError:
                pass
