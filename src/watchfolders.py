"""Watched folders in the Files tab: anything new put in one gets converted by itself.

Each watched folder has its own format and quality, and a folder the converted
files go to ("Converted" inside it unless another one is picked). Files that
were already there when it was added aren't converted unless asked (that's the
"backlog"). A file counts as new once it stops growing, so a video that's still
being copied or recorded isn't touched halfway. Watching only happens while
the app is open, but files that came in while it was closed are found at the
next start, because what was seen is saved.
"""

import itertools
import json
import os
import threading
import time

import files
import settings

FILE = os.path.join(settings.DATA_DIR, "watch_folders.json")
POLL_SECONDS = 5
STEADY_SECONDS = 4  # a new file has to keep the same size this long before it's converted
MAX_WATCHES = 12


def _stat(path):
    try:
        st = os.stat(path)
        return [st.st_size, int(st.st_mtime)]
    except OSError:
        return None


def clean_options(options):
    """The same choices the Files tab's Convert button sends."""
    options = options if isinstance(options, dict) else {}
    fmt = options.get("format") if options.get("format") in files.FORMATS else "mp3"
    target = None
    if fmt == "mp4" and options.get("targetMb"):
        try:
            target = float(options["targetMb"])
        except (TypeError, ValueError):
            target = 0
        if not 0.5 <= target <= 4000:
            raise ValueError("Pick a size between 0.5 and 4000 MB.")
    return {"format": fmt, "quality": str(options.get("quality") or "")[:8], "targetMb": target,
            "normalize": bool(options.get("normalize")) and fmt != "gif"}


def _same(a, b):
    return os.path.normcase(os.path.abspath(a)) == os.path.normcase(os.path.abspath(b))


