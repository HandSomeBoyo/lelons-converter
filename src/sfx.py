"""The SFX tab: sounds and music shared by everyone who has the friend code.

The sounds live in a Supabase project (see sfx/setup.sql): a list of sounds
in its database and the MP3 files in its storage. The friend code is checked
by the database; it also decides the (secret) folder the files go in.
"""

import hashlib
import json
import os
import re
import secrets
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid

import media
import names
import settings
import version
import waveform

BUCKET = "lelons-sounds"
CATEGORIES = {"sfx": "SFX", "music": "Music", "memes": "Memes", "ambience": "Ambience", "other": "Other"}
MAX_BYTES = 10 * 1024 * 1024  # the storage refuses bigger files
FOLDER = os.path.join(waveform.FOLDER, "sfx")  # deleted when the app closes
UPLOAD_KINDS = [
    ("Sounds and videos", ";".join("*." + e for e in (
        "mp3 m4a wav flac ogg opus wma aac aiff aif amr mp4 mkv mov avi wmv webm m4v".split()))),
    ("All files", "*.*"),
]


class Error(Exception):
    """Something went wrong; the message is shown as it is."""


def configured():
    return bool(version.SFX_URL and version.SFX_KEY)


def code_hash(code):
    return hashlib.sha256(("lelons:" + code.strip(" ").lower()).encode()).hexdigest()


def folder_for(code):
    return hashlib.sha256(("folder:" + code_hash(code)).encode()).hexdigest()[:32]


def public_url(path):
    return f"{version.SFX_URL.rstrip('/')}/storage/v1/object/public/{BUCKET}/{urllib.parse.quote(path)}"


# ---------------------------------------------------------------- talking to Supabase

FRIENDLY = {
    "code": "That friend code isn't right.",
    "daily": "You've uploaded 100 sounds today. That's the limit, try again tomorrow.",
    "full": "The sound library is full. Delete some old sounds first.",
    "denied": "You can only delete sounds you uploaded.",
}


def _headers():
    key = version.SFX_KEY
    if key.startswith("sb_"):  # the newer "publishable" keys go only in apikey
        return {"apikey": key}
    return {"apikey": key, "Authorization": f"Bearer {key}"}


def _request(method, path, body=None, content_type="application/json", timeout=30):
    if not configured():
        raise Error("The sound library isn't set up in this version of the app yet.")
    data = json.dumps(body).encode() if content_type == "application/json" and body is not None else body
    request = urllib.request.Request(version.SFX_URL.rstrip("/") + path, data=data, method=method,
                                     headers={**_headers(), "Content-Type": content_type})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            text = response.read()
    except urllib.error.HTTPError as e:
        try:
            details = json.loads(e.read() or b"{}")
        except ValueError:
            details = {}
        if not isinstance(details, dict):
            details = {}
        hint = details.get("hint") or ""
        if hint in FRIENDLY:
            raise Error(FRIENDLY[hint]) from None
        message = details.get("message") or details.get("error") or ""
        if "exceeded the maximum allowed size" in message or e.code == 413:
            raise Error("That sound is too big. Sounds can be up to 10 MB.") from None
        raise Error(f"The sound library said no ({e.code}{': ' + message[:120] if message else ''}).") from None
    except (urllib.error.URLError, OSError):
        raise Error("Couldn't reach the sound library. Check your internet connection.") from None
    return json.loads(text) if text else None


def _rpc(name, **args):
    return _request("POST", f"/rest/v1/rpc/{name}", args)


# ---------------------------------------------------------------- the library

def _clean_name(text, limit=80):
    return re.sub(r"\s+", " ", str(text or "")).strip()[:limit]


