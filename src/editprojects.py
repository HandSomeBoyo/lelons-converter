"""Projects (Beta): edit videos together with friends. One shared folder per video.

Not the same as project.py (the Resolve tab's tidy folders on this PC). Here a project lives online:
 - The list of projects, the crew, the footage list, every saved cut and the notes are in the Library's
   Supabase project (lelons_project in sfx/setup.sql).
 - The big files (footage, and a video of each cut to watch) go in the owner's own free Backblaze B2
   storage, in a bucket of its own (set up once by the owner, like Film assets).
 - On each PC the files are kept in Videos\\VaultHub Projects\\<project>\\, so DaVinci Resolve finds them.
 - A cut is the timeline Resolve exports (File > Export > Timeline, FCPXML). When someone takes their turn,
   VaultHub downloads what's missing and writes that timeline again with the paths of THIS PC, with the open
   notes as markers, for File > Import > Timeline. Only one person edits at a time (the lock in the database).
"""

import html
import json
import os
import re
import shutil
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
import xml.etree.ElementTree as ET
from fractions import Fraction
from xml.sax.saxutils import quoteattr

import fcpxml
import film
import media
import names
import settings
import sfx
import waveform
from film import B2, B2_FRIENDLY, Cancelled, Error, _quote_path, upload_file

FOLDER = os.path.join(waveform.FOLDER, "projects")  # thumbnails being made and dropped files (cleaned up)
TIMELINE_MAX = 3_000_000
KINDS = ("video", "short", "film", "vlog", "stream", "other")
STAGES = ("footage", "rough", "fine", "color", "sound", "export", "done")
ROLES = ("editor", "footage", "notes")
MEDIA_EXTS = {".mov", ".mp4", ".m4v", ".mxf", ".mkv", ".avi", ".webm", ".wmv", ".mts", ".m2ts", ".braw", ".r3d",
              ".wav", ".mp3", ".aac", ".m4a", ".flac", ".ogg", ".aif", ".aiff",
              ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".exr", ".dpx", ".psd", ".webp", ".gif"}
PICK_FOOTAGE = [
    ("Videos, sounds and pictures", ";".join("*" + e for e in sorted(MEDIA_EXTS))),
    ("All files", "*.*"),
]
PICK_TIMELINE = [("Timeline (FCPXML)", "*.fcpxml;*.xml"), ("All files", "*.*")]
PICK_VIDEO = [("Videos", "*.mp4;*.mov;*.m4v;*.webm;*.mkv"), ("All files", "*.*")]
FRIENDLY = {
    "pj_nostorage": "The owner hasn't set up the storage for Projects yet.",
    "pj_gone": "That project isn't there any more, or you're not in it.",
    "pj_many": "You have 100 projects already. Delete an old one first.",
    "pj_people": "A project can have up to 30 people.",
    "pj_busy": "Someone else is editing right now. Wait for their cut, or ask for a turn.",
    "pj_timeline": "That timeline file is empty or too big.",
    "pj_nocut": "That cut isn't there any more.",
    "denied": "You can't do that in this project.",
}


sfx.FRIENDLY.update({k: v for k, v in FRIENDLY.items() if k != "denied"})  # (the database answers with these hints)


def _rpc(what, project_id=None, data=None):
    args = {"token": sfx.library._token(), "what": what}
    if project_id:
        args["project_id"] = str(project_id)
    if data is not None:
        args["data"] = data
    try:
        return sfx._rpc("lelons_project", **args)
    except sfx.LoggedOut:
        raise
    except sfx.Error as e:
        text = str(e)
        for hint, message in FRIENDLY.items():
            if hint in text:
                raise Error(message) from None
        raise


def _clean(text, limit):
    return " ".join(str(text or "").split())[:limit]


def _faces(people):
    """Adds the link of each person's picture (avatarUrl)."""
    for p in people or []:
        p["avatarUrl"] = sfx.public_url(p["avatar"]) if p.get("avatar") else ""
    return people or []


# ---------------------------------------------------------------- where the files go on this PC

