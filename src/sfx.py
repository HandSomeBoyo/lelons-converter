"""The Library tab: sounds and music shared with friends, who log in with an account.

Everything lives in a Supabase project (see sfx/setup.sql): accounts, roles
and the list of sounds in its database, the MP3s and profile pictures in its
storage. The database checks who may do what (owner, admin or viewer); the app
only keeps the login token.
"""

import array
import hashlib
import json
import os
import re
import shutil
import subprocess
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
PEAKS_FILE = os.path.join(settings.DATA_DIR, "sfx-waveforms.json")
DRAG_DIR = os.path.join(settings.DATA_DIR, "Library sounds")  # sounds dragged into other apps
KEPT_MARK = ".dragged"  # in a sound's folder there: it was dragged somewhere, so keep it
BARS = 72  # bars in each sound's little waveform
UPLOAD_KINDS = [
    ("Sounds and videos", ";".join("*." + e for e in (
        "mp3 m4a wav flac ogg opus wma aac aiff aif amr mp4 mkv mov avi wmv webm m4v".split()))),
    ("All files", "*.*"),
]


class Error(Exception):
    """Something went wrong; the message is shown as it is."""


class LoggedOut(Error):
    """The login token isn't valid anymore: the page shows the log in screen."""


def configured():
    return bool(version.SFX_URL and version.SFX_KEY)


def public_url(path):
    return f"{version.SFX_URL.rstrip('/')}/storage/v1/object/public/{BUCKET}/{urllib.parse.quote(path)}"


# ---------------------------------------------------------------- talking to Supabase

FRIENDLY = {
    "daily": "You've uploaded a lot today. That's the limit, try again tomorrow.",
    "full": "The library is full. Delete some old sounds first.",
    "denied": "Your account isn't allowed to do that. Ask the owner.",
    "gone": "Someone already deleted that sound.",
    # what log in and create account can answer
    "username": "Usernames are 3 to 20 letters or numbers (dots, dashes and _ are fine too).",
    "password": "Passwords need at least 6 characters.",
    "taken": "That username is taken. Pick another one.",
    "wrong": "Wrong username or password.",
    "wrong_password": "That's not your current password.",
    "locked": "Too many wrong tries. Wait 2 minutes and try again.",
    "too_many": "The library has as many accounts as it can take.",
    "owner": "The owner's account can't be deleted.",
}
ROLES = {"owner": "Owner", "admin": "Admin", "viewer": "Viewer"}


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
        if hint == "login":
            raise LoggedOut("You were logged out. Log in again.") from None
        if hint in FRIENDLY:
            raise Error(FRIENDLY[hint]) from None
        message = details.get("message") or details.get("error") or ""
        if "exceeded the maximum allowed size" in message or e.code == 413:
            raise Error("That file is too big. Sounds can be up to 10 MB.") from None
        if e.code == 404 and (details.get("code") == "PGRST202" or "function" in message):
            raise Error("The library needs its newest setup. The owner has to run the new setup.sql in Supabase.") from None
        raise Error(f"The sound library said no ({e.code}{': ' + message[:120] if message else ''}).") from None
    except (urllib.error.URLError, OSError):
        raise Error("Couldn't reach the sound library. Check your internet connection.") from None
    return json.loads(text) if text else None


def _rpc(name, **args):
    return _request("POST", f"/rest/v1/rpc/{name}", args)


# ---------------------------------------------------------------- the library

