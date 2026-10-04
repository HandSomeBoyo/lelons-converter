"""Lelons Converter - paste a YouTube link, pick MP3 or MP4, convert.

The window is a Microsoft Edge app window (Edge is on every Windows PC)
showing the page in ui/. This script runs a small local web server that the
page talks to, and does the downloading with yt-dlp.
"""

import json
import mimetypes
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import downloader
import jobs
import settings
import updater
from version import VERSION

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
        self.updating = False
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
                "updating": self.updating,
                "appUpdate": self.app_update,
                "appUpdateProgress": self.app_update_progress,
                "jobs": queue.snapshot(),
            }

    @property
    def busy(self):
        return self.updating or self.app_update_progress is not None or queue.busy


queue = jobs.Queue()
state = State()


def start_background(work, *args):
    threading.Thread(target=work, args=args, daemon=True).start()


def quality_label(fmt, quality):
    return next((label for value, label in settings.QUALITIES[fmt] if value == quality), quality)


def update_downloader():
    state.set(updating=True, notice={"kind": "info", "text": "Updating the downloader..."})
    try:
        downloader.update_yt_dlp()
    except Exception as e:
        state.set(updating=False, notice={"kind": "error", "text": f"Update failed. Check your internet connection. ({e})"})
        return
    state.set(updating=False, notice={"kind": "done", "text": "Updated. Close and reopen the app to use the new version."})


def check_for_app_update():
    try:
        state.set(app_update=updater.check())
    except Exception:
        pass  # offline or GitHub unreachable; try again next time the app opens


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

    def do_GET(self):
        if self.path == "/api/state":
            state.set(last_ping=time.time())
            return self.send_json(state.snapshot())
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
        elif self.path == "/api/convert":
            url = str(data.get("url", "")).strip()
            fmt = "mp4" if data.get("format") == "mp4" else "mp3"
            if not url:
                return self.send_json({"ok": False, "error": "Paste a YouTube link first."})
            quality = state.quality[fmt]
            queue.add(url, fmt, quality, quality_label(fmt, quality), state.folder)
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
        elif self.path == "/api/update":
            if not state.updating:
                start_background(update_downloader)
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
        with urllib.request.urlopen(url + "api/state", timeout=1):
            return url
    except (OSError, ValueError):
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
    start_background(check_for_app_update)

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


if __name__ == "__main__":
    main()
