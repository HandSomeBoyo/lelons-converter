"""The Files tab: videos and songs from the PC, converted one at a time.

Files picked with the Open window are used where they are. Dropped files
have to be copied to a temporary folder while the app runs (the window can't
tell the app where a dropped file lives). Finished files are saved in the
same folder as the downloads.

A whole folder can be added too (picked, or dropped on the window): every video
and song in it (and its subfolders) is added, and the converted files keep the
same subfolders inside a folder named after it. Watched folders (watchfolders.py)
add new files here by themselves.
"""

import itertools
import os
import re
import shutil
import tempfile
import threading

import history
import media
import names
import waveform

FOLDER = os.path.join(tempfile.gettempdir(), "LelonsConverter", "files")
FORMATS = ("mp3", "m4a", "wav", "flac", "mp4", "gif")
# What counts as a video or song when a whole folder is added (pictures, documents and so on are skipped).
MEDIA_EXTS = set(("." + e for e in
                  "mp4 mkv mov avi wmv flv webm m4v mpg mpeg 3gp ts mts m2ts mp3 m4a wav flac ogg opus wma aac aiff aif amr".split()))
MAX_FOLDER_FILES = 2000
# The Open window's list of file types.
PICK_KINDS = [
    ("Videos and songs", ";".join("*." + e for e in (
        "mp4 mkv mov avi wmv flv webm m4v mpg mpeg 3gp ts mts mp3 m4a wav flac ogg opus wma aac aiff aif amr".split()))),
    ("All files", "*.*"),
]
PUBLIC = ("id", "name", "bytes", "seconds", "video", "audio", "width", "height", "thumb",
          "status", "progress", "message", "trimLabel", "run", "cancel", "sub", "watch", "doneAs")


def is_media(name):
    return os.path.splitext(name)[1].lower() in MEDIA_EXTS


def clean_sub(sub):
    """A subfolder path from the page ("Holiday/day 1") made safe to use inside the save folder."""
    parts = [p for p in re.split(r"[\\/]+", str(sub or "")) if p.strip() and p.strip(". ")]
    return "/".join(names.safe_stem(p, "folder", 60) for p in parts[:8])


def folder_media(root, subfolders=True, skip=()):
    """Every video and song in root (and its subfolders), as (path, relative folder), sorted.
    skip: folders to leave out (like a watched folder's own Converted folder)."""
    skip = {os.path.normcase(os.path.abspath(s)) for s in skip if s}
    found = []
    for here, dirs, files in os.walk(root):
        if os.path.normcase(os.path.abspath(here)) in skip:
            dirs[:] = []
            continue
        dirs[:] = sorted(d for d in dirs if not d.startswith(".")) if subfolders else []
        rel = os.path.relpath(here, root)
        for name in sorted(files, key=str.lower):
            if is_media(name) and names.MARK not in name:
                found.append((os.path.join(here, name), "" if rel == "." else rel.replace(os.sep, "/")))
                if len(found) >= MAX_FOLDER_FILES:
                    return found
    return found


class Stopped(Exception):
    pass


def _clock(seconds):
    seconds = int(seconds)
    h, m, s = seconds // 3600, seconds % 3600 // 60, seconds % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


