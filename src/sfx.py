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
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

import copycheck
import media
import names
import settings
import version
import waveform

BUCKET = "lelons-sounds"
CATEGORIES = {"sfx": "SFX", "music": "Music", "ambience": "Ambience"}  # (Memes and Other became SFX in 2.5.0)
# The genres you can pick inside each category (the Library's left side, like Artlist).
GENRES = {
    "music": ["Action", "Cinematic", "Epic", "Horror", "Chill", "Happy", "Sad", "Hip Hop", "Electronic"],
    "sfx": ["Whooshes", "Hits & Impacts", "Explosions", "Clicks & UI", "Footsteps", "Horror", "Funny", "Memes"],
    "ambience": ["Nature", "Rain & Weather", "City", "Indoor", "Creepy", "Sci-fi"],
}


def _genre(category, genre):
    """The genre if it belongs to the category, else "" (no genre)."""
    genre = str(genre or "").strip()
    return genre if genre in GENRES.get(category, []) else ""
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
    "bad_input": "Something about that wasn't right. Try again.",
    "same_name": "There's already a sound with that name. Pick another name.",
    "same_file": "That sound is already in the Library.",
    # what log in and create account can answer
    "username": "Usernames are 3 to 20 letters or numbers (dots, dashes and _ are fine too).",
    "password": "Passwords need at least 6 characters.",
    "taken": "That username is taken. Pick another one.",
    "wrong": "Wrong username or password.",
    "wrong_password": "That's not your current password.",
    "locked": "Too many wrong tries. Wait 2 minutes and try again.",
    "too_many": "The library has as many accounts as it can take.",
    "nobody": "There's no account with that name any more.",
    "owner": "The owner's account can't be deleted.",
    "nogroup": "That group is gone, or you're not in it any more.",
    "many": "A group can have up to 50 people.",
    "noplaylist": "That playlist is gone, or you're not in it any more.",
    "many_people": "A playlist can have up to 50 people.",
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
        share_peaks([(path, peaks)])
        return peaks


def share_peaks(items):
    """Save waveforms in the Library (in the background), so other apps don't have to download the sounds."""
    token = settings.load().get("library_token")
    if not token or not items:
        return

    def run():
        for path, peaks in items:
            try:
                _rpc("lelons_set_peaks", token=token, file=path, peaks=peaks)
            except Exception:
                return
    threading.Thread(target=run, daemon=True).start()


waveforms = Waveforms()


_token_lock = threading.Lock()


def drop_token(token):
    """Log out because this token stopped working, unless you logged in again meanwhile (a new token)."""
    with _token_lock:
        if settings.load().get("library_token") == token:
            settings.save(library_token="")
            presence.poke()


def _clean_name(text, limit=80):
    return re.sub(r"\s+", " ", str(text or "")).strip()[:limit]


