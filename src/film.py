"""The Film assets tab: packs of VFX clips (explosions, fire, smoke...) shared with friends, like ActionVFX.

The list of packs and clips lives in the Library's Supabase project (see lelons_fx in sfx/setup.sql),
but the clips are far too big for its free storage. They go in the owner's own free Backblaze B2
storage instead (10 GB free, no card needed):
 - The owner pastes their Backblaze master key once (setup). The app makes a private bucket and two
   keys only for it: one that can only download (every logged-in app gets it) and one that can upload
   and delete (only the owner and admins get it). The master key itself is never saved.
 - Uploading a clip also makes a small preview video and a picture, so the page can show and play
   the packs without downloading the full clips.
"""

import hashlib
import json
import os
import secrets
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

import media
import names
import sfx
import waveform

B2_API = "https://api.backblazeb2.com"
CATEGORIES = ["explosion", "fire", "smoke", "muzzle", "sparks", "debris", "dust", "blood",
              "lightning", "water", "magic", "lightleak", "other"]
FOLDER = os.path.join(waveform.FOLDER, "film")  # previews being made and dropped files (deleted when the app closes)
SINGLE_MAX = 100 * 1024 * 1024  # bigger files go up in parts
PREVIEW_WIDTH = 640
PREVIEW_SECONDS = 8
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp", ".exr", ".tga"}
PICK_KINDS = [
    ("Videos and pictures", ";".join("*." + e for e in (
        "mov mp4 m4v webm mkv avi mxf wmv png jpg jpeg webp tif tiff exr tga zip".split()))),
    ("All files", "*.*"),
]
FRIENDLY = {
    "nopack": "That pack isn't there any more.",
    "nostorage": "The owner hasn't set up the Backblaze storage yet.",
}


class Error(Exception):
    """Something went wrong; the message is shown as it is."""


class Cancelled(Error):
    pass


def _rpc(what, pack_id=None, data=None):
    args = {"token": sfx.library._token(), "what": what}
    if pack_id:
        args["pack_id"] = pack_id
    if data is not None:
        args["data"] = data
    try:
        return sfx._rpc("lelons_fx", **args)
    except sfx.LoggedOut:
        raise
    except sfx.Error as e:
        text = str(e)
        for hint, message in FRIENDLY.items():
            if hint in text:
                raise Error(message) from None
        raise


# ---------------------------------------------------------------- talking to Backblaze

B2_FRIENDLY = {
    "bad_auth_token": "Backblaze didn't accept the key.",
    "unauthorized": "Backblaze didn't accept the key.",
    "storage_cap_exceeded": "The Backblaze storage is full (10 GB is free). Delete some packs first.",
    "cap_exceeded": "The Backblaze storage is full (10 GB is free). Delete some packs first.",
    "download_cap_exceeded": "Today's free Backblaze downloads are used up. Try again tomorrow.",
    "transaction_cap_exceeded": "Backblaze's free daily limit is used up. Try again tomorrow.",
    "too_many_buckets": "Your Backblaze account has too many buckets. Delete one on backblaze.com first.",
}


class B2Error(Error):
    def __init__(self, message, code="", status=0):
        super().__init__(message)
        self.code, self.status = code, status


