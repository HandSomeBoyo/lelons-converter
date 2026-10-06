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
import findsounds  # noqa: E402
import pagecache  # noqa: E402
import copycheck as copyright_check  # noqa: E402
import docs  # noqa: E402
import history  # noqa: E402
import home  # noqa: E402
import images  # noqa: E402
import jobs  # noqa: E402
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
ICON_CANDIDATES = [os.path.join(APP_DIR, "icon.png"), os.path.join(APP_DIR, "..", "assets", "icon.png")]
WINDOW_ICON = next((p for p in (os.path.join(APP_DIR, "icon.ico"), os.path.join(APP_DIR, "..", "assets", "icon.ico"))
                    if os.path.isfile(p)), "")
PORT_FILE = os.path.join(settings.DATA_DIR, "running.port")
NO_WINDOW = downloader.NO_WINDOW
# A secret only the app's own window knows, so web pages open in a browser
# can't use the app (they could otherwise reach it at 127.0.0.1).
TOKEN = secrets.token_urlsafe(24)
CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
    ".jpg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp",
    ".ico": "image/x-icon", ".woff2": "font/woff2", ".mp3": "audio/mpeg",
}

# pythonw has no console, so there's nowhere for text output to go.
# Send it nowhere instead of crashing.
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")


# ---------------------------------------------------------------- app state

PAGE_PREFS = ("tab", "sfxSort", "fileOptions", "imageOptions", "chatSeen", "chatSound", "homeSeen", "volume", "tourSeen", "tourVoice")  # what the page may remember
page_pref_lock = threading.Lock()

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
        self.installing = False
        self.app_update = None  # newer version info, once found
        self.app_update_progress = None
        self.last_ping = time.time()
        self.closed_at = None
        self.quit = False

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
                "appUpdate": self.app_update,
                "appUpdateProgress": self.app_update_progress,
                "jobs": queue.snapshot(),
                "files": local_files.snapshot(),
                "historyVersion": history.version,
                "sfxUploads": sfx.library.snapshot(),
            }

    @property
    def busy(self):
        return (self.checking or self.app_update_progress is not None or self.converting)

    @property
    def converting(self):
        return queue.busy or local_files.busy or waveform.busy() or sfx.library.busy

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
    state.set(checking=False)
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
        updater.download_and_run(found["url"], found["version"], lambda p: state.set(app_update_progress=p))
    except Exception as e:
        state.set(app_update_progress=None, installing=False,
                  notice={"kind": "error", "text": f"Couldn't download the update. ({e})"})
        return
    time.sleep(2.5)  # let the window show "Opening the installer..." and close itself
    state.set(quit=True)  # close so the installer can replace the app's files


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

def save_folder(data):
    """The folder the page asked for with /api/ask-folder, else the one picked in Settings."""
    folder = data.get("folder") if isinstance(data, dict) else None
    if isinstance(folder, str) and folder and os.path.isdir(folder):
        return os.path.normpath(folder)
    return state.folder


