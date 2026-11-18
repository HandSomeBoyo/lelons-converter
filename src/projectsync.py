"""Projects (2.41.0): the files go straight from PC to PC, like POVs. Nothing is uploaded anywhere, so it's
free and there's no size limit; a file can only come from someone who has it and has VaultHub open.

The database (lelons_project in sfx/setup.sql) knows every file of every project you're in, its size and
fingerprint (sha256), and who has it on their PC (project_have). The page (projects.js) does the sending and
getting over WebRTC data channels. This file is the part on the PC:
 - what to get: every file of your projects that isn't in this PC's project folder yet (sync),
 - telling the database what this PC has, so friends can get it from you too (and from each other),
 - reading pieces of your files for the page to send,
 - writing the pieces friends send into a ".vaulthub-part" file, in blocks: several friends can each send
   different blocks of the same file at once, and a download that stops goes on with the blocks it still needs,
 - checking the whole file against its fingerprint at the end (a broken file is got again, never opened in Resolve).
"""

import hashlib
import json
import os
import threading
import time

import editprojects
import settings
import sfx

STORE = os.path.join(settings.DATA_DIR, "projectsync.json")
PART_EXT = ".vaulthub-part"
BLOCK = 32 * 1024 * 1024  # what one friend sends in one go (a download goes on block by block)
MAX_READ = 16 * 1024 * 1024
DEFAULTS = {"auto": True, "slow": True, "share": True, "limit": 0}  # limit: MB a second, 0 = no limit
LIMITS = (0, 1, 2, 5, 10, 25, 50)