class Library:
    def __init__(self):
        self.lock = threading.Lock()
        self.uploads = {}  # id -> a sound being prepared or uploaded
        self.ids = 0
        self.drag_lock = threading.Lock()
        self.drag_locks = {}  # one per sound being fetched for dragging
        self.peaks_shared = set()  # waveforms this app already sent to the Library
        self.saved = set()  # files downloaded from the library (allowed for "show in folder")
        self.channel_logged = {}  # channel url -> ((url, subs), when): what the stats last got

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
        base = {"configured": configured(), "categories": CATEGORIES, "genres": GENRES, "roles": ROLES}
        if not configured() or not settings.load().get("library_token"):
            return {**base, "user": None}
        token = self._token()
        try:
            return {**base, "user": self._user(_rpc("lelons_me", token=token))}
        except LoggedOut:
            drop_token(token)
            return {**base, "user": None}

    def _logged_in(self, result):
        if not result or not result.get("ok"):
            raise Error(FRIENDLY.get((result or {}).get("error"), "That didn't work. Try again."))
        settings.save(library_token=result["token"])
        presence.poke()
        return self.account()

    def signup(self, username, password):
        return self._logged_in(_rpc("lelons_signup", username=str(username or "").strip(), password=str(password or "")))

    def login(self, username, password):
        return self._logged_in(_rpc("lelons_login", username=str(username or "").strip(), password=str(password or "")))

    def logout(self):
        token = settings.load().get("library_token")
        settings.save(library_token="")
        presence.poke()
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

    # ---- the live chat

    def chat(self, after=0, with_user=None):
        """One conversation: the chat with everyone, or the private chat with with_user.
        Messages newer than after (0: the newest 100), recent reactions, your private chats, who's online."""
        try:
            after = max(0, int(after or 0))
        except (TypeError, ValueError):
            after = 0
        result = _rpc("lelons_chat_list", token=self._token(), after=after,
                      with_user=str(with_user) if with_user else None) or {}

        def pictured(row):
            return {**row, "avatarUrl": public_url(row["avatar"]) if row.get("avatar") else ""}

        messages = []
        for m in result.get("messages") or []:
            m = pictured(m)
            if m.get("sound"):
                m["sound"] = {**m["sound"], "url": public_url(m["sound"]["path"])}
            if m.get("file"):
                m["fileUrl"] = public_url(m["file"])
            messages.append(m)
        group = result.get("group")
        if group:
            group = {**group, "pictureUrl": public_url(group["picture"]) if group.get("picture") else "",
                     "members": [pictured(m) for m in group.get("members") or []]}
        return {"messages": messages, "recent": result.get("recent") or [],
                "private": [pictured(p) for p in result.get("private") or []],
                "groups": [{**g, "pictureUrl": public_url(g["picture"]) if g.get("picture") else ""}
                           for g in result.get("groups") or []],
                "group": group,
                "everyoneLast": result.get("everyone_last") or 0,
                "names": result.get("names"),  # (only on the first load of a chat)
                "online": presence.remember(result.get("online"))}

    def chat_send(self, message, to_user=None, sound_id=None, clip=None):
        """clip: (path, name, seconds) of a trim editor clip to send along (its sound, as an MP3)."""
        extra = {}
        if clip:
            extra = self._chat_clip(*clip)
        try:
            result = _rpc("lelons_chat_send", token=self._token(), message=str(message or ""),
                          to_user=str(to_user) if to_user else None, sound=str(sound_id) if sound_id else None,
                          **extra)
        except Exception:
            if extra:
                self._remove_file(extra["file"])
            raise
        if not result or not result.get("ok"):
            if extra:
                self._remove_file(extra["file"])
            raise Error({
                "short": "Write something first.",
                "long": "That's a bit long. Keep it under 500 letters.",
                "slow": "Slow down a little! Wait a few seconds.",
                "daily": "You've sent a lot today. Try again tomorrow.",
                "nobody": "That person doesn't have an account any more.",
                "yourself": "You can't send a private message to yourself.",
                "gone": "Someone deleted that sound.",
            }.get((result or {}).get("error"), "That didn't send. Try again."))
        for path in result.get("files") or []:  # clips of old messages that dropped off the end
            self._remove_file(path)

    def _chat_clip(self, path, name, seconds):
        """Upload a clip's sound for the chat. Returns what lelons_chat_send needs."""
        found = media.probe(path)
        if not found["audio"]:
            raise Error("That clip has no sound in it (GIFs don't), so it can't go in the chat.")
        seconds = seconds or found["duration"]
        kbps = min(192, int(MAX_BYTES * 0.95 * 8 / max(seconds, 1) / 1000))
        if kbps < 48:
            raise Error("That clip is too long to send. Keep it under about 20 minutes.")
        os.makedirs(FOLDER, exist_ok=True)
        mp3 = os.path.join(FOLDER, f"chat-{uuid.uuid4().hex[:8]}.mp3")
        try:
            media.convert_audio(path, mp3, "mp3", str(kbps), None, False, seconds, lambda p: None)
            if os.path.getsize(mp3) > MAX_BYTES:
                raise Error("That clip is too big to send. Make it shorter.")
            with open(mp3, "rb") as f:
                file = self._put_file("chat", f.read(), "audio/mpeg")
        except (OSError, RuntimeError) as e:
            raise Error("Couldn't send that clip. Check your internet connection.") from e
        finally:
            if os.path.exists(mp3):
                os.remove(mp3)
        return {"file": file, "file_name": _clean_name(name, 120), "file_seconds": round(seconds, 2)}

    def chat_group(self, what, group_id=None, name=None, usernames=None, picture=None):
        """Make a group chat, rename it, add or remove people, or leave it (see lelons_chat_group)."""
        if what not in ("create", "rename", "add", "remove", "leave", "picture"):
            raise Error("That didn't work. Try again.")
        names = [str(u) for u in usernames or [] if str(u).strip()][:49]  # (50 with you)
        result = _rpc("lelons_chat_group", token=self._token(), what=what, group_id=str(group_id) if group_id else None,
                      group_name=str(name) if name is not None else None, usernames=names or None, picture=picture) or {}
        if not result.get("ok"):
            raise Error({"name": "Give the group a name.",
                         "daily": "You've made a lot of groups today. Try again tomorrow.",
                         "denied": "Only the person who made the group can remove people.",
                         }.get(result.get("error")) or FRIENDLY.get(result.get("error"), "That didn't work. Try again."))
        for path in [result.get("old_picture"), *(result.get("files") or [])]:
            self._remove_file(path)
        group = result.get("group")
        if group:
            result["group"] = {**group, "pictureUrl": public_url(group["picture"]) if group.get("picture") else "",
                               "members": [{**m, "avatarUrl": public_url(m["avatar"]) if m.get("avatar") else ""}
                                           for m in group.get("members") or []]}
        return result

    def set_group_picture(self, group_id, data):
        """A group chat's picture from an image file's bytes: cut to a square and made small."""
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
            return self.chat_group("picture", group_id, picture=path)
        except Error:
            self._remove_file(path)
            raise

    def chat_typing(self, with_user=None, stop=False):
        _rpc("lelons_chat_typing", token=self._token(), with_user=str(with_user) if with_user else None, stop=bool(stop))

    def chat_live(self, with_user=None, seen_id=None):
        """Who's typing in this chat right now, and how far each person has read (and say how far you have)."""
        try:
            seen_id = int(seen_id) if seen_id else None
        except (TypeError, ValueError):
            seen_id = None
        result = _rpc("lelons_chat_live", token=self._token(), with_user=str(with_user) if with_user else None,
                      seen_id=seen_id) or {}
        return {"typing": result.get("typing") or [],
                "seen": [{**row, "avatarUrl": public_url(row["avatar"]) if row.get("avatar") else ""}
                         for row in result.get("seen") or []]}

    def chat_react(self, message_id, emoji, on):
        _rpc("lelons_chat_react", token=self._token(), message_id=int(message_id), emoji=str(emoji), on_off=bool(on))

    def chat_delete(self, message_id):
        self._remove_file(_rpc("lelons_chat_delete", token=self._token(), message_id=int(message_id)))

    def room(self, what, room_id=None, with_user=None, to_user=None, kind=None, sdp=None, after=0):
        """Calls (private and group): "check" (every few seconds), "start", "join", "signal" or "leave"
        (see lelons_room)."""
        if what not in ("check", "start", "join", "signal", "leave"):
            raise Error("That didn't work. Try again.")
        try:
            after = max(0, int(after or 0))
        except (TypeError, ValueError):
            after = 0
        result = _rpc("lelons_room", token=self._token(), what=what, room_id=str(room_id) if room_id else None,
                      with_user=str(with_user) if with_user else None, to_user=str(to_user) if to_user else None,
                      kind=str(kind) if kind else None, sdp=str(sdp) if sdp else None, after=after) or {}
        if not result.get("ok"):
            raise Error({"yourself": "You can't call yourself.",
                         "slow": "Slow down a little! Wait a moment before calling again.",
                         "daily": "You've made a lot of calls today. Try again tomorrow.",
                         "in_call": "You're already in a call. Hang up first.",
                         "offline": f"{with_user} isn't online right now. They need the app open to get your call.",
                         "busy": f"{with_user} is in another call right now.",
                         "gone": "That call already ended.",
                         "full": "That call is full (9 people at most).",
                         }.get(result.get("error"), "The call didn't work. Try again."))

        def pictured(row):
            return {**row, "avatarUrl": public_url(row["avatar"]) if row.get("avatar") else ""}

        rooms = []
        for room in result.get("rooms") or []:
            group = room.get("group")
            if group:
                group = {**group, "pictureUrl": public_url(group["picture"]) if group.get("picture") else ""}
            rooms.append({**room, "group": group, "people": [pictured(p) for p in room.get("people") or []]})
        result["rooms"] = rooms
        return result

    def profile(self, username):
        result = _rpc("lelons_profile", token=self._token(), username=str(username or ""))
        result["avatarUrl"] = public_url(result["avatar"]) if result.get("avatar") else ""
        result["recent"] = [{**s, "url": public_url(s["path"])} for s in result.get("recent") or []]
        return result

    # ---- the Home page

    def home(self):
        """The channels the owner picked (None: the app's own list), and when logged in the newest
        sounds and chat messages."""
        token = settings.load().get("library_token") or None
        result = _rpc("lelons_home", token=token) or {}
        if token and not result.get("logged_in"):
            drop_token(token)

        def pictured(picture):
            return public_url(picture) if picture else ""

        return {
            "channels": result.get("channels"),
            "loggedIn": bool(result.get("logged_in")),
            "isOwner": bool(result.get("is_owner")),
            "sounds": [{**row, "url": public_url(row["path"]), "categoryName": CATEGORIES.get(row["category"], "SFX"),
                        "uploaderAvatar": pictured(row.get("uploader_avatar"))}
                       for row in result.get("sounds") or []],
            "chat": [{**m, "avatarUrl": pictured(m.get("avatar"))} for m in result.get("chat") or []],
            "activity": [{**item, "avatarUrl": pictured(item.get("avatar")),
                          **({"url": public_url(item["path"]), "categoryName": CATEGORIES.get(item.get("category"), "SFX")}
                             if item.get("kind") == "upload" and item.get("path") else {})}
                         for item in result.get("activity") or []],
        }

    def log_channel(self, url, info):
        """Remember a channel's subscribers for today (the stats page), at most once an hour unless they changed."""
        token = settings.load().get("library_token")
        subs = info.get("subscribers")
        if not token or not configured() or subs is None:
            return
        key = (url, subs)
        with self.lock:
            last = self.channel_logged.get(url)
            if last and last[0] == key and time.time() - last[1] < 3600:
                return
        _rpc("lelons_channel_log", token=token, channel=url, subs=int(subs), videos=None)
        with self.lock:  # (only once it worked: a failed one is tried again next time)
            self.channel_logged[url] = (key, time.time())

    def channel_history(self, days):
        return _rpc("lelons_channel_history", token=self._token(), days=int(days)) or []

    def set_channels(self, urls):
        result = _rpc("lelons_set_channels", token=self._token(), urls=list(urls))
        if not result or not result.get("ok"):
            raise Error({"many": "That's a lot of channels. 12 is the most."}.get((result or {}).get("error"),
                        "One of those isn't a YouTube channel link."))

    def favorite(self, sound_id, starred):
        _rpc("lelons_favorite", token=self._token(), sound_id=str(sound_id), starred=bool(starred))

    # ---- playlists: your own lists of sounds, only for you and the people you invite

    def _playlists_result(self, result):
        pictured = lambda row: {**row, "avatarUrl": public_url(row["avatar"]) if row.get("avatar") else ""}  # noqa: E731
        return {"playlists": [{**p, "ownerAvatar": public_url(p["owner_avatar"]) if p.get("owner_avatar") else "",
                               "members": [pictured(m) for m in p.get("members") or []]}
                              for p in result.get("playlists") or []],
                "people": [pictured(m) for m in result.get("people") or []],
                **({"id": result["id"]} if result.get("id") else {})}

    def playlists(self):
        return self._playlists_result(_rpc("lelons_playlists", token=self._token()) or {})

    def playlist(self, what, playlist_id=None, name=None, sound_id=None, usernames=None):
        """Make, rename or delete a playlist, put a sound in or take it out, invite or remove people, or leave one."""
        if what not in ("create", "rename", "delete", "add", "take_out", "invite", "remove", "leave"):
            raise Error("That didn't work. Try again.")
        people = [str(u) for u in usernames or [] if str(u).strip()][:50]
        result = _rpc("lelons_playlist", token=self._token(), what=what,
                      playlist_id=str(playlist_id) if playlist_id else None,
                      playlist_name=_clean_name(name, 50) if name is not None else None,
                      sound_id=str(sound_id) if sound_id else None, usernames=people or None) or {}
        if not result.get("ok"):
            raise Error({"name": "Give the playlist a name.",
                         "denied": "Only the person who made the playlist can do that.",
                         "many_lists": "You have a lot of playlists already (100 is the most).",
                         "many_sounds": "That playlist is full (2000 sounds is the most).",
                         }.get(result.get("error")) or FRIENDLY.get(result.get("error"), "That didn't work. Try again."))
        return self._playlists_result(result)

    def delete_me(self, password):
        """Deletes your own account (your sounds stay) and logs you out."""
        result = _rpc("lelons_delete_me", token=self._token(), password=str(password or ""))
        if not result or not result.get("ok"):
            error = (result or {}).get("error")
            raise Error(FRIENDLY["wrong_password" if error == "wrong" else error] if error in FRIENDLY or error == "wrong"
                        else "That didn't work. Try again.")
        for path in [result.get("avatar"), *(result.get("files") or [])]:
            self._remove_file(path)
        settings.save(library_token="")
        presence.poke()
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
            sounds = [{**row, "url": public_url(row["path"]), "categoryName": CATEGORIES.get(row["category"], "SFX"),
                       "uploaderAvatar": public_url(row["uploader_avatar"]) if row.get("uploader_avatar") else "",
                       "peaks": row.get("peaks") or known.get(row["path"])} for row in rows]
            # Waveforms only this PC has (older sounds): share them once.
            unshared = [(row["path"], known[row["path"]]) for row in rows
                        if not row.get("peaks") and known.get(row["path"]) and row["path"] not in self.peaks_shared][:40]
            self.peaks_shared.update(path for path, _ in unshared)
        share_peaks(unshared)
        song_check.want(sounds, self._token)
        return song_check.fill_in(sounds)

    def songs_checking(self):
        return song_check.waiting_count()

    def edit(self, sound_id, name, category, genre=""):
        name = _clean_name(name)
        if not name:
            raise Error("Give the sound a name.")
        if category not in CATEGORIES:
            raise Error("Pick a category.")
        _rpc("lelons_edit_sound", token=self._token(), sound_id=str(sound_id), sound_name=name, sound_category=category,
             sound_genre=_genre(category, genre))

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
        digest = hashlib.sha256()
        try:
            with open(path, "rb") as f:
                for chunk in iter(lambda: f.read(1024 * 1024), b""):
                    digest.update(chunk)
        except OSError:
            pass
        with self.lock:
            self.ids += 1
            item = {"id": str(self.ids), "file": name, "path": path, "copied": copied, "seconds": found["duration"],
                    "hash": digest.hexdigest(),
                    "status": "ready", "message": "", "progress": 0,
                    "name": _clean_name(os.path.splitext(name)[0])}
            self.uploads[item["id"]] = item
        public = self._public(item)
        # Already in the Library? Said right away (the page then asks for a part of it or another file).
        try:
            clash = _rpc("lelons_sound_check", token=self._token(), sound_name="", sound_hash=item["hash"])
            if clash and clash.get("why") == "same_file":
                public["duplicate"] = {"name": clash.get("name"), "uploader": clash.get("uploader")}
        except Exception:
            pass  # checked again when it's uploaded
        return public

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

    def upload(self, upload_id, name, category, trim=None, genre=""):
        name = _clean_name(name)
        if not name:
            raise Error("Give the sound a name.")
        if category not in CATEGORIES:
            raise Error("Pick a category.")
        token = self._token()
        with self.lock:
            item = self.uploads.get(str(upload_id))
            if not item or (item["copied"] and not item["path"]):
                raise Error("That file is gone. Pick it again.")
            if item["status"] == "uploading":
                return
        # The same file (the same part of it, when trimmed) can only be in the Library once, and
        # every name only once. Asked first, so it doesn't convert for nothing.
        same = self.sound_hash(item, trim)
        clash = _rpc("lelons_sound_check", token=token, sound_name=name, sound_hash=same)
        if clash:
            if clash.get("why") == "same_name":
                raise Error(f"There's already a sound called \"{clash.get('name')}\". Pick another name.")
            by = f" ({clash.get('uploader')} uploaded it as \"{clash.get('name')}\")" if clash.get("uploader") else ""
            raise Error(f"That sound is already in the Library{by}.")
        with self.lock:
            if item["status"] == "uploading":
                return
            item.update(status="uploading", message="Getting it ready...", progress=0, name=name)
        threading.Thread(target=self._upload, args=(item, token, category, trim, _genre(category, genre)), daemon=True).start()

    @staticmethod
    def sound_hash(item, trim):
        """Which file this is (and which part of it, if trimmed to a smaller part)."""
        if not item.get("hash"):
            return None
        if trim and (trim[0] > 0.05 or trim[1] < item["seconds"] - 0.05):
            return hashlib.sha256(f"{item['hash']}:{trim[0]:.1f}-{trim[1]:.1f}".encode()).hexdigest()
        return item["hash"]

    def _set(self, item, **changes):
        with self.lock:
            item.update(changes)

    def _upload(self, item, token, category, trim, genre=""):
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
                     file=path, sound_seconds=round(seconds, 2), sound_bytes=size, sound_hash=self.sound_hash(item, trim),
                     sound_genre=genre or None, sound_peaks=peaks)
            except Exception:
                self._remove_file(path)  # uploaded, but it didn't make it into the list: nothing uses it
                raise
            waveforms.remember(path, peaks)
        except Exception as e:
            message = str(e) if isinstance(e, Error) else "Couldn't make an MP3 out of that file."
            self._set(item, status="error", message=message)
            if item["copied"]:  # nothing reads it again, and it can be a big file
                try:
                    os.remove(item["path"])
                except OSError:
                    pass
                self._set(item, path="")
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