def home_page():
    """Everything on the Home page."""
    crew, error = None, ""
    if sfx.configured():
        try:
            crew = sfx.library.home()
        except sfx.Error as e:
            error = str(e)
    links = (crew or {}).get("channels") or version_channels()
    recent = [i for i in history.items() if i["exists"]][:5]
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

    def send_body(self, body, content_type, cookie=False):
        self.send_response(200)
        if cookie:
            port = self.server.server_port
            self.send_header("Set-Cookie", f"lelons{port}={TOKEN}; Path=/; HttpOnly; SameSite=Strict")
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, data):
        self.send_body(json.dumps(data).encode(), "application/json")

    def send_file(self, path, cookie=False):
        with open(path, "rb") as f:
            body = f.read()
        if os.path.basename(path) == "index.html":
            # What the page remembers (see ui/theme.js), plus the theme, so it shows the right colors at once.
            saved = {**(settings.load().get("page") or {}), "theme": state.theme, "accent": state.accent,
                     "zoom": state.zoom, "nativeZoom": appwindow.active()}
            text = json.dumps(saved).replace("<", "\\u003c")
            cache = json.dumps(pagecache.get(), separators=(",", ":")).replace("<", "\\u003c")
            body = body.replace(b"<!--SAVED-->", f"<script>const LELONS_SAVED = {text};\nconst LELONS_CACHE = {cache};</script>".encode())
        content_type = CONTENT_TYPES.get(os.path.splitext(path)[1].lower(), "application/octet-stream")
        self.send_body(body, content_type, cookie)

    def send_media(self, path):
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
        self.send_header("Content-Type", content_type.get(os.path.splitext(path)[1], "application/octet-stream"))
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
        if not self.allowed():
            return self.refuse()
        if self.path == "/api/state":
            state.set(last_ping=time.time())
            page_loaded.set()
            return self.send_json(state.snapshot())
        if self.path == "/api/history":
            return self.send_json({"items": history.items(), "version": history.version})
        if self.path.startswith("/media/"):
            path = waveform.file_path(self.path[len("/media/"):])
            return self.send_media(path) if path and os.path.isfile(path) else self.send_error(404)
        if self.path.startswith("/file-thumb/"):
            item = local_files.find(self.path[len("/file-thumb/"):])
            path = item and item["thumbPath"]
            return self.send_file(path) if path and os.path.isfile(path) else self.send_error(404)
        if self.path.startswith("/image/"):
            path = images.thumbnail_path(self.path[len("/image/"):])
            return self.send_file(path) if path and os.path.isfile(path) else self.send_error(404)
        if self.path == "/icon.png":
            icon = next((p for p in ICON_CANDIDATES if os.path.isfile(p)), None)
            return self.send_file(icon) if icon else self.send_error(404)
        name = "index.html" if self.path == "/" else self.path.lstrip("/")
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
                result = {"account": library.signup(data.get("username"), data.get("password"))}
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
                result = library.chat(data.get("after"), data.get("with"))
            elif action == "chat-send":
                clip = None
                if data.get("clip"):
                    clip = clip_maker.for_sending(data["clip"])
                    if not clip:
                        raise sfx.Error("Make the clip first.")
                library.chat_send(data.get("message"), data.get("with"), data.get("sound"), clip)
                result = library.chat(data.get("after"), data.get("with"))
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
            elif action == "profile":
                result = {"profile": library.profile(data.get("username"))}
            elif action == "favorite":
                library.favorite(data.get("id"), data.get("on"))
                result = {}
            elif action == "edit":
                library.edit(data.get("id"), data.get("name"), data.get("category"), data.get("genre"))
                result = {"sounds": library.sounds()}
            elif action == "delete":
                library.delete(data.get("id"))
                result = {}
            elif action == "download":
                path = library.download(str(data.get("url") or ""), data.get("name"), save_folder(data))
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

    def handle_docs(self, action, data):
        """The Docs tab. Every answer is {"ok": true, ...} or {"ok": false, "error": "..."}."""
        doc_id = data.get("id")
        collab = data.get("where") == "collab"
        try:
            if action == "list":
                result = {"local": docs.local_list()}
                if data.get("collab"):
                    try:
                        result.update(collab=docs.collab_list())
                    except sfx.LoggedOut:
                        result.update(collab=None)
                    except (docs.Error, sfx.Error) as e:
                        result.update(collab=None, collabError=str(e))
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
            elif action == "delete":
                docs.collab_delete(doc_id) if collab else docs.local_delete(doc_id)
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
                path = docs.export(save_folder(data), data.get("title"), data.get("ext"), data.get("text"))
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

    def handle_post(self):
        length = int(self.headers.get("Content-Length") or 0)
        if self.path == "/api/file-add":  # the body is the file itself
            name = urllib.parse.unquote(self.headers.get("X-File-Name") or "file")
            try:
                return self.send_json({"ok": True, "file": local_files.add(name, self.rfile, length)})
            except ValueError as e:
                return self.send_json({"ok": False, "error": str(e)})
            except OSError:
                return self.send_json({"ok": False, "error": "Couldn't open this file."})
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
            item = local_files.find(data["file"])
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
            queue.add(url, fmt, quality, quality_label(fmt, quality), save_folder(data), trim, state.normalize)
            state.set(notice=None)
            self.send_json({"ok": True})
        elif self.path == "/api/convert-many":
            # Videos picked from a playlist.
            fmt = data.get("format") if data.get("format") in settings.QUALITIES else "mp3"
            quality = state.quality[fmt]
            items = [i for i in (data.get("items") or []) if isinstance(i, dict) and str(i.get("url", "")).startswith("http")]
            for item in items:
                trim = [0, min(media.GIF_DEFAULT_SECONDS, int(item.get("seconds") or 0) or media.GIF_DEFAULT_SECONDS)] if fmt == "gif" else None
                queue.add(str(item["url"]), fmt, quality, quality_label(fmt, quality), save_folder(data), trim,
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
            queue.add(item["url"], fmt, quality, quality_label(fmt, quality), save_folder(data), trim,
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
                    result = findsounds.search(data.get("query"), data.get("source"), data.get("page") or 1)
                elif self.path == "/api/find-add":
                    result = {"file": findsounds.add_to_library(data.get("id"))}
                else:
                    path = findsounds.save(data.get("id"), save_folder(data))
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
        elif self.path == "/api/history-clear":
            history.clear()
            self.send_json({"ok": True})
        elif self.path.startswith("/api/sfx-"):
            self.handle_sfx(self.path[len("/api/sfx-"):], data)
        elif self.path.startswith("/api/docs-"):
            self.handle_docs(self.path[len("/api/docs-"):], data)
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
        elif self.path == "/api/files-convert":
            try:
                local_files.convert(data.get("items") or [], data.get("options") or {}, save_folder(data))
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
        elif self.path == "/api/file-show":
            item = local_files.find(data.get("id"))
            if item and item["out"]:
                show_in_folder(item["out"])
            self.send_json({"ok": True})
        elif self.path == "/api/image-convert":
            try:
                made = images.convert(str(data.get("id")), data.get("options") or {}, save_folder(data))
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
        elif self.path == "/api/page-pref":  # something the page remembers (see ui/theme.js)
            key, value = data.get("key"), data.get("value")
            if key in PAGE_PREFS and len(json.dumps(value)) < 4000:
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
            if data.get("accent") in settings.ACCENTS:
                changes["accent"] = data["accent"]
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

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    os.makedirs(settings.DATA_DIR, exist_ok=True)
    with open(PORT_FILE, "w") as f:
        f.write(f"{server.server_port} {TOKEN}")

    media.use_gpu(state.hardware)
    if not state.hardware:  # Hardware acceleration off: the window draws without the graphics card too
        os.environ["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = "--disable-gpu"
    appwindow.set_zoom(state.zoom)
    appwindow.set_dark(state.theme != "light")
    open_window(f"http://127.0.0.1:{server.server_port}/?t={TOKEN}")
    sfx.presence.start()
    home.on_update = sfx.library.log_channel
    state.set(last_ping=time.time())  # the window has 3 minutes to start checking in
    # Chores that can wait until the window is up (so it opens sooner).
    def after_start():
        names.remove_leftovers(state.folder)
        sfx.clean_drag_copies()  # left behind if the app was killed last time (dragged ones are kept)
        updater.tidy_yt_dlp()  # before the update check can start downloading a new one
        if state.auto_update:
            start_background(check_for_updates)
        warm_up()
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


if __name__ == "__main__":
    main()
