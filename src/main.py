"""VaultHub (was Lelons Converter, then Ultimate Recording) - paste a YouTube link, pick MP3 or MP4, convert.

The window is a Microsoft Edge app window (Edge is on every Windows PC)
showing the page in ui/. This script runs a small local web server that the
page talks to, and does the downloading with yt-dlp.
"""

import ctypes
import base64
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import appwindow
import updater

# Before anything loads yt-dlp: use a newer one if one was downloaded.
YT_DLP_VERSION = updater.use_newest_yt_dlp()

import clips  # noqa: E402
import downloader  # noqa: E402
import files  # noqa: E402
import watchfolders  # noqa: E402
import findsounds  # noqa: E402
import pagecache  # noqa: E402
import boards  # noqa: E402
import channelstats  # noqa: E402
import comments  # noqa: E402
import streamlive  # noqa: E402
import streamtwitch  # noqa: E402
import streampreview  # noqa: E402
import obsctl  # noqa: E402
import adtimer  # noqa: E402
import multistream  # noqa: E402
import titles  # noqa: E402
import copycheck as copyright_check  # noqa: E402
import docs  # noqa: E402
import trash  # noqa: E402
import film  # noqa: E402
import editprojects  # noqa: E402
import projectsync  # noqa: E402
import games  # noqa: E402
import povs  # noqa: E402
import remote  # noqa: E402
import project  # noqa: E402
import resolvetools  # noqa: E402
import subtitles  # noqa: E402
import resolve  # noqa: E402
import history  # noqa: E402
import home  # noqa: E402
import images  # noqa: E402
import jobs  # noqa: E402
import linkpreview  # noqa: E402
import media  # noqa: E402
import names  # noqa: E402
import settings  # noqa: E402
import sfx  # noqa: E402
import waveform  # noqa: E402
import windows  # noqa: E402
from version import VERSION  # noqa: E402

downloader.use_bundled_ffmpeg()

APP_DIR = os.path.dirname(os.path.abspath(__file__))
UI_DIR = os.path.join(APP_DIR, "ui")
PORT = [0]  # the local server's port, once it runs
ICON_CANDIDATES = [os.path.join(APP_DIR, "icon.png"), os.path.join(APP_DIR, "..", "assets", "icon.png")]
WINDOW_ICON = next((p for p in (os.path.join(APP_DIR, "icon.ico"), os.path.join(APP_DIR, "..", "assets", "icon.ico"))
                    if os.path.isfile(p)), "")
PORT_FILE = os.path.join(settings.DATA_DIR, "running.port")
NO_WINDOW = downloader.NO_WINDOW
# A secret only the app's own window knows, so web pages open in a browser
# can't use the app (they could otherwise reach it at 127.0.0.1).
TOKEN = secrets.token_urlsafe(24)
_static_files = {}  # app files read once: (path, tag) -> bytes
CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
    ".jpg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp",
    ".ico": "image/x-icon", ".woff2": "font/woff2", ".mp3": "audio/mpeg",
    ".wasm": "application/wasm", ".mjs": "text/javascript; charset=utf-8",
}

# pythonw has no console, so there's nowhere for text output to go.
# Send it nowhere instead of crashing.
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")


# ---------------------------------------------------------------- app state

PAGE_PREFS = ("tab", "sfxSort", "fileOptions", "imageOptions", "chatSeen", "chatSound", "homeSeen", "volume", "tourSeen", "tourVoice", "sideSmall", "settingsPage", "sfxPlaylist", "callMic", "callSpeaker", "callQuality", "boardOpen", "callNoise", "callCam", "gamesSaleSeen", "chDays", "chChart", "chUpsellHidden", "notes", "notesOn", "povsSeen", "sideGroupsShut", "feedSeen", "feedNoted", "feedOpts", "callBitrate", "callMusic", "callPtt", "callVolumes", "callBoardVolume", "callShareSound", "chCmp", "pageBg", "lvRecapSeen", "lvCoView",
              "lvFilter", "lvSendTo", "lvAlerts", "lvPads", "lvBoardPrefs", "lvPop", "lvPreview", "lvGames", "lvLayout", "lvClipKey", "lvSceneKeys", "lvObsView", "lvWelcomed")  # what the page may remember
page_pref_lock = threading.Lock()

def live_or_recording():
    """True while you're streaming or OBS is recording (then notifications keep quiet)."""
    try:
        if streamlive._session:
            return True
        import obsstats
        obs = obsstats.state() if obsstats._cfg.get("on") else {}
        return bool(obs.get("streaming") or (obs.get("recording") or {}).get("active"))
    except Exception:
        return False


class State:
    """Everything the window shows. The page polls it a few times a second."""

    def __init__(self):
        saved = settings.load()
        self.lock = threading.Lock()
        self.folder = saved["folder"]
        self.quality = {fmt: saved[f"quality_{fmt}"] for fmt in settings.QUALITIES}
        # A message under the card: {"kind": "info"|"error"|"done", "text": ...}
        self.notice = None
        self.auto_update = saved["auto_update"]
        self.seen_version = saved.get("seen_version") or ""  # the last version whose "What's new" was shown
        self.normalize = saved["normalize"]
        self.hardware = saved["hardware"]
        self.theme = saved["theme"]
        self.accent = saved["accent"]
        self.zoom = saved["zoom"]
        self.save_mode = saved["save_mode"]
        self.last_asked = saved["last_asked"]
        self.checking = False
        self.check_failed = False  # (2.38.2) the last update check couldn't reach GitHub
        self.installing = False
        self.app_update = None  # newer version info, once found
        self.app_update_progress = None
        self.last_ping = time.time()
        self.closed_at = None
        self.quit = False
        self.installer = None  # a downloaded update to open once the app has closed

    def set(self, **changes):
        with self.lock:
            for key, value in changes.items():
                setattr(self, key, value)

    def snapshot(self):
        with self.lock:
            return {
                "version": VERSION,
                "folder": self.folder,
                "folderName": os.path.basename(self.folder.rstrip("\\/")) or self.folder,
                "quality": dict(self.quality),
                "qualities": settings.QUALITIES,
                "notice": self.notice,
                "autoUpdate": self.auto_update,
                "seenVersion": self.seen_version,
                "normalize": self.normalize,
                "hardware": self.hardware,
                "theme": self.theme,
                "accent": self.accent,
                "zoom": self.zoom,
                "saveMode": self.save_mode,
                "nativeZoom": appwindow.active(),
                "online": sfx.presence.get(),
                "checking": self.checking,
                "checkFailed": self.check_failed,
                "appUpdate": self.app_update,
                "appUpdateProgress": self.app_update_progress,
                "jobs": queue.snapshot(),
                "files": local_files.snapshot(),
                "fileScans": local_files.scan_snapshot(),
                "watches": watches.snapshot(),
                "resolveTools": resolvetools.get().snapshot(),
                "project": project.current(),
                "historyVersion": history.version,
                "sfxUploads": sfx.library.snapshot(),
            }

    @property
    def busy(self):
        return (self.checking or self.app_update_progress is not None or self.converting)

    @property
    def converting(self):
        return (queue.busy or local_files.busy or resolvetools.get().busy or waveform.busy() or sfx.library.busy
                or multistream.live())  # (2.36.0) passing a stream on: don't quit under it

    def start(self, flag):
        """Set a flag (like "checking") if it isn't set yet. False if it already was."""
        with self.lock:
            if getattr(self, flag):
                return False
            setattr(self, flag, True)
            return True


queue = jobs.Queue(on_done=history.add_job)
page_loaded = threading.Event()  # the window has shown the page
local_files = files.Files()
watches = watchfolders.Watches(local_files)
clip_maker = clips.Clips(queue.lookup, local_files.find)
state = State()


def warm_up():
    """Get the downloader ready. Waits for the window to show first, so it doesn't slow that down."""
    page_loaded.wait(timeout=8)
    downloader.warm_up()


def start_background(work, *args):
    threading.Thread(target=work, args=args, daemon=True).start()


def quality_label(fmt, quality):
    return next((label for value, label in settings.QUALITIES[fmt] if value == quality), quality)


def check_for_updates(manual=False):
    """Look for a new version of the app (shown as a popup) and of the downloader."""
    if not state.start("checking"):
        return
    if manual:
        state.set(notice={"kind": "info", "text": "Checking for updates..."})
    failed = False
    try:
        state.set(app_update=updater.check())
    except Exception:
        failed = True  # offline or GitHub unreachable
    new_downloader = None
    if not state.app_update:  # an app update brings a new downloader anyway
        try:
            new_downloader = updater.update_yt_dlp(YT_DLP_VERSION)
        except Exception:
            failed = True
    state.set(checking=False, check_failed=failed and not state.app_update)
    if not manual or state.app_update:
        if manual:
            state.set(notice=None)
        return
    if failed:
        text, kind = "Couldn't check for updates. Check your internet connection.", "error"
    else:
        text, kind = f"You have the newest version ({VERSION}).", "done"
        if new_downloader:
            text += " The downloader got an update too, which is used from the next time you open the app."
    state.set(notice={"kind": kind, "text": text})


def install_app_update():
    found = state.app_update
    if not found:
        return
    state.set(app_update_progress=0)
    try:
        path = updater.download(found["url"], found["version"], lambda p: state.set(app_update_progress=p),
                                found.get("size") or 0)
    except Exception as e:
        state.set(app_update_progress=None, installing=False,
                  notice={"kind": "error", "text": f"Couldn't download the update. ({e})"})
        return
    time.sleep(2.5)  # let the window show "Opening the installer..." and close itself
    # The installer opens once the app has saved everything and closed (main() below), so it
    # doesn't have to force the app shut halfway through.
    state.set(installer=path, quit=True)


docs_saved = set()  # files saved from the Docs tab (allowed for "show in folder")


def show_in_folder(path):
    if os.name == "nt" and os.path.isfile(path):
        subprocess.Popen(["explorer", "/select,", os.path.normpath(path)])
    else:
        open_folder(os.path.dirname(path) or state.folder)


# The last drag out: the page shows it lifting while it's busy, then "Dropped" or settling back.
drag_state = {"id": 0, "busy": False, "result": None}


def start_drag(path, image=None, offset=None):
    """Drag a finished file out of the app into another one (the mouse is held on it now).

    image: a PNG of the card the page drew (name and waveform), shown under the mouse.
    Returns the drag's number, for /api/drag-state.
    """
    if not path or not os.path.isfile(path):
        raise ValueError("That file isn't there anymore.")
    if os.name != "nt":
        raise ValueError("Dragging files out only works on Windows.")
    import dragout
    drag_state.update(id=drag_state["id"] + 1, busy=True, result=None)
    number = drag_state["id"]

    def done(result):
        if drag_state["id"] == number:
            drag_state.update(busy=False, result=result or "cancel")
    if not appwindow.drag(path, image, offset, done):
        dragout.drag_on_new_thread(path, image, offset, done)
    return number


def drag_image(data):
    """The card PNG the page sent along (a data: URL), or None."""
    url = data.get("image")
    if not isinstance(url, str) or not url.startswith("data:image/png;base64,") or len(url) > 3_000_000:
        return None
    try:
        return base64.b64decode(url.split(",", 1)[1])
    except ValueError:
        return None


def drag_path(data):
    """Which file the page wants to drag. Only files the app made itself."""
    kind = data.get("kind")
    if kind == "job":
        job = queue.find(data.get("id"))
        return job and job["status"] == "done" and job["file"]
    if kind == "history":
        item = history.find(str(data.get("id")))
        return item and item.get("file")
    if kind == "file":
        item = local_files.find(data.get("id"))
        return item and item["out"]
    if kind == "rt":
        item = resolvetools.get().find(data.get("id"))
        return item and item["out"]
    if kind == "image":
        return images.was_made(data.get("path")) and data["path"]
    if kind == "clip":
        return clip_maker.path(data.get("key"))
    if kind == "sound":
        return sfx.library.drag_copy(str(data.get("url") or ""), data.get("name"), dragged=True)
    return None


def open_folder(folder):
    if hasattr(os, "startfile") and os.path.isdir(folder):
        os.startfile(folder)


def pick_folder(current, title="Where should files be saved?"):
    """Show the Windows folder picker; returns '' if cancelled."""
    if os.name != "nt":
        return ""
    import folder_picker
    try:
        return folder_picker.pick_folder(current, title)
    except OSError:
        return ""


# ---------------------------------------------------------------- web server

def save_folder(data, kind=None):
    """The folder the page asked for with /api/ask-folder, else the one picked in Settings.
    While a project folder is on (Resolve tab), things go into its folder for their kind."""
    folder = data.get("folder") if isinstance(data, dict) else None
    if isinstance(folder, str) and folder and os.path.isdir(folder):
        folder = os.path.normpath(folder)
    else:
        folder = state.folder
    root = project.current()
    if kind and root and os.path.normcase(folder) == os.path.normcase(root):
        return project.folder_for(kind, folder)
    return folder


def feed_page(feed, days):
    """Adds the newest YouTube uploads of everyone who put their channel on their profile (looked at in
    the background, like on a profile: "loading" says to ask again in a moment)."""
    since = time.time() - max(1, min(int(days or 7), 14)) * 86400
    loading = False
    for c in feed.get("channels") or []:
        url = home.normalize(c.get("youtube"))
        found = home.channel(url, stats=False) if url else None
        if not found:
            continue
        loading = loading or found["loading"]
        info = found.get("info") or {}
        for v in (info.get("videos") or [])[:8]:
            if v.get("when") and v["when"] > since:
                feed["items"].append({"kind": "video", "at": v["when"], "id": v["id"], "title": v["title"], "url": v["url"],
                                      "thumbnail": v["thumbnail"], "seconds": v.get("seconds") or 0, "views": v.get("views"),
                                      "channel": info.get("name") or "", "username": c["username"],
                                      "avatar": c.get("avatar"), "avatarUrl": c.get("avatarUrl") or "", "me": c.get("me")})
    feed["items"].sort(key=lambda i: -(i.get("at") or 0))
    feed["loading"] = loading
    return feed


def home_page():
    """Everything on the Home page."""
    crew, error = None, ""
    if sfx.configured():
        try:
            crew = sfx.library.home()
        except sfx.Error as e:
            error = str(e)
    links = (crew or {}).get("channels") or version_channels()
    recent = history.recent(5)
    return {
        "ok": True,
        "channels": [home.channel(url) for url in links],
        "channelLinks": links,
        "canEditChannels": bool(crew and crew["isOwner"]),
        "loggedIn": bool(crew and crew["loggedIn"]),
        "sounds": (crew or {}).get("sounds") or [],
        "chat": (crew or {}).get("chat") or [],
        "activity": (crew or {}).get("activity") or [],
        "crewError": error,
        "online": sfx.presence.get(),
        "stats": history.stats(),
        "recent": recent,
    }


_stats_cache = {}