def base_folder():
    saved = settings.load().get("projects_folder") or ""
    if saved and os.path.isdir(saved):
        return saved
    videos = os.path.join(os.path.expanduser("~"), "Videos")
    return os.path.join(videos if os.path.isdir(videos) else os.path.expanduser("~"), "VaultHub Projects")


def project_folder(project):
    """This PC's folder for a project. It keeps its first name, so renaming a project doesn't lose the files."""
    known = settings.load().get("projects_dirs") or {}
    path = known.get(project["id"]) if isinstance(known, dict) else None
    if path and os.path.isdir(path):
        return path
    path = names.free_path(base_folder(), names.safe_stem(project["name"], "Project"), "") if not path else path
    known = {**(known if isinstance(known, dict) else {}), project["id"]: path}
    settings.save(projects_dirs=known)
    return path


def _part(name, fallback):
    """A file or folder name that's safe on Windows (keeps the extension)."""
    stem, ext = os.path.splitext(str(name or ""))
    if ext and not re.fullmatch(r"\.[A-Za-z0-9]{1,8}", ext):
        stem, ext = stem + ext, ""
    return names.safe_stem(stem, fallback) + ext.lower()


def local_path(folder, f):
    """Where a project file is (or goes) on this PC."""
    if f["kind"] == "sound":
        name = _part(f["name"], "Sound")
        if not os.path.splitext(name)[1]:
            name += os.path.splitext(f["path"])[1][:6] or ".mp3"
        return os.path.join(folder, "Music and sounds", name)
    return os.path.join(folder, "Footage", _part(f["folder"], "Footage"), _part(f["name"], "Clip"))


def _have(path, size):
    try:
        return os.path.isfile(path) and (not size or os.path.getsize(path) == size)
    except OSError:
        return False


# ---------------------------------------------------------------- timelines

_SRC = re.compile(r'(\ssrc=)("|\')(file:[^"\']+)\2')


def _path_of_uri(uri):
    """file:///C:/Users/x/A001.mov -> C:\\Users\\x\\A001.mov (or the posix path)."""
    rest = urllib.parse.unquote(html.unescape(uri)[5:])
    if rest.startswith("//"):  # (file://host/path: the host is usually empty or localhost)
        rest = "/" + rest[2:].partition("/")[2]
    if re.match(r"^/[A-Za-z]:", rest):
        rest = rest[1:]
    return rest


def timeline_media(text):
    """The files a timeline uses: [{"path", "name"}], each once."""
    seen, out = set(), []
    for match in _SRC.finditer(text):
        path = _path_of_uri(match[3])
        name = re.split(r"[\\/]", path)[-1]
        if name and name.lower() not in seen:
            seen.add(name.lower())
            out.append({"path": path, "name": name})
    return out


def relink(text, here):
    """The timeline with each file pointing at this PC's copy. here: {lower-case file name: local path}.
    Returns (text, names not found here)."""
    missing = []

    def swap(match):
        name = re.split(r"[\\/]", _path_of_uri(match[3]))[-1]
        path = here.get(name.lower())
        if not path:
            missing.append(name)
            return match[0]
        return f"{match[1]}{match[2]}{html.escape(fcpxml._uri(path), quote=True)}{match[2]}"
    return _SRC.sub(swap, text), missing


def _seconds(value):
    """FCPXML time ("1001/30000s", "12s", "0s") -> Fraction of seconds."""
    value = (value or "0s").strip().rstrip("s") or "0"
    if "/" in value:
        a, b = value.split("/", 1)
        return Fraction(int(a), int(b))
    return Fraction(value)


def _fmt(value, frame):
    frames = round(value / frame)
    return fcpxml._time(frames, frame)


