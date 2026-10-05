"""Keeps the app and its downloader (yt-dlp) up to date.

New versions of the app are published as GitHub Releases with the installer
attached. The app only downloads and starts the installer after the user
clicks "Install update", and the installer shows its usual windows.

yt-dlp gets fixes for YouTube changes every few weeks. New versions are
downloaded from PyPI into the app's data folder and used from the next start,
so the installed app's files are never touched while it runs.
"""

import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

from settings import DATA_DIR
from version import UPDATE_REPO, VERSION

USER_AGENT = f"LelonsConverter/{VERSION}"
YT_DLP_DIR = os.path.join(DATA_DIR, "yt-dlp")


def parse_version(text):
    return tuple(int(n) for n in re.findall(r"\d+", text))


def _get(url, timeout=15):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    return urllib.request.urlopen(request, timeout=timeout)


def _get_json(url):
    with _get(url) as response:
        return json.load(response)


# ---------------------------------------------------------------- the app

def check():
    """Returns {"version", "notes", "url"} if a newer version exists, else None."""
    if not UPDATE_REPO:
        return None
    release = _get_json(f"https://api.github.com/repos/{UPDATE_REPO}/releases/latest")
    latest = release.get("tag_name", "")
    if not latest or parse_version(latest)[:3] <= parse_version(VERSION)[:3]:
        return None
    setup = next((a for a in release.get("assets", []) if a.get("name", "").lower().endswith("setup.exe")), None)
    if not setup:
        return None
    return {
        "version": latest.lstrip("vV"),
        "notes": (release.get("body") or "").strip()[:500],
        "url": setup["browser_download_url"],
    }


def download_and_run(url, version, on_progress):
    """Download the new installer and open it. The app should close right after."""
    path = os.path.join(tempfile.gettempdir(), f"Lelons Converter Setup {version}.exe")
    with _get(url, timeout=30) as response, open(path + ".part", "wb") as out:
        total = int(response.headers.get("Content-Length") or 0)
        done = 0
        while chunk := response.read(256 * 1024):
            out.write(chunk)
            done += len(chunk)
            if total:
                on_progress(done * 100 / total)
    on_progress(100)
    os.replace(path + ".part", path)
    # /update makes the installer skip its welcome page.
    subprocess.Popen([path, "/update"], close_fds=True)


# ---------------------------------------------------------------- yt-dlp

def _version_in(folder):
    """yt-dlp's version in a folder that holds a yt_dlp package, without importing it."""
    try:
        with open(os.path.join(folder, "yt_dlp", "version.py"), encoding="utf-8") as f:
            return re.search(r"__version__ = '([^']+)'", f.read())[1]
    except (OSError, TypeError):
        return None


def _bundled_folder():
    for folder in sys.path:
        if folder and _version_in(folder) and not os.path.normcase(folder).startswith(os.path.normcase(YT_DLP_DIR)):
            return folder
    return None


def use_newest_yt_dlp():
    """Call before yt-dlp is imported: picks a downloaded newer yt-dlp if there is one.

    Older downloads are deleted later by tidy_yt_dlp(), once it's sure no other
    copy of the app is running (and maybe using them).
    """
    global _in_use
    bundled = _bundled_folder()
    best_version = _version_in(bundled) if bundled else "0"
    best = None
    try:
        names = os.listdir(YT_DLP_DIR)
    except OSError:
        names = []
    for name in names:
        folder = os.path.join(YT_DLP_DIR, name)
        version = None if name.endswith(".part") else _version_in(folder)  # .part: still downloading
        if version and parse_version(version) > parse_version(best_version):
            best, best_version = folder, version
    if best:
        sys.path.insert(0, best)
    _in_use = best
    return best_version


_in_use = None


def tidy_yt_dlp():
    """Delete downloaded yt-dlp versions this app isn't using."""
    try:
        names = os.listdir(YT_DLP_DIR)
    except OSError:
        return
    for name in names:
        folder = os.path.join(YT_DLP_DIR, name)
        if folder != _in_use:
            shutil.rmtree(folder, ignore_errors=True)


def _download_wheel(package, version, into):
    release = _get_json(f"https://pypi.org/pypi/{package}/{version}/json")
    wheel = next(u for u in release["urls"] if u["packagetype"] == "bdist_wheel" and u["filename"].endswith("-none-any.whl"))
    with _get(wheel["url"], timeout=60) as response:
        data = response.read()
    if hashlib.sha256(data).hexdigest() != wheel["digests"]["sha256"]:
        raise OSError(f"The {package} download was damaged.")
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        z.extractall(into)
        return z.namelist()


def update_yt_dlp(current):
    """Download a newer yt-dlp if there is one. Returns its version, or None."""
    latest = _get_json("https://pypi.org/pypi/yt-dlp/json")["info"]["version"]
    if parse_version(latest) <= parse_version(current):
        return None
    folder = os.path.join(YT_DLP_DIR, latest)
    temp = folder + ".part"
    shutil.rmtree(temp, ignore_errors=True)
    files = _download_wheel("yt-dlp", latest, temp)
    # yt-dlp needs a matching yt-dlp-ejs to solve YouTube's JavaScript challenges.
    metadata = next(f for f in files if f.endswith(".dist-info/METADATA"))
    with open(os.path.join(temp, metadata), encoding="utf-8") as f:
        ejs = re.search(r"Requires-Dist: yt-dlp-ejs==([\w.]+); extra == .default.", f.read())
    if ejs:
        _download_wheel("yt-dlp-ejs", ejs[1], temp)
    shutil.rmtree(folder, ignore_errors=True)
    os.replace(temp, folder)
    return latest
