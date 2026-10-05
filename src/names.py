"""File names in the save folder, so a new file never replaces an old one.

A file is made under a temporary name with a marker in it, then renamed to
"name.ext", or "name (2).ext" if that's taken. Leftovers with the marker (from
a download that was stopped halfway) are deleted the next time the app starts.
"""

import glob
import os
import re
import threading
import uuid

MARK = ".lelons-tmp-"
_MARK_RE = re.compile(re.escape(MARK) + r"[0-9a-f]{8}")
_lock = threading.Lock()


def new_mark():
    return MARK + uuid.uuid4().hex[:8]


def temp_path(folder, stem, ext):
    """Where to make a file before it gets its real name."""
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


def remove_leftovers(folder, mark=None):
    """Delete half-made files in folder (only those with the marker; with mark, only that one's)."""
    pattern = "*" + (mark or MARK) + "*"
    for path in glob.glob(os.path.join(glob.escape(folder), pattern)):
        if _MARK_RE.search(os.path.basename(path)):
            try:
                os.remove(path)
            except OSError:
                pass