def add_markers(text, notes):
    """Puts each note in the timeline as a marker on the clip under it (top row of the timeline).
    Best effort: when the timeline looks different from what's expected, it comes back as it was."""
    if not notes:
        return text
    try:
        head = re.match(r"\s*(<\?xml[^>]*\?>)?\s*(<!DOCTYPE[^>]*>)?", text)
        root = ET.fromstring(text.encode("utf-8"))
        sequence = root.find(".//sequence")
        spine = sequence.find("spine") if sequence is not None else None
        if spine is None:
            return text
        frame = Fraction(1, 25)
        fmt_id = sequence.get("format")
        for f in root.iter("format"):
            if f.get("id") == fmt_id and f.get("frameDuration"):
                frame = _seconds(f.get("frameDuration"))
        placed = 0
        for note in sorted(notes, key=lambda n: n["at"]):
            at = Fraction(note["at"]).limit_denominator(100000)
            for clip in spine:
                if clip.get("offset") is None or clip.get("duration") is None:
                    continue
                offset, length = _seconds(clip.get("offset")), _seconds(clip.get("duration"))
                if offset <= at < offset + length:
                    start = _seconds(clip.get("start")) + (at - offset)
                    marker = ET.Element("marker", {"start": _fmt(start, frame), "duration": fcpxml._time(1, frame),
                                                   "value": _clean(f"{note.get('by') or ''}: {note['body']}", 240)})
                    # (markers go before the audio and effect parts of a clip)
                    spot = next((i for i, child in enumerate(list(clip))
                                 if child.tag in ("audio-channel-source", "audio-role-source", "filter-video", "filter-audio",
                                                  "metadata")), len(clip))
                    clip.insert(spot, marker)
                    placed += 1
                    break
        if not placed:
            return text
        body = ET.tostring(root, encoding="unicode")
        return '<?xml version="1.0" encoding="UTF-8"?>\n' + ((head[2] + "\n") if head and head[2] else "<!DOCTYPE fcpxml>\n") + body + "\n"
    except Exception:
        return text


def starter_timeline(clips, name):
    """No cut yet: a timeline with all the footage one after the other, to start from."""
    first = next((media.probe(c) for c in clips if os.path.splitext(c)[1].lower() not in {".wav", ".mp3", ".png", ".jpg"}), None)
    fps = 25.0
    if first and first.get("fps"):
        _, fps = media.resolve_rate(first["fps"])
    frame = fcpxml._frame(float(fps or 25))
    per_second = 1 / frame
    width, height = (first["width"] or 1920, first["height"] or 1080) if first and first.get("video") else (1920, 1080)
    assets, spine, at = [], [], 0
    for n, path in enumerate(clips, 2):
        info = media.probe(path)
        seconds = info["duration"] or (5 if info.get("video") else 0)
        length = max(1, round(Fraction(seconds).limit_denominator(100000) * per_second))
        if not info.get("video") and not info.get("audio"):
            continue
        sound = ' hasAudio="1" audioSources="1" audioChannels="2" audioRate="48000"' if info.get("audio") else ""
        title = os.path.basename(path)
        assets.append(f'<asset id="r{n}" name={quoteattr(title)} src={quoteattr(fcpxml._uri(path))} start="0s" '
                      f'duration="{fcpxml._time(length, frame)}" hasVideo="{int(bool(info.get("video")))}" format="r1"{sound}/>')
        spine.append(f'<asset-clip ref="r{n}" name={quoteattr(title)} offset="{fcpxml._time(at, frame)}" start="0s" '
                     f'duration="{fcpxml._time(length, frame)}" format="r1" tcFormat="NDF"/>')
        at += length
    if not spine:
        raise Error("There's no footage in this project yet. Add some first.")
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="1.8">\n'
            f'<resources><format id="r1" name="VaultHub" frameDuration="{fcpxml._time(1, frame)}" width="{width}" height="{height}"/>'
            f'{"".join(assets)}</resources>\n'
            f'<library><event name="VaultHub"><project name={quoteattr(name)}>'
            f'<sequence format="r1" duration="{fcpxml._time(at, frame)}" tcStart="0s" tcFormat="NDF" '
            f'audioLayout="stereo" audioRate="48k"><spine>{"".join(spine)}</spine></sequence></project></event></library>\n'
            '</fcpxml>\n')


def read_timeline(path):
    try:
        if os.path.getsize(path) > TIMELINE_MAX:
            raise Error("That timeline file is too big.")
        with open(path, encoding="utf-8-sig", errors="replace") as f:
            text = f.read()
    except OSError:
        raise Error("Couldn't open that timeline file.") from None
    if "<fcpxml" not in text and "<xmeml" not in text:
        raise Error("That's not a timeline file. In Resolve: File › Export › Timeline, and pick FCPXML.")
    return text


