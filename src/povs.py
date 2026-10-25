"""The POVs tab: everyone's own recording of the same game, so friends can grab each other's side.

Recordings are huge (tens of GB), so they never go to the cloud. The list (names, sizes, a small
picture) lives in the Library's Supabase project (see lelons_pov in sfx/setup.sql), and the video
itself goes straight from the app of whoever recorded it to a friend's app (WebRTC, like the calls).
That's free and has no size limit, but the one sharing needs VaultHub open while it's sent.

This file is the part on the PC: which of your files you share (the path never leaves this PC),
reading pieces of them for the page to send, and writing the pieces a friend sends into a
".part" file, so a download that stops (internet gone, PC asleep, app closed) goes on from
where it was.
"""

import base64
import ctypes
import json
import os
import shutil
import subprocess
import tempfile
import threading
import time

import media
import names
import settings
import sfx

STORE = os.path.join(settings.DATA_DIR, "povs.json")
PART_EXT = ".vaulthub-part"
MAX_READ = 16 * 1024 * 1024  # biggest piece the page reads at once
TIMERS = (1, 6, 24, 72, 168, 0)  # hours a POV can stay in the list (0: until it's removed)
PICK_KINDS = [
    ("Videos", ";".join("*." + e for e in "mp4 mkv mov webm avi m4v flv ts wmv".split())),
    ("All files", "*.*"),
]
FRIENDLY = {
    "pov_gone": "That POV isn't shared any more.",
    "pov_full": "That session is full.",
    "pov_slow": "That's a lot at once. Wait a minute and try again.",
}


class Error(Exception):
    """Something went wrong; the message is shown as it is."""


def _rpc(what, item_id=None, data=None, after=None):
    args = {"token": sfx.library._token(), "what": what}
    if item_id:
        args["id"] = item_id
    if data is not None:
        args["data"] = data
    if after is not None:
        args["after"] = after
    try:
        return sfx._rpc("lelons_pov", **args)
    except sfx.LoggedOut:
        raise
    except sfx.Error as e:
        for hint, message in FRIENDLY.items():
            if hint in str(e):
                raise Error(message) from None
        raise