class Library:
    def __init__(self):
        self.lock = threading.Lock()
        self.uploads = {}  # id -> a sound being prepared or uploaded
        self.ids = 0
        self.saved = set()  # files downloaded from the library (allowed for "show in folder")

    # ---- who you are

    def me(self):
        """A secret id for this PC: sounds uploaded with it can be deleted by it."""
        saved = settings.load()
        if not saved.get("sfx_me"):
            settings.save(sfx_me=secrets.token_hex(16))
            saved = settings.load()
        return saved["sfx_me"]

    def account(self):
        saved = settings.load()
        return {"configured": configured(), "joined": bool(saved.get("sfx_code")), "owner": bool(saved.get("sfx_owner")),
                "name": saved.get("sfx_name") or "", "categories": CATEGORIES}

    def join(self, code, owner_code=""):
        code = str(code or "").strip()
        if not code:
            raise Error("Type the friend code first.")
        result = _rpc("lelons_check", code=code, owner_code=str(owner_code or "").strip())
        owner = bool(result and result.get("owner"))
        if owner_code and not owner:
            raise Error("That owner code isn't right.")
        settings.save(sfx_code=code, **({"sfx_owner": str(owner_code).strip()} if owner else {}))
        return self.account()

    def leave(self):
        settings.save(sfx_code="", sfx_owner="")

    def set_name(self, name):
        settings.save(sfx_name=_clean_name(name, 40))

    def _code(self):
        code = settings.load().get("sfx_code")
        if not code:
            raise Error("Type the friend code first.")
        return code

    # ---- the list

    def sounds(self):
        rows = _rpc("lelons_list", code=self._code(), me=self.me()) or []
        return [{**row, "url": public_url(row["path"]), "categoryName": CATEGORIES.get(row["category"], "Other")}
                for row in rows]

    def delete(self, sound_id):
        saved = settings.load()
        path = _rpc("lelons_delete", code=self._code(), me=self.me(), owner_code=saved.get("sfx_owner") or "",
                    sound_id=str(sound_id))
        if path:
            try:  # the file itself; the sound is already gone from the list either way
                _request("DELETE", f"/storage/v1/object/{BUCKET}/{urllib.parse.quote(path)}")
            except Error:
                pass

    def download(self, url, name, folder):
        """Save a sound from the library in folder. Returns the file's path."""
        if not url.startswith(version.SFX_URL.rstrip("/") + "/storage/"):
            raise Error("That isn't a sound from the library.")
        os.makedirs(folder, exist_ok=True)
        stem = re.sub(r'[\\/:*?"<>|]+', "", _clean_name(name)).strip(". ") or "sound"
        temp = names.temp_path(folder, stem, ".mp3")
        try:
            with urllib.request.urlopen(urllib.request.Request(url), timeout=60) as response, open(temp, "wb") as out:
                while chunk := response.read(256 * 1024):
                    out.write(chunk)
            path = names.finish(temp)
        except (urllib.error.URLError, OSError):
            if os.path.exists(temp):
                os.remove(temp)
            raise Error("Couldn't download that sound. Check your internet connection.") from None
        self.saved.add(os.path.normcase(path))
        return path

    # ---- uploading

    def add(self, name, stream, length):
        """A dropped file, copied into the app's temporary folder."""
        os.makedirs(FOLDER, exist_ok=True)
        path = os.path.join(FOLDER, f"in-{uuid.uuid4().hex[:8]}{os.path.splitext(name)[1].lower()[:10]}")
        left = length
        with open(path, "wb") as out:
            while left > 0:
                chunk = stream.read(min(1024 * 1024, left))
                if not chunk:
                    break
                out.write(chunk)
                left -= len(chunk)
        if left:
            os.remove(path)
            raise Error("The file wasn't copied all the way.")
        return self._register(os.path.basename(name), path, copied=True)

    def add_path(self, path):
        return self._register(os.path.basename(path), path, copied=False)

    def _register(self, name, path, copied):
        found = media.probe(path)
        if not found["audio"]:
            if copied:
                os.remove(path)
            raise Error(f"{name} has no sound in it.")
        with self.lock:
            self.ids += 1
            item = {"id": str(self.ids), "file": name, "path": path, "copied": copied, "seconds": found["duration"],
                    "status": "ready", "message": "", "progress": 0,
                    "name": _clean_name(os.path.splitext(name)[0])}
            self.uploads[item["id"]] = item
        return self._public(item)

    def _public(self, item):
        return {k: item[k] for k in ("id", "file", "seconds", "status", "message", "progress", "name")}

    def find(self, upload_id):
        with self.lock:
            return self.uploads.get(str(upload_id))

    def forget(self, upload_id):
        with self.lock:
            item = self.uploads.get(str(upload_id))
            if not item or item["status"] == "uploading":
                return
            del self.uploads[item["id"]]
        if item["copied"]:
            try:
                os.remove(item["path"])
            except OSError:
                pass

    def snapshot(self):
        with self.lock:
            return [self._public(i) for i in self.uploads.values() if i["status"] != "ready"]

    @property
    def busy(self):
        with self.lock:
            return any(i["status"] == "uploading" for i in self.uploads.values())

    def upload(self, upload_id, name, category, trim=None):
        name = _clean_name(name)
        if not name:
            raise Error("Give the sound a name.")
        if category not in CATEGORIES:
            raise Error("Pick a category.")
        code = self._code()
        with self.lock:
            item = self.uploads.get(str(upload_id))
            if not item:
                raise Error("That file is gone. Pick it again.")
            if item["status"] == "uploading":
                return
            item.update(status="uploading", message="Getting it ready...", progress=0, name=name)
        threading.Thread(target=self._upload, args=(item, code, category, trim), daemon=True).start()

    def _set(self, item, **changes):
        with self.lock:
            item.update(changes)

    def _upload(self, item, code, category, trim):
        seconds = (trim[1] - trim[0]) if trim else item["seconds"]
        # As good as fits in 10 MB (most sounds are short, so 192 kbps).
        kbps = min(192, int(MAX_BYTES * 0.95 * 8 / max(seconds, 1) / 1000))
        os.makedirs(FOLDER, exist_ok=True)
        mp3 = os.path.join(FOLDER, f"up-{uuid.uuid4().hex[:8]}.mp3")
        try:
            if kbps < 48:
                raise Error(f"That's too long for the library (up to about {MAX_BYTES * 8 // 48000 // 60} minutes). Trim it shorter.")
            media.convert_audio(item["path"], mp3, "mp3", str(kbps), trim, False, seconds,
                                lambda p: self._set(item, progress=p, message=f"Getting it ready... {p:.0f}%"))
            size = os.path.getsize(mp3)
            if size > MAX_BYTES:
                raise Error("That sound is too big. Trim it shorter.")
            self._set(item, progress=0, message="Uploading...")
            path = f"{folder_for(code)}/{uuid.uuid4().hex}.mp3"
            with open(mp3, "rb") as f:
                _request("POST", f"/storage/v1/object/{BUCKET}/{path}", f.read(), "audio/mpeg", timeout=300)
            try:
                _rpc("lelons_add", code=code, me=self.me(), sound_name=item["name"], sound_category=category,
                     file=path, sound_seconds=round(seconds, 2), sound_bytes=size,
                     uploader_name=settings.load().get("sfx_name") or "")
            except Error:
                try:
                    _request("DELETE", f"/storage/v1/object/{BUCKET}/{path}")
                except Error:
                    pass
                raise
        except Exception as e:
            message = str(e) if isinstance(e, Error) else "Couldn't make an MP3 out of that file."
            self._set(item, status="error", message=message)
        else:
            self._set(item, status="done", progress=100, message="Uploaded! Everyone can hear it now.")
            timer = threading.Timer(8, self.forget, args=(item["id"],))  # the message goes away by itself
            timer.daemon = True
            timer.start()
            if item["copied"]:
                try:
                    os.remove(item["path"])
                except OSError:
                    pass
        finally:
            if os.path.exists(mp3):
                os.remove(mp3)

    def clear_done(self):
        with self.lock:
            for key in [k for k, i in self.uploads.items() if i["status"] == "done"]:
                del self.uploads[key]


library = Library()