def file_hash(path, progress=None, stopped=None):
    """The file's fingerprint (sha256), reading it once."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(4 * 1024 * 1024):
            if stopped and stopped():
                raise editprojects.Cancelled("Stopped.")
            h.update(chunk)
            if progress:
                progress(len(chunk))
    return h.hexdigest()


def options():
    saved = settings.load().get("projects_net")
    out = dict(DEFAULTS)
    if isinstance(saved, dict):
        for k in ("auto", "slow", "share"):
            if isinstance(saved.get(k), bool):
                out[k] = saved[k]
        if saved.get("limit") in LIMITS:
            out["limit"] = saved["limit"]
    return out


def set_options(data):
    out = options()
    for k in ("auto", "slow", "share"):
        if isinstance(data.get(k), bool):
            out[k] = data[k]
    if data.get("limit") in LIMITS:
        out["limit"] = data["limit"]
    settings.save(projects_net=out)
    return out


class Error(Exception):
    """Shown as it is."""


class Sync:
    def __init__(self):
        self.lock = threading.Lock()
        self.files = {}  # file id -> {project, path, size, hash, kind, name}: every PC-to-PC file of your projects
        self.parts = {}  # file id -> {done: [block numbers]}: downloads under way (saved)
        self.progress = {}  # file id -> {block: next byte expected}: blocks being written now (not saved)
        self.wlocks = {}
        self.told = {}  # project id -> file ids the database knows this PC has
        self.loaded = False
        self.saved_at = 0

    # ---- what this PC remembers

    def _load(self):
        if self.loaded:
            return
        self.loaded = True
        try:
            with open(STORE, encoding="utf-8") as f:
                saved = json.load(f)
            self.parts = {k: v for k, v in (saved.get("parts") or {}).items() if isinstance(v, dict)}
        except (OSError, ValueError, AttributeError):
            pass

    def _save(self, now=False):
        if not now and time.time() - self.saved_at < 2:
            return
        self.saved_at = time.time()
        os.makedirs(settings.DATA_DIR, exist_ok=True)
        with open(STORE + ".new", "w", encoding="utf-8") as f:
            json.dump({"parts": self.parts}, f)
        os.replace(STORE + ".new", STORE)

    @staticmethod
    def blocks(size):
        return max(1, -(-int(size) // BLOCK))

    # ---- what to get, and who from

    def sync(self, me):
        """Every PC-to-PC file of your projects: here, part way, or missing (and who online has it).
        Also tells the database which files this PC has (or doesn't have any more)."""
        found = editprojects._rpc("sync") or []
        me = (me or "").lower()
        files, out = {}, []
        for p in found:
            folder = editprojects.project_folder({"id": p["id"], "name": p["name"]})
            online = {x["username"] for x in p.get("people") or [] if x.get("here")}
            have, drop, items = [], [], []
            for f in p.get("files") or []:
                path = editprojects.local_path(folder, f)
                files[f["id"]] = {"project": p["id"], "path": path, "size": int(f["size"]), "hash": f.get("hash") or "",
                                  "kind": f["kind"], "name": f["name"]}
                here = editprojects._have(path, int(f["size"]))
                holders = f.get("holders") or []
                mine = any(h.lower() == me for h in holders)
                if here and not mine:
                    have.append(f["id"])
                elif mine and not here:
                    drop.append(f["id"])
                with self.lock:
                    self._load()
                    part = self.parts.get(f["id"])
                    done = len(part.get("done") or []) if part and not here else 0
                items.append({"id": f["id"], "kind": f["kind"], "name": f["name"], "folder": f["folder"], "size": int(f["size"]),
                              "by": f.get("by") or "", "here": here, "blocks": self.blocks(f["size"]), "done": done,
                              "sources": [h for h in holders if h.lower() != me and h in online],
                              "holders": [h for h in holders if h.lower() != me]})
            if have or drop:
                try:
                    editprojects._rpc("have", p["id"], {"have": have, "drop": drop})
                except (editprojects.Error, sfx.Error):
                    pass
            out.append({"id": p["id"], "name": p["name"], "folder": folder,
                        "people": [{"username": x["username"], "here": bool(x.get("here"))} for x in p.get("people") or []],
                        "files": items})
        with self.lock:
            self.files = files
            # Downloads of files that are gone (deleted, or you left the project): their half-done file goes.
            ended = [k for k in self.parts if k not in files]
            for k in ended:
                part = self.parts.pop(k).get("part")
                if part:
                    try:
                        os.remove(part)
                    except OSError:
                        pass
            if ended:
                self._save(True)
        return {"projects": out, "options": options()}

    def learn(self, project, f, path):
        """(add) A file this PC has from the start (you added it)."""
        with self.lock:
            self.files[f["id"]] = {"project": project, "path": path, "size": int(f["size"]), "hash": f.get("hash") or "",
                                   "kind": f["kind"], "name": f["name"]}

    # ---- sending

    def _local(self, file_id):
        with self.lock:
            f = self.files.get(file_id)
        if not f or not editprojects._have(f["path"], f["size"]):
            return None
        return f

    def can_send(self, project, file_id):
        if not options()["share"]:
            raise Error("They turned sharing off.")
        f = self._local(file_id)
        if not f or f["project"] != project:
            raise Error("The file isn't on their PC.")
        return {"size": f["size"]}

    def read(self, file_id, at, n):
        f = self._local(file_id)
        if not f:
            raise Error("Not here.")
        with open(f["path"], "rb") as fh:
            fh.seek(max(0, int(at)))
            return fh.read(max(0, min(int(n), MAX_READ)))

    def local_path(self, file_id):
        """(the cut player) The file on this PC, if it's all here."""
        f = self._local(file_id)
        return f["path"] if f else None

    # ---- getting

    def start(self, file_id):
        """Get ready to get a file (or go on with it). Returns {size, block, blocks, done}."""
        with self.lock:
            self._load()
            f = self.files.get(file_id)
        if not f:
            raise Error("That file isn't in your projects.")
        if editprojects._have(f["path"], f["size"]):
            return {"size": f["size"], "block": BLOCK, "blocks": self.blocks(f["size"]), "done": list(range(self.blocks(f["size"]))), "here": True}
        part = f["path"] + PART_EXT
        os.makedirs(os.path.dirname(part), exist_ok=True)
        free = __import__("shutil").disk_usage(os.path.dirname(part)).free
        with self.lock:
            d = self.parts.get(file_id)
            if not d or d.get("part") != part or not os.path.isfile(part) or os.path.getsize(part) != f["size"]:
                d = {"part": part, "done": []}
                self.parts[file_id] = d
                if f["size"] > free:
                    raise Error(f"Not enough space: it needs {f['size'] / 1024 ** 3:.1f} GB free.")
                with open(part, "wb") as fh:
                    fh.truncate(f["size"])
                self._save(True)
            return {"size": f["size"], "block": BLOCK, "blocks": self.blocks(f["size"]), "done": sorted(d["done"])}

    def _wlock(self, file_id):
        with self.lock:
            return self.wlocks.setdefault(file_id, threading.Lock())

    def write(self, file_id, at, stream, length):
        """A piece of a block. Pieces of one block come in order: returns {"at"} (where that block is)."""
        at = int(at)
        with self._wlock(file_id):
            with self.lock:
                f = self.files.get(file_id)
                d = self.parts.get(file_id)
            if not f or not d:
                stream.read(length)
                raise Error("That download was stopped.")
            block = at // BLOCK
            start, end = block * BLOCK, min((block + 1) * BLOCK, f["size"])
            if at + length > end or block in d["done"]:
                stream.read(length)
                return {"at": end if block in d["done"] else start, "blockDone": block in d["done"]}
            expected = self.progress.setdefault(file_id, {}).get(block, start)
            if at != expected:
                stream.read(length)
                return {"at": expected}
            with open(d["part"], "r+b") as fh:
                fh.seek(at)
                left = length
                while left > 0:
                    chunk = stream.read(min(1024 * 1024, left))
                    if not chunk:
                        break
                    fh.write(chunk)
                    left -= len(chunk)
            now = at + length - left
            self.progress[file_id][block] = now
            res = {"at": now}
            if now >= end:
                self.progress[file_id].pop(block, None)
                with self.lock:
                    d["done"] = sorted(set(d["done"]) | {block})
                    self._save()
                res["blockDone"] = True
                if len(d["done"]) >= self.blocks(f["size"]):
                    res.update(self._finish(file_id, f, d))
            return res

    def _finish(self, file_id, f, d):
        """All blocks are here: check the fingerprint, then it's a normal file Resolve can use."""
        if f["hash"] and file_hash(d["part"]) != f["hash"]:
            with self.lock:
                d["done"] = []
                self._save(True)
            return {"bad": True}
        os.replace(d["part"], f["path"])
        with self.lock:
            self.parts.pop(file_id, None)
            self.progress.pop(file_id, None)
            self._save(True)
        try:
            editprojects._rpc("have", f["project"], {"have": [file_id]})
        except (editprojects.Error, sfx.Error):
            pass  # (the next sync tells it)
        return {"done": True}

    def forget(self, file_id):
        """Stop getting a file for good (its half-done file is deleted)."""
        with self._wlock(file_id):
            with self.lock:
                d = self.parts.pop(file_id, None)
                self.progress.pop(file_id, None)
                self._save(True)
            if d:
                try:
                    os.remove(d["part"])
                except OSError:
                    pass


sync = Sync()