class SongCheck:
    """Checks the Library sounds nobody checked yet for known (copyrighted) songs, one at a time in
    the background, and saves the answer in the Library so everyone's app sees it (and nobody checks
    that sound again). Short sounds are skipped: the song database can't match them anyway."""

    SHORT = 8  # seconds
    RETRY = 15 * 60  # after the song database couldn't be reached

    def __init__(self):
        self.lock = threading.Lock()
        self.waiting = {}  # id -> sound, in the order they came
        self.found = {}  # id -> answer (until the list from the Library has it too)
        self.failed_at = 0.0
        self.thread = None

    def want(self, sounds, token):
        with self.lock:
            if time.time() - self.failed_at < self.RETRY:
                return
            for sound in sounds:
                if sound.get("copyright") is None and sound["id"] not in self.found:
                    self.waiting.setdefault(sound["id"], sound)
            if self.waiting and not (self.thread and self.thread.is_alive()):
                self.thread = threading.Thread(target=self._run, args=(token,), daemon=True)
                self.thread.start()

    def fill_in(self, sounds):
        with self.lock:
            for sound in sounds:
                if sound.get("copyright") is not None:
                    self.found.pop(sound["id"], None)
                elif sound["id"] in self.found:
                    sound["copyright"] = self.found[sound["id"]]
        return sounds

    def remember(self, sound_id):
        """Save the answer of a check the user asked for by hand, so everyone's Library shows it."""
        def save(answer):
            try:
                _rpc("lelons_set_copyright", token=library._token(), sound_id=sound_id, result=answer)
            except Exception:
                return
            with self.lock:
                self.found[sound_id] = answer
                self.waiting.pop(sound_id, None)
        return save

    def waiting_count(self):
        with self.lock:
            return len(self.waiting)

    def _next(self):
        with self.lock:
            return next(iter(self.waiting.values()), None)

    def _run(self, token):
        while (sound := self._next()) is not None:
            try:
                if not _rpc("lelons_claim_check", token=token(), sound_id=sound["id"]):
                    with self.lock:  # someone else's app is checking it (or did already)
                        self.waiting.pop(sound["id"], None)
                    continue
                if (sound.get("seconds") or 0) < self.SHORT:
                    answer = {"match": None, "short": True}
                else:
                    if not copycheck.fpcalc():
                        raise copycheck.Error("missing fpcalc")
                    try:
                        path = library.drag_copy(sound["url"], sound["name"])
                    except Error:
                        with self.lock:  # (gone from storage, say) skipped until the app opens again
                            self.found[sound["id"]] = None
                            self.waiting.pop(sound["id"], None)
                        continue
                    try:
                        found = copycheck.fingerprint(path)
                    except copycheck.Error:
                        found = None
                    answer = {"match": copycheck.lookup(*found)} if found else {"match": None, "unreadable": True}
                _rpc("lelons_set_copyright", token=token(), sound_id=sound["id"], result=answer)
                with self.lock:
                    self.found[sound["id"]] = answer
                    self.waiting.pop(sound["id"], None)
            except Exception:
                # No internet, the song database is down, logged out...: try again later, from the start.
                with self.lock:
                    self.failed_at = time.time()
                    self.waiting.clear()
                return


