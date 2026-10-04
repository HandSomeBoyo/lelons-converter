"""Checks GitHub for a newer version of the app and installs it.

New versions are published as GitHub Releases with the installer attached.
The app only downloads and starts the installer after the user clicks
"Update now", and the installer shows its usual windows.
"""

import json
import os
import re
import subprocess
import tempfile
import urllib.request

from version import UPDATE_REPO, VERSION

USER_AGENT = f"LelonsConverter/{VERSION}"


def parse_version(text):
    return tuple(int(n) for n in re.findall(r"\d+", text)[:3])


def check():
    """Returns {"version", "notes", "url"} if a newer version exists, else None."""
    if not UPDATE_REPO:
        return None
    request = urllib.request.Request(
        f"https://api.github.com/repos/{UPDATE_REPO}/releases/latest",
        headers={"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json"},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        release = json.load(response)
    latest = release.get("tag_name", "")
    if not latest or parse_version(latest) <= parse_version(VERSION):
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
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response, open(path + ".part", "wb") as out:
        total = int(response.headers.get("Content-Length") or 0)
        done = 0
        while chunk := response.read(256 * 1024):
            out.write(chunk)
            done += len(chunk)
            if total:
                on_progress(done * 100 / total)
    os.replace(path + ".part", path)
    subprocess.Popen([path], close_fds=True)