def stats_page(days):
    """The channels with their newest videos, and (logged in) each one's subscribers day by day."""
    try:
        days = max(2, min(3650, int(days or 30)))
    except (TypeError, ValueError):
        days = 30
    links = None
    history, error, logged_in = [], "", False
    # The history only changes once a day, so it's asked for at most once a minute (the page polls).
    key = (days, settings.load().get("library_token") or "")
    cached = _stats_cache.get(key)
    if cached and time.time() - cached[0] < 60:
        links, history, logged_in = cached[1:]
    elif sfx.configured():
        try:
            links = sfx.library.home().get("channels")
            history = sfx.library.channel_history(days)
            logged_in = True
            _stats_cache.clear()
            _stats_cache[key] = (time.time(), links, history, logged_in)
        except sfx.LoggedOut:
            pass
        except sfx.Error as e:
            error = str(e)
    links = links or version_channels()
    days_of = {}
    for row in history:
        days_of.setdefault(row["channel"], []).append([row["day"], row["subs"]])
    channels = []
    for url in links:
        found = home.channel(url)
        info = found["info"] or {}
        channels.append({"url": url, "name": info.get("name") or url.rsplit("/", 1)[-1], "avatar": info.get("avatar") or "",
                         "subscribers": info.get("subscribers"), "videos": info.get("videos") or info.get("uploads") or [],
                         "loading": found["loading"], "history": days_of.get(url, [])})
    return {"ok": True, "channels": channels, "days": days, "loggedIn": logged_in, "error": error}


def version_channels():
    import version
    return list(version.CHANNELS)


call_recordings = set()  # the recordings saved this time (the only files "Show in folder" may show)
pj_picked = set()  # (Projects) files picked in the Open window this time (the only ones a cut may upload)


