"""Lelons Converter - paste a YouTube link, pick MP3 or MP4, convert.

The window is a Microsoft Edge app window (Edge is on every Windows PC)
showing the page in ui/. This script runs a small local web server that the
page talks to, and does the downloading with yt-dlp.
"""

import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import updater

# Before anything loads yt-dlp: use a newer one if one was downloaded.
YT_DLP_VERSION = updater.use_newest_yt_dlp()

import downloader  # noqa: E402
import jobs  # noqa: E402
import settings  # noqa: E402
import waveform  # noqa: E402
from version import VERSION  # noqa: E402

APP_DIR = os.path.dirname(os.path.abspath(__file__))
UI_DIR = os.path.join(APP_DIR, "ui")
ICON_CANDIDATES = [os.path.join(APP_DIR, "icon.png"), os.path.join(APP_DIR, "..", "assets", "icon.png")]
PORT_FILE = os.path.join(settings.DATA_DIR, "running.port")
NO_WINDOW = downloader.NO_WINDOW

# pythonw has no console, so there's nowhere for text output to go.
# Send it nowhere instead of crashing.
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")


# ---------------------------------------------------------------- app state

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
        self.checking = False
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
                "checking": self.checking,
                "appUpdate": self.app_update,
                "appUpdateProgress": self.app_update_progress,
                "jobs": queue.snapshot(),
            }

    @property
    def busy(self):
        return self.checking or self.app_update_progress is not None or queue.busy


queue = jobs.Queue()
state = State()


def start_background(work, *args):
    threading.Thread(target=work, args=args, daemon=True).start()


def quality_label(fmt, quality):
    return next((label for value, label in settings.QUALITIES[fmt] if value == quality), quality)


def check_for_updates(manual=False):
    """Look for a new version of the app (shown as a popup) and of the downloader."""
    if state.checking:
        return
    state.set(checking=True)
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
        state.set(app_update_progress=None,
                  notice={"kind": "error", "text": f"Couldn't download the update. ({e})"})
        return
    time.sleep(2.5)  # let the window show "Opening the installer..." and close itself
    state.set(quit=True)  # close so the installer can replace the app's files


def show_in_folder(path):
    if os.name == "nt" and os.path.isfile(path):
        subprocess.Popen(["explorer", "/select,", os.path.normpath(path)])
    elif hasattr(os, "startfile"):
        os.startfile(os.path.dirname(path) or state.folder)


def pick_folder(current):
    """Show the Windows folder picker; returns '' if cancelled."""
    if os.name != "nt":
        return ""
    import folder_picker
    try:
        return folder_picker.pick_folder(current)
    except OSError:
        return ""