class Files:
    def __init__(self):
        self.lock = threading.Lock()
        self.wake = threading.Condition(self.lock)
        self.items = []
        self.ids = itertools.count(1)
        self.scans = []  # folders being looked through: {"key", "name", "done", "total"}
        self.on_finished = None  # set by watched folders: called with each finished (or failed) item
        threading.Thread(target=self._worker, daemon=True).start()

    # ---- adding and removing

    def add(self, name, stream, length, sub=""):
        """Save an uploaded (dropped) file and look at what's in it. Returns what the page shows."""
        os.makedirs(FOLDER, exist_ok=True)
        file_id = str(next(self.ids))
        ext = os.path.splitext(name)[1].lower()[:10]
        path = os.path.join(FOLDER, f"in-{file_id}{ext}")
        left = length
        try:
            with open(path, "wb") as out:
                while left > 0:
                    chunk = stream.read(min(1024 * 1024, left))
                    if not chunk:
                        break
                    out.write(chunk)
                    left -= len(chunk)
        except OSError:
            left = -1
        if left:  # stopped halfway (removed from the list, or the window closed)
            os.remove(path)
            raise OSError("The file wasn't copied all the way.")
        return self._register(file_id, os.path.basename(name), path, copied=True, sub=clean_sub(sub))

    def add_path(self, path, sub="", watch=""):
        """A file picked with the Open window: used where it is, without copying it."""
        return self._register(str(next(self.ids)), os.path.basename(path), path, copied=False,
                              sub=clean_sub(sub), watch=watch)

    def add_folder(self, root):
        """A whole folder (picked with the folder picker): looked through in the background,
        so the files show up in the list one by one. Returns how many it found."""
        found = folder_media(root)
        name = os.path.basename(os.path.normpath(root)) or root
        if not found:
            raise ValueError(f"There are no videos or songs in {name}.")
        scan = {"key": str(next(self.ids)), "name": name, "done": 0, "total": len(found), "errors": 0}
        with self.lock:
            self.scans.append(scan)

        def work():
            try:
                for path, rel in found:
                    try:
                        self.add_path(path, sub="/".join(x for x in (name, rel) if x))
                    except Exception:  # not a video or song after all, or couldn't be read
                        scan["errors"] += 1
                    scan["done"] += 1
            finally:
                with self.lock:
                    self.scans.remove(scan)
        threading.Thread(target=work, daemon=True).start()
        return len(found)

    def _register(self, file_id, name, path, copied, sub="", watch=""):
        found = media.probe(path)
        if not found["audio"] and not found["video"]:
            if copied:
                os.remove(path)
            raise ValueError(f"{name} isn't a video or song this app can open.")
        os.makedirs(FOLDER, exist_ok=True)
        thumb = os.path.join(FOLDER, f"thumb-{file_id}.jpg")
        has_thumb = found["video"] and media.thumbnail(path, thumb, min(1.0, found["duration"] / 3))
        item = {
            "id": file_id, "name": name, "path": path, "copied": copied, "bytes": os.path.getsize(path),
            "seconds": found["duration"], "video": found["video"], "audio": found["audio"],
            "width": found["width"], "height": found["height"], "probe": found,
            "thumb": f"/file-thumb/{file_id}" if has_thumb else "", "thumbPath": thumb if has_thumb else "",
            "status": "ready", "progress": 0, "message": "", "trimLabel": "", "out": "", "run": 0, "cancel": False,
            "doneAs": "",  # the page's note of the choices it was last converted with (so Convert skips it)
            "sub": sub, "watch": watch,
        }
        with self.lock:
            self.items.append(item)
        return self._public(item)

    def find(self, file_id):
        with self.lock:
            return next((i for i in self.items if i["id"] == str(file_id)), None)

    def remove(self, file_id):
        with self.lock:
            item = next((i for i in self.items if i["id"] == str(file_id) and i["status"] != "active"), None)
            if item:
                self.items.remove(item)
        if item:
            waveform.forget_local(item["id"])  # its preview copies for the trim editor
            # Only the app's own copies are deleted, never a file picked from the PC.
            for path in (item["path"] if item["copied"] else "", item["thumbPath"]):
                if path:
                    try:
                        os.remove(path)
                    except OSError:
                        pass

    def cancel(self, file_id):
        """Stop converting a file. A waiting one stops right away, a running one in a moment."""
        with self.lock:
            for item in self.items:
                if item["id"] == str(file_id) and item["status"] == "queued":
                    item.update(status="error", progress=0, message="Stopped.")
                elif item["id"] == str(file_id) and item["status"] == "active":
                    item.update(cancel=True, message="Stopping...")

    def clear(self):
        for item in self.snapshot():
            self.remove(item["id"])

    def _public(self, item):
        return {key: item[key] for key in PUBLIC} | {"canShow": bool(item["out"])}

    def snapshot(self):
        with self.lock:
            return [self._public(i) for i in self.items]

    def scan_snapshot(self):
        with self.lock:
            return [dict(s) for s in self.scans]

    @property
    def busy(self):
        with self.lock:
            return bool(self.scans) or any(i["status"] in ("queued", "active") for i in self.items)

    # ---- converting

    def convert(self, picks, options, folder):
        """picks: [{"id", "start", "end"}]. Queues each file with the same options."""
        fmt = options.get("format") if options.get("format") in FORMATS else "mp3"
        settings = {
            "format": fmt,
            "quality": str(options.get("quality") or ""),
            "targetMb": None,
            "normalize": bool(options.get("normalize")) and fmt != "gif",
            "folder": folder,
        }
        if fmt == "mp4" and options.get("targetMb"):
            try:
                target = float(options["targetMb"])
            except (TypeError, ValueError):
                target = 0
            if not 0.5 <= target <= 4000:
                raise ValueError("Pick a size between 0.5 and 4000 MB.")
            settings["targetMb"] = target
        with self.lock:
            for pick in picks:
                item = next((i for i in self.items if i["id"] == str(pick.get("id"))), None)
                if not item or item["status"] in ("queued", "active"):
                    continue
                trim = None
                try:
                    start, end = float(pick.get("start")), float(pick.get("end"))
                    whole = start <= 0.05 and end >= item["seconds"] - 0.05 and fmt != "gif"
                    if 0 <= start < end and not whole:
                        trim = (start, min(end, item["seconds"] or end))
                except (TypeError, ValueError):
                    pass
                item.update(status="queued", progress=0, message="Waiting...",
                            job=dict(settings, trim=trim, sig=str(pick.get("sig") or "")[:300]),
                            run=item["run"] + 1,
                            trimLabel=f"{_clock(trim[0])} to {_clock(trim[1])}" if trim else "")
            self.wake.notify()

    def _update(self, item, **changes):
        with self.lock:
            item.update(changes)

    def _worker(self):
        while True:
            with self.lock:
                while not any(i["status"] == "queued" for i in self.items):
                    self.wake.wait()
                item = next(i for i in self.items if i["status"] == "queued")
                item.update(status="active", message="Starting...", cancel=False)
            try:
                path = self._run(item)
                message = f"Saved as {os.path.basename(path)} · {os.path.getsize(path) / 1e6:.1f} MB"
            except Exception as e:
                if item.get("cancel"):
                    message = "Stopped."
                else:
                    message = str(e) if isinstance(e, (ValueError, OSError)) else "Converting didn't work."
                self._update(item, status="error", progress=0, message=message)
                self._finished(item)
            else:
                self._update(item, status="done", progress=100, out=path, message=message, doneAs=item["job"].get("sig", ""))
                job = item["job"]
                trim = job["trim"]
                history.count(job["format"], (trim[1] - trim[0]) if trim else item.get("seconds") or 0)
                try:  # (3.0) the History tab lists it too
                    quality = job["quality"]
                    label = (f"Under {job['targetMb']:g} MB" if job["targetMb"] else
                             f"{quality} px" if job["format"] == "gif" and quality else
                             f"{quality}p" if job["format"] == "mp4" and quality else
                             f"{quality} kbps" if job["format"] in ("mp3", "m4a") and quality else "")
                    history.add_local("file", os.path.splitext(item["name"])[0] or item["name"], path, job["format"], label,
                                      (trim[1] - trim[0]) if trim else item.get("seconds") or 0, item["trimLabel"],
                                      item["thumbPath"])
                except Exception:
                    pass
                self._finished(item)

    def _finished(self, item):
        if self.on_finished and item.get("watch"):
            try:
                self.on_finished(item)
            except Exception:
                pass

    def _run(self, item):
        job = item["job"]
        fmt, quality, trim = job["format"], job["quality"], job["trim"]
        if fmt in media.AUDIO_FORMATS and not item["audio"]:
            raise ValueError("This file has no sound in it.")
        if fmt in ("mp4", "gif") and not item["video"]:
            raise ValueError("This file has no video in it. Pick MP3 or another sound format.")
        length = (trim[1] - trim[0]) if trim else item["seconds"]

        stem = os.path.splitext(item["name"])[0] or "file"
        if trim:
            stem += " ({}-{})".format(*(f"{int(t) // 60}m{int(t) % 60:02d}s" for t in trim))
        if fmt == "mp4" and job["targetMb"]:
            stem += f" ({job['targetMb']:g} MB)"
        # Files from a whole folder keep its subfolders inside the save folder.
        out_folder = os.path.join(job["folder"], *item["sub"].split("/")) if item["sub"] else job["folder"]
        os.makedirs(out_folder, exist_ok=True)
        temp = names.temp_path(out_folder, stem, "." + fmt)

        verb = {"gif": "Making the GIF", "mp4": "Making it smaller" if job["targetMb"] else "Converting"}.get(fmt, "Converting")

        def progress(percent):
            if item.get("cancel"):
                raise Stopped()  # stops ffmpeg
            self._update(item, progress=percent, message=f"{verb}... {percent:.0f}%")

        progress(0)
        try:
            self._convert(item, fmt, quality, trim, length, temp, progress)
            return names.finish(temp)
        except BaseException:
            if os.path.exists(temp):
                os.remove(temp)
            raise

    def _convert(self, item, fmt, quality, trim, length, temp, progress):
        job = item["job"]
        if fmt == "gif":
            width = int(quality) if quality.isdigit() else 480
            media.make_gif(item["path"], temp, width, trim, length, progress)
        elif fmt == "mp4":
            max_height = int(quality) if quality.isdigit() else None
            media.convert_video(item["path"], temp, max_height, job["targetMb"], trim, job["normalize"],
                                length, progress)
        else:
            kbps = quality if quality.isdigit() else "192"
            media.convert_audio(item["path"], temp, fmt, kbps, trim, job["normalize"], length, progress)


def clean_up():
    shutil.rmtree(FOLDER, ignore_errors=True)