# ---------------------------------------------------------------- the projects

class Projects:
    def __init__(self):
        self.lock = threading.Lock()
        self.reader = None
        self.writer = None
        self.bucket = ""
        self.bucket_id = ""
        self.jobs = []  # {id, project, kind: up/cut/get/edit, name, status, step, done, total, message, result}
        self.wake = threading.Event()
        self.worker = None
        self.cancelled = set()

    # ---- what the page shows

    def _read(self, storage):
        if not storage:
            return None
        with self.lock:
            if not self.reader or self.reader.key_id != storage.get("key_id"):
                self.reader = B2(storage.get("key_id"), storage.get("key"))
            self.bucket = storage.get("bucket") or ""
            return self.reader

    def files(self):
        """Where the pictures and cut videos are, and the pass that lets the page load them ({base, auth})."""
        if not self.reader:
            return None
        try:
            base, auth = self.reader.download_base(self.bucket)
        except Error:
            return None
        return {"base": base, "auth": auth}

    def list(self):
        result = _rpc("list")
        self._read(result.get("storage"))
        projects = result.get("projects") or []
        for p in projects:
            _faces(p.get("people"))
        return {"projects": projects, "invites": _faces(result.get("invites")), "store": self.files(),
                "ready": bool(result.get("ready")), "canSetup": bool(result.get("can_setup"))}

    def open(self, project_id):
        result = _rpc("open", project_id)
        self._read(result.get("storage"))
        project = result["project"]
        _faces(project.get("people"))
        folder = project_folder(project)
        files = result.get("files") or []
        for f in files:
            f["here"] = _have(local_path(folder, f), f["size"] if f["kind"] == "footage" else 0)
            if f["kind"] == "sound":
                f["url"] = sfx.public_url(f["path"])
        return {"project": project, "role": result.get("role"), "me": result.get("me"),
                "editingSince": result.get("editing_since"), "files": files, "cuts": result.get("cuts") or [],
                "notes": result.get("notes") or [], "events": result.get("events") or [],
                "folder": folder, "store": self.files()}

    def people(self):
        return _faces(_rpc("people"))

    # ---- the owner sets up the storage once (its own bucket, so Film assets stay apart)

    def setup(self, key_id, key):
        key_id, key = str(key_id or "").strip(), str(key or "").strip()
        if not key_id or not key:
            raise Error("Paste both the keyID and the applicationKey.")
        master = B2(key_id, key)
        try:
            info = master.login()
        except film.B2Error as e:
            if e.status in (400, 401):
                raise Error("Backblaze didn't accept that key. Check that you copied both parts.") from None
            raise
        allowed = info.get("allowed") or {}
        if allowed.get("bucketId") or not {"writeKeys", "writeBuckets"} <= set(allowed.get("capabilities") or []):
            raise Error("That key can't make buckets. Use the master application key (Generate New Master Application Key).")
        account = info["accountId"]
        bucket = "vaulthub-projects-" + uuid.uuid4().hex[:12]
        made = master.call("b2_create_bucket", {"accountId": account, "bucketName": bucket, "bucketType": "allPrivate"})
        bucket_id = made["bucketId"]
        read = master.call("b2_create_key", {"accountId": account, "keyName": "vaulthub-projects-download", "bucketId": bucket_id,
                                             "capabilities": ["listBuckets", "readFiles"]})
        write = master.call("b2_create_key", {"accountId": account, "keyName": "vaulthub-projects-upload", "bucketId": bucket_id,
                                              "capabilities": ["listBuckets", "listFiles", "readFiles", "writeFiles", "deleteFiles"]})
        _rpc("setup", data={"bucket": bucket, "bucket_id": bucket_id, "read_id": read["applicationKeyId"],
                            "read_key": read["applicationKey"], "write_id": write["applicationKeyId"],
                            "write_key": write["applicationKey"]})
        with self.lock:
            self.writer = None
        return self.list()

    # ---- projects and the crew

    def create(self, data):
        return _rpc("create", data={"name": _clean(data.get("name"), 80) or "Untitled project",
                                    "about": str(data.get("about") or "").strip()[:600],
                                    "kind": data.get("kind") if data.get("kind") in KINDS else "video"})

    def edit(self, project_id, data):
        clean = {}
        if "name" in data:
            clean["name"] = _clean(data["name"], 80)
        if "about" in data:
            clean["about"] = str(data.get("about") or "").strip()[:600]
        if data.get("kind") in KINDS:
            clean["kind"] = data["kind"]
        if data.get("stage") in STAGES:
            clean["stage"] = data["stage"]
        return _rpc("edit", project_id, clean)

    def invite(self, project_id, usernames, role):
        usernames = [_clean(u, 40) for u in (usernames or []) if _clean(u, 40)][:30]
        return _rpc("invite", project_id, {"usernames": usernames, "role": role if role in ROLES else "editor"})

    def set_role(self, project_id, username, role):
        return _rpc("role", project_id, {"username": _clean(username, 40), "role": role if role in ROLES else "editor"})

    def remove(self, project_id, username):
        return _rpc("remove", project_id, {"username": _clean(username, 40)})

    def leave(self, project_id):
        _rpc("leave", project_id)

    def answer(self, project_id, join):
        _rpc("answer", project_id, {"join": bool(join)})

    def delete(self, project_id):
        self._delete_files(_rpc("delete", project_id).get("files") or [])

    def simple(self, project_id, what, data):
        """note / note_done / note_delete / ask_turn / move_file: straight to the database."""
        return _rpc(what, project_id, data)

    def delete_file(self, project_id, file_id):
        self._delete_files(_rpc("delete_file", project_id, {"id": str(file_id)}).get("files") or [])

    def delete_cut(self, project_id, cut_id):
        self._delete_files(_rpc("delete_cut", project_id, {"id": str(cut_id)}).get("files") or [])

    def add_sound(self, project_id, sound):
        path = str(sound.get("path") or "")
        if not path or ".." in path or path.startswith(("/", "http")):
            raise Error("Pick a sound from the Library.")
        _rpc("add_file", project_id, {"kind": "sound", "folder": "Music", "name": _clean(sound.get("name"), 160) or "Sound",
                                      "path": path, "seconds": float(sound.get("seconds") or 0)})

    def stop_editing(self, project_id):
        _rpc("lock", project_id, {"take": False})

    # ---- Backblaze

    def _writer(self, project_id):
        with self.lock:
            if self.writer:
                return self.writer
        found = _rpc("upload_key", project_id)
        with self.lock:
            if not self.writer:
                self.writer = B2(found["key_id"], found["key"])
                self.bucket, self.bucket_id = found["bucket"], found["bucket_id"]
            return self.writer

    def _delete_files(self, files):
        if not files:
            return

        def run():
            try:
                with self.lock:
                    writer = self.writer
                if not writer:
                    return
                for f in files:
                    try:
                        writer.call("b2_delete_file_version", {"fileName": f["path"], "fileId": f["id"]})
                    except Error:
                        pass
            except (Error, sfx.Error):
                pass
        threading.Thread(target=run, daemon=True).start()

    def _download(self, job, path, local, size=0, url=None):
        """One file from Backblaze (or a Library sound from its link) to local."""
        stopped = lambda: job["id"] in self.cancelled
        os.makedirs(os.path.dirname(local), exist_ok=True)
        if url:
            request = urllib.request.Request(url)
        else:
            if not self.reader:
                raise Error("The owner hasn't set up the storage for Projects yet.")
            base, auth = self.reader.download_base(self.bucket)
            request = urllib.request.Request(base + _quote_path(path), headers={"Authorization": auth})
        temp = local + ".part"
        try:
            with urllib.request.urlopen(request, timeout=60) as response, open(temp, "wb") as out:
                while chunk := response.read(1024 * 1024):
                    if stopped():
                        raise Cancelled("Stopped.")
                    out.write(chunk)
                    job["done"] += len(chunk)
            os.replace(temp, local)
        except urllib.error.HTTPError as e:
            code = ""
            try:
                code = json.loads(e.read() or b"{}").get("code") or ""
            except ValueError:
                pass
            raise Error(B2_FRIENDLY.get(code) or f"Couldn't download it ({e.code}).") from None
        except (urllib.error.URLError, TimeoutError):
            raise Error("Couldn't download it. Check your internet connection.") from None
        finally:
            if os.path.exists(temp):
                try:
                    os.remove(temp)
                except OSError:
                    pass

    # ---- jobs (one at a time, in the background)

    def _add_job(self, **job):
        job = {"id": uuid.uuid4().hex[:10], "status": "waiting", "step": "", "done": 0, "total": 0, "message": "",
               "result": None, **job}
        with self.lock:
            self.jobs.append(job)
            self.wake.set()
            if not self.worker:
                self.worker = threading.Thread(target=self._work, daemon=True)
                self.worker.start()
        return job["id"]

    def add_paths(self, project_id, folder, paths, copied=False):
        folder = _clean(folder, 40) or "Footage"
        for path in paths:
            self._add_job(project=project_id, kind="up", name=os.path.basename(path), path=path, folder=folder,
                          copied=copied, total=os.path.getsize(path))

    def add_stream(self, project_id, folder, name, stream, length):
        """A file dropped on the page, copied into the app's temporary folder first."""
        work = os.path.join(FOLDER, uuid.uuid4().hex[:8])
        os.makedirs(work, exist_ok=True)
        path = os.path.join(work, _part(name, "clip"))
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
            left = left or 1
        if left:
            shutil.rmtree(work, ignore_errors=True)
            raise Error("The file wasn't copied all the way.")
        self.add_paths(project_id, folder, [path], copied=True)

    def upload_cut(self, project_id, timeline, video, note):
        text = read_timeline(timeline)
        if video and not os.path.isfile(video):
            raise Error("Can't find that video.")
        return self._add_job(project=project_id, kind="cut", name=os.path.basename(timeline), timeline=timeline, text=text,
                             video=video or "", note=_clean(note, 300), total=os.path.getsize(video) if video else 0)

    def get_all(self, project_id):
        return self._add_job(project=project_id, kind="get", name="Footage and sounds")

    def start_editing(self, project_id, cut_id=None, markers=True, force=False):
        found = _rpc("lock", project_id, {"take": True, "force": bool(force)})
        if found.get("busy"):
            return {"busy": found["busy"], "since": found.get("since")}
        return {"job": self._add_job(project=project_id, kind="edit", name="Getting your turn ready", cut=cut_id or "",
                                     markers=bool(markers))}

    def cancel(self, job_id):
        self.cancelled.add(str(job_id))
        with self.lock:
            for job in self.jobs:
                if job["id"] == job_id and job["status"] == "waiting":
                    job.update(status="error", message="Stopped.")

    def clear_done(self):
        with self.lock:
            self.jobs = [j for j in self.jobs if j["status"] in ("waiting", "working")]

    def snapshot(self):
        keep = ("id", "project", "kind", "name", "status", "step", "done", "total", "message", "result")
        with self.lock:
            return {"jobs": [{k: j.get(k) for k in keep} for j in self.jobs]}

    def _next(self):
        with self.lock:
            for job in self.jobs:
                if job["status"] == "waiting":
                    job["status"] = "working"
                    return job
        return None

    def _work(self):
        while True:
            self.wake.clear()
            job = self._next()
            if not job:
                if not self.wake.wait(30):
                    with self.lock:
                        if not self.wake.is_set():
                            self.worker = None
                            return
                continue
            try:
                {"up": self._upload, "cut": self._upload_cut, "get": self._get_all, "edit": self._edit}[job["kind"]](job)
                job.update(status="done", step="")
            except Cancelled:
                job.update(status="error", message="Stopped.", step="")
            except sfx.LoggedOut:
                job.update(status="error", message="You were logged out. Log in again.", step="")
            except (Error, sfx.Error) as e:
                job.update(status="error", message=str(e), step="")
            except Exception:
                job.update(status="error", message="That didn't work. Try again.", step="")
            finally:
                if job.get("copied"):
                    shutil.rmtree(os.path.dirname(job["path"]), ignore_errors=True)
                if job["kind"] == "edit" and job["status"] == "error":
                    try:  # (it never got ready: let go, so others can edit)
                        self.stop_editing(job["project"])
                    except Exception:
                        pass

    def _upload_one(self, job, project_id, path, folder, name=None, keep_local=None):
        """Uploads one footage file (with a small picture) and adds it to the project."""
        stopped = lambda: job["id"] in self.cancelled
        if not os.path.isfile(path):
            raise Error(f"{os.path.basename(path)} isn't there any more.")
        name = _part(name or os.path.basename(path), "Clip")
        found = media.probe(path)
        work = os.path.join(FOLDER, "make-" + uuid.uuid4().hex[:8])
        os.makedirs(work, exist_ok=True)
        try:
            job["step"] = "Making the picture"
            thumb = ""
            if found.get("video"):
                thumb = self._thumb(path, found, work)
            if stopped():
                raise Cancelled("Stopped.")
            writer = self._writer(project_id)
            where = f"{project_id}/{uuid.uuid4().hex[:12]}/"
            job["step"] = "Uploading"
            uploaded = []
            try:
                clip = {"kind": "footage", "folder": folder, "name": name, "size": os.path.getsize(path),
                        "seconds": round(found["duration"], 2), "width": found["width"], "height": found["height"]}
                clip["file_id"] = upload_file(writer, self.bucket_id, path, where + name, lambda n: job.update(done=job["done"] + n), stopped)
                clip["path"] = where + name
                uploaded.append({"path": clip["path"], "id": clip["file_id"]})
                if thumb:
                    clip["thumb_id"] = upload_file(writer, self.bucket_id, thumb, where + "thumb.jpg")
                    clip["thumb"] = where + "thumb.jpg"
                    uploaded.append({"path": clip["thumb"], "id": clip["thumb_id"]})
                _rpc("add_file", project_id, clip)
            except BaseException:
                self._delete_files(uploaded)
                raise
            if keep_local:  # (the uploader's PC has it already: put a copy where the project keeps its files)
                target = local_path(keep_local, clip)
                if not _have(target, clip["size"]) and os.path.normcase(os.path.abspath(target)) != os.path.normcase(os.path.abspath(path)):
                    try:
                        os.makedirs(os.path.dirname(target), exist_ok=True)
                        if job.get("copied"):
                            shutil.move(path, target)
                        else:
                            shutil.copy2(path, target)
                    except OSError:
                        pass
        finally:
            shutil.rmtree(work, ignore_errors=True)

    @staticmethod
    def _thumb(path, found, work):
        """A small picture from a third of the way in."""
        import subprocess
        target = os.path.join(work, "thumb.jpg")
        at = (found.get("duration") or 0) / 3
        try:
            subprocess.run([media.ffmpeg(), "-hide_banner", "-nostdin", "-y", *(["-ss", f"{at:.2f}"] if at > 0.2 else []),
                            "-i", path, "-vf", "scale=480:-2", "-frames:v", "1", "-q:v", "5", target],
                           capture_output=True, timeout=120, creationflags=media.NO_WINDOW)
        except subprocess.TimeoutExpired:
            return ""
        return target if os.path.isfile(target) and os.path.getsize(target) > 0 else ""

    def _upload(self, job):
        opened = self.open(job["project"])
        self._upload_one(job, job["project"], job["path"], job["folder"], keep_local=opened["folder"])

    def _upload_cut(self, job):
        """A new cut: the files its timeline uses that the project doesn't have yet go up first (they're on
        this PC), then the video to watch (if any), then the timeline itself."""
        stopped = lambda: job["id"] in self.cancelled
        project_id = job["project"]
        opened = self.open(project_id)
        known = {f["name"].lower() for f in opened["files"] if f["kind"] == "footage"}
        known |= {os.path.basename(local_path(opened["folder"], f)).lower() for f in opened["files"]}
        extra = [m for m in timeline_media(job["text"]) if m["name"].lower() not in known
                 and os.path.splitext(m["name"])[1].lower() in MEDIA_EXTS and os.path.isfile(m["path"])]
        job["total"] += sum(os.path.getsize(m["path"]) for m in extra)
        for n, m in enumerate(extra, 1):
            job["name"] = f"{os.path.basename(job['timeline'])} · new file {n} of {len(extra)}"
            self._upload_one(job, project_id, m["path"], "From cuts", keep_local=opened["folder"])
        cut = {"timeline": job["text"], "timeline_name": _part(os.path.basename(job["timeline"]), "timeline")[:160],
               "note": job["note"]}
        uploaded = []
        try:
            if job["video"]:
                job["name"] = os.path.basename(job["video"])
                job["step"] = "Uploading the video"
                found = media.probe(job["video"])
                writer = self._writer(project_id)
                where = f"{project_id}/cut-{uuid.uuid4().hex[:10]}/"
                file_name = _part(os.path.basename(job["video"]), "cut")
                cut["video_id"] = upload_file(writer, self.bucket_id, job["video"], where + file_name,
                                              lambda n: job.update(done=job["done"] + n), stopped)
                cut["video"] = where + file_name
                cut["video_size"] = os.path.getsize(job["video"])
                cut["seconds"] = round(found["duration"], 2)
                uploaded.append({"path": cut["video"], "id": cut["video_id"]})
            job["step"] = "Saving the cut"
            job["result"] = _rpc("add_cut", project_id, cut)
        except BaseException:
            self._delete_files(uploaded)
            raise

    def _fetch_missing(self, job, opened):
        """Downloads every footage file and sound this PC doesn't have yet."""
        folder = opened["folder"]
        todo = [f for f in opened["files"] if not _have(local_path(folder, f), f["size"] if f["kind"] == "footage" else 0)]
        job["total"] = sum(f["size"] for f in todo)
        failed = []
        for n, f in enumerate(todo, 1):
            job["step"] = f"Downloading {n} of {len(todo)}"
            if f["kind"] == "sound":
                try:  # (a sound the Library lost doesn't stop the rest: Resolve just asks where it is)
                    self._download(job, f["path"], local_path(folder, f), url=f["url"])
                except Cancelled:
                    raise
                except Error:
                    failed.append(f["name"])
            else:
                self._download(job, f["path"], local_path(folder, f), f["size"])
        job["failed"] = failed
        return len(todo) - len(failed)

    def _get_all(self, job):
        opened = self.open(job["project"])
        got = self._fetch_missing(job, opened)
        job["result"] = {"got": got, "folder": opened["folder"]}

    def _edit(self, job):
        """Your turn: everything on this PC, and the cut's timeline written for this PC."""
        opened = self.open(job["project"])
        self._fetch_missing(job, opened)
        folder = opened["folder"]
        here = {}
        for f in opened["files"]:
            path = local_path(folder, f)
            here.setdefault(f["name"].lower(), path)
            here.setdefault(os.path.basename(path).lower(), path)
        cuts = opened["cuts"]
        cut = next((c for c in cuts if c["id"] == job["cut"]), cuts[0] if cuts else None)
        job["step"] = "Writing the timeline"
        os.makedirs(os.path.join(folder, "Cuts"), exist_ok=True)
        if cut:
            text = _rpc("timeline", job["project"], {"id": cut["id"]})["timeline"]
            text, missing = relink(text, here)
            if job["markers"]:
                text = add_markers(text, [n for n in opened["notes"] if n["cut"] == cut["id"] and not n["done"]])
            target = os.path.join(folder, "Cuts", f"Cut {cut['n']} (for you).fcpxml")
        else:
            clips = [local_path(folder, f) for f in opened["files"] if f["kind"] == "footage"]
            text, missing = starter_timeline(clips, opened["project"]["name"]), []
            target = os.path.join(folder, "Cuts", "All footage (start here).fcpxml")
        with open(target, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        job["result"] = {"file": target, "folder": folder, "missing": (missing + job.get("failed", []))[:20], "cut": cut["n"] if cut else 0}


projects = Projects()