def _thumb(path, seconds):
    """A small picture from a bit into the video (the start is often a black loading screen)."""
    folder = tempfile.mkdtemp(prefix="vaulthub-pov-")
    target = os.path.join(folder, "thumb.jpg")
    try:
        at = min(seconds * 0.15, 120) if seconds > 4 else 0
        try:
            subprocess.run([media.ffmpeg(), "-hide_banner", "-nostdin", "-y", "-ss", f"{at:.2f}", "-i", path,
                            "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "5", target],
                           capture_output=True, timeout=60, creationflags=media.NO_WINDOW)
        except subprocess.TimeoutExpired:
            return ""
        if not os.path.isfile(target) or os.path.getsize(target) > 85000:
            return ""
        with open(target, "rb") as f:
            return "data:image/jpeg;base64," + base64.b64encode(f.read()).decode()
    finally:
        shutil.rmtree(folder, ignore_errors=True)


def _stay_awake(povs):
    """While something is being sent or received, Windows shouldn't go to sleep. (Saying so every
    half minute from one thread that stays, because Windows ties it to the thread that asked.)"""
    while True:
        povs.awake_event.wait()
        if os.name == "nt":
            ctypes.windll.kernel32.SetThreadExecutionState(0x00000001)  # ES_SYSTEM_REQUIRED: reset the sleep timer
        time.sleep(30)
        if time.time() - povs.awake_at > 90:  # the page stopped saying it's busy (closed, say)
            povs.awake_event.clear()


class Povs:
    def __init__(self):
        self.lock = threading.Lock()
        self.shared = {}  # POV id -> the file's path on this PC
        self.downloads = {}  # POV id -> {part, folder, name, size, session, by, path (when done)}
        self.loaded = False
        self.picks = set()  # videos picked in this run (only those can be shared)
        self.awake_event = threading.Event()
        self.awake_at = 0
        self.awake_thread = None

    # ---- what this PC remembers

    def _load(self):
        if self.loaded:
            return
        self.loaded = True
        try:
            with open(STORE, encoding="utf-8") as f:
                saved = json.load(f)
            self.shared = {k: v for k, v in (saved.get("shared") or {}).items() if isinstance(v, str)}
            self.downloads = {k: v for k, v in (saved.get("downloads") or {}).items() if isinstance(v, dict)}
        except (OSError, ValueError, AttributeError):
            pass

    def _save(self):
        os.makedirs(settings.DATA_DIR, exist_ok=True)
        with open(STORE + ".new", "w", encoding="utf-8") as f:
            json.dump({"shared": self.shared, "downloads": self.downloads}, f)
        os.replace(STORE + ".new", STORE)

    def _download_state(self, file_id):
        d = self.downloads.get(file_id)
        if not d:
            return None
        if d.get("path"):
            return {"state": "done", "path": d["path"], "there": os.path.isfile(d["path"])}
        try:
            have = os.path.getsize(d["part"])
        except OSError:
            have = 0
        return {"state": "part", "have": have}

    # ---- the list

    def list(self):
        res = _rpc("list")
        with self.lock:
            self._load()
            alive = set()
            for session in res.get("sessions") or []:
                for f in session.get("files") or []:
                    alive.add(f["id"])
                    if f.get("mine"):
                        path = self.shared.get(f["id"])
                        f["here"] = bool(path and os.path.isfile(path))
                        f["path_name"] = os.path.basename(path) if path else ""
                    f["download"] = self._download_state(f["id"])
            # A POV of yours that ran out of time (or was removed) isn't sent any more.
            gone = [k for k in self.shared if k not in alive]
            for k in gone:
                del self.shared[k]
            if gone:
                self._save()
        res["sharing"] = len(self.shared)
        res["timers"] = list(TIMERS)
        return res

    def sharing(self):
        with self.lock:
            self._load()
            return len(self.shared)

    def new_session(self, title, game):
        return _rpc("new_session", data={"title": str(title or "").strip()[:120], "game": str(game or "").strip()[:80]})

    def edit_session(self, session_id, title, game):
        return _rpc("edit_session", session_id, {"title": str(title or "")[:120], "game": str(game or "")[:80]})

    def delete_session(self, session_id):
        _rpc("delete_session", session_id)

    def add(self, session_id, path, hours):
        """Share one of your recordings in a session. The file stays where it is."""
        if not os.path.isfile(path):
            raise Error("Couldn't find that file.")
        size = os.path.getsize(path)
        if size <= 0:
            raise Error("That file is empty.")
        found = media.probe(path)
        if not found["video"]:
            raise Error("That doesn't look like a video.")
        hours = hours if hours in TIMERS else 24
        info = {"name": os.path.basename(path)[:200], "size": size, "seconds": round(found["duration"], 1),
                "width": found["width"], "height": found["height"], "thumb": _thumb(path, found["duration"]), "hours": hours}
        res = _rpc("add", session_id, info)
        with self.lock:
            self._load()
            self.shared[res["file"]["id"]] = os.path.abspath(path)
            self._save()
        return res["file"]

    def picked(self, path):
        """A video was picked for "New video": remember it (only picked files can be shared) and say what it is."""
        path = os.path.abspath(path)
        self.picks.add(path)
        stem = os.path.splitext(os.path.basename(path))[0]
        return {"path": path, "file": os.path.basename(path), "name": stem[:120], "size": os.path.getsize(path)}

    def new_video(self, name, path, hours):
        """Share a video: its own entry in the list, named by you."""
        path = os.path.abspath(str(path or ""))
        if path not in self.picks:
            raise Error("Pick the video first.")
        name = str(name or "").strip()[:120] or os.path.splitext(os.path.basename(path))[0][:120]
        session = self.new_session(name, "")["session"]
        try:
            f = self.add(session, path, hours)
        except Exception:
            try:
                self.delete_session(session)
            except (Error, sfx.Error):
                pass
            raise
        self.picks.discard(path)
        return f

    def relink(self, file_id, path):
        """Your file moved: point the POV at where it is now."""
        with self.lock:
            self._load()
            if file_id not in self.shared:
                raise Error("That POV isn't one you share from this PC.")
            self.shared[file_id] = os.path.abspath(path)
            self._save()

    def timer(self, file_id, hours):
        hours = hours if hours in TIMERS else 24
        return _rpc("timer", file_id, {"hours": hours})["file"]

    def remove(self, file_id):
        _rpc("remove", file_id)
        with self.lock:
            self._load()
            if self.shared.pop(file_id, None):
                self._save()

    # ---- finding each other

    def check(self, after, busy):
        """Offers from friends who want your POVs, and answers to yours. Asks the library only when
        something could come: you share POVs, or you're getting one."""
        if not self.sharing() and not busy:
            return {"signals": [], "sharing": 0}
        res = _rpc("check", after=int(after or 0))
        res["sharing"] = self.sharing()
        return res

    def signal(self, file_id, to, transfer, kind, sdp):
        _rpc("signal", file_id, {"to": str(to or ""), "transfer": str(transfer or ""), "kind": kind, "sdp": str(sdp or "")})

    # ---- sending: the page reads your file in pieces

    def can_send(self, file_id):
        """{"size"} if this PC has the file, else an error the friend sees."""
        with self.lock:
            self._load()
            path = self.shared.get(file_id)
        if not path or not os.path.isfile(path):
            raise Error("The file isn't on their PC any more.")
        return {"size": os.path.getsize(path)}

    def read(self, file_id, at, n):
        with self.lock:
            self._load()
            path = self.shared.get(file_id)
        if not path:
            raise Error("That POV isn't shared from this PC.")
        with open(path, "rb") as f:
            f.seek(max(0, int(at)))
            return f.read(max(0, min(int(n), MAX_READ)))

    # ---- getting: the page writes the pieces a friend sends

    def start(self, file_id, folder, name, size, session, by):
        """Get ready to download a POV into folder (or go on with one that stopped). Returns {"at"}."""
        size = int(size)
        with self.lock:
            self._load()
            d = self.downloads.get(file_id)
            if d and d.get("path") and os.path.isfile(d["path"]):
                return {"at": size, "done": True, "path": d["path"]}
            if not d or d.get("path") or not os.path.isdir(d.get("folder") or ""):
                if not folder or not os.path.isdir(folder):
                    raise Error("Pick a folder to save it in.")
                stem, ext = os.path.splitext(os.path.basename(str(name or "video.mp4")))
                nice = names.safe_stem(session or stem, "POV", 110)  # (named like it is in the list)
                d = {"folder": folder, "nice": nice, "ext": ext[:10] or ".mp4", "size": size,
                     "part": os.path.join(folder, nice + PART_EXT), "session": str(session or "")[:120], "by": str(by or "")[:40]}
                n = 2
                while os.path.exists(d["part"]):
                    d["part"] = os.path.join(folder, f"{nice} ({n}){PART_EXT}")
                    n += 1
                self.downloads[file_id] = d
            try:
                have = os.path.getsize(d["part"])
            except OSError:
                have = 0
            free = shutil.disk_usage(d["folder"]).free
            if size - have > free:
                need = (size - have) / 1024 ** 3
                raise Error(f"Not enough space: it needs {need:.1f} GB free on that drive.")
            if not os.path.exists(d["part"]):
                open(d["part"], "wb").close()
            self._save()
            return {"at": have}

    def write(self, file_id, at, stream, length):
        """Add a piece to the download. Pieces must come in order: returns {"at"} (how much is here)."""
        with self.lock:
            self._load()
            d = self.downloads.get(file_id)
        if not d or d.get("path"):
            raise Error("That download was stopped.")
        with open(d["part"], "ab") as f:
            have = f.tell()
            if int(at) != have:
                stream.read(length)
                return {"at": have}
            left = length
            while left > 0:
                chunk = stream.read(min(1024 * 1024, left))
                if not chunk:
                    break
                f.write(chunk)
                left -= len(chunk)
            have = f.tell()
        if have >= int(d["size"]):
            return {"at": have, **self._finish(file_id, d)}
        return {"at": have}

    def _finish(self, file_id, d):
        target = names.free_path(d["folder"], d["nice"], d["ext"])
        os.replace(d["part"], target)
        with self.lock:
            d["path"] = target
            self._save()
        try:
            _rpc("got", file_id)
        except (Error, sfx.Error):
            pass  # (only the little "who has it" list misses you)
        return {"done": True, "path": target}

    def cancel(self, file_id, delete):
        """Stop a download for good (the half-done file is deleted), or forget a finished one."""
        with self.lock:
            self._load()
            d = self.downloads.pop(file_id, None)
            self._save()
        if d and delete and not d.get("path"):
            try:
                os.remove(d["part"])
            except OSError:
                pass

    def path_of(self, file_id):
        with self.lock:
            self._load()
            d = self.downloads.get(file_id) or {}
            return d.get("path") or (os.path.dirname(d["part"]) if d.get("part") else "")

    def keep_awake(self, on):
        """The page says it's sending or getting something (it says so again every few seconds)."""
        if not on:
            return self.awake_event.clear()
        self.awake_at = time.time()
        if not self.awake_thread:
            self.awake_thread = threading.Thread(target=_stay_awake, args=(self,), daemon=True)
            self.awake_thread.start()
        self.awake_event.set()


povs = Povs()