def _b2_call(url, body=None, headers=None, data=None, timeout=60):
    """One Backblaze request. body: JSON to send (data: raw bytes or a file-like object instead)."""
    if body is not None:
        data = json.dumps(body).encode()
        headers = {**(headers or {}), "Content-Type": "application/json"}
    request = urllib.request.Request(url, data=data, headers=headers or {}, method="POST" if data is not None else "GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            details = json.loads(e.read() or b"{}")
        except ValueError:
            details = {}
        code = str(details.get("code") or "")
        message = B2_FRIENDLY.get(code) or f"Backblaze said no ({e.code}{': ' + str(details.get('message'))[:120] if details.get('message') else ''})."
        raise B2Error(message, code, e.code) from None
    except Cancelled:
        raise
    except (urllib.error.URLError, OSError, ValueError):
        raise B2Error("Couldn't reach Backblaze. Check your internet connection.") from None


class B2:
    """A logged-in Backblaze key."""

    def __init__(self, key_id, key):
        self.key_id, self.key = key_id, key
        self.at = 0
        self.info = {}

    def login(self, force=False):
        if force or not self.info or time.time() - self.at > 20 * 3600:  # (logins last 24 hours)
            import base64
            basic = base64.b64encode(f"{self.key_id}:{self.key}".encode()).decode()
            self.info = _b2_call(B2_API + "/b2api/v2/b2_authorize_account", headers={"Authorization": "Basic " + basic})
            self.at = time.time()
        return self.info

    def call(self, name, body, retry=True):
        info = self.login()
        try:
            return _b2_call(f"{info['apiUrl']}/b2api/v2/{name}", body, {"Authorization": info["authorizationToken"]})
        except B2Error as e:
            if retry and e.code == "expired_auth_token":
                self.login(force=True)
                return self.call(name, body, retry=False)
            raise

    def download_base(self, bucket):
        info = self.login()
        return f"{info['downloadUrl']}/file/{urllib.parse.quote(bucket)}/", info["authorizationToken"]


def _quote_path(path):
    return "/".join(urllib.parse.quote(part, safe="") for part in path.split("/"))


class _Reader:
    """Hands a part of a file to urllib bit by bit, counting how much went (and stopping when cancelled)."""

    def __init__(self, f, length, on_bytes, cancelled):
        self.f, self.left, self.on_bytes, self.cancelled = f, length, on_bytes, cancelled

    def read(self, n=-1):
        if self.cancelled():
            raise Cancelled("Stopped.")
        if self.left <= 0:
            return b""
        n = self.left if n is None or n < 0 else min(n, self.left)
        chunk = self.f.read(min(n, 1024 * 1024))
        self.left -= len(chunk)
        self.on_bytes(len(chunk))
        return chunk


def _sha1(path, start=0, length=None):
    digest = hashlib.sha1()
    with open(path, "rb") as f:
        f.seek(start)
        left = os.path.getsize(path) - start if length is None else length
        while left > 0:
            chunk = f.read(min(1024 * 1024, left))
            if not chunk:
                break
            digest.update(chunk)
            left -= len(chunk)
    return digest.hexdigest()


def _content_type(path):
    ext = os.path.splitext(path)[1].lower()
    return {".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg", ".png": "image/png", ".zip": "application/zip"}.get(ext, "b2/x-auto")


def upload_file(b2, bucket_id, path, name, on_bytes=lambda n: None, cancelled=lambda: False):
    """Put a file in the bucket as name. Returns its file id."""
    size = os.path.getsize(path)
    if size <= SINGLE_MAX:
        sha1 = _sha1(path)
        for attempt in range(3):
            target = b2.call("b2_get_upload_url", {"bucketId": bucket_id})
            sent = []
            try:
                with open(path, "rb") as f:
                    result = _b2_call(target["uploadUrl"], headers={
                        "Authorization": target["authorizationToken"], "X-Bz-File-Name": _quote_path(name),
                        "Content-Type": _content_type(path), "Content-Length": str(size), "X-Bz-Content-Sha1": sha1,
                    }, data=_Reader(f, size, lambda n: (sent.append(n), on_bytes(n)), cancelled), timeout=300)
                return result["fileId"]
            except B2Error as e:
                on_bytes(-sum(sent))  # (it starts again)
                if attempt == 2 or (e.status and e.status < 500 and e.status != 408 and e.code != "expired_auth_token"):
                    raise
                time.sleep(1 + attempt * 2)
    # A big file goes up in parts of about 100 MB.
    info = b2.login()
    part_size = max(int(info.get("absoluteMinimumPartSize") or 5_000_000), min(int(info.get("recommendedPartSize") or SINGLE_MAX), SINGLE_MAX))
    started = b2.call("b2_start_large_file", {"bucketId": bucket_id, "fileName": name, "contentType": _content_type(path)})
    file_id = started["fileId"]
    try:
        hashes = []
        target = None
        for number, start in enumerate(range(0, size, part_size), 1):
            length = min(part_size, size - start)
            sha1 = _sha1(path, start, length)
            for attempt in range(3):
                target = target or b2.call("b2_get_upload_part_url", {"fileId": file_id})
                sent = []
                try:
                    with open(path, "rb") as f:
                        f.seek(start)
                        _b2_call(target["uploadUrl"], headers={
                            "Authorization": target["authorizationToken"], "X-Bz-Part-Number": str(number),
                            "Content-Length": str(length), "X-Bz-Content-Sha1": sha1,
                        }, data=_Reader(f, length, lambda n: (sent.append(n), on_bytes(n)), cancelled), timeout=600)
                    break
                except B2Error as e:
                    on_bytes(-sum(sent))
                    target = None
                    if attempt == 2 or (e.status and e.status < 500 and e.status != 408 and e.code != "expired_auth_token"):
                        raise
                    time.sleep(1 + attempt * 2)
            hashes.append(sha1)
        b2.call("b2_finish_large_file", {"fileId": file_id, "partSha1Array": hashes})
        return file_id
    except BaseException:
        try:
            b2.call("b2_cancel_large_file", {"fileId": file_id})
        except Error:
            pass
        raise


# ---------------------------------------------------------------- previews

def _preview_size(width, height):
    if not width or not height:
        return 0, 0
    w = min(PREVIEW_WIDTH, width - width % 2)
    h = max(2, round(height * w / width / 2) * 2)
    return w, h


def _on_black(width, height, seconds):
    """ffmpeg filter that scales the clip down and puts it on black (so clips with see-through
    parts look like they do in an editor's "Screen" mode, not like random colors)."""
    w, h = _preview_size(width, height)
    return (f"color=c=black:s={w}x{h}:r=30:d={seconds:.2f}[bg];[0:v]scale={w}:{h},format=rgba[fg];"
            f"[bg][fg]overlay=shortest=1:format=auto,format=yuv420p[out]")


def make_preview(path, found, folder):
    """A small looping preview video (videos only) and a picture. Returns (preview or "", thumb or "")."""
    w, h = found["width"], found["height"]
    if not found["video"] or not w:
        return "", ""
    still = os.path.splitext(path)[1].lower() in IMAGE_EXTS or found["duration"] < 0.2
    seconds = 0.1 if still else min(PREVIEW_SECONDS, found["duration"])
    filters = _on_black(w, h, seconds + 1)
    # The picture: a few moments tried, and the one with the most going on kept (a dark or empty
    # moment, like before the explosion, makes a smaller file).
    thumb = ""
    for n, at in enumerate([0] if still else [found["duration"] * f for f in (.2, .4, .6)]):
        candidate = os.path.join(folder, f"thumb{n}.jpg")
        try:
            subprocess.run([media.ffmpeg(), "-hide_banner", "-nostdin", "-y", *(["-ss", f"{at:.2f}"] if at else []), "-i", path,
                            "-filter_complex", _on_black(w, h, 1), "-map", "[out]", "-frames:v", "1", "-q:v", "4", candidate],
                           capture_output=True, timeout=120, creationflags=media.NO_WINDOW)
        except subprocess.TimeoutExpired:
            continue
        if os.path.isfile(candidate) and (not thumb or os.path.getsize(candidate) > os.path.getsize(thumb)):
            thumb = candidate
    if still:
        return "", thumb
    preview = os.path.join(folder, "preview.mp4")
    try:
        subprocess.run([media.ffmpeg(), "-hide_banner", "-nostdin", "-y", "-i", path, "-t", f"{seconds:.2f}",
                        "-filter_complex", filters, "-map", "[out]", "-an", "-c:v", "libx264", "-preset", "veryfast",
                        "-crf", "30", "-movflags", "+faststart", preview],
                       capture_output=True, timeout=600, creationflags=media.NO_WINDOW)
    except subprocess.TimeoutExpired:
        pass
    return (preview if os.path.isfile(preview) and os.path.getsize(preview) > 0 else ""), thumb


# ---------------------------------------------------------------- the packs

class Film:
    def __init__(self):
        self.lock = threading.Lock()
        self.reader = None  # the download-only key (B2), from the list
        self.writer = None  # the upload key, for owner and admins
        self.bucket = ""
        self.bucket_id = ""
        self.uploads = []  # {id, pack, name, path, copied, status: waiting/working/done/error, step, done, total, message}
        self.downloads = []  # {id, pack, name, folder, status, done, total, message, path}
        self.wake = threading.Event()
        self.worker = None
        self.cancelled = set()

    # ---- what the page shows

    def _read(self, storage):
        if not storage:
            self.reader = None
            return None
        with self.lock:
            if not self.reader or self.reader.key_id != storage.get("key_id"):
                self.reader = B2(storage.get("key_id"), storage.get("key"))
            self.bucket = storage.get("bucket") or ""
            return self.reader

    def files(self):
        """Where the previews are, and the pass that lets the page load them ({base, auth})."""
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
        return {"packs": result.get("packs") or [], "ready": bool(result.get("storage")), "canAdd": bool(result.get("can_add")),
                "canSetup": bool(result.get("can_setup")), "used": result.get("used"), "files": self.files()}

    def pack(self, pack_id):
        result = _rpc("pack", pack_id)
        return {"pack": result.get("pack"), "clips": result.get("clips") or [], "canEdit": bool(result.get("mine")),
                "files": self.files()}

    # ---- the owner sets up the storage once

    def setup(self, key_id, key):
        key_id, key = str(key_id or "").strip(), str(key or "").strip()
        if not key_id or not key:
            raise Error("Paste both the keyID and the applicationKey.")
        master = B2(key_id, key)
        try:
            info = master.login()
        except B2Error as e:
            if e.status in (400, 401):
                raise Error("Backblaze didn't accept that key. Check that you copied both parts.") from None
            raise
        allowed = info.get("allowed") or {}
        if allowed.get("bucketId") or not {"writeKeys", "writeBuckets"} <= set(allowed.get("capabilities") or []):
            raise Error("That key can't make buckets. Use the master application key (Generate New Master Application Key).")
        account = info["accountId"]
        bucket = "vaulthub-film-" + secrets.token_hex(6)
        made = master.call("b2_create_bucket", {"accountId": account, "bucketName": bucket, "bucketType": "allPrivate"})
        bucket_id = made["bucketId"]
        read = master.call("b2_create_key", {"accountId": account, "keyName": "vaulthub-download", "bucketId": bucket_id,
                                             "capabilities": ["listBuckets", "readFiles"]})
        write = master.call("b2_create_key", {"accountId": account, "keyName": "vaulthub-upload", "bucketId": bucket_id,
                                              "capabilities": ["listBuckets", "listFiles", "readFiles", "writeFiles", "deleteFiles"]})
        _rpc("setup", data={"bucket": bucket, "bucket_id": bucket_id, "read_id": read["applicationKeyId"],
                            "read_key": read["applicationKey"], "write_id": write["applicationKeyId"],
                            "write_key": write["applicationKey"]})
        return self.list()

    # ---- owner and admins: packs

    @staticmethod
    def _pack_data(data):
        name = " ".join(str(data.get("name") or "").split())[:80]
        if not name:
            raise Error("Give the pack a name.")
        category = data.get("category") if data.get("category") in CATEGORIES else "other"
        return {"name": name, "category": category, "about": str(data.get("about") or "").strip()[:600]}

    def new_pack(self, data):
        return _rpc("add_pack", data=self._pack_data(data))

    def edit_pack(self, pack_id, data):
        return _rpc("edit_pack", pack_id, self._pack_data(data))

    def _writer(self):
        with self.lock:
            if self.writer:
                return self.writer
        found = _rpc("upload_key")
        with self.lock:
            self.writer = B2(found["key_id"], found["key"])
            self.bucket, self.bucket_id = found["bucket"], found["bucket_id"]
            return self.writer

    def _delete_files(self, files):
        def run():
            try:
                writer = self._writer()
                for f in files:
                    try:
                        writer.call("b2_delete_file_version", {"fileName": f["path"], "fileId": f["id"]})
                    except Error:
                        pass
            except (Error, sfx.Error):
                pass
        threading.Thread(target=run, daemon=True).start()

    def delete_pack(self, pack_id):
        self._delete_files(_rpc("delete_pack", pack_id).get("files") or [])

    def delete_clip(self, pack_id, clip_id):
        self._delete_files(_rpc("delete_clip", pack_id, {"id": str(clip_id)}).get("files") or [])

    # ---- uploading clips (one at a time, in the background)

    def add_paths(self, pack_id, paths, copied=False):
        with self.lock:
            for path in paths:
                self.uploads.append({"id": uuid.uuid4().hex[:10], "pack": pack_id, "name": os.path.basename(path), "path": path,
                                     "copied": copied, "status": "waiting", "step": "", "done": 0,
                                     "total": os.path.getsize(path), "message": ""})
        self._start()

    def add_stream(self, pack_id, name, stream, length):
        """A file dropped on the page, copied into the app's temporary folder first."""
        os.makedirs(FOLDER, exist_ok=True)
        folder = os.path.join(FOLDER, uuid.uuid4().hex[:8])
        os.makedirs(folder)
        path = os.path.join(folder, names.safe_stem(os.path.splitext(name)[0], "clip") + os.path.splitext(name)[1][:10])
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
            shutil.rmtree(folder, ignore_errors=True)
            raise Error("The file wasn't copied all the way.")
        self.add_paths(pack_id, [path], copied=True)

    def _start(self):
        self.wake.set()
        if not self.worker or not self.worker.is_alive():
            self.worker = threading.Thread(target=self._work, daemon=True)
            self.worker.start()

    def _next(self):
        with self.lock:
            for item in self.uploads:
                if item["status"] == "waiting":
                    item["status"] = "working"
                    return "up", item
            for item in self.downloads:
                if item["status"] == "waiting":
                    item["status"] = "working"
                    return "down", item
        return None, None

    def _work(self):
        while True:
            kind, item = self._next()
            if not item:
                self.wake.clear()
                if not self.wake.wait(30):
                    return
                continue
            try:
                (self._upload if kind == "up" else self._download)(item)
                item.update(status="done", step="")
            except Cancelled:
                item.update(status="error", message="Stopped.", step="")
            except sfx.LoggedOut:
                item.update(status="error", message="You were logged out. Log in again.", step="")
            except (Error, sfx.Error) as e:
                item.update(status="error", message=str(e), step="")
            except Exception:
                item.update(status="error", message="That didn't work. Try again.", step="")
            finally:
                if kind == "up" and item["copied"]:
                    shutil.rmtree(os.path.dirname(item["path"]), ignore_errors=True)

    def _upload(self, item):
        if not os.path.isfile(item["path"]):
            raise Error("That file isn't there any more.")
        stopped = lambda: item["id"] in self.cancelled
        item["step"] = "Making the preview"
        found = media.probe(item["path"])
        work = os.path.join(FOLDER, "make-" + item["id"])
        os.makedirs(work, exist_ok=True)
        try:
            preview, thumb = make_preview(item["path"], found, work)
            if stopped():
                raise Cancelled("Stopped.")
            writer = self._writer()
            item["total"] = sum(os.path.getsize(p) for p in (item["path"], preview, thumb) if p)
            item["step"] = "Uploading"
            where = f"{item['pack']}/{uuid.uuid4().hex[:12]}/"
            file_name = names.safe_stem(os.path.splitext(item["name"])[0], "clip") + os.path.splitext(item["name"])[1].lower()[:10]

            def count(n):
                item["done"] += n
            uploaded = []
            try:
                clip = {"name": os.path.splitext(item["name"])[0][:120] or "Clip", "size": os.path.getsize(item["path"]),
                        "seconds": round(found["duration"], 2), "width": found["width"], "height": found["height"]}
                for key, path, name in (("", item["path"], file_name), ("preview", preview, "preview.mp4"), ("thumb", thumb, "thumb.jpg")):
                    if not path:
                        continue
                    file_id = upload_file(writer, self.bucket_id, path, where + name, count, stopped)
                    uploaded.append({"path": where + name, "id": file_id})
                    clip[key or "path"] = where + name
                    clip[(key + "_id") if key else "file_id"] = file_id
                _rpc("add_clip", item["pack"], clip)
            except BaseException:
                if uploaded:
                    self._delete_files(uploaded)
                raise
        finally:
            shutil.rmtree(work, ignore_errors=True)

    def cancel(self, item_id):
        self.cancelled.add(str(item_id))
        with self.lock:
            for item in self.uploads + self.downloads:
                if item["id"] == item_id and item["status"] == "waiting":
                    item.update(status="error", message="Stopped.")

    def clear_done(self):
        with self.lock:
            self.uploads = [i for i in self.uploads if i["status"] in ("waiting", "working")]
            self.downloads = [i for i in self.downloads if i["status"] in ("waiting", "working")]

    def snapshot(self):
        keep = ("id", "pack", "name", "status", "step", "done", "total", "message")
        with self.lock:
            return {"uploads": [{k: i.get(k) for k in keep} for i in self.uploads],
                    "downloads": [{k: i.get(k) for k in (*keep, "path")} for i in self.downloads]}

    # ---- downloading (a whole pack, or one clip)

    def download(self, pack_id, folder, clip_id=None):
        found = self.pack(pack_id)
        clips = [c for c in found["clips"] if not clip_id or c["id"] == clip_id]
        if not clips:
            raise Error("There's nothing to download in that pack yet.")
        name = found["pack"]["name"] if not clip_id else clips[0]["name"]
        with self.lock:
            self.downloads.append({"id": uuid.uuid4().hex[:10], "pack": pack_id, "name": name, "clips": clips,
                                   "whole": not clip_id, "packName": found["pack"]["name"], "folder": folder,
                                   "status": "waiting", "step": "", "done": 0, "total": sum(c["size"] for c in clips),
                                   "message": "", "path": ""})
        self._start()

    def _download(self, item):
        if not self.reader:
            self.list()
        if not self.reader:
            raise Error("The owner hasn't set up the Backblaze storage yet.")
        stopped = lambda: item["id"] in self.cancelled
        folder = item["folder"]
        if item["whole"]:
            folder = names.free_path(folder, names.safe_stem(item["packName"], "Pack"), "")
        os.makedirs(folder, exist_ok=True)
        item["step"] = "Downloading"
        for clip in item["clips"]:
            base, auth = self.reader.download_base(self.bucket)
            ext = os.path.splitext(clip["path"])[1]
            temp = names.temp_path(folder, names.safe_stem(clip["name"], "clip"), ext)
            request = urllib.request.Request(base + _quote_path(clip["path"]), headers={"Authorization": auth})
            try:
                with urllib.request.urlopen(request, timeout=60) as response, open(temp, "wb") as out:
                    while chunk := response.read(1024 * 1024):
                        if stopped():
                            raise Cancelled("Stopped.")
                        out.write(chunk)
                        item["done"] += len(chunk)
                path = names.finish(temp)
            except urllib.error.HTTPError as e:
                if os.path.exists(temp):
                    os.remove(temp)
                code = ""
                try:
                    code = json.loads(e.read() or b"{}").get("code") or ""
                except ValueError:
                    pass
                raise Error(B2_FRIENDLY.get(code) or f"Backblaze said no ({e.code}).") from None
            except (urllib.error.URLError, OSError):
                if os.path.exists(temp):
                    os.remove(temp)
                raise Error("Couldn't download it. Check your internet connection.") from None
            except BaseException:
                if os.path.exists(temp):
                    os.remove(temp)
                raise
            item["path"] = folder if item["whole"] else path
        try:
            _rpc("downloaded", item["pack"])
        except (Error, sfx.Error):
            pass


film = Film()