def _peaks_of(path):
    """BARS loudness values (0 to 1) for drawing a sound."""
    try:
        pcm = subprocess.run([media.ffmpeg(), "-v", "error", "-nostdin", "-i", path, "-ac", "1", "-ar", "4000",
                              "-f", "s16le", "-"], capture_output=True, timeout=120, creationflags=media.NO_WINDOW).stdout
    except subprocess.TimeoutExpired:
        pcm = b""
    samples = array.array("h")
    samples.frombytes(pcm[: len(pcm) // 2 * 2])
    if not samples:
        return [0] * BARS
    step = len(samples) / BARS
    peaks = []
    for i in range(BARS):
        chunk = samples[int(i * step):max(int((i + 1) * step), int(i * step) + 1)]
        peaks.append(max(max(chunk), -min(chunk)) if chunk else 0)
    loudest = max(peaks) or 1
    return [round((p / loudest) ** 0.6, 2) for p in peaks]  # quiet parts stay visible


class Waveforms:
    """Each library sound's waveform, made once (downloads the sound) and kept on the PC."""

    def __init__(self):
        self.lock = threading.Lock()
        self.busy = threading.Semaphore(2)  # sounds downloaded at the same time
        self.known = None
        self.save_timer = None
        self.save_lock = threading.Lock()

    def _load(self):
        if self.known is None:
            try:
                with open(PEAKS_FILE, encoding="utf-8") as f:
                    self.known = json.load(f)
            except (OSError, ValueError):
                self.known = {}
        return self.known

    def remember(self, path, peaks):
        with self.lock:
            known = self._load()
            known[path] = peaks
            while len(known) > 5000:
                del known[next(iter(known))]
            # Saved a few seconds later, once for a whole batch of new waveforms.
            if not self.save_timer:
                self.save_timer = threading.Timer(3, self.save)
                self.save_timer.daemon = True
                self.save_timer.start()

    def save(self):
        with self.lock:
            if self.save_timer:
                self.save_timer.cancel()
            self.save_timer = None
            if self.known is None:
                return
            text = json.dumps(self.known)
        try:
            os.makedirs(settings.DATA_DIR, exist_ok=True)
            with self.save_lock:
                with open(PEAKS_FILE + ".new", "w", encoding="utf-8") as f:
                    f.write(text)
                os.replace(PEAKS_FILE + ".new", PEAKS_FILE)
        except OSError:
            pass

    def get(self, path):
        with self.lock:
            found = self._load().get(path)
        if found:
            return found
        with self.busy:
            with self.lock:
                found = self._load().get(path)
            if found:
                return found
            os.makedirs(FOLDER, exist_ok=True)
            temp = os.path.join(FOLDER, f"wave-{uuid.uuid4().hex[:8]}.mp3")
            try:
                with urllib.request.urlopen(public_url(path), timeout=60) as response, open(temp, "wb") as out:
                    out.write(response.read(MAX_BYTES + 1))
                peaks = _peaks_of(temp)
            except (urllib.error.URLError, OSError):
                raise Error("Couldn't load the waveform.") from None
            finally:
                if os.path.exists(temp):
                    os.remove(temp)
        self.remember(path, peaks)
        return peaks


waveforms = Waveforms()


def _clean_name(text, limit=80):
    return re.sub(r"\s+", " ", str(text or "")).strip()[:limit]


class Library:
    def __init__(self):
        self.lock = threading.Lock()
        self.uploads = {}  # id -> a sound being prepared or uploaded
        self.ids = 0
        self.drag_lock = threading.Lock()
        self.drag_locks = {}  # one per sound being fetched for dragging
        self.saved = set()  # files downloaded from the library (allowed for "show in folder")

    # ---- who you are

    def _token(self):
        token = settings.load().get("library_token")
        if not token:
            raise LoggedOut("Log in first.")
        return token

    def _user(self, account):
        return {**account, "roleName": ROLES.get(account["role"], "Viewer"),
                "avatarUrl": public_url(account["avatar"]) if account.get("avatar") else "",
                "canUpload": account["role"] in ("owner", "admin"), "isOwner": account["role"] == "owner"}

    def account(self):
        """Who's logged in (asks Supabase), or None."""
        base = {"configured": configured(), "categories": CATEGORIES, "roles": ROLES}
        if not configured() or not settings.load().get("library_token"):
            return {**base, "user": None}
        try:
            return {**base, "user": self._user(_rpc("lelons_me", token=self._token()))}
        except LoggedOut:
            settings.save(library_token="")
            return {**base, "user": None}

    def _logged_in(self, result):
        if not result or not result.get("ok"):
            raise Error(FRIENDLY.get((result or {}).get("error"), "That didn't work. Try again."))
        settings.save(library_token=result["token"])
        return self.account()

    def signup(self, username, password):
        return self._logged_in(_rpc("lelons_signup", username=str(username or "").strip(), password=str(password or "")))

    def login(self, username, password):
        return self._logged_in(_rpc("lelons_login", username=str(username or "").strip(), password=str(password or "")))

    def logout(self):
        token = settings.load().get("library_token")
        settings.save(library_token="")
        if token:
            try:
                _rpc("lelons_logout", token=token)
            except Error:
                pass

    def change_password(self, old, new):
        result = _rpc("lelons_password", token=self._token(), old_password=str(old or ""), new_password=str(new or ""))
        if not result or not result.get("ok"):
            error = (result or {}).get("error")
            raise Error(FRIENDLY["wrong_password" if error == "wrong" else error] if error in FRIENDLY or error == "wrong"
                        else "That didn't work. Try again.")

    def rename(self, username):
        result = _rpc("lelons_rename", token=self._token(), new_username=str(username or ""))
        if not result or not result.get("ok"):
            error = (result or {}).get("error")
            raise Error(FRIENDLY.get(error, "That didn't work. Try again."))
        return self.account()

    # ---- feedback for the owner

    def send_feedback(self, kind, message):
        result = _rpc("lelons_feedback_send", token=self._token(), kind=str(kind or "other"),
                      message=str(message or ""), app_version=version.VERSION)
        if not result or not result.get("ok"):
            raise Error({
                "short": "Write a little more so the owner knows what you mean.",
                "long": "That's a bit long. Keep it under 2000 letters.",
                "daily": "You've sent a lot today. Try again tomorrow.",
            }.get((result or {}).get("error"), "That didn't send. Try again."))

    def feedback(self):
        rows = _rpc("lelons_feedback_list", token=self._token()) or []
        return [{**row, "avatarUrl": public_url(row["avatar"]) if row.get("avatar") else ""} for row in rows]

    def set_feedback(self, feedback_id, done=False, remove=False):
        _rpc("lelons_feedback_set", token=self._token(), feedback_id=str(feedback_id), is_done=bool(done),
             remove=bool(remove))
        return self.feedback()

    def favorite(self, sound_id, starred):
        _rpc("lelons_favorite", token=self._token(), sound_id=str(sound_id), starred=bool(starred))

    def delete_me(self, password):
        """Deletes your own account (your sounds stay) and logs you out."""
        result = _rpc("lelons_delete_me", token=self._token(), password=str(password or ""))
        if not result or not result.get("ok"):
            error = (result or {}).get("error")
            raise Error(FRIENDLY["wrong_password" if error == "wrong" else error] if error in FRIENDLY or error == "wrong"
                        else "That didn't work. Try again.")
        self._remove_file(result.get("avatar"))
        settings.save(library_token="")
        return self.account()

    def _put_file(self, kind, data, content_type):
        """Upload a file with a ticket from the database. Returns its path in storage."""
        path = _rpc("lelons_ticket", token=self._token(), kind=kind)
        _request("POST", f"/storage/v1/object/{BUCKET}/{path}", data, content_type, timeout=300)
        return path

    def _remove_file(self, path):
        if path:
            try:  # the file itself; nothing uses it anymore either way
                _request("DELETE", f"/storage/v1/object/{BUCKET}/{urllib.parse.quote(path)}")
            except Error:
                pass

    def set_picture(self, data):
        """A new profile picture from an image file's bytes: cut to a square and made small."""
        import io

        from PIL import Image, ImageOps

        try:
            with Image.open(io.BytesIO(data)) as im:
                im = ImageOps.exif_transpose(im).convert("RGB")
                im = ImageOps.fit(im, (256, 256), Image.LANCZOS)
                out = io.BytesIO()
                im.save(out, "JPEG", quality=88)
        except (OSError, ValueError, Image.DecompressionBombError):
            raise Error("That isn't a picture the app can open.") from None
        path = self._put_file("avatar", out.getvalue(), "image/jpeg")
        try:
            old = _rpc("lelons_set_avatar", token=self._token(), file=path)
        except Error:
            self._remove_file(path)
            raise
        self._remove_file(old)
        return self.account()

    def remove_picture(self):
        self._remove_file(_rpc("lelons_set_avatar", token=self._token(), file=None))
        return self.account()

    # ---- the owner's People menu

    def people(self):
        return [{**self._user(person), "created_at": person["created_at"], "last_seen": person["last_seen"],
                 "sounds": person["sounds"], "me": person["me"]}
                for person in _rpc("lelons_accounts", token=self._token()) or []]

    def set_role(self, account_id, role):
        if role not in ("admin", "viewer"):
            raise Error("Pick Admin or Viewer.")
        _rpc("lelons_set_role", token=self._token(), account_id=str(account_id), new_role=role)

    def remove_person(self, account_id):
        self._remove_file(_rpc("lelons_remove_account", token=self._token(), account_id=str(account_id)))

    # ---- the list

    def sounds(self):
        rows = _rpc("lelons_list", token=self._token()) or []
        with waveforms.lock:
            known = waveforms._load()
            return [{**row, "url": public_url(row["path"]), "categoryName": CATEGORIES.get(row["category"], "Other"),
                     "uploaderAvatar": public_url(row["uploader_avatar"]) if row.get("uploader_avatar") else "",
                     "peaks": known.get(row["path"])} for row in rows]

    def delete(self, sound_id):
        self._remove_file(_rpc("lelons_delete", token=self._token(), sound_id=str(sound_id)))

    def download(self, url, name, folder):
        """Save a sound from the library in folder. Returns the file's path."""
        if not url.startswith(version.SFX_URL.rstrip("/") + "/storage/"):
            raise Error("That isn't a sound from the library.")
        os.makedirs(folder, exist_ok=True)
        stem = names.safe_stem(name, "sound")
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

    def drag_copy(self, url, name, dragged=False):
        """A copy of a sound to drag into another app. Downloaded once; later drags reuse it.
        Copies that were really dragged are kept for good (video editors keep pointing at
        the file); ones only made because the mouse went over a sound are tidied up later."""
        if not url.startswith(version.SFX_URL.rstrip("/") + "/storage/"):
            raise Error("That isn't a sound from the library.")
        stem = names.safe_stem(name, "sound")
        folder = os.path.join(DRAG_DIR, hashlib.sha1(url.encode()).hexdigest()[:12])
        path = os.path.join(folder, stem + ".mp3")
        with self.drag_lock:
            lock = self.drag_locks.setdefault(folder, threading.Lock())
        with lock:  # one download per sound; other sounds don't wait for it
            if not os.path.isfile(path):
                os.makedirs(folder, exist_ok=True)
                temp = path + ".part"
                try:
                    with urllib.request.urlopen(urllib.request.Request(url), timeout=60) as response, open(temp, "wb") as out:
                        while chunk := response.read(256 * 1024):
                            out.write(chunk)
                    os.replace(temp, path)
                except (urllib.error.URLError, OSError):
                    if os.path.exists(temp):
                        os.remove(temp)
                    raise Error("Couldn't download that sound. Check your internet connection.") from None
            if dragged:
                try:
                    open(os.path.join(folder, KEPT_MARK), "a").close()
                except OSError:
                    pass
        return path

    # ---- uploading

    def add(self, name, stream, length):
        """A dropped file, copied into the app's temporary folder."""
        os.makedirs(FOLDER, exist_ok=True)
        path = os.path.join(FOLDER, f"in-{uuid.uuid4().hex[:8]}{os.path.splitext(name)[1].lower()[:10]}")
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
            left = left or 1  # stopped halfway (the window closed, say)
        if left:
            if os.path.exists(path):
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
        token = self._token()
        with self.lock:
            item = self.uploads.get(str(upload_id))
            if not item:
                raise Error("That file is gone. Pick it again.")
            if item["status"] == "uploading":
                return
            item.update(status="uploading", message="Getting it ready...", progress=0, name=name)
        threading.Thread(target=self._upload, args=(item, token, category, trim), daemon=True).start()

    def _set(self, item, **changes):
        with self.lock:
            item.update(changes)

    def _upload(self, item, token, category, trim):
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
            peaks = _peaks_of(mp3)
            if size > MAX_BYTES:
                raise Error("That sound is too big. Trim it shorter.")
            self._set(item, progress=0, message="Uploading...")
            with open(mp3, "rb") as f:
                path = self._put_file("sound", f.read(), "audio/mpeg")
            try:
                _rpc("lelons_add", token=token, sound_name=item["name"], sound_category=category,
                     file=path, sound_seconds=round(seconds, 2), sound_bytes=size)
            except Exception:
                self._remove_file(path)  # uploaded, but it didn't make it into the list: nothing uses it
                raise
            waveforms.remember(path, peaks)
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


def clean_drag_copies():
    """Delete the Library sound copies that were never dragged anywhere (and half-downloaded ones)."""
    try:
        folders = os.listdir(DRAG_DIR)
    except OSError:
        return
    for name in folders:
        folder = os.path.join(DRAG_DIR, name)
        if not os.path.isdir(folder):
            continue
        if os.path.exists(os.path.join(folder, KEPT_MARK)):
            for leftover in os.listdir(folder):
                if leftover.endswith(".part"):
                    try:
                        os.remove(os.path.join(folder, leftover))
                    except OSError:
                        pass
        else:
            shutil.rmtree(folder, ignore_errors=True)