song_check = SongCheck()


class Presence:
    """Tells the library this app is open (every minute), and keeps how many are online."""

    EVERY = 60

    def __init__(self):
        self.lock = threading.Lock()
        self.online = None  # {"online": n, "people": [...]}, or None if it isn't known
        self.wake = threading.Event()
        self.started = False

    def client_id(self):
        saved = settings.load().get("client_id")
        if not (isinstance(saved, str) and re.fullmatch(r"[0-9a-f]{32}", saved)):
            saved = uuid.uuid4().hex  # a random number for this PC; it says nothing about who you are
            settings.save(client_id=saved)
        return saved

    def remember(self, online):
        if isinstance(online, dict) and "online" in online:
            people = [{**p, "avatarUrl": public_url(p["avatar"]) if p.get("avatar") else ""}
                      for p in online.get("people") or []]
            with self.lock:
                self.online = {"online": int(online["online"]), "people": people}
        return self.get()

    def get(self):
        with self.lock:
            return self.online

    def start(self):
        if self.started or not configured():
            return
        self.started = True
        threading.Thread(target=self._loop, daemon=True).start()

    def poke(self):
        """Logged in or out: say so now instead of in a minute."""
        self.wake.set()

    def _loop(self):
        failed = 0
        while True:
            try:
                token = settings.load().get("library_token") or ""
                self.remember(_rpc("lelons_ping", client_id=self.client_id(), token=token))
                failed = 0
            except Exception:
                failed += 1
                if failed >= 3:  # offline (or the library isn't set up for this yet)
                    with self.lock:
                        self.online = None
            self.wake.wait(self.EVERY)
            self.wake.clear()

    def bye(self):
        if not self.started:
            return
        try:
            _request("POST", "/rest/v1/rpc/lelons_bye", {"client_id": self.client_id()}, timeout=3)
        except Exception:
            pass


presence = Presence()


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