def save_call_recording(name, body, length):
    """A call recording from the page (WebM sound), saved as an MP3 in the save folder."""
    if length <= 0 or length > 4 * 1024 ** 3:
        return {"ok": False, "error": "The recording was empty."}
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "", name).strip(" .")[:100] or "Call"
    folder = state.folder
    try:
        os.makedirs(folder, exist_ok=True)
        tmp = os.path.join(settings.DATA_DIR, f"call-{secrets.token_hex(4)}.webm")
        os.makedirs(settings.DATA_DIR, exist_ok=True)
        with open(tmp, "wb") as f:
            left = length
            while left > 0:
                chunk = body.read(min(left, 1 << 20))
                if not chunk:
                    break
                f.write(chunk)
                left -= len(chunk)
    except OSError:
        return {"ok": False, "error": "Couldn't save the recording. Is the drive full?"}
    out = os.path.join(folder, name + ".mp3")
    n = 2
    while os.path.exists(out):
        out = os.path.join(folder, f"{name} ({n}).mp3")
        n += 1
    try:
        done = subprocess.run([media.ffmpeg(), "-hide_banner", "-nostdin", "-y", "-i", tmp, "-vn", "-c:a", "libmp3lame",
                               "-b:a", "256k", out], capture_output=True, timeout=1800, creationflags=media.NO_WINDOW)
        if done.returncode != 0 or not os.path.isfile(out):
            raise OSError("ffmpeg")
    except Exception:
        # Couldn't make an MP3: keep the recording as it came (most players and editors open it too).
        out = out[:-4] + ".webm"
        try:
            shutil.move(tmp, out)
        except OSError:
            return {"ok": False, "error": "Couldn't save the recording."}
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass
    call_recordings.add(out)
    return {"ok": True, "path": out, "name": os.path.basename(out)}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def allowed(self):
        """Only the app's window may use the app (see TOKEN)."""
        port = self.server.server_port
        if self.headers.get("Host") not in (f"127.0.0.1:{port}", f"localhost:{port}"):
            return False
        if secrets.compare_digest(self.headers.get("X-Lelons-Token") or "", TOKEN):
            return True
        # The page's goodbye message can't carry a header, so it puts the token in the address.
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        if secrets.compare_digest(query.get("t", [""])[0], TOKEN):
            return True
        cookie = f"lelons{port}="
        for part in (self.headers.get("Cookie") or "").split(";"):
            part = part.strip()
            if part.startswith(cookie) and secrets.compare_digest(part[len(cookie):], TOKEN):
                return True
        return False

    def refuse(self):
        body = b"Open VaultHub from the Start menu or the desktop."
        self.send_response(403)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_body(self, body, content_type, cookie=False, tag=None, nonce=None, sandbox=False):
        self.send_response(200)
        if sandbox:  # (2.34.1) something fetched from outside: never treated as a page of the app
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "sandbox; default-src 'none'")
        if nonce:
            # (2.33.0) A safety net: the page only runs the app's own scripts. Even if something someone sent
            # (a chat message, a shared doc) ever got past the cleaning, it couldn't run code here.
            self.send_header("Content-Security-Policy", f"script-src 'self' 'nonce-{nonce}' 'wasm-unsafe-eval'; "
                             "worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
        if cookie:
            port = self.server.server_port
            self.send_header("Set-Cookie", f"lelons{port}={TOKEN}; Path=/; HttpOnly; SameSite=Strict")
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        if tag:  # (a file of the app: the page may keep it, and asks each time if it changed)
            self.send_header("ETag", tag)
            self.send_header("Cache-Control", "no-cache")
        else:
            self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, data):
        self.send_body(json.dumps(data).encode(), "application/json")

    def send_file(self, path, cookie=False):
        tag = None
        if os.path.basename(path) != "index.html":
            # The app's own files: kept in memory once read, and not sent again when the page already has them.
            st = os.stat(path)
            tag = f'"{st.st_mtime_ns:x}-{st.st_size:x}"'
            if self.headers.get("If-None-Match") == tag:
                self.send_response(304)
                self.send_header("ETag", tag)
                self.end_headers()
                return
            body = _static_files.get((path, tag))
            if body is None:
                with open(path, "rb") as f:
                    body = f.read()
                if path.startswith(UI_DIR + os.sep) and len(body) <= 4 * 1024 * 1024:
                    _static_files[(path, tag)] = body
            content_type = CONTENT_TYPES.get(os.path.splitext(path)[1].lower(), "application/octet-stream")
            return self.send_body(body, content_type, cookie, tag)
        with open(path, "rb") as f:
            body = f.read()
        if os.path.basename(path) == "index.html":
            # What the page remembers (see ui/theme.js), plus the theme, so it shows the right colors at once.
            saved = {**(settings.load().get("page") or {}), "theme": state.theme, "accent": state.accent,
                     "zoom": state.zoom, "nativeZoom": appwindow.active()}
            text = json.dumps(saved).replace("<", "\\u003c")
            cache = json.dumps(pagecache.get(), separators=(",", ":")).replace("<", "\\u003c")
            nonce = secrets.token_urlsafe(16)
            body = body.replace(b"<!--SAVED-->", f"<script nonce=\"{nonce}\">const LELONS_SAVED = {text};\nconst LELONS_CACHE = {cache};</script>".encode())
        content_type = CONTENT_TYPES.get(os.path.splitext(path)[1].lower(), "application/octet-stream")
        self.send_body(body, content_type, cookie, nonce=nonce if os.path.basename(path) == "index.html" else None)

    def send_media(self, path, kind=None):
        """Audio for the trim editor. Supports byte ranges so the player can jump around."""
        size = os.path.getsize(path)
        start, end = 0, size - 1
        match = re.match(r"bytes=(\d*)-(\d*)$", self.headers.get("Range", ""))
        if match and (match[1] or match[2]):
            if match[1]:
                start = int(match[1])
                end = min(int(match[2]), size - 1) if match[2] else size - 1
            else:  # "bytes=-500": the last 500 bytes
                start = max(0, size - int(match[2]))
            if start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        else:
            self.send_response(200)
        content_type = {".webm": "audio/webm", ".m4a": "audio/mp4", ".mp4": "video/mp4", ".opus": "audio/ogg"}
        self.send_header("Content-Type", kind or content_type.get(os.path.splitext(path)[1], "application/octet-stream"))
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        with open(path, "rb") as f:
            f.seek(start)
            left = end - start + 1
            try:
                while left > 0 and (chunk := f.read(min(256 * 1024, left))):
                    self.wfile.write(chunk)
                    left -= len(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass  # the player only wanted part of it

    def do_GET(self):
        # The window opens /?t=TOKEN; the page gets a cookie with it for everything after.
        url = urllib.parse.urlsplit(self.path)
        if url.path == "/" and secrets.compare_digest(urllib.parse.parse_qs(url.query).get("t", [""])[0], TOKEN):
            if self.headers.get("Host") == f"127.0.0.1:{self.server.server_port}":
                return self.send_file(os.path.join(UI_DIR, "index.html"), cookie=True)
        if url.path == "/remote-host" and secrets.compare_digest(urllib.parse.parse_qs(url.query).get("t", [""])[0], TOKEN):
            # (2.37.0) The Remote desktop's hidden sender (its own engine, so it gets its own cookie).
            if self.headers.get("Host") == f"127.0.0.1:{self.server.server_port}":
                return self.send_file(os.path.join(UI_DIR, "remote-host.html"), cookie=True)
        if url.path == "/" and channelstats.is_callback(urllib.parse.parse_qs(url.query)):
            # Google sends the browser back here after you sign in on the Channel stats tab.
            if self.headers.get("Host") == f"127.0.0.1:{self.server.server_port}":
                return self.send_google_done(*channelstats.finish(urllib.parse.parse_qs(url.query)))
        if not self.allowed():
            return self.refuse()
        if self.path == "/api/state":
            state.set(last_ping=time.time())
            page_loaded.set()
            return self.send_json(state.snapshot())
        if self.path == "/api/history":
            return self.send_json({"items": history.items(), "version": history.version})
        if url.path == "/live-hls":  # (2.34.0) the stream preview in the Live console, passed through
            try:
                body, kind = streampreview.fetch(urllib.parse.parse_qs(url.query).get("u", [""])[0])
            except (streampreview.Error, OSError, ValueError):
                return self.send_error(404)
            return self.send_body(body, kind, sandbox=True)
        if self.path.startswith("/media/"):
            path = waveform.file_path(self.path[len("/media/"):])
            return self.send_media(path) if path and os.path.isfile(path) else self.send_error(404)
        if self.path.startswith("/rt-video/"):  # a video on the Resolve tab, played right from where it is
            file_id, _, copy = self.path[len("/rt-video/"):].partition("/")
            path = resolvetools.get().video_path(file_id, copy if copy in ("copy", "mix") else "")
            if not path:
                return self.send_error(404)
            ext = os.path.splitext(path)[1].lower()
            kind = ("video/mp4" if ext in (".mp4", ".m4v", ".mov") else "video/webm" if ext in (".webm", ".mkv")
                    else "audio/mp4" if ext == ".m4a" else None)
            return self.send_media(path, kind)
        if self.path.startswith("/board-bg/"):  # a board's own background picture
            path = boards.background_path(self.path[len("/board-bg/"):])
            return self.send_file(path) if path and os.path.isfile(path) else self.send_error(404)
        if self.path.startswith("/file-thumb/"):
            file_id = self.path[len("/file-thumb/"):]
            item = (resolvetools.get() if file_id.startswith("r") else local_files).find(file_id)
            path = item and item["thumbPath"]
            return self.send_file(path) if path and os.path.isfile(path) else self.send_error(404)
        if self.path.startswith("/image/"):
            path = images.thumbnail_path(self.path[len("/image/"):])
            return self.send_file(path) if path and os.path.isfile(path) else self.send_error(404)
        if self.path.startswith("/pj-read/"):  # (Projects, 2.41.0) a piece of a project file, for the page to send to a friend
            url = urllib.parse.urlsplit(self.path)
            query = urllib.parse.parse_qs(url.query)
            try:
                body = projectsync.sync.read(url.path[len("/pj-read/"):], int(query.get("at", ["0"])[0]), int(query.get("n", ["0"])[0]))
            except (projectsync.Error, OSError, ValueError):
                return self.send_error(404)
            return self.send_body(body, "application/octet-stream")
        if self.path.startswith("/pj-file/"):  # (Projects, 2.41.0) a cut's video on this PC, for the player
            path = projectsync.sync.local_path(urllib.parse.urlsplit(self.path).path[len("/pj-file/"):])
            return self.send_media(path, "video/mp4") if path else self.send_error(404)
        if self.path.startswith("/pov-read/"):  # a piece of a POV you share, for the page to send to a friend
            url = urllib.parse.urlsplit(self.path)
            query = urllib.parse.parse_qs(url.query)
            try:
                body = povs.povs.read(url.path[len("/pov-read/"):], int(query.get("at", ["0"])[0]), int(query.get("n", ["0"])[0]))
            except (povs.Error, OSError, ValueError):
                return self.send_error(404)
            return self.send_body(body, "application/octet-stream")
        if self.path == "/icon.png":
            icon = next((p for p in ICON_CANDIDATES if os.path.isfile(p)), None)
            return self.send_file(icon) if icon else self.send_error(404)
        name = "index.html" if self.path == "/" else url.path.lstrip("/")
        path = os.path.normpath(os.path.join(UI_DIR, name))
        if path.startswith(UI_DIR + os.sep) and os.path.isfile(path):
            return self.send_file(path)
        self.send_error(404)

    def do_POST(self):
        if not self.allowed():
            return self.refuse()
        self.path = urllib.parse.urlsplit(self.path).path
        try:
            self.handle_post()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass  # the window went away
        except Exception:
            try:
                self.send_json({"ok": False, "error": "Something went wrong. Try again."})
            except OSError:
                pass

    def send_google_done(self, ok, text):
        """The little page in the browser after signing in with Google."""
        import html
        color = "#2fbf71" if ok else "#e5484d"
        body = (f"<!doctype html><meta charset=utf-8><title>VaultHub</title><body style=\"margin:0;display:grid;place-items:center;"
                f"height:100vh;background:#111;color:#eee;font:16px system-ui,sans-serif\"><div style=\"max-width:420px;"
                f"text-align:center\"><div style=\"width:14px;height:14px;border-radius:50%;background:{color};margin:0 auto 16px\">"
                f"</div><h2 style=\"margin:0 0 8px\">{'All set' if ok else 'That did not work'}</h2><p style=\"color:#aaa;"
                f"line-height:1.5\">{html.escape(text)}</p></div>").encode()
        self.send_body(body, "text/html; charset=utf-8")

    def handle_channel(self, action, data):
        """The Channel stats tab."""
        try:
            if action == "page":
                c = channelstats._config()
                if not c["channel"] and not c["refresh"] and sfx.configured() and not data.get("noGuess"):
                    try:  # the YouTube channel on your profile, if you put one there
                        mine = sfx.library.my_profile().get("youtube")
                        if mine:
                            channelstats.set_channel(mine)
                    except Exception:
                        pass
                return self.send_json(channelstats.page(data.get("days")))
            elif action == "uploads":
                return self.send_json({"ok": True, "videos": channelstats.uploads()})
            elif action == "compare":
                return self.send_json(channelstats.compare(data.get("ids")))
            elif action == "video-id":
                vid = channelstats.video_id(data.get("url"))
                if not vid:
                    raise channelstats.Error("That isn't a YouTube video link.")
                return self.send_json({"ok": True, "id": vid})
            elif action == "set":
                channelstats.set_channel(data.get("url"))
            elif action == "forget":
                settings.save(ch_channel="")
            elif action == "refresh":
                channelstats.refresh_now()
            elif action == "client":
                channelstats.set_client(data.get("clientId"), data.get("clientSecret"))
            elif action == "connect":
                webbrowser.open(channelstats.connect_url(self.server.server_port, bool(data.get("replies"))))
            elif action == "disconnect":
                channelstats.disconnect(bool(data.get("forgetClient")))
            elif action == "ms-config":  # (2.36.0) multistreaming
                return self.send_json({"ok": True, "config": multistream.config()})
            elif action == "ms-setup":
                return self.send_json({"ok": True, "config": multistream.setup(data)})
            elif action == "ms-switch":
                return self.send_json({"ok": True, "ms": multistream.switch(bool(data.get("on")))})
            elif action == "ms-site":
                return self.send_json({"ok": True, "ms": multistream.site_switch(str(data.get("site") or ""), bool(data.get("on")))})
            elif action == "ms-test":
                return self.send_json({"ok": True, "test": multistream.speed_test()})
            elif action == "ms-obs":
                ok = multistream.point_obs(bool(multistream.config()["on"]))
                return self.send_json({"ok": True, "done": ok, "ms": multistream.status()})
            elif action == "ads-run":  # (2.36.0) the ad timer
                return self.send_json({"ok": True, "ads": adtimer.run_now(data.get("length"))})
            elif action == "ads-snooze":
                return self.send_json({"ok": True, "ads": adtimer.snooze()})
            elif action == "ads-end":
                return self.send_json({"ok": True, "ads": adtimer.end_now()})
            elif action == "ads-set":
                return self.send_json({"ok": True, "prefs": adtimer.set_prefs(data.get("prefs") or {})})
            elif action == "ads-scenes":
                return self.send_json({"ok": True, "scenes": adtimer.scenes()})
            elif action == "close-ask":  # (2.36.0) what the "You're live. Close anyway?" box lists
                return self.send_json({"ok": True, "sites": multistream.live_sites()})
            elif action == "hide":
                return self.send_json({"ok": appwindow.hide()})
            elif action == "close-now":
                multistream.stop_all()
                threading.Thread(target=appwindow.close, daemon=True).start()
            elif action == "open":
                url = str(data.get("url") or "")
                if re.match(r"^https://(www\.youtube\.com|studio\.youtube\.com|console\.cloud\.google\.com)/", url):
                    webbrowser.open(url)
            else:
                return self.send_error(404)
        except channelstats.Error as e:
            return self.send_json({"ok": False, "error": str(e)})
        self.send_json({"ok": True})

    def handle_live(self, action, data):
        """The Live console (chat, viewers, OBS, alerts, stream stats)."""
        try:
            if action == "state":
                return self.send_json(streamlive.state(int(data.get("since") or 0)))
            elif action == "config":
                return self.send_json({"ok": True, "config": streamlive.config()})
            elif action == "setup":
                streamlive.setup(data)
                return self.send_json({"ok": True, "config": streamlive.config()})
            elif action == "send":
                return self.send_json({"ok": True, **streamlive.send(str(data.get("text") or ""), str(data.get("to") or "both"))})
            elif action == "mod":
                streamlive.moderate(str(data.get("p") or ""), str(data.get("action") or ""), str(data.get("id") or ""),
                                    str(data.get("userId") or ""), str(data.get("login") or ""), str(data.get("channelId") or ""))
            elif action == "twitch-signin":
                return self.send_json({"ok": True, **streamlive.twitch().begin_sign_in(data.get("clientId"))})
            elif action == "twitch-check":
                return self.send_json({"ok": True, "done": streamlive.twitch().check_sign_in()})
            elif action == "obs":  # (2.34.0) the OBS card: live picture, scenes, sound, recording
                return self.send_json({"ok": True, "obs": obsctl.state()})
            elif action == "obs-do":
                try:
                    return self.send_json({"ok": True, "obs": obsctl.do(str(data.get("what") or ""), data)})
                except obsctl.Error as e:
                    return self.send_json({"ok": False, "error": str(e)})
            elif action == "obs-shot":
                try:
                    return self.send_json({"ok": True, "image": obsctl.picture(data.get("width") or 640)})
                except obsctl.Error as e:
                    return self.send_json({"ok": False, "error": str(e)})
            elif action == "tw-clip":
                return self.send_json({"ok": True, "clip": streamlive.clip()})
            elif action == "tw-modes":
                return self.send_json({"ok": True, "modes": streamlive.twitch().chat_modes()})
            elif action == "tw-modes-set":
                return self.send_json({"ok": True, "modes": streamlive.twitch().set_chat_modes(data.get("change") or {})})
            elif action == "tw-info":  # (2.34.0) the Twitch title, game and tags
                return self.send_json({"ok": True, "info": streamlive.twitch().info()})
            elif action == "tw-games":
                return self.send_json({"ok": True, "games": streamlive.twitch().games(data.get("q"))})
            elif action == "tw-set":
                tags = data.get("tags")
                return self.send_json({"ok": True, "info": streamlive.twitch().set_info(
                    data.get("title"), data.get("gameId"), tags if isinstance(tags, list) else None)})
            elif action == "twitch-signout":
                streamlive.twitch().sign_out()
            elif action == "streams":
                return self.send_json({"ok": True, "streams": streamlive.streams()})
            elif action == "stream":
                found = streamlive.stream(data.get("id"))
                return self.send_json({"ok": bool(found), **(found or {"error": "That stream is gone."})})
            elif action == "forget":
                streamlive.forget(data.get("id"))
            elif action == "co-set":  # (2.42.0) co-streaming: friends' chats in the console
                names = data.get("names")
                return self.send_json({"ok": True, "co": streamlive.set_costream(names if isinstance(names, list) else [])})
            elif action == "co-friends":
                import live
                out = []
                try:
                    for c in sfx.library.live_channels():
                        name = live.twitch_name(c.get("twitch"))
                        if name:
                            out.append({"username": c.get("username") or "", "twitch": name, "avatarUrl": c.get("avatarUrl") or ""})
                except Exception:  # noqa: BLE001 (signed out of VaultHub, no internet...)
                    out = []
                return self.send_json({"ok": True, "friends": out})
            elif action == "hotkeys":
                return self.send_json({"ok": True, "taken": appwindow.set_hotkeys(data.get("keys") or [])})
            elif action == "popout":
                top, see = bool(data.get("onTop", True)), max(30, min(100, int(data.get("see") or 100)))
                ok = appwindow.popout(f"http://127.0.0.1:{self.server.server_port}/livechat.html?top={int(top)}&see={see}",
                                      os.path.join(settings.DATA_DIR, "webview"), WINDOW_ICON,
                                      on_top=top, see=see, close=bool(data.get("close")),
                                      placement=settings.load().get("lv_popout_at"),
                                      on_closed=lambda at: at and settings.save(lv_popout_at=at))
                return self.send_json({"ok": ok, "error": "" if ok else "The pop-out chat needs the app's own window."})
            elif action == "preview":
                try:
                    return self.send_json({"ok": True, "url": streampreview.source(str(data.get("p") or ""), str(data.get("name") or ""))})
                except streampreview.Error as e:
                    return self.send_json({"ok": False, "error": str(e)})
            elif action == "ms-config":  # (2.36.0) multistreaming
                return self.send_json({"ok": True, "config": multistream.config()})
            elif action == "ms-setup":
                return self.send_json({"ok": True, "config": multistream.setup(data)})
            elif action == "ms-switch":
                return self.send_json({"ok": True, "ms": multistream.switch(bool(data.get("on")))})
            elif action == "ms-site":
                return self.send_json({"ok": True, "ms": multistream.site_switch(str(data.get("site") or ""), bool(data.get("on")))})
            elif action == "ms-test":
                return self.send_json({"ok": True, "test": multistream.speed_test()})
            elif action == "ms-obs":
                ok = multistream.point_obs(bool(multistream.config()["on"]))
                return self.send_json({"ok": True, "done": ok, "ms": multistream.status()})
            elif action == "ads-run":  # (2.36.0) the ad timer
                return self.send_json({"ok": True, "ads": adtimer.run_now(data.get("length"))})
            elif action == "ads-snooze":
                return self.send_json({"ok": True, "ads": adtimer.snooze()})
            elif action == "ads-end":
                return self.send_json({"ok": True, "ads": adtimer.end_now()})
            elif action == "ads-set":
                return self.send_json({"ok": True, "prefs": adtimer.set_prefs(data.get("prefs") or {})})
            elif action == "ads-scenes":
                return self.send_json({"ok": True, "scenes": adtimer.scenes()})
            elif action == "close-ask":  # (2.36.0) what the "You're live. Close anyway?" box lists
                return self.send_json({"ok": True, "sites": multistream.live_sites()})
            elif action == "hide":
                return self.send_json({"ok": appwindow.hide()})
            elif action == "close-now":
                multistream.stop_all()
                threading.Thread(target=appwindow.close, daemon=True).start()
            elif action == "open":
                url = str(data.get("url") or "")
                if re.match(r"^https://(www\.twitch\.tv|clips\.twitch\.tv|dashboard\.twitch\.tv|dev\.twitch\.tv|www\.youtube\.com|studio\.youtube\.com|obsproject\.com)/", url):
                    webbrowser.open(url)
            else:
                return self.send_error(404)
        except (streamtwitch.Error, streamlive.streamyt.Error, multistream.Error, RuntimeError) as e:
            return self.send_json({"ok": False, "error": str(e)})
        except channelstats.Error as e:
            return self.send_json({"ok": False, "error": str(e)})
        self.send_json({"ok": True})

    def handle_comments(self, action, data):
        """The Comments tab (your channel's comments, answer them fast)."""
        try:
            if action == "page":
                return self.send_json(comments.page())
            elif action == "count":
                return self.send_json({"ok": True, "count": comments.count()})
            elif action == "refresh":
                comments.refresh_now()
            elif action == "done":
                comments.set_done(data.get("id"), bool(data.get("done")))
            elif action == "saved":
                return self.send_json({"ok": True, "saved": comments.set_saved(data.get("saved"))})
            elif action == "reply":
                return self.send_json({"ok": True, "reply": comments.reply(data.get("id"), data.get("text"))})
            elif action == "hide":
                comments.moderate(data.get("id"), "rejected")
            elif action == "approve":
                comments.moderate(data.get("id"), "published")
            elif action == "unreply":
                comments.delete_reply(data.get("id"))
            else:
                return self.send_error(404)
        except (comments.Error, channelstats.Error) as e:
            return self.send_json({"ok": False, "error": str(e)})
        self.send_json({"ok": True})

    def handle_resolve(self, data):
        """The Resolve tab (rt-) and project folders (project-)."""
        tools = resolvetools.get()
        path = self.path
        try:
            if path == "/api/rt-pick":
                if os.name != "nt":
                    return self.send_json({"ok": False, "fallback": True})
                import folder_picker
                try:
                    picked = folder_picker.pick_files("Pick videos", files.PICK_KINDS)
                except OSError:
                    return self.send_json({"ok": False, "fallback": True})
                added, errors = [], []
                for p in picked:
                    try:
                        added.append(tools.add_path(p))
                    except (ValueError, OSError) as e:
                        errors.append(str(e) if isinstance(e, ValueError) else f"Couldn't open {os.path.basename(p)}.")
                return self.send_json({"ok": True, "files": added, "errors": errors})
            if path == "/api/rt-convert":
                tool = (data.get("options") or {}).get("tool")
                kind = "subtitles" if tool == "subtitles" else "footage"
                tools.convert(data.get("items") or [], data.get("options") or {}, save_folder(data, kind))
                return self.send_json({"ok": True})
            if path == "/api/rt-options":
                return self.send_json({"ok": True, "options": resolvetools.load_options(), "nvidia": subtitles.has_nvidia()})
            if path == "/api/rt-remove":
                tools.remove(data.get("id"))
            elif path == "/api/rt-cancel":
                tools.cancel(data.get("id"))
            elif path == "/api/rt-clear":
                tools.clear()
            elif path == "/api/rt-show":
                item = tools.find(data.get("id"))
                shown = item and (item.get("timeline") if data.get("timeline") else item["out"])
                if shown and os.path.exists(shown):
                    show_in_folder(shown)
            elif path == "/api/rt-cues":
                item = tools.cues(data.get("id"))
                trim = (item.get("job") or {}).get("trim")
                return self.send_json({"ok": True, "cues": [{"start": a, "end": b, "text": t} for a, b, t in item["cues"]],
                                       "offset": trim[0] if trim else 0, "name": item["name"], "sent": item.get("sent")})
            elif path == "/api/rt-preview":
                return self.send_json({"ok": True, **tools.preview(data.get("id"))})
            elif path == "/api/rt-mix":
                return self.send_json({"ok": True, **tools.mix(data.get("id"))})
            elif path == "/api/rt-wave":
                return self.send_json({"ok": True, "peaks": tools.peaks(data.get("id"))})
            elif path == "/api/rt-cues-save":
                tools.save_cues(data.get("id"), data.get("cues") or [])
            elif path == "/api/rt-send":
                return self.send_json({"ok": True, **tools.send(data.get("id"), "fcpxml" if data.get("old") else "drt")})
            # ---- project folders
            elif path == "/api/project-make":
                parent = pick_folder(state.folder, "Where should the project folder go?")
                if not parent:
                    return self.send_json({"ok": False, "cancelled": True})
                root = project.make(parent, data.get("name"))
                return self.send_json({"ok": True, "project": root, "projects": project.recent()})
            elif path == "/api/project-use":
                project.use(str(data.get("path") or ""))
            elif path == "/api/project-list":
                return self.send_json({"ok": True, "project": project.current(), "projects": project.recent(),
                                       "folders": [project.FOLDERS[k].replace(os.sep, " › ") for k in project.ORDER]})
            elif path == "/api/project-open":
                if project.current():
                    open_folder(project.current())
            elif path == "/api/project-pick":
                picked = pick_folder(state.folder, "Pick a project folder")
                if not picked:
                    return self.send_json({"ok": False, "cancelled": True})
                project.use(picked)
                return self.send_json({"ok": True, "project": project.current(), "projects": project.recent()})
            else:
                return self.send_json({"ok": False, "error": "Unknown."})
            self.send_json({"ok": True})
        except (ValueError, KeyError, TypeError) as e:
            self.send_json({"ok": False, "error": str(e) if isinstance(e, ValueError) else "Something's missing."})

    def handle_sfx(self, action, data):
        """The SFX tab. Every answer is {"ok": true, ...} or {"ok": false, "error": "..."}."""
        library = sfx.library
        try:
            if action == "account":
                result = {"account": library.account()}
                user = (result["account"] or {}).get("user") or {}
                if ((pagecache.get().get("account") or {}).get("user") or {}).get("id") != user.get("id"):
                    pagecache.forget()
                pagecache.put("account", result["account"])
            elif action == "signup":
                result = {"account": library.signup(data.get("username"), data.get("password"), data.get("invite"))}
            elif action == "login":
                result = {"account": library.login(data.get("username"), data.get("password"))}
            elif action == "logout":
                library.logout()
                result = {"account": library.account()}
            elif action == "password":
                library.change_password(data.get("old"), data.get("new"))
                result = {}
            elif action == "rename":
                result = {"account": library.rename(data.get("username"))}
            elif action == "delete-me":
                result = {"account": library.delete_me(data.get("password"))}
            elif action == "picture-pick":
                if os.name != "nt":
                    return self.send_json({"ok": False, "fallback": True})
                import folder_picker
                try:
                    paths = folder_picker.pick_files("Pick a picture", [
                        ("Pictures", "*.png;*.jpg;*.jpeg;*.webp;*.gif;*.bmp"), ("All files", "*.*")])
                except OSError:
                    return self.send_json({"ok": False, "fallback": True})
                if not paths:
                    return self.send_json({"ok": True, "account": None})
                if os.path.getsize(paths[0]) > 30 * 1024 * 1024:
                    raise sfx.Error("That picture is too big.")
                with open(paths[0], "rb") as f:
                    result = {"account": library.set_picture(f.read())}
            elif action == "picture-remove":
                result = {"account": library.remove_picture()}
            elif action == "people":
                result = {"people": library.people()}
            elif action == "devices":
                result = library.devices(str(data.get("what") or "list"), data.get("id"))
            elif action == "invites":
                result = library.invites(str(data.get("what") or "list"), data.get("code"), data.get("hours"), data.get("uses"))
            elif action == "role":
                library.set_role(data.get("id"), data.get("role"))
                result = {"people": library.people()}
            elif action == "remove-person":
                library.remove_person(data.get("id"))
                result = {"people": library.people()}
            elif action == "list":
                result = {"sounds": library.sounds(), "songsChecking": library.songs_checking()}
            elif action == "peaks":
                result = {"peaks": sfx.waveforms.get(str(data.get("path") or ""))}
            elif action == "feedback-send":
                library.send_feedback(data.get("kind"), data.get("message"))
                result = {}
            elif action == "feedback-list":
                result = {"feedback": library.feedback()}
            elif action == "feedback-set":
                result = {"feedback": library.set_feedback(data.get("id"), data.get("done"), data.get("remove"))}
            elif action == "chat":
                result = library.chat(data.get("after"), data.get("with"), data.get("before"))
            elif action == "chat-send":
                clip = None
                if data.get("clip"):
                    clip = clip_maker.for_sending(data["clip"])
                    if not clip:
                        raise sfx.Error("Make the clip first.")
                gif = data.get("gif")
                if gif:
                    gif = linkpreview.gif_link(gif)
                    if not gif:
                        raise sfx.Error("That GIF link didn't work. Try a GIPHY or Tenor link.")
                library.chat_send(data.get("message"), data.get("with"), data.get("sound"), clip, data.get("reply"),
                                  data.get("thread"), gif, data.get("sticker"), data.get("poll"))
                result = {} if data.get("thread") else library.chat(data.get("after"), data.get("with"))
            elif action == "chat-edit":
                library.chat_edit(data.get("id"), data.get("message"))
                result = {}
            elif action == "chat-pin":
                library.chat_pin(data.get("id"), data.get("on"))
                result = {}
            elif action == "chat-poll":
                library.chat_poll(data.get("id"), data.get("what"), data.get("choices"))
                result = {}
            elif action == "chat-thread":
                result = library.chat_thread(data.get("id"))
            elif action == "chat-search":
                result = library.chat_search(data.get("with"), data.get("q"))
            elif action == "chat-pins":
                result = library.chat_pins(data.get("with"))
            elif action == "chat-mode":
                library.set_mode(data.get("mode"), data.get("status"))
                result = {}
            elif action == "chat-link":
                result = {"card": linkpreview.preview(data.get("url"))}
            elif action == "chat-group":
                result = library.chat_group(data.get("what"), data.get("group"), data.get("name"), data.get("usernames"))
            elif action == "group-picture-pick":
                if os.name != "nt":
                    return self.send_json({"ok": False, "fallback": True})
                import folder_picker
                try:
                    paths = folder_picker.pick_files("Pick a picture for the group", [
                        ("Pictures", "*.png;*.jpg;*.jpeg;*.webp;*.gif;*.bmp"), ("All files", "*.*")])
                except OSError:
                    return self.send_json({"ok": False, "fallback": True})
                if not paths:
                    return self.send_json({"ok": True, "group": None})
                if os.path.getsize(paths[0]) > 30 * 1024 * 1024:
                    raise sfx.Error("That picture is too big.")
                with open(paths[0], "rb") as f:
                    result = library.set_group_picture(data.get("group"), f.read())
            elif action == "server":
                result = library.server(data.get("what"), data.get("server"), data.get("data"))
            elif action == "server-picture-pick":
                if os.name != "nt":
                    return self.send_json({"ok": False, "fallback": True})
                import folder_picker
                try:
                    paths = folder_picker.pick_files("Pick a picture for the server", [
                        ("Pictures", "*.png;*.jpg;*.jpeg;*.webp;*.gif;*.bmp"), ("All files", "*.*")])
                except OSError:
                    return self.send_json({"ok": False, "fallback": True})
                if not paths:
                    return self.send_json({"ok": True, "server": None})
                if os.path.getsize(paths[0]) > 30 * 1024 * 1024:
                    raise sfx.Error("That picture is too big.")
                with open(paths[0], "rb") as f:
                    result = library.set_server_picture(data.get("server"), f.read())
            elif action == "group-picture-remove":
                result = library.chat_group("picture", data.get("group"))
            elif action == "chat-typing":
                library.chat_typing(data.get("with"), data.get("stop"))
                result = {}
            elif action == "chat-live":
                result = library.chat_live(data.get("with"), data.get("seen"))
            elif action == "chat-react":
                library.chat_react(data.get("id"), data.get("emoji"), data.get("on"))
                result = {}
            elif action == "chat-delete":
                library.chat_delete(data.get("id"))
                result = {}
            elif action == "call":
                result = library.room(data.get("what"), data.get("room"), data.get("with"), data.get("to"),
                                      data.get("kind"), data.get("sdp"), data.get("after"))
            elif action == "call-ringing":  # someone is calling: the app blinks in the taskbar
                appwindow.flash()
                result = {}
            elif action == "feed":  # the Friends page
                result = feed_page(library.feed(data.get("days")), data.get("days"))
            elif action == "profile":
                result = {"profile": library.profile(data.get("username"))}
            elif action == "profile-save":
                result = {"profile": library.set_profile(data.get("profile"))}
            elif action == "banner-pick":
                if os.name != "nt":
                    return self.send_json({"ok": False, "fallback": True})
                import folder_picker
                try:
                    paths = folder_picker.pick_files("Pick a banner picture", [
                        ("Pictures", "*.png;*.jpg;*.jpeg;*.webp;*.gif;*.bmp"), ("All files", "*.*")])
                except OSError:
                    return self.send_json({"ok": False, "fallback": True})
                if not paths:
                    return self.send_json({"ok": True, "profile": None})
                if os.path.getsize(paths[0]) > 30 * 1024 * 1024:
                    raise sfx.Error("That picture is too big.")
                with open(paths[0], "rb") as f:
                    result = {"profile": library.set_banner(f.read())}
            elif action == "banner-remove":
                result = {"profile": library.remove_banner()}
            elif action == "live":  # friends who are live on YouTube or Twitch right now (stream alerts)
                import live
                channels = []
                for c in library.live_channels():
                    url = home.normalize(c.get("youtube"))
                    channels.append({**c, "youtube": url or "", "twitch": live.twitch_name(c.get("twitch")) or ""})
                result = live.live(channels)
            elif action == "profile-videos":  # someone's YouTube channel on their profile (looked at in the background)
                url = home.normalize(data.get("url"))
                found = home.channel(url, stats=False) if url else None
                info = (found or {}).get("info") or {}
                result = {"loading": bool(found and found["loading"]), "error": (found or {}).get("error") or "",
                          "name": info.get("name") or "", "avatar": info.get("avatar") or "",
                          "subscribers": info.get("subscribers"), "videos": (info.get("videos") or [])[:6]}
            elif action == "playlists":
                result = library.playlists()
            elif action == "playlist":
                result = library.playlist(data.get("what"), data.get("playlist"), data.get("name"), data.get("sound"),
                                          data.get("usernames"))
            elif action == "favorite":
                library.favorite(data.get("id"), data.get("on"))
                result = {}
            elif action == "edit":
                library.edit(data.get("id"), data.get("name"), data.get("category"), data.get("genre"))
                result = {"sounds": library.sounds()}
            elif action == "delete":  # into the Trash (30 days), or for good from the Trash's own page
                if data.get("forGood"):
                    library.delete(data.get("id"))
                else:
                    trash.put_shared("sound", data.get("id"))
                result = {}
            elif action == "download":
                path = library.download(str(data.get("url") or ""), data.get("name"), save_folder(data, "sfx"))
                result = {"path": path, "fileName": os.path.basename(path)}
            elif action == "show":
                path = str(data.get("path") or "")
                if os.path.normcase(path) in library.saved:
                    show_in_folder(path)
                result = {}
            elif action == "pick":
                if os.name != "nt":
                    return self.send_json({"ok": False, "fallback": True})
                import folder_picker
                try:
                    paths = folder_picker.pick_files("Pick a sound or video", sfx.UPLOAD_KINDS)
                except OSError:
                    return self.send_json({"ok": False, "fallback": True})
                result = {"file": library.add_path(paths[0]) if paths else None}
            elif action == "upload":
                trim = None
                try:
                    start, end = float(data.get("start")), float(data.get("end"))
                    item = library.find(data.get("id"))
                    if item and 0 <= start < end and not (start <= 0.05 and end >= item["seconds"] - 0.05):
                        trim = (start, min(end, item["seconds"] or end))
                except (TypeError, ValueError):
                    pass
                library.upload(data.get("id"), data.get("name"), data.get("category"), trim, data.get("genre"))
                result = {}
            elif action == "forget":
                library.forget(data.get("id"))
                result = {}
            elif action == "clear":
                library.clear_done()
                result = {}
            else:
                return self.send_error(404)
        except sfx.Error as e:
            return self.send_json({"ok": False, "error": str(e), "loggedOut": isinstance(e, sfx.LoggedOut)})
        except OSError:
            return self.send_json({"ok": False, "error": "Couldn't open that file."})
        if action == "list":
            pagecache.put("sounds", result["sounds"])
        elif action in ("login", "signup", "logout"):
            pagecache.forget()
            pagecache.put("account", result.get("account"))
        self.send_json({"ok": True, **result})

    def handle_boards(self, action, data):
        """The Boards tab. Every answer is {"ok": true, ...} or {"ok": false, "error": "..."}."""
        board_id = data.get("id")
        try:
            if action.startswith("team-"):  # team boards, shared through the accounts
                try:
                    if action == "team-delete" and not data.get("forGood"):  # into the Trash (30 days)
                        trash.put_shared("board", board_id)
                        result = {}
                    else:
                        result = boards.team(action[5:], data)
                except sfx.LoggedOut as e:
                    return self.send_json({"ok": False, "error": str(e), "loggedOut": True})
            elif action == "list":
                result = {"boards": boards.list_all()}
            elif action == "due":  # the Home widget: cards due soon
                result = {"cards": boards.due_cards()}
            elif action == "create":
                result = {"board": boards.create(data.get("board"))}
            elif action == "open":
                result = {"board": boards.open_(board_id)}
            elif action == "get":  # another board, to move a card or list there
                result = {"board": boards.get(board_id)}
            elif action == "save":
                result = {"updated": boards.save(board_id, data.get("board"))}
            elif action == "star":
                boards.star(board_id, data.get("starred"))
                result = {}
            elif action == "delete":  # into the Trash (30 days)
                if data.get("forGood"):
                    boards.delete(board_id)
                else:
                    trash.put_local("board", board_id, boards._title(boards.get(board_id).get("title")))
                result = {}
            else:
                return self.send_error(404)
        except sfx.LoggedOut as e:
            return self.send_json({"ok": False, "error": str(e), "loggedOut": True})
        except (boards.Error, sfx.Error) as e:
            return self.send_json({"ok": False, "error": str(e)})
        except OSError:
            return self.send_json({"ok": False, "error": "Couldn't save the board. Try again."})
        self.send_json({"ok": True, **result})

    def handle_film(self, action, data):
        """The Film assets tab. Every answer is {"ok": true, ...} or {"ok": false, "error": "..."}."""
        f = film.film
        pack_id = str(data.get("pack") or "") or None
        try:
            if action == "list":
                result = f.list()
            elif action == "pack":
                result = f.pack(pack_id)
            elif action == "setup":
                result = f.setup(data.get("keyId"), data.get("key"))
            elif action == "new-pack":
                result = {"pack": f.new_pack(data)}
            elif action == "edit-pack":
                result = {"pack": f.edit_pack(pack_id, data)}
            elif action == "delete-pack":
                f.delete_pack(pack_id)
                result = {}
            elif action == "delete-clip":
                f.delete_clip(pack_id, data.get("clip"))
                result = {}
            elif action == "pick":  # choose clips to upload (Windows' Open window)
                if os.name != "nt":
                    return self.send_json({"ok": False, "fallback": True})
                import folder_picker
                try:
                    paths = folder_picker.pick_files("Pick the clips for this pack", film.PICK_KINDS)
                except OSError:
                    return self.send_json({"ok": False, "fallback": True})
                if paths:
                    f.add_paths(pack_id, paths)
                result = {"added": len(paths)}
            elif action == "download":
                f.download(pack_id, save_folder(data, "vfx"), str(data.get("clip") or "") or None)
                result = {}
            elif action == "jobs":
                result = f.snapshot()
            elif action == "cancel":
                f.cancel(str(data.get("id") or ""))
                result = f.snapshot()
            elif action == "clear":
                f.clear_done()
                result = f.snapshot()
            elif action == "show":
                path = str(data.get("path") or "")
                if path and path in [d["path"] for d in f.downloads] and os.path.exists(path):
                    if os.path.isdir(path):
                        open_folder(path)
                    else:
                        show_in_folder(path)
                result = {}
            else:
                return self.send_error(404)
        except sfx.LoggedOut as e:
            return self.send_json({"ok": False, "error": str(e), "loggedOut": True})
        except (film.Error, sfx.Error) as e:
            return self.send_json({"ok": False, "error": str(e)})
        except OSError:
            return self.send_json({"ok": False, "error": "Couldn't open that file or folder."})
        self.send_json({"ok": True, **result})

    def handle_projects(self, action, data):
        """(Beta) Projects: edit videos together. Every answer is {"ok": true, ...} or {"ok": false, "error": "..."}."""
        p = editprojects.projects
        pid = str(data.get("project") or "") or None
        try:
            if action == "list":
                result = p.list()
            elif action == "open":
                result = p.open(pid)
            elif action == "people":
                result = {"people": p.people()}
            elif action == "setup":
                result = p.setup(data.get("keyId"), data.get("key"))
            elif action == "create":
                result = p.create(data)
            elif action == "edit":
                result = p.edit(pid, data)
            elif action == "invite":
                result = {"people": p.invite(pid, data.get("usernames"), data.get("role"))}
            elif action == "role":
                result = {"people": p.set_role(pid, data.get("username"), data.get("role"))}
            elif action == "remove":
                result = {"people": p.remove(pid, data.get("username"))}
            elif action == "leave":
                p.leave(pid)
                result = {}
            elif action == "answer":
                p.answer(pid, data.get("join"))
                result = {}
            elif action == "delete":
                p.delete(pid)
                result = {}
            elif action in ("note", "note_done", "note_delete", "ask_turn", "move_file", "shot_add", "shot_edit", "shot_done", "shot_delete"):
                keep = {"note": ("cut", "at", "body"), "note_done": ("id", "done"), "note_delete": ("id",),
                        "ask_turn": (), "move_file": ("id", "folder"), "shot_add": ("title", "about", "who"),
                        "shot_edit": ("id", "title", "about", "who"), "shot_done": ("id", "done"), "shot_delete": ("id",)}[action]
                if action == "shot_edit":
                    keep = tuple(k for k in keep if k in data)
                p.simple(pid, action, {k: data.get(k) for k in keep})
                result = {}
            elif action == "delete-file":
                p.delete_file(pid, data.get("id"))
                result = {}
            elif action == "delete-cut":
                p.delete_cut(pid, data.get("id"))
                result = {}
            elif action == "add-sound":
                p.add_sound(pid, data.get("sound") or {})
                result = {}
            elif action == "pick-footage":  # choose footage to upload (Windows' Open window)
                if os.name != "nt":
                    return self.send_json({"ok": False, "fallback": True})
                import folder_picker
                try:
                    paths = folder_picker.pick_files("Pick the footage to add", editprojects.PICK_FOOTAGE)
                except OSError:
                    return self.send_json({"ok": False, "fallback": True})
                if paths:
                    p.add_paths(pid, data.get("folder"), paths, shot=data.get("shot"))
                result = {"added": len(paths)}
            elif action == "pick-file":  # the timeline or the video for a new cut
                if os.name != "nt":
                    return self.send_json({"ok": False, "error": "Picking files only works on Windows."})
                import folder_picker
                video = data.get("kind") == "video"
                paths = folder_picker.pick_files("Pick the video of this cut" if video else "Pick the timeline you exported from Resolve",
                                                 editprojects.PICK_VIDEO if video else editprojects.PICK_TIMELINE)
                path = paths[0] if paths else ""
                if path:
                    pj_picked.add(os.path.normcase(os.path.abspath(path)))
                result = {"path": path, "name": os.path.basename(path)}
            elif action == "upload-cut":
                timeline, video = str(data.get("timeline") or ""), str(data.get("video") or "")
                for path in filter(None, (timeline, video)):  # (only files picked in the Open window)
                    if os.path.normcase(os.path.abspath(path)) not in pj_picked:
                        return self.send_json({"ok": False, "error": "Pick the file again."})
                result = {"job": p.upload_cut(pid, timeline, video, data.get("note"))}
            elif action == "get-all":
                result = {"job": p.get_all(pid)}
            elif action == "edit-start":
                result = p.start_editing(pid, str(data.get("cut") or "") or None, data.get("markers") is not False, bool(data.get("force")))
            elif action == "edit-stop":
                p.stop_editing(pid)
                result = {}
            elif action == "jobs":
                result = p.snapshot()
            elif action == "cancel":
                p.cancel(str(data.get("id") or ""))
                result = p.snapshot()
            elif action == "clear":
                p.clear_done()
                result = p.snapshot()
            # ---- (2.41.0) PC to PC: the page sends and gets the files (projects.js), this PC keeps them (projectsync.py)
            elif action == "net-sync":
                result = projectsync.sync.sync(str(data.get("me") or ""))
            elif action == "net-check":
                result = editprojects._rpc("check", data={"after": int(data.get("after") or 0)})
            elif action == "net-signal":
                editprojects._rpc("signal", pid, {k: str(data.get(k) or "") for k in ("to", "transfer", "kind", "sdp")})
                result = {}
            elif action == "net-can-send":
                result = projectsync.sync.can_send(pid, str(data.get("id") or ""))
            elif action == "net-start":
                result = projectsync.sync.start(str(data.get("id") or ""))
            elif action == "net-forget":
                projectsync.sync.forget(str(data.get("id") or ""))
                result = {}
            elif action == "net-options":
                result = {"options": projectsync.set_options(data.get("options") or {}) if data.get("options") else projectsync.options()}
            elif action == "show":  # a file or folder inside a project's folder on this PC
                path = os.path.abspath(str(data.get("path") or ""))
                root = os.path.abspath(editprojects.base_folder())
                known = [os.path.abspath(v) for v in (settings.load().get("projects_dirs") or {}).values() if isinstance(v, str)]
                inside = any(os.path.normcase(path) == os.path.normcase(r) or os.path.normcase(path).startswith(os.path.normcase(r) + os.sep)
                             for r in [root, *known])
                if inside and os.path.isdir(path):
                    open_folder(path)
                elif inside and os.path.isfile(path):
                    show_in_folder(path)
                result = {}
            else:
                return self.send_error(404)
        except sfx.LoggedOut as e:
            return self.send_json({"ok": False, "error": str(e), "loggedOut": True})
        except (film.Error, sfx.Error, projectsync.Error) as e:
            return self.send_json({"ok": False, "error": str(e)})
        except OSError:
            return self.send_json({"ok": False, "error": "Couldn't open that file or folder."})
        self.send_json({"ok": True, **result})

    def handle_games(self, action, data):
        """The Games tab. Every answer is {"ok": true, ...} or {"ok": false, "error": "..."}."""
        g = games.games
        game_id = str(data.get("game") or "") or None
        try:
            if action == "list":
                result = g.list()
            elif action == "add":
                result = g.add(data.get("text"), data.get("note"))
            elif action == "refresh":
                result = {"game": g.refresh(game_id)}
            elif action == "youtube":
                result = {"game": g.youtube(game_id, data.get("name"))}
            elif action == "vote":
                result = {"game": g.vote(game_id, data.get("on"))}
            elif action == "status":
                result = {"game": g.set_status(game_id, data.get("status"), data.get("video"))}
            elif action == "note":
                result = {"game": g.set_note(game_id, data.get("note"))}
            elif action == "delete":
                g.delete(game_id)
                result = {}
            elif action == "comments":
                result = {"comments": g.comments(game_id)}
            elif action == "comment":
                result = {"comments": g.comment(game_id, data.get("text"))}
            elif action == "delete-comment":
                result = {"comments": g.delete_comment(game_id, data.get("comment"))}
            elif action == "open":  # the game's Steam page, or the video made of it
                url = str(data.get("url") or "")
                if data.get("app"):
                    url = games.store_url(data["app"])
                if re.fullmatch(r"https?://[^\s]+", url, re.I):
                    webbrowser.open(url)
                result = {}
            else:
                return self.send_error(404)
        except sfx.LoggedOut as e:
            return self.send_json({"ok": False, "error": str(e), "loggedOut": True})
        except (games.Error, sfx.Error) as e:
            return self.send_json({"ok": False, "error": str(e)})
        except (TypeError, ValueError):
            return self.send_json({"ok": False, "error": "Something about that wasn't right. Try again."})
        self.send_json({"ok": True, **result})

    def handle_povs(self, action, data):
        """The POVs tab. Every answer is {"ok": true, ...} or {"ok": false, "error": "..."}."""
        p = povs.povs
        item = str(data.get("id") or "") or None
        try:
            if action == "list":
                result = p.list()
            elif action == "new-session":
                result = p.new_session(data.get("title"), data.get("game"))
            elif action == "edit-session":
                p.edit_session(item, data.get("title"), data.get("game"))
                result = {}
            elif action == "delete-session":
                p.delete_session(item)
                result = {}
            elif action == "pick":  # choose the video for "New video" (Windows' Open window); saved with "new-video"
                path = ""
                if os.environ.get("VAULTHUB_TEST_PICK"):  # (tests: no Windows window to pick in)
                    path = str(data.get("path") or "")
                elif os.name == "nt":
                    import folder_picker
                    try:
                        paths = folder_picker.pick_files("Pick your video", povs.PICK_KINDS)
                    except OSError:
                        paths = []
                    path = paths[0] if paths else ""
                if not path or not os.path.isfile(path):
                    return self.send_json({"ok": False, "cancelled": True})
                result = p.picked(path)
            elif action == "new-video":
                result = {"file": p.new_video(data.get("name"), data.get("path"), data.get("hours"))}
            elif action in ("add", "relink"):  # pick your recording (Windows' Open window)
                path = ""
                if os.environ.get("VAULTHUB_TEST_PICK"):  # (tests: no Windows window to pick in)
                    path = str(data.get("path") or "")
                elif os.name == "nt":
                    import folder_picker
                    try:
                        paths = folder_picker.pick_files("Pick your recording", povs.PICK_KINDS)
                    except OSError:
                        paths = []
                    path = paths[0] if paths else ""
                if not path:
                    return self.send_json({"ok": False, "cancelled": True})
                if action == "add":
                    result = {"file": p.add(item, path, data.get("hours"))}
                else:
                    p.relink(item, path, data.get("size"))
                    result = {}
            elif action == "timer":
                result = {"file": p.timer(item, data.get("hours"))}
            elif action == "remove":
                p.remove(item)
                result = {}
            elif action == "check":
                result = p.check(data.get("after"), bool(data.get("busy")))
            elif action == "signal":
                p.signal(item, data.get("to"), data.get("transfer"), data.get("kind"), data.get("sdp"))
                result = {}
            elif action == "can-send":
                result = p.can_send(item)
            elif action == "start":
                result = p.start(item, save_folder(data, "footage") if data.get("folder") else "",
                                 data.get("name"), data.get("size"), data.get("session"), data.get("by"))
            elif action == "cancel":
                p.cancel(item, bool(data.get("delete")))
                result = {}
            elif action == "show":
                path = p.path_of(item)
                if path and os.path.isfile(path):
                    show_in_folder(path)
                elif path and os.path.isdir(path):
                    open_folder(path)
                result = {}
            elif action == "awake":
                p.keep_awake(bool(data.get("on")))
                result = {}
            else:
                return self.send_error(404)
        except sfx.LoggedOut as e:
            return self.send_json({"ok": False, "error": str(e), "loggedOut": True})
        except (povs.Error, sfx.Error) as e:
            return self.send_json({"ok": False, "error": str(e)})
        except OSError:
            return self.send_json({"ok": False, "error": "Couldn't open that file or folder."})
        except (TypeError, ValueError):
            return self.send_json({"ok": False, "error": "Something about that wasn't right. Try again."})
        self.send_json({"ok": True, **result})

    def handle_remote(self, action, data):
        """(2.37.0) The Remote desktop: the Remote page, and the hidden sender page (ui/remote-host.html)."""
        try:
            if action == "info":
                result = remote.info()
            elif action == "set":
                result = remote.set_options(data)
                if any(k in data for k in ("host",)):
                    start_remote_engine()
            elif action == "hello":  # every few seconds: this PC is here; the others and notes for it
                me = remote.info()
                args = {"token": sfx.library._token(), "what": "hello", "device": me["device"], "after": int(data.get("after") or 0),
                        "data": {"name": me["name"], "kind": me["kind"], "host": me["host"] and bool(data.get("sender")),
                                 "ctrlKey": str(data.get("ctrlKey") or "")[:400], "hostKey": str(data.get("hostKey") or "")[:400],
                                 "width": data.get("width"), "height": data.get("height"), "busy": bool(me["session"])}}
                if not data.get("sender"):
                    args["data"]["host"] = me["host"] and remote._state["engine"] != ""
                result = sfx._rpc("lelons_remote", **args) or {}
                if not result.get("ok"):
                    return self.send_json({"ok": False, "error": result.get("error") or "no"})
            elif action == "signal":
                me = remote.info()
                result = sfx._rpc("lelons_remote", token=sfx.library._token(), what="signal", device=me["device"],
                                  data={"to": str(data.get("to") or ""), "kind": str(data.get("kind") or ""),
                                        "body": str(data.get("body") or "")[:60000]}) or {}
                if not result.get("ok"):
                    return self.send_json({"ok": False, "error": result.get("error") or "no"})
            elif action in ("rename", "forget"):
                me = remote.info()
                device = str(data.get("device") or me["device"])
                result = sfx._rpc("lelons_remote", token=sfx.library._token(), what=action, device=device,
                                  data={"name": str(data.get("name") or "")}) or {}
                if action == "rename" and device == me["device"] and result.get("ok"):
                    remote.set_options({"name": data.get("name")})
            elif action == "allowed":
                result = {"allowed": remote.allowed(str(data.get("key") or ""))}
            elif action == "ask":
                result = {"id": remote.ask(data.get("name"), data.get("device"), data.get("key"), data.get("code"))}
                show_window()
            elif action == "answer":
                result = {"done": remote.answer(str(data.get("id") or ""), bool(data.get("yes")))}
            elif action == "answered":
                result = {"answer": remote.answered(str(data.get("id") or ""))}
            elif action == "remember-host":
                remote.remember_host(data.get("device"), data.get("key"))
                result = {}
            elif action == "pin":
                result = remote.pin_check(data.get("pin"))
            elif action == "start":
                remote.start(str(data.get("key") or ""), data.get("name"), data.get("screen"))
                result = {}
            elif action == "end":
                result = {"ended": remote.end(str(data.get("reason") or ""))}
            elif action == "input":
                result = remote.input_events(data.get("e"))
            elif action == "key":  # (2.38.1) this PC's own key, kept by the app (see remote.key)
                result = remote.key(data.get("role"), data.get("pub"), data.get("priv"))
            elif action == "nonce":  # (2.37.1) a hello is only ever answered once, even across restarts
                result = {"fresh": remote.nonce_fresh(data.get("nonce"))}
            elif action == "host-state":
                result = remote.host_state()
            elif action == "screen":  # show another screen: the sender starts again on it
                remote.end("screen")
                threading.Thread(target=start_remote_engine, args=(int(data.get("screen") or 0),), daemon=True).start()
                result = {}
            else:
                raise remote.Error("That didn't work.")
        except sfx.LoggedOut:
            return self.send_json({"ok": False, "error": "login"})
        except (remote.Error, sfx.Error) as e:
            return self.send_json({"ok": False, "error": str(e)})
        self.send_json({"ok": True, **result})

    def handle_trash(self, action, data):
        """The Trash bin (Settings > Trash). Every answer is {"ok": true, ...} or {"ok": false, "error": "..."}."""
        kind, item_id, where = str(data.get("kind") or ""), data.get("id"), str(data.get("where") or "")
        try:
            if action == "list":
                result = trash.list_all()
            elif action == "restore":
                trash.restore(kind, item_id, where)
                result = {}
            elif action == "purge":
                trash.purge(kind, item_id, where)
                result = {}
            elif action == "empty":
                trash.empty()
                result = {}
            else:
                return self.send_error(404)
        except sfx.LoggedOut as e:
            return self.send_json({"ok": False, "error": str(e), "loggedOut": True})
        except (trash.Error, sfx.Error, docs.Error, boards.Error) as e:
            return self.send_json({"ok": False, "error": str(e)})
        except OSError:
            return self.send_json({"ok": False, "error": "Couldn't do that. Try again."})
        self.send_json({"ok": True, **result})

    def handle_docs(self, action, data):
        """The Docs tab. Every answer is {"ok": true, ...} or {"ok": false, "error": "..."}."""
        doc_id = data.get("id")
        collab = data.get("where") == "collab"
        try:
            if action == "list":
                result = {"local": docs.local_list(), "folders": docs.folders_get()}
                if data.get("collab"):
                    try:
                        result.update(collab=docs.collab_list())
                    except sfx.LoggedOut:
                        result.update(collab=None)
                    except (docs.Error, sfx.Error) as e:
                        result.update(collab=None, collabError=str(e))
            elif action == "folders":  # your folders (and what's in them) changed
                result = {"folders": docs.folders_set(data.get("folders"))}
            elif action == "create":
                args = (data.get("title"), data.get("kind"), data.get("blocks"), data.get("settings"))
                result = {"id": docs.collab_create(*args) if collab else docs.local_create(*args)["id"]}
            elif action == "open":
                result = {"doc": docs.collab_open(doc_id) if collab else docs.local_open(doc_id)}
            elif action == "save":  # a local doc
                result = {"updated": docs.local_save(doc_id, data.get("title"), data.get("blocks"), data.get("settings"))}
            elif action == "sync":  # a collab doc that's open
                result = docs.collab_sync(doc_id, data.get("since"), data.get("changes"), data.get("title"),
                                          data.get("block"), data.get("typing"), data.get("settings"))
            elif action == "close":
                docs.collab_close(doc_id)
                result = {}
            elif action == "delete":  # into the Trash (30 days); a new doc that was never saved goes for good
                if data.get("forGood"):
                    docs.collab_delete(doc_id) if collab else docs.local_delete(doc_id)
                elif collab:
                    trash.put_shared("doc", doc_id)
                else:
                    folder = docs.folders_get()["local"]["place"].get(str(doc_id))
                    trash.put_local("doc", doc_id, docs._title(docs.local_open(doc_id).get("title")),
                                    {"folder": folder} if folder else None)
                result = {}
            elif action == "people":
                result = {"people": docs.collab_people()}
            elif action == "invite":
                result = {"people": docs.collab_invite(doc_id, data.get("usernames"))}
            elif action == "answer":
                docs.collab_answer(doc_id, data.get("join"))
                result = {}
            elif action == "remove":
                result = {"people": docs.collab_remove(doc_id, data.get("username"))}
            elif action == "comments":
                result = {"comments": docs.collab_comments(doc_id)}
            elif action == "comment":
                result = {"comments": docs.collab_comment(doc_id, data.get("what"), data.get("comment"),
                                                          data.get("block"), data.get("quote"), data.get("body"))}
            elif action == "export":
                path = docs.export(save_folder(data, "docs"), data.get("title"), data.get("ext"), data.get("text"))
                result = {"path": path, "fileName": os.path.basename(path)}
            elif action == "show":
                path = str(data.get("path") or "")
                if path in docs_saved and os.path.isfile(path):
                    show_in_folder(path)
                result = {}
            elif action == "open-link":  # ctrl+click on a link in a document
                url = str(data.get("url") or "")
                if re.fullmatch(r"(https?://|mailto:)[^\s]+", url, re.I):
                    webbrowser.open(url)
                result = {}
            else:
                return self.send_error(404)
        except sfx.LoggedOut as e:
            return self.send_json({"ok": False, "error": str(e), "loggedOut": True})
        except (docs.Error, sfx.Error) as e:
            return self.send_json({"ok": False, "error": str(e)})
        except OSError:
            return self.send_json({"ok": False, "error": "Couldn't save that. Try another folder."})
        if action == "export":
            docs_saved.add(result["path"])
        self.send_json({"ok": True, **result})

    def handle_watch(self, data):
        """Watched folders in the Files tab (watchfolders.py)."""
        action = self.path[len("/api/watch-"):]
        test_path = data.get("path") if isinstance(data.get("path"), str) and os.name != "nt" else ""
        try:
            if action == "add":
                folder = test_path or pick_folder(state.last_asked, "Pick a folder to watch")
                if not folder:
                    return self.send_json({"ok": False})
                return self.send_json({"ok": True, "watch": watches.add(folder, data.get("options"),
                                                                        data.get("subfolders", True))})
            if action == "update":
                changes = {k: data[k] for k in ("options", "on", "subfolders") if k in data}
                return self.send_json({"ok": True, "watch": watches.update(data.get("id"), changes)})
            if action == "out":  # pick where its converted files go
                e = watches.get(data.get("id"))
                if not e:
                    return self.send_json({"ok": False})
                folder = test_path or pick_folder(e["out"] if os.path.isdir(e["out"]) else e["folder"],
                                                  "Where should the converted files go?")
                if not folder:
                    return self.send_json({"ok": False})
                return self.send_json({"ok": True, "watch": watches.update(e["id"], {"out": folder})})
            if action == "backlog":
                return self.send_json({"ok": True, "count": watches.convert_backlog(data.get("id"), bool(data.get("skip")))})
            if action == "remove":
                watches.remove(data.get("id"))
                return self.send_json({"ok": True})
            if action == "open":  # open the watched folder, or its converted files
                e = watches.get(data.get("id"))
                if e:
                    folder = e["out"] if data.get("which") == "out" else e["folder"]
                    if data.get("which") == "out":
                        os.makedirs(folder, exist_ok=True)
                    open_folder(folder)
                return self.send_json({"ok": True})
        except ValueError as e:
            return self.send_json({"ok": False, "error": str(e)})
        except OSError:
            return self.send_json({"ok": False, "error": "Couldn't open that folder."})
        self.send_json({"ok": False, "error": "Unknown request."})

    def handle_post(self):
        length = int(self.headers.get("Content-Length") or 0)
        if self.path == "/api/file-add":  # the body is the file itself
            name = urllib.parse.unquote(self.headers.get("X-File-Name") or "file")
            sub = urllib.parse.unquote(self.headers.get("X-File-Folder") or "")  # from a dropped folder
            try:
                return self.send_json({"ok": True, "file": local_files.add(name, self.rfile, length, sub)})
            except ValueError as e:
                return self.send_json({"ok": False, "error": str(e)})
            except OSError:
                return self.send_json({"ok": False, "error": "Couldn't open this file."})
        if self.path == "/api/rt-add":  # a file dropped on the Resolve tab; the body is the file itself
            name = urllib.parse.unquote(self.headers.get("X-File-Name") or "file")
            try:
                return self.send_json({"ok": True, "file": resolvetools.get().add(name, self.rfile, length)})
            except ValueError as e:
                return self.send_json({"ok": False, "error": str(e)})
            except OSError:
                return self.send_json({"ok": False, "error": "Couldn't open this file."})
        if self.path == "/api/pov-write":  # the body is a piece of a POV a friend is sending
            try:
                return self.send_json({"ok": True, **povs.povs.write(self.headers.get("X-Pov") or "", int(self.headers.get("X-At") or 0), self.rfile, length)})
            except povs.Error as e:
                return self.send_json({"ok": False, "error": str(e)})
            except OSError:
                return self.send_json({"ok": False, "error": "Couldn't save the download. Is the drive full or gone?"})
        if self.path == "/api/pj-write":  # (Projects, 2.41.0) a piece of a file a friend is sending
            try:
                return self.send_json({"ok": True, **projectsync.sync.write(self.headers.get("X-File") or "", int(self.headers.get("X-At") or 0), self.rfile, length)})
            except projectsync.Error as e:
                return self.send_json({"ok": False, "error": str(e)})
            except OSError:
                return self.send_json({"ok": False, "error": "Couldn't save it. Is the drive full or gone?"})
        if self.path == "/api/pj-add":  # (Projects) the body is footage dropped on a project
            name = urllib.parse.unquote(self.headers.get("X-File-Name") or "clip")
            try:
                editprojects.projects.add_stream(self.headers.get("X-Project") or "", urllib.parse.unquote(self.headers.get("X-Folder") or ""),
                                                 os.path.basename(name), self.rfile, length, self.headers.get("X-Shot") or None)
                return self.send_json({"ok": True})
            except film.Error as e:
                return self.send_json({"ok": False, "error": str(e)})
            except OSError:
                return self.send_json({"ok": False, "error": "Couldn't open this file."})
        if self.path == "/api/fx-add":  # the body is a clip for a Film assets pack
            name = urllib.parse.unquote(self.headers.get("X-File-Name") or "clip")
            try:
                film.film.add_stream(self.headers.get("X-Pack") or "", os.path.basename(name), self.rfile, length)
                return self.send_json({"ok": True})
            except film.Error as e:
                return self.send_json({"ok": False, "error": str(e)})
            except OSError:
                return self.send_json({"ok": False, "error": "Couldn't open this file."})
        if self.path in ("/api/chat-voice", "/api/chat-gif"):  # (2.31.0) the body is a voice message (WebM) or a GIF
            if length > 40 * 1024 * 1024:
                return self.send_json({"ok": False, "error": "That's too big to send."})
            h = self.headers
            try:
                body = self.rfile.read(length)
                if self.path == "/api/chat-voice":
                    upload = sfx.library.chat_voice(body, h.get("X-Seconds"), json.loads(urllib.parse.unquote(h.get("X-Peaks") or "[]")))
                else:
                    upload = sfx.library.chat_gif(body, urllib.parse.unquote(h.get("X-File-Name") or "GIF"))
                to = urllib.parse.unquote(h.get("X-With") or "") or None
                sfx.library.chat_send("", to, reply_to=h.get("X-Reply") or None, thread_of=h.get("X-Thread") or None, upload=upload)
                return self.send_json({"ok": True})
            except ValueError:
                return self.send_json({"ok": False, "error": "That didn't send. Try again."})
            except sfx.Error as e:
                return self.send_json({"ok": False, "error": str(e), "loggedOut": isinstance(e, sfx.LoggedOut)})
        if self.path == "/api/call-record":  # the body is a call recording (WebM); saved as an MP3
            return self.send_json(save_call_recording(urllib.parse.unquote(self.headers.get("X-File-Name") or "Call"), self.rfile, length))
        if self.path == "/api/sfx-add":  # the body is the sound itself
            if length > 2 * 1024 ** 3:
                return self.send_json({"ok": False, "error": "That file is too big."})
            name = urllib.parse.unquote(self.headers.get("X-File-Name") or "sound")
            try:
                return self.send_json({"ok": True, "file": sfx.library.add(name, self.rfile, length)})
            except sfx.Error as e:
                return self.send_json({"ok": False, "error": str(e)})
            except OSError:
                return self.send_json({"ok": False, "error": "Couldn't open this file."})
        if self.path == "/api/copyright-add":  # the body is the sound or video to check
            if length > 2 * 1024 ** 3:
                return self.send_json({"ok": False, "error": "That file is too big."})
            name = urllib.parse.unquote(self.headers.get("X-File-Name") or "sound")
            try:
                return self.send_json({"ok": True, "item": copyright_check.checker.add(name, self.rfile, length)})
            except copyright_check.Error as e:
                return self.send_json({"ok": False, "error": str(e)})
            except OSError:
                return self.send_json({"ok": False, "error": "Couldn't open this file."})
        if self.path == "/api/sfx-group-picture-upload":  # the body is the group chat's new picture
            if length > 30 * 1024 * 1024:
                return self.send_json({"ok": False, "error": "That picture is too big."})
            group = self.headers.get("X-Group") or ""
            try:
                return self.send_json({"ok": True, **sfx.library.set_group_picture(group, self.rfile.read(length))})
            except sfx.Error as e:
                return self.send_json({"ok": False, "error": str(e), "loggedOut": isinstance(e, sfx.LoggedOut)})
        if self.path == "/api/sfx-server-picture-upload":  # the body is a server's new picture
            if length > 30 * 1024 * 1024:
                return self.send_json({"ok": False, "error": "That picture is too big."})
            try:
                return self.send_json({"ok": True, **sfx.library.set_server_picture(
                    self.headers.get("X-Server") or "", self.rfile.read(length))})
            except sfx.Error as e:
                return self.send_json({"ok": False, "error": str(e), "loggedOut": isinstance(e, sfx.LoggedOut)})
        if self.path == "/api/boards-background":  # the body is a picture for a board's background
            if length > 40 * 1024 * 1024:
                return self.send_json({"ok": False, "error": "That picture is too big."})
            try:
                bg = boards.background(self.rfile.read(length), self.headers.get("X-Team") == "1")
            except sfx.LoggedOut as e:
                return self.send_json({"ok": False, "error": str(e), "loggedOut": True})
            except boards.Error as e:
                return self.send_json({"ok": False, "error": str(e)})
            except OSError:
                return self.send_json({"ok": False, "error": "Couldn't save the picture. Try again."})
            return self.send_json({"ok": True, "bg": bg})
        if self.path == "/api/sfx-banner":  # the body is the new banner for your profile
            if length > 30 * 1024 * 1024:
                return self.send_json({"ok": False, "error": "That picture is too big."})
            try:
                return self.send_json({"ok": True, "profile": sfx.library.set_banner(self.rfile.read(length))})
            except sfx.Error as e:
                return self.send_json({"ok": False, "error": str(e), "loggedOut": isinstance(e, sfx.LoggedOut)})
        if self.path == "/api/sfx-picture":  # the body is the new profile picture
            if length > 30 * 1024 * 1024:
                return self.send_json({"ok": False, "error": "That picture is too big."})
            try:
                return self.send_json({"ok": True, "account": sfx.library.set_picture(self.rfile.read(length))})
            except sfx.Error as e:
                return self.send_json({"ok": False, "error": str(e), "loggedOut": isinstance(e, sfx.LoggedOut)})
        if self.path == "/api/image-add":  # the body is the picture itself
            if length > images.MAX_BYTES:
                return self.send_json({"ok": False, "error": "That file is too big."})
            name = urllib.parse.unquote(self.headers.get("X-File-Name") or "image")
            try:
                return self.send_json({"ok": True, "image": images.add(os.path.basename(name), self.rfile.read(length))})
            except ValueError as e:
                return self.send_json({"ok": False, "error": str(e)})
        try:
            data = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            data = {}

        if self.path == "/api/info":
            url = str(data.get("url", "")).strip()
            try:
                self.send_json({"ok": True, "preview": queue.preview(url)})
            except Exception as e:
                self.send_json({"ok": False, "error": downloader.friendly_error(e)})
        elif self.path == "/api/waveform" and data.get("sfx"):
            item = sfx.library.find(data["sfx"])
            try:
                if not item:
                    raise OSError("That file is gone. Pick it again.")
                self.send_json({"ok": True, **waveform.get_local("sfx-" + item["id"], item["path"])})
            except Exception as e:
                self.send_json({"ok": False, "error": str(e) if isinstance(e, OSError) else "Couldn't load this file."})
        elif self.path == "/api/waveform" and data.get("file"):
            item = (resolvetools.get() if str(data["file"]).startswith("r") else local_files).find(data["file"])
            try:
                if not item:
                    raise OSError("That file is gone. Drop it in again.")
                self.send_json({"ok": True, **waveform.get_local(item["id"], item["path"], bool(data.get("video")))})
            except Exception as e:
                self.send_json({"ok": False, "error": str(e) if isinstance(e, OSError) else "Couldn't load this file."})
        elif self.path == "/api/waveform":
            url = str(data.get("url", "")).strip()
            try:
                info, _ = queue.lookup(url, fresh=True)
                wave = waveform.get(url, info, bool(data.get("video")), bool(data.get("prefetch")))
                self.send_json({"ok": True, **wave})
            except Exception as e:
                self.send_json({"ok": False, "error": downloader.friendly_error(e)})
        elif self.path == "/api/convert":
            url = str(data.get("url", "")).strip()
            fmt = data.get("format") if data.get("format") in settings.QUALITIES else "mp3"
            if not url:
                return self.send_json({"ok": False, "error": "Paste a link first."})
            trim = None
            if data.get("start") or data.get("end"):
                start = downloader.parse_time(data.get("start") or "0")
                end = downloader.parse_time(data.get("end")) if data.get("end") else None
                try:
                    length = queue.preview(url).get("seconds") or 0
                except Exception:
                    length = 0  # the download will report what's wrong with the link
                if end is None and length:
                    end = length
                if start is None or end is None or end <= start:
                    return self.send_json({"ok": False, "error": "Check the trim times, like 1:20 to 2:05."})
                # The whole video isn't a trim. (For a GIF it is: no trim means the first 10 seconds.)
                if fmt == "gif" or not (start <= 0 and length and end >= length):
                    trim = [start, min(end, length) if length else end]
            if fmt == "gif":
                if trim and trim[1] - trim[0] > media.GIF_MAX_SECONDS + 0.05:
                    return self.send_json({"ok": False, "error": f"GIFs can be up to {media.GIF_MAX_SECONDS} seconds. Trim it shorter."})
                if not trim:  # a GIF of a whole video would be huge
                    try:
                        length = queue.preview(url).get("seconds") or 0
                    except Exception:
                        length = 0
                    trim = [0, min(media.GIF_DEFAULT_SECONDS, length or media.GIF_DEFAULT_SECONDS)]
            quality = state.quality[fmt]
            queue.add(url, fmt, quality, quality_label(fmt, quality), save_folder(data, project.kind_for(fmt)), trim, state.normalize)
            state.set(notice=None)
            self.send_json({"ok": True})
        elif self.path == "/api/convert-many":
            # Videos picked from a playlist.
            fmt = data.get("format") if data.get("format") in settings.QUALITIES else "mp3"
            quality = state.quality[fmt]
            items = [i for i in (data.get("items") or []) if isinstance(i, dict) and str(i.get("url", "")).startswith("http")]
            for item in items:
                trim = [0, min(media.GIF_DEFAULT_SECONDS, int(item.get("seconds") or 0) or media.GIF_DEFAULT_SECONDS)] if fmt == "gif" else None
                queue.add(str(item["url"]), fmt, quality, quality_label(fmt, quality), save_folder(data, project.kind_for(fmt)), trim,
                          state.normalize, preview=item)
            state.set(notice=None)
            self.send_json({"ok": True, "added": len(items)})
        elif self.path == "/api/normalize":
            state.set(normalize=bool(data.get("on")))
            settings.save(normalize=state.normalize)
            self.send_json(state.snapshot())
        elif self.path == "/api/remove":
            queue.remove(data.get("id"))
            self.send_json({"ok": True})
        elif self.path == "/api/history-again":
            item = history.find(str(data.get("id")))
            if not item or item.get("format") not in settings.QUALITIES:
                return self.send_json({"ok": False, "error": "That download isn't in the list anymore."})
            fmt, quality = item["format"], str(item.get("quality"))
            if not settings.is_valid_quality(fmt, quality):
                quality = state.quality.get(fmt) or settings.DEFAULT_QUALITY[fmt]
            trim = item.get("trim")
            trim = (float(trim[0]), float(trim[1])) if isinstance(trim, list) and len(trim) == 2 else None
            queue.add(item["url"], fmt, quality, quality_label(fmt, quality), save_folder(data, project.kind_for(fmt)), trim,
                      state.normalize, preview=item)
            self.send_json({"ok": True})
        elif self.path == "/api/history-show":
            item = history.find(str(data.get("id")))
            if item:
                show_in_folder(item.get("file") or "")
            self.send_json({"ok": True})
        elif self.path == "/api/history-remove":
            history.remove(str(data.get("id")))
            self.send_json({"ok": True})
        elif self.path in ("/api/find-search", "/api/find-add", "/api/find-save"):  # Find sounds in the Library
            try:
                if self.path == "/api/find-search":
                    result = findsounds.search(data.get("query"), data.get("source"), data.get("page") or 1,
                                             data.get("safe", True))
                elif self.path == "/api/find-add":
                    result = {"file": findsounds.add_to_library(data.get("id"))}
                else:
                    path = findsounds.save(data.get("id"), save_folder(data, "sfx"))
                    result = {"path": path, "fileName": os.path.basename(path)}
            except (findsounds.Error, sfx.Error) as e:
                return self.send_json({"ok": False, "error": str(e)})
            except Exception:
                return self.send_json({"ok": False, "error": "That didn't work. Try another sound."})
            self.send_json({"ok": True, **result})
        elif self.path == "/api/stats":  # the channel stats page
            self.send_json(stats_page(data.get("days")))
        elif self.path == "/api/home":
            page = home_page()
            if not page["crewError"]:
                pagecache.put("home", page)
            self.send_json(page)
        elif self.path == "/api/home-channels":  # the owner changes the channels on everyone's Home page
            links = [home.normalize(t) for t in data.get("channels") or [] if str(t).strip()]
            if None in links:
                return self.send_json({"ok": False, "error": "One of those isn't a YouTube channel link."})
            try:
                sfx.library.set_channels(list(dict.fromkeys(links)))
            except sfx.Error as e:
                return self.send_json({"ok": False, "error": str(e)})
            self.send_json({"ok": True, **home_page()})
        elif self.path == "/api/open-youtube":  # Watch on the Home page
            url = str(data.get("url") or "")
            if re.fullmatch(r"https://www\.youtube\.com/(watch\?v=[\w-]{11}|@[^/?#\s]+|channel/[\w-]+|c/[^/?#\s]+|user/[^/?#\s]+)", url):
                webbrowser.open(url)
            self.send_json({"ok": True})
        elif self.path == "/api/call-key":  # push-to-talk: is this key held down? (in any app, so it works in games)
            vk = int(data.get("vk") or 0)
            if os.name != "nt" or not 0 < vk < 256:
                return self.send_json({"ok": False})
            down = bool(ctypes.windll.user32.GetAsyncKeyState(vk) & 0x8000)
            self.send_json({"ok": True, "down": down})
        elif self.path == "/api/call-record-show":
            path = data.get("path") or ""
            if path in call_recordings and os.path.isfile(path):
                show_in_folder(path)
            self.send_json({"ok": True})
        elif self.path == "/api/history-clear":
            history.clear()
            self.send_json({"ok": True})
        elif self.path.startswith("/api/sfx-"):
            self.handle_sfx(self.path[len("/api/sfx-"):], data)
        elif self.path.startswith("/api/docs-"):
            self.handle_docs(self.path[len("/api/docs-"):], data)
        elif self.path.startswith("/api/boards-"):
            self.handle_boards(self.path[len("/api/boards-"):], data)
        elif self.path.startswith("/api/trash-"):
            self.handle_trash(self.path[len("/api/trash-"):], data)
        elif self.path.startswith("/api/pj-"):
            self.handle_projects(self.path[len("/api/pj-"):], data)
        elif self.path.startswith("/api/fx-"):
            self.handle_film(self.path[len("/api/fx-"):], data)
        elif self.path.startswith("/api/ch-"):
            self.handle_channel(self.path[len("/api/ch-"):], data)
        elif self.path.startswith("/api/cm-"):
            self.handle_comments(self.path[len("/api/cm-"):], data)
        elif self.path.startswith("/api/live-"):
            self.handle_live(self.path[len("/api/live-"):], data)
        elif self.path == "/api/titles-look":  # the Titles & tags tab looks up a topic on YouTube
            try:
                self.send_json(titles.look_up(data.get("topic")))
            except titles.Error as e:
                self.send_json({"ok": False, "error": str(e)})
        elif self.path.startswith("/api/games-"):
            self.handle_games(self.path[len("/api/games-"):], data)
        elif self.path.startswith("/api/remote-"):
            self.handle_remote(self.path[len("/api/remote-"):], data)
        elif self.path.startswith("/api/pov-"):
            self.handle_povs(self.path[len("/api/pov-"):], data)
        elif self.path == "/api/cancel":
            queue.cancel(data.get("id"))
            self.send_json({"ok": True})
        elif self.path == "/api/retry":
            queue.retry(data.get("id"))
            self.send_json({"ok": True})
        elif self.path == "/api/clear":
            queue.clear_finished()
            self.send_json({"ok": True})
        elif self.path == "/api/drag":
            try:
                offset = data.get("offset")
                offset = offset if isinstance(offset, list) and len(offset) == 2 else None
                number = start_drag(drag_path(data), drag_image(data), offset)
                self.send_json({"ok": True, "drag": number})
            except (ValueError, sfx.Error) as e:
                self.send_json({"ok": False, "error": str(e)})
        elif self.path == "/api/copyright-list":
            self.send_json({"ok": True, "items": copyright_check.checker.snapshot()})
        elif self.path == "/api/copyright-pick":
            if os.name != "nt":
                return self.send_json({"ok": False, "fallback": True})
            import folder_picker
            try:
                paths = folder_picker.pick_files("Pick songs or videos to check", sfx.UPLOAD_KINDS)
            except OSError:
                return self.send_json({"ok": False, "fallback": True})
            for path in paths[:20]:
                copyright_check.checker.add_path(path)
            self.send_json({"ok": True})
        elif self.path == "/api/copyright-sound":  # a Library sound
            try:
                path = sfx.library.drag_copy(str(data.get("url") or ""), data.get("name"))
                sound_id = str(data.get("id") or "")
                copyright_check.checker.add_path(path, str(data.get("name") or os.path.basename(path)),
                                                 done=sfx.song_check.remember(sound_id) if sound_id else None)
                self.send_json({"ok": True})
            except (ValueError, sfx.Error) as e:
                self.send_json({"ok": False, "error": str(e)})
        elif self.path == "/api/copyright-remove":
            copyright_check.checker.remove(data.get("id"))
            self.send_json({"ok": True, "items": copyright_check.checker.snapshot()})
        elif self.path == "/api/copyright-clear":
            copyright_check.checker.clear()
            self.send_json({"ok": True, "items": copyright_check.checker.snapshot()})
        elif self.path == "/api/drag-state":
            self.send_json({"ok": True, **drag_state})
        elif self.path == "/api/clip":  # the trim editor's clip to drag: make it for this start and end
            try:
                self.send_json({"ok": True, "clip": clip_maker.want(data)})
            except ValueError as e:
                self.send_json({"ok": False, "error": str(e)})
        elif self.path == "/api/clip-close":
            clip_maker.close(data.get("key"))
            self.send_json({"ok": True})
        elif self.path == "/api/clip-state":
            self.send_json({"ok": True, "clip": clip_maker.state(data.get("key"))})
        elif self.path == "/api/drag-ready":  # the mouse is over a library sound: have it ready to drag
            try:
                sfx.library.drag_copy(str(data.get("url") or ""), data.get("name"))
                self.send_json({"ok": True})
            except sfx.Error as e:
                self.send_json({"ok": False, "error": str(e)})
        elif self.path == "/api/show-file":
            job = queue.find(data.get("id"))
            if job:
                show_in_folder(job["file"])
            self.send_json({"ok": True})
        elif self.path == "/api/files-pick":
            # The Windows Open window gives real paths, so nothing has to be copied.
            if os.name != "nt":
                return self.send_json({"ok": False, "fallback": True})
            import folder_picker
            try:
                paths = folder_picker.pick_files("Pick videos or songs", files.PICK_KINDS)
            except OSError:
                return self.send_json({"ok": False, "fallback": True})
            added, errors = [], []
            for path in paths:
                try:
                    added.append(local_files.add_path(path))
                except (ValueError, OSError) as e:
                    errors.append(str(e) if isinstance(e, ValueError) else f"Couldn't open {os.path.basename(path)}.")
            self.send_json({"ok": True, "files": added, "errors": errors})
        elif self.path == "/api/files-pick-folder":
            # A whole folder: everything in it (and its subfolders) is added where it is, nothing copied.
            folder = data.get("path") if isinstance(data.get("path"), str) and os.name != "nt" else ""
            folder = folder or pick_folder(state.last_asked, "Pick a folder with videos or songs")
            if not folder:
                return self.send_json({"ok": False})
            try:
                self.send_json({"ok": True, "count": local_files.add_folder(folder)})
            except (ValueError, OSError) as e:
                self.send_json({"ok": False, "error": str(e) if isinstance(e, ValueError) else "Couldn't open that folder."})
        elif self.path.startswith("/api/watch-"):
            self.handle_watch(data)
        elif self.path == "/api/files-convert":
            try:
                local_files.convert(data.get("items") or [], data.get("options") or {},
                                   save_folder(data, project.kind_for((data.get("options") or {}).get("format"))))
            except ValueError as e:
                return self.send_json({"ok": False, "error": str(e)})
            self.send_json({"ok": True})
        elif self.path == "/api/file-remove":
            local_files.remove(data.get("id"))
            self.send_json({"ok": True})
        elif self.path == "/api/file-cancel":
            local_files.cancel(data.get("id"))
            self.send_json({"ok": True})
        elif self.path == "/api/files-clear":
            local_files.clear()
            self.send_json({"ok": True})
        elif self.path.startswith(("/api/rt-", "/api/project-")):
            self.handle_resolve(data)
        elif self.path == "/api/file-show":
            item = local_files.find(data.get("id"))
            if item and item["out"]:
                show_in_folder(item["out"])
            self.send_json({"ok": True})
        elif self.path == "/api/image-convert":
            try:
                made = images.convert(str(data.get("id")), data.get("options") or {}, save_folder(data, "pictures"))
                self.send_json({"ok": True, **made})
            except Exception as e:
                self.send_json({"ok": False, "error": str(e) if isinstance(e, ValueError) else "Couldn't save this picture."})
        elif self.path == "/api/image-remove":
            images.remove(str(data.get("id")))
            self.send_json({"ok": True})
        elif self.path == "/api/image-show":
            if images.was_made(data.get("path")):
                show_in_folder(data["path"])
            self.send_json({"ok": True})
        elif self.path == "/api/quality":
            fmt, quality = data.get("format"), str(data.get("quality"))
            if settings.is_valid_quality(fmt, quality):
                state.quality[fmt] = quality
                settings.save(**{f"quality_{fmt}": quality})
            self.send_json(state.snapshot())
        elif self.path == "/api/pick-folder":
            folder = pick_folder(state.folder)
            picked = bool(folder and os.path.isdir(folder))
            if picked:
                state.set(folder=os.path.normpath(folder))
                settings.save(folder=state.folder)
            self.send_json({**state.snapshot(), "picked": picked})
        elif self.path == "/api/ask-folder":  # before saving: where to? (or the folder picked in Settings)
            if project.current():  # a project folder is on: everything goes into it
                return self.send_json({"ok": True, "folder": project.current()})
            if state.save_mode != "ask":
                return self.send_json({"ok": True, "folder": state.folder})
            folder = pick_folder(state.last_asked, "Where should this be saved?")
            if not folder or not os.path.isdir(folder):
                return self.send_json({"ok": False, "cancelled": True})
            state.set(last_asked=os.path.normpath(folder))
            settings.save(last_asked=state.last_asked)
            self.send_json({"ok": True, "folder": state.last_asked})
        elif self.path == "/api/open-folder":
            open_folder(state.folder)
            self.send_json({"ok": True})
        elif self.path == "/api/check-updates":
            start_background(check_for_updates, True)
            self.send_json({"ok": True})
        elif self.path == "/api/notify":  # the bell got something new: a Windows notification, if the app isn't in front
            shown = False
            busy = bool(data.get("quietBusy")) and live_or_recording()
            if not busy and data.get("desktop") and appwindow.active() and not appwindow.in_front():
                shown = appwindow.toast(data.get("title"), data.get("text"), data.get("quiet"), data.get("key"))
                appwindow.flash()
            self.send_json({"ok": True, "shown": shown, "busy": busy})
        elif self.path == "/api/notify-clicked":  # did they click one of those? (then the page opens it)
            self.send_json({"ok": True, "clicked": appwindow.take_clicked()})
        elif self.path == "/api/page-pref":  # something the page remembers (see ui/theme.js)
            key, value = data.get("key"), data.get("value")
            if (key in PAGE_PREFS or re.fullmatch(r"docs?[A-Z][\w]{1,40}(:[\w-]{1,40})?", str(key))) and len(json.dumps(value)) < (40000 if key in ("notes", "lvPads") else 4000):
                with page_pref_lock:
                    saved = settings.load().get("page") or {}
                    settings.save(page={**saved, key: value})
            self.send_json({"ok": True})
        elif self.path == "/api/settings":  # the Settings window
            changes = {}
            if "hardware" in data:
                changes["hardware"] = bool(data["hardware"])
                media.use_gpu(changes["hardware"])
            if data.get("theme") in settings.THEMES:
                changes["theme"] = data["theme"]
            if settings.is_accent(data.get("accent")):
                changes["accent"] = data["accent"].lower()
            if isinstance(data.get("zoom"), (int, float)):
                changes["zoom"] = round(min(2.0, max(0.5, float(data["zoom"]))), 2)
                appwindow.set_zoom(changes["zoom"])
            if data.get("saveMode") in settings.SAVE_MODES:
                changes["save_mode"] = data["saveMode"]
            if "theme" in changes:
                appwindow.set_dark(changes["theme"] != "light")
            state.set(**changes)
            settings.save(**changes)
            self.send_json(state.snapshot())
        elif self.path == "/api/seen-version":  # "What's new" was shown for this version
            state.set(seen_version=VERSION)
            settings.save(seen_version=VERSION)
            self.send_json({"ok": True})
        elif self.path == "/api/auto-update":
            state.set(auto_update=bool(data.get("on")))
            settings.save(auto_update=state.auto_update)
            self.send_json(state.snapshot())
        elif self.path == "/api/show-window":
            # The app was started again while it's open. (Maybe its window was
            # just closed: don't quit while the new one opens.)
            state.set(last_ping=time.time(), closed_at=None)
            open_window(f"http://127.0.0.1:{self.server.server_port}/?t={TOKEN}")
            self.send_json({"ok": True})
        elif self.path == "/api/quit":
            # A different version of the app was started and needs this one gone.
            state.set(quit=True)
            self.send_json({"ok": True})
        elif self.path == "/api/install-app-update":
            # Installing closes the app, which would stop what's converting.
            if state.converting:
                return self.send_json({"ok": False, "error": "Wait until your downloads and files are done, then install the update."})
            if state.start("installing"):
                start_background(install_app_update)
            self.send_json({"ok": True})
        elif self.path == "/api/bye":
            # The window was closed or reloaded; a reload pings again right away.
            state.set(closed_at=time.time())
            self.send_json({"ok": True})
        else:
            self.send_error(404)


# ---------------------------------------------------------------- window

def find_edge():
    for var in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"):
        path = os.path.join(os.environ.get(var, ""), "Microsoft", "Edge", "Application", "msedge.exe")
        if os.path.isfile(path):
            return path
    return shutil.which("msedge")


# Written while the app's own window opens. If opening it ever crashed the app,
# the file is still there at the next start: then Edge is used from then on.
WINDOW_STARTING = os.path.join(settings.DATA_DIR, "window-starting")
_window_lock = threading.Lock()  # one window opening at a time


def check_window_crash():
    """Call once at startup."""
    if os.path.exists(WINDOW_STARTING):
        settings.save(own_window=False)
        try:
            os.remove(WINDOW_STARTING)
        except OSError:
            pass


def window_closed(placement):
    if placement:
        settings.save(window=placement)
    state.set(closed_at=time.time())
    # (2.39.0) Out of any call right away, so friends don't see you in a voice channel for half a minute
    try:
        if sfx.configured() and settings.load().get("library_token"):
            bye = threading.Thread(target=lambda: _quietly(sfx.library.room, "bye"), daemon=True)
            bye.start()
            bye.join(3)
    except Exception:  # noqa: BLE001
        pass


def _quietly(fn, *args):
    try:
        fn(*args)
    except Exception:  # noqa: BLE001 (closing anyway)
        pass


def start_remote_engine(screen=None):
    """(2.37.0) The Remote desktop's hidden sender runs while "let my other PCs control this one" is on."""
    try:
        remote.run_engine(f"http://127.0.0.1:{PORT[0]}/remote-host?t={TOKEN}", WINDOW_ICON, screen)
        remote.awake()
    except Exception:  # noqa: BLE001 (never stop the app over this)
        pass


def remote_engine_watch():
    """(2.37.1) Starts the hidden sender a little after the window (so it doesn't slow the start), then
    checks every half minute that it's still there while the switch is on, and starts it again if not."""
    time.sleep(8)
    while True:
        try:
            if remote.info()["host"]:
                start_remote_engine()
        except Exception:  # noqa: BLE001
            pass
        time.sleep(30)


def show_window():
    """Bring the app's window to the front (a PC wants in and you need to answer)."""
    try:
        if appwindow._window and appwindow._window.alive:
            appwindow._window.show()
    except Exception:  # noqa: BLE001
        pass


def open_window(url):
    """Show the app's window (or bring it to the front if it's open)."""
    shown = False
    saved = settings.load()
    if saved.get("own_window", True):
        with _window_lock:
            os.makedirs(settings.DATA_DIR, exist_ok=True)
            with open(WINDOW_STARTING, "w"):
                pass
            try:
                shown = appwindow.show(url, os.path.join(settings.DATA_DIR, "webview"), WINDOW_ICON,
                                       on_closed=window_closed, placement=saved.get("window"))
            finally:
                try:
                    os.remove(WINDOW_STARTING)
                except OSError:
                    pass
    if not shown:
        open_edge(url)  # no WebView2 on this PC


def open_edge(url):
    """An Edge app window, like the app used before it had its own window."""
    edge = find_edge()
    if not edge:
        webbrowser.open(url)
        return
    subprocess.Popen([
        edge,
        f"--app={url}",
        "--window-size=960,760",
        f"--user-data-dir={os.path.join(settings.DATA_DIR, 'window')}",
        "--no-first-run",
        "--no-default-browser-check",
        *([] if state.hardware else ["--disable-gpu"]),
    ])


def already_running_url():
    """If the app is already open, return its (address, token) so we just show it again."""
    try:
        with open(PORT_FILE) as f:
            port, _, token = f.read().strip().partition(" ")
        url = f"http://127.0.0.1:{int(port)}/"
        request = urllib.request.Request(url + "api/state", headers={"X-Lelons-Token": token})
        with urllib.request.urlopen(request, timeout=2) as response:
            running = json.load(response).get("version")
    except (OSError, ValueError):
        return None
    if running == VERSION:
        return url, token
    # The app was updated but the old version is still running in the
    # background. Close it and start the new one instead.
    try:
        request = urllib.request.Request(url + "api/quit", data=b"{}", method="POST",
                                         headers={"X-Lelons-Token": token})
        urllib.request.urlopen(request, timeout=2).close()
    except OSError:
        pass
    for _ in range(20):
        if not os.path.exists(PORT_FILE):
            break
        time.sleep(0.25)
    return None


def clean_up():
    waveform.clean_up()  # the whole temporary folder, with the Images and Files tabs' parts
    images.clean_up()
    files.clean_up()
    sfx.clean_drag_copies()
    sfx.waveforms.save()  # waveforms not written down yet
    pagecache.flush()
    copyright_check.clean_up()
    clips.clean_up()


# ---------------------------------------------------------------- main

def main():
    # Only one copy runs. Starting it again shows the open window instead.
    give_up = time.time() + 15
    while True:
        existing = already_running_url()
        if existing:
            # Ask the open app to show its window. (Windows only lets it come to
            # the front if this program, which the user just started, allows it.)
            url, token = existing
            if os.name == "nt":
                ctypes.windll.user32.AllowSetForegroundWindow(-1)  # ASFW_ANY
            try:
                request = urllib.request.Request(url + "api/show-window", data=b"{}", method="POST",
                                                 headers={"X-Lelons-Token": token})
                urllib.request.urlopen(request, timeout=70).close()
            except OSError:
                open_edge(f"{url}?t={token}")
            return
        if windows.single_instance():
            break
        if time.time() > give_up:
            return  # another copy is starting or closing and doesn't answer; leave it be
        time.sleep(0.3)

    # Left over from a time the app didn't close properly (the PC turned off, say).
    clean_up()
    check_window_crash()
    try:
        settings.lock_old_secrets()  # (2.33.0) sign-ins saved before were plain text
    except OSError:
        pass

    started = time.time()  # half-made files older than this are leftovers from last time
    names.FOLDERS_FILE = os.path.join(settings.DATA_DIR, "making-in.json")
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    os.makedirs(settings.DATA_DIR, exist_ok=True)
    with open(PORT_FILE, "w") as f:
        f.write(f"{server.server_port} {TOKEN}")
    PORT[0] = server.server_port
    threading.Thread(target=remote_engine_watch, daemon=True).start()

    media.use_gpu(state.hardware)
    import srvwatch
    srvwatch.start()  # auto-posts about your own videos and streams in your servers
    # A hidden or minimized window still checks for calls every few seconds (Edge would slow it to once a minute).
    browser_args = ["--disable-background-timer-throttling", "--disable-features=IntensiveWakeUpThrottling"]
    if not state.hardware:  # Hardware acceleration off: the window draws without the graphics card too
        browser_args.append("--disable-gpu")
    os.environ["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = " ".join(browser_args)
    appwindow.set_zoom(state.zoom)
    appwindow.set_dark(state.theme != "light")
    # (2.36.0) While VaultHub passes your stream on to other sites, closing the window asks first.
    appwindow.set_close_guard(lambda: "multistream" if multistream.live() else "")
    open_window(f"http://127.0.0.1:{server.server_port}/?t={TOKEN}")
    sfx.presence.start()
    home.on_update = sfx.library.log_channel
    state.set(last_ping=time.time())  # the window has 3 minutes to start checking in
    # Chores that can wait until the window is up (so it opens sooner).
    def after_start():
        names.remove_all_leftovers(started, state.folder)
        updater.remove_old_setups()
        sfx.clean_drag_copies()  # left behind if the app was killed last time (dragged ones are kept)
        resolve.uninstall()  # the old test buttons in Resolve's Scripts menu (the free Resolve 21 can't run them)
        updater.tidy_yt_dlp()  # before the update check can start downloading a new one
        try:
            trash.tidy()  # local things that have been in the Trash for 30 days go for good
        except OSError:
            pass
        if state.auto_update:
            start_background(check_for_updates)
        warm_up()
        multistream.start_at_launch()  # (2.36.0) multistreaming was on: listen for OBS again
    start_background(after_start)

    # Quit once the window is closed (the page says bye and stops checking in).
    # Minimized windows check in rarely, so the plain-silence timeout is long.
    last_tick = time.time()
    while True:
        time.sleep(0.5)
        now = time.time()
        if now - last_tick > 30:
            # The PC was asleep, so the window couldn't check in. That's not closing it.
            state.set(last_ping=now)
        last_tick = now
        closed = state.closed_at and state.last_ping < state.closed_at and now - state.closed_at > 3
        silent = now - state.last_ping > 180
        if state.quit or ((closed or silent) and not state.busy):
            break

    server.shutdown()
    try:
        os.remove(PORT_FILE)
    except OSError:
        pass
    appwindow.close()
    sfx.presence.bye()  # not "online" any more
    windows.stop_helpers()  # ffmpeg can keep running after the app if it isn't told to stop
    clean_up()
    if state.installer:
        updater.run_installer(state.installer)


if __name__ == "__main__":
    main()