# ---------------------------------------------------------------- web server

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send_body(self, body, content_type):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, data):
        self.send_body(json.dumps(data).encode(), "application/json")

    def send_file(self, path):
        with open(path, "rb") as f:
            body = f.read()
        content_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
        if content_type.startswith("text/") or content_type.endswith("javascript"):
            content_type += "; charset=utf-8"
        self.send_body(body, content_type)

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
        if self.path == "/api/state":
            state.set(last_ping=time.time())
            return self.send_json(state.snapshot())
        if self.path.startswith("/media/"):
            path = waveform.file_path(self.path[len("/media/"):])
            return self.send_media(path) if path and os.path.isfile(path) else self.send_error(404)
        if self.path == "/icon.png":
            icon = next((p for p in ICON_CANDIDATES if os.path.isfile(p)), None)
            return self.send_file(icon) if icon else self.send_error(404)
        name = "index.html" if self.path == "/" else self.path.lstrip("/")
        path = os.path.normpath(os.path.join(UI_DIR, name))
        if path.startswith(UI_DIR + os.sep) and os.path.isfile(path):
            return self.send_file(path)
        self.send_error(404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        try:
            data = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            data = {}

        if self.path == "/api/info":
            url = str(data.get("url", "")).strip()
            try:
                self.send_json({"ok": True, "preview": queue.lookup(url)})
            except Exception as e:
                self.send_json({"ok": False, "error": downloader.friendly_error(e)})
        elif self.path == "/api/waveform":
            url = str(data.get("url", "")).strip()
            try:
                queue.lookup(url)
                media = waveform.get(url, queue.info_cache[url][1], bool(data.get("video")))
                self.send_json({"ok": True, **media})
            except Exception as e:
                self.send_json({"ok": False, "error": downloader.friendly_error(e)})
        elif self.path == "/api/convert":
            url = str(data.get("url", "")).strip()
            fmt = "mp4" if data.get("format") == "mp4" else "mp3"
            if not url:
                return self.send_json({"ok": False, "error": "Paste a YouTube link first."})
            trim = None
            if data.get("start") or data.get("end"):
                start = downloader.parse_time(data.get("start") or "0")
                end = downloader.parse_time(data.get("end")) if data.get("end") else None
                try:
                    length = queue.lookup(url).get("seconds") or 0
                except Exception:
                    length = 0  # the download will report what's wrong with the link
                if end is None and length:
                    end = length
                if start is None or end is None or end <= start:
                    return self.send_json({"ok": False, "error": "Check the trim times, like 1:20 to 2:05."})
                if not (start <= 0 and length and end >= length):  # the whole video isn't a trim
                    trim = [start, min(end, length) if length else end]
            quality = state.quality[fmt]
            queue.add(url, fmt, quality, quality_label(fmt, quality), state.folder, trim)
            state.set(notice=None)
            self.send_json({"ok": True})
        elif self.path == "/api/remove":
            queue.remove(data.get("id"))
            self.send_json({"ok": True})
        elif self.path == "/api/retry":
            queue.retry(data.get("id"))
            self.send_json({"ok": True})
        elif self.path == "/api/clear":
            queue.clear_finished()
            self.send_json({"ok": True})
        elif self.path == "/api/show-file":
            job = queue.find(data.get("id"))
            if job:
                show_in_folder(job["file"])
            self.send_json({"ok": True})
        elif self.path == "/api/quality":
            fmt, quality = data.get("format"), str(data.get("quality"))
            if settings.is_valid_quality(fmt, quality):
                state.quality[fmt] = quality
                settings.save(**{f"quality_{fmt}": quality})
            self.send_json(state.snapshot())
        elif self.path == "/api/pick-folder":
            folder = pick_folder(state.folder)
            if folder and os.path.isdir(folder):
                state.set(folder=os.path.normpath(folder))
                settings.save(folder=state.folder)
            self.send_json(state.snapshot())
        elif self.path == "/api/open-folder":
            if hasattr(os, "startfile"):
                os.startfile(state.folder)
            self.send_json({"ok": True})
        elif self.path == "/api/check-updates":
            start_background(check_for_updates, True)
            self.send_json({"ok": True})
        elif self.path == "/api/auto-update":
            state.set(auto_update=bool(data.get("on")))
            settings.save(auto_update=state.auto_update)
            self.send_json(state.snapshot())
        elif self.path == "/api/quit":
            # A different version of the app was started and needs this one gone.
            state.set(quit=True)
            self.send_json({"ok": True})
        elif self.path == "/api/install-app-update":
            if state.app_update_progress is None:
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


def open_window(url):
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
    ])


def already_running_url():
    """If the app is already open, return its address so we just show it again."""
    try:
        with open(PORT_FILE) as f:
            url = f"http://127.0.0.1:{int(f.read().strip())}/"
        with urllib.request.urlopen(url + "api/state", timeout=2) as response:
            running = json.load(response).get("version")
    except (OSError, ValueError):
        return None
    if running == VERSION:
        return url
    # The app was updated but the old version is still running in the
    # background. Close it and start the new one instead.
    try:
        request = urllib.request.Request(url + "api/quit", data=b"{}", method="POST")
        urllib.request.urlopen(request, timeout=2).close()
    except OSError:
        pass
    for _ in range(20):
        if not os.path.exists(PORT_FILE):
            break
        time.sleep(0.25)
    return None


# ---------------------------------------------------------------- main

def main():
    existing = already_running_url()
    if existing:
        open_window(existing)
        return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    os.makedirs(settings.DATA_DIR, exist_ok=True)
    with open(PORT_FILE, "w") as f:
        f.write(str(server.server_port))

    open_window(f"http://127.0.0.1:{server.server_port}/")
    state.set(last_ping=time.time() + 30)  # give the window time to open
    start_background(downloader.warm_up)
    if state.auto_update:
        start_background(check_for_updates)

    # Quit once the window is closed (the page says bye and stops checking in).
    # Minimized windows check in rarely, so the plain-silence timeout is long.
    while True:
        time.sleep(0.5)
        now = time.time()
        closed = state.closed_at and state.last_ping < state.closed_at and now - state.closed_at > 3
        silent = now - state.last_ping > 180
        if state.quit or ((closed or silent) and not state.busy):
            break

    server.shutdown()
    try:
        os.remove(PORT_FILE)
    except OSError:
        pass
    waveform.clean_up()


if __name__ == "__main__":
    main()