class Watches:
    def __init__(self, local_files):
        self.files = local_files
        self.lock = threading.Lock()
        self.entries = []
        self.waiting = {}  # (watch id, rel path) -> [size, mtime, first seen with that size]
        self.ids = itertools.count(1)
        self._load()
        local_files.on_finished = self._finished
        threading.Thread(target=self._loop, daemon=True).start()

    # ---- saving

    def _load(self):
        try:
            with open(FILE, encoding="utf-8") as f:
                saved = json.load(f)
        except (OSError, ValueError):
            saved = []
        for e in saved if isinstance(saved, list) else []:
            if isinstance(e, dict) and isinstance(e.get("folder"), str) and isinstance(e.get("out"), str):
                try:
                    options = clean_options(e.get("options"))
                except ValueError:
                    options = clean_options({})
                self.entries.append({
                    "id": str(e.get("id") or ""), "folder": e["folder"], "out": e["out"], "options": options,
                    "subfolders": bool(e.get("subfolders", True)), "on": bool(e.get("on", True)),
                    "seen": {k: v for k, v in (e.get("seen") or {}).items() if isinstance(v, list)},
                    "backlog": [x for x in e.get("backlog") or [] if isinstance(x, str)],
                    "converted": int(e.get("converted") or 0), "failed": int(e.get("failed") or 0),
                    "last": str(e.get("last") or ""), "lastAt": float(e.get("lastAt") or 0),
                    "missing": False, "working": 0,
                })
        top = max([int(e["id"]) for e in self.entries if e["id"].isdigit()] or [0])
        self.ids = itertools.count(top + 1)
        for e in self.entries:
            if not e["id"]:
                e["id"] = str(next(self.ids))

    def _save(self):
        keep = ("id", "folder", "out", "options", "subfolders", "on", "seen", "backlog",
                "converted", "failed", "last", "lastAt")
        with self.lock:
            data = [{k: (dict(e[k]) if k == "seen" else list(e[k]) if k == "backlog" else e[k]) for k in keep}
                    for e in self.entries]
        try:
            os.makedirs(settings.DATA_DIR, exist_ok=True)
            with open(FILE + ".new", "w", encoding="utf-8") as f:
                json.dump(data, f)
            os.replace(FILE + ".new", FILE)
        except OSError:
            pass

    # ---- what the page shows and changes

    def _public(self, e):
        return {
            "id": e["id"], "folder": e["folder"], "name": os.path.basename(os.path.normpath(e["folder"])) or e["folder"],
            "out": e["out"], "options": e["options"], "subfolders": e["subfolders"], "on": e["on"],
            "backlog": len(e["backlog"]), "converted": e["converted"], "failed": e["failed"],
            "last": e["last"], "lastAt": e["lastAt"], "missing": e["missing"], "working": e["working"],
        }

    def snapshot(self):
        with self.lock:
            return [self._public(e) for e in self.entries]

    def _find(self, watch_id):
        return next((e for e in self.entries if e["id"] == str(watch_id)), None)

    def add(self, folder, options, subfolders=True):
        folder = os.path.normpath(folder)
        if not os.path.isdir(folder):
            raise ValueError("That folder doesn't exist.")
        options = clean_options(options)
        with self.lock:
            if any(_same(e["folder"], folder) for e in self.entries):
                raise ValueError("That folder is already being watched.")
            if len(self.entries) >= MAX_WATCHES:
                raise ValueError(f"You can watch up to {MAX_WATCHES} folders.")
        out = os.path.join(folder, "Converted")
        # What's in there now isn't converted by itself (you can ask for it on the card).
        found = files.folder_media(folder, subfolders, skip=[out])
        seen = {}
        for path, rel in found:
            stat = _stat(path)
            if stat:
                seen[self._rel(path, folder)] = stat
        entry = {
            "id": str(next(self.ids)), "folder": folder, "out": out, "options": options, "subfolders": bool(subfolders),
            "on": True, "seen": seen, "backlog": sorted(seen), "converted": 0, "failed": 0, "last": "", "lastAt": 0,
            "missing": False, "working": 0,
        }
        with self.lock:
            self.entries.append(entry)
        self._save()
        return self._public(entry)

    def update(self, watch_id, changes):
        with self.lock:
            e = self._find(watch_id)
            if not e:
                raise ValueError("That folder isn't being watched any more.")
            if "options" in changes:
                e["options"] = clean_options(changes["options"])
            if "on" in changes:
                e["on"] = bool(changes["on"])
            if "subfolders" in changes:
                e["subfolders"] = bool(changes["subfolders"])
            if "out" in changes:
                out = os.path.normpath(str(changes["out"]))
                if _same(out, e["folder"]):
                    raise ValueError("Pick another folder to save in. Saving in the watched folder itself "
                                     "would make the app convert its own files again.")
                e["out"] = out
            public = self._public(e)
        self._save()
        return public

    def remove(self, watch_id):
        with self.lock:
            self.entries = [e for e in self.entries if e["id"] != str(watch_id)]
        self._save()

    def convert_backlog(self, watch_id, skip=False):
        """Convert (or with skip, forget about) the files that were in the folder when it was added."""
        with self.lock:
            e = self._find(watch_id)
            if not e:
                return 0
            backlog, e["backlog"] = e["backlog"], []
        count = 0
        if not skip:
            for rel in backlog:
                path = os.path.join(e["folder"], *rel.split("/"))
                if os.path.isfile(path):
                    count += self._start(e, path, rel)
        self._save()
        return count

    def get(self, watch_id):
        with self.lock:
            e = self._find(watch_id)
            return dict(e) if e else None

    # ---- watching

    @staticmethod
    def _rel(path, folder):
        return os.path.relpath(path, folder).replace(os.sep, "/")

    def _start(self, e, path, rel):
        """Add one file to the Files list and convert it with the folder's choices. 1 if it started."""
        sub = os.path.dirname(rel) if e["subfolders"] else ""
        try:
            item = self.files.add_path(path, sub=sub, watch=e["id"])
            self.files.convert([{"id": item["id"]}], e["options"], e["out"])
        except (ValueError, OSError):
            with self.lock:
                e["failed"] += 1
            return 0
        with self.lock:
            e["working"] += 1
        return 1

    def _finished(self, item):
        with self.lock:
            e = self._find(item.get("watch"))
            if not e:
                return
            e["working"] = max(0, e["working"] - 1)
            if item["status"] == "done":
                e["converted"] += 1
                e.update(last=os.path.basename(item["out"]), lastAt=time.time())
            elif item.get("message") != "Stopped.":
                e["failed"] += 1
        self._save()

    def _loop(self):
        while True:
            time.sleep(POLL_SECONDS)
            try:
                self.poll()
            except Exception:
                pass

    def poll(self, now=None):
        """Look in every watched folder once. (Called every few seconds.)"""
        now = time.time() if now is None else now
        changed = False
        with self.lock:
            entries = [e for e in self.entries if e["on"]]
        for e in entries:
            missing = not os.path.isdir(e["folder"])
            e["missing"] = missing
            if missing:
                continue
            found = files.folder_media(e["folder"], e["subfolders"], skip=[e["out"]])  # (slow part, not locked)
            present = {}
            for path, _ in found:
                stat = _stat(path)
                if stat:
                    present[self._rel(path, e["folder"])] = (path, stat)
            ready = []
            with self.lock:
                for rel, (path, stat) in present.items():
                    if e["seen"].get(rel) == stat:
                        continue
                    key = (e["id"], rel)
                    wait = self.waiting.get(key)
                    if not wait or wait[:2] != stat:
                        self.waiting[key] = stat + [now]  # new, or still growing: look again next time
                        continue
                    if now - wait[2] < STEADY_SECONDS or not stat[0]:
                        continue
                    del self.waiting[key]
                    e["seen"][rel] = stat
                    ready.append((path, rel))
                # Forget files that are gone, so the saved list doesn't keep growing.
                gone = [rel for rel in e["seen"] if rel not in present]
                for rel in gone:
                    del e["seen"][rel]
                if gone and e["backlog"]:
                    e["backlog"] = [rel for rel in e["backlog"] if rel in present]
                changed = changed or bool(gone or ready)
            for path, rel in ready:
                self._start(e, path, rel)
        if changed:
            self._save()
